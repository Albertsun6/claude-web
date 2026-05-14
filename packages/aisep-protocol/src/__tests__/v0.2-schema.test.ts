// Phase 2.D #10 + #14 / aisep-protocol v0.2 schema migration tests.
//
// Verifies:
//  - AisepReviewVerdictSchema discriminated union: request_reverify needs payload;
//    others must NOT carry payload; legacy 3-value verdicts still parse.
//  - AisepAppliesToSchema.stage `.min(1)` rejects empty array; non-empty parses.
//  - AisepReviewVerdictKindSchema enum is exactly 4 values (no drift).
//
// See:
//  - docs/proposals/aisep-protocol-v0.2-review-reverify-and-applies-to.md
//  - docs/reviews/aisep-protocol-v0.2-arbitration-2026-05-12.md

import { describe, expect, it } from "vitest";

import {
  AisepAppliesToSchema,
  AisepReviewVerdictKindSchema,
  AisepReviewVerdictSchema,
} from "../index.js";

const BASE = {
  id: "rv-01HJK5X",
  stageRunId: "sr-01HJK5X",
  reviewer: "reviewer-cross" as const,
  comments: [],
  suggestedPatches: [],
  reviewedAt: 1747929000000,
};

describe("v0.2 AisepReviewVerdictKindSchema — 4-value enum", () => {
  it("accepts all 4 verdicts", () => {
    expect(AisepReviewVerdictKindSchema.parse("pass")).toBe("pass");
    expect(AisepReviewVerdictKindSchema.parse("pass_with_comments")).toBe("pass_with_comments");
    expect(AisepReviewVerdictKindSchema.parse("revise_required")).toBe("revise_required");
    expect(AisepReviewVerdictKindSchema.parse("request_reverify")).toBe("request_reverify");
  });

  it("rejects unknown verdict (defense for future enum growth)", () => {
    expect(() => AisepReviewVerdictKindSchema.parse("defer")).toThrow();
    expect(() => AisepReviewVerdictKindSchema.parse("pass-with-comments")).toThrow(); // dash form drift
  });

  it("has exactly 4 enum options (catches accidental growth/shrink)", () => {
    expect(AisepReviewVerdictKindSchema.options).toEqual([
      "pass",
      "pass_with_comments",
      "revise_required",
      "request_reverify",
    ]);
  });
});

describe("v0.2 AisepReviewVerdictSchema — discriminated union", () => {
  it("accepts pass / pass_with_comments / revise_required without requestReverify (backward compat)", () => {
    for (const verdict of ["pass", "pass_with_comments", "revise_required"] as const) {
      const parsed = AisepReviewVerdictSchema.parse({ ...BASE, verdict });
      expect(parsed.verdict).toBe(verdict);
    }
  });

  it("strips requestReverify from non-reverify variants (zod default lenient)", () => {
    // zod's default behavior on discriminated union is to strip extra
    // fields not in the chosen variant's schema, NOT to reject. This is
    // safe because TS narrowing on `parsed.verdict !== "request_reverify"`
    // makes `requestReverify` unreachable on the type — downstream
    // consumers cannot accidentally use it.
    const parsed = AisepReviewVerdictSchema.parse({
      ...BASE,
      verdict: "pass",
      requestReverify: { checkId: "foo", reason: "stale" },
    });
    expect(parsed.verdict).toBe("pass");
    // requestReverify stripped from parsed output:
    expect((parsed as Record<string, unknown>).requestReverify).toBeUndefined();
  });

  it("rejects request_reverify WITHOUT requestReverify payload (schema-level biconditional)", () => {
    expect(() =>
      AisepReviewVerdictSchema.parse({ ...BASE, verdict: "request_reverify" }),
    ).toThrow();
  });

  it("accepts request_reverify WITH valid requestReverify payload", () => {
    const parsed = AisepReviewVerdictSchema.parse({
      ...BASE,
      verdict: "request_reverify",
      requestReverify: {
        checkId: "cross-references-section-present",
        reason: "patch.diff body grep matched, but hand-off payload was truncated",
      },
    });
    expect(parsed.verdict).toBe("request_reverify");
    // TS narrowing: requestReverify is required on this branch
    if (parsed.verdict === "request_reverify") {
      expect(parsed.requestReverify.checkId).toBe("cross-references-section-present");
    }
  });

  it("rejects checkId with shell-unsafe characters (RISK-Q4-c regex)", () => {
    const baseRR = {
      ...BASE,
      verdict: "request_reverify" as const,
      requestReverify: { checkId: "evil; rm -rf /", reason: "anything" },
    };
    expect(() => AisepReviewVerdictSchema.parse(baseRR)).toThrow();
  });

  it("rejects reason longer than 500 chars (RISK-Q4-c cap)", () => {
    const baseRR = {
      ...BASE,
      verdict: "request_reverify" as const,
      requestReverify: { checkId: "ok-id", reason: "x".repeat(501) },
    };
    expect(() => AisepReviewVerdictSchema.parse(baseRR)).toThrow();
  });

  it("rejects empty reason (.min(1))", () => {
    const baseRR = {
      ...BASE,
      verdict: "request_reverify" as const,
      requestReverify: { checkId: "ok-id", reason: "" },
    };
    expect(() => AisepReviewVerdictSchema.parse(baseRR)).toThrow();
  });
});

describe("v0.2 AisepAppliesToSchema.stage — .min(1)", () => {
  it("rejects empty stage array (R11 silent-global-pollution mitigation)", () => {
    expect(() =>
      AisepAppliesToSchema.parse({ domain: ["*"], stage: [], techStack: ["*"] }),
    ).toThrow();
  });

  it("accepts single-stage array (most common case from `aisep memory record` CLI)", () => {
    const parsed = AisepAppliesToSchema.parse({
      domain: ["*"],
      stage: ["verify"],
      techStack: ["*"],
    });
    expect(parsed.stage).toEqual(["verify"]);
  });

  it("accepts multi-stage array", () => {
    const parsed = AisepAppliesToSchema.parse({
      domain: ["*"],
      stage: ["plan", "architecture", "verify"],
      techStack: ["*"],
    });
    expect(parsed.stage).toHaveLength(3);
  });
});
