/**
 * McpServerManager — spawn/kill MCP server subprocesses.
 *
 * vessel-core manages MCP server lifecycle independently; Claude CLI talks to
 * the servers directly. No @modelcontextprotocol/sdk required at vessel-core
 * level for M1B (only child_process + stdio).
 *
 * Configuration via VESSEL_MCP_SERVERS env var (JSON array of McpServerSpec).
 *
 * @see docs/reviews/M1B-mcp-b-level-architect-2026-05-10-1000.md
 */

import { spawn, type ChildProcess } from 'node:child_process';

export interface McpServerSpec {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface RunningServer {
  spec: McpServerSpec;
  proc: ChildProcess;
  pid: number;
}

export class McpServerManager {
  private readonly servers = new Map<string, RunningServer>();

  /** Spawn a single MCP server. Returns false if spawn fails (non-throwing). */
  async spawn(spec: McpServerSpec): Promise<boolean> {
    if (this.servers.has(spec.name)) {
      console.warn(`[mcp] server "${spec.name}" already running, skipping`);
      return true;
    }

    try {
      const proc = spawn(spec.command, spec.args, {
        env: { ...process.env, ...(spec.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      if (!proc.pid) {
        console.warn(`[mcp] server "${spec.name}" spawn returned no pid`);
        return false;
      }

      // Drain stderr to console for debugging; don't let it block.
      proc.stderr?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.trim()) console.log(`[mcp/${spec.name}] ${line}`);
        }
      });

      proc.on('exit', (code, signal) => {
        this.servers.delete(spec.name);
        if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
          console.warn(`[mcp] server "${spec.name}" exited unexpectedly: code=${code} signal=${signal}`);
        }
      });

      proc.on('error', (err) => {
        this.servers.delete(spec.name);
        console.warn(`[mcp] server "${spec.name}" error: ${err.message}`);
      });

      this.servers.set(spec.name, { spec, proc, pid: proc.pid });
      console.log(`[mcp] server "${spec.name}" started (pid ${proc.pid})`);
      return true;
    } catch (err) {
      console.warn(`[mcp] failed to spawn "${spec.name}": ${(err as Error).message}`);
      return false;
    }
  }

  /** Graceful shutdown: SIGTERM + 3s wait + SIGKILL survivors. */
  async shutdown(timeoutMs = 3000): Promise<void> {
    const active = [...this.servers.values()];
    if (active.length === 0) return;

    // Send SIGTERM to all.
    for (const s of active) {
      try { s.proc.kill('SIGTERM'); } catch { /* already gone */ }
    }

    // Wait up to timeoutMs for them to exit.
    const deadline = Date.now() + timeoutMs;
    while (this.servers.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // SIGKILL survivors.
    for (const s of [...this.servers.values()]) {
      try {
        s.proc.kill('SIGKILL');
        console.warn(`[mcp] server "${s.spec.name}" did not exit gracefully, SIGKILLed`);
      } catch { /* already gone */ }
    }
    this.servers.clear();
  }

  /** Names of currently running servers. */
  running(): string[] {
    return [...this.servers.keys()];
  }

  /** Whether a named server is running. */
  isRunning(name: string): boolean {
    return this.servers.has(name);
  }
}

/** Parse VESSEL_MCP_SERVERS env var: JSON array of McpServerSpec. */
export function parseMcpSpecsFromEnv(): McpServerSpec[] {
  const raw = (process.env.VESSEL_MCP_SERVERS ?? '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('[mcp] VESSEL_MCP_SERVERS must be a JSON array; ignoring');
      return [];
    }
    return parsed.filter((s): s is McpServerSpec =>
      typeof s === 'object' && s !== null &&
      typeof s.name === 'string' &&
      typeof s.command === 'string' &&
      Array.isArray(s.args),
    );
  } catch (err) {
    console.warn(`[mcp] failed to parse VESSEL_MCP_SERVERS: ${(err as Error).message}`);
    return [];
  }
}

export const mcpManager = new McpServerManager();
