import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AisepTraceFileSchema } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const TRACE_FIXTURE = join(here, "../../fixtures/aisep/trace-chain.json");

describe("trace-chain semantics", () => {
  const raw = readFileSync(TRACE_FIXTURE, "utf-8");
  const trace = AisepTraceFileSchema.parse(JSON.parse(raw));

  it("has no orphans (Phase A passing state requires zero orphans)", () => {
    expect(trace.orphans).toHaveLength(0);
  });

  it("every chain id matches its requirement id", () => {
    // Convention: chain.id === chain.requirement (1:1 mapping).
    for (const chain of trace.chains) {
      expect(chain.id).toBe(chain.requirement);
    }
  });

  it("every chain references at least 1 ADR", () => {
    for (const chain of trace.chains) {
      expect(
        chain.adrs.length,
        `chain ${chain.id} has no ADRs — Phase A anchor gate would fail`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("trace_id prefix matches namespace convention", () => {
    const VALID_PREFIXES = /^(REQ|ADR|ZOD|RISK|G|D|C|P|S)-/;
    for (const chain of trace.chains) {
      expect(chain.id).toMatch(VALID_PREFIXES);
      expect(chain.requirement).toMatch(/^REQ-/);
      for (const adr of chain.adrs) expect(adr).toMatch(/^ADR-/);
      for (const contract of chain.contracts) expect(contract).toMatch(/^ZOD-/);
      for (const risk of chain.risks) expect(risk).toMatch(/^RISK-/);
    }
  });
});
