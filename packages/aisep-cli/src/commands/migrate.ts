// `aisep migrate --to 0.4` — wire-format migration utility for state.json
// across AISEP protocol versions.
//
// v0.4 (ADR-022 Decision 5): a `aisep migrate --to X.Y` utility MUST ship
// in the same release as any MAJOR-class wire bump that uses the MINOR
// version label. This command is the v0.3 → v0.4 implementation.
//
// What it does:
// 1. Acquires the workspace lock (mode='migrate'); refuses if held
// 2. Reads `<cwd>/.aisep/state.json` raw (no schema validation)
// 3. For each stage_run with `fanOutRole === 'child'` AND no `affects` field,
//    adds `affects: [".*"]` + `migratedFromV03: true` audit marker
// 4. Defaults `migratedFromV03: false` on all non-migrated rows
// 5. Atomic-rename writes the updated state.json (backup at .bak)
// 6. Reports per-row migration summary
//
// Idempotency: re-running on an already-migrated state.json is a no-op
// (zero rows touched, no .bak overwritten).
//
// Rollback: `<state.json>.bak` is the pre-migration snapshot. Manual
// rollback = restore .bak. Reverse migration is intentionally NOT
// provided in v0.4 (deferred utility per ADR-022 §Rollback path).

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  acquireWorkspaceLock,
  WorkspaceLockHeldError,
} from "@vessel/aisep-core";

interface MigrateArgs {
  workspace: string;
  toVersion: string;
  dryRun: boolean;
}

interface MigrationReport {
  sourcePath: string;
  fromInferred: string;
  to: string;
  rowsScanned: number;
  childRowsTotal: number;
  childRowsMigrated: number;
  parentRowsNormalized: number;
  alreadyAtTarget: boolean;
  dryRun: boolean;
}

const SUPPORTED_TARGETS = new Set(["0.4", "0.4.0"]);

interface StageRunLike {
  id?: string;
  fanOutRole?: string;
  affects?: unknown;
  migratedFromV03?: unknown;
  [k: string]: unknown;
}

