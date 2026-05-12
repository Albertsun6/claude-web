// Review verdicts (Anthropic 2026-03 logic-only review focus inspired).
// Comments MUST bind to artifact + trace_id — no "整体感觉不对" allowed.

import { z } from "zod";

import { AisepArtifactRefSchema } from "./artifact.js";
import { EpochMsSchema, OpaqueIdSchema, TraceIdSchema } from "./common.js";

/** Who is reviewing — supports double-reviewer with heterogeneity. */
export const AisepReviewerKindSchema = z.enum([
  "vessel-architect",   // Claude in main session
  "vessel-pragmatist",  // Claude in main session, different lens
  "reviewer-cross",     // cursor-agent gpt-5.5-medium, heterogeneous lens
  "human",              // user final ack
]);
export type AisepReviewerKind = z.infer<typeof AisepReviewerKindSchema>;

export const AisepCommentSeveritySchema = z.enum(["critical", "major", "minor"]);
export type AisepCommentSeverity = z.infer<typeof AisepCommentSeveritySchema>;

export const AisepCommentActionSchema = z.enum([
  "revise",                  // must be addressed before next stage
  "accept-with-followup",    // can ship; log followup
  "drop",                    // acknowledge but not actionable
]);
export type AisepCommentAction = z.infer<typeof AisepCommentActionSchema>;

/**
 * Every comment MUST bind to a concrete artifact + trace_id.
 * Format `target + traceId + severity + suggestedAction` ensures the
 * comment is mechanically actionable (no vague vibes).
 */
export const AisepCommentSchema = z.object({
  target: AisepArtifactRefSchema,
  traceId: TraceIdSchema,
  severity: AisepCommentSeveritySchema,
  comment: z.string().min(1),
  suggestedAction: AisepCommentActionSchema,
});
export type AisepComment = z.infer<typeof AisepCommentSchema>;

/** Suggested patch attached to a comment (optional). */
export const AisepPatchSchema = z.object({
  target: AisepArtifactRefSchema,
  diff: z.string().min(1),  // unified diff text
});
export type AisepPatch = z.infer<typeof AisepPatchSchema>;

/** Four-way verdict (v0.2: added request_reverify per Phase 2.D #10).
 * `request_reverify` is the reviewer's structured signal "I suspect a
 * verify check is a false positive — re-run check X before re-issuing
 * review". Requires non-empty `{checkId, reason}` payload (enforced
 * at parse boundary via z.discriminatedUnion below). */
export const AisepReviewVerdictKindSchema = z.enum([
  "pass",
  "pass_with_comments",
  "revise_required",
  "request_reverify",
]);
export type AisepReviewVerdictKind = z.infer<typeof AisepReviewVerdictKindSchema>;

/**
 * AisepReviewVerdict — one verdict from one reviewer.
 *
 * v0.2 (per Phase 2.D #10 cross-review B.F2 + A.F2): migrated from a
 * flat object + optional discriminator field to a true
 * `z.discriminatedUnion`. TS narrows `requestReverify` to required when
 * `verdict === "request_reverify"`, forbidden on the other three
 * verdicts. Fails closed at parse boundary — no superRefine indirection.
 *
 * Round-2 history (per reviewer-cross Minor-2): added optional `reviewerId`
 * and `model` so adding a new reviewer (e.g. cursor-agent model variant)
 * doesn't require an enum bump on `AisepReviewerKind`.
 */
const ReviewVerdictBaseFields = {
  id: OpaqueIdSchema,
  stageRunId: OpaqueIdSchema,
  reviewer: AisepReviewerKindSchema,
  /** Opaque id of the reviewer agent / human (e.g. "agent-architect-claude-opus-4-7"). */
  reviewerId: OpaqueIdSchema.optional(),
  /** Concrete model id used (e.g. "claude-opus-4-7", "gpt-5.5-medium"). */
  model: z.string().optional(),
  comments: z.array(AisepCommentSchema).default([]),
  suggestedPatches: z.array(AisepPatchSchema).default([]),
  reviewedAt: EpochMsSchema,
};

const AisepNonReverifyVerdictSchema = z.object({
  ...ReviewVerdictBaseFields,
  verdict: z.enum(["pass", "pass_with_comments", "revise_required"]),
});

const AisepRequestReverifyVerdictSchema = z.object({
  ...ReviewVerdictBaseFields,
  verdict: z.literal("request_reverify"),
  /** REQUIRED payload for request_reverify. v0.2 §Change 2 / B.F4:
   * checkId regex constrained to shell-safe chars to prevent
   * injection via `aisep verify --recheck --check-name <checkId>`.
   * reason capped at 500 chars (B's OQ2 — RISK-Q4-c prompt-injection
   * mitigation). */
  requestReverify: z.object({
    checkId: z.string().regex(/^[A-Za-z0-9_.:-]+$/),
    reason: z.string().min(1).max(500),
  }),
});

export const AisepReviewVerdictSchema = z.discriminatedUnion("verdict", [
  AisepNonReverifyVerdictSchema,
  AisepRequestReverifyVerdictSchema,
]);
export type AisepReviewVerdict = z.infer<typeof AisepReviewVerdictSchema>;
