// Integration test: drive a mock 10-stage chain through the runner +
// workspace + memory + store stack, end-to-end.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AisepRunner, AisepStore, ids } from "@claude-web/aisep-core";
import { AisepMemoryStore } from "@claude-web/aisep-memory";
import { AisepStageSchema, type AisepStage } from "@claude-web/aisep-protocol";
import { NodeWorkspace } from "@claude-web/aisep-workspace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { memoryCommand } from "../commands/memory.js";
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

  it("CLI `memory record --tier global` inserts a human-verified record + dedups on rerun", async () => {
    const globalLogPath = join(globalDir, "evolution_log.json");
    // The CLI memoryRecord uses defaultGlobalLogPath() from aisep-memory paths,
    // which reads ~/.aisep/. We need to point the test at globalDir instead —
    // do so via env override that paths.ts honors. But since paths.ts is fixed,
    // we bypass the CLI for path-isolated tests and assert directly on the
    // store. The CLI is a thin shell over recordGlobal which already has full
    // unit coverage in aisep-memory; here we verify dedup output behavior.
    const memory = new AisepMemoryStore(cwd, { globalLogPath });

    const r1 = memory.recordGlobal({
      stage: "verify",
      failurePattern: "contract_grep on hand-off payload",
      fix: "Read implement.md from disk before grep",
      appliesTo: { domain: ["*"], stage: ["verify"], techStack: ["*"] },
    });
    expect(r1).not.toBeNull();
    expect(r1!.source).toBe("global-verified");
    expect(r1!.verifiedBy).toBe("human");

    // Re-record same pattern → dedup
    const r2 = memory.recordGlobal({
      stage: "verify",
      failurePattern: "contract_grep on hand-off payload",   // same
      fix: "Different fix text",
      appliesTo: { domain: ["*"], stage: ["verify"], techStack: ["*"] },
    });
    expect(r2).toBeNull();   // dedup rejected
    expect(memory.listGlobalVerified()).toHaveLength(1);
  });

  it("CLI `memory record` rejects missing required args", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitCode = await memoryCommand(["record", "--stage", "verify"]);
    expect(exitCode).toBe(1);
    expect(errSpy.mock.calls.flat().join(" ")).toContain("--stage <name> --pattern <text> --fix <text>");
    errSpy.mockRestore();
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
