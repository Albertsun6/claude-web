// WebSocket transport. Owns the URLSessionWebSocketTask, runs the receive
// loop, decodes incoming frames into ServerMessage, and exposes a single
// `send(_:)` for outbound frames. No conversation / runId knowledge.
//
// Reconnect strategy: exponential backoff (1s → 30s) on receive failure.
// `backendBase` is observable; mutating it triggers a reconnect via didSet.

import Foundation
import Observation

@MainActor
@Observable
final class WebSocketClient {
    /// Public connection state. Views observe via the BackendClient facade.
    var state: ConnState = .disconnected

    /// Backend URL (settings page writes here, persisted in UserDefaults).
    /// didSet triggers a reconnect so the new URL takes effect immediately.
    var backendBase: URL {
        didSet { reconnect() }
    }

    /// Decoded incoming messages. Wired by the BackendClient facade so that
    /// RunRouter + ConversationStore can take over from a single call site.
    var onMessage: ((ServerMessage) -> Void)?

    /// Fired after a socket task is created and resumed. BackendClient uses
    /// this to re-send idempotent subscriptions after reconnect.
    var onConnected: (() -> Void)?

    /// True iff the underlying URLSessionWebSocketTask is currently open.
    /// Callers gate `send` on this so a dropped connection surfaces as a
    /// "fail fast" rather than a queued frame nobody reads.
    var isOpen: Bool { task != nil }

    /// Optional CLAUDE_WEB_TOKEN. Empty = no auth.
    /// Read via closure so changes in Settings flow through immediately.
    private let authToken: () -> String

    private var task: URLSessionWebSocketTask?
    private var session: URLSession
    private var reconnectDelay: TimeInterval = 1
    private var reconnectTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?

    private weak var telemetry: Telemetry?

    func bindTelemetry(_ tel: Telemetry) {
        self.telemetry = tel
    }

    init(backendBase: URL, authToken: @escaping () -> String = { "" }) {
        self.backendBase = backendBase
        self.authToken = authToken
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: config)
    }

    func connect() {
        guard task == nil else { return }
        state = .connecting
        telemetry?.log("ws.connect.start", props: ["host": backendBase.host ?? "?"])
        let scheme = backendBase.scheme == "https" ? "wss" : "ws"
        var components = URLComponents(url: backendBase, resolvingAgainstBaseURL: false)!
        components.scheme = scheme
        components.path = "/ws"
        // CLAUDE_WEB_TOKEN goes via ?token= so the WS upgrade can be auth'd
        // before any frames are exchanged (matches the web frontend).
        let token = authToken()
        if !token.isEmpty {
            var items = components.queryItems ?? []
            items.append(URLQueryItem(name: "token", value: token))
            components.queryItems = items
        }
        guard let wsURL = components.url else {
            state = .error("bad URL")
            telemetry?.error("ws.connect.bad_url", props: ["base": backendBase.absoluteString])
            return
        }
        let t = session.webSocketTask(with: wsURL)
        task = t
        t.resume()
        state = .connected
        telemetry?.log("ws.connect.ok")
        onConnected?()
        receiveTask = Task { [weak self] in await self?.receiveLoop() }
    }

    func disconnect() {
        receiveTask?.cancel()
        receiveTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        state = .disconnected
    }

    func reconnect() {
        disconnect()
        reconnectDelay = 1
        connect()
    }

    private func scheduleReconnect() {
        reconnectTask?.cancel()
        let delay = reconnectDelay
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            await MainActor.run { [weak self] in
                guard let self else { return }
                self.task = nil
                self.connect()
                self.reconnectDelay = min(delay * 2, 30)
            }
        }
    }

    private func receiveLoop() async {
        guard let t = task else { return }
        while !Task.isCancelled {
            do {
                let msg = try await t.receive()
                let data: Data
                switch msg {
                case .data(let d): data = d
                case .string(let s): data = s.data(using: .utf8) ?? Data()
                @unknown default: continue
                }
                let server = try ServerMessage.decode(data)
                onMessage?(server)
            } catch {
                state = .error("\(error.localizedDescription)")
                telemetry?.error("ws.receive.failed", error: error)
                scheduleReconnect()
                return
            }
        }
    }

    /// Throws on encode / network failure so the caller can reset busy/runId.
    func send(_ message: ClientMessage) async throws {
        guard let t = task else {
            throw NSError(domain: "WebSocketClient", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "WebSocket not connected"])
        }
        let data = try JSONEncoder().encode(message)
        let s = String(data: data, encoding: .utf8) ?? "{}"
        try await t.send(.string(s))
    }
}
