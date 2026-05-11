# M1C-A Workflow Engine — Closeout Review (vessel-architect lens)
Date: 2026-05-10-1900

## Scope
M1C-A: Workflow Engine + HITL persistence. Files reviewed:
- packages/backend/src/memory/workflow-store.ts
- packages/backend/src/migrations-memory/0003_m1c_workflows.sql
- packages/backend/src/workflow/executor.ts
- packages/backend/src/routes/vessel-workflow.ts
- packages/backend/src/routes/vessel-panel.ts (HITL UI section)
- packages/backend/src/cli/vessel-core.ts (workflow subcommands)
- packages/shared/src/protocol.ts (vessel_workflow_* messages)
- packages/backend/src/index.ts (broadcastToAll injection, markInterruptedOnStartup)
- packages/backend/src/test-workflow.ts (22 assertions)

## Findings

### MINOR-1: workflow_state lives in memory.db — clear in docs but not enforced
memory.db is Vessel-owned state; harness.db is Eva-domain. The split is correct. But 
EVA_TO_VESSEL_MAPPING.md should note `workflow_state` → memory.db so future maintainers 
don't accidentally migrate it to harness.db.
**Verdict**: MINOR — update mapping doc when doing docs pass.

### MINOR-2: executor has no step-level timeout
A 'coding' step that hangs (e.g. CC CLI stalls mid-run) will hold the workflow in 'running'
state indefinitely. The abortSignal plumbing is there (threaded through to runIntent), but
the HTTP /resume endpoint doesn't pass an AbortSignal at all — the fire-and-forget void 
call means there's no cancellation path from the HTTP side.
**Verdict**: MINOR for M1C-A (acceptable for personal single-machine use where operator 
controls process). M1C-B risk: add per-step timeout or expose /cancel → abortSignal.

### INFO: context_json re-read on every step
In executor.ts the wf object is fetched once at the top but context_json is re-read 
from `wf.context_json` (the cached copy), not fresh from DB. This is fine because 
executor is single-threaded (fire-and-forget, one workflow at a time on the server process), 
but worth noting if concurrency ever comes.

## Architecture Assessment: PASS
- Clean separation: store / executor / routes / CLI — each layer single-responsibility.
- broadcastToAll injection (not global import) is correct per B-级 review M-2.
- interrupted-on-startup semantics are conservative and correct: re-run current_step if interrupted.
- Protocol messages are typed in shared/protocol.ts — no loose `any`.
- 22/22 workflow tests pass; 0 TypeScript errors.

## Verdict: PASS with 1 MINOR finding
