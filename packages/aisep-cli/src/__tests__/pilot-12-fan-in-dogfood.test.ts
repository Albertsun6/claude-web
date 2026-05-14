// Pilot-12 dogfood — full v2 fan-in chain with all 9 ship gates verified.
//
// Spec: ADR-022 §Dogfood gate (revised post Phase 3). This test is the
// machine-verifiable evidence backing the retrospective doc at
// docs/aisep/retrospectives/pilot-12-fan-in-2026-05-14.md.
//
// The chain exercised:
//   intake → research → plan → architecture → contract
//   → implement (fan-out 3 children: backend, frontend, tests; one fails first time)
//   → retry-child (recovers the failed child)
//   → verify (fan-in 3 mirrors of implement children)
//   → review → integrate → retrospect
//
// Gate coverage (binary-level evidence):
//   1. ✅ 3-child fan-out → 3-child fan-in → integrate aggregation full chain
//   2. ✅ 1-of-3 retry succeeds + parent re-aggregated
//   3. ✅ Conflict detector terminal failure on injected overlap
//   4. (deferred to render-test; covered in Slice 6 report-render.test.ts)
//   5. ✅ pnpm -r test ≥ baseline (asserted in CI run, not in this file)
//   6. (covered by dep-cruiser CI gate, not asserted here)
//   7. ✅ Cross-version round-trip A: v0.3 state.json → v0.4 binary → exit 6
//        (covered in migrate.test.ts; not re-asserted here)
//   8. (covered at protocol layer in v2-fanin.test.ts)
//   9. ✅ Cross-process retry race: 2nd instance acquires-or-fails-cleanly

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireWorkspaceLock,
  AisepRunner,
  AisepStore,
  WorkspaceLockHeldError,
  ids,
} from "@vessel/aisep-core";
import { NodeWorkspace } from "@vessel/aisep-workspace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockStageExecutor } from "../mock-executor.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "aisep-pilot-12-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function newWorkspace() {
  return new NodeWorkspace(cwd, {
    id: ids.workspace(),
    name: "pilot-12-dogfood",
    cwd,
    status: "active",
    techStack: ["typescript", "pnpm-monorepo"],
    createdAt: Date.now(),
    shipCount: 0,
    adoptedPatterns: [],
  });
}

const FAN_OUT_CHILDREN = [
  { name: "backend", affects: ["packages/backend/.*"] },
  { name: "frontend", affects: ["packages/frontend/.*"] },
  { name: "tests", affects: ["packages/shared/test/.*"] },
] as const;

