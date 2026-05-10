/**
 * M0.5 minimal capability manifest loader.
 *
 * Loads `packages/capability-<id>/manifest.yaml` and validates against
 * AppManifestSchema (Zod). Returns the parsed manifest or throws.
 *
 * **M0.5 守边界**：本模块只做 schema 校验；真正的 CapabilityApp.boot() runtime
 * orchestration（spawnHelper, register Skill/Tool, lifecycle）留给 M2+。
 *
 * Usage in tests / acceptance:
 *   loadManifest('coding')  // → throws if invalid
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { AppManifestSchema, type AppManifestParsed } from './interfaces/app-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/backend/src/ → packages/
const PACKAGES_DIR = join(__dirname, '..', '..');

export function loadManifest(capabilityId: string): AppManifestParsed {
  const manifestPath = join(PACKAGES_DIR, `capability-${capabilityId}`, 'manifest.yaml');
  const raw = readFileSync(manifestPath, 'utf-8');
  const obj = parseYaml(raw);
  const parsed = AppManifestSchema.parse(obj);
  if (parsed.id !== capabilityId) {
    throw new Error(
      `manifest.id mismatch: directory says "${capabilityId}", manifest says "${parsed.id}"`,
    );
  }
  return parsed;
}
