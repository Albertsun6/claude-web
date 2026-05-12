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

import type {
  AisepArtifact,
  AisepAttempt,
  AisepStage,
  AisepStagePhase,
  AisepStageRun,
  AisepWorkspace,
} from "@claude-web/aisep-protocol";

import { ids } from "./ids.js";
import { nextReady, type SchedulerInputStageRun } from "./scheduler.js";
import type { AisepStore } from "./store.js";

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
   * v1 Scope: only `stage === "implement"` is fan-out-able per superRefine
   * invariant.
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
    /** Declared sub-implements; v1 limits stage to "implement". */
    children: Array<{ name: string }>;
    /**
     * Max concurrent children dispatched at a time (v1 plan-roadmap cap
     * = 4; user-tunable via CLI `--concurrency`). When omitted, defaults
     * to 1 (serial dispatch, preserves Stage 2.runner behavior).
     */
    concurrencyCap?: number;
  }): Promise<{ parent: AisepStageRun; children: AisepStageRun[] }> {
    const { store, workspace, executor } = this.opts;

    if (args.stage !== "implement") {
      throw new Error(
        `runFanOutParent: v1 limits fan-out to stage="implement"; got stage="${args.stage}"`,
      );
    }
    if (args.children.length < 2) {
      throw new Error(
        `runFanOutParent: a fan-out requires >= 2 children; got ${args.children.length}`,
      );
    }

    // 1. Pre-mint child stage_run ids so we can wire parent.subStages
    //    atomically with the parent's creation.
    const childIds = args.children.map(() => ids.stageRun(this.opts.clock));

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
    const childRuns: AisepStageRun[] = [];
    for (let i = 0; i < args.children.length; i += 1) {
      const child = store.createStageRun({
        id: childIds[i],
        workspaceId: workspace.meta.id,
        stage: args.stage,
        phase: "none",
        fanOutRole: "child",
        parentStageRunId: parent.id,
      } as Omit<AisepStageRun, "id" | "status"> & { id?: string });
      childRuns.push(child);
    }

    // 4. Transition parent to running BEFORE dispatching children.
    store.updateStageRunStatus(parent.id, "running");

    // 5. Dispatch children via scheduler-driven batched parallelism
    //    (v0.3 Stage 2.cli-A — wire scheduler.nextReady + Promise.all).
    //
    //    When concurrencyCap is undefined OR 1, the loop degenerates to
    //    serial dispatch (== Stage 2.runner baseline behavior). When
    //    concurrencyCap >= 2, scheduler picks up to N pending children
    //    each iteration and runs them concurrently via Promise.all.
    const cap = Math.max(1, args.concurrencyCap ?? 1);
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
          this.executeStageRunBody(id, args.stage, "none", childNameById.get(id)),
        ),
      );
      for (const f of finished) {
        finishedById.set(f.id, f);
        const slot = schedulerInput.find((s) => s.id === f.id);
        if (slot) slot.status = f.status;
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
  ): Promise<AisepStageRun> {
    const { store, workspace, executor } = this.opts;

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
