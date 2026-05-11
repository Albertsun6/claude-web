// Attempt = a single AI invocation within a stage_run. Multiple attempts
// per stage_run (M4 red line: review stage ≤ 2 attempts; superscope cut).

import { z } from "zod";
import { ContentHashSchema, EpochMsSchema, OpaqueIdSchema } from "./common.js";

/**
 * Lifecycle status of one attempt.
 * Distinct from stage-run status because a stage_run can have multiple
 * attempts with different terminal statuses.
 */
export const AisepAttemptStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "timeout",
  "cancelled",
]);
export type AisepAttemptStatus = z.infer<typeof AisepAttemptStatusSchema>;

/** Adversarial self-review state machine (M3/M4 in architecture stage spec). */
export const AisepAttemptReviewStateSchema = z.enum([
  "draft",            // raw AI output
  "fact_checked",     // AI ran adversarial self-review (3+ strongest counter-arguments)
  "approved",         // human final ack
]);
export type AisepAttemptReviewState = z.infer<typeof AisepAttemptReviewStateSchema>;

/** What command produced this attempt. Critical for AlphaEvolve memory provenance. */
export const AisepAgentInvocationSchema = z.object({
  /** Executable, e.g. "claude --print", "cursor-agent --mode plan". */
  cmd: z.string().min(1),
  cwd: z.string().min(1),
  /** Model id, e.g. "claude-opus-4-7", "gpt-5.5-medium". */
  model: z.string().min(1),
  /** sha256 of the rendered prompt — allows replay + retrieval dedup. */
  promptHash: ContentHashSchema,
});
export type AisepAgentInvocation = z.infer<typeof AisepAgentInvocationSchema>;

/**
 * AisepAttempt — one execution attempt of a stage_run.
 *
 * Red lines:
 * - M4: architecture stage review attempts: attemptN ≤ 2 (no 3rd ping-pong;
 *   cut scope instead)
 */
export const AisepAttemptSchema = z.object({
  id: OpaqueIdSchema,
  stageRunId: OpaqueIdSchema,
  /** 1-based attempt number. */
  attemptN: z.number().int().min(1).max(2),
  invocation: AisepAgentInvocationSchema,
  reviewState: AisepAttemptReviewStateSchema.default("draft"),
  outputArtifactIds: z.array(OpaqueIdSchema).default([]),
  status: AisepAttemptStatusSchema,
  /** Process exit code; null if attempt was cancelled before spawning. */
  exitCode: z.number().int().nullable(),
  /** URI to stdout log file. */
  stdoutUri: z.string().optional(),
  stderrUri: z.string().optional(),
  /** Short error description if status ∈ {failed, timeout}. */
  error: z.string().optional(),
  startedAt: EpochMsSchema,
  endedAt: EpochMsSchema,
});
export type AisepAttempt = z.infer<typeof AisepAttemptSchema>;
