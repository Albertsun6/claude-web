# M1A-β — Phase 1 Risk Officer Review

**Reviewer:** vessel-risk-officer (Phase 1)
**Lens:** secrets / attack surface / data exposure / DoS (ADR-014 #5)
**Subject:** M1A-β WS streaming of vessel-core (`vessel_intent` / `vessel_cancel` /
`vessel_trace` / `vessel_progress` / `vessel_completed` / `vessel_error`)
**Files inspected:**
- [packages/backend/src/index.ts](../../packages/backend/src/index.ts) §lines 287–599
- [packages/backend/src/orchestrator.ts](../../packages/backend/src/orchestrator.ts)
- [packages/backend/src/observability/trace-writer.ts](../../packages/backend/src/observability/trace-writer.ts)
- [packages/backend/src/observability/trace-redactor.ts](../../packages/backend/src/observability/trace-redactor.ts)
- [packages/backend/src/drivers/cli-runner-driver.ts](../../packages/backend/src/drivers/cli-runner-driver.ts)
- [packages/backend/src/routes/vessel-intent.ts](../../packages/backend/src/routes/vessel-intent.ts) (HTTP for parity)
- [packages/backend/src/skills/coding.ts](../../packages/backend/src/skills/coding.ts)
- [packages/backend/src/auth.ts](../../packages/backend/src/auth.ts)
- [packages/backend/src/test-vessel-ws-multi.ts](../../packages/backend/src/test-vessel-ws-multi.ts)
- [packages/shared/src/protocol.ts](../../packages/shared/src/protocol.ts) §lines 55–155
- [docs/design/trace-redaction-spec.md](../design/trace-redaction-spec.md)

---

## TL;DR

| ID | Severity | Topic | One-liner |
|---|---|---|---|
| R-M1Aβ-1 | **BLOCKER** | DoS — per-connection cap bypass | `vesselRuns.size >= 5` is per WS connection. N connections = 5N concurrent CC subprocesses. M1A-α HTTP cap was process-wide; WS regresses it. |
| R-M1Aβ-2 | **BLOCKER** | Path leak — `vessel_trace.event.artifact_refs` | FileTraceWriter sink fires `safeEvent` whose `artifact_refs` is the absolute spillFile path (`$HOME/.vessel/traces/<id>/<span>.stdout`). HTTP applies `relativizePath`; WS does not. Same R-M1Aα-2 leak, regressed via WS. |
| R-M1Aβ-3 | **BLOCKER** | Path leak — `vessel_completed.result` | WS sends raw `AgentResult` from `runIntent`. HTTP applies `redactAgentResult`; WS does not. `result.artifact.files[]` and `result.artifact.stdoutPath` are absolute `$HOME/.vessel/workspace/<runId>/...` paths. |
| R-M1Aβ-4 | MAJOR | WS no `maxPayload` cap | `new WebSocketServer({ noServer: true })` uses `ws` library default (≈ 100 MiB / frame). Backend buffers each frame in memory; an authed peer can pump 100 MiB JSON frames at the upgrade socket. Text-cap `> 32 * 1024` only applied AFTER `JSON.parse`. |
| R-M1Aβ-5 | MAJOR | Trace-event size cap missing on WS push | `vessel_trace.event` and `vessel_progress.message` payloads have no per-frame size guard before `ws.send(JSON.stringify(...))`. CC stream-json with a giant `tool_use_result.content` (1+ MB) triggers redaction → 4KB inline summary path, but `vessel_progress.message` redacts per-line and forwards full size. WS send-buffer can grow unbounded; slow/dead client + fast producer = backend OOM. |
| R-M1Aβ-6 | MINOR | `vessel_cancel` validation thin | `vesselRuns.get(msg.runId)?.abort.abort()` — `runId` is unvalidated string; map lookup returns undefined for foreign IDs (per-connection isolation holds). Still: no length check, no `vessel_error` echo on bad runId, no rate cap on cancel-spam. **Not** a cross-connection vector. |
| R-M1Aβ-7 | MINOR | `vesselRuns.delete` race on disconnect | `ws.close` aborts then `vesselRuns.clear()`; the `finally` in the run also `vesselRuns.delete(runId)`. Map double-mutation is harmless on already-cleared map, but `runIntent` keeps running for ≤ a few seconds after socket close (CC SIGKILL path) — `send()` is guarded by `ws.readyState === OPEN` so messages drop silently. **Bounded leak: AbortController honoured.** |
| R-M1Aβ-8 | INFO | Test stderr accumulation (test-only) | `test-vessel-ws-multi.ts` accumulates stdout+stderr unbounded into `lastLogs`. Test-only, not shipped. Non-blocker. |

---

## R-M1Aβ-1 — BLOCKER: per-connection cap = process-wide cap × N connections

**Where:** [index.ts:540](../../packages/backend/src/index.ts#L540)
```ts
if (vesselRuns.size >= 5) { send({ type: "vessel_error", … "TooManyRequests" … }); return; }
```

`vesselRuns` is the **per-connection** Map declared at index.ts:356. The
M1A-α HTTP fix put `inflightIntents` at module scope in vessel-intent.ts so
all `/api/vessel/intent` callers share the budget. M1A-β did not port that
property — every WS connection gets its own 5-CC budget.

**Attack:**
- Open 20 WS connections (all valid auth, same token), send 5 `vessel_intent`
  on each → 100 concurrent `claude` subprocesses (per `bypassPermissions` mode
  default, [cli-runner-driver.ts:112](../../packages/backend/src/drivers/cli-runner-driver.ts#L112)).
- 100 × ≈100 MiB CC RSS = OOM-kill on the mac mini, plus rate-limit burns on
  the user's CC subscription (subscription-level DoS, not just box-level).
- Tailscale-served backend with single VESSEL_TOKEN known by ≥ 2 devices makes
  this trivially reachable from any compromised tailnet device.

**Why BLOCKER:** this is the same threat M1A-α R-M1Aα-1 closed; M1A-β reopens
it via a parallel surface. M1B does not promise to fix concurrency caps.

**Fix:** share a single process-level counter between HTTP and WS:

```ts
// vessel-intent.ts (already exports MAX_CONCURRENT_INTENTS implicitly):
export const inflightIntents = new Set<symbol>();
export const MAX_CONCURRENT_INTENTS = 5;

// index.ts WS handler — gate before runIntent:
if (inflightIntents.size >= MAX_CONCURRENT_INTENTS) {
  send({ type: "vessel_error", runId, error: { type: "TooManyRequests", … }});
  return;
}
const ticket = Symbol(`ws-${runId}`);
inflightIntents.add(ticket);
try { /* runIntent */ } finally { inflightIntents.delete(ticket); }
```

Optionally keep the per-connection 5-cap as an additional ceiling (defends
against one client hogging the budget), but the **process cap is mandatory**.

---

## R-M1Aβ-2 — BLOCKER: `vessel_trace.event.artifact_refs` is absolute path

**Where:** [trace-writer.ts:55-66](../../packages/backend/src/observability/trace-writer.ts#L55) +
[index.ts:555-558](../../packages/backend/src/index.ts#L555)

```ts
// trace-writer.ts
const spillFile = join(dir, `${event.span_id}.stdout`);  // /Users/<u>/.vessel/traces/<tid>/<sid>.stdout
…
artifactRefs = [...(artifactRefs ?? []), spillFile];     // ABSOLUTE path
const safeEvent: TraceEvent = { ...event, payload: redactedPayload, artifact_refs: artifactRefs };
…
if (this.sink) { try { this.sink(safeEvent); } … }       // sink = WS push
```

```ts
// index.ts WS:
onTraceEvent: (event) => { send({ type: "vessel_trace", runId, vesselSessionId: sid, event }); }
```

The HTTP path in [vessel-intent.ts:56-60](../../packages/backend/src/routes/vessel-intent.ts#L56)
applies `redactTraceEvent → relativizePath` to `event.artifact_refs[]`. The
WS path does not — and the M1A-α review note explicitly said "live stream
and replay are byte-identical" assuming **both apply the same redaction**.
The HTTP layer's relativization is bolted on **outside** trace-writer, so
the WS sink (which fires from inside trace-writer) bypasses it.

**Impact:** `vessel_trace` published over WS contains
`["/Users/yongqian/.vessel/traces/<tid>/<sid>.stdout"]` →
- leaks the **home directory username**
- leaks the **DATA_DIR layout**
- breaks trace-redaction-spec §3a §4 (path whitelist exempts only
  `/Users/.../Desktop/Vessel/` and `/Users/.../Desktop/claude-web/`; `.vessel/`
  is **not** in the whitelist).

**Fix (one of):**
1. Move `relativizePath` into `trace-writer.ts` so `safeEvent.artifact_refs`
   is **already relative** when persisted on disk and emitted via sink. Then
   the read endpoint (HTTP `GET /api/vessel/traces/:id`) needs no further
   redaction. **Cleaner long-term.**
2. Or, in index.ts WS handler, mirror the HTTP `redactTraceEvent` before
   `send({ type: 'vessel_trace', ... })`. Quick local fix, but duplicates the
   contract in two call sites.

Option 1 is the correct M1A-β fix (single source of truth for artifact_refs
relativization). Take a `dataDir` argument on `makeTraceWriter` if needed for
future tests.

---

## R-M1Aβ-3 — BLOCKER: `vessel_completed.result` leaks workspace + stdout absolute paths

**Where:** [index.ts:569](../../packages/backend/src/index.ts#L569)

```ts
const result = await runIntent({ … });
…
send({ type: "vessel_completed", runId, vesselSessionId: handle.vesselSessionId, result });
```

`result` is the raw `AgentResult` from `runIntent`. For a coding skill, that
includes [coding.ts:54-63](../../packages/backend/src/skills/coding.ts#L54):

```ts
{ kind: 'coding', files: artifact.files /* ABSOLUTE */, stdoutPath: artifact.stdoutPath /* ABSOLUTE */, … }
```

Both come from `cli-runner-driver.ts:151,155` and are
`/Users/yongqian/.vessel/workspace/<runId>/...` and
`/Users/yongqian/.vessel/traces/<traceId>/<spanId>.stdout` respectively.

The HTTP path passes `result` through `redactAgentResult →
relativizePath(files) + relativizePath(stdoutPath)` ([vessel-intent.ts:46-54](../../packages/backend/src/routes/vessel-intent.ts#L46)).
The WS path skips that.

**Impact:** identical to R-M1Aα-2. M1A-β regresses the M1A-α fix on this
parallel surface.

**Fix:** export `redactAgentResult` from `vessel-intent.ts` (or move it to a
shared `vessel-redact.ts` module) and apply before `send` on the WS path:

```ts
import { redactAgentResult } from './routes/vessel-intent.js';
…
send({ type: "vessel_completed", runId, vesselSessionId: …, result: redactAgentResult(result) });
```

Bonus: same redactor should be applied if M1B ever pushes mid-run results
into other ServerMessage variants.

---

## R-M1Aβ-4 — MAJOR: WS server has no `maxPayload`

**Where:** [index.ts:287](../../packages/backend/src/index.ts#L287)
```ts
const wss = new WebSocketServer({ noServer: true });
```

The `ws` library default `maxPayload` is 104857600 (100 MiB) per frame. Backend
buffers each frame fully before `ws.on('message', ...)` even fires. For an
authed peer:

1. Send a 50 MiB JSON frame; backend buffers 50 MiB before the
   `JSON.parse` in the message handler runs.
2. The `text.length > 32 * 1024` guard in `vessel_intent` at index.ts:535
   only fires **after** JSON.parse — by then 50 MiB has been allocated and
   parsed (~3-4× memory amplification during parse).
3. Repeat across 5–10 connections for a quick OOM.

**Compare HTTP:** vessel-intent.ts checks `content-length > MAX_BODY_BYTES`
**before** reading the body (R-M1Aα-1 fix). WS lacks the equivalent.

**Fix:**
```ts
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 128 * 1024,  // 128 KiB — generous for prompt + attachments meta
});
```

Note: existing `user_prompt` (Eva) flow allows image attachments (base64 in
`attachments[]`). 128 KiB may be too tight for a tile-uploaded image; consider
512 KiB or 1 MiB if attachment usage is in scope. Either way, **not 100 MiB**.

Also relevant: `ws` library will close the connection with code 1009 on
oversize frames — clients should expect that. Document in
[docs/USER_MANUAL.md](../USER_MANUAL.md) at iOS WS reconnect guidance time.

---

## R-M1Aβ-5 — MAJOR: per-event size cap missing on `vessel_trace` / `vessel_progress` push

**Where:** [index.ts:556-562](../../packages/backend/src/index.ts#L556)

`vessel_trace.event` is post-redaction (4KB inline limit enforced by trace-writer).
**But** `vessel_progress.message` is per-line CC stream-json AFTER `redactPayload`
applied in [cli-runner-driver.ts:120](../../packages/backend/src/drivers/cli-runner-driver.ts#L120):
```ts
if (ctx.onMessage) { try { ctx.onMessage(redactPayload(msg)); } … }
```

`redactPayload` masks values but doesn't cap size. CC `tool_use_result.content`
for, e.g., a giant grep result can run several MB. Each line gets stringified
and pushed to ws.send().

**Slow-consumer DoS:** ws.send buffers in `bufferedAmount` if the peer can't
drain fast enough. A slow iOS client + a coding intent that produces 50 MB of
stream-json output → backend's WS send buffer holds ≤ 50 MB per stalled peer
× number of stalled peers. No backpressure / no `bufferedAmount` watchdog.

**Fix:**
1. After `redactPayload`, check `JSON.stringify(message).length > 64 * 1024`
   and replace with `{ truncated: true, kind: <orig.type>, size: N }`. Same as
   trace-writer's 4KB spillover but for streaming-only frames.
2. Optional: in WS sender, watch `ws.bufferedAmount > 4 MiB` and abort the
   run with `vessel_error { type: 'BackpressureExceeded' }`. Slow consumers
   should reconnect, not hang the producer.

This is sister to R-M1Aβ-4 on the producer side. Both must hold for end-to-
end memory-safety under hostile-or-flaky peers.

---

## R-M1Aβ-6 — MINOR: `vessel_cancel` validation thin (NOT cross-connection)

**Where:** [index.ts:524-527](../../packages/backend/src/index.ts#L524)
```ts
if (msg.type === "vessel_cancel") {
  vesselRuns.get(msg.runId)?.abort.abort();
  return;
}
```

I checked whether connection A can cancel connection B's run. **It cannot.**
`vesselRuns` is the **per-connection** Map (declared at index.ts:356 inside
`wss.on('connection', ws => { … })`). `msg.runId` foreign to this connection
returns `undefined`, optional-chained, no-op. ✅ Connection-isolated.

**Remaining (minor) hygiene:**
- No type check — `msg.runId` could be `undefined`/non-string (TypeScript-only
  protection). `vesselRuns.get(undefined as never)` is fine but a malformed
  client bug surfaces silently.
- No `vessel_error` echo on unknown runId — debugging is hard if client
  desynced runId state.
- No rate-limit on cancel spam (free 1-line iteration through `vesselRuns`).

**Fix (cheap, not blocking M1A-β):**
```ts
if (msg.type === "vessel_cancel") {
  if (typeof msg.runId !== "string" || msg.runId.length > 64) {
    send({ type: "vessel_error", runId: msg.runId ?? "", error: { type: "BadRequest", message: "invalid runId" }});
    return;
  }
  const handle = vesselRuns.get(msg.runId);
  if (!handle) {
    send({ type: "vessel_error", runId: msg.runId, error: { type: "NotFound", message: "no such run on this connection" }});
    return;
  }
  handle.abort.abort();
  return;
}
```

---

## R-M1Aβ-7 — MINOR: vesselRuns cleanup race on `ws.close`

**Where:** [index.ts:584-598](../../packages/backend/src/index.ts#L584)

```ts
ws.on("close", () => {
  …
  for (const h of vesselRuns.values()) h.abort.abort();
  vesselRuns.clear();
  …
});
```

The async `runIntent` job started at index.ts:548 also has
`vesselRuns.delete(runId)` in its `finally`. After `ws.close` fires:
1. close handler aborts all + clears the Map.
2. runIntent's catch/finally runs ≤ a few seconds later (CC SIGKILL via
   detached process group kill in cli-runner-driver). It calls
   `vesselRuns.delete(runId)` — Map already cleared, no-op.
3. send() is guarded by `ws.readyState === OPEN`, so post-close messages
   drop silently — no ws.send-on-closed-socket exception.

**Verdict:** safe. The race exists but is bounded and harmless.

**Latent concern (M1B+):** if M1B starts pushing `vessel_*` events to a
broadcast room (multiple WS readers per run), the cleanup must move from
per-connection to per-runId at run-registry scope. Track for M1B.

---

## R-M1Aβ-8 — INFO: integration test stderr accumulation

**Where:** [test-vessel-ws-multi.ts:46-48](../../packages/backend/src/test-vessel-ws-multi.ts#L46)
```ts
let lastLogs = '';
backend.stderr?.on('data', (b) => { lastLogs += b.toString('utf-8'); });
backend.stdout?.on('data', (b) => { lastLogs += b.toString('utf-8'); });
```

Test-only — string concat with no cap. For a 10s test that's fine; if M1B
writes a long-running soak/load test on the same pattern it'll OOM the test
runner. Not shipped, not in production. **Non-blocker.**

**Fix (when next touched):** keep only the last 8 KiB:
```ts
backend.stderr?.on('data', (b) => {
  lastLogs = (lastLogs + b.toString('utf-8')).slice(-8192);
});
```

---

## Audited clean (no findings)

- **WS auth gate:** [index.ts:325-329](../../packages/backend/src/index.ts#L325) calls
  `checkWsAuth(req.url, req.headers.authorization)` before `wss.handleUpgrade`.
  Same constant-time comparison + Bearer/?token path as HTTP. ✅
- **vessel_intent text-cap on WS:** index.ts:535 enforces `text.length > 32 * 1024 → 413`.
  ✅ (matches HTTP `MAX_TEXT_CHARS`).
- **CC stream-json redaction:** cli-runner-driver.ts:120 applies `redactPayload`
  before forwarding to `ctx.onMessage`. Same redactor as on-disk stdout.
  Pattern coverage (`.thinking / .text / .content / .input / .file_path / …`)
  is wide and force-masks subtree (M0.5 R-M0.5-2 fix). ✅ for content; size
  cap missing → R-M1Aβ-5.
- **Workspace isolation:** unchanged from M1A-α (cli-runner-driver.ts:62-79
  realpath check). ✅
- **0.0.0.0 token guard:** carried over from M1A-α at index.ts:76-82. ✅
  Applies to WS too (the bind itself).
- **vessel_cancel cross-connection isolation:** verified ✅ (R-M1Aβ-6).

---

## Recommended action

**Before merging M1A-β:**
- R-M1Aβ-1 (process-level concurrent cap shared with HTTP)
- R-M1Aβ-2 (artifact_refs relativization at trace-writer level)
- R-M1Aβ-3 (`vessel_completed` result through `redactAgentResult`)
- R-M1Aβ-4 (`maxPayload` on WS server)

**Bundle into M1A-β if quick, else early M1B:**
- R-M1Aβ-5 (per-frame size cap on stream push + bufferedAmount watchdog)

**Defer to M1B / future:**
- R-M1Aβ-6 (cancel validation hygiene)
- R-M1Aβ-7 (cleanup race) — safe today
- R-M1Aβ-8 (test stderr) — test-only

If R-M1Aβ-1 / -2 / -3 / -4 are fixed, I clear M1A-β for merge on the risk
lens. Without them I recommend the arbiter treat M1A-β as **NOT-YET-PASS**.

---

## Summary (≤ 200 字)

M1A-β WS streaming 重新打开了 M1A-α 关掉的两个隐私 / DoS 口：(1) `vessel_trace.event.artifact_refs`
+ `vessel_completed.result.{files,stdoutPath}` 是绝对 `~/.vessel/...` 路径，HTTP 走
`redactTraceEvent / redactAgentResult` 兜底，WS 路径绕过 → 用户名 + DATA_DIR 布局 leak（违反
trace-redaction-spec §3a §4）。(2) WS `vesselRuns.size >= 5` 是 per-connection cap，HTTP
M1A-α 的 `inflightIntents` 是 process-level；攻击者 N 个 WS 连接 = 5N 个 CC 子进程。另外 WS
server 没设 `maxPayload`（默认 100 MiB），`vessel_intent.text` 32K 检查在 JSON.parse 之后才跑；
`vessel_progress.message` 大输出无 size cap + 无 backpressure 监控 → 慢消费者 OOM。`vessel_cancel`
跨连接已验证不能污染（per-connection map）；runIntent abort race 在 ws.close 后无害（send 有
readyState 守护）。建议合并前修 4 BLOCKER（process cap / artifact_refs 相对化 /
redactAgentResult on WS / maxPayload）。

— vessel-risk-officer, 2026-05-10 03:20
