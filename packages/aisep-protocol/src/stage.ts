// 10-stage AISEP methodology + DAG-ready StageRun.
// Spec: docs/aisep/02_methodology-v0.1.md
// architecture stage internal phases: docs/aisep/03_architecture-stage-spec.md

import { z } from "zod";
import { ContentHashSchema, EpochMsSchema, OpaqueIdSchema } from "./common.js";

/** 10 canonical AISEP stages (Q2 user decision; immutable wire enum). */
export const AisepStageSchema = z.enum([
  "intake",
  "research",
  "plan",
  "architecture",
  "contract",
  "implement",
  "verify",
  "review",
  "integrate",
  "retrospect",
]);
export type AisepStage = z.infer<typeof AisepStageSchema>;

/**
 * architecture stage internal sub-phase (Q8 user decision).
 * - none: applies to all non-architecture stages
 * - architecture-brief: Phase A — "direction gate" (≤ 5pp, ≤ 3 ADR, ≤ 2 figures)
 * - architecture-detail-slice: Phase B — per-slice gate (≤ 4pp / slice, repeatable)
 */
export const AisepStagePhaseSchema = z.enum([
  "none",
  "architecture-brief",
  "architecture-detail-slice",
]);
export type AisepStagePhase = z.infer<typeof AisepStagePhaseSchema>;

/** Stage run lifecycle status (M1 invariant: pending → running → {succeeded|failed|cancelled|skipped}). */
export const AisepStageStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
]);
export type AisepStageStatus = z.infer<typeof AisepStageStatusSchema>;

/**
 * AisepStageRun — one execution of one stage in one workspace.
 * v0: single predecessor / single successor (linear).
 * v2+: predecessorIds becomes array for fan-in.
 */
export const AisepStageRunSchema = z.object({
  id: OpaqueIdSchema,
  workspaceId: OpaqueIdSchema,
  stage: AisepStageSchema,
  phase: AisepStagePhaseSchema.default("none"),
  /** v0: single predecessor; v2+: lift to array (separate field). */
  predecessorId: OpaqueIdSchema.optional(),
  successorId: OpaqueIdSchema.optional(),
  status: AisepStageStatusSchema,
  /** sha256 of merged upstream artifact contents (decides freshness). */
  inputHash: ContentHashSchema.optional(),
  /**
   * Phase B slice index (1-based) — populated only when phase = "architecture-detail-slice".
   * Multiple slice runs share the same parent architecture stage_run.
   */
  sliceIndex: z.number().int().min(1).optional(),
  /** Total slices planned (set when first slice starts; used for "all slices done" check). */
  sliceTotal: z.number().int().min(1).optional(),
  startedAt: EpochMsSchema.optional(),
  endedAt: EpochMsSchema.optional(),
});
export type AisepStageRun = z.infer<typeof AisepStageRunSchema>;
