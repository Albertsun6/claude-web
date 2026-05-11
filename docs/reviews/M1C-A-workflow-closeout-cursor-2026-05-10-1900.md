# M1C-A Workflow Engine — Closeout Review (cursor cross-review lens)
Date: 2026-05-10-1900

## Cross-cutting concerns

### PASS: B-级 review findings were addressed
- B-级 M-1 (cursor): interrupted-on-startup semantics ✅ implemented — `markInterruptedOnStartup()` in session-store.ts + called at startup in index.ts
- B-级 M-2 (cursor): broadcastToAll injected not globally imported ✅ — `buildWorkflowRouter(broadcast)` + `runWorkflowFromStep(..., broadcast)` — both receive it as parameter
- B-级 M-3 (architect): protocol messages typed in shared ✅ — 5 vessel_workflow_* messages added to ServerMessage union in protocol.ts

### PASS: DB migration is independent
0003_m1c_workflows.sql runs in memory.db MIGRATIONS array (not harness.db). version 3 is correct. 
test-lessons.ts updated to expect version 3. ✅

### PASS: CLI workflow commands consistent with existing pattern
`cmdWorkflowList` / `cmdWorkflowResume` follow same pattern as `cmdLessonAdd` / `cmdLessonSearch`.
HELP string updated with examples. ✅

### MINOR-1: vessel-panel.ts HITL polling is every 5 seconds (frontend concern)
The panel polls `refreshWorkflows()` every 5s. This is fine for personal use but not 
reactive — a HITL pause that resolves immediately still waits up to 5s for panel update.
The WS `vessel_workflow_paused` message does trigger `showHitlPanel()` immediately, so 
the critical path is covered. The 5s polling is a backup/initial-load mechanism.
**Verdict**: MINOR — acceptable.

### PASS: Test coverage is meaningful
22 assertions covering: create, list, filter, markInterrupted, HITL pause, resume-to-complete,
cancel, abort signal, updateWorkflow merge. Edge cases covered. No mock-only tests — all 
use real SQLite via `openMemoryDb()`.

### Finding matrix summary
| ID | Severity | Finding | Owner |
|---|---|---|---|
| MINOR-arch-1 | MINOR | Add workflow_state to EVA_TO_VESSEL_MAPPING.md | docs pass |
| MINOR-arch-2 | MINOR | Per-step timeout / HTTP cancel → AbortSignal | M1C-B |
| MINOR-prag-1 | MINOR | Remove dead `makeBroadcastAware` function | next cleanup |
| MINOR-risk-1 | MINOR | Document auth req for workflow routes when exposed | ops guide |
| MINOR-cursor-1 | MINOR | Panel polling 5s for HITL — WS path is reactive | acceptable |

## Verdict: PASS — 5 MINOR findings, 0 MAJOR, 0 BLOCKER
All findings accepted as deferred; M1C-A acceptance criteria fully met.
