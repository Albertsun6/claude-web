// v1 fan-out Stage 1 — static fan-out scheduler (pure function).
//
// Picks the next batch of ready-to-dispatch child stage_runs respecting
// a concurrency cap. This is the pure-function half of v1; runner
// integration (calling executor + spawning claude subprocesses) lives in
// Stage 2.
//
// R6 boundary: zero fs / spawn / net / store-import. Pure function on
// the input list provided by the caller (typically derived from
// `store.listStageRuns()` filtered to children of a single parent).
//
// Spec: docs/proposals/aisep-v1-fan-out.md v2 §Scope item 3 (ready-queue
// scheduler). Composes with M5 cap (m5-cap.ts) — each child stage_run
// gets its own counter.

import type { AisepStageStatus } from "@claude-web/aisep-protocol";

/** Minimal stage_run shape the scheduler needs. Caller projects this
 *  from `AisepStageRun` (full schema). Decoupling avoids store coupling. */
export interface SchedulerInputStageRun {
  id: string;
  status: AisepStageStatus;
  fanOutRole: "normal" | "parent" | "child";
  /** REQUIRED for `fanOutRole === "child"`; otherwise undefined. */
  parentStageRunId?: string;
}

export interface SchedulerResult {
  /** Child stage_run ids ready to dispatch (status="pending", parent matches, capacity allows). */
  readyToDispatch: string[];
  /** Count of running children of this parent right now. */
  currentlyRunning: number;
  /** True iff every child is in a terminal status (parent can settle). */
  allChildrenTerminal: boolean;
  /** Count of children of this parent in `succeeded` status. */
  succeededCount: number;
  /** Count of children of this parent in `failed` / `cancelled` status. */
  failedCount: number;
}

/** Terminal status set per state-machine.ts. */
function isTerminal(s: AisepStageStatus): boolean {
  return s === "succeeded" || s === "failed" || s === "cancelled" || s === "skipped";
}

/**
 * v1 fan-out Stage 1 — `nextReady(parentStageRunId, childRuns, concurrencyCap)`.
 *
 * Given a list of stage_runs (which may include the parent + N children
 * + unrelated runs), return:
 * - which children are ready to dispatch right now (status="pending"
 *   AND `parentStageRunId === parentStageRunId`)
 * - how many of them to dispatch (so `currentlyRunning + dispatched ≤
 *   concurrencyCap`)
 * - whether parent can settle (allChildrenTerminal)
 *
 * Non-child runs are silently ignored (parent / normal / runs of other
 * parents).
 *
 * Determinism: ready children are picked in input order (caller is
 * expected to pass them in plan-stage-declared order, e.g.
 * backend → frontend → tests).
 *
 * Caller responsibility:
 * - pass `concurrencyCap >= 1` (zero or negative → 0 dispatched but
 *   currentlyRunning / allChildrenTerminal still reported)
 * - pass child runs deterministically ordered (plan-stage order)
 *
 * @param parentStageRunId — the parent whose children we're scheduling
 * @param stageRuns — superset list (will be filtered by parentStageRunId)
 * @param concurrencyCap — max concurrent running children (per v1 plan-roadmap,
 *   default 4 at CLI; user-tunable via `--concurrency`)
 */
export function nextReady(
  parentStageRunId: string,
  stageRuns: readonly SchedulerInputStageRun[],
  concurrencyCap: number,
): SchedulerResult {
  let currentlyRunning = 0;
  let succeededCount = 0;
  let failedCount = 0;
  const pendingChildren: string[] = [];

  for (const run of stageRuns) {
    if (run.fanOutRole !== "child") continue;
    if (run.parentStageRunId !== parentStageRunId) continue;
    switch (run.status) {
      case "running":
        currentlyRunning += 1;
        break;
      case "succeeded":
        succeededCount += 1;
        break;
      case "failed":
      case "cancelled":
        failedCount += 1;
        break;
      case "pending":
        pendingChildren.push(run.id);
        break;
      case "skipped":
        // skipped is terminal but not a failure; treat as succeeded for
        // settle purposes (don't block parent), but don't count in succeeded.
        break;
    }
  }

  const totalChildren = currentlyRunning + succeededCount + failedCount + pendingChildren.length;
  const allChildrenTerminal = totalChildren > 0 && currentlyRunning === 0 && pendingChildren.length === 0;

  const capacity = Math.max(0, concurrencyCap - currentlyRunning);
  const readyToDispatch = pendingChildren.slice(0, capacity);

  return {
    readyToDispatch,
    currentlyRunning,
    allChildrenTerminal,
    succeededCount,
    failedCount,
  };
}
