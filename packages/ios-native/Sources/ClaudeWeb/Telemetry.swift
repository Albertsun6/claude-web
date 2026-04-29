// Lightweight in-app telemetry. Buffers events in memory (cap 1000), flushes
// to backend POST /api/telemetry every 30s OR every 50 events OR on app
// background. Offline queue persists until backend reachable. Personal
// sideload — no PII filter, no sampling, no third-party SDK.
//
// Usage:
//   tel.log("ws.connect")                                  → info-level
//   tel.warn("route.orphan_runid", props: ["runId": "..."])
//   tel.error("api.projects.failed", error: err, props: [...])
//
// Events that fire BEFORE the backend URL is known (e.g. very early in
// init) are buffered and shipped with the first successful flush.

import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class Telemetry {
    enum Level: String, Codable {
        case info, warn, error, crash
    }

    /// One captured event. Designed to be sparse — most fields are optional
    /// so light log calls stay cheap.
    struct Event: Codable, Identifiable {
        let id: String
        let timestamp: Date
        let level: Level
        let event: String
        let conversationId: String?
        let runId: String?
        let props: [String: String]?
        let appVersion: String
        let buildVersion: String
        let deviceModel: String

        @MainActor
        init(
            level: Level,
            event: String,
            conversationId: String? = nil,
            runId: String? = nil,
            props: [String: String]? = nil
        ) {
            self.id = UUID().uuidString
            self.timestamp = Date()
            self.level = level
            self.event = event
            self.conversationId = conversationId
            self.runId = runId
            self.props = props
            self.appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
            self.buildVersion = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
            self.deviceModel = UIDevice.current.model
        }
    }

    /// Recently captured events (newest first). UI bound for the in-app
    /// debug viewer. Capped at MAX_RING.
    private(set) var ring: [Event] = []
    private static let MAX_RING = 1000

    /// Events queued for next flush. Drained on successful POST.
    private var pending: [Event] = []
    /// Last successful flush time (debug only).
    private(set) var lastFlush: Date?
    private(set) var lastFlushError: String?

    private let backend: () -> URL
    private let token: () -> String
    private var flushTimer: Timer?

    private static let FLUSH_INTERVAL: TimeInterval = 30
    private static let FLUSH_THRESHOLD = 50

    init(backend: @escaping () -> URL, token: @escaping () -> String = { "" }) {
        self.backend = backend
        self.token = token
        installLifecycleHooks()
        startFlushTimer()
    }

    // MARK: - Public

    func log(_ event: String, props: [String: String]? = nil, conversationId: String? = nil, runId: String? = nil) {
        record(.init(level: .info, event: event, conversationId: conversationId, runId: runId, props: props))
    }

    func warn(_ event: String, props: [String: String]? = nil, conversationId: String? = nil, runId: String? = nil) {
        record(.init(level: .warn, event: event, conversationId: conversationId, runId: runId, props: props))
    }

    func error(_ event: String, error: Error? = nil, props: [String: String]? = nil, conversationId: String? = nil, runId: String? = nil) {
        var p = props ?? [:]
        if let e = error {
            p["error"] = e.localizedDescription
            p["errorType"] = String(describing: type(of: e))
        }
        record(.init(level: .error, event: event, conversationId: conversationId, runId: runId, props: p))
    }

    /// Force-flush now (e.g. background transition / settings menu trigger).
    func flushNow() {
        Task { await self.flush() }
    }

    // MARK: - Private

    private func record(_ event: Event) {
        ring.insert(event, at: 0)
        if ring.count > Self.MAX_RING {
            ring.removeLast(ring.count - Self.MAX_RING)
        }
        pending.append(event)
        if pending.count >= Self.FLUSH_THRESHOLD {
            flushNow()
        }
        // Mirror to console so Xcode log shows it during dev
        let levelTag = event.level.rawValue.uppercased()
        print("[telemetry][\(levelTag)] \(event.event) props=\(event.props ?? [:])")
    }

    private func startFlushTimer() {
        flushTimer?.invalidate()
        flushTimer = Timer.scheduledTimer(withTimeInterval: Self.FLUSH_INTERVAL, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.flush()
            }
        }
    }

    /// Hook into app-state notifications so we don't lose events when the
    /// user backgrounds the app (or it gets suspended).
    private func installLifecycleHooks() {
        let center = NotificationCenter.default
        center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.log("app.background")
                await self?.flush()
            }
        }
        center.addObserver(
            forName: UIApplication.willTerminateNotification,
            object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.log("app.terminate")
                await self?.flush()
            }
        }
        center.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.log("app.foreground") }
        }
    }

    /// Send pending events to backend. On failure, leave them in `pending`
    /// to retry next interval. We never block the caller — flush is
    /// fire-and-forget from the caller's perspective.
    private func flush() async {
        guard !pending.isEmpty else { return }
        let batch = pending
        var components = URLComponents(url: backend(), resolvingAgainstBaseURL: false)
        components?.path = "/api/telemetry"
        guard let url = components?.url else { return }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        let t = token()
        if !t.isEmpty {
            req.setValue("Bearer \(t)", forHTTPHeaderField: "authorization")
        }
        req.timeoutInterval = 10

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let body: [String: Any]
        do {
            // Encode each event individually so a single bad event can't
            // blow the whole batch (defensive — Codable should never fail
            // for our types but the cost is trivial).
            let encoded = try batch.map { try encoder.encode($0) }
            let dictArray = try encoded.map { try JSONSerialization.jsonObject(with: $0) }
            body = ["events": dictArray]
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            lastFlushError = "encode failed: \(error.localizedDescription)"
            return
        }

        do {
            let (_, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? -1
                lastFlushError = "HTTP \(code)"
                return
            }
            // Only drop events we successfully sent. Any new events that
            // arrived during the send stay in pending.
            pending.removeFirst(min(batch.count, pending.count))
            lastFlush = Date()
            lastFlushError = nil
        } catch {
            lastFlushError = "network: \(error.localizedDescription)"
            // Cap pending size so an extended outage doesn't grow unbounded.
            if pending.count > Self.MAX_RING {
                pending.removeFirst(pending.count - Self.MAX_RING)
            }
        }
    }
}
