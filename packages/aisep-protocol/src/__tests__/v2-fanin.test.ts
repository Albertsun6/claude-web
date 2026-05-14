// v2 fan-in (ADR-022) schema tests.
//
// Covers Decision 1-5 + Q1b at the wire-format layer:
// - protocol@0.4.0 version bump
// - StageRunCommonShape gains `affects: string[]` (required non-empty for child)
// - StageRunCommonShape gains `migratedFromV03?: boolean` audit marker
// - FAN_OUT_ALLOWED_STAGES whitelist (implement/verify/review)
// - Cross-version round-trip A: v0.3-shape → v0.4 schema rejects
// - Cross-version round-trip B: v0.4-shape → v0.3-snapshot schema rejects
//
// State-machine retry-marker (Decision 4) lives in aisep-core's
// state-machine.ts and is exercised in Slice 3 runner tests.

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AISEP_PROTOCOL_VERSION,
  AisepStage,
  AisepStageRunSchema,
  FAN_OUT_ALLOWED_STAGES,
} from "../index.js";

const PARENT_BASE = {
  id: "sr-parent-01HJK5X",
  workspaceId: "ws-01HJK5X",
  stage: "implement" as const,
  status: "running" as const,
  phase: "none" as const,
};

const CHILD_BASE = {
  id: "sr-child-01HJK5X",
  workspaceId: "ws-01HJK5X",
  stage: "implement" as const,
  status: "pending" as const,
  phase: "none" as const,
  affects: ["packages/backend/.*"],
};

describe("v2 fan-in: protocol version bump", () => {
  it("AISEP_PROTOCOL_VERSION is 0.4.0", () => {
    expect(AISEP_PROTOCOL_VERSION).toBe("0.4.0");
  });
});

describe("v2 fan-in: affects field (Decision 2)", () => {
  it("child requires non-empty affects", () => {
    const { affects: _omit, ...withoutAffects } = CHILD_BASE;
    expect(() =>
      AisepStageRunSchema.parse({
        ...withoutAffects,
        fanOutRole: "child",
        parentStageRunId: "sr-parent",
      }),
    ).toThrow(/affects.*regex patterns declaring touched paths/);
  });

  it("child rejects empty affects array", () => {
    expect(() =>
      AisepStageRunSchema.parse({
        ...CHILD_BASE,
        fanOutRole: "child",
        parentStageRunId: "sr-parent",
        affects: [],
      }),
    ).toThrow(/affects/);
  });

  it("child rejects affects with empty-string patterns", () => {
    expect(() =>
      AisepStageRunSchema.parse({
        ...CHILD_BASE,
        fanOutRole: "child",
        parentStageRunId: "sr-parent",
        affects: [""],
      }),
    ).toThrow();
  });

  it("child accepts multiple regex patterns in affects", () => {
    const parsed = AisepStageRunSchema.parse({
      ...CHILD_BASE,
      fanOutRole: "child",
      parentStageRunId: "sr-parent",
      affects: ["packages/backend/src/.*\\.ts", "packages/shared/src/types/.*"],
    });
    expect(parsed.affects).toHaveLength(2);
  });

  it("normal role defaults affects to []", () => {
    const parsed = AisepStageRunSchema.parse({
      ...PARENT_BASE,
      status: "succeeded",
    });
    expect(parsed.affects).toEqual([]);
  });

  it("parent role defaults affects to []", () => {
    const parsed = AisepStageRunSchema.parse({
      ...PARENT_BASE,
      fanOutRole: "parent",
      subStages: ["sr-c1", "sr-c2"],
    });
    expect(parsed.affects).toEqual([]);
  });
});

describe("v2 fan-in: migratedFromV03 audit marker (Decision 2)", () => {
  it("defaults to false on fresh v0.4 child", () => {
    const parsed = AisepStageRunSchema.parse({
      ...CHILD_BASE,
      fanOutRole: "child",
      parentStageRunId: "sr-parent",
    });
    expect(parsed.migratedFromV03).toBe(false);
  });

  it("accepts migratedFromV03=true on a migrated child carrying [\".*\"]", () => {
    const parsed = AisepStageRunSchema.parse({
      ...CHILD_BASE,
      fanOutRole: "child",
      parentStageRunId: "sr-parent",
      affects: [".*"],
      migratedFromV03: true,
    });
    expect(parsed.migratedFromV03).toBe(true);
    expect(parsed.affects).toEqual([".*"]);
  });

  it("defaults to false on parent/normal rows", () => {
    const parent = AisepStageRunSchema.parse({
      ...PARENT_BASE,
      fanOutRole: "parent",
      subStages: ["sr-c1"],
    });
    expect(parent.migratedFromV03).toBe(false);
  });
});

