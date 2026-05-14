// AisepRunner — orchestrates one stage_run lifecycle.
//
// R6 boundary: runner has NO fs / spawn / network. All side effects flow
// through AisepWorkspace (injected) and StageExecutor (injected by
// aisep-agents). This makes runner unit-testable with mock executors.
//
// v0.3 (v1 fan-out Stage 2.runner): adds `runFanOutParent()` to dispatch
// N child stage_runs from a single parent (fanOutRole tree). v1 Stage 2
// dispatches children serially; Stage 2.cli will add concurrency via
// scheduler.nextReady + Promise.all batching.

import {
  FAN_OUT_ALLOWED_STAGES,
  type AisepArtifact,
  type AisepAttempt,
  type AisepStage,
  type AisepStagePhase,
  type AisepStageRun,
  type AisepWorkspace,
} from "@vessel/aisep-protocol";

import { assertNoAffectsOverlap } from "./affects-overlap.js";
import { ids } from "./ids.js";
import {
  nextReady,
  nextReadyFanInDispatch,
  type FanInDispatchDecision,
  type SchedulerInputStageRun,
} from "./scheduler.js";
import { isTerminal } from "./state-machine.js";
import type { AisepStore } from "./store.js";
import { acquireWorkspaceLock, type LockMode } from "./workspace-lock.js";

/**
 * StageExecutor — interface implemented by aisep-agents.
 *
 * For tests / Phase 2 stub, a mock executor can return synthetic artifacts
 * without spawning anything.
 */
export interface StageExecutor {
  execute(args: StageExecutorArgs): Promise<StageExecutorResult>;
}

export interface StageExecutorArgs {
  stage: AisepStage;
  phase: AisepStagePhase;
  workspace: AisepWorkspace;
  /**
   * Artifacts produced by predecessor stage_run(s). Used by the executor to
   * render prompt context (intake.yaml + plan.md + etc).
   */
  upstreamArtifacts: AisepArtifact[];
  /** Memory hits injected from aisep-memory.retrieve(). */
  memoryHits: unknown[];   // AisepMemoryRecord[] - kept loose to avoid coupling here
  /**
   * v0.3 (v1 fan-out Stage 2.cli-B): when this stage_run is a fan-out
   * child (`fanOutRole === "child"`), this is the sub-stage name
   * declared by the parent (e.g. "backend"/"frontend"/"tests").
   *
   * Executor uses it to:
   * - flow `--sub-name <name>` to the claude CLI argv
   * - name the output file `<stage>-<subName>.md` instead of `<stage>.md`
   * - render template context about which sub-implement this is
   *
   * Caller responsibility: matches /^[A-Za-z0-9_.:-]+$/ (RISK-Q4-c).
   * Absent for fanOutRole="normal" | "parent".
   */
  subStageName?: string;
  /**
   * v0.3 Stage 3.1: AbortSignal for sibling-failure cancellation in
   * fan-out. When the signal aborts (parent observed a child failure),
   * the executor MUST kill its in-flight subprocess via SIGTERM →
   * KILL_GRACE_MS (5s) → SIGKILL per workspace.exec contract.
   *
   * Absent for non-fan-out paths (runStage / fanOutRole="normal").
   */
  signal?: AbortSignal;
}

export interface StageExecutorResult {
  /** Artifacts the executor produced (already written to workspace). */
  producedArtifacts: Array<Omit<AisepArtifact, "id" | "producedAt">>;
  /** Attempt log to be persisted (runner fills stageRunId + attemptN). */
  attempt: Omit<AisepAttempt, "id" | "stageRunId" | "attemptN" | "startedAt" | "endedAt"> & {
    startedAt?: number;
    endedAt?: number;
  };
  /** If true, stage_run is marked succeeded; otherwise failed. */
  ok: boolean;
}

/**
 * Optional memory provider injected by aisep-cli (or whoever owns the
 * AisepMemoryStore instance). The runner does NOT depend on
 * aisep-memory directly (R6 + module dep direction). If absent,
 * memoryHits is always an empty array.
 *
 * R11 red line: retrieve MUST be tier-explicit — implementations choose
 * which tier (typically `global-verified` to avoid mixing low-trust
 * workspace-pending content into prompts).
 */
export interface MemoryProvider {
  retrieve(stage: AisepStage, phase: AisepStagePhase): Promise<unknown[]>;
}

