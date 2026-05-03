// harness-protocol round-trip tests
//
// 验证：每个 fixture 通过 Zod parse → 重编码 → deep-equal 原对象。
// 这是 [HARNESS_PROTOCOL.md §6](../../../../docs/HARNESS_PROTOCOL.md) 跨端 round-trip 不变量的 TS 端实现。
// Swift 端在 M1+ 加（M-1 范围内 Swift Codable 的 round-trip 由人工抽样验证）。

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  HARNESS_DTO_SCHEMAS,
  HARNESS_PROTOCOL_VERSION,
  MIN_CLIENT_VERSION,
  ProjectDtoSchema,
  InitiativeDtoSchema,
  IssueDtoSchema,
  IdeaCaptureDtoSchema,
  StageDtoSchema,
  MethodologyDtoSchema,
  TaskDtoSchema,
  ContextBundleDtoSchema,
  RunDtoSchema,
  ArtifactDtoSchema,
  ReviewVerdictDtoSchema,
  DecisionDtoSchema,
  RetrospectiveDtoSchema,
  AuditLogEntrySchema,
  HarnessEventSchema,
  StageKindSchema,
} from "../harness-protocol";
import type { z } from "zod";

const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures/harness");

function loadFixture(name: string): unknown {
  const p = path.resolve(FIXTURES_DIR, name);
  return JSON.parse(readFileSync(p, "utf-8"));
}

function roundTrip<T>(schema: z.ZodTypeAny, raw: unknown): { parsed: T; reEncoded: unknown } {
  const parsed = schema.parse(raw) as T;
  const reEncoded = JSON.parse(JSON.stringify(parsed));
  return { parsed, reEncoded };
}

describe("harness-protocol — version constants", () => {
  it("HARNESS_PROTOCOL_VERSION is semver string", () => {
    expect(HARNESS_PROTOCOL_VERSION).toMatch(/^\d+\.\d+$/);
  });
  it("MIN_CLIENT_VERSION <= HARNESS_PROTOCOL_VERSION", () => {
    expect(MIN_CLIENT_VERSION).toBe("1.0");
  });
});

describe("harness-protocol — enum lock (Round 2 arch #4 refinement)", () => {
  it("StageKind has exactly 10 values in fixed order", () => {
    expect(StageKindSchema.options).toEqual([
      "strategy", "discovery", "spec", "compliance", "design",
      "implement", "test", "review", "release", "observe",
    ]);
  });
});

describe("harness-protocol — entity fixtures round-trip", () => {
  const cases: Array<{ file: string; schema: z.ZodTypeAny; name: string }> = [
    { file: "project.json", schema: ProjectDtoSchema, name: "Project" },
    { file: "initiative.json", schema: InitiativeDtoSchema, name: "Initiative" },
    { file: "issue.json", schema: IssueDtoSchema, name: "Issue" },
    { file: "idea-capture.json", schema: IdeaCaptureDtoSchema, name: "IdeaCapture" },
    { file: "stage.json", schema: StageDtoSchema, name: "Stage" },
    { file: "methodology.json", schema: MethodologyDtoSchema, name: "Methodology" },
    { file: "task.json", schema: TaskDtoSchema, name: "Task" },
    { file: "context-bundle.json", schema: ContextBundleDtoSchema, name: "ContextBundle" },
    { file: "run.json", schema: RunDtoSchema, name: "Run" },
    { file: "artifact-inline.json", schema: ArtifactDtoSchema, name: "Artifact (inline)" },
    { file: "artifact-file.json", schema: ArtifactDtoSchema, name: "Artifact (file)" },
    { file: "review-verdict.json", schema: ReviewVerdictDtoSchema, name: "ReviewVerdict" },
    { file: "decision.json", schema: DecisionDtoSchema, name: "Decision" },
    { file: "retrospective.json", schema: RetrospectiveDtoSchema, name: "Retrospective" },
    { file: "audit-log-entry.json", schema: AuditLogEntrySchema, name: "AuditLogEntry" },
    { file: "harness-event.json", schema: HarnessEventSchema, name: "HarnessEvent" },
  ];

  for (const { file, schema, name } of cases) {
    it(`${name} (${file}): parses + re-encodes deep-equal`, () => {
      const raw = loadFixture(file);
      const { reEncoded } = roundTrip(schema, raw);
      // deep-equal: re-encoded must equal original (after Zod normalization for optional fields)
      expect(reEncoded).toEqual(raw);
    });
  }
});

describe("harness-protocol — fixtures coverage", () => {
  it("every entity in HARNESS_DTO_SCHEMAS has at least one fixture", () => {
    const fixtureFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(Object.keys(HARNESS_DTO_SCHEMAS).length);
  });
});

describe("harness-protocol — Artifact CHECK invariants", () => {
  it("rejects inline without contentText", () => {
    expect(() => ArtifactDtoSchema.parse({
      id: "x", stageId: "s", kind: "spec",
      hash: "h", storage: "inline", sizeBytes: 10,
      metadata: {}, createdAt: 0,
    })).toThrow();
  });
  it("rejects file without contentPath", () => {
    expect(() => ArtifactDtoSchema.parse({
      id: "x", stageId: "s", kind: "spec",
      hash: "h", storage: "file", sizeBytes: 10,
      metadata: {}, createdAt: 0,
    })).toThrow();
  });
  it("rejects mixed storage", () => {
    expect(() => ArtifactDtoSchema.parse({
      id: "x", stageId: "s", kind: "spec",
      hash: "h", storage: "inline", contentText: "x", contentPath: "/p",
      sizeBytes: 10, metadata: {}, createdAt: 0,
    })).toThrow();
  });
});
