// Artifact = product of a stage_run. Node in the DAG (Dagster SDA inspired).
// content_hash → freshness invalidation.
//
// Round-2 changes (per reviewer-cross critical):
// - AisepArtifactSchema is now a discriminated union on `storage`:
//   - storage="file": contentUri required, contentInline forbidden
//   - storage="inline": contentUri required, contentInline required, ≤ 64 KiB
// - contentHash derivation documented (different for file vs inline mode).

import { z } from "zod";
import { ContentHashSchema, EpochMsSchema, OpaqueIdSchema } from "./common.js";

/**
 * AisepArtifactKind — every stage produces 1+ artifact of these kinds.
 * Wire enum frozen at v0.1; additions require MINOR bump.
 */
export const AisepArtifactKindSchema = z.enum([
  // intake stage
  "intake",
  // research stage
  "research",
  // plan stage
  "plan",
  // architecture stage (5+1 件套 + trace)
  "workspace_dsl",       // C4-light Structurizr DSL
  "adr",                 // MADR file
  "risks",               // risks.yaml (Fairbanks)
  "requirements",        // requirements.yaml (ArchiMate Motivation Layer)
  "contract_seed",       // architecture-phase draft contract
  "trace",               // trace.yaml (REQ→ADR→ZOD→RISK chains)
  // contract stage
  "contract_frozen",     // zod + tRPC frozen
  // implement / verify / review / integrate / retrospect
  "patch",
  /**
   * v0.3 (v1 fan-out Stage 1): aggregate manifest of N child patches
   * produced by a `fanOutRole: "parent"` implement stage_run. Inline
   * storage (manifest is small). Content shape = AisepPatchSetManifestSchema.
   */
  "patch_set",
  "verify_report",
  "review_verdict",
  "integration_log",
  "retrospect",
]);
export type AisepArtifactKind = z.infer<typeof AisepArtifactKindSchema>;

/** ArtifactRef = lightweight pointer (kind + key path); not the full artifact body. */
export const AisepArtifactRefSchema = z.object({
  kind: AisepArtifactKindSchema,
  /** Relative key within workspace, e.g. "adr/0001-use-zod.md" or "patch/impl-backend.diff" */
  key: z.string().min(1),
});
export type AisepArtifactRef = z.infer<typeof AisepArtifactRefSchema>;

/** Storage strategy for artifact body. */
export const AisepArtifactStorageSchema = z.enum(["file", "inline"]);
export type AisepArtifactStorage = z.infer<typeof AisepArtifactStorageSchema>;

/** 64 KiB inline cap — enforced at schema layer. */
export const AISEP_ARTIFACT_INLINE_MAX_BYTES = 65536;

const ArtifactCommonShape = {
  id: OpaqueIdSchema,
  workspaceId: OpaqueIdSchema,
  stageRunId: OpaqueIdSchema,
  ref: AisepArtifactRefSchema,
  /**
   * sha256 of the artifact body. Derivation rule depends on storage:
   *
   * - **storage="file"**: `sha256(<raw bytes of file at contentUri>)`
   *   For text files, hash the on-disk bytes verbatim (no line-ending
   *   normalization, no BOM stripping).
   * - **storage="inline"**: `sha256(<UTF-8 encoded bytes of contentInline>)`
   *
   * Two implementations that follow these rules MUST produce identical
   * hashes for semantically equal content. This is critical for artifact
   * freshness invalidation across runs.
   */
  contentHash: ContentHashSchema,
  /** Body size in bytes. For inline must equal `Buffer.byteLength(contentInline, "utf-8")`. */
  sizeBytes: z.number().int().nonnegative(),
  producedAt: EpochMsSchema,
};

/**
 * AisepArtifact (file storage variant).
 *
 * `contentUri` is the canonical pointer: `file://<workspace>/<key>` or
 * any other URI scheme the workspace can resolve. `contentInline` is
 * forbidden.
 */
const AisepArtifactFileSchema = z.object({
  ...ArtifactCommonShape,
  storage: z.literal("file"),
  contentUri: z.string().min(1),
}).strict();

/**
 * AisepArtifact (inline storage variant).
 *
 * Body is embedded directly in the record (≤ 64 KiB). `contentUri` is
 * still required for addressability (typically `sqlite://artifact_blob/<id>`)
 * so consumers have a consistent way to reference it.
 */
const AisepArtifactInlineSchema = z.object({
  ...ArtifactCommonShape,
  storage: z.literal("inline"),
  contentUri: z.string().min(1),
  contentInline: z.string().max(AISEP_ARTIFACT_INLINE_MAX_BYTES),
}).strict();

/**
 * AisepArtifact — discriminated union on `storage`.
 *
 * M2 invariant: contentHash immutable once written (rewrite-protected at
 * store layer; the schema only ensures shape).
 */
export const AisepArtifactSchema = z.discriminatedUnion("storage", [
  AisepArtifactFileSchema,
  AisepArtifactInlineSchema,
]);
export type AisepArtifact = z.infer<typeof AisepArtifactSchema>;

/**
 * v0.3 (v1 fan-out Stage 1): the content body of a `patch_set` artifact.
 *
 * The patch_set artifact itself wraps this manifest as JSON in
 * `contentInline` (inline storage; manifests are small). The N child
 * patches themselves are separate `patch` artifacts referenced by id.
 *
 * Constraints (v1):
 * - `patches.length >= 2` — a 1-patch parent isn't a fan-out (use `patch` directly)
 * - `subStageName` regex matches the shell-safe constraint used by
 *   `AisepReviewVerdict.requestReverify.checkId`. This lets a reviewer's
 *   `request_reverify.checkId` point INTO a specific child patch via the
 *   subStageName prefix (per v3 cycle proposal §"Composition with v1 fan-out").
 */
export const AisepPatchSetManifestSchema = z
  .object({
    patches: z
      .array(
        z.object({
          subStageId: OpaqueIdSchema,
          subStageName: z.string().regex(/^[A-Za-z0-9_.:-]+$/),
          /** Path within workspace to the child patch file. */
          patchFile: z.string().min(1),
          contentHash: ContentHashSchema,
          byteCount: z.number().int().nonnegative(),
        }),
      )
      .min(2),
  })
  .strict();
export type AisepPatchSetManifest = z.infer<typeof AisepPatchSetManifestSchema>;