export interface AisepRunnerOptions {
  store: AisepStore;
  workspace: AisepWorkspace;
  executor: StageExecutor;
  /** Optional. If absent, executor receives memoryHits=[] for every stage. */
  memoryProvider?: MemoryProvider;
}

export class AisepRunner {
  constructor(private readonly opts: AisepRunnerOptions) {}

  /**
   * Run a single stage. Creates the stage_run row, drives it through the
   * state machine, persists attempts + artifacts, returns the final row.
   */
  async runStage(args: {
    stage: AisepStage;
    phase?: AisepStagePhase;
    predecessorId?: string;
    /** Slice fields, required when phase = architecture-detail-slice. */
    sliceIndex?: number;
    sliceTotal?: number;
  }): Promise<AisepStageRun> {
    const { store, workspace } = this.opts;
    const phase: AisepStagePhase = args.phase ?? "none";

    // 1. Create row (status=pending).
    const baseFields = {
      workspaceId: workspace.meta.id,
      stage: args.stage,
      ...(args.predecessorId ? { predecessorId: args.predecessorId } : {}),
    };

    const createPayload =
      phase === "architecture-detail-slice"
        ? {
            ...baseFields,
            phase,
            sliceIndex: args.sliceIndex ?? 1,
            sliceTotal: args.sliceTotal ?? 1,
          }
        : { ...baseFields, phase };

    const run = store.createStageRun(createPayload as Omit<AisepStageRun, "id" | "status">);
    return this.executeStageRunBody(run.id, args.stage, phase);
  }

