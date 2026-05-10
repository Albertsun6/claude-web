# M1B+ MCP CLI Wire-up — Closeout (vessel-architect lens)
Date: 2026-05-10-1930

## Scope
Closes 制度性教训#12 (M1B): "lifecycle ≠ wire-up". cli-runner.ts now passes
`--mcp-config <temp .mcp.json>` to Claude CLI when VESSEL_MCP_SERVERS is set, so
spawned CLI children can call MCP tools (mcp__<name>__*).

Files reviewed:
- packages/backend/src/mcp/cli-config.ts (new)
- packages/backend/src/cli-runner.ts (buildArgs +1 conditional)
- packages/backend/src/index.ts (cleanupMcpConfig in shutdown)
- packages/backend/src/cli/vessel-core.ts (cleanupMcpConfig in onShutdown + main exit)
- packages/backend/src/test-m1bplus.ts (27 assertions)

## Findings

### PASS: stdio MCP architecture correctly handled
The fix sidesteps a subtle architectural trap: stdio MCP servers are 1:1 with
their spawning process. McpServerManager-spawned servers cannot be "shared"
with Claude CLI children. Solution: vessel-core writes a config file describing
the same servers; CLI launches its own copies for each run. McpServerManager is
left intact for future vessel-core direct MCP use.

This is the correct decoupling: lifecycle separation is preserved (vessel-core
owns its instances; CLI owns CLI's instances) while wire-up is achieved (same
config drives both).

### PASS: Layering preserved
`cli-config.ts` depends on `manager.ts` (one direction). `cli-runner.ts`
depends on `cli-config.ts` (one direction). No circular imports.

### MINOR-1: McpServerManager spawning at boot has no consumer
With M1B+, Claude CLI spawns its own MCP children — McpServerManager's vessel-
core-side instances have nothing pointing at them. They run for the lifetime
of vessel-core but are unused. Two paths to address:
- (a) Future M1C+ vessel-core direct MCP client → McpServerManager has a real consumer
- (b) Defer McpServerManager spawning until something asks for it (lazy)
**Verdict**: MINOR — not a regression, just dead-weight at boot. Defer to M1C+.

### INFO: Temp file in /tmp scoped by pid
`vessel-mcp-<pid>.json` mode 0o600. OS will reap on reboot; cleanup hooks
remove on signal exit and normal exit. If vessel-core crashes mid-process,
the file lingers until OS reboot — acceptable for personal single-machine.

## Verdict: PASS — 1 MINOR finding (deferred to M1C+)
