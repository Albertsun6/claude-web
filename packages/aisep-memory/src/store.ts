// AisepMemoryStore — file-backed AlphaEvolve 2-tier memory.
//
// Ported & generalized from newaisep `alphavolve.py` + `evolution_memory.py`.
// Schema lives in @vessel/aisep-protocol.
//
// Two tiers (R11 red line: physically isolated):
//   - workspace layer:  <cwd>/.aisep/evolution_log.json  (pending, per-project)
//   - global layer:     ~/.aisep/governance-log/evolution_log.json (verified, cross-project)
//
// retrieve(query) MUST always specify which tier — no implicit union across
// trust boundaries.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

import {
  AisepEvolutionLogV1Schema,
  AisepMemoryRecordSchema,
  type AisepEvolutionLogV1,
  type AisepMemoryRecord,
  type AisepStage,
} from "@vessel/aisep-protocol";

import { defaultGlobalLogPath, workspaceLogPath } from "./paths.js";

function emptyLog(): AisepEvolutionLogV1 {
  return { version: 1, records: [] };
}

/**
 * Inspector path (aisep-protocol v0.2 §Change 5b): fail-open to empty
 * on parse failure. Safe for read-only stats / list / retrieve — does
 * NOT trigger a write that could overwrite a parseable file with
 * `emptyLog()` content.
 */
function loadFileSafe(path: string): AisepEvolutionLogV1 {
  if (!existsSync(path)) return emptyLog();
  const raw = readFileSync(path, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    return AisepEvolutionLogV1Schema.parse(parsed);
  } catch {
    // newaisep behavior: corrupt file falls back to empty (server is truth).
    // Inspector path only — mutators MUST use loadFileStrict instead.
    return emptyLog();
  }
}

/**
 * Read-then-write path (aisep-protocol v0.2 §Change 5b): MUST throw on
 * parse failure so caller does NOT proceed to overwrite a parseable
 * file with empty content. Prevents the silent log erasure vector
 * that would otherwise compound `.min(1)` tightening with v0.1's
 * fallback-to-empty behavior (Phase 2.D cross-review A.F8 + B.F1 BLOCKER).
 */
function loadFileStrict(path: string): AisepEvolutionLogV1 {
  if (!existsSync(path)) return emptyLog();
  const raw = readFileSync(path, "utf-8");
  // Let parse errors propagate to caller.
  const parsed = JSON.parse(raw);
  return AisepEvolutionLogV1Schema.parse(parsed);
}

function saveFile(path: string, log: AisepEvolutionLogV1): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(log, null, 2), "utf-8");
  renameSync(tmp, path);
}

