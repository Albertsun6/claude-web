// v0.4 (Slice 3) — runner.runRetryChild() integration tests.
//
// Spec: ADR-022 Decision 4 (id-stable retry + state-machine amendment),
// proposal §Q5 (retry semantics step 1-7), §Decision 4 (parent.status
// terminal precondition + R1 mitigation), §Decision 4 (R7 workspace
// lock). Slice 3 verifies the runner glue (lock + pre-conditions +
// state-machine + attempt log + parent re-aggregation). Slice 4 wires
// the cli `--retry-child` flag.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireWorkspaceLock,
  AisepRunner,
  AisepStore,
  ids,
  WorkspaceLockHeldError,
} from "@vessel/aisep-core";
import { NodeWorkspace } from "@vessel/aisep-workspace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockStageExecutor } from "../mock-executor.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "aisep-retry-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function newWorkspace() {
  return new NodeWorkspace(cwd, {
    id: ids.workspace(),
    name: "retry-test",
    cwd,
    status: "active",
    techStack: [],
    createdAt: Date.now(),
    shipCount: 0,
    adoptedPatterns: [],
  });
}

const STANDARD_CHILDREN = [
  { name: "backend", affects: ["packages/backend/.*"] },
  { name: "frontend", affects: ["packages/frontend/.*"] },
  { name: "tests", affects: ["packages/shared/test/.*"] },
] as const;

describe("runner.runRetryChild (Slice 3 / ADR-022 Decision 4)", () => {
  it("happy path: failed child → retry → succeeded; parent gets new patch_set", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const executor = new MockStageExecutor({
      failFirstAttemptOnSubStages: ["frontend"],
    });
    const runner = new AisepRunner({ store, workspace: ws, executor });

    // Run initial fan-out: frontend fails first time, others succeed.
    const { parent, children } = await runner.runFanOutParent({
      stage: "implement",
      concurrencyCap: 3,
      children: [...STANDARD_CHILDREN],
    });
    expect(parent.status).toBe("failed");
    const failedChild = children.find((c) => c.status === "failed")!;
    expect(failedChild).toBeDefined();

    const beforeRetryId = failedChild.id;
    const beforeRetryAttempts = store.listAttemptsByStageRun(failedChild.id);
    expect(beforeRetryAttempts).toHaveLength(1);

    // Retry the failed child — mock now succeeds on second invocation.
    const retried = await runner.runRetryChild({ childId: failedChild.id });

    // Id-stable + status now succeeded.
    expect(retried.id).toBe(beforeRetryId);
    expect(retried.status).toBe("succeeded");

    // New attempt log entry (attemptN = 2 — id-stable per Decision 4).
    const afterRetryAttempts = store.listAttemptsByStageRun(failedChild.id);
    expect(afterRetryAttempts).toHaveLength(2);
    expect(afterRetryAttempts[1]!.attemptN).toBe(2);

    // Parent's patch_set re-aggregated (a new patch_set artifact appended).
    const parentArtifacts = store.listArtifactsByStageRun(parent.id);
    const patchSets = parentArtifacts.filter((a) => a.ref.kind === "patch_set");
    expect(patchSets.length).toBeGreaterThanOrEqual(2); // initial + re-aggregate
  });

  it("parent.status stays 'failed' after retry-success (Q5 ¶7)", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const executor = new MockStageExecutor({
      failFirstAttemptOnSubStages: ["backend"],
    });
    const runner = new AisepRunner({ store, workspace: ws, executor });

    const { parent } = await runner.runFanOutParent({
      stage: "implement",
      concurrencyCap: 3,
      children: [...STANDARD_CHILDREN],
    });
    expect(parent.status).toBe("failed");

    const failed = store
      .listChildStageRuns(parent.id)
      .find((c) => c.status === "failed")!;
    await runner.runRetryChild({ childId: failed.id });

    // Per Q5 ¶7: parent stays at its original status; downstream fan-in
    // dispatch is gated on child statuses (scheduler.nextReadyFanInDispatch
    // accepts parent='failed' when all children are succeeded).
    const reloadedParent = store.getStageRun(parent.id);
    expect(reloadedParent?.status).toBe("failed");
  });

  it("rejects when child status is not 'failed' (cannot retry running/succeeded)", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor(),
    });

    const { children } = await runner.runFanOutParent({
      stage: "implement",
      children: [...STANDARD_CHILDREN],
    });

    // All succeeded → retry should refuse.
    const succeededChild = children[0]!;
    expect(succeededChild.status).toBe("succeeded");
    await expect(
      runner.runRetryChild({ childId: succeededChild.id }),
    ).rejects.toThrow(/must be status='failed'/);
  });

  it("rejects when target stage_run is not a fan-out child", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor(),
    });

    // Run a normal (non-fan-out) stage.
    const normalRun = await runner.runStage({ stage: "intake" });
    await expect(
      runner.runRetryChild({ childId: normalRun.id }),
    ).rejects.toThrow(/not a fan-out child/);
  });

  it("rejects when target stage_run id not found", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor(),
    });
    await expect(
      runner.runRetryChild({ childId: "sr-does-not-exist" }),
    ).rejects.toThrow(/stage_run not found/);
  });

  it("R7 lock: rejects when workspace lock held by another process", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const executor = new MockStageExecutor({
      failFirstAttemptOnSubStages: ["frontend"],
    });
    const runner = new AisepRunner({ store, workspace: ws, executor });

    // Initial fan-out leaves frontend failed.
    const { children } = await runner.runFanOutParent({
      stage: "implement",
      concurrencyCap: 3,
      children: [...STANDARD_CHILDREN],
    });
    const failed = children.find((c) => c.status === "failed")!;

    // Simulate another live process holding the lock.
    writeFileSync(
      join(cwd, ".aisep", "run.lock"),
      JSON.stringify({
        pid: process.pid, // current process is alive ⇒ lock looks held
        startedAt: Date.now(),
        mode: "run",
      }),
      "utf-8",
    );

    await expect(
      runner.runRetryChild({ childId: failed.id }),
    ).rejects.toThrow(WorkspaceLockHeldError);
  });

  it("releases lock on error exit path (post-condition cleanup)", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor(),
    });

    // Cause an error path (id not found) — lock should be released cleanly.
    await expect(
      runner.runRetryChild({ childId: "sr-nope" }),
    ).rejects.toThrow();

    // We should be able to acquire the lock immediately afterwards.
    const { release } = acquireWorkspaceLock(cwd, "run");
    release();
  });

  it("id-stable: retry preserves child id + parentStageRunId", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const executor = new MockStageExecutor({
      failFirstAttemptOnSubStages: ["tests"],
    });
    const runner = new AisepRunner({ store, workspace: ws, executor });

    const { parent, children } = await runner.runFanOutParent({
      stage: "implement",
      concurrencyCap: 3,
      children: [...STANDARD_CHILDREN],
    });
    const failed = children.find((c) => c.status === "failed")!;

    const retried = await runner.runRetryChild({ childId: failed.id });
    expect(retried.id).toBe(failed.id);
    expect(retried.parentStageRunId).toBe(parent.id);
    expect(retried.fanOutRole).toBe("child");
  });
});
