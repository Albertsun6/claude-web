// Attempt = a single AI invocation within a stage_run.
//
// Round-2 changes (per reviewer-cross + vessel-architect arbitration):
// - Removed attemptN.max(2): the ping-pong cap (M4) only applies to review
//   stage and is enforced in aisep-core runtime, not the protocol layer.
// - Split AisepAgentInvocation into provider-neutral envelope:
//   {provider, model, argv, rawCmd?} instead of bare cmd string.
//   Removes Anthropic-CLI leakage into the wire protocol.
// - promptHash JSDoc specifies the exact bytes hashed (UTF-8 of fully
//   rendered prompt after template + context merge).

import { z } from "zod";
import { ContentHashSchema, EpochMsSchema, OpaqueIdSchema } from "./common.js";

/** Lifecycle status of one attempt. */
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

/**
 * Agent provider — provider-neutral envelope.
 * Each provider has its own canonical CLI; `argv` is the agnostic parameter
 * list; `rawCmd` is optional raw command string for audit only.
 *
 * Extending this enum is a MINOR bump.
 */
export const AisepAgentProviderSchema = z.enum([
  "claude-cli",   // anthropic claude CLI (`claude --print`)
  "cursor-agent", // cursor-agent CLI (gpt-5.5-medium, gpt-5.5-high, etc.)
  "codex",        // openai codex CLI
  "gemini-cli",   // google gemini CLI
  "ollama",       // local ollama-coder
  "other",        // escape hatch; populate rawCmd for forensic audit
]);
export type AisepAgentProvider = z.infer<typeof AisepAgentProviderSchema>;

/**
 * Provider-neutral invocation record. Critical for AlphaEvolve memory
 * provenance — same `(provider, model, promptHash)` tuple identifies
 * deterministic runs across providers.
 */
export const AisepAgentInvocationSchema = z.object({
  provider: AisepAgentProviderSchema,
  /** Provider-specific model id, e.g. "claude-opus-4-7", "gpt-5.5-medium", "gemini-2.5-pro". */
  model: z.string().min(1),
  /** argv-style argument list (excluding the executable itself). */
  argv: z.array(z.string()).default([]),
  cwd: z.string().min(1),
  /**
   * Raw command string for forensic audit only — NOT used for replay
   * (use {provider, model, argv} instead). May be omitted in v0.2+.
   */
  rawCmd: z.string().optional(),
  /**
   * sha256 of the **fully rendered prompt** that was sent to the agent.
   *
   * Canonical computation (MUST be implemented identically across all
   * AISEP runtimes for replay/dedup to work):
   *
   *   1. Render Handlebars template with the context bundle data
   *   2. Apply context merge: system prompt + memory hits + artifacts
   *      in the exact order documented in aisep-agents `prompt-compiler.ts`
   *   3. Serialize as UTF-8 bytes (no trailing newline added)
   *   4. sha256(bytes) → "sha256:<hex>"
   *
   * Spec: docs/aisep/02_methodology-v0.1.md §6 (Stage executor pattern).
   * Reference impl: packages/aisep-agents/src/prompt-compiler.ts (Phase 2).
   */
  promptHash: ContentHashSchema,
});
export type AisepAgentInvocation = z.infer<typeof AisepAgentInvocationSchema>;

/**
 * AisepAttempt — one execution attempt of a stage_run.
 *
 * Note: M4 red line (review stage ping-pong ≤ 2) is enforced in
 * `aisep-core` runtime by gate logic scoped to `stage === "review"`,
 * NOT by the schema. Other stages may legitimately retry more times
 * (e.g. flaky integration test rerun).
 */
export const AisepAttemptSchema = z.object({
  id: OpaqueIdSchema,
  stageRunId: OpaqueIdSchema,
  /** 1-based attempt number. */
  attemptN: z.number().int().min(1),
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
