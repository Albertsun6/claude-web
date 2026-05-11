import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  AisepAgentProfileSchema,
  AisepArtifactKindSchema,
  AisepAttemptStatusSchema,
  AisepCommentActionSchema,
  AisepCommentSeveritySchema,
  AisepMemorySourceSchema,
  AisepMemoryVerifiedBySchema,
  AisepReviewerKindSchema,
  AisepReviewVerdictKindSchema,
  AisepStagePhaseSchema,
  AisepStageSchema,
  AisepStageStatusSchema,
  AisepWorkspaceStatusSchema,
} from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, "../../fixtures/aisep");

const fixtures = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf-8")) as unknown);

/** Recursively walk an object, collecting every string value found. */
function collectStrings(node: unknown, out: Set<string>): void {
  if (typeof node === "string") {
    out.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) collectStrings(value, out);
  }
}

const allStringsInFixtures = new Set<string>();
for (const fx of fixtures) collectStrings(fx, allStringsInFixtures);

function enumValues(schema: z.ZodEnum<[string, ...string[]]>): string[] {
  // zod 3.x: schema.options is the array of literal values
  return [...schema.options];
}

const ENUMS: ReadonlyArray<readonly [string, z.ZodEnum<[string, ...string[]]>]> = [
  ["AisepStage", AisepStageSchema],
  ["AisepStagePhase", AisepStagePhaseSchema],
  ["AisepStageStatus", AisepStageStatusSchema],
  ["AisepArtifactKind", AisepArtifactKindSchema],
  ["AisepAttemptStatus", AisepAttemptStatusSchema],
  ["AisepAgentProfile", AisepAgentProfileSchema],
  ["AisepMemorySource", AisepMemorySourceSchema],
  ["AisepMemoryVerifiedBy", AisepMemoryVerifiedBySchema],
  ["AisepReviewerKind", AisepReviewerKindSchema],
  ["AisepReviewVerdictKind", AisepReviewVerdictKindSchema],
  ["AisepCommentSeverity", AisepCommentSeveritySchema],
  ["AisepCommentAction", AisepCommentActionSchema],
  ["AisepWorkspaceStatus", AisepWorkspaceStatusSchema],
];

describe("enum coverage in fixtures", () => {
  for (const [name, schema] of ENUMS) {
    it(`${name} has ≥ 1 value present in fixtures (v0 soft constraint)`, () => {
      const values = enumValues(schema);
      const covered = values.filter((v) => allStringsInFixtures.has(v));
      const missing = values.filter((v) => !allStringsInFixtures.has(v));

      // v0 soft constraint: at least 1 enum value must be exercised by fixtures.
      // v1 will tighten to 100% coverage.
      expect(covered.length, `${name} has no fixture coverage at all`).toBeGreaterThan(0);

      if (missing.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(`${name}: missing fixture coverage for [${missing.join(", ")}]`);
      }
    });
  }
});
