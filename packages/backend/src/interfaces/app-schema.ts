/**
 * Zod schema for AppManifest (interfaces/app.ts).
 *
 * Used to validate `packages/capability-<id>/manifest.yaml` at boot time.
 * M0.5 ships only the schema + validator; runtime loader (CapabilityApp.boot
 * orchestration) is M2+. The validator is exercised by M0.5 capability-coding
 * acceptance: `validateManifest(yaml)` must pass.
 *
 * @see interfaces/app.ts AppManifest
 */

import { z } from 'zod';

const PermissionScopeSchema = z.object({
  paths: z.array(z.string()).optional(),
  ops: z.array(z.string()).optional(),
});

export const AppManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id must be kebab-case'),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/, 'semver'),
  description: z.string().min(1),
  author: z.string().optional(),
  schemaVersion: z.number().int().min(1),
  skills: z.array(z.string()),
  tools: z.array(z.string()).optional(),
  mlWorkers: z.array(z.enum(['embedding', 'asr', 'tts'])).optional(),
  permissionScope: PermissionScopeSchema.optional(),
  soulInjection: z.enum(['cli-runner-only', 'all-skills']).optional(),
});

export type AppManifestParsed = z.infer<typeof AppManifestSchema>;
