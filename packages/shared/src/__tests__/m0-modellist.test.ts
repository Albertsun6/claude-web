// M0 modelList Round 测试 (RFC §1.3 + §2.2 + §6 OQ-C 强制 drift 单测)
//
// Phase 3 cross B2 BLOCKER 修复：fixture 测试必须断言改嵌套字段都改 etag，
// key 顺序无关 stable，且 fallback-config 满足 superRefine。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HarnessConfigSchema,
  ModelListItemSchema,
  computeEtag,
  canonicalize,
  compareVersion,
  type HarnessConfig,
} from "../index";

const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures/harness");

function load(name: string): unknown {
  return JSON.parse(readFileSync(path.resolve(FIXTURES_DIR, name), "utf-8"));
}

describe("canonicalize", () => {
  it("sorts object keys recursively", () => {
    const a = canonicalize({ b: 1, a: 2 });
    const b = canonicalize({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });
  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });
  it("recurses into nested objects in arrays", () => {
    const a = canonicalize([{ x: 1, y: 2 }]);
    const b = canonicalize([{ y: 2, x: 1 }]);
    expect(a).toBe(b);
  });
  it("rejects undefined", () => {
    expect(() => canonicalize(undefined)).toThrow();
  });
  it("rejects NaN / Infinity", () => {
    expect(() => canonicalize(NaN)).toThrow();
    expect(() => canonicalize(Infinity)).toThrow();
  });
});

describe("computeEtag", () => {
  it("returns sha256:<16 hex>", () => {
    const e = computeEtag({ a: 1 });
    expect(e).toMatch(/^sha256:[a-f0-9]{16}$/);
  });
  it("excludes etag field from input (no self-reference)", () => {
    const e1 = computeEtag({ a: 1, etag: "old" });
    const e2 = computeEtag({ a: 1, etag: "different" });
    expect(e1).toBe(e2);
  });
  it("changes when nested field changes (RFC §1.3 phase 3 cross B2 hard requirement)", () => {
    const cfg = load("fallback-config.json") as HarnessConfig;
    const base = computeEtag(cfg);

    // Change displayName
    const c1 = JSON.parse(JSON.stringify(cfg));
    c1.modelList[0].displayName = "Different Name";
    expect(computeEtag(c1)).not.toBe(base);

    // Change capabilities.contextWindow
    const c2 = JSON.parse(JSON.stringify(cfg));
    c2.modelList[0].capabilities.contextWindow = 500000;
    expect(computeEtag(c2)).not.toBe(base);

    // Change recommendedFor (nested array)
    const c3 = JSON.parse(JSON.stringify(cfg));
    c3.modelList[0].recommendedFor = ["new-category"];
    expect(computeEtag(c3)).not.toBe(base);
  });
  it("is stable across object key reorderings (key-order independence)", () => {
    const cfg = load("fallback-config.json") as HarnessConfig;
    const base = computeEtag(cfg);

    // Reorder top-level keys (含 permissionModes from v1.1)
    const reordered: Record<string, unknown> = {};
    for (const k of Object.keys(cfg).sort().reverse()) {
      reordered[k] = (cfg as any)[k];
    }
    expect(computeEtag(reordered)).toBe(base);
  });
});

describe("compareVersion", () => {
  it("orders correctly numerically (defeats string lex)", () => {
    expect(compareVersion("1.10", "1.9")).toBe(1);  // string lex would say -1
    expect(compareVersion("1.9", "1.10")).toBe(-1);
    expect(compareVersion("1.0", "1.0")).toBe(0);
  });
  it("handles missing parts as zero", () => {
    expect(compareVersion("1.0", "1.0.0")).toBe(0);
    expect(compareVersion("1", "1.0")).toBe(0);
    expect(compareVersion("1", "1.0.1")).toBe(-1);
  });
  it("handles non-numeric gracefully", () => {
    expect(compareVersion("abc", "1.0")).toBe(-1);  // abc → 0
  });
});

describe("ModelListItem fixture", () => {
  it("model-list-item.json passes ModelListItemSchema", () => {
    const item = load("model-list-item.json");
    expect(() => ModelListItemSchema.parse(item)).not.toThrow();
  });
});

describe("fallback-config.json", () => {
  let cfg: HarnessConfig;

  it("passes HarnessConfigSchema", () => {
    cfg = HarnessConfigSchema.parse(load("fallback-config.json"));
    expect(cfg.modelList.length).toBe(3);
  });

  it("isDefault exactly-one (phase 3 cross M1 superRefine)", () => {
    const enabledDefaults = cfg.modelList.filter((m) => m.isDefault && m.enabled);
    expect(enabledDefaults).toHaveLength(1);
    expect(enabledDefaults[0].id).toBe("claude-sonnet-4-6");
  });

  it("rejects two isDefault models", () => {
    const bad = JSON.parse(JSON.stringify(load("fallback-config.json")));
    bad.modelList[0].isDefault = true;  // now both opus and sonnet are default
    expect(() => HarnessConfigSchema.parse(bad)).toThrow(/exactly 1/);
  });

  it("rejects zero isDefault models", () => {
    const bad = JSON.parse(JSON.stringify(load("fallback-config.json")));
    bad.modelList[1].isDefault = false;  // now no default
    expect(() => HarnessConfigSchema.parse(bad)).toThrow(/exactly 1/);
  });

  it("default disabled is not enabledDefault (must remain exactly-one)", () => {
    const bad = JSON.parse(JSON.stringify(load("fallback-config.json")));
    bad.modelList[1].enabled = false;  // sonnet is default but disabled now
    expect(() => HarnessConfigSchema.parse(bad)).toThrow(/exactly 1/);
  });
});

describe("HarnessConfig round-trip", () => {
  it("parse → re-encode → re-parse deep-equals", () => {
    const raw = load("fallback-config.json");
    const parsed = HarnessConfigSchema.parse(raw);
    const reEncoded = JSON.parse(JSON.stringify(parsed));
    expect(reEncoded).toEqual(raw);
  });
});
