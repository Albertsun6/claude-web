// HarnessStore — server-driven config 的 iOS 端持有者 (M0 modelList Round).
//
// 优先级（启动 → 联网）：
// 1. Cache (Application Support/.../harness-config.json) — 最近一次成功 fetch 的快照
// 2. Bundle fallback (fallback-config.json，xcodegen 复制自 packages/shared/fixtures/harness/)
//    — single source 与 backend 同步
// 3. fetch from backend → 200 → 缓存 + 触发 SwiftUI re-render
//                      → 304 → 保留当前 config
//
// minClientVersion 检测（RFC §2.3 + ADR-0011）：
// - compareVersion(clientVersion, response.minClientVersion) < 0 → 切 Bundle fallback
//   + 触发升级提示 UI（M0 范围仅打 telemetry warn；UI 提示 M0.5）

import Foundation
import Observation

@MainActor
@Observable
final class HarnessStore {
    /// 当前生效的 config（永远非空，最差是 Bundle fallback）
    var config: HarnessConfig
    var lastFetchedAt: Date?
    var lastError: String?
    var isStale: Bool = false   // true if currently using Bundle fallback / cache, not server

    private let cache: Cache
    private let api: HarnessConfigAPI
    private weak var telemetry: Telemetry?

    init(cache: Cache, api: HarnessConfigAPI) {
        self.cache = cache
        self.api = api

        // 启动顺序：cache → Bundle fallback
        if let cached = cache.loadHarnessConfig() {
            self.config = cached
            self.isStale = true  // until refetch confirms
        } else {
            self.config = HarnessStore.bundleFallback()
            self.isStale = true
        }
    }

    func bindTelemetry(_ tel: Telemetry) {
        self.telemetry = tel
    }

    /// Fetch from backend with current etag as If-None-Match.
    /// Updates `config` + `lastFetchedAt` on 200; no-op on 304.
    func refetch() async {
        let oldEtag = config.etag
        do {
            let result = try await api.fetch(ifNoneMatch: oldEtag.isEmpty ? nil : oldEtag)
            switch result {
            case .updated(let newConfig):
                if !versionGuard(newConfig) {
                    // minClientVersion fail — already swapped to bundle
                    return
                }
                self.config = newConfig
                self.lastFetchedAt = Date()
                self.lastError = nil
                self.isStale = false
                cache.saveHarnessConfig(newConfig)
                telemetry?.log("harness_store.refetch.updated", props: ["etag": newConfig.etag, "models": "\(newConfig.modelList.count)"])
            case .notModified:
                self.lastFetchedAt = Date()
                self.lastError = nil
                self.isStale = false
                telemetry?.log("harness_store.refetch.not_modified", props: ["etag": oldEtag])
            }
        } catch {
            self.lastError = String(describing: error)
            self.isStale = true
            telemetry?.warn("harness_store.refetch.failed", props: ["err": String(describing: error)])
        }
    }

    /// Returns true if the new config's minClientVersion is satisfied.
    /// On false, swaps to Bundle fallback and logs.
    ///
    /// Note: this compares the harness protocol version this app SUPPORTS
    /// (`HARNESS_PROTOCOL_CLIENT_VERSION` constant — independent of app
    /// marketing version), not `CFBundleShortVersionString`. App marketing
    /// version = 0.2.2 but this iOS app implements harness protocol 1.0.
    private func versionGuard(_ newConfig: HarnessConfig) -> Bool {
        let clientVersion = HARNESS_PROTOCOL_CLIENT_VERSION
        if compareVersion(clientVersion, newConfig.minClientVersion) < 0 {
            telemetry?.warn("harness_store.client_version_too_old", props: [
                "client": clientVersion,
                "minRequired": newConfig.minClientVersion,
            ])
            self.config = HarnessStore.bundleFallback()
            self.isStale = true
            self.lastError = "harness client version \(clientVersion) < minClientVersion \(newConfig.minClientVersion); using bundled fallback"
            return false
        }
        return true
    }

    // MARK: - Bundle fallback (single source: shared/fixtures/harness/fallback-config.json)

    /// Loaded from `fallback-config.json` Bundle resource (xcodegen copies it).
    /// Returned config has the etag computed at file content time (= ""), client
    /// will treat as "no etag known" → next refetch unconditional 200.
    static func bundleFallback() -> HarnessConfig {
        guard let url = Bundle.main.url(forResource: "fallback-config", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let cfg = try? JSONDecoder().decode(HarnessConfig.self, from: data) else {
            // last-resort hardcoded — should never hit if xcodegen + Bundle copy worked
            assertionFailure("Bundle fallback-config.json missing or unparseable; falling back to single-model emergency hardcode")
            return HarnessConfig(
                protocolVersion: "1.0",
                minClientVersion: "1.0",
                etag: "",
                modelList: [ModelListItem(
                    id: "claude-sonnet-4-6",
                    displayName: "Sonnet 4.6",
                    description: "通用",
                    capabilities: ModelCapabilities(supportsThinking: false, supportsLongContext: false, contextWindow: 200_000),
                    recommendedFor: ["coding"],
                    isDefault: true,
                    enabled: true,
                )]
            )
        }
        return cfg
    }

    /// App marketing version (CFBundleShortVersionString). NOT used for
    /// minClientVersion comparison — that uses HARNESS_PROTOCOL_CLIENT_VERSION
    /// (semantically separate from app version; see versionGuard).
    static func appVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0"
    }

    // MARK: - Convenience accessors

    /// Models eligible to show in Picker (enabled only).
    var enabledModels: [ModelListItem] {
        config.modelList.filter { $0.enabled }
    }

    /// Server-side default model (must be exactly one per superRefine, but
    /// we return first match defensively for fallback safety).
    var serverDefaultModel: ModelListItem? {
        config.modelList.first(where: { $0.isDefault && $0.enabled })
    }

    /// Look up a model by id. Returns nil if not in current config (e.g., user's
    /// previously-saved selection got removed by server). Caller must handle.
    func model(id: String) -> ModelListItem? {
        config.modelList.first(where: { $0.id == id })
    }
}
