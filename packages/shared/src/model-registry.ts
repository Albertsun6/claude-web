// 单一来源：modelHint → modelId / displayName。
//
// 为什么需要 single source：
// scheduler.ts (`profile.modelHint` → CLI `--model` 参数)、frontend ConfigPanel
// (用户可选 model 列表)、StatusBar (id → label 显示)、fallback-config.json
// (server-driven config 兜底里的 `modelList`) 之前各自硬编码 modelId / label，
// v0.4.4 → v0.4.5 dogfood 暴露 scheduler.ts opus 落后两代 (claude-opus-4-5)
// 而其他三处都已 4-7 的 drift。本文件让消费者从一处 import，下次模型升级
// 只需改这里 + 同步 fallback-config.json fixture。
//
// 注：fallback-config.json 是 JSON 不能 import const，所以用
// [packages/shared/src/__tests__/model-registry.test.ts] lock 它的 modelList[].id
// 与 MODEL_ID_BY_HINT.value 一致。fixture 漂移 = 测试失败。

export const MODEL_HINTS = ["opus", "sonnet", "haiku"] as const;
export type ModelHint = (typeof MODEL_HINTS)[number];

/**
 * modelHint → CLI `--model` 字符串。
 *
 * 选 short form (`claude-haiku-4-5`) 而非 dated form
 * (`claude-haiku-4-5-20251001`)：CLI 接受 alias，short form 升新 patch 时
 * 不必改字符串；frontend 和 fallback-config.json 已用 short form，统一。
 */
export const MODEL_ID_BY_HINT: Readonly<Record<ModelHint, string>> = Object.freeze({
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
});

export const MODEL_DISPLAY_NAME_BY_ID: Readonly<Record<string, string>> = Object.freeze({
  "claude-opus-4-7": "Opus 4.7",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5": "Haiku 4.5",
});

/** modelHint → modelId 的查询函数，type-narrow 友好。 */
export function modelIdForHint(hint: ModelHint): string {
  return MODEL_ID_BY_HINT[hint];
}
