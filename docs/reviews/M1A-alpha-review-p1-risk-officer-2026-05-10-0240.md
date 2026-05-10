# M1A-α — Phase 1 Risk Officer Review

**Reviewer:** vessel-risk-officer (Phase 1)
**Lens:** secrets / attack surface / data exposure / DoS (ADR-014 #5 + #6)
**Subject:** M1A-α HTTP exposure of vessel-core (`/api/vessel/*` + `/vessel/min/` panel + CLI list/trace)
**Files inspected:**
- [packages/backend/src/routes/vessel-intent.ts](../../packages/backend/src/routes/vessel-intent.ts)
- [packages/backend/src/routes/vessel-panel.ts](../../packages/backend/src/routes/vessel-panel.ts)
- [packages/backend/src/index.ts](../../packages/backend/src/index.ts) §lines 64–119
- [packages/backend/src/auth.ts](../../packages/backend/src/auth.ts)
- [packages/backend/src/observability/trace-writer.ts](../../packages/backend/src/observability/trace-writer.ts)
- [packages/backend/src/observability/trace-redactor.ts](../../packages/backend/src/observability/trace-redactor.ts)
- [packages/backend/src/orchestrator.ts](../../packages/backend/src/orchestrator.ts)
- [packages/backend/src/drivers/cli-runner-driver.ts](../../packages/backend/src/drivers/cli-runner-driver.ts)
- [packages/backend/src/skills/coding.ts](../../packages/backend/src/skills/coding.ts)
- [packages/backend/src/cli/vessel-core.ts](../../packages/backend/src/cli/vessel-core.ts)

---

## TL;DR

| ID | Severity | Topic | One-liner |
|---|---|---|---|
| R-M1Aα-1 | **BLOCKER** | DoS / no body-size cap | `POST /api/vessel/intent` accepts arbitrary body and spawns Claude CLI per call. Trivial fork/RAM bomb. |
| R-M1Aα-2 | **MAJOR** | Information disclosure | `artifact_refs` and `AgentResult.artifact.{stdoutPath,files}` return absolute fs paths under `/Users/<name>/.vessel/...` — bypass redactor (top-level fields, not `payload`). |
| R-M1Aα-3 | **MAJOR** | Implicit allow-no-auth | Empty `VESSEL_TOKEN` on a 0.0.0.0 / Tailscale-exposed backend silently opens `/api/vessel/intent` to anyone (vessel-core spawns CC → arbitrary code execution under user's CC subscription). One-time `console.warn` is the only signal. |
| R-M1Aα-4 | MINOR | Panel HTML reachable unauth | `/vessel/min/` is NOT under `/api/*`, so it bypasses `authMiddleware`. HTML body has no secrets, but its existence advertises the surface. |
| R-M1Aα-5 | MINOR | trace endpoint span-count DoS | `GET /api/vessel/traces/:id` reads every `*.json` in dir, `JSON.parse` each synchronously. Attacker who can write spans (M1B+) could OOM the response. M1A-α: low because writer is internal. |
| R-M1Aα-6 | MINOR | SQLITE_BUSY DoS amplification | `busy_timeout=5000` means concurrent writers can stall each other up to 5s. CLI vs HTTP races: each `intent` does ≥3 INSERTs. Practical impact bounded by R-M1Aα-1 anyway. |
| R-M1Aα-7 | INFO | XSS / SQLi audited clean | `esc()` covers all user-rendered fields; trace pre uses `textContent`. SQL is fully prepared. Traversal blocked by `^[0-9a-f]{32}$/i`. |

---

## R-M1Aα-1 — BLOCKER: no body-size cap on `/api/vessel/intent` + every call spawns Claude CLI

**Where:** [vessel-intent.ts:38-55](../../packages/backend/src/routes/vessel-intent.ts#L38) — `await c.req.json()` with no size guard, then unconditional `runIntent({ text, … })` which (default skill = coding) spawns a fresh Claude CLI subprocess.

**Attack surface:**

1. **Body-size flood.** Hono's `c.req.json()` buffers the entire request body. There is **no `bodyLimit` middleware** anywhere in `index.ts` (grepped). An authenticated client (or unauth if VESSEL_TOKEN unset) can `POST /api/vessel/intent` with a 100 MiB body. `JSON.parse` will eventually throw, but the read buffer is already in memory.
2. **CLI fork bomb.** Each successful POST spawns a Claude CLI subprocess via `ClaudeCodeDriver.submit`. CC processes routinely hold 50–200 MiB RSS each. 50 concurrent POSTs → mac mini OOM kill. Worse: `bypassPermissions` is the default ([cli-runner-driver.ts:112](../../packages/backend/src/drivers/cli-runner-driver.ts#L112)), so the spawned CC has full FS write inside `~/.vessel/workspace/<runId>/`. An attacker with the token who triggers 1000 POSTs essentially exhausts disk + CPU + the user's CC rate limit.
3. **No prompt-length cap.** Even a single 50 MB prompt becomes the CC subprocess's stdin → CC stalls or rejects, but the upstream backend has already paid the cost.

**Why BLOCKER not MAJOR:** M1A-α is the *first* time vessel-core touches a network. The doc says "M1B will add auth"; until then the actual gate is `VESSEL_TOKEN`, which is **optional with a one-time warning** and the user is encouraged in CLAUDE.md to expose backend over Tailscale. A user who reads "M1A-α HTTP server" and hits `tailscale serve` without setting `VESSEL_TOKEN` (very plausible — they did this for Eva) gets a remote-code-execution surface, not just a chatbot.

**Fix (M1A-α, not M1B):**
- Add `bodyLimit({ maxSize: 64 * 1024 })` Hono middleware in front of `/api/vessel/*`. 64 KiB is generous for an intent.
- Reject `body.text.length > 32_000` in `vessel-intent.ts` POST handler with `413`.
- Add a per-token rate limit (e.g. 5 concurrent intents). Even a tiny in-process semaphore is enough; the M1A-α cost is one `Set<runId>` and a `429` early-exit.
- Optional: refuse to start backend if `VESSEL_TOKEN` is empty AND `BACKEND_HOST !== '127.0.0.1'`. (Eva today only warns. M1A-α flips the surface to "can spawn CC" — the bar is higher.)

---

## R-M1Aα-2 — MAJOR: trace + AgentResult leak absolute filesystem paths

The trace redactor only walks `event.payload`, but **`artifact_refs` is a sibling top-level field** that gets the spillover absolute path written verbatim:

[trace-writer.ts:47-62](../../packages/backend/src/observability/trace-writer.ts#L47):
```ts
let redactedPayload = redactPayload(event.payload) as TraceEvent['payload'];
let artifactRefs = event.artifact_refs ? [...event.artifact_refs] : undefined;
…
const spillFile = join(dir, `${event.span_id}.stdout`);   // /Users/yongqian/.vessel/traces/<id>/<span>.stdout
…
artifactRefs = [...(artifactRefs ?? []), spillFile];       // unredacted
```

`/Users/yongqian/.vessel/...` is **not in `PATH_WHITELIST`** ([trace-redactor.ts:56-61](../../packages/backend/src/observability/trace-redactor.ts#L56)) — but the redactor never sees the field anyway. So `GET /api/vessel/traces/:id` returns events whose `artifact_refs[]` exposes:
- The user's **home directory username**.
- The **layout of the Vessel data dir** (`.vessel/traces/<trace>/<span>.stdout`).
- The mapping between trace_id, span_id, and on-disk stdout file (which has 0600 perms but its existence tells the attacker the schema).

**Same problem in HTTP response of POST `/api/vessel/intent`.** The `AgentResult.artifact` for a coding skill ([coding.ts:54-63](../../packages/backend/src/skills/coding.ts#L54)) carries:
- `files: string[]` — absolute paths from `walk(wsReal)` ([cli-runner-driver.ts:151-155](../../packages/backend/src/drivers/cli-runner-driver.ts#L151)). These start with `/Users/yongqian/.vessel/workspace/<runId>/...`.
- `stdoutPath?: string` — same `~/.vessel/traces/...` absolute path.

Both are returned **unredacted** in the JSON response of `/api/vessel/intent` (vessel-intent.ts:54 just `c.json(result)`).

**Fix:**
1. Apply `redactPayload`-equivalent (or at minimum the absolute-path pattern) to `event.artifact_refs` strings in `trace-writer.ts`. Or simpler: store `artifact_refs` as **trace-relative** paths (`<span_id>.stdout`) and have the read endpoint join them on demand.
2. In coding skill / driver: convert `files` and `stdoutPath` to **workspace-relative** paths before returning to caller. The caller (HTTP / CLI) doesn't need the absolute path; if they need to read the spillover file they can call a future `/api/vessel/traces/:id/spill/:spanId` endpoint that resolves relative→absolute server-side.
3. Add `/Users/yongqian/.vessel/` to `PATH_WHITELIST` only if (1) is rejected as too much churn — but that just hides the leak, doesn't fix it (you still leak the username via the prefix match).

**Severity rationale:** MAJOR not BLOCKER because (a) auth gate currently in place when user sets the token, (b) the leaked info is bounded (`/Users/<name>/.vessel/<known-layout>`), no actual file content. But it directly breaks ADR-014 #5 ("hard trigger: secrets / fs paths off the box") and trace-redaction-spec §3a §4. If/when M1B publishes traces over WS broadcast or M2 ships any "send your trace to a reviewer", this becomes a BLOCKER retroactively.

---

## R-M1Aα-3 — MAJOR: optional `VESSEL_TOKEN` + no-auth fail-open in M1A-α

[auth.ts:84-93](../../packages/backend/src/auth.ts#L84):
```ts
if (!isAuthEnabled()) {
  if (!warnedToken) console.warn(...one-time...);
  return true;   // allow
}
```

This is fine for Eva's chat surface (the worst case is "someone reads your CC chat"). For M1A-α the worst case is "someone POSTs intent → spawns Claude CLI → gets the user's subscription to write code into `~/.vessel/workspace/<runId>/`" — which is a remote code execution surface (the CC subprocess itself can call shell tools per the `bypassPermissions` mode default).

The CLAUDE.md README explicitly walks the user through `tailscale serve --bg --https=443 http://localhost:3030`. A user who sets that up before exporting `VESSEL_TOKEN` (very plausible — token isn't required to install) is one DNS lookup away from giving Tailnet members CC-RCE on their box.

**Fix:** for M1A-α, **fail-closed** instead of fail-open on the `/api/vessel/*` namespace specifically:

```ts
// vessel-intent.ts router
import { isAuthEnabled } from '../auth.js';
vesselRouter.use('*', (c, next) => {
  if (!isAuthEnabled() && c.req.url.includes('/api/vessel/')) {
    // M1A-α: vessel routes spawn CC subprocess; refuse open access even on localhost binds.
    if (process.env.BACKEND_HOST && process.env.BACKEND_HOST !== '127.0.0.1') {
      return c.json({ error: 'VESSEL_TOKEN required for /api/vessel/* on non-localhost bind' }, 503);
    }
  }
  return next();
});
```

Or more conservatively: add a `VESSEL_REQUIRE_TOKEN_FOR_CORE=1` env var that the launchd plist sets, defaulting OFF only for `pnpm dev:backend`.

---

## R-M1Aα-4 — MINOR: `/vessel/min/` panel served unauthenticated

[index.ts:117-118](../../packages/backend/src/index.ts#L117):
```ts
app.get("/vessel/min", vesselPanelHandler() as never);
app.get("/vessel/min/", vesselPanelHandler() as never);
```

Auth middleware at index.ts:97 is `app.use("/api/*", ...)`. `/vessel/min` doesn't match → unauthenticated.

**Impact:** the HTML body itself contains zero secrets. But:
- It tells an unauth scanner that `/api/vessel/intent`, `/api/vessel/runs`, `/api/vessel/traces/:id` exist (the fetch calls in the script). Reduces enumeration cost.
- If/when the panel ever embeds a CSRF token or a session id, this changes to MAJOR.

**Fix (cheap):** mount the panel under `/api/vessel/panel` (or move the route registration to *after* the `/api/*` use is rewritten to also cover `/vessel/*`). Either keeps the panel behind the same token gate as the API it talks to. (And keeps the `/vessel/min` URL stable for M1A-β by adding it to the auth allowlist.)

---

## R-M1Aα-5 — MINOR: trace endpoint reads & JSON-parses every span sync

[vessel-intent.ts:92-95](../../packages/backend/src/routes/vessel-intent.ts#L92):
```ts
const events: TraceEvent[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TraceEvent)
  .sort(...);
```

If a trace dir somehow ends up with thousands of spans (M1B once we have nested workflows + MCP), this blocks the event loop and OOMs on a single GET. Sync `readFileSync` + `JSON.parse` × N.

**M1A-α impact:** low — current orchestrator writes 2 spans per intent. But this is the kind of code that survives 6 milestones unmodified.

**Fix:** stream-friendly version is overkill for now. Just add a hard cap: if `readdirSync(dir).length > 200`, return `{error: 'trace too large; use cli replay'}`. Ten lines.

---

## R-M1Aα-6 — MINOR: SQLITE_BUSY DoS amplification

`busy_timeout = 5000` ([session-store.ts:45](../../packages/backend/src/memory/session-store.ts#L45)) means a stalled writer can block other writers for up to 5s before SQLITE_BUSY fires. Each HTTP intent does:
- `INSERT INTO sessions` (idempotent)
- `INSERT INTO intents`
- `INSERT INTO skill_invocations`

An attacker spamming intents holds write locks for up to 5s/req. CLI users (`vessel-core list`) on the same machine see hangs. **Not really an attack vector on its own** — bounded by R-M1Aα-1 because spawning CC is way more expensive than the SQLite write. But once R-M1Aα-1 is fixed (rate-limited), this becomes the bottleneck.

**Fix:** none needed for M1A-α. Keep an eye on it post-rate-limit — if writes block tail latency under normal traffic, reduce `busy_timeout` to 1500ms and surface SQLITE_BUSY as 503.

---

## R-M1Aα-7 — INFO: XSS / SQLi / traversal audited clean

For the record:
- **XSS:** all user-controlled fields rendered via `esc()` ([vessel-panel.ts:64](../../packages/backend/src/routes/vessel-panel.ts#L64)) or `el.textContent =` ([vessel-panel.ts:111](../../packages/backend/src/routes/vessel-panel.ts#L111)). `intent_text`, `r.status`, `r.skill_id`, `r.trace_id` all wrapped. Post-result status (`status.textContent = ...`) uses `textContent`. Trace dump is `el.textContent`. No `innerHTML` with user data. AgentResult.artifact.text is rendered via `status.textContent` — safe.
- **SQL injection:** all queries use `?` placeholders ([vessel-intent.ts:62, 79, 84-91](../../packages/backend/src/routes/vessel-intent.ts#L62), [vessel-core.ts:86-92](../../packages/backend/src/cli/vessel-core.ts#L86)). `limit` is `Math.min(100, parseInt(...) || 20)` — clamped + integer-coerced before prepare. Even if it leaked to the SQL string, parseInt strips non-digits. Clean.
- **Path traversal on `/api/vessel/traces/:id`:** `^[0-9a-f]{32}$/i` regex enforced before `join(DATA_DIR, 'traces', traceId)`. `..`, `/`, `.` all rejected. `encodeURIComponent` on the panel side (vessel-panel.ts:89). Hono `:traceId` route doesn't match `/`. Three layers; clean.

Also clean:
- Workspace isolation in CodingDriver does `realpathSync` check + `expected = join(workspaceRoot, runId)` mismatch throw ([cli-runner-driver.ts:62-79](../../packages/backend/src/drivers/cli-runner-driver.ts#L62)). symlink escape blocked.
- `runId` in workspace path is `crypto.randomUUID()` from orchestrator, not user-supplied.

---

## Recommended action

1. **Before merging M1A-α to dev:** fix R-M1Aα-1 (body cap + rate limit) and R-M1Aα-2 (artifact path redaction). These are not "M1B will handle it" — they regress trace-redaction-spec §3a §4 and add a new RCE-shaped DoS vector that didn't exist when vessel-core was a CLI-only tool.
2. **Bundle into M1B (not blocking M1A-α merge but tracked):** R-M1Aα-3 (fail-closed for `/api/vessel/*` when token unset on non-localhost binds) and R-M1Aα-4 (panel under auth).
3. **Defer to M2:** R-M1Aα-5, R-M1Aα-6.

If R-M1Aα-1 + R-M1Aα-2 are fixed, I can re-review and clear M1A-α for merge. Without them I recommend the arbiter treat M1A-α as **NOT-YET-PASS** on the risk lens.

— vessel-risk-officer, 2026-05-10 02:40