  /**
   * v0.3 (v1 fan-out Stage 2.runner): dispatch a fan-out parent stage_run
   * with N child stage_runs (one per declared sub-implement).
   *
   * v0.4 (v2 fan-in, ADR-022):
   * - stage whitelist widened to FAN_OUT_ALLOWED_STAGES per Q1b
   * - each child REQUIRES `affects: string[]` non-empty (Decision 2)
   * - pre-dispatch `assertNoAffectsOverlap` per Q4 declared-overlap check
   *
   * Stage 2.runner: dispatches children **serially** to keep this layer
   * simple. Stage 2.cli will add concurrency via
   * `scheduler.nextReady(parentId, runs, cap)` + Promise.all batching of
   * the ready batch.
   *
   * Aggregation: after all children terminal, emits a `patch_set` artifact
   * on the parent containing the AisepPatchSetManifest (child stage_run
   * ids + sub-stage names + patch file paths + hashes + byte counts).
   * Parent settles as `succeeded` iff every child succeeded.
   *
   * IDs: pre-mints child ids so parent.subStages and child.parentStageRunId
   * can be wired atomically at create-time (zero invariant-violating
   * intermediate state).
   */
  async runFanOutParent(args: {
    stage: AisepStage;
    predecessorId?: string;
    /**
     * Declared sub-implements. v0.4 REQUIRES `affects` per child (Decision 2):
     * regex patterns declaring which paths the child plans to touch.
     */
    children: Array<{ name: string; affects: string[] }>;
    /**
     * Max concurrent children dispatched at a time (v1 plan-roadmap cap
     * = 4; user-tunable via CLI `--concurrency`). When omitted, defaults
     * to 1 (serial dispatch, preserves Stage 2.runner behavior).
     */
    concurrencyCap?: number;
  }): Promise<{ parent: AisepStageRun; children: AisepStageRun[] }> {
    const { store, workspace, executor: _executor } = this.opts;

    if (!FAN_OUT_ALLOWED_STAGES.has(args.stage)) {
      throw new Error(
        `runFanOutParent: stage='${args.stage}' is not in FAN_OUT_ALLOWED_STAGES (v0.4 Q1b allows: implement, verify, review)`,
      );
    }
    if (args.children.length < 2) {
      throw new Error(
        `runFanOutParent: a fan-out requires >= 2 children; got ${args.children.length}`,
      );
    }
    for (let i = 0; i < args.children.length; i += 1) {
      const child = args.children[i]!;
      if (!Array.isArray(child.affects) || child.affects.length === 0) {
        throw new Error(
          `runFanOutParent: child[${i}] (name='${child.name}') requires non-empty affects: string[] (v0.4 Decision 2)`,
        );
      }
    }
    // v0.4 Q4 pre-dispatch: refuse fan-out if any pair of children's affects
    // share a literal anchor (regex-intersect heuristic, false positives OK,
    // documented limits per proposal §Q4).
    assertNoAffectsOverlap(args.children.map((c) => c.affects));

    // 1. Pre-mint child stage_run ids so we can wire parent.subStages
    //    atomically with the parent's creation.
    const childIds = args.children.map(() =>
      ids.stageRun((this.opts as { clock?: import("./ids.js").IdClock }).clock),
    );

    // 2. Create parent with subStages populated (fanOutRole='parent' invariant).
    const parent = store.createStageRun({
      workspaceId: workspace.meta.id,
      stage: args.stage,
      phase: "none",
      fanOutRole: "parent",
      subStages: childIds,
      ...(args.predecessorId ? { predecessorId: args.predecessorId } : {}),
    } as Omit<AisepStageRun, "id" | "status">);

    // 3. Create children rows pointing at parent (fanOutRole='child' invariant).
    //    v0.4: each child carries its declared affects regex patterns.
    const childRuns: AisepStageRun[] = [];
    for (let i = 0; i < args.children.length; i += 1) {
      const child = store.createStageRun({
        id: childIds[i],
        workspaceId: workspace.meta.id,
        stage: args.stage,
        phase: "none",
        fanOutRole: "child",
        parentStageRunId: parent.id,
        affects: args.children[i]!.affects,
      } as Omit<AisepStageRun, "id" | "status"> & { id?: string });
      childRuns.push(child);
    }

    // 4. Transition parent to running BEFORE dispatching children.
    store.updateStageRunStatus(parent.id, "running");

    // 5. Dispatch children via scheduler-driven batched parallelism
    //    (v0.3 Stage 2.cli-A — wire scheduler.nextReady + Promise.all).
    //
    //    Stage 3.1: AbortController is shared by all in-flight children;
    //    the first child to fail triggers `controller.abort()`, which
    //    cancels every other in-flight sibling (workspace.exec / claude
    //    spawnClaude propagate SIGTERM → 5s → SIGKILL per A.F7).
    const cap = Math.max(1, args.concurrencyCap ?? 1);
    const cancelController = new AbortController();
    const finishedById = new Map<string, AisepStageRun>();
    // Local mutable mirror of child status for the scheduler (we don't
    // want a store re-read on every iteration — pure function semantics
    // expect a snapshot per call).
    const schedulerInput: SchedulerInputStageRun[] = childRuns.map((c) => ({
      id: c.id,
      status: c.status,
      fanOutRole: "child" as const,
      parentStageRunId: parent.id,
    }));

    // Loop until all children are terminal.
    // Each iteration: ask scheduler for ready batch → dispatch via
    // Promise.all → update local mirror with finished statuses.
    // Bounded by total child count (no infinite loop possible).
    for (let iteration = 0; iteration < childRuns.length; iteration += 1) {
      const decision = nextReady(parent.id, schedulerInput, cap);
      if (decision.allChildrenTerminal) break;
      if (decision.readyToDispatch.length === 0) {
        // No new dispatches AND not all terminal — shouldn't happen in
        // the serial-await topology below; defensive break.
        break;
      }

      // Mark scheduled children as running in our mirror (executor will
      // also mark them via store.updateStageRunStatus inside
      // executeStageRunBody).
      for (const id of decision.readyToDispatch) {
        const slot = schedulerInput.find((s) => s.id === id);
        if (slot) slot.status = "running";
      }

      // Dispatch the batch concurrently. Each Promise resolves with the
      // final AisepStageRun (status=succeeded|failed). v0.3
      // (Stage 2.cli-B): flow each child's subStageName to the executor
      // by id-to-name lookup against the declared `args.children` order.
      const childNameById = new Map<string, string>();
      for (let i = 0; i < childRuns.length; i += 1) {
        childNameById.set(childRuns[i]!.id, args.children[i]!.name);
      }
      const finished = await Promise.all(
        decision.readyToDispatch.map((id) =>
          this.executeStageRunBody(
            id,
            args.stage,
            "none",
            childNameById.get(id),
            cancelController.signal,
          ),
        ),
      );
      for (const f of finished) {
        finishedById.set(f.id, f);
        const slot = schedulerInput.find((s) => s.id === f.id);
        if (slot) slot.status = f.status;
      }
      // Stage 3.1: any child failure in this batch triggers
      // cancellation for any subsequent batches (in serial / next loop
      // iteration) and any siblings still in-flight when an earlier
      // dispatch resolved late. Note that within a Promise.all batch
      // siblings already running don't get the signal until the batch
      // settles — that's an acceptable v0.3 tradeoff (batch-level cancel,
      // not within-batch racy cancel; sibling work completed in-flight
      // is recorded normally per RISK-FAN-IN "no partial recovery").
      if (!cancelController.signal.aborted && finished.some((f) => f.status === "failed")) {
        cancelController.abort();
      }
    }

    const finishedChildren = childRuns.map((c) =>
      finishedById.get(c.id) ?? c,
    );

    // 6. Aggregate patch_set manifest on parent.
    //    Note: v1 Stage 2.runner uses synthetic manifest (subStageName =
    //    "child-<index>"); Stage 2.cli will flow real subStageName from
    //    plan-stage parallel: declarations + use it for patch file naming.
    const childPatches = finishedChildren.map((c, idx) => {
      const childArtifacts = store.listArtifactsByStageRun(c.id);
      const firstPatch = childArtifacts.find((a) => a.ref.kind === "patch");
      return {
        subStageId: c.id,
        subStageName: args.children[idx]!.name,
        patchFile: firstPatch?.ref.key ?? `patch/<missing-${idx}>`,
        contentHash:
          firstPatch?.contentHash ??
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        byteCount: firstPatch?.sizeBytes ?? 0,
      };
    });

    const manifestContent = JSON.stringify({ patches: childPatches });
    store.appendArtifact({
      workspaceId: workspace.meta.id,
      stageRunId: parent.id,
      ref: { kind: "patch_set", key: `patch_set/${args.stage}.json` },
      storage: "inline",
      contentUri: `sqlite://artifact_blob/parent-${parent.id}`,
      contentInline: manifestContent,
      contentHash: `sha256:${"0".repeat(64)}`, // Stage 2.runner: placeholder; Stage 2.cli wires real hash
      sizeBytes: Buffer.byteLength(manifestContent, "utf-8"),
    } as Omit<AisepArtifact, "id" | "producedAt">);

    // 7. Settle parent: succeeded iff every child succeeded.
    const allSucceeded = finishedChildren.every((c) => c.status === "succeeded");
    const finalParent = store.updateStageRunStatus(
      parent.id,
      allSucceeded ? "succeeded" : "failed",
    );

    return { parent: finalParent, children: finishedChildren };
  }

