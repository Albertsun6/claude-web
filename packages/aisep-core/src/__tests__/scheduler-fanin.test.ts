// v2 fan-in Stage 1 — scheduler.nextReadyFanInDispatch() unit tests.
//
// Spec: docs/proposals/aisep-v2-fan-in.md §Q2 (separate API) + §Q3 (stage-pair
// fan-in only) + §Q5 (retry semantics) + ADR-022 Decision 2 (migratedFromV03
// forensic marker).

import { describe, expect, it } from "vitest";

import {
  nextReadyFanInDispatch,
  type FanInDispatchInput,
  type SchedulerInputStageRun,
} from "../scheduler.js";

const PARENT_ID = "sr-parent-01HJK5X";

function mkParent(
  status: SchedulerInputStageRun["status"],
): SchedulerInputStageRun {
  return { id: PARENT_ID, status, fanOutRole: "parent" };
}

function mkChild(
  id: string,
  status: SchedulerInputStageRun["status"],
  opts: { migratedFromV03?: boolean } = {},
): SchedulerInputStageRun {
  return {
    id,
    status,
    fanOutRole: "child",
    parentStageRunId: PARENT_ID,
    migratedFromV03: opts.migratedFromV03,
  };
}

function mkDownstream(
  id: string,
  predecessorId: string | undefined,
  status: SchedulerInputStageRun["status"] = "pending",
): SchedulerInputStageRun {
  return {
    id,
    status,
    fanOutRole: "child",
    parentStageRunId: "sr-downstream-parent",
    predecessorId,
  };
}

function buildInput(
  parent: SchedulerInputStageRun,
  upstreamChildren: SchedulerInputStageRun[],
  existingDownstream: SchedulerInputStageRun[] = [],
): FanInDispatchInput {
  return { parentRun: parent, upstreamChildren, existingDownstream };
}

