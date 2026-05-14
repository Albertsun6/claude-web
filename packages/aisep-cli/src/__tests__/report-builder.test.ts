// Option E Stage E.1 — buildReport snapshot tests.

import { describe, expect, it } from "vitest";

import { buildReport } from "../report/builder.js";
import type { BuildReportInput } from "../report/types.js";

const WS = {
  id: "ws-pilot",
  name: "test",
  cwd: "/tmp/test",
  status: "active" as const,
  techStack: [],
  createdAt: 1747929000000,
  shipCount: 0,
  adoptedPatterns: [],
};

const SHA256 = "sha256:" + "a".repeat(64);

function mkRun(
  id: string,
  stage: BuildReportInput["stageRuns"][number]["stage"],
  fanOutRole: "normal" | "parent" | "child" = "normal",
  parentStageRunId?: string,
  subStages: string[] = [],
): BuildReportInput["stageRuns"][number] {
  return {
    id,
    workspaceId: WS.id,
    stage,
    phase: "none",
    status: "succeeded",
    fanOutRole,
    subStages,
    ...(parentStageRunId ? { parentStageRunId } : {}),
    startedAt: 1747929000000,
    endedAt: 1747929000000 + 60_000,
  } as BuildReportInput["stageRuns"][number];
}

function mkArtifact(stageRunId: string, kind: string, key: string) {
  return {
    id: `art-${stageRunId}-${kind}`,
    workspaceId: WS.id,
    stageRunId,
    ref: { kind: kind as never, key },
    contentHash: SHA256,
    storage: "inline" as const,
    contentUri: `sqlite://artifact_blob/${stageRunId}`,
    contentInline: "",
    sizeBytes: 0,
    producedAt: 1747929000000,
  };
}