function generateMemoryId(): string {
  return `mr-${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

export interface AisepMemoryStoreOptions {
  globalLogPath?: string;
}

export interface MemoryRetrievalQuery {
  stage: AisepStage;
  domain?: string;
  techStack?: string[];
  limit?: number;
  tier: "workspace" | "global";
}

export interface MemoryStats {
  workspacePending: number;
  globalVerified: number;
  perStage: Record<AisepStage, number>;
}

/**
 * AisepMemoryStore — orchestrates pending writes + promote + tiered retrieval.
 *
 * Trust boundary (R11):
 * - retrieve(query) requires explicit `tier`; no implicit cross-tier query
 * - promote moves from workspace → global, marks `verifiedBy = human`
 */
export class AisepMemoryStore {
  public readonly workspacePath: string;
  public readonly globalPath: string;

  constructor(public readonly cwd: string, opts: AisepMemoryStoreOptions = {}) {
    this.workspacePath = workspaceLogPath(cwd);
    this.globalPath = opts.globalLogPath ?? defaultGlobalLogPath();
  }

  /** Record a new failure pattern as pending in workspace layer. */
  recordPending(
    input: Omit<AisepMemoryRecord, "id" | "source" | "shipCount" | "promoteCount" | "verifiedBy">,
  ): AisepMemoryRecord {
    const log = loadFileStrict(this.workspacePath);
    const record: AisepMemoryRecord = {
      ...input,
      id: generateMemoryId(),
      source: "workspace-pending",
      verifiedBy: "auto",
      shipCount: 0,
      promoteCount: 0,
    };
    // v0.2 §Change 5a: write-path zod parse. Throws if `.min(1)` on
    // appliesTo.stage is violated (or any other schema constraint).
    // Prevents A.F8 silent-log-erasure compound failure.
    AisepMemoryRecordSchema.parse(record);
    log.records.push(record);
    saveFile(this.workspacePath, log);
    return record;
  }

  /**
   * Record a new entry directly into the global tier.
   *
   * Use case: a human reviewer reads a retrospective's `§5 memory candidate`
   * list and decides up-front "this is verified, skip the
   * workspace-pending stage." Replaces the one-off
   * `/tmp/seed-memory-from-pilot-NN.mjs` scripts.
   *
   * Dedup key: `(stage, failurePattern.slice(0, 100))` — same as `promote()`.
   *
   * Returns the persisted record, or `null` if a duplicate was rejected.
   */
  recordGlobal(
    input: Omit<AisepMemoryRecord, "id" | "source" | "shipCount" | "promoteCount"> & {
      verifiedBy?: AisepMemoryRecord["verifiedBy"];
    },
  ): AisepMemoryRecord | null {
    const log = loadFileStrict(this.globalPath);
    const key = `${input.stage}::${input.failurePattern.slice(0, 100)}`;
    const dup = log.records.find(
      (r) => `${r.stage}::${r.failurePattern.slice(0, 100)}` === key,
    );
    if (dup) return null;

    const record: AisepMemoryRecord = {
      ...input,
      id: generateMemoryId(),
      source: "global-verified",
      verifiedBy: input.verifiedBy ?? "human",
      verifiedAt: input.verifiedAt ?? Date.now(),
      shipCount: 0,
      promoteCount: 1, // counts as one promote even though it skipped workspace
    };
    // v0.2 §Change 5a: write-path zod parse (A.F8 + B.F1 BLOCKER).
    AisepMemoryRecordSchema.parse(record);
    log.records.push(record);
    saveFile(this.globalPath, log);
    return record;
  }

  /**
   * Promote workspace-pending records to global-verified.
   *
   * - `filter.stage`: required
   * - `filter.failurePatternIncludes`: substring match on failurePattern
   * - `fix`: verified-by-human fix text; overwrites pending fix
   *
   * Dedup key: (stage, failurePattern.slice(0, 100))
   *
   * Returns the count of records newly promoted (excluding duplicates).
   */
  promote(filter: { stage: AisepStage; failurePatternIncludes?: string }, fix: string): number {
    const workspaceLog = loadFileStrict(this.workspacePath);
    const globalLog = loadFileStrict(this.globalPath);

    const matches = workspaceLog.records.filter(
      (r) =>
        r.stage === filter.stage &&
        r.source === "workspace-pending" &&
        (!filter.failurePatternIncludes ||
          r.failurePattern.includes(filter.failurePatternIncludes)),
    );

    if (matches.length === 0) return 0;

    const existingKeys = new Set(
      globalLog.records.map((r) => `${r.stage}::${r.failurePattern.slice(0, 100)}`),
    );

    let promoted = 0;
    const now = Date.now();
    for (const m of matches) {
      const key = `${m.stage}::${m.failurePattern.slice(0, 100)}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);

      const verified: AisepMemoryRecord = {
        ...m,
        id: generateMemoryId(),   // re-mint to mark as new global entry
        source: "global-verified",
        verifiedBy: "human",
        verifiedAt: now,
        fix,                       // human-verified fix overrides pending text
        promoteCount: (m.promoteCount ?? 0) + 1,
      };
      // v0.2 §Change 5a: write-path zod parse on each promoted record.
      AisepMemoryRecordSchema.parse(verified);
      globalLog.records.push(verified);
      promoted += 1;
    }

    if (promoted > 0) {
      saveFile(this.globalPath, globalLog);
    }
    return promoted;
  }

  /**
   * Retrieve memory hits matching the query. Tier is explicit — no implicit
   * union (R11 red line).
   */
  retrieve(query: MemoryRetrievalQuery): AisepMemoryRecord[] {
    // Inspector path — safe fallback if file is corrupt (read-only query).
    const log = query.tier === "workspace" ? loadFileSafe(this.workspacePath) : loadFileSafe(this.globalPath);
    const filtered = log.records.filter((r) => {
      if (r.stage !== query.stage) return false;

      const domainMatch =
        query.domain === undefined ||
        r.appliesTo.domain.includes("*") ||
        r.appliesTo.domain.includes(query.domain);

      const techStackMatch =
        query.techStack === undefined ||
        r.appliesTo.techStack.includes("*") ||
        query.techStack.some((t) => r.appliesTo.techStack.includes(t));

      return domainMatch && techStackMatch;
    });

    // Rank by shipCount desc (most-shipped fixes float to top)
    filtered.sort((a, b) => (b.shipCount ?? 0) - (a.shipCount ?? 0));

    return query.limit ? filtered.slice(0, query.limit) : filtered;
  }

  /** Stats across both tiers. */
  stats(): MemoryStats {
    const workspaceLog = loadFileSafe(this.workspacePath);
    const globalLog = loadFileSafe(this.globalPath);

    const perStage: Partial<Record<AisepStage, number>> = {};
    for (const r of [...workspaceLog.records, ...globalLog.records]) {
      perStage[r.stage] = (perStage[r.stage] ?? 0) + 1;
    }

    return {
      workspacePending: workspaceLog.records.filter((r) => r.source === "workspace-pending").length,
      globalVerified: globalLog.records.filter((r) => r.source === "global-verified").length,
      perStage: perStage as Record<AisepStage, number>,
    };
  }

  /** Inspector helpers (used by aisep-cli `memory show`). */
  listWorkspacePending(): AisepMemoryRecord[] {
    return loadFileSafe(this.workspacePath).records;
  }
  listGlobalVerified(): AisepMemoryRecord[] {
    return loadFileSafe(this.globalPath).records;
  }
}
