// MockStageExecutor — Phase 2 stub for stage execution.
//
// Produces a deterministic synthetic artifact per stage, WITHOUT spawning
// `claude --print` or any external agent. Used for:
// - Integration tests of the 10-stage chain
// - `aisep run --dry` (preview the chain without burning tokens)
//
// The real executor (spawn-based, Handlebars-rendered) lives in
// `aisep-agents` and will be wired in Phase 2.5.

import { hashString } from "@claude-web/aisep-core";
import type {
  AisepArtifact,
  AisepArtifactKind,
  AisepStage,
} from "@claude-web/aisep-protocol";

import type { StageExecutor, StageExecutorResult } from "@claude-web/aisep-core";

const STAGE_OUTPUT_KIND: Record<AisepStage, AisepArtifactKind> = {
  intake: "intake",
  research: "research",
  plan: "plan",
  architecture: "adr",
  contract: "contract_frozen",
  implement: "patch",
  verify: "verify_report",
  review: "review_verdict",
  integrate: "integration_log",
  retrospect: "retrospect",
};

export interface MockExecutorOptions {
  /** If true, the executor returns ok=false to simulate a failed stage. */
  failOnStages?: AisepStage[];
  /**
   * v0.3 (v1 fan-out Stage 3 prep): fail ONLY when the executor receives
   * a `subStageName` matching one of these. Used to simulate
   * partial-failure boundary cases (1 of N children fails, others
   * succeed). Independent of `failOnStages`.
   */
  failOnSubStages?: string[];
}

export class MockStageExecutor implements StageExecutor {
  constructor(private readonly opts: MockExecutorOptions = {}) {}

  async execute(args: Parameters<StageExecutor["execute"]>[0]): Promise<StageExecutorResult> {
    const kind = STAGE_OUTPUT_KIND[args.stage];
    const key = `${args.stage}.json`;
    const inlineBody = JSON.stringify(
      {
        stage: args.stage,
        phase: args.phase,
        mock: true,
        upstreamArtifactCount: args.upstreamArtifacts.length,
      },
      null,
      2,
    );

    // v0.3 Stage 3.1: if cancel-signal already aborted before/at execute
    // entry, mock returns ok=false with status="cancelled" attempt to
    // mirror real executor behavior (workspace.exec kills via SIGTERM).
    if (args.signal?.aborted) {
      return {
        producedArtifacts: [],
        attempt: {
          invocation: {
            provider: "other",
            model: "mock",
            argv: [],
            cwd: args.workspace.cwd,
            promptHash: hashString(`mock:cancelled:${args.stage}`),
          },
          outputArtifactIds: [],
          reviewState: "draft",
          status: "cancelled",
          exitCode: -1,
          error: "cancelled by sibling failure (mock)",
        },
        ok: false,
      };
    }

    const failByStage = (this.opts.failOnStages ?? []).includes(args.stage);
    const failBySubStage =
      args.subStageName !== undefined &&
      (this.opts.failOnSubStages ?? []).includes(args.subStageName);
    const ok = !failByStage && !failBySubStage;
    const promptHash = hashString(`mock:${args.stage}:${args.phase}`);

    const producedArtifact = {
      workspaceId: args.workspace.meta.id,
      stageRunId: "",   // runner fills this
      ref: { kind, key },
      contentHash: hashString(inlineBody),
      storage: "inline",
      contentUri: "sqlite://artifact_blob/mock",
      contentInline: inlineBody,
      sizeBytes: Buffer.byteLength(inlineBody, "utf-8"),
    } as Omit<AisepArtifact, "id" | "producedAt">;

    return {
      producedArtifacts: ok ? [producedArtifact] : [],
      attempt: {
        invocation: {
          provider: "other",
          model: "mock",
          argv: [],
          cwd: args.workspace.cwd,
          promptHash,
        },
        outputArtifactIds: [],
        reviewState: "draft",
        status: ok ? "succeeded" : "failed",
        exitCode: ok ? 0 : 1,
        ...(ok ? {} : { error: `Mock failure for stage ${args.stage}` }),
      },
      ok,
    };
  }
}