  /**
   * v0.4 (v2 fan-in, ADR-022 Decision 4): retry a single failed fan-out
   * child id-stably. Adds a new attempt log entry; the child id is NOT
   * regenerated. Parent's `patch_set` manifest is re-aggregated on success.
   *
   * Q5 retry semantics:
   * 1. Acquire workspace lock (R7); refuse if held by another live process.
   * 2. Verify target is a fan-out child (fanOutRole='child').
   * 3. Verify target child.status === 'failed' (cannot retry running/succeeded).
   * 4. Verify parent.status terminal (per Q5 step 1 + R1 mitigation).
   * 5. Mark child status `failed → running` via retry-marker state-machine
   *    amendment.
   * 6. Spawn executor (existing code path); append new attempt log entry.
   * 7. If child succeeded, re-aggregate parent's `patch_set` manifest.
   * 8. Parent.status is NOT flipped (per Q5 ¶7 "parent stays at original
   *    status until all children terminal again" — downstream fan-in dispatch
   *    is gated on child statuses, NOT parent.status; see Slice 2 scheduler
   *    `nextReadyFanInDispatch` step 1 which accepts parent='failed').
   *
   * Releases the workspace lock on every exit path (error or success).
   *
   * @param args.childId — fan-out child stage_run id to retry
   * @param args.bumpTimeout — when true, executor uses F3-style 1.5× timeout
   *   multiplier (caller responsibility to thread this to the executor).
   *   v0.4 Slice 3 records the intent on the attempt; full executor
   *   integration is in Slice 4 cli `--bump-timeout` plumbing.
   */
  async runRetryChild(args: {
    childId: string;
    bumpTimeout?: boolean;
  }): Promise<AisepStageRun> {
    const { store, workspace } = this.opts;

    // Step 1: workspace lock (R7).
    const lock = acquireWorkspaceLock(workspace.cwd, "retry-child" as LockMode);
    try {
      // Steps 2-4: pre-condition checks.
      const child = store.getStageRun(args.childId);
      if (!child) {
        throw new Error(`runRetryChild: stage_run not found: ${args.childId}`);
      }
      if (child.fanOutRole !== "child") {
        throw new Error(
          `runRetryChild: stage_run ${args.childId} is not a fan-out child (fanOutRole='${child.fanOutRole}')`,
        );
      }
      if (child.status !== "failed") {
        throw new Error(
          `runRetryChild: child ${args.childId} must be status='failed' to retry (got '${child.status}')`,
        );
      }
      if (!child.parentStageRunId) {
        throw new Error(
          `runRetryChild: child ${args.childId} has no parentStageRunId (invariant violation)`,
        );
      }
      const parent = store.getStageRun(child.parentStageRunId);
      if (!parent) {
        throw new Error(
          `runRetryChild: parent stage_run not found: ${child.parentStageRunId}`,
        );
      }
      if (!isTerminal(parent.status)) {
        throw new Error(
          `runRetryChild: parent ${parent.id} must be terminal to retry a child (got '${parent.status}'; per ADR-022 Q5 step 1 + R1)`,
        );
      }

      // Step 5: failed → running via retry-marker amendment.
      store.updateStageRunStatus(child.id, "running", { retryChild: true });

      // Step 6: execute the body (already-in-running variant — does NOT
      // re-transition to running). `bumpTimeout` is recorded in the
      // attempt's error field for forensic traceability (full F3 timeout
      // bump is plumbed through executor in Slice 4).
      const finalChild = await this.executeRunningStageRun(
        child.id,
        child.stage,
        "none",
        undefined, // subStageName flows from plan.md in Slice 4 cli
        undefined, // no AbortSignal for explicit user-driven retry
      );

      // Step 7: if child succeeded, re-aggregate parent's patch_set.
      if (finalChild.status === "succeeded") {
        this.reaggregateParentPatchSet(parent.id);
      }

      return finalChild;
    } finally {
      lock.release();
    }
  }

