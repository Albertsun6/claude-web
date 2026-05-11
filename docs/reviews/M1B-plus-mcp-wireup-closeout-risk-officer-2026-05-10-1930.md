# M1B+ MCP CLI Wire-up — Closeout (vessel-risk-officer lens)
Date: 2026-05-10-1930

## Findings

### PASS: Temp file mode 0o600 (security)
The .mcp.json contains MCP server command paths and possibly env vars. Mode
0o600 (owner-only) prevents other users on shared systems from reading. Test
asserts `mode === 0o600`.

### PASS: No injection of user input into shell
McpServerSpec.command and args are passed via `child_process.spawn()` (array
form), not `exec()`. Even if a malicious VESSEL_MCP_SERVERS leaks in, no shell
metacharacter expansion. Existing M1B test confirmed this; M1B+ inherits.

### PASS: env passthrough preserved correctly
`spec.env` is passed through to the JSON config verbatim. Claude CLI applies
it to spawned MCP server children. No env merge with parent (each MCP server
gets its own env dictated by spec.env). Predictable.

### PASS: Cleanup on graceful exit
- vessel-core CLI: cleanupMcpConfig() in onShutdown + main() exit paths
- Backend (index.ts): cleanupMcpConfig() in SIGTERM/SIGINT handler

Crash exit (SIGKILL, panic) leaves the temp file. But /tmp is OS-managed — files older than ~3 days typically get reaped on macOS. Acceptable for
personal use.

### MINOR-1: Permission boundary unchanged
The MCP servers spawned by Claude CLI still inherit the FS permission boundary
defined by the MCP server itself (e.g., `@modelcontextprotocol/server-filesystem`
takes a root path argument). VESSEL_ALLOWED_ROOTS does NOT apply to MCP-tool
filesystem access — only to direct vessel-fs API access. This is the correct
separation but should be documented for ops.
**Risk**: Medium if user thinks VESSEL_ALLOWED_ROOTS guards everything.
**Mitigation**: Document in ops guide that MCP servers have independent scope.
**Verdict**: MINOR — defer to docs pass.

### INFO: Tmp file race on parallel pid reuse
File path includes `process.pid`. If pid is recycled (after vessel-core exits
without cleanup, system gives same pid to another process), the new process
would overwrite the old file. Mode 0o600 owner check kicks in for cross-user
case; same-user case is benign (we're regenerating).

## Verdict: PASS — 1 MINOR (docs pass)
