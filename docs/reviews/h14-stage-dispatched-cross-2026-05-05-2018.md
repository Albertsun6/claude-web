# Cross Review — H14 Stage `dispatched`

**Reviewer**: reviewer-cross  
**Model**: GPT-5.5  
**Date**: 2026-05-05 20:18  
**Files reviewed**:
- `packages/backend/src/migrations/0002_stage_status_dispatched.sql`
- `packages/shared/src/harness-protocol.ts`
- `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift`
- `packages/backend/src/scheduler.ts`
- `packages/backend/src/harness-store.ts`
- `packages/shared/fixtures/harness/stage-dispatched.json`
- `packages/shared/src/__tests__/harness-protocol.test.ts`

---

## Summary

- Blockers: 0
- Majors: 1
- Minors: 4
- Verdict: small fix recommended before merge. The DB / TS / Swift enum value itself is aligned, but the new middle state is not clearly surfaced through the existing harness event contract.

## Numeric Score

| Lens | Score (0..5) |
|---|---:|
| Correctness | 4.1 |
| Cross-end alignment | 3.4 |
| Irreversibility | 4.0 |
| Security | 4.5 |
| Simplification | 4.0 |

**Overall score**: 4.0

## Findings

### M1 [MAJOR] Persisted status transitions are not emitted through the canonical `stage_changed` event

**Where**: `packages/backend/src/scheduler.ts:117`, `packages/backend/src/scheduler.ts:227`, `packages/shared/src/harness-protocol.ts:359`  
**Lens**: Cross-end alignment / Correctness  
**Issue**: H14 writes `dispatched` and later `running` with `setStageStatus`, but the scheduler broadcasts `stage_started`, `stage_failed`, `stage_message`, and `stage_done` payload events instead of the protocol-defined `stage_changed` event with `status: StageStatusSchema`.  
**Why this matters**: The new middle state is audit-useful in SQLite, but TS / iOS clients that consume the shared event contract cannot observe `dispatched` or the `dispatched -> running` transition from the protocol shown in these artifacts.  
**Suggested fix**: After each H14 status write, emit `kind: "stage_changed", stageId, status` matching `HarnessEventSchema`; or explicitly add and test the scheduler's current event kinds in the shared protocol if those are the intended wire contract.

### m1 [MINOR] Protocol version stays at `1.0` after adding a wire enum value

**Where**: `packages/shared/src/harness-protocol.ts:42`, `packages/shared/src/harness-protocol.ts:55`, `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift:18`, `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift:35`  
**Lens**: Cross-end alignment / Irreversibility  
**Issue**: `dispatched` is a new serialized enum value, but both TS and Swift still advertise protocol/client version `1.0`.  
**Why this matters**: A mixed old-client/new-server run can fail Swift enum decoding on `dispatched`; even in first-wave personal use, the version constants stop reflecting the wire contract's actual shape.  
**Suggested fix**: Bump the harness protocol minor version for this enum expansion, or document that M2 pre-release enum additions intentionally do not change `HARNESS_PROTOCOL_VERSION`.

### m2 [MINOR] Active-state indexing still only names and covers `running`

**Where**: `packages/backend/src/migrations/0002_stage_status_dispatched.sql:71`, `packages/backend/src/scheduler.ts:38`  
**Lens**: Correctness / Simplification  
**Issue**: Scheduler semantics now treat `dispatched` as active, but the rebuilt partial index remains `idx_stage_running ON stage(status) WHERE status = 'running'`.  
**Why this matters**: The index is not wrong for `running` queries, but it no longer matches the active-state concept introduced by H14 and can mislead later query authors.  
**Suggested fix**: Either keep it with a comment that it is intentionally only for CLI-running stages, or add/rename an active-stage index covering `dispatched`, `running`, and `awaiting_review`.

### m3 [MINOR] Swift coverage for the new enum value is still manual-only in these artifacts

**Where**: `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift:11`, `packages/shared/src/__tests__/harness-protocol.test.ts:74`, `packages/shared/fixtures/harness/stage-dispatched.json:5`  
**Lens**: Cross-end alignment  
**Issue**: The new fixture proves TS Zod parses `status: "dispatched"`, but there is no artifact here that automatically proves Swift decodes and re-encodes the same fixture.  
**Why this matters**: The patch changes a Swift `Codable` enum, so cross-end confidence depends on a path that these files still describe as manual.  
**Suggested fix**: Add a Swift fixture decode/encode test for `stage-dispatched.json`, or note that this is intentionally outside H14's verification gate.

### m4 [MINOR] Setup-window failures still have two different task identifiers

**Where**: `packages/backend/src/scheduler.ts:120`, `packages/backend/src/scheduler.ts:201`, `packages/backend/src/scheduler.ts:210`  
**Lens**: Correctness / Simplification  
**Issue**: `tick()` returns and broadcasts the synthetic task id `${issue.id}/${stage.id}`, while the persisted task row uses a later UUID. During the new `dispatched` setup window, failures before or around `createTask` are easier to identify by stage than by task.  
**Why this matters**: H14's goal is audit-distinguishable setup failure points; dual task IDs make operator correlation slightly noisier exactly in that setup window.  
**Suggested fix**: Include the real task UUID in setup-related broadcasts/return values once reserved, or document that pre-spawn troubleshooting should key on `stageId`, not `taskId`.

## False-Positive Watch

- F? M1 assumes clients rely on `HarnessEventSchema` for status updates. If the intended H14 UX is DB polling only, M1 drops to minor documentation/test alignment.
- F? m2 assumes future queries will use active-state lookups. If `idx_stage_running` is deliberately only for "CLI process has started", keep it and add a clarifying comment.

## What I Did Not Look At

- Did not run the migration or tests; this is static review only.
- Did not read `0001_initial.sql`, `harness-queries.ts`, route handlers, UI code, or any transcript.
- Did not inspect persisted audit log behavior outside the listed files.
- Did not read `LEARNINGS.md` because this review was explicitly constrained to the listed artifact files.
