// 10-stage AISEP methodology + DAG-ready StageRun.
// Spec: docs/aisep/02_methodology-v0.1.md
// architecture stage internal phases: docs/aisep/03_architecture-stage-spec.md
//
// Round-2 change (per reviewer-cross + vessel-architect M1):
// - AisepStageRunSchema now uses a discriminated union on `phase` so
//   `sliceIndex`/`sliceTotal` can only appear when phase ==
//   "architecture-detail-slice", and MUST appear when it does.
//
// v0.3 (v1 fan-out Stage 1, per arbitration A.OQ1 + common-shape path):
// - StageRunCommonShape gains `fanOutRole` / `subStages` / `parentStageRunId`
// - .superRefine on outer schema enforces the parent/child invariants
//   (parent ⟺ subStages non-empty + no parent ref + stage="implement"; etc.)
// - v1 limits parent/child to `stage === "implement"`.
//
// v0.4 (v2 fan-in, ADR-022):
// - StageRunCommonShape gains `affects: string[]` (regex patterns declaring
//   which paths a child plans to touch; required non-empty for child rows
//   per Decision 2). Used by runner's `assertNoAffectsOverlap()` pre-dispatch
//   check (Q4 declared-overlap conflict detection).
// - StageRunCommonShape gains `migratedFromV03?: boolean` audit marker
//   (Decision 2): rows imported by `aisep migrate --to 0.4` carry
//   `affects: [".*"]` + `migratedFromV03: true`; scheduler treats marker
//   as read-only forensic — does NOT trigger fresh fan-in dispatch.
// - FAN_OUT_ALLOWED_STAGES whitelist widens parent/child to
//   {implement, verify, review} per Q1b (stage-pair fan-in only — verify
//   and review fan-in on top of an upstream fan-out, NOT independent
//   fan-out sources for stage_pair purposes).
// - `integrate` is the fan-in terminal aggregation stage and is NEVER
//   a fan-out parent/child (per §Scope: "integrate (parent, 1 aggregation)").

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

/**
 * v0.3 (v1 fan-out): `fanOutRole` discriminates a stage_run's role in
 * a static fan-out tree:
 * - `"normal"` (default): no fan-out; behaves identically to v0.2.
 * - `"parent"`: declares N sub-stages via `subStages`. Only allowed for
 *   `stage === "implement"` in v1.
 * - `"child"`: belongs to a parent via `parentStageRunId`. Same stage
 *   constraint as parent.
 *
 * Invariants enforced by `.superRefine` on the outer schema (NOT by the
 * common shape alone — common shape only provides the optionality).
 */
export const AisepFanOutRoleSchema = z.enum(["normal", "parent", "child"]);
export type AisepFanOutRole = z.infer<typeof AisepFanOutRoleSchema>;

/**
 * v0.4 (v2 fan-in, ADR-022 Q1b): stages where fanOutRole='parent' or
 * 'child' is legal. `integrate` is excluded — it's the fan-in terminal
 * aggregation, not a fan-out source. Non-fan-out stages (intake /
 * research / plan / architecture / contract / retrospect) have semantic
 * reasons not to parallelize (single seed context, single planning
 * decision, single retrospective).
 *
 * Widening this set is a MINOR bump (backward-compatible).
 */
export const FAN_OUT_ALLOWED_STAGES = new Set<AisepStage>([
  "implement",
  "verify",
  "review",
]);

