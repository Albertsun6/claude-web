// Artifact = product of a stage_run. Node in the DAG (Dagster SDA inspired).
// content_hash → freshness invalidation.

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

/**
 * AisepArtifact — full record, including content hash and pointer to body.
 *
 * M2 invariant: contentHash immutable once written (rewrite-protected).
 */
export const AisepArtifactSchema = z.object({
  id: OpaqueIdSchema,
  workspaceId: OpaqueIdSchema,
  stageRunId: OpaqueIdSchema,
  ref: AisepArtifactRefSchema,
  contentHash: ContentHashSchema,
  storage: AisepArtifactStorageSchema,
  /**
   * Body URI:
   * - storage="file"   → "file://<workspace>/<key>"
   * - storage="inline" → "sqlite://artifact_blob/<id>"
   */
  contentUri: z.string().min(1),
  /** Body inline (only when storage="inline" and size ≤ 64 KB). */
  contentInline: z.string().optional(),
  sizeBytes: z.number().int().nonnegative(),
  producedAt: EpochMsSchema,
});
export type AisepArtifact = z.infer<typeof AisepArtifactSchema>;