  /**
   * v0.4 (Slice 3): re-build the patch_set manifest on a fan-out parent
   * after one of its children's status changes via retry. Reads the
   * latest patch artifact from each child + appends a fresh patch_set
   * artifact on the parent. The previous patch_set artifact stays in
   * the artifact log (append-only); consumers should look at the most
   * recent patch_set on the parent.
   */
  private reaggregateParentPatchSet(parentId: string): void {
    const { store, workspace } = this.opts;
    const parent = store.getStageRun(parentId);
    if (!parent || parent.fanOutRole !== "parent") return;

    const childRuns = store.listChildStageRuns(parentId);
    const childPatches = childRuns.map((c, idx) => {
      const childArtifacts = store.listArtifactsByStageRun(c.id);
      const firstPatch = childArtifacts.find((a) => a.ref.kind === "patch");
      return {
        subStageId: c.id,
        subStageName: `child-${idx}`, // Slice 4 cli will pass real subStageName via store metadata
        patchFile: firstPatch?.ref.key ?? `patch/<missing-${idx}>`,
        contentHash:
          firstPatch?.contentHash ??
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        byteCount: firstPatch?.sizeBytes ?? 0,
      };
    });

    const manifestContent = JSON.stringify({ patches: childPatches });
    store.appendArtifact({
      workspaceId: workspace.meta.id,
      stageRunId: parent.id,
      ref: {
        kind: "patch_set",
        key: `patch_set/${parent.stage}-retry-${Date.now()}.json`,
      },
      storage: "inline",
      contentUri: `sqlite://artifact_blob/parent-${parent.id}-retry`,
      contentInline: manifestContent,
      contentHash: `sha256:${"0".repeat(64)}`,
      sizeBytes: Buffer.byteLength(manifestContent, "utf-8"),
    } as Omit<AisepArtifact, "id" | "producedAt">);
  }

