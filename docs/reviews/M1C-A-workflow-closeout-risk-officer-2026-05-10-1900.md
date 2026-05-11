# M1C-A Workflow Engine — Closeout Review (vessel-risk-officer lens)
Date: 2026-05-10-1900

## Findings

### PASS: No SQL injection vectors
All SQL uses prepared statements with named parameters. The step JSON is parsed via 
`JSON.parse(wf.steps_json)` on DB read — validated at write time in the HTTP route.

### PASS: Input validation in vessel-workflow.ts
- MAX_STEPS=20 enforced
- MAX_TEXT_CHARS=8000 enforced  
- Unknown step kinds return 400
- Null/undefined body handled (try/catch around `c.req.json()`)
- Status transitions validated (can't resume a completed workflow → 409)

### MINOR-1: No auth on /api/vessel/workflows routes
The workflow CRUD routes are mounted without bearer-token check. In Eva, `CLAUDE_WEB_TOKEN` 
guards only some routes via the auth middleware. For personal single-machine (localhost-only 
binding), this is acceptable. But if `BACKEND_HOST=0.0.0.0` (Tailscale exposure), any 
network peer can create/cancel workflows.
**Risk**: Low for personal use; Medium if exposed via Tailscale without token.
**Mitigation**: Same as other vessel routes — set `CLAUDE_WEB_TOKEN` and ensure auth 
middleware wraps vessel routes. Document in ops guide.
**Verdict**: MINOR — acceptable for M1C-A scope.

### PASS: interrupted-on-startup is safe
`markInterruptedOnStartup()` runs `UPDATE SET status='interrupted' WHERE status='running'` 
at server start. This is safe: interrupted workflows can be inspected or re-run. No data loss.

### PASS: Broadcast is fire-and-forget — safe for WS disconnect
If a WS client disconnects mid-workflow, `broadcastToAll` silently skips them 
(WS write to closed socket is caught in index.ts). Workflow state in DB is still correct.

### INFO: context_json size unbounded for long workflows
A 20-step workflow accumulates results in context_json. Each step can produce up to 
8000 chars of text input — actual coding output is larger (stored as summary string 
only, not raw output). Current summarizeResult() is terse. Safe for M1C-A.

### PASS: No secrets in workflow steps stored in DB
Steps store only `text` and `skill`. runIntent() handles actual execution; artifacts 
go to instance/workspace/<run_id>/. No auth tokens written to workflow_state.

## Verdict: PASS with 1 MINOR finding (auth on workflow routes)
