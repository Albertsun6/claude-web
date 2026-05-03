// /api/harness/config 后端 modelList 来源 (M0 modelList Round)
//
// Phase 3 修订（OQ4=A 硬编码 + cross M4 single-source + arch MINOR-3 lazy getter）：
// - Single source = packages/shared/fixtures/harness/fallback-config.json
// - backend lazy getter (避免 mutating const)
// - iOS xcodegen 复制为 Bundle resource，HarnessStore.fallbackConfig() decode 同一字节
// - 改 modelList 只动 fallback-config.json → tsx watch 重启 → WS 重连 → iOS refetch
// - M0 §7: 加 onConfigChanged 事件，供 index.ts broadcast harness_event{config_changed}

import { HarnessConfigSchema, computeEtag, type HarnessConfig } from "@claude-web/shared";
import fallback from "@claude-web/shared/fixtures/harness/fallback-config.json";
import { EventEmitter } from "node:events";
import chokidar from "chokidar";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let _cached: HarnessConfig | null = null;

/** Fires "config_changed" when fallback-config.json is modified on disk. */
export const harnessConfigEvents = new EventEmitter();

// Watch the shared fallback-config.json at its source location. When tsx
// watch detects changes it restarts the backend anyway, but we also emit
// an event in the same process for the rare live-reload path (M1+).
const _configPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../shared/fixtures/harness/fallback-config.json"
);
chokidar.watch(_configPath, { ignoreInitial: true }).on("change", () => {
  _cached = null; // bust lazy cache so next GET recomputes
  harnessConfigEvents.emit("config_changed");
});

/**
 * Lazy getter for the live HarnessConfig. Parses + freezes on first call.
 * Subsequent calls return the same frozen instance.
 *
 * To "edit" config: change `packages/shared/fixtures/harness/fallback-config.json`
 * → tsx watch will restart the backend → next call recomputes.
 * (In-process: harnessConfigEvents fires "config_changed" + _cached is busted.)
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