describe("Pilot-12 dogfood — full v2 fan-in chain (ADR-022 ship gates 1, 2, 3, 9)", () => {
  it("gate 1: 3-child fan-out → 3-child fan-in → integrate aggregation succeeds end-to-end", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor(),
    });

    // Pre-fan-out stages run normally (sequential 1:1 chain).
    let lastId: string | undefined;
    for (const stage of ["intake", "research", "plan", "architecture", "contract"] as const) {
      const r = await runner.runStage({
        stage,
        ...(lastId ? { predecessorId: lastId } : {}),
      });
      expect(r.status).toBe("succeeded");
      lastId = r.id;
    }

    // implement fan-out — 3 children, all succeed.
    const implFan = await runner.runFanOutParent({
      stage: "implement",
      predecessorId: lastId,
      concurrencyCap: 3,
      children: [...FAN_OUT_CHILDREN],
    });
    expect(implFan.parent.status).toBe("succeeded");
    expect(implFan.children).toHaveLength(3);
    expect(implFan.children.every((c) => c.status === "succeeded")).toBe(true);

    // verify fan-in — mirror 3 children with Q3 predecessorId linkage.
    const verifyFanIn = await runner.runFanInChildren({
      upstreamParentId: implFan.parent.id,
      downstreamStage: "verify",
      concurrencyCap: 3,
    });
    expect(verifyFanIn.kind).toBe("ready");
    if (verifyFanIn.kind !== "ready") return;
    expect(verifyFanIn.parent.status).toBe("succeeded");
    expect(verifyFanIn.children).toHaveLength(3);
    // Each mirror.predecessorId points at its upstream counterpart (Q3).
    for (let i = 0; i < 3; i += 1) {
      expect(verifyFanIn.children[i]!.predecessorId).toBe(implFan.children[i]!.id);
      expect(verifyFanIn.children[i]!.affects).toEqual(implFan.children[i]!.affects);
    }

    // review fan-in (optional in scope; still in whitelist).
    const reviewFanIn = await runner.runFanInChildren({
      upstreamParentId: verifyFanIn.parent.id,
      downstreamStage: "review",
      concurrencyCap: 3,
    });
    expect(reviewFanIn.kind).toBe("ready");
    if (reviewFanIn.kind !== "ready") return;

    // integrate stage = single aggregation row (per Q1b: integrate is NOT
    // in FAN_OUT_ALLOWED_STAGES; it terminates fan-in).
    const integrate = await runner.runStage({
      stage: "integrate",
      predecessorId: reviewFanIn.parent.id,
    });
    expect(integrate.status).toBe("succeeded");
    expect(integrate.fanOutRole).toBe("normal");

    const retrospect = await runner.runStage({
      stage: "retrospect",
      predecessorId: integrate.id,
    });
    expect(retrospect.status).toBe("succeeded");
  });

  it("gate 2: 1-of-3 retry recovers + parent.patch_set re-aggregated", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor({
        failFirstAttemptOnSubStages: ["backend"],
      }),
    });

    // implement: backend fails first time.
    const implFan = await runner.runFanOutParent({
      stage: "implement",
      concurrencyCap: 3,
      children: [...FAN_OUT_CHILDREN],
    });
    expect(implFan.parent.status).toBe("failed");

    // Fan-in cannot proceed yet.
    const blocked = await runner.runFanInChildren({
      upstreamParentId: implFan.parent.id,
      downstreamStage: "verify",
    });
    expect(blocked.kind).toBe("blocked");

    // Retry the failed child.
    const failed = implFan.children.find((c) => c.status === "failed")!;
    const retried = await runner.runRetryChild({ childId: failed.id });
    expect(retried.status).toBe("succeeded");

    // Parent stays at 'failed' per Q5 ¶7 — verified.
    expect(store.getStageRun(implFan.parent.id)?.status).toBe("failed");

    // Parent's patch_set artifact count grew (re-aggregated).
    const patchSets = store
      .listArtifactsByStageRun(implFan.parent.id)
      .filter((a) => a.ref.kind === "patch_set");
    expect(patchSets.length).toBeGreaterThanOrEqual(2);

    // Fan-in now ready (all children succeeded).
    const ready = await runner.runFanInChildren({
      upstreamParentId: implFan.parent.id,
      downstreamStage: "verify",
      concurrencyCap: 3,
    });
    expect(ready.kind).toBe("ready");
  });

  it("gate 3: conflict detector terminal failure on overlapping affects", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor(),
    });

    // Inject overlap: broad pattern + narrow pattern share "packages/".
    await expect(
      runner.runFanOutParent({
        stage: "implement",
        children: [
          { name: "broad", affects: ["packages/.*"] },
          { name: "narrow", affects: ["packages/backend/.*"] },
        ],
      }),
    ).rejects.toThrow(/declared affects overlap/);

    // No partial state: nothing got dispatched (no stage_run rows created).
    expect(store.listStageRuns({}).length).toBe(0);
  });

  it("gate 9: cross-process retry race — 2nd instance fails fast (R7 workspace lock)", async () => {
    const ws = newWorkspace();
    const store = new AisepStore(cwd, ws.meta.id);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor({
        failFirstAttemptOnSubStages: ["frontend"],
      }),
    });

    const implFan = await runner.runFanOutParent({
      stage: "implement",
      concurrencyCap: 3,
      children: [...FAN_OUT_CHILDREN],
    });
    expect(implFan.parent.status).toBe("failed");
    const failed = implFan.children.find((c) => c.status === "failed")!;

    // Simulate another live process holding the lock (e.g. concurrent
    // `aisep run --retry-child` invocation).
    const otherLock = acquireWorkspaceLock(cwd, "run");
    try {
      // 2nd retry-child must fail fast with WorkspaceLockHeldError.
      await expect(
        runner.runRetryChild({ childId: failed.id }),
      ).rejects.toThrow(WorkspaceLockHeldError);
    } finally {
      otherLock.release();
    }

    // After the holder releases, retry succeeds.
    const retried = await runner.runRetryChild({ childId: failed.id });
    expect(retried.status).toBe("succeeded");
  });
});
