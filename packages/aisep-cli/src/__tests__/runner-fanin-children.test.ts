// v0.4 (Slice 4) — runner.runFanInChildren() integration tests.
//
// Spec: ADR-022 Decision 1 β (stage-pair fan-in only), Q3 (predecessorId
// linkage), Slice 2 scheduler.nextReadyFanInDispatch decisions.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AisepRunner, AisepStore, ids } from "@vessel/aisep-core";
import { NodeWorkspace } from "@vessel/aisep-workspace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockStageExecutor } from "../mock-executor.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "aisep-fanin-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function newWorkspace() {
  return new NodeWorkspace(cwd, {
    id: ids.workspace(),
    name: "fanin-test",
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

describe("runner.runFanInChildren (Slice 4 / ADR-022 Decision 1 β)", () => {
  it("happy path: 3-child impl fan-out → 3-child verify fan-in mirror succeeds", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor(),
    });

    // Stage 1: upstream fan-out (impl)
    const { parent: implParent, children: implChildren } = await runner.runFanOutParent({
      stage: "implement",
      concurrencyCap: 3,
      children: [...STANDARD_CHILDREN],
    });
    expect(implParent.status).toBe("succeeded");
    expect(implChildren.every((c) => c.status === "succeeded")).toBe(true);

    // Stage 2: fan-in mirror to verify
    const result = await runner.runFanInChildren({
      upstreamParentId: implParent.id,
      downstreamStage: "verify",
      concurrencyCap: 3,
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    expect(result.parent.stage).toBe("verify");
    expect(result.parent.fanOutRole).toBe("parent");
    expect(result.parent.status).toBe("succeeded");
    expect(result.parent.predecessorId).toBe(implParent.id);
    expect(result.parent.subStages).toHaveLength(3);

    // Each mirror child should link to its upstream counterpart + inherit affects.
    expect(result.children).toHaveLength(3);
    for (let i = 0; i < 3; i += 1) {
      const mirror = result.children[i]!;
      const upstream = implChildren[i]!;
      expect(mirror.predecessorId).toBe(upstream.id);
      expect(mirror.affects).toEqual(upstream.affects);
      expect(mirror.fanOutRole).toBe("child");
      expect(mirror.parentStageRunId).toBe(result.parent.id);
      expect(mirror.status).toBe("succeeded");
    }
  });

  it("blocked when upstream has a failed child (scheduler returns blocked)", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor({ failOnSubStages: ["frontend"] }),
    });

    const { parent: implParent } = await runner.runFanOutParent({
      stage: "implement",
      concurrencyCap: 3,
      children: [...STANDARD_CHILDREN],
    });
    expect(implParent.status).toBe("failed");

    const result = await runner.runFanInChildren({
      upstreamParentId: implParent.id,
      downstreamStage: "verify",
    });
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") return;
    expect(result.decision.kind).toBe("blocked");
    if (result.decision.kind !== "blocked") return;
    expect(result.decision.reason).toBe("upstream-child-failed");
  });

  it("rejects downstream stage outside FAN_OUT_ALLOWED_STAGES whitelist", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor(),
    });

    const { parent: implParent } = await runner.runFanOutParent({
      stage: "implement",
      children: [...STANDARD_CHILDREN.slice(0, 2)],
    });

    // integrate is the fan-in aggregation terminal, not a fan-out source per Q1b.
    await expect(
      runner.runFanInChildren({
        upstreamParentId: implParent.id,
        downstreamStage: "integrate" as never,
      }),
    ).rejects.toThrow(/FAN_OUT_ALLOWED_STAGES/);
  });

  it("rejects when upstream id is not a fan-out parent", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor(),
    });

    const normalRun = await runner.runStage({ stage: "intake" });
    await expect(
      runner.runFanInChildren({
        upstreamParentId: normalRun.id,
        downstreamStage: "verify",
      }),
    ).rejects.toThrow(/not a fan-out parent/);
  });

  it("retry-success path: after retry-child recovers, fan-in dispatch becomes ready", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor({
        failFirstAttemptOnSubStages: ["tests"],
      }),
    });

    // Initial impl fan-out: tests fails first time
    const { parent: implParent, children } = await runner.runFanOutParent({
      stage: "implement",
      concurrencyCap: 3,
      children: [...STANDARD_CHILDREN],
    });
    expect(implParent.status).toBe("failed");

    // Fan-in should be blocked
    const blocked = await runner.runFanInChildren({
      upstreamParentId: implParent.id,
      downstreamStage: "verify",
    });
    expect(blocked.kind).toBe("blocked");

    // Retry the failed child — succeeds this time
    const failed = children.find((c) => c.status === "failed")!;
    await runner.runRetryChild({ childId: failed.id });

    // Now fan-in should be ready (parent stays 'failed' per Q5 ¶7 but children
    // are all succeeded — scheduler accepts the retry-recovery path).
    const ready = await runner.runFanInChildren({
      upstreamParentId: implParent.id,
      downstreamStage: "verify",
      concurrencyCap: 3,
    });
    expect(ready.kind).toBe("ready");
    if (ready.kind !== "ready") return;
    expect(ready.parent.status).toBe("succeeded");
    expect(ready.children).toHaveLength(3);
  });
});
