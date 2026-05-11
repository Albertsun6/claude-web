// Workspace = a single AISEP project being developed.
//
// Two layers:
// - AisepWorkspaceMeta: wire DTO (zod schema), persisted to landscape file
// - AisepWorkspace: runtime interface (TS interface), implemented by
//   aisep-workspace package. NOT a wire DTO.

import { z } from "zod";
import { EpochMsSchema, OpaqueIdSchema } from "./common.js";

export const AisepWorkspaceStatusSchema = z.enum(["active", "archived"]);
export type AisepWorkspaceStatus = z.infer<typeof AisepWorkspaceStatusSchema>;

/**
 * AisepWorkspaceMeta — persisted to
 * ~/.aisep/landscape/<workspace-name>.yaml + workspace-local
 * <cwd>/.aisep/workspace.yaml (mirror).
 */
export const AisepWorkspaceMetaSchema = z.object({
  id: OpaqueIdSchema,
  name: z.string().min(1),
  cwd: z.string().min(1),
  status: AisepWorkspaceStatusSchema,
  /** Free-form domain tag, used by reference-library pattern retrieval (e.g. "erp", "ai-platform"). */
  domain: z.string().optional(),
  /** Tech stack tags (e.g. ["typescript", "pnpm-monorepo", "swift"]). */
  techStack: z.array(z.string()).default([]),
  createdAt: EpochMsSchema,
  lastActiveAt: EpochMsSchema.optional(),
  /** Number of stage chains that reached `retrospect` stage. */
  shipCount: z.number().int().nonnegative().default(0),
  /** Reference-library patterns adopted, e.g. ["architecture-patterns/ts-monorepo-pnpm"]. */
  adoptedPatterns: z.array(z.string()).default([]),
});
export type AisepWorkspaceMeta = z.infer<typeof AisepWorkspaceMetaSchema>;

// ============================================================================
// Runtime interface (NOT a wire DTO — no zod schema)
// ============================================================================

export interface AisepExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface AisepExecOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

/**
 * AisepWorkspace — runtime interface implemented by aisep-workspace package.
 * Only this interface is allowed to do fs / process side effects (R6 red line).
 */
export interface AisepWorkspace {
  /** Absolute root of the workspace cwd. */
  readonly cwd: string;
  /** Persistent meta (synced to landscape file). */
  readonly meta: AisepWorkspaceMeta;

  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  exec(cmd: string, opts?: AisepExecOptions): Promise<AisepExecResult>;
}
