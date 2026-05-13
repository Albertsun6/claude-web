// Negative cases for Round-2 schema fixes.
// Each test asserts a previously-permissive schema now rejects malformed input.

import { describe, expect, it } from "vitest";

import {
  AISEP_APPLIES_TO_WILDCARD,
  AISEP_ARTIFACT_INLINE_MAX_BYTES,
  AisepAgentInvocationSchema,
  AisepAgentProfileSchema,
  AisepArtifactSchema,
  AisepAttemptSchema,
  AisepStageRunSchema,
  TraceIdSchema,
} from "../index.js";

const SHA256_FIXTURE = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ID = "ws-01HJK5X";

describe("Round-2: AisepArtifact discriminated union", () => {
  const fileBase = {
    id: "art-1",
    workspaceId: ID,
    stageRunId: "sr-1",
    ref: { kind: "patch" as const, key: "patch/foo.diff" },
    contentHash: SHA256_FIXTURE,
    contentUri: "file:///tmp/foo.diff",
    sizeBytes: 100,
    producedAt: 1747929000000,
  };

  it("storage='file' with contentInline → rejects", () => {
    const bad = { ...fileBase, storage: "file" as const, contentInline: "leak" };
    expect(() => AisepArtifactSchema.parse(bad)).toThrow();
  });

  it("storage='inline' without contentInline → rejects", () => {
    const bad = { ...fileBase, storage: "inline" as const };
    expect(() => AisepArtifactSchema.parse(bad)).toThrow();
  });

  it(`storage='inline' with body > ${AISEP_ARTIFACT_INLINE_MAX_BYTES}B → rejects`, () => {
    const bad = {
      ...fileBase,
      storage: "inline" as const,
      contentInline: "x".repeat(AISEP_ARTIFACT_INLINE_MAX_BYTES + 1),
    };
    expect(() => AisepArtifactSchema.parse(bad)).toThrow();
  });

  it("storage='file' without contentInline → accepts", () => {
    const good = { ...fileBase, storage: "file" as const };
    expect(() => AisepArtifactSchema.parse(good)).not.toThrow();
  });

  it("storage='inline' with small body → accepts", () => {
    const good = {
      ...fileBase,
      storage: "inline" as const,
      contentInline: "{\"ok\":true}",
    };
    expect(() => AisepArtifactSchema.parse(good)).not.toThrow();
  });
});

describe("Round-2: AisepStageRun phase/slice cross-field", () => {
  const base = {
    id: "sr-1",
    workspaceId: ID,
    stage: "architecture" as const,
    status: "running" as const,
  };

  it("phase='none' with sliceIndex → rejects", () => {
    const bad = { ...base, phase: "none" as const, sliceIndex: 1, sliceTotal: 1 };
    expect(() => AisepStageRunSchema.parse(bad)).toThrow();
  });

  it("phase='architecture-detail-slice' without sliceIndex → rejects", () => {
    const bad = { ...base, phase: "architecture-detail-slice" as const };
    expect(() => AisepStageRunSchema.parse(bad)).toThrow();
  });

  it("phase='architecture-brief' with sliceTotal → rejects", () => {
    const bad = { ...base, phase: "architecture-brief" as const, sliceTotal: 3 };
    expect(() => AisepStageRunSchema.parse(bad)).toThrow();
  });

  it("phase='architecture-detail-slice' with both slice fields → accepts", () => {
    const good = {
      ...base,
      phase: "architecture-detail-slice" as const,
      sliceIndex: 1,
      sliceTotal: 3,
    };
    expect(() => AisepStageRunSchema.parse(good)).not.toThrow();
  });
});

describe("Round-2: AisepAttempt attemptN no longer capped at 2", () => {
  const base = {
    id: "att-1",
    stageRunId: "sr-1",
    invocation: {
      provider: "claude-cli" as const,
      model: "claude-opus-4-7",
      argv: ["--print"],
      cwd: "/tmp",
      promptHash: SHA256_FIXTURE,
    },
    status: "succeeded" as const,
    exitCode: 0,
    startedAt: 1747929000000,
    endedAt: 1747929100000,
  };

  it("attemptN=5 (e.g. flaky test retry) → accepts (M4 cap is runtime, not schema)", () => {
    const good = { ...base, attemptN: 5 };
    expect(() => AisepAttemptSchema.parse(good)).not.toThrow();
  });

  it("attemptN=0 → still rejected (min=1)", () => {
    const bad = { ...base, attemptN: 0 };
    expect(() => AisepAttemptSchema.parse(bad)).toThrow();
  });
});

describe("Round-2: AisepAgentInvocation provider-neutral envelope", () => {
  it("missing provider → rejects", () => {
    const bad = {
      model: "claude-opus-4-7",
      argv: [],
      cwd: "/tmp",
      promptHash: SHA256_FIXTURE,
    };
    expect(() => AisepAgentInvocationSchema.parse(bad)).toThrow();
  });

  it("provider='other' with rawCmd → accepts (escape hatch)", () => {
    const good = {
      provider: "other" as const,
      model: "experimental-model-x",
      argv: ["--some", "flag"],
      cwd: "/tmp",
      rawCmd: "experimental --some flag",
      promptHash: SHA256_FIXTURE,
    };
    expect(() => AisepAgentInvocationSchema.parse(good)).not.toThrow();
  });

  it("all 5 known providers + 'other' parse cleanly", () => {
    for (const provider of ["claude-cli", "cursor-agent", "codex", "gemini-cli", "ollama", "other"] as const) {
      const good = {
        provider,
        model: "m",
        argv: [],
        cwd: "/tmp",
        promptHash: SHA256_FIXTURE,
      };
      expect(() => AisepAgentInvocationSchema.parse(good)).not.toThrow();
    }
  });
});

describe("Round-2: AisepAgentProfile renamed ba → planner", () => {
  it("'planner' → accepts", () => {
    expect(() => AisepAgentProfileSchema.parse("planner")).not.toThrow();
  });

  it("'ba' → rejects (renamed to planner)", () => {
    expect(() => AisepAgentProfileSchema.parse("ba")).toThrow();
  });
});

describe("Round-2: TraceId adds FIX + TEST namespaces", () => {
  it("'FIX-0001' → accepts", () => {
    expect(() => TraceIdSchema.parse("FIX-0001")).not.toThrow();
  });

  it("'TEST-0001' → accepts", () => {
    expect(() => TraceIdSchema.parse("TEST-0001")).not.toThrow();
  });

  it("'XYZ-001' (unknown namespace) → rejects", () => {
    expect(() => TraceIdSchema.parse("XYZ-001")).toThrow();
  });
});

describe("Round-2: AISEP_APPLIES_TO_WILDCARD exported", () => {
  it("equals literal '*'", () => {
    expect(AISEP_APPLIES_TO_WILDCARD).toBe("*");
  });
});
