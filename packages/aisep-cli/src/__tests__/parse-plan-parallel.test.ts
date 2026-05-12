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
    expect(result![0]!.affects).toBe("^packages/backend/");
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
    affects: ^a/
  - id: T2
    name: b
    affects: ^b/
  - id: T3
    name: c
    affects: ^c/
  - id: T4
    name: d
    affects: ^d/
  - id: T5
    name: e
    affects: ^e/
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
    affects: ^a/
  - id: T2
    name: ok
    affects: ^b/
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
    affects: ^a/
  - id: T2
    name: backend
    affects: ^b/
\`\`\`
`;
    expect(() => parsePlanParallel(md)).toThrow(/duplicate name "backend"/);
  });

  it("throws on missing required field (id)", () => {
    const md = `
\`\`\`yaml
parallel:
  - name: backend
    affects: ^a/
  - id: T2
    name: frontend
    affects: ^b/
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
    affects: ^b/
\`\`\`
`;
    expect(() => parsePlanParallel(md)).toThrow(/'affects' missing or empty/);
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
