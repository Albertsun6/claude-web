// /api/harness/config 后端 modelList 来源 (M0 modelList Round)
//
// Phase 3 修订（OQ4=A 硬编码 + cross M4 single-source + arch MINOR-3 lazy getter）：
// - Single source = packages/shared/fixtures/harness/fallback-config.json
// - backend lazy getter (避免 mutating const)
// - iOS xcodegen 复制为 Bundle resource，HarnessStore.fallbackConfig() decode 同一字节
// - 改 modelList 只动 fallback-config.json → tsx watch 重启 → WS 重连 → iOS refetch

import { HarnessConfigSchema, computeEtag, type HarnessConfig } from "@claude-web/shared";
import fallback from "@claude-web/shared/fixtures/harness/fallback-config.json";

let _cached: HarnessConfig | null = null;

/**
 * Lazy getter for the live HarnessConfig. Parses + freezes on first call.
 * Subsequent calls return the same frozen instance.
 *
 * To "edit" config: change `packages/shared/fixtures/harness/fallback-config.json`
 * → tsx watch will restart the backend → next call recomputes.
 */
export function getHarnessConfig(): HarnessConfig {
  if (_cached) return _cached;

  const parsed = HarnessConfigSchema.parse(fallback);
  // Compute etag from the parsed structure (excluding etag itself)
  const etag = computeEtag(parsed);
  const frozen: HarnessConfig = { ...parsed, etag };
  _cached = Object.freeze(frozen) as HarnessConfig;
  return _cached;
}
