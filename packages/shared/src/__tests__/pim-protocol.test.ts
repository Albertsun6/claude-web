// pim-protocol round-trip tests (M0-PIM Day 1e, ADR-020 §D10 四端同步)
//
// 验证：
// 1. fixtures/harness/pim-item.json 通过 Zod parse → 重编码 → deep-equal 原对象
// 2. PIM_COMMITMENT_STATES / PIM_MODALITIES 等常量有正确默认 fallback
// 3. PimItemCreateDto + PimItemPatchDto 必要字段约束生效
//
// Swift 端的 round-trip 在 M2-iOS / 真机 e2e 时人工验证（M0 范围内未自动化）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PIM_DTO_SCHEMAS,
  PIM_COMMITMENT_STATES,
  PIM_MODALITIES,
  PIM_AI_STATUSES,
  PIM_VISIBILITIES,
  PIM_CONFIG_FALLBACK,
  PimItemDtoSchema,
  PimItemCreateDtoSchema,
  PimItemPatchDtoSchema,
  PimConfigSchema,
} from "../pim-protocol";

const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures/harness");

function loadFixture(name: string): unknown {
  const p = path.resolve(FIXTURES_DIR, name);
  return JSON.parse(readFileSync(p, "utf-8"));
}

describe("pim-protocol — receptor constants", () => {
  it("PIM_COMMITMENT_STATES 含 5 桶 + archived = 6", () => {
    expect(PIM_COMMITMENT_STATES).toEqual([
      "inbox",
      "action",
      "calendar",
      "waiting",
      "reference",
      "archived",
    ]);
  });

  it("PIM_MODALITIES 含 6 种", () => {
    expect(PIM_MODALITIES).toEqual([
      "text",
      "link",
      "image",
      "audio",
      "file",
      "structured",
    ]);
  });

  it("PIM_AI_STATUSES 含 6 个 (含 disabled)", () => {
    expect(PIM_AI_STATUSES).toEqual([
      "pending",
      "running",
      "done",
      "failed",
      "timeout",
      "disabled",
    ]);
  });

  it("PIM_VISIBILITIES 含 3 个", () => {
    expect(PIM_VISIBILITIES).toEqual(["private", "dev", "shared"]);
  });

  it("PIM_CONFIG_FALLBACK 含默认 7 个 domain 受控词表", () => {
    expect(PIM_CONFIG_FALLBACK.domainVocabulary).toEqual([
      "工作",
      "家庭",
      "健康",
      "财务",
      "学习",
      "兴趣",
      "关系",
    ]);
    expect(PIM_CONFIG_FALLBACK.aiEnabled).toBe(true);
  });
});

describe("pim-protocol — pim-item.json fixture round-trip", () => {
  it("PimItem fixture: parses + re-encodes deep-equal", () => {
    const raw = loadFixture("pim-item.json");
    const parsed = PimItemDtoSchema.parse(raw);
    const reEncoded = JSON.parse(JSON.stringify(parsed));
    expect(reEncoded).toEqual(raw);
  });

  it("fixture commitmentState 是合法白名单值", () => {
    const raw = loadFixture("pim-item.json") as { commitmentState: string };
    expect(PIM_COMMITMENT_STATES).toContain(raw.commitmentState);
  });

  it("fixture modality 是合法白名单值", () => {
    const raw = loadFixture("pim-item.json") as { modality: string };
    expect(PIM_MODALITIES).toContain(raw.modality);
  });
});

describe("pim-protocol — PimItemDto schema flexibility (ADR-020 D6)", () => {
  // commitmentState / modality 用 string 而非 z.enum——server-driven config
  // 加新值时 v1.0 client 不能 Zod parse fail。
  it("accepts unknown commitmentState (forward-compat for server-driven values)", () => {
    const raw = loadFixture("pim-item.json") as Record<string, unknown>;
    const withUnknown = { ...raw, commitmentState: "future_state_v2" };
    expect(() => PimItemDtoSchema.parse(withUnknown)).not.toThrow();
  });

  it("accepts unknown modality (forward-compat)", () => {
    const raw = loadFixture("pim-item.json") as Record<string, unknown>;
    const withUnknown = { ...raw, modality: "future_modality" };
    expect(() => PimItemDtoSchema.parse(withUnknown)).not.toThrow();
  });

  it("rejects unknown aiStatus (enum is locked)", () => {
    const raw = loadFixture("pim-item.json") as Record<string, unknown>;
    const withInvalid = { ...raw, aiStatus: "bogus_status" };
    expect(() => PimItemDtoSchema.parse(withInvalid)).toThrow();
  });
});

describe("pim-protocol — PimItemCreateDto input validation", () => {
  it("accepts minimal input (just content)", () => {
    const min = { content: "test content" };
    expect(() => PimItemCreateDtoSchema.parse(min)).not.toThrow();
  });

  it("rejects empty content", () => {
    expect(() => PimItemCreateDtoSchema.parse({ content: "" })).toThrow();
  });

  it("rejects missing content", () => {
    expect(() => PimItemCreateDtoSchema.parse({})).toThrow();
  });
});

describe("pim-protocol — PimItemPatchDto requires at least one field", () => {
  it("rejects empty patch body", () => {
    expect(() => PimItemPatchDtoSchema.parse({})).toThrow(
      /at least one field/,
    );
  });

  it("accepts single-field patch (commitmentState only)", () => {
    expect(() =>
      PimItemPatchDtoSchema.parse({ commitmentState: "action" }),
    ).not.toThrow();
  });

  it("accepts content-only patch", () => {
    expect(() =>
      PimItemPatchDtoSchema.parse({ content: "updated" }),
    ).not.toThrow();
  });
});

describe("pim-protocol — PimConfig server-driven config validation", () => {
  it("PIM_CONFIG_FALLBACK satisfies PimConfigSchema", () => {
    expect(() => PimConfigSchema.parse(PIM_CONFIG_FALLBACK)).not.toThrow();
  });

  it("rejects missing commitmentStates (required)", () => {
    expect(() => PimConfigSchema.parse({})).toThrow();
  });

  it("accepts minimal config (commitmentStates only)", () => {
    expect(() =>
      PimConfigSchema.parse({ commitmentStates: ["inbox", "action"] }),
    ).not.toThrow();
  });
});

describe("pim-protocol — PIM_DTO_SCHEMAS coverage", () => {
  it("exposes 4 schemas (PimItem / Create / Patch / Config)", () => {
    expect(Object.keys(PIM_DTO_SCHEMAS).sort()).toEqual([
      "PimConfig",
      "PimItem",
      "PimItemCreate",
      "PimItemPatch",
    ]);
  });
});
