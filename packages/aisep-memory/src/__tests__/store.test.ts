import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AisepMemoryStore } from "../store.js";

let workspaceCwd: string;
let globalDir: string;

beforeEach(() => {
  workspaceCwd = mkdtempSync(join(tmpdir(), "aisep-mem-ws-"));
  globalDir = mkdtempSync(join(tmpdir(), "aisep-mem-global-"));
});

afterEach(() => {
  rmSync(workspaceCwd, { recursive: true, force: true });
  rmSync(globalDir, { recursive: true, force: true });
});

function newStore(): AisepMemoryStore {
  return new AisepMemoryStore(workspaceCwd, {
    globalLogPath: join(globalDir, "evolution_log.json"),
  });
}

describe("AisepMemoryStore", () => {
  it("starts empty", () => {
    const store = newStore();
    expect(store.listWorkspacePending()).toEqual([]);
    expect(store.listGlobalVerified()).toEqual([]);
  });

  it("recordPending writes to workspace tier", () => {
    const store = newStore();
    const r = store.recordPending({
      stage: "architecture",
      failurePattern: "Phase A skipped Q7",
      fix: "TBD",
      appliesTo: { domain: ["*"], stage: ["architecture"], techStack: ["*"] },
    });
    expect(r.source).toBe("workspace-pending");
    expect(r.verifiedBy).toBe("auto");
    expect(store.listWorkspacePending()).toHaveLength(1);
    expect(store.listGlobalVerified()).toHaveLength(0);
  });

  it("promote moves matching records to global tier and dedups", () => {
    const store = newStore();
    store.recordPending({
      stage: "architecture",
      failurePattern: "Phase A skipped Q7 rollback",
      fix: "Pending",
      appliesTo: { domain: ["*"], stage: ["architecture"], techStack: ["*"] },
    });
    store.recordPending({
      stage: "architecture",
      failurePattern: "Phase A skipped Q7 rollback",   // duplicate
      fix: "Pending",
      appliesTo: { domain: ["*"], stage: ["architecture"], techStack: ["*"] },
    });

    const promoted = store.promote(
      { stage: "architecture" },
      "Phase A artifact MUST include RISK-Q7 entry",
    );
    expect(promoted).toBe(1);   // one record, second deduped
    expect(store.listGlobalVerified()).toHaveLength(1);
    expect(store.listGlobalVerified()[0]!.verifiedBy).toBe("human");
  });

  it("retrieve filters by stage + domain + techStack + tier (R11 trust boundary)", () => {
    const store = newStore();
    store.recordPending({
      stage: "architecture",
      failurePattern: "P1",
      fix: "F1",
      appliesTo: { domain: ["erp"], stage: ["architecture"], techStack: ["odoo"] },
    });
    store.recordPending({
      stage: "architecture",
      failurePattern: "P2",
      fix: "F2",
      appliesTo: { domain: ["ai-platform"], stage: ["architecture"], techStack: ["typescript"] },
    });

    const erpHits = store.retrieve({
      stage: "architecture",
      domain: "erp",
      tier: "workspace",
    });
    expect(erpHits).toHaveLength(1);
    expect(erpHits[0]!.failurePattern).toBe("P1");
  });

  it("retrieve respects tier — no implicit cross-tier union (R11)", () => {
    const store = newStore();
    store.recordPending({
      stage: "architecture",
      failurePattern: "ws-only",
      fix: "F",
      appliesTo: { domain: ["*"], stage: ["architecture"], techStack: ["*"] },
    });
    store.promote({ stage: "architecture" }, "verified");

    expect(store.retrieve({ stage: "architecture", tier: "workspace" })).toHaveLength(1);
    expect(store.retrieve({ stage: "architecture", tier: "global" })).toHaveLength(1);
    // Both tiers have the record; explicit tier query — no automatic dedup or union.
  });

  it("stats counts per tier and per stage", () => {
    const store = newStore();
    store.recordPending({
      stage: "architecture",
      failurePattern: "p",
      fix: "f",
      appliesTo: { domain: ["*"], stage: ["architecture"], techStack: ["*"] },
    });
    store.recordPending({
      stage: "contract",
      failurePattern: "p",
      fix: "f",
      appliesTo: { domain: ["*"], stage: ["contract"], techStack: ["*"] },
    });

    const s = store.stats();
    expect(s.workspacePending).toBe(2);
    expect(s.globalVerified).toBe(0);
    expect(s.perStage.architecture).toBe(1);
    expect(s.perStage.contract).toBe(1);
  });
});
