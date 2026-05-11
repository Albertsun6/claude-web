# M1C-A Workflow Engine — Closeout Review (vessel-pragmatist lens)
Date: 2026-05-10-1900

## Findings

### PASS: Eva reuse — no unnecessary reimplementation
executor.ts reuses `runIntent()` from orchestrator.ts directly. No new abstraction layer.
workflow-store.ts is thin SQLite CRUD. Correct.

### PASS: YAGNI respected
- No pooling, no message queue, no distributed state.
- HITL options default to ['approve','reject'] — sensible fallback, not over-specified.
- CLI `workflow resume` calls HTTP (requires server running) — no embedded re-run logic duplication.
- MAX_STEPS=20, MAX_TEXT_CHARS=8000 — reasonable limits without over-engineering.

### MINOR-1: makeBroadcastAware in vessel-workflow.ts is a no-op
```typescript
function makeBroadcastAware(broadcast: BroadcastFn): BroadcastFn {
  return broadcast;
}
```
This function is defined but never called. Dead code. Remove it.
**Verdict**: MINOR — cosmetic, remove in next pass.

### MINOR-2: workflow list in CLI opens+closes DB per call
`cmdWorkflowList` calls `openMemoryDb()` then `closeMemoryDb()`. For a CLI command 
that's fine — but it's inconsistent with `cmdWorkflowResume` which doesn't touch the DB 
at all (calls HTTP). Both are acceptable patterns for personal single-machine use.

### INFO: test-workflow.ts uses in-process DB isolation
Tests share the same memory.db as other test suites — this could produce ordering
dependencies between test runs. For M1C-A scope this is acceptable. Consider test DB 
isolation in M1C-B when test suite grows.

## Verdict: PASS with 1 MINOR finding (dead code in vessel-workflow.ts)
