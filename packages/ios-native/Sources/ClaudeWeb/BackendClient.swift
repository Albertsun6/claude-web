// Single WebSocket client to the Mac backend. Reconnects with backoff on drop.
// Exposes published @Observable state for the UI to bind to.

import Foundation
import Observation

@MainActor
@Observable
final class BackendClient {
    enum ConnState: Equatable {
        case disconnected
        case connecting
        case connected
        case error(String)
    }

    var state: ConnState = .disconnected
    var messages: [ChatLine] = []
    var sessionId: String?
    var busy: Bool = false
    var currentRunId: String?
    /// When non-nil, UI shows a sheet asking allow/deny.
    var pendingPermission: PermissionRequest?

    /// Invoked once per turn after `session_ended` arrives. App wires this to
    /// the TTS player so the assistant's reply gets read aloud.
    var onTurnComplete: (() -> Void)?

    /// User-tweakable backend URL (settings page writes here, persisted in UserDefaults).
    var backendBase: URL {
        didSet { reconnect() }
    }

    /// Optional CLAUDE_WEB_TOKEN. Empty = no auth.
    /// Read via closure so changes in Settings flow through immediately.
    private let authToken: () -> String

    private var task: URLSessionWebSocketTask?
    private var session: URLSession
    private var reconnectDelay: TimeInterval = 1
    private var reconnectTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?

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
        guard let wsURL = components.url else { state = .error("bad URL"); return }
        let t = session.webSocketTask(with: wsURL)
        task = t
        t.resume()
        state = .connected
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
                handle(server)
            } catch {
                state = .error("\(error.localizedDescription)")
                scheduleReconnect()
                return
            }
        }
    }

    private func handle(_ msg: ServerMessage) {
        switch msg {
        case .sdkMessage(_, let sdk):
            switch sdk {
            case .systemInit(let sessionId, _):
                if let sessionId { self.sessionId = sessionId }
            case .assistantText(let text):
                appendOrAppendToLast(role: .assistant, text: text)
            case .toolUse(let name):
                messages.append(ChatLine(role: .system, text: "🔧 \(name)"))
            case .toolResult, .other:
                break
            case .result:
                break
            }
        case .sessionEnded(_, let reason):
            busy = false
            currentRunId = nil
            // Auto-speak only on a clean completion. interrupted / error paths
            // shouldn't surprise-talk.
            if reason == "completed" {
                onTurnComplete?()
            }
        case .error(_, let message):
            messages.append(ChatLine(role: .error, text: message))
            busy = false
        case .clearRunMessages(let runId):
            messages.removeAll { $0.runId == runId }
        case .permissionRequest(let runId, let requestId, let toolName, let input):
            // Show modal — Claude is blocked until we reply. Auto-deny if a
            // newer request arrives (shouldn't happen but defensive).
            pendingPermission = PermissionRequest(
                runId: runId, requestId: requestId, toolName: toolName, input: input
            )
        case .unknown:
            break
        }
    }

    func replyPermission(_ request: PermissionRequest, decision: PermissionDecision) {
        Task { [weak self] in
            try? await self?.send(.permissionReply(
                requestId: request.requestId,
                decision: decision.rawValue,
                runId: request.runId
            ))
        }
        if pendingPermission?.requestId == request.requestId {
            pendingPermission = nil
        }
    }

    /// Streamed assistant text often arrives as multiple sdk_messages with the
    /// FULL accumulated text each time (not deltas). Detect that and replace
    /// rather than append duplicates.
    private func appendOrAppendToLast(role: ChatLine.Role, text: String) {
        if role == .assistant,
           let last = messages.last,
           last.role == .assistant,
           last.runId == currentRunId,
           text.hasPrefix(last.text) {
            messages[messages.count - 1] = ChatLine(role: .assistant, text: text, runId: currentRunId)
            return
        }
        messages.append(ChatLine(role: role, text: text, runId: currentRunId))
    }

    // MARK: - Send

    func sendPrompt(
        _ prompt: String,
        cwd: String,
        model: String = "claude-haiku-4-5",
        permissionMode: String = "plan"
    ) {
        // Fail fast if WS isn't open — otherwise sendPrompt sets busy=true,
        // the send silently fails, and the UI gets stuck in "thinking" forever.
        guard task != nil else {
            messages.append(ChatLine(role: .error, text: "未连接后端，发送失败"))
            return
        }
        let runId = UUID().uuidString
        currentRunId = runId
        busy = true
        messages.append(ChatLine(role: .user, text: prompt, runId: runId))

        let msg = ClientMessage.userPrompt(
            runId: runId,
            prompt: prompt,
            cwd: cwd,
            model: model,
            permissionMode: permissionMode,
            resumeSessionId: sessionId
        )
        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.send(msg)
            } catch {
                // Reset busy / runId so VoiceSession.state goes back to idle
                // and remote commands work again. The user sees the error in
                // chat and can retry.
                self.messages.append(ChatLine(role: .error, text: "发送失败: \(error.localizedDescription)"))
                if self.currentRunId == runId {
                    self.busy = false
                    self.currentRunId = nil
                }
            }
        }
    }

    func interrupt() {
        guard let runId = currentRunId else { return }
        Task { [weak self] in try? await self?.send(.interrupt(runId: runId)) }
    }

    /// Throws on encode / network failure so the caller can reset busy / runId.
    private func send(_ message: ClientMessage) async throws {
        guard let t = task else {
            throw NSError(domain: "BackendClient", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "WebSocket not connected"])
        }
        let data = try JSONEncoder().encode(message)
        let s = String(data: data, encoding: .utf8) ?? "{}"
        try await t.send(.string(s))
    }
}

struct ChatLine: Identifiable, Equatable {
    enum Role: String { case user, assistant, system, error }
    let id = UUID()
    let role: Role
    var text: String
    var runId: String?

    init(role: Role, text: String, runId: String? = nil) {
        self.role = role
        self.text = text
        self.runId = runId
    }
}

struct PermissionRequest: Identifiable, Equatable {
    var id: String { requestId }
    let runId: String
    let requestId: String
    let toolName: String
    let input: [String: Any]

    /// One-line preview rendered into the modal so the user can see what
    /// they're approving (file path for Edit, command for Bash, etc).
    var preview: String {
        switch toolName {
        case "Bash":
            return (input["command"] as? String) ?? ""
        case "Edit", "Write":
            return (input["file_path"] as? String) ?? (input["path"] as? String) ?? ""
        case "Read":
            return (input["file_path"] as? String) ?? ""
        default:
            // Fallback: pretty-print whole input
            if let data = try? JSONSerialization.data(withJSONObject: input, options: [.prettyPrinted]),
               let s = String(data: data, encoding: .utf8) {
                return s
            }
            return ""
        }
    }

    static func == (lhs: PermissionRequest, rhs: PermissionRequest) -> Bool {
        lhs.requestId == rhs.requestId
    }
}

enum PermissionDecision: String { case allow, deny }
