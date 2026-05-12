// JSON-file-backed state store for AisepStageRun / AisepArtifact / AisepAttempt.
//
// v0 uses a single JSON file at `<workspace>/.aisep/state.json`. SQLite is
// deferred to v0.2 when concurrent writers + KNN retrieval become real
// concerns (see plan §5).
//
// Atomic-rename writes are used to prevent partial-write corruption.
//
// R6 boundary: this module reads/writes files via node fs ONLY for the
// state.json bookkeeping. Stage agents go through aisep-workspace.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type {
  AisepArtifact,
  AisepAttempt,
  AisepStage,
  AisepStageRun,
  AisepStageStatus,
} from "@claude-web/aisep-protocol";

import { ids, type IdClock } from "./ids.js";
import { assertTransition, isTerminal } from "./state-machine.js";

interface StateFileV1 {
  version: 1;
  workspaceId: string;
  stageRuns: AisepStageRun[];
  artifacts: AisepArtifact[];
  attempts: AisepAttempt[];
}

function emptyStateFile(workspaceId: string): StateFileV1 {
  return {
    version: 1,
    workspaceId,
    stageRuns: [],
    artifacts: [],
    attempts: [],
  };
}

export interface AisepStoreOptions {
  /** Inject a clock for deterministic tests. */
  clock?: IdClock;
}

/**
 * AisepStore — file-backed orchestration state.
 *
 * One instance per workspace. File lives at `<cwd>/.aisep/state.json`.
 * Concurrent writers are NOT supported in v0 (single-writer per stage_run
 * is a store-layer invariant; see plan §"Phase 1 Q6").
 */
export class AisepStore {
  private state: StateFileV1;

  constructor(
    public readonly cwd: string,
    public readonly workspaceId: string,
    private readonly opts: AisepStoreOptions = {},
  ) {
    this.state = this.load();
  }

  /** Path to the state JSON. */
  get statePath(): string {
    return join(resolve(this.cwd), ".aisep", "state.json");
  }

  // ---------- file IO ----------

  private load(): StateFileV1 {
    if (!existsSync(this.statePath)) {
      return emptyStateFile(this.workspaceId);
    }
    const raw = readFileSync(this.statePath, "utf-8");
    try {
      const parsed = JSON.parse(raw) as StateFileV1;
      if (parsed.version !== 1) {
        throw new Error(`Unsupported state.json version: ${parsed.version}`);
      }
      return parsed;
    } catch (err) {
      throw new Error(`Failed to parse ${this.statePath}: ${(err as Error).message}`);
    }
  }

  private flush(): void {
    const dir = dirname(this.statePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmp = `${this.statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf-8");
    renameSync(tmp, this.statePath);
  }

  // ---------- stage_run ----------

  createStageRun(
    input: Omit<AisepStageRun, "id" | "status">,
  ): AisepStageRun {
    const id = ids.stageRun(this.opts.clock);
    const run = { ...input, id, status: "pending" as AisepStageStatus } as AisepStageRun;
    this.state.stageRuns.push(run);
    this.flush();
    return run;
  }

  updateStageRunStatus(
    id: string,
    nextStatus: AisepStageStatus,
    opts: { startedAt?: number; endedAt?: number } = {},
  ): AisepStageRun {
    const idx = this.state.stageRuns.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`stage_run not found: ${id}`);

    const current = this.state.stageRuns[idx]!;
    assertTransition(current.status, nextStatus);

    const updated: AisepStageRun = {
      ...current,
      status: nextStatus,
      ...(opts.startedAt !== undefined ? { startedAt: opts.startedAt } : {}),
      ...(opts.endedAt !== undefined ? { endedAt: opts.endedAt } : {}),
    };

    if (isTerminal(nextStatus) && updated.endedAt === undefined) {
      updated.endedAt = Date.now();
    }
    if (nextStatus === "running" && updated.startedAt === undefined) {
      updated.startedAt = Date.now();
    }

    this.state.stageRuns[idx] = updated;
    this.flush();
    return updated;
  }

  getStageRun(id: string): AisepStageRun | undefined {
    return this.state.stageRuns.find((r) => r.id === id);
  }

  listStageRuns(filter: { stage?: AisepStage; status?: AisepStageStatus } = {}): AisepStageRun[] {
    return this.state.stageRuns.filter(
      (r) =>
        (filter.stage === undefined || r.stage === filter.stage) &&
        (filter.status === undefined || r.status === filter.status),
    );
  }

  // ---------- artifact ----------

  /**
   * Append an artifact. The artifact is assumed to already be on disk (file
   * mode) or contain inline body (inline mode); the store only records the
   * metadata and content hash. M2 invariant: existing artifact (same id) is
   * NOT rewritten.
   */
  appendArtifact(record: Omit<AisepArtifact, "id" | "producedAt"> & { producedAt?: number }): AisepArtifact {
    const id = ids.artifact(this.opts.clock);
    const producedAt = record.producedAt ?? Date.now();
    const artifact = { ...record, id, producedAt } as AisepArtifact;
    this.state.artifacts.push(artifact);
    this.flush();
    return artifact;
  }

  getArtifact(id: string): AisepArtifact | undefined {
    return this.state.artifacts.find((a) => a.id === id);
  }

  listArtifactsByStageRun(stageRunId: string): AisepArtifact[] {
    return this.state.artifacts.filter((a) => a.stageRunId === stageRunId);
  }

  // ---------- attempt ----------

  appendAttempt(
    record: Omit<AisepAttempt, "id" | "startedAt" | "endedAt"> & {
      startedAt?: number;
      endedAt?: number;
    },
  ): AisepAttempt {
    const id = ids.attempt(this.opts.clock);
    const startedAt = record.startedAt ?? Date.now();
    const endedAt = record.endedAt ?? startedAt;
    const attempt = { ...record, id, startedAt, endedAt } as AisepAttempt;
    this.state.attempts.push(attempt);
    this.flush();
    return attempt;
  }

  listAttemptsByStageRun(stageRunId: string): AisepAttempt[] {
    return this.state.attempts.filter((a) => a.stageRunId === stageRunId);
  }

  /** Most recent attempt for a stage_run (used for M5 ping-pong cap;
   *  aisep-protocol v0.2 widened M5 counter set to `revise_required` ∪
   *  `request_reverify` — see docs/aisep/02_methodology-v0.1.md L343.
   *  Prior comment incorrectly cited M4 which is the contract-freeze
   *  red line, per Phase 2.D #7 rename. v0.2 carve-out: actual M5
   *  enforcement deferred to Phase 2.E baseline; see
   *  packages/aisep-protocol/src/attempt.ts AisepAttempt JSDoc. */
  latestAttemptN(stageRunId: string): number {
    const attempts = this.listAttemptsByStageRun(stageRunId);
    if (attempts.length === 0) return 0;
    return Math.max(...attempts.map((a) => a.attemptN));
  }
}