describe("buildReport (Option E Stage E.1)", () => {
  it("projects single-stage docs-only chain to flat timeline", () => {
    const input: BuildReportInput = {
      workspace: WS,
      stageRuns: [
        mkRun("sr-1", "intake"),
        mkRun("sr-2", "implement"),
        mkRun("sr-3", "verify"),
      ],
      artifacts: [
        mkArtifact("sr-1", "intake", "intake.md"),
        mkArtifact("sr-2", "patch", "implement.md"),
        mkArtifact("sr-3", "verify_report", "verify.md"),
      ],
      generatedAt: 1747929999999,
    };
    const r = buildReport(input);
    expect(r.stages).toHaveLength(3);
    expect(r.stages[0]!.outputKey).toBe("intake.md");
    expect(r.stages[1]!.outputKey).toBe("implement.md");
    expect(r.parallelGroups).toHaveLength(0);
    expect(r.workspace.name).toBe("test");
    expect(r.generatedAt).toBe(1747929999999);
  });

  it("projects fan-out parent + 3 children with subStageName extraction", () => {
    const input: BuildReportInput = {
      workspace: WS,
      stageRuns: [
        mkRun("sr-contract", "contract"),
        mkRun("sr-parent", "implement", "parent", undefined, ["sr-be", "sr-fe", "sr-tests"]),
        mkRun("sr-be", "implement", "child", "sr-parent"),
        mkRun("sr-fe", "implement", "child", "sr-parent"),
        mkRun("sr-tests", "implement", "child", "sr-parent"),
        mkRun("sr-verify", "verify"),
      ],
      artifacts: [
        mkArtifact("sr-contract", "contract_frozen", "contract.md"),
        mkArtifact("sr-parent", "patch_set", "patch_set/implement.json"),
        mkArtifact("sr-be", "patch", "implement-backend.md"),
        mkArtifact("sr-fe", "patch", "implement-frontend.md"),
        mkArtifact("sr-tests", "patch", "implement-tests.md"),
        mkArtifact("sr-verify", "verify_report", "verify.md"),
      ],
    };
    const r = buildReport(input);
    expect(r.parallelGroups).toHaveLength(1);
    const fanOut = r.parallelGroups[0]!;
    expect(fanOut.parentId).toBe("sr-parent");
    expect(fanOut.direction).toBe("out");
    expect(fanOut.childIds).toEqual(["sr-be", "sr-fe", "sr-tests"]);
    expect(fanOut.childNames).toEqual({
      "sr-be": "backend",
      "sr-fe": "frontend",
      "sr-tests": "tests",
    });
    // Child stages have subStageName projected from artifact key.
    const beStage = r.stages.find((s) => s.id === "sr-be")!;
    expect(beStage.fanOutRole).toBe("child");
    expect(beStage.subStageName).toBe("backend");
    expect(beStage.parentStageRunId).toBe("sr-parent");
  });

  it("extracts trace anchors + ADR/ZOD refs from artifact contents", () => {
    const input: BuildReportInput = {
      workspace: WS,
      stageRuns: [
        mkRun("sr-intake", "intake"),
        mkRun("sr-arch", "architecture"),
        mkRun("sr-impl", "implement"),
      ],
      artifacts: [
        mkArtifact("sr-intake", "intake", "intake.md"),
        mkArtifact("sr-arch", "adr", "architecture/brief.md"),
        mkArtifact("sr-impl", "patch", "implement.md"),
      ],
      artifactContents: {
        "intake.md": "REQ-001: user login. RISK-Q1: auth failure handling.",
        "architecture/brief.md":
          "ADR-001 decides REQ-001 via ZOD-LoginSchema. Trade-off vs ADR-002.",
        "implement.md":
          "Implements REQ-001 per ADR-001 using ZOD-LoginSchema validation.",
      },
    };
    const r = buildReport(input);
    const req001 = r.traceMatrix.find((row) => row.anchorId === "REQ-001");
    expect(req001).toBeDefined();
    expect(req001!.declaredIn).toBe("intake");
    expect(req001!.adrRefs).toContain("ADR-001");
    expect(req001!.zodRefs).toContain("ZOD-LoginSchema");
    expect(req001!.patchRefs).toContain("implement.md");
    const risk = r.traceMatrix.find((row) => row.anchorId === "RISK-Q1");
    expect(risk).toBeDefined();
    expect(risk!.declaredIn).toBe("intake");
  });

  it("extracts contract_grep drill-down from verify.md JSON block", () => {
    const verifyJson = JSON.stringify({
      outcome: "skipped_no_runtime",
      contract_grep: {
        ok: true,
        checks: [
          { name: "patch present", command: "grep -q 'X' implement.md", ok: true, readFromDisk: true },
          { name: "schema match", command: "grep -q 'Y' implement.md", ok: false, readFromDisk: true },
        ],
      },
    });
    const input: BuildReportInput = {
      workspace: WS,
      stageRuns: [mkRun("sr-verify", "verify")],
      artifacts: [mkArtifact("sr-verify", "verify_report", "verify.md")],
      artifactContents: {
        "verify.md": "preamble\n```json\n" + verifyJson + "\n```\nepilogue",
      },
    };
    const r = buildReport(input);
    expect(r.contractGrepChecks).toHaveLength(2);
    expect(r.contractGrepChecks[0]!.name).toBe("patch present");
    expect(r.contractGrepChecks[0]!.ok).toBe(true);
    expect(r.contractGrepChecks[0]!.readFromDisk).toBe(true);
    expect(r.contractGrepChecks[1]!.ok).toBe(false);
  });

  it("gracefully empties trace + checks when artifactContents omitted", () => {
    const input: BuildReportInput = {
      workspace: WS,
      stageRuns: [mkRun("sr-1", "intake")],
      artifacts: [mkArtifact("sr-1", "intake", "intake.md")],
      // artifactContents omitted
    };
    const r = buildReport(input);
    expect(r.traceMatrix).toEqual([]);
    expect(r.contractGrepChecks).toEqual([]);
    expect(r.memoryHits).toEqual([]); // v0.3 MVP always empty
  });

  // v0.4 (ADR-022 Q6 F10): per-child contract_grep + direction discriminator.
  it("v0.4: detects direction='in' when parent.predecessorId points to another fan-out parent", () => {
    const implParent = mkRun("sr-impl-parent", "implement", "parent", undefined, [
      "sr-impl-be",
      "sr-impl-fe",
    ]);
    const implBE = {
      ...mkRun("sr-impl-be", "implement", "child", "sr-impl-parent"),
      affects: ["packages/backend/.*"],
    };
    const implFE = {
      ...mkRun("sr-impl-fe", "implement", "child", "sr-impl-parent"),
      affects: ["packages/frontend/.*"],
    };
    const verifyParent = {
      ...mkRun("sr-verify-parent", "verify", "parent", undefined, [
        "sr-verify-be",
        "sr-verify-fe",
      ]),
      predecessorId: "sr-impl-parent",
    };
    const verifyBE = {
      ...mkRun("sr-verify-be", "verify", "child", "sr-verify-parent"),
      predecessorId: "sr-impl-be",
      affects: ["packages/backend/.*"],
    };
    const verifyFE = {
      ...mkRun("sr-verify-fe", "verify", "child", "sr-verify-parent"),
      predecessorId: "sr-impl-fe",
      affects: ["packages/frontend/.*"],
    };
    const r = buildReport({
      workspace: WS,
      stageRuns: [implParent, implBE, implFE, verifyParent, verifyBE, verifyFE],
      artifacts: [],
    });
    expect(r.parallelGroups).toHaveLength(2);
    const fanOut = r.parallelGroups.find((g) => g.parentStage === "implement")!;
    const fanIn = r.parallelGroups.find((g) => g.parentStage === "verify")!;
    expect(fanOut.direction).toBe("out");
    expect(fanIn.direction).toBe("in");
    expect(fanIn.upstreamPredecessorByChildId).toEqual({
      "sr-verify-be": "sr-impl-be",
      "sr-verify-fe": "sr-impl-fe",
    });
  });

  it("v0.4: populates affectsByChildId from each child's affects regex array", () => {
    const parent = mkRun("sr-parent", "implement", "parent", undefined, [
      "sr-c1",
      "sr-c2",
    ]);
    const c1 = { ...mkRun("sr-c1", "implement", "child", "sr-parent"), affects: ["packages/backend/.*"] };
    const c2 = {
      ...mkRun("sr-c2", "implement", "child", "sr-parent"),
      affects: ["packages/frontend/.*", "packages/shared/types/.*"],
    };
    const r = buildReport({
      workspace: WS,
      stageRuns: [parent, c1, c2],
      artifacts: [],
    });
    const group = r.parallelGroups[0]!;
    expect(group.affectsByChildId).toEqual({
      "sr-c1": ["packages/backend/.*"],
      "sr-c2": ["packages/frontend/.*", "packages/shared/types/.*"],
    });
  });

  it("v0.4: upstreamPredecessorByChildId empty for fan-out (direction='out')", () => {
    const parent = mkRun("sr-parent", "implement", "parent", undefined, ["sr-c1", "sr-c2"]);
    const c1 = { ...mkRun("sr-c1", "implement", "child", "sr-parent"), affects: ["a/.*"] };
    const c2 = { ...mkRun("sr-c2", "implement", "child", "sr-parent"), affects: ["b/.*"] };
    const r = buildReport({
      workspace: WS,
      stageRuns: [parent, c1, c2],
      artifacts: [],
    });
    const group = r.parallelGroups[0]!;
    expect(group.direction).toBe("out");
    expect(group.upstreamPredecessorByChildId).toEqual({});
  });
});
