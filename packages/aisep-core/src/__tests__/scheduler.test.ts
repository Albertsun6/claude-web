// v1 fan-out Stage 1 — scheduler.nextReady() unit tests.

import { describe, expect, it } from "vitest";

import { nextReady, type SchedulerInputStageRun } from "../scheduler.js";

const PARENT = "sr-parent-01HJK5X";

function mkChild(
  id: string,
  status: SchedulerInputStageRun["status"],
  parent: string = PARENT,
): SchedulerInputStageRun {
  return { id, status, fanOutRole: "child", parentStageRunId: parent };
}

describe("scheduler.nextReady (Phase 2.E v1 fan-out Stage 1)", () => {
  it("empty input → no ready, no running, allTerminal=false (no children at all)", () => {
    const r = nextReady(PARENT, [], 4);
    expect(r.readyToDispatch).toEqual([]);
    expect(r.currentlyRunning).toBe(0);
    expect(r.allChildrenTerminal).toBe(false);
    expect(r.succeededCount).toBe(0);
    expect(r.failedCount).toBe(0);
  });

  it("0 running + 3 pending + cap 2 → 2 ready in input order", () => {
    const r = nextReady(
      PARENT,
      [
        mkChild("a", "pending"),
        mkChild("b", "pending"),
        mkChild("c", "pending"),
      ],
      2,
    );
    expect(r.readyToDispatch).toEqual(["a", "b"]);
    expect(r.currentlyRunning).toBe(0);
    expect(r.allChildrenTerminal).toBe(false);
  });

  it("2 running + 1 pending + cap 2 → 0 ready (saturated)", () => {
    const r = nextReady(
      PARENT,
      [
        mkChild("a", "running"),
        mkChild("b", "running"),
        mkChild("c", "pending"),
      ],
      2,
    );
    expect(r.readyToDispatch).toEqual([]);
    expect(r.currentlyRunning).toBe(2);
  });

  it("1 running + 3 pending + cap 4 → 3 ready (fills to cap)", () => {
    const r = nextReady(
      PARENT,
      [
        mkChild("a", "running"),
        mkChild("b", "pending"),
        mkChild("c", "pending"),
        mkChild("d", "pending"),
      ],
      4,
    );
    expect(r.readyToDispatch).toEqual(["b", "c", "d"]);
    expect(r.currentlyRunning).toBe(1);
  });

  it("all children terminal (succeeded) → allChildrenTerminal=true", () => {
    const r = nextReady(
      PARENT,
      [
        mkChild("a", "succeeded"),
        mkChild("b", "succeeded"),
        mkChild("c", "succeeded"),
      ],
      4,
    );
    expect(r.readyToDispatch).toEqual([]);
    expect(r.allChildrenTerminal).toBe(true);
    expect(r.succeededCount).toBe(3);
    expect(r.failedCount).toBe(0);
  });

  it("mixed terminal statuses (succeeded + failed + cancelled) → allChildrenTerminal=true", () => {
    const r = nextReady(
      PARENT,
      [
        mkChild("a", "succeeded"),
        mkChild("b", "failed"),
        mkChild("c", "cancelled"),
      ],
      4,
    );
    expect(r.allChildrenTerminal).toBe(true);
    expect(r.succeededCount).toBe(1);
    expect(r.failedCount).toBe(2);
  });

  it("skipped status doesn't block parent settle", () => {
    const r = nextReady(
      PARENT,
      [mkChild("a", "succeeded"), mkChild("b", "skipped")],
      4,
    );
    expect(r.allChildrenTerminal).toBe(true);
    expect(r.succeededCount).toBe(1);
  });

  it("non-child runs (parent / normal) are ignored", () => {
    const runs: SchedulerInputStageRun[] = [
      { id: PARENT, status: "running", fanOutRole: "parent" },
      { id: "sr-normal", status: "running", fanOutRole: "normal" },
      mkChild("c", "pending"),
    ];
    const r = nextReady(PARENT, runs, 4);
    expect(r.readyToDispatch).toEqual(["c"]);
    expect(r.currentlyRunning).toBe(0);   // parent's own "running" doesn't count
  });

  it("children of a different parent are ignored", () => {
    const r = nextReady(
      PARENT,
      [
        mkChild("a", "pending", PARENT),
        mkChild("b", "running", "sr-other-parent"),
        mkChild("c", "pending", "sr-other-parent"),
      ],
      4,
    );
    expect(r.readyToDispatch).toEqual(["a"]);
    expect(r.currentlyRunning).toBe(0);
  });

  it("concurrencyCap = 0 → no dispatch even if pending exists", () => {
    const r = nextReady(PARENT, [mkChild("a", "pending"), mkChild("b", "pending")], 0);
    expect(r.readyToDispatch).toEqual([]);
  });

  it("concurrencyCap negative clamped to 0", () => {
    const r = nextReady(PARENT, [mkChild("a", "pending")], -1);
    expect(r.readyToDispatch).toEqual([]);
  });
});
