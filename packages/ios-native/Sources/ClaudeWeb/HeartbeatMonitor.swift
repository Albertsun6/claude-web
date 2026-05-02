// Polls /api/health/heartbeat every few seconds. Exposes a small status struct
// so SettingsView (and future toolbar badges) can render "Mac is alive" indicator.
//
// Lightweight — endpoint returns in <5ms. Pause polling when iOS app is in
// background to save battery.

import Foundation
import SwiftUI

@Observable
final class HeartbeatMonitor {
    struct Snapshot: Codable, Equatable {
        var startedAt: Int64
        var uptimeSec: Int
        var lastSpawnAt: Int64?
        var lastCompletionAt: Int64?
        var lastErrorAt: Int64?
        var totalSpawns: Int
        var totalCompletions: Int
        var totalErrors: Int
        var activeRunCount: Int
        var notificationChannelCount: Int
        var now: Int64
    }

    enum Status {
        case unknown            // never fetched
        case healthy            // last fetch ok within freshnessSec
        case stale(secs: Int)   // last fetch was a while ago
        case unreachable(error: String)
    }

    var snapshot: Snapshot?
    var status: Status = .unknown
    var lastFetchAt: Date?

    private let baseURL: () -> URL
    private let intervalSec: Double
    private let freshnessSec: Double = 12 // status flips to .stale after this
    private var timer: Timer?
    private var task: Task<Void, Never>?

    init(baseURL: @escaping () -> URL, intervalSec: Double = 5.0) {
        self.baseURL = baseURL
        self.intervalSec = intervalSec
    }

    @MainActor
    func start() {
        stop()
        timer = Timer.scheduledTimer(withTimeInterval: intervalSec, repeats: true) { [weak self] _ in
            self?.fetchNow()
        }
        timer?.tolerance = intervalSec * 0.2
        fetchNow()
    }

    @MainActor
    func stop() {
        timer?.invalidate()
        timer = nil
        task?.cancel()
    }

    @MainActor
    func fetchNow() {
        task?.cancel()
        task = Task { [weak self] in
            await self?.fetch()
        }
    }

    private func fetch() async {
        let url = baseURL().appendingPathComponent("api/health/heartbeat")
        var req = URLRequest(url: url)
        req.timeoutInterval = 4
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
                let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
                await update(status: .unreachable(error: "HTTP \(code)"))
                return
            }
            let snap = try JSONDecoder().decode(Snapshot.self, from: data)
            await update(snap: snap)
        } catch {
            await update(status: .unreachable(error: shortError(error)))
        }
    }

    @MainActor
    private func update(snap: Snapshot) {
        self.snapshot = snap
        self.status = .healthy
        self.lastFetchAt = Date()
    }

    @MainActor
    private func update(status: Status) {
        self.status = status
        // Don't clear snapshot — old data is useful while reconnecting.
    }

    private func shortError(_ error: Error) -> String {
        let s = error.localizedDescription
        return s.count > 60 ? String(s.prefix(60)) + "…" : s
    }
}
