import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  AisepAgentCallSchema,
  AisepArtifactSchema,
  AisepAttemptSchema,
  AisepContextBundleSchema,
  AisepMemoryRecordSchema,
  AisepRequirementsSchema,
  AisepReviewVerdictSchema,
  AisepStageRunSchema,
  AisepTraceFileSchema,
  AisepWorkspaceMetaSchema,
} from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, "../../fixtures/aisep");

/**
 * Each fixture filename starts with a prefix that maps to its schema.
 * Order matters: longer prefixes first so "review-verdict-" wins over "review-".
 */
const FIXTURE_TO_SCHEMA: ReadonlyArray<readonly [string, z.ZodTypeAny]> = [
  ["stage-run-", AisepStageRunSchema],
  ["artifact-", AisepArtifactSchema],
  ["attempt-", AisepAttemptSchema],
  ["workspace-meta", AisepWorkspaceMetaSchema],
  ["requirements", AisepRequirementsSchema],
  ["memory-record-", AisepMemoryRecordSchema],
  ["agent-call-", AisepAgentCallSchema],
  ["context-bundle", AisepContextBundleSchema],
  ["review-verdict-", AisepReviewVerdictSchema],
  ["trace-chain", AisepTraceFileSchema],
];

function schemaFor(filename: string): z.ZodTypeAny | undefined {
  return FIXTURE_TO_SCHEMA.find(([prefix]) => filename.startsWith(prefix))?.[1];
}

describe("protocol round-trip fixtures", () => {
  const files = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"));

  it("has at least 15 fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  for (const file of files) {
    it(`${file}: parse → re-encode → parse stays equal`, () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), "utf-8");
      const obj = JSON.parse(raw);

      const schema = schemaFor(file);
      expect(schema, `no schema mapped for ${file}`).toBeDefined();

      const parsed = schema!.parse(obj);
      const reEncoded = JSON.stringify(parsed);
      const reParsed = schema!.parse(JSON.parse(reEncoded));
      expect(reParsed).toEqual(parsed);
    });
  }
});
