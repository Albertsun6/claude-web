# M1B+ MCP CLI Wire-up — Closeout (vessel-pragmatist lens)
Date: 2026-05-10-1930

## Findings

### PASS: Minimal scope, no over-engineering
- One new file (`cli-config.ts`, ~80 lines)
- One conditional in `cli-runner.ts`
- Two cleanup hooks (index.ts, vessel-core.ts)
- One test file (27 assertions)

Total surface change: < 200 lines including tests. No new dependency. No
@modelcontextprotocol/sdk pulled in (consistent with ADR-003: CC走CLI不走SDK).

### PASS: Reuses existing primitives
`parseMcpSpecsFromEnv()` already existed from M1B. M1B+ just bridges its output
to a different consumer (Claude CLI args). Zero duplication of env parsing or
McpServerSpec validation logic.

### PASS: YAGNI respected
- No TTL / refresh on the temp file (regenerates only on env change)
- No file-locking (single-process write, no contention)
- No per-run isolation (all CLI children share same config — which is correct
  since the config describes which MCP servers should be available, not which
  run uses them)

### INFO: Caching strategy (envHash) is slightly more than strictly needed
The cached path includes an envHash check that triggers regeneration if
VESSEL_MCP_SERVERS mutates mid-process. In practice, VESSEL_MCP_SERVERS is set
at boot and never changes — a simpler cache (write once, return forever) would
work. But the envHash adds maybe 5 lines and makes tests cleaner. Acceptable.

### MINOR-1: Manual smoke test not automated
The acceptance criterion ("CLI children call MCP tools") requires a real MCP
server. Test file documents the manual verification command but doesn't
automate it. For personal single-machine scope this is acceptable — running
`@modelcontextprotocol/server-filesystem` requires npx, network, and sandbox
considerations that don't fit unit-test pyramid floor.
**Verdict**: MINOR — accepted as-is; manual smoke recorded.

## Verdict: PASS — 1 MINOR (accepted as-is)
