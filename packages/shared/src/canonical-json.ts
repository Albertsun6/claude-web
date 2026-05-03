// Canonical JSON + ETag computation for harness config.
//
// Phase 3 BLOCKER fix: 原 RFC v1.0 写 "Object.keys 排序" 含糊，
// 按 JSON.stringify(value, sortedKeysArray) 字面会被解读为 key 白名单
// → 嵌套字段被过滤 → M0 hot-reload 核心失效。
//
// 算法（RFC §1.3）：
// - object 按 key 字典排序，递归 canonicalize 每 value
// - array 保持顺序（不排序），递归 canonicalize 每项
// - primitive (string / number / boolean / null) 用 JSON.stringify
// - undefined / NaN / Infinity 视为非法（Zod 边界已防）

import { createHash } from "node:crypto";

export function canonicalize(v: unknown): string {
  if (v === undefined) {
    throw new Error("canonicalize: undefined not allowed in canonical JSON");
  }
  if (typeof v === "number" && !Number.isFinite(v)) {
    throw new Error(`canonicalize: ${v} (NaN/Infinity) not allowed`);
  }
  if (v === null || typeof v !== "object") {
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    return "[" + v.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) + ":" + canonicalize((v as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

/**
 * Compute ETag from a HarnessConfig-like object. The `etag` field itself is
 * excluded (avoid self-reference). Returns "sha256:<16 hex>".
 */
export function computeEtag(obj: { etag?: string; [k: string]: unknown }): string {
  const { etag: _ignore, ...rest } = obj;
  const canonical = canonicalize(rest);
  const hash = createHash("sha256").update(canonical, "utf-8").digest("hex");
  return `sha256:${hash.slice(0, 16)}`;
}
