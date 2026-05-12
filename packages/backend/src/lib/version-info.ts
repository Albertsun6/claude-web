// Resolve the backend's own version at runtime. Two sources:
//   1. /usr/local/vessel/share/VERSION (set by scripts/build-pkg.sh for installed .pkg)
//   2. packages/backend/package.json (dev source tree)
// Cached after first resolve.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface VersionInfo {
  backend: string;
  source: "VERSION" | "package.json" | "unknown";
}

let cached: VersionInfo | null = null;

export function getCurrentVersion(): VersionInfo {
  if (cached) return cached;

  // packed-pkg layout: src is at /usr/local/vessel/backend/src → ../../share/VERSION
  const versionFile = path.resolve(__dirname, "../../../share/VERSION");
  if (existsSync(versionFile)) {
    try {
      const content = readFileSync(versionFile, "utf-8").trim();
      if (content && /^[0-9]/.test(content)) {
        cached = { backend: content, source: "VERSION" };
        return cached;
      }
    } catch { /* fall through */ }
  }

  // dev layout: src is at packages/backend/src → ../package.json
  const pkgJson = path.resolve(__dirname, "../../package.json");
  if (existsSync(pkgJson)) {
    try {
      const parsed = JSON.parse(readFileSync(pkgJson, "utf-8"));
      if (typeof parsed.version === "string") {
        cached = { backend: parsed.version, source: "package.json" };
        return cached;
      }
    } catch { /* fall through */ }
  }

  cached = { backend: "unknown", source: "unknown" };
  return cached;
}
