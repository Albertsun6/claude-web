// Workspace lock tests — covers acquire / release / lock-held rejection /
// stale-PID recovery / re-entrancy bail.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquireWorkspaceLock,
  inspectWorkspaceLock,
  WorkspaceLockHeldError,
  type LockFileContents,
} from "../workspace-lock.js";

let cwd: string;
let lockPath: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "aisep-lock-test-"));
  mkdirSync(join(cwd, ".aisep"), { recursive: true });
  lockPath = join(cwd, ".aisep", "run.lock");
});

afterEach(() => {
  try {
    rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("workspace-lock: acquire + release", () => {
  it("acquires when no lock file exists; release deletes the file", () => {
    const { release } = acquireWorkspaceLock(cwd, "run");
    const contents = JSON.parse(readFileSync(lockPath, "utf-8")) as LockFileContents;
    expect(contents.pid).toBe(process.pid);
    expect(contents.mode).toBe("run");
    expect(contents.startedAt).toBeGreaterThan(0);

    release();
    expect(() => readFileSync(lockPath, "utf-8")).toThrow();
  });

  it("release is idempotent (calling twice does not throw)", () => {
    const { release } = acquireWorkspaceLock(cwd, "retry-child");
    release();
    expect(() => release()).not.toThrow();
  });

  it("creates the .aisep directory if missing", () => {
    rmSync(join(cwd, ".aisep"), { recursive: true });
    const { release } = acquireWorkspaceLock(cwd, "fan-in-dispatch");
    expect(readFileSync(lockPath, "utf-8")).toContain("fan-in-dispatch");
    release();
  });
});

describe("workspace-lock: held by alive process rejects", () => {
  it("throws WorkspaceLockHeldError when lock held by current process pid", () => {
    // Pre-write a lock file claiming the CURRENT pid (which is alive).
    const held: LockFileContents = {
      pid: process.pid,
      startedAt: Date.now() - 1000,
      mode: "run",
    };
    writeFileSync(lockPath, JSON.stringify(held), "utf-8");

    expect(() => acquireWorkspaceLock(cwd, "retry-child")).toThrow(
      WorkspaceLockHeldError,
    );
  });

  it("error carries lock holder details for diagnostics", () => {
    const held: LockFileContents = {
      pid: process.pid,
      startedAt: 1700000000000,
      mode: "migrate",
    };
    writeFileSync(lockPath, JSON.stringify(held), "utf-8");

    try {
      acquireWorkspaceLock(cwd, "run");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceLockHeldError);
      const held2 = (err as WorkspaceLockHeldError).held;
      expect(held2.pid).toBe(process.pid);
      expect(held2.mode).toBe("migrate");
    }
  });
});

describe("workspace-lock: stale-PID recovery", () => {
  it("reclaims when lock holder PID is not alive", () => {
    // PID 0 is never a real process — use PID 999999 instead which is almost
    // certainly not alive (max PID on Linux is ~32768 by default, macOS uses
    // up to 99999). isPidAlive returns false → ESRCH.
    const stale: LockFileContents = {
      pid: 999999,
      startedAt: Date.now() - 86400_000,
      mode: "run",
    };
    writeFileSync(lockPath, JSON.stringify(stale), "utf-8");

    const { release } = acquireWorkspaceLock(cwd, "retry-child");
    const current = JSON.parse(readFileSync(lockPath, "utf-8")) as LockFileContents;
    expect(current.pid).toBe(process.pid);
    expect(current.mode).toBe("retry-child");
    release();
  });

  it("reclaims when lock file is malformed (not JSON / missing fields)", () => {
    writeFileSync(lockPath, "not-json-at-all", "utf-8");
    const { release } = acquireWorkspaceLock(cwd, "run");
    const current = JSON.parse(readFileSync(lockPath, "utf-8")) as LockFileContents;
    expect(current.pid).toBe(process.pid);
    release();
  });
});

describe("workspace-lock: inspectWorkspaceLock", () => {
  it("returns null when no lock file", () => {
    expect(inspectWorkspaceLock(cwd)).toBeNull();
  });

  it("returns lock contents when held by an alive process", () => {
    const { release } = acquireWorkspaceLock(cwd, "run");
    const observed = inspectWorkspaceLock(cwd);
    expect(observed?.pid).toBe(process.pid);
    expect(observed?.mode).toBe("run");
    release();
  });

  it("returns null when lock file is stale (dead holder)", () => {
    const stale: LockFileContents = {
      pid: 999999,
      startedAt: Date.now() - 86400_000,
      mode: "run",
    };
    writeFileSync(lockPath, JSON.stringify(stale), "utf-8");
    expect(inspectWorkspaceLock(cwd)).toBeNull();
  });
});
