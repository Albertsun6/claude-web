// v1 fan-out Stage 1 + v2 fan-in dispatch — static fan-out/fan-in scheduler
// (pure functions).
//
// `nextReady`             : v1 fan-out — pick next batch of ready-to-dispatch
//                           pending children under a concurrency cap.
// `nextReadyFanInDispatch`: v2 fan-in — given a terminal fan-out parent + its
//                           upstream children, decide which downstream mirror
//                           stage_runs to create (Candidate B per ADR-022 Q2).
//
// R6 boundary: zero fs / spawn / net / store-import. Pure functions on
// the input list provided by the caller (typically derived from
// `store.listStageRuns()` filtered to one parent's children).
//
// Spec:
//   v1: docs/proposals/aisep-v1-fan-out.md v2 §Scope item 3
//   v2: docs/proposals/aisep-v2-fan-in.md §Q2 (separate dispatch API),
//       §Q3 (stage-pair fan-in only), §Q5 (retry semantics), Decision 2
//       (migratedFromV03 forensic marker prevents fresh dispatch)
//
// Composes with M5 cap (m5-cap.ts) — each child stage_run gets its own counter.

import type { AisepStageStatus } from "@vessel/aisep-protocol";

/** Minimal stage_run shape the scheduler needs. Caller projects this
 *  from `AisepStageRun` (full schema). Decoupling avoids store coupling. */
