/**
 * mcp/cli-config — bridge VESSEL_MCP_SERVERS env to Claude CLI's --mcp-config.
 *
 * M1B+ closes the lifecycle ≠ wire-up gap (制度性教训#12): McpServerManager
 * spawns MCP servers at vessel-core level, but stdio is 1:1 with its spawning
 * process — Claude CLI children cannot share those servers. Instead, cli-runner
 * passes --mcp-config to Claude CLI so the CLI spawns its own MCP server
 * children for the duration of each run.
 *
 * Format expected by Claude CLI (matches .mcp.json convention):
 *   { "mcpServers": { "<name>": { "command": "...", "args": [...], "env": {...} } } }
 *
 * The temp file path is cached after first write — same config reused across
 * every CLI spawn in this process. Cleanup on SIGTERM/SIGINT.
 */

import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMcpSpecsFromEnv, type McpServerSpec } from './manager.js';

let cachedPath: string | null = null;
let cachedFromEnvHash: string | null = null;

function specToCliEntry(spec: McpServerSpec): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    command: spec.command,
    args: spec.args,
  };
  if (spec.env && Object.keys(spec.env).length > 0) entry['env'] = spec.env;
  return entry;
}

/** Build the `{mcpServers: {...}}` shape from McpServerSpec[]. */
export function buildCliMcpConfig(specs: McpServerSpec[]): { mcpServers: Record<string, unknown> } {
  const mcpServers: Record<string, unknown> = {};
  for (const spec of specs) mcpServers[spec.name] = specToCliEntry(spec);
  return { mcpServers };
}

/**
 * Get path to a temp .mcp.json that mirrors VESSEL_MCP_SERVERS.
 * Returns null when env is unset/empty/invalid.
 *
 * Idempotent — same path returned on repeated calls within one process.
 */
export function getMcpConfigPath(): string | null {
  const specs = parseMcpSpecsFromEnv();
  if (specs.length === 0) return null;

  // Cache key = stable JSON of the env-parsed specs. If env changes mid-process
  // (rare but possible in tests), regenerate the file.
  const envHash = JSON.stringify(specs);
  if (cachedPath !== null && cachedFromEnvHash === envHash && existsSync(cachedPath)) {
    return cachedPath;
  }

  const path = join(tmpdir(), `vessel-mcp-${process.pid}.json`);
  const config = buildCliMcpConfig(specs);
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  cachedPath = path;
  cachedFromEnvHash = envHash;
  return path;
}

/** Remove the temp .mcp.json. Safe to call when no file was written. */
export function cleanupMcpConfig(): void {
  if (cachedPath && existsSync(cachedPath)) {
    try { unlinkSync(cachedPath); } catch { /* ignore */ }
  }
  cachedPath = null;
  cachedFromEnvHash = null;
}

/** Test-only — reset internal cache without unlinking. */
export function _resetCacheForTest(): void {
  cachedPath = null;
  cachedFromEnvHash = null;
}
