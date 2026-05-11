# Cross Review — M1A-alpha panel-first implementation

**Reviewer**: vessel-cross-reviewer  
**Model**: gpt-5.5-medium (via Cursor)  
**Date**: 2026-05-10 02:40  
**Files reviewed**:
- `packages/backend/src/routes/vessel-intent.ts`
- `packages/backend/src/routes/vessel-panel.ts`
- `packages/backend/src/cli/vessel-core.ts`
- `packages/backend/src/memory/session-store.ts`
- `packages/backend/src/index.ts`
- `packages/backend/src/test-vessel-http-concurrent.ts`
- `packages/backend/src/orchestrator.ts`
- `packages/backend/src/observability/trace.ts`
- `packages/backend/src/migrations-memory/0001_m0_sessions.sql`
- `docs/reviews/M1A-slicing-proposal-2026-05-10-0210.md`
- `docs/reviews/M1A-slicing-arbiter-2026-05-10-0210.md`
- `~/.claude/skills/debate-review/log.jsonl` last 3 entries

---

## Summary

- Blockers: 0
- Majors: 2
- Minors: 1
- Lens 5 findings: 1
- Overall verdict: **PASS-WITH-FIXES**. The panel-first slice is structurally sound: `/vessel/min/` is mounted before the SPA fallback, ESM `.js` imports are consistent, `busy_timeout=5000` is present, and panel XSS is not reproduced. Fix the two HTTP input-boundary issues before closeout.

## Numeric Score

| Lens | Score (0..5) |
|---|---:|
| Correctness | 4.0 |
| Cross-end alignment | 4.2 |
| Eva refactor + Vessel hard constraints | 4.6 |
| Security + 4 hard triggers | 3.7 |
| Collective blindspot detection | 4.0 |

**Overall**: 4.1

## 5 Requested Questions

1. **panel HTML XSS** — PASS. `runs` table uses `innerHTML`, but all user-controlled cells/attributes pass through `esc()` before concatenation (`intent_text`, `status`, `skill_id`, `trace_id`, `run_id`, `started_at`). Trace view uses `textContent`, not `innerHTML`, and it does not render `trace.payload` at all. Intent result status also uses `textContent`, so `artifact.text` / `JSON.stringify(r)` are not HTML-interpreted.
2. **route order** — PASS. `app.get("/vessel/min", ...)` and `app.get("/vessel/min/", ...)` are registered at `packages/backend/src/index.ts:117-118`, before the SPA fallback `app.use("/*", ...)` at `packages/backend/src/index.ts:206`.
3. **`/api/vessel/intent` body limit** — FAIL. This app configures no `bodyLimit` middleware and no local `Content-Length` / text-length guard before `c.req.json()` at `packages/backend/src/routes/vessel-intent.ts:41`. I did not find a code-level default cap to rely on.
4. **trace replay `parent_span_id` null** — PASS for the schema path. `TraceEventSchema` requires `parent_span_id: string | null`; CLI uses `?? null`, panel uses `|| null`, so real `null` roots work. Malformed old files with missing `parent_span_id` also become roots in both. Only invalid `""` diverges: panel treats it as root, CLI treats it as a parent key.
5. **Claude most likely missed** — input-boundary asymmetry. The repeated blind spot pattern is side effects across boundaries: previous misses were module entry invocation, glob boundary, redaction subtree, and cross-runner DB locking. Here the same shape appears in "looks bounded in UI/CLI, but HTTP query/body bypasses that bound".

## Findings

### M1 [MAJOR] `/api/vessel/intent` has no request-size or text-length bound before parsing and execution

**Where**: `packages/backend/src/routes/vessel-intent.ts:38-53`  
**Lens**: 4

**Issue**: The handler calls `await c.req.json()` and then accepts any non-empty string as `text`. There is no configured Hono body-size middleware in `packages/backend/src/index.ts`, no `Content-Length` check, and no maximum prompt length before the value is stored in SQLite and passed to `runIntent()`.

**Why this matters**: `CLAUDE_WEB_TOKEN` / `VESSEL_TOKEN` is optional in this codebase. If the backend is exposed during dogfood, a very large JSON body can consume memory during parse, grow `memory.db`, and potentially spawn a coding run with an oversized prompt. This is a DoS boundary, not an M1A feature request.

**Suggested fix**: Add a small M1A-local limit, either via Hono `bodyLimit` on `/api/vessel/intent` or an explicit `Content-Length` + `body.text.length` cap. Return `413` for body too large and `400` for text too long. Keep the cap conservative for alpha, for example 64 KiB body / 16 KiB text.

### M2 [MAJOR] HTTP `limit` accepts negative numbers, and SQLite `LIMIT -1` removes the cap

**Where**: `packages/backend/src/routes/vessel-intent.ts:58`, `packages/backend/src/routes/vessel-intent.ts:67`  
**Lens**: 1

**Issue**: `Math.min(100, parseInt(query) || 20)` clamps only the upper bound. `?limit=-1` becomes `-1`, and SQLite treats `LIMIT -1` as no limit. So `/api/vessel/sessions?limit=-1` and `/api/vessel/runs?limit=-1` can return all rows.

**Why this matters**: This bypasses the intended M1A alpha "recent rows only" surface and can become slow or leak more local history than the minimal panel needs. The CLI path got this right with `Math.max(1, ...)`; the HTTP path did not.

**Suggested fix**: Mirror the CLI clamp: parse as integer, require finite positive value, then clamp `1..100`. Add a route-level test for `limit=-1` returning at most the default or a 400.

### m1 [MINOR] Runtime `skill` and `sessionId` validation is weaker than the TypeScript annotation

**Where**: `packages/backend/src/routes/vessel-intent.ts:38-53`, `packages/backend/src/orchestrator.ts:56-58`  
**Lens**: 1

**Issue**: The route type says `skill?: 'echo' | 'coding'`, but JSON input is untrusted. A body like `{ "text": "x", "skill": "bogus" }` is accepted and silently falls through to coding in `resolveSkill()`. `sessionId` is also accepted as any JSON value/string length and passed into `bootSession()`.

**Suggested fix**: Validate the parsed body at runtime: `skill === undefined || skill === "echo" || skill === "coding"`, `sessionId` optional string with a sane length/charset, and reject unknown keys only if you want stricter API hygiene.

## False-Positive Watch

- The XSS concern is likely a false positive for the current implementation because trace payload is never inserted into DOM, and all trace lines are assigned through `textContent`. This should be rechecked if the panel later adds "raw payload JSON" with `innerHTML` syntax highlighting.
- `parent_span_id: ""` divergence is not a schema-valid case. I am not upgrading it beyond minor unless old trace files can actually contain empty strings.

## Positive Observations

- `/api/vessel/*` is correctly mounted behind existing `/api/*` auth middleware and before static fallback.
- `/vessel/min` and `/vessel/min/` are both covered, so trailing slash does not fall through to the Eva SPA.
- ESM local imports in the reviewed files consistently include `.js`.
- `busy_timeout = 5000` is set immediately after WAL/foreign keys, and the integration test exercises a real backend process plus CLI subprocess against the same `VESSEL_DATA_DIR`.

## What I Did Not Look At

- Did not run the test suite; this verdict is static-read only.
- Did not review Swift/iOS integration because M1A-alpha intentionally stops at HTTP + minimal panel.
- Did not audit all existing non-Vessel routes that also call `c.req.json()` without body limits; this finding is scoped to the new `/api/vessel/intent` surface.
