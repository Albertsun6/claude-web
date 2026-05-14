// v0.3 v1 fan-out Stage 2.cli-C — parsePlanParallel unit tests.

import { describe, expect, it } from "vitest";

import { parsePlanParallel } from "../parse-plan-parallel.js";

const VALID_2 = `
some text

\`\`\`yaml
parallel:
  - id: T-a
    name: backend
    affects: ^packages/backend/
  - id: T-b
    name: frontend
    affects: ^packages/frontend/
\`\`\`

trailing text
`;

describe("parsePlanParallel", () => {
  it("returns undefined when plan.md has no parallel: block", () => {
    expect(parsePlanParallel("plain plan md, no yaml block")).toBeUndefined();
    expect(
      parsePlanParallel("```yaml\ntasks:\n  - id: T1\n```"),
    ).toBeUndefined();
  });

  it("parses well-formed 2-entry parallel block", () => {
    const result = parsePlanParallel(VALID_2);
    expect(result).toHaveLength(2);
    expect(result![0]!.name).toBe("backend");
    expect(result![1]!.name).toBe("frontend");
    // v0.4: affects normalized to string[] (Decision 2). A YAML scalar
    // string in plan.md still works for backward compat; parser wraps it.
    expect(result![0]!.affects).toEqual(["^packages/backend/"]);
  });

  it("parses 3-entry valid block", () => {
    const md = `
\`\`\`yaml
parallel:
  - id: T1
    name: backend
    affects: ^packages/backend/
  - id: T2
    name: frontend
    affects: ^packages/frontend/
  - id: T3
    name: tests
    affects: ^tests/
\`\`\`
`;
    const result = parsePlanParallel(md);
    expect(result).toHaveLength(3);
    expect(result!.map((e) => e.name)).toEqual(["backend", "frontend", "tests"]);
  });

  it("throws when parallel list has < 2 entries", () => {
    const md = `
\`\`\`yaml
parallel:
  - id: T1
    name: only-one
    affects: ^.*
\`\`\`
`;
    expect(() => parsePlanParallel(md)).toThrow(/>= 2 entries/);
  });

  it("throws when parallel list exceeds cap (> 4 entries)", () => {
    const md = `
\`\`\`yaml
parallel:
  - id: T1
    name: a
    affects: ^pkg-a/
  - id: T2
    name: b
    affects: ^pkg-b/
  - id: T3
    name: c
    affects: ^pkg-c/
  - id: T4
    name: d
    affects: ^pkg-d/
  - id: T5
    name: e
    affects: ^pkg-e/
\`\`\`
`;
    expect(() => parsePlanParallel(md)).toThrow(/exceeds plan-roadmap cap of 4/);
  });

  it("throws on shell-unsafe name (RISK-Q4-c)", () => {
    const md = `
\`\`\`yaml
parallel:
  - id: T1
    name: "evil; rm -rf /"
    affects: ^pkg-a/
  - id: T2
    name: ok
    affects: ^pkg-b/
\`\`\`
`;
    expect(() => parsePlanParallel(md)).toThrow(/shell-safe/);
  });

  it("throws on duplicate name", () => {
    const md = `
\`\`\`yaml
parallel:
  - id: T1
    name: backend
    affects: ^pkg-a/
  - id: T2
    name: backend
    affects: ^pkg-b/
\`\`\`
`;
    expect(() => parsePlanParallel(md)).toThrow(/duplicate name "backend"/);
  });

  it("throws on missing required field (id)", () => {
    const md = `
\`\`\`yaml
parallel:
  - name: backend
    affects: ^pkg-a/
  - id: T2
    name: frontend
    affects: ^pkg-b/
\`\`\`
`;
    expect(() => parsePlanParallel(md)).toThrow(/'id' missing or empty/);
  });

  it("throws on missing affects", () => {
    const md = `
\`\`\`yaml
parallel:
  - id: T1
    name: backend
  - id: T2
    name: frontend
    affects: ^pkg-b/
\`\`\`
`;
    expect(() => parsePlanParallel(md)).toThrow(/'affects' must be a string or string\[\]/);
  });

  it("v0.4: accepts affects as YAML array (Decision 2 array form)", () => {
    const md = `
\`\`\`yaml
parallel:
  - id: T1
    name: backend
    affects:
      - ^packages/backend/.*\\.ts
      - ^packages/shared/types/.*
  - id: T2
    name: frontend
    affects: [^packages/frontend/.*]
\`\`\`
`;
    const result = parsePlanParallel(md);
    expect(result).toHaveLength(2);
    expect(result![0]!.affects).toEqual([
      "^packages/backend/.*\\.ts",
      "^packages/shared/types/.*",
    ]);
    expect(result![1]!.affects).toEqual(["^packages/frontend/.*"]);
  });

  it("v0.4 Q4 R2: rejects catch-all affects pattern (no ≥3-char literal anchor)", () => {
    const md = `
\`\`\`yaml
parallel:
  - id: T1
    name: backend
    affects: ^.*
  - id: T2
    name: frontend
    affects: ^packages/frontend/
\`\`\`
`;
    expect(() => parsePlanParallel(md)).toThrow(/catch-all pattern with no/);
  });

  it("v0.4 Q4 R2: rejects short literal anchor (< 3 chars)", () => {
    const md = `
\`\`\`yaml
parallel:
  - id: T1
    name: backend
    affects: ^a/
  - id: T2
    name: frontend
    affects: ^packages/frontend/
\`\`\`
`;
    expect(() => parsePlanParallel(md)).toThrow(/catch-all pattern with no/);
  });

  it("v0.4: rejects empty affects array", () => {
    const md = `
\`\`\`yaml
parallel:
  - id: T1
    name: backend
    affects: []
  - id: T2
    name: frontend
    affects: ^pkg-b/
\`\`\`
`;
    expect(() => parsePlanParallel(md)).toThrow(/'affects' is an empty array/);
  });

  it("throws on malformed YAML", () => {
    const md = `
\`\`\`yaml
parallel:
  - id: T1
    name: backend
  affects: not-indented-properly
   bad: indentation:
\`\`\`
`;
    expect(() => parsePlanParallel(md)).toThrow();
  });

  it("ignores yaml fences that have 'parallel:' only as a substring, not top-level", () => {
    const md = `
\`\`\`yaml
unrelated:
  description: "this is for parallel: rendering"
\`\`\`
`;
    // 'parallel:' appears but is in a quoted string value, not as a top-level
    // key. Parser correctly falls through to undefined (no real parallel: block).
    expect(parsePlanParallel(md)).toBeUndefined();
  });
});