describe("v2 fan-in: FAN_OUT_ALLOWED_STAGES whitelist (Q1b)", () => {
  it("exports a Set containing implement, verify, review", () => {
    expect(FAN_OUT_ALLOWED_STAGES.has("implement")).toBe(true);
    expect(FAN_OUT_ALLOWED_STAGES.has("verify")).toBe(true);
    expect(FAN_OUT_ALLOWED_STAGES.has("review")).toBe(true);
    expect(FAN_OUT_ALLOWED_STAGES.size).toBe(3);
  });

  it("excludes integrate (fan-in terminal aggregation, not source)", () => {
    expect(FAN_OUT_ALLOWED_STAGES.has("integrate")).toBe(false);
  });

  it.each(["verify", "review"] as const)(
    "accepts parent on whitelisted stage '%s'",
    (stage) => {
      const parsed = AisepStageRunSchema.parse({
        ...PARENT_BASE,
        stage,
        fanOutRole: "parent",
        subStages: ["sr-c1", "sr-c2"],
      });
      expect(parsed.stage).toBe(stage);
      expect(parsed.fanOutRole).toBe("parent");
    },
  );

  it.each(["verify", "review"] as const)(
    "accepts child on whitelisted stage '%s'",
    (stage) => {
      const parsed = AisepStageRunSchema.parse({
        ...CHILD_BASE,
        stage,
        fanOutRole: "child",
        parentStageRunId: "sr-parent",
      });
      expect(parsed.stage).toBe(stage);
      expect(parsed.fanOutRole).toBe("child");
    },
  );

  // Architecture stage has its own brief/detail-slice phases — fan-out
  // doesn't compose with those phases in v2, hence excluded from whitelist.
  it.each(
    ["intake", "research", "plan", "contract", "integrate", "retrospect"] as const,
  )("rejects parent on non-whitelisted stage '%s'", (stage) => {
    expect(() =>
      AisepStageRunSchema.parse({
        ...PARENT_BASE,
        stage,
        fanOutRole: "parent",
        subStages: ["sr-c1"],
      }),
    ).toThrow(/parent.*only allowed for stages in FAN_OUT_ALLOWED_STAGES/);
  });

  it.each(
    ["intake", "research", "plan", "contract", "integrate", "retrospect"] as const,
  )("rejects child on non-whitelisted stage '%s'", (stage) => {
    expect(() =>
      AisepStageRunSchema.parse({
        ...CHILD_BASE,
        stage,
        fanOutRole: "child",
        parentStageRunId: "sr-parent",
      }),
    ).toThrow(/child.*only allowed for stages in FAN_OUT_ALLOWED_STAGES/);
  });
});

describe("v2 fan-in: Q3 revocation (no predecessorIds[] field)", () => {
  it("schema does NOT expose a predecessorIds[] plural field", () => {
    // Q3 revoked the v0 plan to lift predecessorId to predecessors[].
    // Cross-stage linkage stays on the single predecessorId chain.
    const parsed = AisepStageRunSchema.parse({
      ...PARENT_BASE,
      status: "succeeded",
    });
    expect((parsed as Record<string, unknown>).predecessorIds).toBeUndefined();
  });
});

// ============================================================================
// Cross-version round-trip (dogfood gate 7+8 at the wire-format layer)
// ============================================================================

/**
 * Frozen snapshot of v0.3 child stage_run schema — captures the wire shape
 * BEFORE the v0.4 `affects` / `migratedFromV03` field additions. Used to
 * prove that v0.4 wire data is REJECTED by a v0.3 binary (dogfood gate 8).
 *
 * Only the fields needed for the round-trip assertion are modeled.
 */
