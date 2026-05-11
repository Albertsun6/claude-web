import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AisepStore } from "../store.js";
import { IllegalStateTransitionError } from "../state-machine.js";
import { hashString } from "../hash.js";

let tmpWorkspace: string;

beforeEach(() => {
  tmpWorkspace = mkdtempSync(join(tmpdir(), "aisep-store-"));
});

afterEach(() => {
  rmSync(tmpWorkspace, { recursive: true, force: true });
});

describe("AisepStore", () => {
  it("starts empty when no state.json exists", () => {
    const store = new AisepStore(tmpWorkspace, "ws-1");
    expect(store.listStageRuns()).toEqual([]);
  });

  it("creates a stage_run with status=pending", () => {
    const store = new AisepStore(tmpWorkspace, "ws-1");
    const run = store.createStageRun({
      workspaceId: "ws-1",
      stage: "intake",
      phase: "none",
    });
    expect(run.status).toBe("pending");
    expect(run.id).toMatch(/^sr-/);
  });

  it("persists state across instances (file round-trip)", () => {
    const a = new AisepStore(tmpWorkspace, "ws-1");
    a.createStageRun({ workspaceId: "ws-1", stage: "intake", phase: "none" });

    const b = new AisepStore(tmpWorkspace, "ws-1");
    expect(b.listStageRuns()).toHaveLength(1);
  });

  it("enforces state-machine transitions on update", () => {
    const store = new AisepStore(tmpWorkspace, "ws-1");
    const run = store.createStageRun({ workspaceId: "ws-1", stage: "intake", phase: "none" });
    expect(() => store.updateStageRunStatus(run.id, "succeeded")).toThrow(IllegalStateTransitionError);
  });

  it("appends artifact and lists by stageRunId", () => {
    const store = new AisepStore(tmpWorkspace, "ws-1");
    const run = store.createStageRun({ workspaceId: "ws-1", stage: "intake", phase: "none" });
    const artifact = store.appendArtifact({
      workspaceId: "ws-1",
      stageRunId: run.id,
      ref: { kind: "intake", key: "intake.yaml" },
      contentHash: hashString("hello"),
      storage: "inline",
      contentUri: "sqlite://artifact_blob/mock",
      contentInline: "hello",
      sizeBytes: 5,
    } as Parameters<typeof store.appendArtifact>[0]);
    expect(artifact.id).toMatch(/^art-/);
    expect(store.listArtifactsByStageRun(run.id)).toHaveLength(1);
  });

  it("latestAttemptN starts at 0 and increments", () => {
    const store = new AisepStore(tmpWorkspace, "ws-1");
    const run = store.createStageRun({ workspaceId: "ws-1", stage: "intake", phase: "none" });
    expect(store.latestAttemptN(run.id)).toBe(0);

    store.appendAttempt({
      stageRunId: run.id,
      attemptN: 1,
      invocation: {
        provider: "other",
        model: "test",
        argv: [],
        cwd: tmpWorkspace,
        promptHash: hashString("p"),
      },
      reviewState: "draft",
      outputArtifactIds: [],
      status: "succeeded",
      exitCode: 0,
    });
    expect(store.latestAttemptN(run.id)).toBe(1);
  });
});
