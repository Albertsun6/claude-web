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

import { AisepRunner, AisepStore, ids } from "@claude-web/aisep-core";
import { NodeWorkspace } from "@claude-web/aisep-workspace";
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

  it("partial failure: 1 of 3 children fails → parent fails", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      // Mock executor fails ALL implement stages — every child of this fan-out fails.
      executor: new MockStageExecutor({ failOnStages: ["implement"] }),
    });

    const { parent, children } = await runner.runFanOutParent({
      stage: "implement",
      children: [{ name: "backend" }, { name: "frontend" }],
    });

    expect(parent.status).toBe("failed");
    expect(children.every((c) => c.status === "failed")).toBe(true);
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

  it("runStage on a normal stage still works (regression guard)", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({ store, workspace: ws, executor: new MockStageExecutor() });

    const run = await runner.runStage({ stage: "intake" });
    expect(run.fanOutRole).toBe("normal");
    expect(run.status).toBe("succeeded");
  });
});
