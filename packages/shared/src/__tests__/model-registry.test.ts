// model-registry.ts lock tests — 防 modelHint / modelId drift 再发生。
//
// v0.4.4 → v0.4.5 暴露 scheduler.ts opus 落后两代，PR #25 修单点，G 抽 single
// source。本测试 lock 三件事：
//   1. MODEL_HINTS 三值固定
//   2. MODEL_ID_BY_HINT / MODEL_DISPLAY_NAME_BY_ID 与当前规范一致
//   3. fallback-config.json modelList[].id 与 MODEL_ID_BY_HINT.value 100% 一致
//      （fixture 不能 import const，只能靠测试 lock）

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MODEL_HINTS,
  MODEL_ID_BY_HINT,
  MODEL_DISPLAY_NAME_BY_ID,
  modelIdForHint,
} from "../model-registry";

describe("model-registry — enum / mapping lock", () => {
  it("MODEL_HINTS has exactly 3 values in fixed order", () => {
    expect([...MODEL_HINTS]).toEqual(["opus", "sonnet", "haiku"]);
  });

  it("MODEL_ID_BY_HINT covers every hint with the canonical model id", () => {
    expect(MODEL_ID_BY_HINT).toEqual({
      opus: "claude-opus-4-7",
      sonnet: "claude-sonnet-4-6",
      haiku: "claude-haiku-4-5",
    });
  });

  it("MODEL_DISPLAY_NAME_BY_ID covers every modelId with the human-readable label", () => {
    expect(MODEL_DISPLAY_NAME_BY_ID).toEqual({
      "claude-opus-4-7": "Opus 4.7",
      "claude-sonnet-4-6": "Sonnet 4.6",
      "claude-haiku-4-5": "Haiku 4.5",
    });
  });

  it("modelIdForHint round-trips every hint", () => {
    for (const hint of MODEL_HINTS) {
      expect(modelIdForHint(hint)).toBe(MODEL_ID_BY_HINT[hint]);
    }
  });
});

describe("model-registry — fallback-config.json consistency lock", () => {
  // fallback-config.json 是 server-driven config 兜底 fixture。其 modelList[].id
  // 必须与 MODEL_ID_BY_HINT.value 完全相同 — 否则 server 启动失败回退兜底时给前端的
  // 列表会和 scheduler spawn 的 modelId 不一致，造成另一种 drift。
  const fallbackPath = path.resolve(
    __dirname,
    "../../fixtures/harness/fallback-config.json",
  );

  type FallbackConfig = {
    modelList: Array<{ id: string; displayName: string }>;
  };

  const fallback = JSON.parse(readFileSync(fallbackPath, "utf-8")) as FallbackConfig;

  it("fallback-config.json modelList[].id 全部出现在 MODEL_ID_BY_HINT", () => {
    const registryIds = new Set(Object.values(MODEL_ID_BY_HINT));
    for (const item of fallback.modelList) {
      expect(registryIds.has(item.id)).toBe(true);
    }
  });

  it("MODEL_ID_BY_HINT 每个 modelId 在 fallback-config.json modelList 都有对应项", () => {
    const fallbackIds = new Set(fallback.modelList.map((m) => m.id));
    for (const modelId of Object.values(MODEL_ID_BY_HINT)) {
      expect(fallbackIds.has(modelId)).toBe(true);
    }
  });

  it("fallback-config.json modelList[].displayName 与 MODEL_DISPLAY_NAME_BY_ID 一致", () => {
    for (const item of fallback.modelList) {
      const expected = MODEL_DISPLAY_NAME_BY_ID[item.id];
      expect(item.displayName).toBe(expected);
    }
  });
});
