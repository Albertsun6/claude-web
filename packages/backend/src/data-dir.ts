// Single source of truth for the on-disk data directory.
// Default: ~/.vessel. Override with VESSEL_DATA_DIR (used by the dev
// instance to point at ~/.vessel-dev so dev schema migrations / writes
// don't pollute the production stable copy).

import path from "node:path";
import os from "node:os";

function resolveDataDir(): string {
  const raw = process.env.VESSEL_DATA_DIR;
  if (!raw || raw.trim() === "") {
    return path.join(os.homedir(), ".vessel");
  }
  const expanded = raw.startsWith("~/") || raw === "~"
    ? path.join(os.homedir(), raw.slice(1))
    : raw;
  return path.resolve(expanded);
}

export const DATA_DIR = resolveDataDir();
