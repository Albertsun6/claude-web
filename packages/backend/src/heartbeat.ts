// Heartbeat / visibility tracker.
// Lightweight in-memory stats so iOS / Web can show "Mac is alive" badge.
// Inspired by hapi's visibilityTracker.ts + aliveTime.ts (~80 lines combined),
// but rewritten for claude-web's per-runId model — no SyncEngine, no namespaces.

const startedAt = Date.now();
let lastSpawnAt: number | null = null;
let lastCompletionAt: number | null = null;
let lastErrorAt: number | null = null;
let totalSpawns = 0;
let totalCompletions = 0;
let totalErrors = 0;

export function recordSpawn(): void {
  lastSpawnAt = Date.now();
  totalSpawns++;
}

export function recordCompletion(reason: "completed" | "interrupted" | "error"): void {
  const now = Date.now();
  if (reason === "error") {
    lastErrorAt = now;
    totalErrors++;
  } else {
    lastCompletionAt = now;
    totalCompletions++;
  }
}

export interface HeartbeatSnapshot {
  /** Unix ms when this backend process started. */
  startedAt: number;
  /** Seconds since process start. Clamped non-negative (hapi's aliveTime.ts pattern). */
  uptimeSec: number;
  /** Last time a claude CLI subprocess was spawned. null if never. */
  lastSpawnAt: number | null;
  /** Last successful or interrupted completion. null if never. */
  lastCompletionAt: number | null;
  /** Last error completion. null if never. */
  lastErrorAt: number | null;
  totalSpawns: number;
  totalCompletions: number;
  totalErrors: number;
  /** Currently-active run count (set by run-registry at read time). */
  activeRunCount: number;
  /** Number of registered notification channels (set by index.ts on boot). */
  notificationChannelCount: number;
  /** Server time at snapshot moment, useful for client/server clock skew detection. */
  now: number;
}

let getActiveRunCount: () => number = () => 0;
let notificationChannelCount = 0;

export function setActiveRunCountFn(fn: () => number): void {
  getActiveRunCount = fn;
}

export function setNotificationChannelCount(n: number): void {
  notificationChannelCount = n;
}

export function snapshot(): HeartbeatSnapshot {
  const now = Date.now();
  return {
    startedAt,
    uptimeSec: Math.max(0, Math.floor((now - startedAt) / 1000)),
    lastSpawnAt,
    lastCompletionAt,
    lastErrorAt,
    totalSpawns,
    totalCompletions,
    totalErrors,
    activeRunCount: getActiveRunCount(),
    notificationChannelCount,
    now,
  };
}
