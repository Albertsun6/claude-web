// Integration test: AisepRunner.runFanOutParent() with N children
// (Stage 2.runner; runner-level fan-out without CLI / hbs / concurrency).
//
// Verifies:
//   - parent + 3 children rows created with correct fanOutRole + parent ref
//   - parent.subStages matches child ids
//   - all child stage_runs execute and produce a `patch` artifact each
//   - parent emits a `patch_set` artifact aggregating child patches
//   - parent settles `succeeded` iff every child succeeded
//   - if one child fails, parent settles `failed`

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AisepRunner, AisepStore, ids } from "@vessel/aisep-core";
import { NodeWorkspace } from "@vessel/aisep-workspace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockStageExecutor } from "../mock-executor.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "aisep-fanout-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function newWorkspace() {
  return new NodeWorkspace(cwd, {
    id: ids.workspace(),
    name: "fanout-test",
    cwd,
    status: "active",
    techStack: [],
    createdAt: Date.now(),
    shipCount: 0,
    adoptedPatterns: [],
  });
}

describe("runFanOutParent (Stage 2.runner)", () => {
  it("happy path: 3 children all succeed → parent succeeds + patch_set emitted", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({ store, workspace: ws, executor: new MockStageExecutor() });

    const { parent, children } = await runner.runFanOutParent({
      stage: "implement",
      children: [{ name: "backend" }, { name: "frontend" }, { name: "tests" }],
    });

    expect(parent.fanOutRole).toBe("parent");
    expect(parent.status).toBe("succeeded");
    expect(parent.subStages).toHaveLength(3);

    // All 3 children created with correct invariants.
    expect(children).toHaveLength(3);
    for (const child of children) {
      expect(child.fanOutRole).toBe("child");
      expect(child.parentStageRunId).toBe(parent.id);
      expect(child.status).toBe("succeeded");
      expect(child.subStages).toEqual([]);
    }

    // parent.subStages matches child ids in declaration order.
    expect(parent.subStages).toEqual(children.map((c) => c.id));

    // listChildStageRuns API returns the same children.
    const listed = store.listChildStageRuns(parent.id);
    expect(listed.map((c) => c.id).sort()).toEqual(children.map((c) => c.id).sort());

    // Each child produced a patch artifact.
    for (const child of children) {
      const arts = store.listArtifactsByStageRun(child.id);
      const patches = arts.filter((a) => a.ref.kind === "patch");
      expect(patches).toHaveLength(1);
    }

    // Parent has a patch_set artifact aggregating the children.
    const parentArts = store.listArtifactsByStageRun(parent.id);
    const patchSets = parentArts.filter((a) => a.ref.kind === "patch_set");
    expect(patchSets).toHaveLength(1);
    const manifestArt = patchSets[0]!;
    expect(manifestArt.storage).toBe("inline");
    const manifest = JSON.parse(
      manifestArt.storage === "inline" ? manifestArt.contentInline : "{}",
    );
    expect(manifest.patches).toHaveLength(3);
    expect(manifest.patches.map((p: { subStageName: string }) => p.subStageName)).toEqual([
      "backend",
      "frontend",
      "tests",
    ]);
  });

  it("partial failure: all children fail (concurrent batch) → parent fails", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor({ failOnStages: ["implement"] }),
    });

    // concurrencyCap=2 dispatches both children together → both fail
    // (no abort short-circuit because they fail in the same batch).
    const { parent, children } = await runner.runFanOutParent({
      stage: "implement",
      concurrencyCap: 2,
      children: [{ name: "backend" }, { name: "frontend" }],
    });

    expect(parent.status).toBe("failed");
    expect(children.every((c) => c.status === "failed")).toBe(true);
  });

  it("Stage 3.1 cancel: first child fails serially → subsequent siblings cancelled (not failed)", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor({ failOnSubStages: ["backend"] }),
    });

    // Default cap=1 (serial); backend fails first, then frontend + tests
    // should be cancelled (not even run).
    const { parent, children } = await runner.runFanOutParent({
      stage: "implement",
      children: [{ name: "backend" }, { name: "frontend" }, { name: "tests" }],
    });
    expect(parent.status).toBe("failed");
    const byName = new Map(children.map((c, i) => [["backend", "frontend", "tests"][i]!, c]));
    expect(byName.get("backend")!.status).toBe("failed");
    expect(byName.get("frontend")!.status).toBe("cancelled");
    expect(byName.get("tests")!.status).toBe("cancelled");
  });

  it("Pilot-09 9b boundary mock: 1 of 3 children fails → parent fails + sibling succeeds preserved", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    // Only the "frontend" sub-implement fails; backend + tests succeed.
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor({ failOnSubStages: ["frontend"] }),
    });

    const { parent, children } = await runner.runFanOutParent({
      stage: "implement",
      concurrencyCap: 3,
      children: [{ name: "backend" }, { name: "frontend" }, { name: "tests" }],
    });

    // Parent fails because not all children succeeded.
    expect(parent.status).toBe("failed");

    // Children individual status: 1 failed, 2 succeeded.
    const byName = new Map(children.map((c, i) => [["backend", "frontend", "tests"][i]!, c]));
    expect(byName.get("backend")!.status).toBe("succeeded");
    expect(byName.get("frontend")!.status).toBe("failed");
    expect(byName.get("tests")!.status).toBe("succeeded");

    // Succeeded children's artifacts are preserved (no rollback in v1).
    const backendArts = store.listArtifactsByStageRun(byName.get("backend")!.id);
    expect(backendArts.filter((a) => a.ref.kind === "patch")).toHaveLength(1);
    const testsArts = store.listArtifactsByStageRun(byName.get("tests")!.id);
    expect(testsArts.filter((a) => a.ref.kind === "patch")).toHaveLength(1);

    // Parent still emits a patch_set manifest (even when partial; downstream
    // verify/review can see which children succeeded and decide what to do).
    const parentArts = store.listArtifactsByStageRun(parent.id);
    expect(parentArts.filter((a) => a.ref.kind === "patch_set")).toHaveLength(1);
  });

  it("rejects fan-out on non-implement stage (v1 scope limit)", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({ store, workspace: ws, executor: new MockStageExecutor() });

    await expect(
      runner.runFanOutParent({
        stage: "verify" as never, // type assertion for the test
        children: [{ name: "a" }, { name: "b" }],
      }),
    ).rejects.toThrow(/limits fan-out to stage="implement"/);
  });

  it("rejects fan-out with < 2 children (a 1-patch parent isn't a fan-out)", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({ store, workspace: ws, executor: new MockStageExecutor() });

    await expect(
      runner.runFanOutParent({
        stage: "implement",
        children: [{ name: "only" }],
      }),
    ).rejects.toThrow(/requires >= 2 children/);
  });

  it("concurrencyCap=2 with 3 children: all complete, parent succeeds (batched dispatch)", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({ store, workspace: ws, executor: new MockStageExecutor() });

    const { parent, children } = await runner.runFanOutParent({
      stage: "implement",
      concurrencyCap: 2,
      children: [{ name: "a" }, { name: "b" }, { name: "c" }],
    });

    expect(parent.status).toBe("succeeded");
    expect(children).toHaveLength(3);
    expect(children.every((c) => c.status === "succeeded")).toBe(true);
    // Order preservation: returned children match declared order.
    expect(children.map((c, i) => ({ name: ["a", "b", "c"][i], id: c.id })).every(
      (e) => store.getStageRun(e.id)?.fanOutRole === "child",
    )).toBe(true);
  });

  it("concurrencyCap defaults to 1 (serial; preserves Stage 2.runner baseline)", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({ store, workspace: ws, executor: new MockStageExecutor() });

    // No concurrencyCap passed → cap = 1 (serial)
    const { parent, children } = await runner.runFanOutParent({
      stage: "implement",
      children: [{ name: "a" }, { name: "b" }],
    });
    expect(parent.status).toBe("succeeded");
    expect(children).toHaveLength(2);
  });

  it("runStage on a normal stage still works (regression guard)", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({ store, workspace: ws, executor: new MockStageExecutor() });

    const run = await runner.runStage({ stage: "intake" });
    expect(run.fanOutRole).toBe("normal");
    expect(run.status).toBe("succeeded");
  });
});
