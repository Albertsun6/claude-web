// AisepMemoryStore — file-backed AlphaEvolve 2-tier memory.
//
// Ported & generalized from newaisep `alphavolve.py` + `evolution_memory.py`.
// Schema lives in @claude-web/aisep-protocol.
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
  type AisepEvolutionLogV1,
  type AisepMemoryRecord,
  type AisepStage,
} from "@claude-web/aisep-protocol";

import { defaultGlobalLogPath, workspaceLogPath } from "./paths.js";

function emptyLog(): AisepEvolutionLogV1 {
  return { version: 1, records: [] };
}

function loadFile(path: string): AisepEvolutionLogV1 {
  if (!existsSync(path)) return emptyLog();
  const raw = readFileSync(path, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    return AisepEvolutionLogV1Schema.parse(parsed);
  } catch {
    // newaisep behavior: corrupt file falls back to empty (server is truth)
    return emptyLog();
  }
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
    const log = loadFile(this.workspacePath);
    const record: AisepMemoryRecord = {
      ...input,
      id: generateMemoryId(),
      source: "workspace-pending",
      verifiedBy: "auto",
      shipCount: 0,
      promoteCount: 0,
    };
    log.records.push(record);
    saveFile(this.workspacePath, log);
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
    const workspaceLog = loadFile(this.workspacePath);
    const globalLog = loadFile(this.globalPath);

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
    const log = query.tier === "workspace" ? loadFile(this.workspacePath) : loadFile(this.globalPath);
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
    const workspaceLog = loadFile(this.workspacePath);
    const globalLog = loadFile(this.globalPath);

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
    return loadFile(this.workspacePath).records;
  }
  listGlobalVerified(): AisepMemoryRecord[] {
    return loadFile(this.globalPath).records;
  }
}
