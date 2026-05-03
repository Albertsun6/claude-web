// M0 permissionModes Round 测试 (RFC §1 + §3 + ADR-0015 F1 footnote)
//
// Phase 3 BLOCKER + 全 13 项 finding 修复后的 hard requirements:
// - PermissionModeItem schema round-trip
// - HarnessConfig superRefine permissionModes isDefault exactly-one
// - minor bump v1.0 schema 解析 v1.1 payload graceful skip (不崩 + 拿到 modelList)
// - drift 单测：fallback parses + 4 项 isDefault 恰好 1 + 与 ClientMessage.permissionMode 一致

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  HarnessConfigSchema,
  PermissionModeItemSchema,
  PermissionModeIdSchema,
  ModelListItemSchema,
  type HarnessConfig,
} from "../index";

const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures/harness");

function load(name: string): unknown {
  return JSON.parse(readFileSync(path.resolve(FIXTURES_DIR, name), "utf-8"));
}

describe("PermissionModeItemSchema", () => {
  it("accepts valid 4 items", () => {
    const items = [
      { id: "plan",              displayName: "Plan",         description: "x", isDefault: false, riskLevel: "low" },
      { id: "default",           displayName: "Default",      description: "x", isDefault: true,  riskLevel: "low" },
      { id: "acceptEdits",       displayName: "Accept Edits", description: "x", isDefault: false, riskLevel: "medium" },
      { id: "bypassPermissions", displayName: "Bypass",       description: "x", isDefault: false, riskLevel: "high" },
    ];
    for (const it of items) expect(() => PermissionModeItemSchema.parse(it)).not.toThrow();
  });
  it("rejects unknown id (locked enum)", () => {
    expect(() => PermissionModeItemSchema.parse({
      id: "yolo", displayName: "x", isDefault: false,
    })).toThrow();
  });
  it("accepts unknown riskLevel string (graceful skip, hint-only)", () => {
    // Phase 3 cross M2 + arch react: riskLevel hint-only, 与 modelList recommendedFor 对称
    expect(() => PermissionModeItemSchema.parse({
      id: "plan", displayName: "Plan", isDefault: false, riskLevel: "critical",
    })).not.toThrow();
  });
  it("accepts missing riskLevel (optional)", () => {
    expect(() => PermissionModeItemSchema.parse({
      id: "plan", displayName: "Plan", isDefault: false,
    })).not.toThrow();
  });
});

describe("HarnessConfigSchema with permissionModes", () => {
  let cfg: HarnessConfig;
  it("fallback-config.json passes (含 permissionModes)", () => {
    cfg = HarnessConfigSchema.parse(load("fallback-config.json"));
    expect(cfg.permissionModes).toHaveLength(4);
    // bumped to "1.2" by agentProfiles Round (M0 mini-milestone C); minor bump is graceful skip
    expect(cfg.protocolVersion).toBe("1.2");
  });
  it("isDefault exactly-one (phase 3 cross M1 superRefine 扩展)", () => {
    expect(cfg.permissionModes.filter(p => p.isDefault)).toHaveLength(1);
    expect(cfg.permissionModes.filter(p => p.isDefault)[0].id).toBe("default");
  });
  it("rejects two isDefault modes", () => {
    const bad = JSON.parse(JSON.stringify(load("fallback-config.json")));
    bad.permissionModes[0].isDefault = true;  // both plan and default = isDefault
    expect(() => HarnessConfigSchema.parse(bad)).toThrow(/exactly 1/);
  });
  it("rejects zero isDefault modes", () => {
    const bad = JSON.parse(JSON.stringify(load("fallback-config.json")));
    bad.permissionModes[1].isDefault = false;
    expect(() => HarnessConfigSchema.parse(bad)).toThrow(/exactly 1/);
  });
});

describe("Minor bump graceful skip (RFC §3.2 关键测试)", () => {
  // 模拟 v1.0 client schema (没有 permissionModes 字段) 解析 v1.1 payload
  // Phase 3 arch MAJOR-3 修复后写明：默认 Zod 行为是 strip unknown keys，graceful skip
  const HarnessConfigV1_0Schema = z.object({
    protocolVersion: z.string(),
    minClientVersion: z.string(),
    etag: z.string(),
    modelList: z.array(ModelListItemSchema),
    // 没有 permissionModes 字段
  }).superRefine((cfg, ctx) => {
    const enabledDefaults = cfg.modelList.filter((m) => m.isDefault && m.enabled);
    if (enabledDefaults.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `modelList exactly 1 isDefault required`,
        path: ["modelList"],
      });
    }
  });

  it("v1.0 schema 解析 v1.1 payload 成功 (graceful skip permissionModes)", () => {
    const v11Payload = load("fallback-config.json");
    expect(() => HarnessConfigV1_0Schema.parse(v11Payload)).not.toThrow();
    const parsed = HarnessConfigV1_0Schema.parse(v11Payload);
    expect(parsed.modelList).toHaveLength(3);  // modelList 仍正常拿到
    expect("permissionModes" in parsed).toBe(false);  // permissionModes 被 strip（v1.0 schema 不识别）
  });

  it("v1.0 schema 解析 v1.0 payload (不带 permissionModes) 也成功", () => {
    const v10Payload: any = JSON.parse(JSON.stringify(load("fallback-config.json")));
    delete v10Payload.permissionModes;
    v10Payload.protocolVersion = "1.0";
    expect(() => HarnessConfigV1_0Schema.parse(v10Payload)).not.toThrow();
  });
});

describe("Drift unit tests (phase 3 cross M4 + arch MINOR-3 修复)", () => {
  it("PermissionModeIdSchema 与 ClientMessage.permissionMode 一致", () => {
    // packages/shared/src/protocol.ts ClientMessage.permissionMode 字面值
    // 来源: PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan"
    const expectedClientMessageValues = ["default", "acceptEdits", "bypassPermissions", "plan"];
    expect(PermissionModeIdSchema.options.sort()).toEqual(expectedClientMessageValues.sort());
  });
  it("fallback-config.json 4 项 id 与 PermissionModeIdSchema 全覆盖", () => {
    const cfg = HarnessConfigSchema.parse(load("fallback-config.json"));
    const fixtureIds = cfg.permissionModes.map(p => p.id).sort();
    expect(fixtureIds).toEqual(["acceptEdits", "bypassPermissions", "default", "plan"]);
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
