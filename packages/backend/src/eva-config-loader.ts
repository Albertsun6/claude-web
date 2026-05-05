// eva-config-loader — read + validate eva.json on backend startup (H12 v1).
//
// Soft validation：parse 失败时 warn 但不 fail backend 启动（兼容 eva.json
// 不存在或 schema 变化场景）。Backend functional behavior 不依赖 eva.json (v1)；
// 只是把状态读出来供 status reader / 后续 H13 / ResourceLock 用。

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseEvaConfig,
  summarizeEvaConfig,
  type EvaConfig,
} from "@claude-web/shared";

let cached: EvaConfig | null = null;

function findRepoRoot(): string {
  // backend cwd 是 packages/backend；repo root 是 ../..
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  // fallback：相对路径
  return path.resolve(process.cwd(), "..", "..");
}

/**
 * Load eva.json once at backend startup. Logs summary line. Returns null on
 * missing / invalid (soft validation per v1 scope).
 */
export function loadEvaConfig(): EvaConfig | null {
  if (cached) return cached;
  const repoRoot = findRepoRoot();
  const evaJsonPath = path.resolve(repoRoot, "eva.json");
  if (!existsSync(evaJsonPath)) {
    console.warn(`[eva-config] eva.json not found at ${evaJsonPath} (soft skip)`);
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(evaJsonPath, "utf-8"));
    const cfg = parseEvaConfig(raw);
    const sum = summarizeEvaConfig(cfg);
    console.log(
      `[eva-config] eva.json loaded: ${sum.total} worktrees ` +
        `(active=${sum.active}, done=${sum.done}, released=${sum.released})`,
    );
    cached = cfg;
    return cfg;
  } catch (err) {
    console.warn(
      `[eva-config] eva.json parse failed (soft skip): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
