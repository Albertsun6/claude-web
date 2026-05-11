// Integration test: drive a mock 10-stage chain through the runner +
// workspace + memory + store stack, end-to-end.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AisepRunner, AisepStore, ids } from "@claude-web/aisep-core";
import { AisepMemoryStore } from "@claude-web/aisep-memory";
import { AisepStageSchema, type AisepStage } from "@claude-web/aisep-protocol";
import { NodeWorkspace } from "@claude-web/aisep-workspace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockStageExecutor } from "../mock-executor.js";

let cwd: string;
let globalDir: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "aisep-it-cwd-"));
  globalDir = mkdtempSync(join(tmpdir(), "aisep-it-global-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(globalDir, { recursive: true, force: true });
});

const STAGES = AisepStageSchema.options as AisepStage[];

describe("integration: 10-stage chain (mock executor)", () => {
  it("runs all 10 stages to succeeded with predecessor wiring", async () => {
    const workspaceId = ids.workspace();
    const ws = new NodeWorkspace(cwd, {
      id: workspaceId,
      name: "test",
      cwd,
      status: "active",
      techStack: [],
      createdAt: Date.now(),
      shipCount: 0,
      adoptedPatterns: [],
    });
    const store = new AisepStore(cwd, workspaceId);
    const runner = new AisepRunner({ store, workspace: ws, executor: new MockStageExecutor() });

    let lastRunId: string | undefined;
    const runs: string[] = [];
    for (const stage of STAGES) {
      const run = await runner.runStage({ stage, predecessorId: lastRunId });
      expect(run.status).toBe("succeeded");
      expect(run.stage).toBe(stage);
      runs.push(run.id);
      lastRunId = run.id;
    }

    expect(runs).toHaveLength(10);
    expect(store.listStageRuns({ status: "succeeded" })).toHaveLength(10);

    // Every stage produced 1 artifact (mock executor invariant).
    const allArtifacts = runs.flatMap((id) => store.listArtifactsByStageRun(id));
    expect(allArtifacts).toHaveLength(10);

    // Every artifact has valid sha256 hash.
    for (const a of allArtifacts) {
      expect(a.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }

    // Every stage has 1 attempt with exitCode=0.
    for (const id of runs) {
      const attempts = store.listAttemptsByStageRun(id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.status).toBe("succeeded");
      expect(attempts[0]!.exitCode).toBe(0);
    }
  });

  it("failed stage breaks the chain — subsequent stages not auto-run", async () => {
    const workspaceId = ids.workspace();
    const ws = new NodeWorkspace(cwd, {
      id: workspaceId,
      name: "test",
      cwd,
      status: "active",
      techStack: [],
      createdAt: Date.now(),
      shipCount: 0,
      adoptedPatterns: [],
    });
    const store = new AisepStore(cwd, workspaceId);
    const runner = new AisepRunner({
      store,
      workspace: ws,
      executor: new MockStageExecutor({ failOnStages: ["verify"] }),
    });

    let lastRunId: string | undefined;
    for (const stage of STAGES) {
      const run = await runner.runStage({ stage, predecessorId: lastRunId });
      if (stage === "verify") {
        expect(run.status).toBe("failed");
        break;
      }
      expect(run.status).toBe("succeeded");
      lastRunId = run.id;
    }

    expect(store.listStageRuns({ status: "succeeded" }).length).toBeGreaterThan(0);
    expect(store.listStageRuns({ status: "failed" })).toHaveLength(1);
  });

  it("memory: record pending → promote to global closes the loop", () => {
    const memory = new AisepMemoryStore(cwd, {
      globalLogPath: join(globalDir, "evolution_log.json"),
    });

    memory.recordPending({
      stage: "architecture",
      failurePattern: "Phase A produced 7-page brief (limit is 5)",
      fix: "Pending",
      appliesTo: { domain: ["*"], stage: ["architecture"], techStack: ["*"] },
    });
    expect(memory.stats().workspacePending).toBe(1);
    expect(memory.stats().globalVerified).toBe(0);

    const promoted = memory.promote(
      { stage: "architecture" },
      "Render template with explicit page-count assertion before saving",
    );
    expect(promoted).toBe(1);
    expect(memory.stats().globalVerified).toBe(1);

    // Verify the promoted record has human verifiedBy
    const globalHits = memory.retrieve({ stage: "architecture", tier: "global" });
    expect(globalHits[0]!.verifiedBy).toBe("human");
    expect(globalHits[0]!.fix).toContain("explicit page-count");
  });
});
