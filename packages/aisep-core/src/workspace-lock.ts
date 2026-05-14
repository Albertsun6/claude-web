// Workspace lock — single-writer guard for `<cwd>/.aisep/state.json`.
//
// Spec: ADR-022 R7 (cross-process retry race). Single-binary-single-user
// is the assumed deploy mode, but two `aisep run` invocations on the same
// workspace MUST not produce torn writes to state.json. The lock fails
// fast (no spin/retry) and is acquired around any code path that may
// trigger `failed → running` retry-marker transitions or fan-in dispatch.
//
// Mechanism: PID file at `<cwd>/.aisep/run.lock` created with O_EXCL +
// O_WRONLY (atomic create-or-fail). Cleanup uses stale-PID detection
// (kill(pid, 0)) when the lock file's PID is not alive any more, the
// next acquire reclaims the lock and writes a new PID. POSIX-portable,
// no flock dependency, NFS-safe-not-required (per ADR-022 §Open Q5).
//
// R6 boundary: this module is the ONE allowed exception in aisep-core
// for direct fs writes (matched by store.ts's similar exception for
// state.json bookkeeping). Caller must release in a finally block.

import {
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join, resolve } from "node:path";

/** Mode tag persisted in the lock file for forensic logging. */
export type LockMode = "run" | "retry-child" | "migrate" | "fan-in-dispatch";

export interface LockFileContents {
  pid: number;
  startedAt: number;
  mode: LockMode;
}

export class WorkspaceLockHeldError extends Error {
  constructor(
    public readonly lockPath: string,
    public readonly held: LockFileContents,
  ) {
    super(
      `workspace lock held by pid=${held.pid} (mode=${held.mode}, started ${new Date(
        held.startedAt,
      ).toISOString()}); lock at ${lockPath}`,
    );
    this.name = "WorkspaceLockHeldError";
  }
}

/**
 * Test whether `pid` corresponds to a currently-alive process on the
 * local host. Uses `process.kill(pid, 0)` which sends signal 0 (no-op
 * existence check) — throws ESRCH for dead PIDs, EPERM for live PIDs
 * the current user can't signal (treated as alive for safety).
 */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    // EPERM means the process exists but we can't signal it. Treat as alive.
    if (code === "EPERM") return true;
    return false;
  }
}

function lockPathFor(cwd: string): string {
  return join(resolve(cwd), ".aisep", "run.lock");
}

function readLockFile(lockPath: string): LockFileContents | null {
  try {
    const raw = readFileSync(lockPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LockFileContents>;
    if (
      typeof parsed.pid === "number" &&
      typeof parsed.startedAt === "number" &&
      typeof parsed.mode === "string"
    ) {
      return parsed as LockFileContents;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Acquire the workspace lock. Returns a `release()` handle. Throws
 * `WorkspaceLockHeldError` when the lock is held by another live process.
 *
 * Stale-PID recovery: if the existing lock file's PID is not alive,
 * the lock is silently reclaimed (file replaced with the current PID).
 *
 * NOT re-entrant: calling `acquireWorkspaceLock` twice in the same
 * process throws WorkspaceLockHeldError on the second call (defensive —
 * callers must hold one lock per workspace per process).
 */
export function acquireWorkspaceLock(
  cwd: string,
  mode: LockMode,
  pid: number = process.pid,
): { release: () => void; lockPath: string } {
  const lockPath = lockPathFor(cwd);
  const dir = join(resolve(cwd), ".aisep");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const payload: LockFileContents = {
    pid,
    startedAt: Date.now(),
    mode,
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf-8");

  // O_WRONLY | O_CREAT | O_EXCL — atomic create-or-fail. Fails with
  // EEXIST if the file already exists; we then inspect liveness. Use
  // fs.constants because POSIX values differ across platforms (Linux
  // O_CREAT=64 vs macOS O_CREAT=512 etc).
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL;

  // First attempt: pure atomic create.
  try {
    const fd = openSync(lockPath, flags, 0o600);
    writeSync(fd, payloadBytes);
    closeSync(fd);
    return makeRelease(lockPath, pid);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err;
    }
  }

  // EEXIST: read existing lock + check if holder is alive.
  const existing = readLockFile(lockPath);
  if (existing && isPidAlive(existing.pid)) {
    throw new WorkspaceLockHeldError(lockPath, existing);
  }

  // Stale lock — reclaim. Unlink + retry atomic create. (Two stale
  // acquirers racing: at most one wins the O_EXCL, others see EEXIST
  // again and either re-detect stale or correctly bail with our own PID.)
  try {
    unlinkSync(lockPath);
  } catch {
    /* ignore — another reclaimer may have unlinked already */
  }

  try {
    const fd = openSync(lockPath, flags, 0o600);
    writeSync(fd, payloadBytes);
    closeSync(fd);
    return makeRelease(lockPath, pid);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      // Race lost — another process reclaimed first. Re-read.
      const winner = readLockFile(lockPath);
      throw new WorkspaceLockHeldError(
        lockPath,
        winner ?? { pid: -1, startedAt: Date.now(), mode },
      );
    }
    throw err;
  }
}

function makeRelease(
  lockPath: string,
  ownerPid: number,
): { release: () => void; lockPath: string } {
  let released = false;
  return {
    lockPath,
    release() {
      if (released) return;
      released = true;
      // Only unlink if the file still contains OUR pid (defensive — a
      // stale-recovery reclaimer could have replaced us, though that
      // shouldn't happen during a normal session).
      const current = readLockFile(lockPath);
      if (current && current.pid !== ownerPid) {
        return;
      }
      try {
        unlinkSync(lockPath);
      } catch {
        /* lock already gone */
      }
    },
  };
}

/**
 * Inspect (without acquiring) whether the workspace lock is currently
 * held. Returns the holder's lock-file contents or null. Stale (dead-PID)
 * holders are reported as null. Useful for diagnostics / `aisep status`.
 */
export function inspectWorkspaceLock(cwd: string): LockFileContents | null {
  const lockPath = lockPathFor(cwd);
  if (!existsSync(lockPath)) return null;
  const existing = readLockFile(lockPath);
  if (!existing) return null;
  if (!isPidAlive(existing.pid)) return null;
  return existing;
}