describe("scheduler.nextReadyFanInDispatch (v2 fan-in Stage 1)", () => {
  describe("step 1: parent must be terminal", () => {
    it("blocks when parent.status === 'running'", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("running"), [mkChild("a", "succeeded")]),
      );
      expect(r.kind).toBe("blocked");
      expect((r as { reason: string }).reason).toBe("parent-not-terminal");
      expect((r as { offending: string[] }).offending).toEqual([]);
    });

    it("blocks when parent.status === 'pending'", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("pending"), [mkChild("a", "succeeded")]),
      );
      expect(r.kind).toBe("blocked");
      expect((r as { reason: string }).reason).toBe("parent-not-terminal");
    });

    it("proceeds past step 1 when parent.status === 'succeeded'", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("succeeded"), [mkChild("a", "succeeded")]),
      );
      expect(r.kind).toBe("ready");
    });

    it("proceeds past step 1 when parent.status === 'failed' (retry-recovery path)", () => {
      // Q5 step 1 says parent.status ∈ {failed, succeeded} both ok for retry-child
      // / fan-in evaluation. After retry-child success, parent stays at original
      // 'failed' but children may all be succeeded again.
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("failed"), [
          mkChild("a", "succeeded"),
          mkChild("b", "succeeded"),
        ]),
      );
      expect(r.kind).toBe("ready");
    });

    it("proceeds past step 1 when parent.status === 'cancelled'", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("cancelled"), [mkChild("a", "succeeded")]),
      );
      expect(r.kind).toBe("ready");
    });
  });

  describe("step 2: upstream children must all be terminal=succeeded", () => {
    it("blocks 'upstream-child-running' when a child is mid-retry", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("failed"), [
          mkChild("a", "succeeded"),
          mkChild("b", "running"), // retry in flight
          mkChild("c", "succeeded"),
        ]),
      );
      expect(r.kind).toBe("blocked");
      expect((r as { reason: string }).reason).toBe("upstream-child-running");
      expect((r as { offending: string[] }).offending).toEqual(["b"]);
    });

    it("blocks 'upstream-child-pending' when a child never started", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("succeeded"), [
          mkChild("a", "succeeded"),
          mkChild("b", "pending"),
        ]),
      );
      expect(r.kind).toBe("blocked");
      expect((r as { reason: string }).reason).toBe("upstream-child-pending");
      expect((r as { offending: string[] }).offending).toEqual(["b"]);
    });

    it("blocks 'upstream-child-failed' for failed child", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("failed"), [
          mkChild("a", "succeeded"),
          mkChild("b", "failed"),
        ]),
      );
      expect(r.kind).toBe("blocked");
      expect((r as { reason: string }).reason).toBe("upstream-child-failed");
      expect((r as { offending: string[] }).offending).toEqual(["b"]);
    });

    it("treats cancelled upstream child as 'upstream-child-failed' for dispatch purposes", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("failed"), [
          mkChild("a", "succeeded"),
          mkChild("b", "cancelled"),
        ]),
      );
      expect(r.kind).toBe("blocked");
      expect((r as { reason: string }).reason).toBe("upstream-child-failed");
    });

    it("treats skipped upstream child as success (does not block dispatch)", () => {
      // skipped is terminal but signals "intentionally not run"; downstream
      // mirror still dispatches for siblings.
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("succeeded"), [
          mkChild("a", "succeeded"),
          mkChild("b", "skipped"),
        ]),
      );
      expect(r.kind).toBe("ready");
    });

    it("priority: running > pending > failed when multiple blocking statuses", () => {
      // Runner should clear running first (wait for it), then pending (start them),
      // then failed (retry-child). Scheduler reports the highest-priority blocker.
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("failed"), [
          mkChild("a", "failed"),
          mkChild("b", "running"),
          mkChild("c", "pending"),
        ]),
      );
      expect(r.kind).toBe("blocked");
      expect((r as { reason: string }).reason).toBe("upstream-child-running");
      expect((r as { offending: string[] }).offending).toEqual(["b"]);
    });

    it("collects ALL offenders of the blocking status class", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("failed"), [
          mkChild("a", "failed"),
          mkChild("b", "succeeded"),
          mkChild("c", "failed"),
          mkChild("d", "cancelled"),
        ]),
      );
      expect(r.kind).toBe("blocked");
      expect((r as { reason: string }).reason).toBe("upstream-child-failed");
      expect((r as { offending: string[] }).offending).toEqual(["a", "c", "d"]);
    });
  });

  describe("step 3: migratedFromV03 marker prevents fresh dispatch (Decision 2)", () => {
    it("blocks 'upstream-child-migrated' when any child is migrated", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("succeeded"), [
          mkChild("a", "succeeded"),
          mkChild("b", "succeeded", { migratedFromV03: true }),
        ]),
      );
      expect(r.kind).toBe("blocked");
      expect((r as { reason: string }).reason).toBe("upstream-child-migrated");
      expect((r as { offending: string[] }).offending).toEqual(["b"]);
    });

    it("collects ALL migrated children as offenders", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("succeeded"), [
          mkChild("a", "succeeded", { migratedFromV03: true }),
          mkChild("b", "succeeded"),
          mkChild("c", "succeeded", { migratedFromV03: true }),
        ]),
      );
      expect(r.kind).toBe("blocked");
      expect((r as { reason: string }).reason).toBe("upstream-child-migrated");
      expect((r as { offending: string[] }).offending).toEqual(["a", "c"]);
    });

    it("running status takes priority over migrated marker", () => {
      // running upstream child with migrated marker on a sibling: runner should
      // see 'running' first (wait), then 'migrated' (re-plan needed).
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("failed"), [
          mkChild("a", "running"),
          mkChild("b", "succeeded", { migratedFromV03: true }),
        ]),
      );
      expect(r.kind).toBe("blocked");
      expect((r as { reason: string }).reason).toBe("upstream-child-running");
    });
  });

  describe("step 4: ready dispatch", () => {
    it("all-succeeded + no existing downstream → toCreate all, alreadyMirrored empty", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("succeeded"), [
          mkChild("a", "succeeded"),
          mkChild("b", "succeeded"),
          mkChild("c", "succeeded"),
        ]),
      );
      expect(r.kind).toBe("ready");
      expect((r as { toCreate: string[] }).toCreate).toEqual(["a", "b", "c"]);
      expect((r as { alreadyMirrored: string[] }).alreadyMirrored).toEqual([]);
    });

    it("all-succeeded + partial existing downstream → split toCreate/alreadyMirrored", () => {
      const r = nextReadyFanInDispatch(
        buildInput(
          mkParent("succeeded"),
          [
            mkChild("a", "succeeded"),
            mkChild("b", "succeeded"),
            mkChild("c", "succeeded"),
          ],
          [mkDownstream("sr-verify-1", "a")],
        ),
      );
      expect(r.kind).toBe("ready");
      expect((r as { toCreate: string[] }).toCreate).toEqual(["b", "c"]);
      expect((r as { alreadyMirrored: string[] }).alreadyMirrored).toEqual(["a"]);
    });

    it("all-succeeded + all downstream exist → toCreate empty, alreadyMirrored all", () => {
      const r = nextReadyFanInDispatch(
        buildInput(
          mkParent("succeeded"),
          [
            mkChild("a", "succeeded"),
            mkChild("b", "succeeded"),
            mkChild("c", "succeeded"),
          ],
          [
            mkDownstream("sr-v-1", "a"),
            mkDownstream("sr-v-2", "b"),
            mkDownstream("sr-v-3", "c"),
          ],
        ),
      );
      expect(r.kind).toBe("ready");
      expect((r as { toCreate: string[] }).toCreate).toEqual([]);
      expect((r as { alreadyMirrored: string[] }).alreadyMirrored).toEqual([
        "a",
        "b",
        "c",
      ]);
    });

    it("dispatch after retry-success (parent='failed' + all children now succeeded)", () => {
      // Earlier: child 'b' failed → parent flipped to 'failed'. User ran
      // `aisep run --retry-child b` → b succeeded. Parent stays at 'failed'
      // (per Q5 ¶7), but downstream dispatch is now allowed since all children
      // are terminal=succeeded.
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("failed"), [
          mkChild("a", "succeeded"),
          mkChild("b", "succeeded"), // retry-recovered
          mkChild("c", "succeeded"),
        ]),
      );
      expect(r.kind).toBe("ready");
      expect((r as { toCreate: string[] }).toCreate).toEqual(["a", "b", "c"]);
    });

    it("toCreate order matches upstreamChildren input order (determinism)", () => {
      // Caller is expected to pass plan-stage-declared order. Scheduler
      // preserves it.
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("succeeded"), [
          mkChild("c", "succeeded"),
          mkChild("a", "succeeded"),
          mkChild("b", "succeeded"),
        ]),
      );
      expect((r as { toCreate: string[] }).toCreate).toEqual(["c", "a", "b"]);
    });

    it("downstream without predecessorId is ignored (does not claim mirror)", () => {
      // Defensive: a corrupt downstream row (missing predecessorId) cannot
      // shadow upstream children.
      const r = nextReadyFanInDispatch(
        buildInput(
          mkParent("succeeded"),
          [mkChild("a", "succeeded"), mkChild("b", "succeeded")],
          [mkDownstream("sr-orphan", undefined)],
        ),
      );
      expect(r.kind).toBe("ready");
      expect((r as { toCreate: string[] }).toCreate).toEqual(["a", "b"]);
      expect((r as { alreadyMirrored: string[] }).alreadyMirrored).toEqual([]);
    });

    it("downstream pointing at an unrelated id is ignored", () => {
      const r = nextReadyFanInDispatch(
        buildInput(
          mkParent("succeeded"),
          [mkChild("a", "succeeded")],
          [mkDownstream("sr-stale", "sr-from-different-fan-out")],
        ),
      );
      expect(r.kind).toBe("ready");
      expect((r as { toCreate: string[] }).toCreate).toEqual(["a"]);
    });
  });

  describe("edge cases", () => {
    it("0 upstream children + terminal parent → ready with empty arrays (defensive)", () => {
      // In practice a parent without subStages would fail schema validation
      // (subStages non-empty for fanOutRole='parent'). Scheduler defends
      // against degenerate input by returning a no-op ready result.
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("succeeded"), []),
      );
      expect(r.kind).toBe("ready");
      expect((r as { toCreate: string[] }).toCreate).toEqual([]);
      expect((r as { alreadyMirrored: string[] }).alreadyMirrored).toEqual([]);
    });

    it("explicit migratedFromV03=false equivalent to undefined", () => {
      const r = nextReadyFanInDispatch(
        buildInput(mkParent("succeeded"), [
          { ...mkChild("a", "succeeded"), migratedFromV03: false },
          mkChild("b", "succeeded"),
        ]),
      );
      expect(r.kind).toBe("ready");
    });
  });
});
