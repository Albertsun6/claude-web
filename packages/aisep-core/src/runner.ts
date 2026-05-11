// AisepRunner — orchestrates one stage_run lifecycle.
//
// R6 boundary: runner has NO fs / spawn / network. All side effects flow
// through AisepWorkspace (injected) and StageExecutor (injected by
// aisep-agents). This makes runner unit-testable with mock executors.

import type {
  AisepArtifact,
  AisepAttempt,
  AisepStage,
  AisepStagePhase,
  AisepStageRun,
  AisepWorkspace,
} from "@claude-web/aisep-protocol";

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
    const { store, workspace, executor } = this.opts;
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

    let run = store.createStageRun(createPayload as Omit<AisepStageRun, "id" | "status">);

    // 2. Transition to running.
    run = store.updateStageRunStatus(run.id, "running");

    // 3. Gather upstream artifacts.
    const upstreamArtifacts: AisepArtifact[] = run.predecessorId
      ? store.listArtifactsByStageRun(run.predecessorId)
      : [];

    // 3b. Retrieve memoryHits via injected provider (AlphaEvolve loop).
    //     If no provider was injected, defaults to empty (R11 compatible).
    const memoryHits = this.opts.memoryProvider
      ? await this.opts.memoryProvider.retrieve(args.stage, phase)
      : [];

    // 4. Execute.
    try {
      const result = await executor.execute({
        stage: args.stage,
        phase,
        workspace,
        upstreamArtifacts,
        memoryHits,
      });

      // 5. Persist artifacts produced.
      for (const a of result.producedArtifacts) {
        store.appendArtifact({
          ...a,
          workspaceId: workspace.meta.id,
          stageRunId: run.id,
        });
      }

      // 6. Persist attempt.
      const latestN = store.latestAttemptN(run.id);
      store.appendAttempt({
        stageRunId: run.id,
        attemptN: latestN + 1,
        ...result.attempt,
      });

      // 7. Finalize stage_run.
      run = store.updateStageRunStatus(run.id, result.ok ? "succeeded" : "failed");
      return run;
    } catch (err) {
      // Executor threw — record as failed attempt.
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
