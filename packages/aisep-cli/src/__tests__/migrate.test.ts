// `aisep migrate --to 0.4` utility tests + cross-version round-trip A binary
// level (ADR-022 Decision 5 + dogfood gate 7).

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  migrateCommand,
  migrateStateInMemory,
  parseMigrateArgs,
} from "../commands/migrate.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "aisep-migrate-"));
  mkdirSync(join(cwd, ".aisep"), { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const SAMPLE_V03_STATE = {
  version: 1,
  workspaceId: "ws-test",
  stageRuns: [
    // Normal stage run (intake) — should get migratedFromV03=false default + affects=[]
    {
      id: "sr-intake-01",
      workspaceId: "ws-test",
      stage: "intake",
      phase: "none",
      status: "succeeded",
      fanOutRole: "normal",
      subStages: [],
    },
    // Fan-out parent — also gets normalized
    {
      id: "sr-impl-parent",
      workspaceId: "ws-test",
      stage: "implement",
      phase: "none",
      status: "succeeded",
      fanOutRole: "parent",
      subStages: ["sr-c1", "sr-c2"],
    },
    // Fan-out child v0.3-shape (no affects) → must be migrated
    {
      id: "sr-c1",
      workspaceId: "ws-test",
      stage: "implement",
      phase: "none",
      status: "succeeded",
      fanOutRole: "child",
      parentStageRunId: "sr-impl-parent",
    },
    {
      id: "sr-c2",
      workspaceId: "ws-test",
      stage: "implement",
      phase: "none",
      status: "succeeded",
      fanOutRole: "child",
      parentStageRunId: "sr-impl-parent",
    },
  ],
  artifacts: [],
  attempts: [],
};

describe("migrateStateInMemory (pure-function core)", () => {
  it("v0.3 → v0.4: fills affects + migratedFromV03 on child rows", () => {
    const state = structuredClone(SAMPLE_V03_STATE);
    const { report, mutated } = migrateStateInMemory(state, "0.4");
    expect(mutated).toBe(true);
    expect(report.childRowsTotal).toBe(2);
    expect(report.childRowsMigrated).toBe(2);
    expect(report.fromInferred).toBe("0.3.x");

    const child = state.stageRuns!.find((r: { id?: string }) => r.id === "sr-c1") as {
      affects: string[];
      migratedFromV03: boolean;
    };
    expect(child.affects).toEqual([".*"]);
    expect(child.migratedFromV03).toBe(true);
  });

  it("normalizes parent/normal rows with defaults", () => {
    const state = structuredClone(SAMPLE_V03_STATE);
    const { report } = migrateStateInMemory(state, "0.4");
    expect(report.parentRowsNormalized).toBe(2); // parent + normal both get affects=[]
    const parent = state.stageRuns!.find((r: { id?: string }) => r.id === "sr-impl-parent") as {
      affects: unknown[];
      migratedFromV03: boolean;
    };
    expect(parent.affects).toEqual([]);
    expect(parent.migratedFromV03).toBe(false);
  });

  it("idempotent: re-running on already-migrated state is a no-op", () => {
    const state = structuredClone(SAMPLE_V03_STATE);
    migrateStateInMemory(state, "0.4");
    const result2 = migrateStateInMemory(state, "0.4");
    expect(result2.mutated).toBe(false);
    expect(result2.report.alreadyAtTarget).toBe(true);
    expect(result2.report.childRowsMigrated).toBe(0);
  });

  it("preserves existing affects on already-v0.4 child rows", () => {
    const v04State = {
      stageRuns: [
        {
          id: "sr-c1",
          workspaceId: "ws-test",
          stage: "implement",
          phase: "none",
          status: "succeeded",
          fanOutRole: "child",
          parentStageRunId: "sr-impl-parent",
          affects: ["packages/backend/.*"],
          migratedFromV03: false,
        },
      ],
    };
    const { report } = migrateStateInMemory(v04State, "0.4");
    expect(report.childRowsMigrated).toBe(0);
    expect((v04State.stageRuns[0] as { affects: string[] }).affects).toEqual([
      "packages/backend/.*",
    ]);
  });

  it("handles empty stageRuns array", () => {
    const empty = { stageRuns: [] };
    const { report, mutated } = migrateStateInMemory(empty, "0.4");
    expect(mutated).toBe(false);
    expect(report.rowsScanned).toBe(0);
  });
});

describe("migrateCommand (cli surface)", () => {
  it("--to 0.4 migrates state.json + writes .bak snapshot", async () => {
    const statePath = join(cwd, ".aisep", "state.json");
    writeFileSync(statePath, JSON.stringify(SAMPLE_V03_STATE, null, 2), "utf-8");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await migrateCommand(["--workspace", cwd, "--to", "0.4"]);
    spy.mockRestore();

    expect(code).toBe(0);

    // .bak exists with original pre-migration content
    expect(existsSync(`${statePath}.bak`)).toBe(true);
    const bak = JSON.parse(readFileSync(`${statePath}.bak`, "utf-8"));
    expect(bak.stageRuns[2].affects).toBeUndefined();

    // state.json now has migrated v0.4 shape
    const migrated = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(migrated.stageRuns[2].affects).toEqual([".*"]);
    expect(migrated.stageRuns[2].migratedFromV03).toBe(true);
  });

  it("--dry-run prints report but does not touch disk", async () => {
    const statePath = join(cwd, ".aisep", "state.json");
    const original = JSON.stringify(SAMPLE_V03_STATE, null, 2);
    writeFileSync(statePath, original, "utf-8");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await migrateCommand([
      "--workspace",
      cwd,
      "--to",
      "0.4",
      "--dry-run",
    ]);
    spy.mockRestore();

    expect(code).toBe(0);
    expect(existsSync(`${statePath}.bak`)).toBe(false);
    expect(readFileSync(statePath, "utf-8")).toBe(original);
  });

  it("exit 2 when no state.json exists at the workspace path", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await migrateCommand(["--workspace", cwd, "--to", "0.4"]);
    spy.mockRestore();
    expect(code).toBe(2);
  });

  it("rejects unsupported --to versions", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await migrateCommand(["--workspace", cwd, "--to", "0.5"]);
    spy.mockRestore();
    expect(code).toBe(1);
  });

  it("rejects --to with no version arg", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const args = parseMigrateArgs(["--to"]);
    spy.mockRestore();
    expect(args).toBeUndefined();
  });

  it("rejects when --to is omitted entirely", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const args = parseMigrateArgs(["--workspace", "/tmp/x"]);
    spy.mockRestore();
    expect(args).toBeUndefined();
  });
});