const StageRunCommonShape = {
  id: OpaqueIdSchema,
  workspaceId: OpaqueIdSchema,
  stage: AisepStageSchema,
  /**
   * v0: single predecessor (linear). v2 fan-in uses subStages mirroring on
   * both sides; predecessorIds[] is NOT introduced (revoked from v0 plan,
   * see docs/proposals/aisep-v2-fan-in.md §Q3 Implicit revocation).
   * Cross-stage linkage uses this single predecessorId chain (each
   * downstream child's predecessorId points to its corresponding upstream
   * child's id).
   */
  predecessorId: OpaqueIdSchema.optional(),
  successorId: OpaqueIdSchema.optional(),
  status: AisepStageStatusSchema,
  /** sha256 of merged upstream artifact contents (decides freshness). */
  inputHash: ContentHashSchema.optional(),
  startedAt: EpochMsSchema.optional(),
  endedAt: EpochMsSchema.optional(),
  /** v0.3 (v1 fan-out): role in fan-out tree. Default "normal" is v0.2-compat. */
  fanOutRole: AisepFanOutRoleSchema.default("normal"),
  /** v0.3 (v1 fan-out): child stage_run ids when fanOutRole === "parent". MUST be empty for "normal" / "child". */
  subStages: z.array(OpaqueIdSchema).default([]),
  /** v0.3 (v1 fan-out): parent stage_run id when fanOutRole === "child". MUST be unset for "normal" / "parent". */
  parentStageRunId: OpaqueIdSchema.optional(),
  /**
   * v0.4 (v2 fan-in, ADR-022 Decision 2): regex patterns declaring which
   * paths this child plans to touch. Required non-empty when
   * fanOutRole === 'child'. Used by runner's pre-dispatch
   * `assertNoAffectsOverlap()` (Q4 declared-overlap conflict detection).
   * For "normal" / "parent" roles, defaults to [] and SHOULD remain so.
   */
  affects: z.array(z.string().min(1)).default([]),
  /**
   * v0.4 (v2 fan-in, ADR-022 Decision 2): audit marker set by
   * `aisep migrate --to 0.4` on v0.3-imported child rows. Migrated rows
   * carry `affects: [".*"]` + this flag; scheduler treats marker as
   * read-only forensic — does NOT trigger fresh fan-in dispatch.
   */
  migratedFromV03: z.boolean().default(false),
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
export const AisepStageRunSchema = z
  .discriminatedUnion("phase", [
    AisepStageRunNoneSchema,
    AisepStageRunBriefSchema,
    AisepStageRunSliceSchema,
  ])
  // v0.3 (v1 fan-out Stage 1): enforce fanOutRole invariants.
  // v0.4 (v2 fan-in, ADR-022): widen stage whitelist (Q1b) + require
  // non-empty `affects` on child rows (Decision 2).
  .superRefine((run, ctx) => {
    if (run.fanOutRole === "parent") {
      if (run.subStages.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["subStages"],
          message: "fanOutRole='parent' requires subStages to be non-empty",
        });
      }
      if (run.parentStageRunId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parentStageRunId"],
          message: "fanOutRole='parent' must NOT have parentStageRunId",
        });
      }
      if (!FAN_OUT_ALLOWED_STAGES.has(run.stage)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stage"],
          message: `fanOutRole='parent' only allowed for stages in FAN_OUT_ALLOWED_STAGES (got '${run.stage}')`,
        });
      }
    } else if (run.fanOutRole === "child") {
      if (run.parentStageRunId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parentStageRunId"],
          message: "fanOutRole='child' requires parentStageRunId",
        });
      }
      if (run.subStages.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["subStages"],
          message: "fanOutRole='child' must NOT have subStages (no nested fan-out)",
        });
      }
      if (!FAN_OUT_ALLOWED_STAGES.has(run.stage)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stage"],
          message: `fanOutRole='child' only allowed for stages in FAN_OUT_ALLOWED_STAGES (got '${run.stage}')`,
        });
      }
      // v0.4 Decision 2: child rows must declare what they touch.
      if (run.affects.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["affects"],
          message:
            "fanOutRole='child' requires non-empty affects: string[] (regex patterns declaring touched paths)",
        });
      }
    } else {
      // fanOutRole === "normal"
      if (run.subStages.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["subStages"],
          message: "fanOutRole='normal' must NOT have subStages",
        });
      }
      if (run.parentStageRunId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parentStageRunId"],
          message: "fanOutRole='normal' must NOT have parentStageRunId",
        });
      }
    }
  });
export type AisepStageRun = z.infer<typeof AisepStageRunSchema>;
