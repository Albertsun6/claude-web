// v1 fan-out Stage 1 schema tests.
//
// Verifies AisepStageRun + AisepPatchSetManifest schema invariants per
// `docs/proposals/aisep-v1-fan-out.md` v2.

import { describe, expect, it } from "vitest";

import {
  AisepFanOutRoleSchema,
  AisepPatchSetManifestSchema,
  AisepStageRunSchema,
} from "../index.js";

const SHA256 =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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
  // v0.4: child rows require non-empty affects (ADR-022 Decision 2).
  affects: ["packages/backend/.*"],
};

describe("v1 fan-out: AisepFanOutRoleSchema enum", () => {
  it("accepts the three known roles", () => {
    expect(AisepFanOutRoleSchema.parse("normal")).toBe("normal");
    expect(AisepFanOutRoleSchema.parse("parent")).toBe("parent");
    expect(AisepFanOutRoleSchema.parse("child")).toBe("child");
  });

  it("rejects unknown role values", () => {
    expect(() => AisepFanOutRoleSchema.parse("orphan")).toThrow();
  });
});

describe("v1 fan-out: AisepStageRunSchema with fanOutRole defaults", () => {
  it("v0.2 backward-compat: normal default when fanOutRole omitted", () => {
    const parsed = AisepStageRunSchema.parse({
      ...PARENT_BASE,
      status: "succeeded",
    });
    expect(parsed.fanOutRole).toBe("normal");
    expect(parsed.subStages).toEqual([]);
    expect(parsed.parentStageRunId).toBeUndefined();
  });

  it("normal role rejects subStages", () => {
    expect(() =>
      AisepStageRunSchema.parse({
        ...PARENT_BASE,
        fanOutRole: "normal",
        subStages: ["sr-1"],
      }),
    ).toThrow(/normal.*must NOT have subStages/);
  });

  it("normal role rejects parentStageRunId", () => {
    expect(() =>
      AisepStageRunSchema.parse({
        ...PARENT_BASE,
        fanOutRole: "normal",
        parentStageRunId: "sr-other",
      }),
    ).toThrow(/normal.*must NOT have parentStageRunId/);
  });
});

describe("v1 fan-out: parent role invariants", () => {
  it("accepts well-formed parent with N>=1 subStages", () => {
    const parsed = AisepStageRunSchema.parse({
      ...PARENT_BASE,
      fanOutRole: "parent",
      subStages: ["sr-backend", "sr-frontend", "sr-tests"],
    });
    expect(parsed.fanOutRole).toBe("parent");
    expect(parsed.subStages).toHaveLength(3);
  });

  it("rejects parent with empty subStages", () => {
    expect(() =>
      AisepStageRunSchema.parse({
        ...PARENT_BASE,
        fanOutRole: "parent",
        subStages: [],
      }),
    ).toThrow(/parent.*requires subStages to be non-empty/);
  });

  it("rejects parent with parentStageRunId set (no nested fan-out in v1)", () => {
    expect(() =>
      AisepStageRunSchema.parse({
        ...PARENT_BASE,
        fanOutRole: "parent",
        subStages: ["sr-1"],
        parentStageRunId: "sr-grandparent",
      }),
    ).toThrow(/parent.*must NOT have parentStageRunId/);
  });

  it("rejects parent on stage outside FAN_OUT_ALLOWED_STAGES (v0.4 whitelist)", () => {
    // v0.4 (ADR-022 Q1b): whitelist = {implement, verify, review}. `integrate` is
    // the fan-in terminal aggregation, NOT a fan-out source.
    expect(() =>
      AisepStageRunSchema.parse({
        ...PARENT_BASE,
        stage: "integrate",
        fanOutRole: "parent",
        subStages: ["sr-1"],
      }),
    ).toThrow(/parent.*only allowed for stages in FAN_OUT_ALLOWED_STAGES/);
  });
});

describe("v1 fan-out: child role invariants", () => {
  it("accepts well-formed child with parentStageRunId", () => {
    const parsed = AisepStageRunSchema.parse({
      ...CHILD_BASE,
      fanOutRole: "child",
      parentStageRunId: "sr-parent-01HJK5X",
    });
    expect(parsed.fanOutRole).toBe("child");
    expect(parsed.parentStageRunId).toBe("sr-parent-01HJK5X");
    expect(parsed.subStages).toEqual([]);
  });

  it("rejects child without parentStageRunId", () => {
    expect(() =>
      AisepStageRunSchema.parse({
        ...CHILD_BASE,
        fanOutRole: "child",
      }),
    ).toThrow(/child.*requires parentStageRunId/);
  });

  it("rejects child with subStages (no nested fan-out)", () => {
    expect(() =>
      AisepStageRunSchema.parse({
        ...CHILD_BASE,
        fanOutRole: "child",
        parentStageRunId: "sr-parent",
        subStages: ["sr-grandchild"],
      }),
    ).toThrow(/child.*must NOT have subStages/);
  });

  it("rejects child on stage outside FAN_OUT_ALLOWED_STAGES (v0.4 whitelist)", () => {
    expect(() =>
      AisepStageRunSchema.parse({
        ...CHILD_BASE,
        stage: "integrate",
        fanOutRole: "child",
        parentStageRunId: "sr-parent",
      }),
    ).toThrow(/child.*only allowed for stages in FAN_OUT_ALLOWED_STAGES/);
  });
});

describe("v1 fan-out: AisepPatchSetManifestSchema", () => {
  it("accepts well-formed 2-patch manifest", () => {
    const parsed = AisepPatchSetManifestSchema.parse({
      patches: [
        {
          subStageId: "sr-backend",
          subStageName: "backend",
          patchFile: "patches/backend.diff",
          contentHash: SHA256,
          byteCount: 1234,
        },
        {
          subStageId: "sr-frontend",
          subStageName: "frontend",
          patchFile: "patches/frontend.diff",
          contentHash: SHA256,
          byteCount: 5678,
        },
      ],
    });
    expect(parsed.patches).toHaveLength(2);
  });

  it("rejects single-patch manifest (a 1-patch parent isn't a fan-out)", () => {
    expect(() =>
      AisepPatchSetManifestSchema.parse({
        patches: [
          {
            subStageId: "sr-only",
            subStageName: "only",
            patchFile: "patches/only.diff",
            contentHash: SHA256,
            byteCount: 100,
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects subStageName with shell-unsafe characters", () => {
    expect(() =>
      AisepPatchSetManifestSchema.parse({
        patches: [
          {
            subStageId: "sr-1",
            subStageName: "backend; rm -rf /",
            patchFile: "x",
            contentHash: SHA256,
            byteCount: 1,
          },
          {
            subStageId: "sr-2",
            subStageName: "frontend",
            patchFile: "y",
            contentHash: SHA256,
            byteCount: 1,
          },
        ],
      }),
    ).toThrow();
  });
});