export interface SchedulerInputStageRun {
  id: string;
  status: AisepStageStatus;
  fanOutRole: "normal" | "parent" | "child";
  /** REQUIRED for `fanOutRole === "child"`; otherwise undefined. */
  parentStageRunId?: string;
  /**
   * v0.4 (ADR-022 Decision 2): forensic audit marker on v0.3-imported
   * child rows. Defaults to false. When true on any upstream child,
   * `nextReadyFanInDispatch` refuses fresh dispatch (read-only forensic
   * only — user must re-plan to get real `affects` values).
   */
  migratedFromV03?: boolean;
  /**
   * v0.4 (ADR-022 Q3): downstream mirror stage_runs link to their
   * upstream-child counterpart via this single predecessorId field
   * (predecessorIds[] explicitly revoked from v0 plan). Used by
   * `nextReadyFanInDispatch` to detect already-mirrored children.
   */
  predecessorId?: string;
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

// ============================================================================
// v2 fan-in dispatch (ADR-022 Q2 Candidate B)
// ============================================================================

export interface FanInDispatchInput {
  /** Upstream fan-out parent. MUST have fanOutRole === 'parent'. */
  parentRun: SchedulerInputStageRun;
  /**
   * All upstream children of the parent (fanOutRole='child',
   * parentStageRunId === parentRun.id). Caller filters by parent id;
   * scheduler does not re-filter.
   */
  upstreamChildren: readonly SchedulerInputStageRun[];
  /**
   * Downstream stage_runs that may already mirror this fan-out. Each
   * downstream mirror has `predecessorId === <upstream child id>`.
   * Caller is responsible for passing only candidates of the correct
   * downstream stage (e.g. only verify-stage runs when fanning into
   * verify). The scheduler does not validate stage values.
   */
  existingDownstream: readonly SchedulerInputStageRun[];
}

export type FanInDispatchBlockedReason =
  /** Parent.status is not terminal (still pending or running). */
  | "parent-not-terminal"
  /** At least one upstream child is `running` (e.g. mid-retry-child). */
  | "upstream-child-running"
  /** At least one upstream child is `pending` (never started). */
  | "upstream-child-pending"
  /** At least one upstream child is `failed` or `cancelled` (not yet retried). */
  | "upstream-child-failed"
  /**
   * At least one upstream child carries `migratedFromV03: true` —
   * forensic audit marker, prevents fresh fan-in dispatch (Decision 2).
   * User must re-plan with real `affects` values before downstream can
   * fan in.
   */
  | "upstream-child-migrated";

export type FanInDispatchDecision =
  | {
      kind: "ready";
      /**
       * Upstream child ids for which a downstream mirror should be
       * created (no existing downstream stage_run has
       * predecessorId === this id). Order matches `upstreamChildren`
       * input order (deterministic).
       */
      toCreate: readonly string[];
      /**
       * Upstream child ids that already have a downstream mirror
       * (skip-creation set). Order matches input order.
       */
      alreadyMirrored: readonly string[];
    }
  | {
      kind: "blocked";
      reason: FanInDispatchBlockedReason;
      /**
       * Offending upstream child ids when applicable (running / pending /
       * failed / migrated). Empty when reason is `parent-not-terminal`.
       */
      offending: readonly string[];
    };

function isTerminalStatus(s: AisepStageStatus): boolean {
  return s === "succeeded" || s === "failed" || s === "cancelled" || s === "skipped";
}

/**
 * `nextReadyFanInDispatch` — decide which downstream mirror stage_runs to
 * create given a terminal fan-out parent + its upstream children + any
 * already-existing downstream mirrors.
 *
 * Decision tree:
 * 1. Parent must be terminal (succeeded / failed / cancelled / skipped).
 *    A `running` or `pending` parent → blocked `parent-not-terminal`.
 *    Per ADR-022 Q5 step 1: parent.status ∈ {failed, succeeded} required
 *    before retry-child or fan-in dispatch evaluation.
 * 2. ALL upstream children must currently be terminal=succeeded (or
 *    skipped, treated as no-op success for dispatch purposes).
 *    Any child running / pending / failed / cancelled blocks dispatch
 *    with the corresponding reason. Caller should retry failed children
 *    via `aisep run --retry-child <id>` before re-calling this function.
 * 3. NO upstream child may carry `migratedFromV03: true`. Migrated rows
 *    have placeholder `affects: [".*"]` which is not safe for fresh
 *    fan-in dispatch (forensic-only marker per Decision 2).
 * 4. For each non-migrated upstream child without an existing downstream
 *    mirror (matched via downstream.predecessorId === upstreamChild.id),
 *    add the upstream id to `toCreate`. Already-mirrored ids go to
 *    `alreadyMirrored`.
 *
 * Determinism: `toCreate` / `alreadyMirrored` are in `upstreamChildren`
 * input order — caller is expected to pass them in plan-stage-declared
 * order.
 *
 * @param input — parent + upstream children + existing downstream candidates
 */
export function nextReadyFanInDispatch(input: FanInDispatchInput): FanInDispatchDecision {
  const { parentRun, upstreamChildren, existingDownstream } = input;

  // Step 1: parent must be terminal.
  if (!isTerminalStatus(parentRun.status)) {
    return {
      kind: "blocked",
      reason: "parent-not-terminal",
      offending: [],
    };
  }

  // Steps 2 + 3: scan upstream children. Collect any blocking reason +
  // its offenders. Block on the FIRST observed offender class in this
  // priority order: running > pending > failed > migrated — matches the
  // order a runner would resolve issues (wait for running, then start
  // pending, then retry failed, then re-plan migrated).
  const running: string[] = [];
  const pending: string[] = [];
  const failed: string[] = [];
  const migrated: string[] = [];

  for (const child of upstreamChildren) {
    if (child.migratedFromV03 === true) {
      migrated.push(child.id);
    }
    switch (child.status) {
      case "running":
        running.push(child.id);
        break;
      case "pending":
        pending.push(child.id);
        break;
      case "failed":
      case "cancelled":
        failed.push(child.id);
        break;
      case "succeeded":
      case "skipped":
        break;
    }
  }

  if (running.length > 0) {
    return { kind: "blocked", reason: "upstream-child-running", offending: running };
  }
  if (pending.length > 0) {
    return { kind: "blocked", reason: "upstream-child-pending", offending: pending };
  }
  if (failed.length > 0) {
    return { kind: "blocked", reason: "upstream-child-failed", offending: failed };
  }
  if (migrated.length > 0) {
    return { kind: "blocked", reason: "upstream-child-migrated", offending: migrated };
  }

  // Step 4: ready to dispatch — partition upstreamChildren by whether
  // a downstream mirror already exists.
  const mirroredUpstreamIds = new Set<string>();
  for (const downstream of existingDownstream) {
    if (downstream.predecessorId !== undefined) {
      mirroredUpstreamIds.add(downstream.predecessorId);
    }
  }

  const toCreate: string[] = [];
  const alreadyMirrored: string[] = [];
  for (const child of upstreamChildren) {
    if (mirroredUpstreamIds.has(child.id)) {
      alreadyMirrored.push(child.id);
    } else {
      toCreate.push(child.id);
    }
  }

  return { kind: "ready", toCreate, alreadyMirrored };
}
