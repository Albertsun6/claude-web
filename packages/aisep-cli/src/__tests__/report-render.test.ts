// Option E Stage E.2 — renderReport snapshot tests.

import { describe, expect, it } from "vitest";

import { renderReport } from "../report/render.js";
import type { AisepReport } from "../report/types.js";

const WS = {
  id: "ws-test",
  name: "test-workspace",
  cwd: "/tmp/test",
  status: "active" as const,
  techStack: ["typescript", "node"],
  createdAt: 1747929000000,
  shipCount: 1,
  adoptedPatterns: [],
};

function mkReport(over: Partial<AisepReport> = {}): AisepReport {
  return {
    workspace: WS,
    generatedAt: 1747929999999,
    stages: [],
    fanOuts: [],
    traceMatrix: [],
    contractGrepChecks: [],
    memoryHits: [],
    ...over,
  };
}

describe("renderReport (Option E Stage E.2)", () => {
  it("renders minimal empty report containing all 5 sections", () => {
    const html = renderReport(mkReport());
    expect(html).toContain('<title>AISEP Report — test-workspace</title>');
    expect(html).toContain('id="summary"');
    expect(html).toContain('id="stage-timeline"');
    expect(html).toContain('id="fanout-tree"');
    expect(html).toContain('id="trace-matrix"');
    expect(html).toContain('id="contract-grep"');
    expect(html).toContain('id="aisep-report-data"');
    // Empty-section placeholders
    expect(html).toContain("No stage_runs.");
    expect(html).toContain("No fan-out (linear chain).");
    expect(html).toContain("No trace anchors found");
    expect(html).toContain("No contract_grep checks found");
  });

  it("renders stage timeline + table for 3 normal stages", () => {
    const html = renderReport(
      mkReport({
        stages: [
          {
            id: "sr-intake-01HJK5XH",
            stage: "intake",
            status: "succeeded",
            phase: "none",
            fanOutRole: "normal",
            startedAt: 1747929000000,
            endedAt: 1747929060000,
            durationMs: 60000,
            outputKey: "intake.md",
          },
          {
            id: "sr-implement-01HJK5XH",
            stage: "implement",
            status: "succeeded",
            phase: "none",
            fanOutRole: "normal",
            startedAt: 1747929060000,
            endedAt: 1747929180000,
            durationMs: 120000,
            outputKey: "implement.md",
          },
          {
            id: "sr-verify-01HJK5XH",
            stage: "verify",
            status: "succeeded",
            phase: "none",
            fanOutRole: "normal",
            startedAt: 1747929180000,
            endedAt: 1747929240000,
            durationMs: 60000,
            outputKey: "verify.md",
          },
        ],
      }),
    );
    expect(html).toContain("gantt");
    expect(html).toContain("AISEP Stage Chain");
    expect(html).toContain("intake :");
    expect(html).toContain("implement :");
    expect(html).toContain("verify :");
    // Table row with stage name
    expect(html).toContain("intake.md");
    expect(html).toContain("status-succeeded");
    expect(html).toContain("60.0s"); // duration formatted
  });

  it("renders fan-out parent + 3 children flowchart + correct child names", () => {
    const html = renderReport(
      mkReport({
        stages: [
          {
            id: "sr-parent",
            stage: "implement",
            status: "succeeded",
            phase: "none",
            fanOutRole: "parent",
          },
          {
            id: "sr-be",
            stage: "implement",
            status: "succeeded",
            phase: "none",
            fanOutRole: "child",
            parentStageRunId: "sr-parent",
            subStageName: "backend",
          },
          {
            id: "sr-fe",
            stage: "implement",
            status: "succeeded",
            phase: "none",
            fanOutRole: "child",
            parentStageRunId: "sr-parent",
            subStageName: "frontend",
          },
          {
            id: "sr-tests",
            stage: "implement",
            status: "failed",
            phase: "none",
            fanOutRole: "child",
            parentStageRunId: "sr-parent",
            subStageName: "tests",
          },
        ],
        fanOuts: [
          {
            parentId: "sr-parent",
            parentStage: "implement",
            childIds: ["sr-be", "sr-fe", "sr-tests"],
            childNames: { "sr-be": "backend", "sr-fe": "frontend", "sr-tests": "tests" },
          },
        ],
      }),
    );
    expect(html).toContain("flowchart TD");
    expect(html).toContain('"backend"');
    expect(html).toContain('"frontend"');
    expect(html).toContain('"tests"');
    expect(html).toContain("status-failed");
    expect(html).toContain("role-parent");
    expect(html).toContain("role-child");
    // Child rows show subStageName
    expect(html).toContain("implement · backend");
    expect(html).toContain("implement · tests");
  });

  it("renders trace matrix rows", () => {
    const html = renderReport(
      mkReport({
        traceMatrix: [
          {
            anchorId: "REQ-001",
            declaredIn: "intake",
            adrRefs: ["ADR-001"],
            zodRefs: ["ZOD-LoginSchema"],
            patchRefs: ["implement.md"],
            verifyChecks: [],
          },
          {
            anchorId: "RISK-Q1",
            declaredIn: "intake",
            adrRefs: [],
            zodRefs: [],
            patchRefs: [],
            verifyChecks: [],
          },
        ],
      }),
    );
    expect(html).toContain("REQ-001");
    expect(html).toContain("ADR-001");
    expect(html).toContain("ZOD-LoginSchema");
    expect(html).toContain("RISK-Q1");
    // Empty placeholder should NOT appear now
    expect(html).not.toContain("No trace anchors found");
  });

  it("renders contract_grep <details> drill-down with failing checks expanded", () => {
    const html = renderReport(
      mkReport({
        contractGrepChecks: [
          {
            stageRunId: "sr-verify",
            name: "patch present",
            command: "grep -q 'X' implement.md",
            ok: true,
            readFromDisk: true,
          },
          {
            stageRunId: "sr-verify",
            name: "schema match",
            command: "grep -q 'Y' implement.md",
            ok: false,
            readFromDisk: true,
          },
        ],
      }),
    );
    expect(html).toContain('class="check-ok"');
    expect(html).toContain('class="check-fail"');
    // Failed checks should be open by default (for audit visibility)
    expect(html).toMatch(/<details open>\s*<summary class="check-fail">schema match/);
    // [read_from_disk] tag
    expect(html).toContain("[read_from_disk]");
    // Command body present
    expect(html).toContain("grep -q &#39;X&#39; implement.md");
  });

  it("includes @media print CSS for PDF export", () => {
    const html = renderReport(mkReport());
    expect(html).toContain("@media print");
    expect(html).toContain("page-break-inside: avoid");
  });

  it("inlines AisepReport JSON as <script id=aisep-report-data>", () => {
    const html = renderReport(mkReport({ generatedAt: 1747929999999 }));
    const dataMatch = html.match(
      /<script id="aisep-report-data" type="application\/json">([\s\S]+?)<\/script>/,
    );
    expect(dataMatch).not.toBeNull();
    const json = JSON.parse(dataMatch![1]!);
    expect(json.generatedAt).toBe(1747929999999);
    expect(json.workspace.name).toBe("test-workspace");
  });
});