describe("cross-version round-trip A — binary level (dogfood gate 7)", () => {
  it("re-migration after partial mutation is still correct (idempotency under perturbation)", () => {
    const state = structuredClone(SAMPLE_V03_STATE);
    migrateStateInMemory(state, "0.4");

    // Simulate a v0.4 binary re-running aisep: should be a no-op.
    const second = migrateStateInMemory(state, "0.4");
    expect(second.mutated).toBe(false);
    expect(second.report.alreadyAtTarget).toBe(true);

    // All children still have affects + migrated marker.
    for (const row of state.stageRuns!) {
      if ((row as { fanOutRole?: string }).fanOutRole === "child") {
        const r = row as { affects: string[]; migratedFromV03: boolean };
        expect(r.affects).toEqual([".*"]);
        expect(r.migratedFromV03).toBe(true);
      }
    }
  });

  it("aisep run refuses v0.3-shape state.json with migrate-suggestion error (exit 6)", async () => {
    // Write a v0.3-shape state.json (child rows missing affects).
    const statePath = join(cwd, ".aisep", "state.json");
    writeFileSync(statePath, JSON.stringify(SAMPLE_V03_STATE, null, 2), "utf-8");

    // Lazy import to avoid loading the cli entry pipeline at file scope.
    const { runCommand } = await import("../commands/run.js");

    const errors: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((msg) => {
      errors.push(String(msg));
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await runCommand(["--workspace", cwd, "--dry"]);

    errSpy.mockRestore();
    logSpy.mockRestore();

    expect(code).toBe(6);
    expect(errors.some((m) => /v0.3-shape fan-out child row/.test(m))).toBe(true);
    expect(errors.some((m) => /aisep migrate --to 0.4/.test(m))).toBe(true);

    // state.json was NOT mutated (refusal is read-only).
    const onDisk = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(onDisk.stageRuns[2].affects).toBeUndefined();
  });

  it("aisep run proceeds after `aisep migrate --to 0.4` cleans up", async () => {
    const statePath = join(cwd, ".aisep", "state.json");
    writeFileSync(statePath, JSON.stringify(SAMPLE_V03_STATE, null, 2), "utf-8");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Migrate.
    await migrateCommand(["--workspace", cwd, "--to", "0.4"]);
    // Now aisep run should proceed (it'll succeed and run all stages
    // because the state.json's stage_runs are just history — no in-flight
    // state to clash with).
    const { runCommand } = await import("../commands/run.js");
    const code = await runCommand(["--workspace", cwd, "--dry"]);
    logSpy.mockRestore();
    errSpy.mockRestore();
    // Returns 0 (success) or 3 (a stage failed) but NOT 6 (gate 7 refusal).
    expect(code).not.toBe(6);
  });
});