export async function migrateCommand(rawArgs: string[]): Promise<number> {
  const args = parseMigrateArgs(rawArgs);
  if (!args) return 1;

  if (!SUPPORTED_TARGETS.has(args.toVersion)) {
    console.error(
      `[aisep migrate] Unsupported --to version "${args.toVersion}". Supported: ${Array.from(SUPPORTED_TARGETS).join(", ")}`,
    );
    return 1;
  }

  const cwd = resolve(args.workspace);
  const statePath = join(cwd, ".aisep", "state.json");
  if (!existsSync(statePath)) {
    console.error(
      `[aisep migrate] No state.json found at ${statePath}; nothing to migrate.`,
    );
    return 2;
  }

  // R7 lock: prevents an in-flight `aisep run` from racing with migrate.
  let lock: { release: () => void } | undefined;
  try {
    lock = acquireWorkspaceLock(cwd, "migrate");
  } catch (err) {
    if (err instanceof WorkspaceLockHeldError) {
      console.error(`[aisep migrate] ${err.message}`);
      return 3;
    }
    throw err;
  }

  try {
    const raw = readFileSync(statePath, "utf-8");
    let parsed: { stageRuns?: StageRunLike[]; [k: string]: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`[aisep migrate] Failed to parse state.json: ${(err as Error).message}`);
      return 4;
    }

    const { report, mutated } = migrateStateInMemory(parsed, args.toVersion);
    report.sourcePath = statePath;
    report.dryRun = args.dryRun;

    if (args.dryRun) {
      console.log(formatReport(report));
      console.log("[aisep migrate] --dry-run set; no file changes.");
      return 0;
    }

    if (!mutated) {
      console.log(formatReport(report));
      console.log(
        `[aisep migrate] state.json already at v${args.toVersion} (no rows touched).`,
      );
      return 0;
    }

    // Snapshot to .bak before overwriting (rollback path).
    const bakPath = `${statePath}.bak`;
    writeFileSync(bakPath, raw, "utf-8");

    // Atomic rewrite via .tmp + rename.
    const tmpPath = `${statePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(parsed, null, 2), "utf-8");
    renameSync(tmpPath, statePath);

    console.log(formatReport(report));
    console.log(`[aisep migrate] state.json migrated. Backup: ${bakPath}`);
    return 0;
  } finally {
    lock?.release();
  }
}

/**
 * Pure-function core of the migration: mutates the parsed state.json
 * object in-place to bring it up to the target version. Returns a
 * report + whether any mutation happened.
 *
 * Exposed for testing — exercises the v0.3 → v0.4 transform without
 * touching the filesystem.
 */
export function migrateStateInMemory(
  state: { stageRuns?: StageRunLike[]; [k: string]: unknown },
  toVersion: string,
): { report: Omit<MigrationReport, "sourcePath" | "dryRun">; mutated: boolean } {
  const stageRuns = Array.isArray(state.stageRuns) ? state.stageRuns : [];
  let childRowsTotal = 0;
  let childRowsMigrated = 0;
  let parentRowsNormalized = 0;
  let mutated = false;

  for (const row of stageRuns) {
    if (row.fanOutRole === "child") {
      childRowsTotal += 1;
      const hasAffects =
        Array.isArray(row.affects) && (row.affects as unknown[]).length > 0;
      if (!hasAffects) {
        // v0.3-shape child row: missing affects → migrate.
        row.affects = [".*"];
        row.migratedFromV03 = true;
        childRowsMigrated += 1;
        mutated = true;
      } else if (row.migratedFromV03 === undefined) {
        // Already has affects but missing the audit marker: default to false.
        row.migratedFromV03 = false;
        mutated = true;
      }
    } else if (
      row.fanOutRole === "parent" ||
      row.fanOutRole === "normal" ||
      row.fanOutRole === undefined
    ) {
      // Parent/normal: ensure affects defaults to [] and migratedFromV03 to false.
      if (!Array.isArray(row.affects)) {
        row.affects = [];
        parentRowsNormalized += 1;
        mutated = true;
      }
      if (row.migratedFromV03 === undefined) {
        row.migratedFromV03 = false;
        mutated = true;
      }
    }
  }

  const alreadyAtTarget = !mutated;

  return {
    report: {
      fromInferred: childRowsMigrated > 0 ? "0.3.x" : "≥ 0.4.0 (or empty)",
      to: toVersion,
      rowsScanned: stageRuns.length,
      childRowsTotal,
      childRowsMigrated,
      parentRowsNormalized,
      alreadyAtTarget,
    },
    mutated,
  };
}

function formatReport(report: MigrationReport): string {
  return [
    `[aisep migrate] source=${report.sourcePath}`,
    `[aisep migrate] target=${report.to} (inferred from=${report.fromInferred})`,
    `[aisep migrate] scanned ${report.rowsScanned} stage_runs:`,
    `  child rows total:           ${report.childRowsTotal}`,
    `  child rows migrated:        ${report.childRowsMigrated} (added affects=[\".*\"] + migratedFromV03=true)`,
    `  parent/normal normalized:   ${report.parentRowsNormalized}`,
  ].join("\n");
}

export function parseMigrateArgs(rawArgs: string[]): MigrateArgs | undefined {
  const args: MigrateArgs = {
    workspace: process.cwd(),
    toVersion: "",
    dryRun: false,
  };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]!;
    if (arg === "--workspace" || arg === "-w") {
      args.workspace = rawArgs[++i] ?? args.workspace;
    } else if (arg === "--to") {
      const v = rawArgs[++i];
      if (!v) {
        console.error(`[aisep migrate] --to requires a version (e.g. --to 0.4)`);
        return undefined;
      }
      args.toVersion = v;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else {
      console.error(`[aisep migrate] Unknown arg: ${arg}`);
      return undefined;
    }
  }
  if (!args.toVersion) {
    console.error(`[aisep migrate] --to <version> is required (supported: 0.4)`);
    return undefined;
  }
  return args;
}
