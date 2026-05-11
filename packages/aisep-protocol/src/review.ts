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

/** Three-way verdict (no "needs-discussion" fence-sitting). */
export const AisepReviewVerdictKindSchema = z.enum([
  "pass",
  "pass_with_comments",
  "revise_required",
]);
export type AisepReviewVerdictKind = z.infer<typeof AisepReviewVerdictKindSchema>;

export const AisepReviewVerdictSchema = z.object({
  id: OpaqueIdSchema,
  stageRunId: OpaqueIdSchema,
  reviewer: AisepReviewerKindSchema,
  verdict: AisepReviewVerdictKindSchema,
  comments: z.array(AisepCommentSchema).default([]),
  suggestedPatches: z.array(AisepPatchSchema).default([]),
  reviewedAt: EpochMsSchema,
});
export type AisepReviewVerdict = z.infer<typeof AisepReviewVerdictSchema>;