const v03StageRunChildSnapshot = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    stage: z.literal("implement"),
    phase: z.literal("none"),
    status: z.enum(["pending", "running", "succeeded", "failed"]),
    fanOutRole: z.literal("child"),
    parentStageRunId: z.string().min(1),
    subStages: z.array(z.string()).default([]),
  })
  .strict();

describe("v2 fan-in: cross-version round-trip A (v0.3 data → v0.4 schema)", () => {
  it("v0.3 child stage_run (no affects) → v0.4 schema rejects with clear affects-required error", () => {
    const v03Data = {
      id: "sr-v03-child",
      workspaceId: "ws-1",
      stage: "implement",
      phase: "none",
      status: "succeeded",
      fanOutRole: "child",
      parentStageRunId: "sr-v03-parent",
    };

    let error: unknown;
    try {
      AisepStageRunSchema.parse(v03Data);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(z.ZodError);
    const issues = (error as z.ZodError).issues;
    expect(issues.some((i) => i.path.includes("affects"))).toBe(true);
  });

  it("v0.3 parent stage_run (no affects) → v0.4 schema accepts (parent doesn't need affects)", () => {
    // Parent rows pre-existing in v0.3 state.json must still parse against
    // v0.4 schema — affects is required only for child rows. This is the
    // primary upgrade-path compat guarantee.
    const v03ParentData = {
      id: "sr-v03-parent",
      workspaceId: "ws-1",
      stage: "implement",
      phase: "none",
      status: "succeeded",
      fanOutRole: "parent",
      subStages: ["sr-c1", "sr-c2"],
    };
    const parsed = AisepStageRunSchema.parse(v03ParentData);
    expect(parsed.affects).toEqual([]);
    expect(parsed.migratedFromV03).toBe(false);
  });
});

describe("v2 fan-in: cross-version round-trip B (v0.4 data → v0.3 frozen schema)", () => {
  it("v0.4 child stage_run (with affects) → v0.3 strict schema rejects unknown 'affects' key", () => {
    const v04Data = {
      id: "sr-v04-child",
      workspaceId: "ws-1",
      stage: "implement" as const,
      phase: "none" as const,
      status: "pending" as const,
      fanOutRole: "child" as const,
      parentStageRunId: "sr-parent",
      affects: ["packages/backend/.*"],
    };

    let error: unknown;
    try {
      v03StageRunChildSnapshot.parse(v04Data);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(z.ZodError);
    const issues = (error as z.ZodError).issues;
    // Strict mode reports unrecognized_keys with the offending key(s).
    expect(
      issues.some(
        (i) =>
          i.code === "unrecognized_keys" &&
          Array.isArray((i as z.ZodIssue & { keys?: string[] }).keys) &&
          (i as z.ZodIssue & { keys?: string[] }).keys!.includes("affects"),
      ),
    ).toBe(true);
  });

  it("v0.4 migrated child (with migratedFromV03 + affects=[\".*\"]) → v0.3 strict schema rejects both unknown keys", () => {
    const v04Migrated = {
      id: "sr-v04-migrated",
      workspaceId: "ws-1",
      stage: "implement" as const,
      phase: "none" as const,
      status: "succeeded" as const,
      fanOutRole: "child" as const,
      parentStageRunId: "sr-parent",
      affects: [".*"],
      migratedFromV03: true,
    };

    let error: unknown;
    try {
      v03StageRunChildSnapshot.parse(v04Migrated);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(z.ZodError);
    const issues = (error as z.ZodError).issues;
    const unknownKeys = issues
      .filter((i) => i.code === "unrecognized_keys")
      .flatMap((i) => (i as z.ZodIssue & { keys?: string[] }).keys ?? []);
    expect(unknownKeys).toContain("affects");
    expect(unknownKeys).toContain("migratedFromV03");
  });
});

// Type assertion to ensure AisepStage union stays stable across v0.4.
// (compile-time; this test exists to surface enum drift on review.)
type _StageEnumStable = AisepStage extends
  | "intake"
  | "research"
  | "plan"
  | "architecture"
  | "contract"
  | "implement"
  | "verify"
  | "review"
  | "integrate"
  | "retrospect"
  ? true
  : false;
const _stageEnumStable: _StageEnumStable = true;
void _stageEnumStable;
