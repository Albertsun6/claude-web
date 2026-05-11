// AlphaEvolve two-tier memory (borrowed from newaisep v1.0 MVP).
// Workspace pending → human verify → promote to global.

import { z } from "zod";

import { EpochMsSchema, OpaqueIdSchema } from "./common.js";
import { AisepStageSchema } from "./stage.js";

export const AisepMemorySourceSchema = z.enum([
  "workspace-pending", // local <workspace>/.aisep/evolution_log.json
  "global-verified",   // ~/.aisep/governance-log/evolution_log.json
]);
export type AisepMemorySource = z.infer<typeof AisepMemorySourceSchema>;

export const AisepMemoryVerifiedBySchema = z.enum(["human", "auto"]);
export type AisepMemoryVerifiedBy = z.infer<typeof AisepMemoryVerifiedBySchema>;

/**
 * AisepAppliesTo — retrieval filter when injecting memory hits into context.
 * "*" wildcard matches all values.
 */
export const AisepAppliesToSchema = z.object({
  domain: z.array(z.string()).default(["*"]),
  stage: z.array(AisepStageSchema),
  techStack: z.array(z.string()).default(["*"]),
});
export type AisepAppliesTo = z.infer<typeof AisepAppliesToSchema>;

/**
 * AisepMemoryRecord — one verified-or-pending fix proposition.
 *
 * Lifecycle:
 *   workspace failure → write Pending → human verify → promote to Global
 */
export const AisepMemoryRecordSchema = z.object({
  id: OpaqueIdSchema,
  stage: AisepStageSchema,
  /** Short noun phrase describing the failure (e.g. "phase A skipped Q7 rollback"). */
  failurePattern: z.string().min(1),
  /** Concrete remediation instruction (≤ 500 chars recommended). */
  fix: z.string().min(1),
  source: AisepMemorySourceSchema,
  verifiedBy: AisepMemoryVerifiedBySchema,
  verifiedAt: EpochMsSchema.optional(),
  appliesTo: AisepAppliesToSchema,
  /** Number of times this fix shipped successfully (used for ranking). */
  shipCount: z.number().int().nonnegative().default(0),
  /** Number of times this fix was promoted from pending → global. */
  promoteCount: z.number().int().nonnegative().default(0),
  /** Original workspace that surfaced this pattern (e.g. "vessel", "my-erp"). */
  sourceWorkspaceId: OpaqueIdSchema.optional(),
});
export type AisepMemoryRecord = z.infer<typeof AisepMemoryRecordSchema>;

/** Full file contents of evolution_log.json (versioned for forward-compat). */
export const AisepEvolutionLogV1Schema = z.object({
  version: z.literal(1),
  records: z.array(AisepMemoryRecordSchema),
});
export type AisepEvolutionLogV1 = z.infer<typeof AisepEvolutionLogV1Schema>;
