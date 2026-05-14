// Content hash utilities per aisep-protocol M2 invariant.
//
// Per artifact.ts JSDoc:
//   - storage="file":   sha256(<raw bytes of file>)
//   - storage="inline": sha256(<UTF-8 bytes of contentInline>)

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Hash UTF-8 string. Returns "sha256:<64hex>". */
export function hashString(content: string): string {
  const h = createHash("sha256").update(content, "utf-8").digest("hex");
  return `sha256:${h}`;
}

/** Hash raw bytes. */
export function hashBytes(bytes: Uint8Array | Buffer): string {
  const h = createHash("sha256").update(bytes).digest("hex");
  return `sha256:${h}`;
}

/** Hash a file's contents (synchronous). */
export function hashFileSync(absPath: string): string {
  return hashBytes(readFileSync(absPath));
}
