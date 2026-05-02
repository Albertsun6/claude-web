// Cross-connection run registry. Lets HTTP routes (e.g. emergency interrupt
// from iOS) reach into runs that were created on a specific WS connection.
// Adapted from hapi's permissions registry pattern (hub/src/web/routes/permissions.ts)
// — single global Map keyed by runId, populated/removed by the WS handler.

export interface RegisteredRun {
  abort: AbortController;
  cwd: string;
  prompt: string;
  startedAt: number;
}

const registry = new Map<string, RegisteredRun>();

export function register(runId: string, info: RegisteredRun): void {
  registry.set(runId, info);
}

export function unregister(runId: string): void {
  registry.delete(runId);
}

export function get(runId: string): RegisteredRun | undefined {
  return registry.get(runId);
}

export function listActive(): Array<{ runId: string; cwd: string; promptPreview: string; startedAt: number; runningSec: number }> {
  const now = Date.now();
  return Array.from(registry.entries()).map(([runId, info]) => ({
    runId,
    cwd: info.cwd,
    promptPreview: info.prompt.slice(0, 80),
    startedAt: info.startedAt,
    runningSec: Math.floor((now - info.startedAt) / 1000),
  }));
}

export function activeCount(): number {
  return registry.size;
}

/** Force-interrupt a run by id. Returns true if found, false if not. */
export function interrupt(runId: string): boolean {
  const info = registry.get(runId);
  if (!info) return false;
  info.abort.abort();
  return true;
}