  /**
   * Private helper: drive a stage_run already in 'running' status through
   * the executor → persist artifacts + attempt → transition to terminal.
   *
   * Extracted in v0.4 Slice 3 so both `executeStageRunBody` (which
   * transitions pending→running first) and `runRetryChild` (which
   * transitions failed→running via retry-marker first) can share the
   * same post-running execution path.
   */
  private async executeRunningStageRun(
    stageRunId: string,
    stage: AisepStage,
    phase: AisepStagePhase,
    subStageName?: string,
    signal?: AbortSignal,
  ): Promise<AisepStageRun> {
    const { store, workspace, executor } = this.opts;

    let run = store.getStageRun(stageRunId);
    if (!run) throw new Error(`executeRunningStageRun: stage_run not found: ${stageRunId}`);

    const upstreamArtifacts: AisepArtifact[] = run.predecessorId
      ? store.listArtifactsByStageRun(run.predecessorId)
      : [];

    const memoryHits = this.opts.memoryProvider
      ? await this.opts.memoryProvider.retrieve(stage, phase)
      : [];

    try {
      const result = await executor.execute({
        stage,
        phase,
        workspace,
        upstreamArtifacts,
        memoryHits,
        ...(subStageName !== undefined ? { subStageName } : {}),
        ...(signal !== undefined ? { signal } : {}),
      });

      for (const a of result.producedArtifacts) {
        store.appendArtifact({
          ...a,
          workspaceId: workspace.meta.id,
          stageRunId: run.id,
        });
      }

      const latestN = store.latestAttemptN(run.id);
      store.appendAttempt({
        stageRunId: run.id,
        attemptN: latestN + 1,
        ...result.attempt,
      });

      run = store.updateStageRunStatus(run.id, result.ok ? "succeeded" : "failed");
      return run;
    } catch (err) {
      const latestN = store.latestAttemptN(run.id);
      store.appendAttempt({
        stageRunId: run.id,
        attemptN: latestN + 1,
        invocation: {
          provider: "other",
          model: "n/a",
          argv: [],
          cwd: workspace.cwd,
          promptHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
        reviewState: "draft",
        outputArtifactIds: [],
        status: "failed",
        exitCode: -1,
        error: (err as Error).message,
      });
      run = store.updateStageRunStatus(run.id, "failed");
      return run;
    }
  }

  /**
   * Private helper: drive a stage_run (already created in `pending`) through
   * running → succeeded/failed by invoking the executor + persisting
   * artifacts + attempt.
   *
   * Extracted in v0.3 (v1 fan-out Stage 2.runner) so `runStage` (single
   * stage) and `runFanOutParent` (per-child loop) share the same per-row
   * execution code path.
   */
  private async executeStageRunBody(
    stageRunId: string,
    stage: AisepStage,
    phase: AisepStagePhase,
    subStageName?: string,
    signal?: AbortSignal,
  ): Promise<AisepStageRun> {
    const { store, workspace, executor } = this.opts;

    // v0.3 Stage 3.1: if cancel already requested before we even start
    // (e.g. scheduler dispatched us late in a batch where a sibling
    // already failed), short-circuit to cancelled without spawning.
    if (signal?.aborted) {
      let run = store.updateStageRunStatus(stageRunId, "running");
      run = store.updateStageRunStatus(stageRunId, "cancelled");
      return run;
    }

    // Transition to running.
    let run = store.updateStageRunStatus(stageRunId, "running");

    // Gather upstream artifacts from predecessor (single-predecessor v0
    // model; fan-out children inherit from their parent's predecessor
    // by lookup in Stage 2.cli — Stage 2.runner skips this since mock
    // executors don't need real upstream).
    const upstreamArtifacts: AisepArtifact[] = run.predecessorId
      ? store.listArtifactsByStageRun(run.predecessorId)
      : [];

    // Retrieve memoryHits via injected provider (AlphaEvolve loop).
    const memoryHits = this.opts.memoryProvider
      ? await this.opts.memoryProvider.retrieve(stage, phase)
      : [];

    try {
      const result = await executor.execute({
        stage,
        phase,
        workspace,
        upstreamArtifacts,
        memoryHits,
        ...(subStageName !== undefined ? { subStageName } : {}),
        ...(signal !== undefined ? { signal } : {}),
      });

      for (const a of result.producedArtifacts) {
        store.appendArtifact({
          ...a,
          workspaceId: workspace.meta.id,
          stageRunId: run.id,
        });
      }

      const latestN = store.latestAttemptN(run.id);
      store.appendAttempt({
        stageRunId: run.id,
        attemptN: latestN + 1,
        ...result.attempt,
      });

      run = store.updateStageRunStatus(run.id, result.ok ? "succeeded" : "failed");
      return run;
    } catch (err) {
      const latestN = store.latestAttemptN(run.id);
      store.appendAttempt({
        stageRunId: run.id,
        attemptN: latestN + 1,
        invocation: {
          provider: "other",
          model: "n/a",
          argv: [],
          cwd: workspace.cwd,
          promptHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
        reviewState: "draft",
        outputArtifactIds: [],
        status: "failed",
        exitCode: -1,
        error: (err as Error).message,
      });
      run = store.updateStageRunStatus(run.id, "failed");
      return run;
    }
  }
}
