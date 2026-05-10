# M1B+ MCP CLI Wire-up — Closeout (cursor cross-review lens)
Date: 2026-05-10-1930

## Cross-cutting concerns

### PASS: Closes the M1B制度性教训#12 gap
Before M1B+: McpServerManager spawned MCP servers; Claude CLI children had no
way to reach them; coding tasks got no MCP tools.

After M1B+: cli-runner passes `--mcp-config` to each Claude CLI spawn; CLI
launches its own MCP server children for each run. The vessel-core's
McpServerManager-managed servers remain (idle, no consumer yet) — symmetrical
to the existing Eva-side use cases that don't need MCP.

The closure of the gap is real: a `--mcp-config` flag is now in the args list
when VESSEL_MCP_SERVERS is set. Verified by inspection of buildArgs in
cli-runner.ts.

### PASS: Eva path unaffected
Eva backend uses `cli-runner.ts` for web/iOS Claude sessions. With
VESSEL_MCP_SERVERS unset (default), `getMcpConfigPath()` returns null,
`buildArgs` skips `--mcp-config`, behavior is identical to pre-M1B+. No
backwards-compat break.

### PASS: Test isolation is correct
test-m1bplus.ts mutates `process.env.VESSEL_MCP_SERVERS` and uses
`_resetCacheForTest()` between scenarios. Original env is restored at end.
Tests don't leak state to subsequent test runs (verified: pnpm test:m1b still
passes after pnpm test:m1bplus).

### PASS: TypeScript strict mode clean
0 tsc errors with --noEmit. No `any` casts. `Record<string, unknown>` used
where appropriate.

### Finding matrix summary

| ID | Severity | Source | Finding | Decision |
|---|---|---|---|---|
| MINOR-arch-1 | MINOR | architect | McpServerManager has no consumer post-M1B+ | defer/M1C+ |
| MINOR-prag-1 | MINOR | pragmatist | Manual smoke test not automated | accepted-as-is |
| MINOR-risk-1 | MINOR | risk-officer | VESSEL_ALLOWED_ROOTS doesn't apply to MCP filesystem | defer/docs |

3 MINOR, 0 MAJOR, 0 BLOCKER. All findings deferred or accepted-as-is. No
fix-now items.

## Verdict: PASS
