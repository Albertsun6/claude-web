// M0 agentProfiles Round 测试 (M0 mini-milestone C，protocolVersion 1.2)
//
// 关键 hard requirements:
// - AgentProfileItemSchema round-trip (含可扩展 hint-only 字段：stage / modelHint)
// - HarnessConfig superRefine agentProfiles id 唯一
// - minor bump v1.1 schema 解析 v1.2 payload graceful skip (不崩 + 拿到 modelList + permissionModes)
// - drift: fallback-config 12 项 + 仅 PM enabled=true（M1 准备）

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  HarnessConfigSchema,
  AgentProfileItemSchema,
  ModelListItemSchema,
  PermissionModeItemSchema,
  type HarnessConfig,
} from "../index";

const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures/harness");

function load(name: string): unknown {
  return JSON.parse(readFileSync(path.resolve(FIXTURES_DIR, name), "utf-8"));
}

describe("AgentProfileItemSchema", () => {
  it("accepts a valid item", () => {
    expect(() => AgentProfileItemSchema.parse({
      id: "PM",
      displayName: "PM",
      description: "需求收集 + spec 起草",
      stage: "discovery",
      modelHint: "sonnet",
      enabled: true,
    })).not.toThrow();
  });

  it("accepts unknown stage / modelHint (hint-only graceful skip)", () => {
    // 与 modelList recommendedFor + permissionModes riskLevel 对称：hint-only string
    expect(() => AgentProfileItemSchema.parse({
      id: "Future-agent",
      displayName: "Future",
      description: "x",
      stage: "future-stage-not-yet-defined",
      modelHint: "future-model-hint",
      enabled: false,
    })).not.toThrow();
  });

  it("rejects missing required field", () => {
    expect(() => AgentProfileItemSchema.parse({
      id: "PM",
      displayName: "PM",
      description: "x",
      // missing stage
      modelHint: "sonnet",
      enabled: true,
    })).toThrow();
  });
});

describe("HarnessConfigSchema with agentProfiles", () => {
  let cfg: HarnessConfig;

  it("fallback-config.json passes (含 agentProfiles)", () => {
    cfg = HarnessConfigSchema.parse(load("fallback-config.json"));
    expect(cfg.agentProfiles).toHaveLength(12);
    expect(cfg.protocolVersion).toBe("1.2");
  });

  it("PM is the only enabled profile in M0", () => {
    const enabled = cfg.agentProfiles.filter((p) => p.enabled);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe("PM");
    expect(enabled[0].stage).toBe("discovery");
  });

  it("12 ids cover the canonical agent set (drift unit test)", () => {
    // 来源：docs/HARNESS_AGENTS.md §2.2
    const expected = [
      "Strategist", "PM", "Reviewer-compliance", "Architect",
      "Reviewer-architecture", "Coder", "Tester", "Reviewer-code",
      "Reviewer-cross", "Releaser", "Observer", "Documentor",
    ].sort();
    expect(cfg.agentProfiles.map((p) => p.id).sort()).toEqual(expected);
  });

  it("rejects duplicate agent id (superRefine)", () => {
    const bad: any = JSON.parse(JSON.stringify(load("fallback-config.json")));
    bad.agentProfiles[1].id = "Strategist";  // PM → Strategist (duplicate with bad.agentProfiles[0])
    expect(() => HarnessConfigSchema.parse(bad)).toThrow(/unique ids/);
  });
});

describe("Minor bump v1.1 → v1.2 graceful skip", () => {
  // 模拟 v1.1 client schema (有 permissionModes 但没有 agentProfiles) 解析 v1.2 payload
  // 默认 Zod 行为 strip unknown keys，graceful skip
  const HarnessConfigV1_1Schema = z.object({
    protocolVersion: z.string(),
    minClientVersion: z.string(),
    etag: z.string(),
    modelList: z.array(ModelListItemSchema),
    permissionModes: z.array(PermissionModeItemSchema),
    // 没有 agentProfiles 字段
  }).superRefine((cfg, ctx) => {
    const enabledDefaults = cfg.modelList.filter((m) => m.isDefault && m.enabled);
    if (enabledDefaults.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `modelList exactly 1 isDefault required`,
        path: ["modelList"],
      });
    }
    const defaultModes = cfg.permissionModes.filter((p) => p.isDefault);
    if (defaultModes.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `permissionModes exactly 1 isDefault required`,
        path: ["permissionModes"],
      });
    }
  });

  it("v1.1 schema 解析 v1.2 payload 成功 (graceful skip agentProfiles)", () => {
    const v12Payload = load("fallback-config.json");
    expect(() => HarnessConfigV1_1Schema.parse(v12Payload)).not.toThrow();
    const parsed = HarnessConfigV1_1Schema.parse(v12Payload);
    expect(parsed.modelList).toHaveLength(3);
    expect(parsed.permissionModes).toHaveLength(4);
    expect("agentProfiles" in parsed).toBe(false);  // strip
  });

  it("v1.1 schema 解析 v1.1 payload (无 agentProfiles) 也成功", () => {
    const v11Payload: any = JSON.parse(JSON.stringify(load("fallback-config.json")));
    delete v11Payload.agentProfiles;
    v11Payload.protocolVersion = "1.1";
    expect(() => HarnessConfigV1_1Schema.parse(v11Payload)).not.toThrow();
  });
});

describe("HarnessConfig v1.2 round-trip", () => {
  it("parse → re-encode → re-parse deep-equals", () => {
    const raw = load("fallback-config.json");
    const parsed = HarnessConfigSchema.parse(raw);
    const reEncoded = JSON.parse(JSON.stringify(parsed));
    expect(reEncoded).toEqual(raw);
  });
});
