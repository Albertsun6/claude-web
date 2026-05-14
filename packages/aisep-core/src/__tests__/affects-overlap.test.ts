// affects-overlap detector tests (ADR-022 Q4 declared-overlap heuristic).

import { describe, expect, it } from "vitest";

import {
  AffectsOverlapError,
  assertNoAffectsOverlap,
  detectAffectsOverlap,
  literalAnchors,
} from "../affects-overlap.js";

describe("affects-overlap: literalAnchors extraction", () => {
  it("extracts directory-style literal prefix", () => {
    expect(literalAnchors("packages/backend/.*")).toEqual(["packages/backend/"]);
  });

  it("extracts middle literal between metachars", () => {
    expect(literalAnchors(".*backend.*")).toEqual(["backend"]);
  });

  it("returns empty for catch-all .*", () => {
    expect(literalAnchors(".*")).toEqual([]);
  });

  it("preserves forward slashes (not a metachar)", () => {
    expect(literalAnchors("src/foo/bar")).toEqual(["src/foo/bar"]);
  });

  it("strips ^ and $ anchors", () => {
    expect(literalAnchors("^packages/backend/.*$")).toEqual(["packages/backend/"]);
  });

  it("filters segments shorter than 3 chars", () => {
    // "x" between metachars too short; "src/" is 4 chars → kept.
    expect(literalAnchors(".x.src/foo")).toEqual(["src/foo"]);
  });

  it("splits on alternation and groups", () => {
    expect(literalAnchors("src/(foo|bar)/baz")).toEqual(["src/", "foo", "bar", "/baz"]);
  });
});

describe("affects-overlap: detectAffectsOverlap pure function", () => {
  it("returns null for disjoint patterns", () => {
    expect(
      detectAffectsOverlap([
        ["packages/backend/.*"],
        ["packages/frontend/.*"],
        ["packages/shared/.*"],
      ]),
    ).toBeNull();
  });

  it("detects substring-anchor overlap (broader pattern contains narrower)", () => {
    const overlap = detectAffectsOverlap([
      ["packages/.*"],
      ["packages/backend/.*"],
    ]);
    expect(overlap).not.toBeNull();
    expect(overlap?.i).toBe(0);
    expect(overlap?.j).toBe(1);
    expect(overlap?.sharedAnchor).toBe("packages/");
  });

  it("detects substring-anchor overlap (middle-literal pattern)", () => {
    // ".*backend.*" anchor "backend" is substring of "packages/backend/"
    const overlap = detectAffectsOverlap([
      [".*backend.*"],
      ["packages/backend/.*"],
    ]);
    expect(overlap).not.toBeNull();
    expect(overlap?.sharedAnchor).toBe("backend");
  });

  it("flags catch-all .* as overlapping with everything", () => {
    const overlap = detectAffectsOverlap([
      ["packages/backend/.*"],
      [".*"],
    ]);
    expect(overlap).not.toBeNull();
    expect(overlap?.i).toBe(0);
    expect(overlap?.j).toBe(1);
  });

  it("works per-pattern within affects arrays (any-pair triggers)", () => {
    const overlap = detectAffectsOverlap([
      ["packages/backend/.*", "scripts/.*"],
      ["docs/.*", "scripts/foo.*"],
    ]);
    // "scripts/" (i=0 second pattern) shares with "scripts/foo" (j=1 second pattern).
    expect(overlap).not.toBeNull();
    expect(overlap?.i).toBe(0);
    expect(overlap?.j).toBe(1);
  });

  it("scans pairs in deterministic order (i < j)", () => {
    const overlap = detectAffectsOverlap([
      ["packages/backend/.*"],
      ["packages/frontend/.*"],
      ["packages/.*"], // overlaps with both
    ]);
    // First pair (0, 2) since 0 vs 1 are disjoint.
    expect(overlap?.i).toBe(0);
    expect(overlap?.j).toBe(2);
  });

  it("returns null for empty input or single-child input", () => {
    expect(detectAffectsOverlap([])).toBeNull();
    expect(detectAffectsOverlap([["packages/backend/.*"]])).toBeNull();
  });

  it("returns null when one child has empty affects (degenerate)", () => {
    // Per protocol schema, fanOutRole='child' requires non-empty affects.
    // Defensive: an empty array should not trigger a false positive.
    expect(
      detectAffectsOverlap([
        ["packages/backend/.*"],
        [], // shouldn't happen at runtime — schema rejects
      ]),
    ).toBeNull();
  });
});

describe("affects-overlap: assertNoAffectsOverlap throwing wrapper", () => {
  it("does not throw on disjoint patterns", () => {
    expect(() =>
      assertNoAffectsOverlap([
        ["packages/backend/.*"],
        ["packages/frontend/.*"],
      ]),
    ).not.toThrow();
  });

  it("throws AffectsOverlapError on detected overlap", () => {
    expect(() =>
      assertNoAffectsOverlap([["packages/.*"], ["packages/backend/.*"]]),
    ).toThrow(AffectsOverlapError);
  });

  it("error message mentions both child indices + shared anchor", () => {
    try {
      assertNoAffectsOverlap([["packages/.*"], ["packages/backend/.*"]]);
      expect.fail("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/children 0 and 1/);
      expect(msg).toMatch(/packages\//);
    }
  });
});
