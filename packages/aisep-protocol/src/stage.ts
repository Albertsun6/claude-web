// 10-stage AISEP methodology + DAG-ready StageRun.
// Spec: docs/aisep/02_methodology-v0.1.md
// architecture stage internal phases: docs/aisep/03_architecture-stage-spec.md
//
// Round-2 change (per reviewer-cross + vessel-architect M1):
// - AisepStageRunSchema now uses a discriminated union on `phase` so
//   `sliceIndex`/`sliceTotal` can only appear when phase ==
//   "architecture-detail-slice", and MUST appear when it does.

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
 * - none: applies to all non-architecture stages AND to the architecture
 *   stage row itself (the parent that owns Phase A + B slices)
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

const StageRunCommonShape = {
  id: OpaqueIdSchema,
  workspaceId: OpaqueIdSchema,
  stage: AisepStageSchema,
  /** v0: single predecessor; v2+: lift to array (separate field). */
  predecessorId: OpaqueIdSchema.optional(),
  successorId: OpaqueIdSchema.optional(),
  status: AisepStageStatusSchema,
  /** sha256 of merged upstream artifact contents (decides freshness). */
  inputHash: ContentHashSchema.optional(),
  startedAt: EpochMsSchema.optional(),
  endedAt: EpochMsSchema.optional(),
};

const AisepStageRunNoneSchema = z.object({
  ...StageRunCommonShape,
  phase: z.literal("none"),
}).strict();

const AisepStageRunBriefSchema = z.object({
  ...StageRunCommonShape,
  phase: z.literal("architecture-brief"),
}).strict();

const AisepStageRunSliceSchema = z.object({
  ...StageRunCommonShape,
  phase: z.literal("architecture-detail-slice"),
  /** Phase B slice index (1-based). Required when phase = architecture-detail-slice. */
  sliceIndex: z.number().int().min(1),
  /** Total slices planned for the parent architecture stage_run. */
  sliceTotal: z.number().int().min(1),
}).strict();

/**
 * AisepStageRun — one execution of one stage in one workspace.
 *
 * Discriminated by `phase`: only `architecture-detail-slice` carries
 * slice fields; everything else cannot (`.strict()` rejects extras).
 *
 * v0: single predecessor / single successor (linear). v2+ adds fan-in
 * by lifting predecessorId to a separate predecessors[] field.
 */
export const AisepStageRunSchema = z.discriminatedUnion("phase", [
  AisepStageRunNoneSchema,
  AisepStageRunBriefSchema,
  AisepStageRunSliceSchema,
]);
export type AisepStageRun = z.infer<typeof AisepStageRunSchema>;
