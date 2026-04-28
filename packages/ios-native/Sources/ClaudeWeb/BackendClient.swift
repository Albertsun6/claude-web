// Single WebSocket client to the Mac backend. Reconnects with backoff on drop.
//
// State model: per-conversation. `stateByConversation` holds runtime state
// (messages / busy / pendingPermission / currentRunId) for every conversation
// the user has opened. Incoming WS messages are routed to the correct
// conversation via `runIdToConversation` (built when sendPrompt is called).
// UI binds to `currentMessages` / `currentBusy` / `currentPendingPermission`
// — computed views derived from `currentConversationId`. Switching conversations
// is just changing that single property; in-flight runs in other conversations
// keep going in the background.

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

    // MARK: - Conversation registry (in-memory; F1c3 will mirror to disk cache)

    /// Conversation metadata keyed by conversation id (client-side UUID).
    /// `sessionId` starts nil for new conversations, gets bound on first
    /// `system:init` arrival, persists for `--resume` on subsequent prompts.
    var conversations: [String: Conversation] = [:]

    /// Runtime state per conversation. Created lazily on first prompt /
    /// explicit `createConversation`, removed when user closes the conversation.
    var stateByConversation: [String: ConversationChatState] = [:]

    /// UI focus. UI binds computed views below to this.
    var currentConversationId: String?

    /// runId → conversationId map. Built in `sendPrompt`, consumed in `handle`,
    /// torn down on `sessionEnded` (any reason) and on send-failure / error.
    /// Without this map, WS messages for a backgrounded conversation would
    /// land in the wrong UI focus.
    private var runIdToConversation: [String: String] = [:]

    /// Per-cwd auto-increment counter used to label new conversations like
    /// "claude-web 1", "claude-web 2". In-memory only (resets on app launch);
    /// F1c3 will persist with conversation metadata in the cache file.
    private var conversationCounterByCwd: [String: Int] = [:]

    /// Invoked once per turn after `session_ended` arrives, but ONLY when the
    /// finishing run belongs to the currently-focused conversation. App wires
    /// this to the TTS player. Background conversations completing won't talk.
    var onTurnComplete: (() -> Void)?

    /// Fires whenever a conversation's persistent state (sessionId binding,
    /// messages array, etc) becomes "dirty" — caller should re-snapshot to
    /// the on-disk Cache. Triggered immediately on systemInit (sessionId
    /// binding) so a crash before session_ended doesn't lose the binding.
    var onConversationDirty: ((String) -> Void)?

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

    /// Optional telemetry sink. Wired in ClaudeWebApp.bootstrap. Nil during
    /// init to avoid a chicken-and-egg with @State setup; events fired before
    /// binding are silently dropped (rare — only happens in the first few ms).
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

    // MARK: - Computed views (UI binds these)

    var currentMessages: [ChatLine] {
        guard let id = currentConversationId else { return [] }
        return stateByConversation[id]?.messages ?? []
    }

    var currentBusy: Bool {
        guard let id = currentConversationId else { return false }
        return stateByConversation[id]?.busy ?? false
    }

    var currentPendingPermission: PermissionRequest? {
        guard let id = currentConversationId else { return nil }
        return stateByConversation[id]?.pendingPermission
    }

    /// Total number of in-flight turns across ALL conversations. UI uses this
    /// for the global activity badge on the drawer button.
    var activeRunCount: Int {
        stateByConversation.values.filter { $0.busy }.count
    }

    // MARK: - Conversation management

    /// Create a fresh conversation in the given cwd. `title` falls back to a
    /// readable auto-name like "claude-web 1" using the cwd's basename and a
    /// per-cwd counter. The user can override before the first prompt fires;
    /// after the first prompt, the title becomes the prompt's first 30 chars.
    @discardableResult
    func createConversation(cwd: String, title: String? = nil) -> Conversation {
        let normCwd = (cwd as NSString).standardizingPath
        let resolvedTitle: String
        if let custom = title?.trimmingCharacters(in: .whitespaces), !custom.isEmpty {
            resolvedTitle = custom
        } else {
            let base = (normCwd as NSString).lastPathComponent.isEmpty
                ? normCwd
                : (normCwd as NSString).lastPathComponent
            let next = (conversationCounterByCwd[normCwd] ?? 0) + 1
            conversationCounterByCwd[normCwd] = next
            resolvedTitle = "\(base) \(next)"
        }
        let id = UUID().uuidString
        let now = Date()
        let conv = Conversation(
            id: id,
            cwd: normCwd,
            sessionId: nil,
            title: resolvedTitle,
            createdAt: now,
            lastUsed: now
        )
        conversations[id] = conv
        stateByConversation[id] = ConversationChatState()
        // Save metadata immediately so an "empty" conversation the user
        // creates and then walks away from survives an app restart.
        onConversationDirty?(id)
        return conv
    }

    /// Insert a conversation that originated outside the BackendClient
    /// (cache replay on launch, historical session load via /api/sessions).
    /// Messages are restored straight into stateByConversation so the UI
    /// can render them without any server round-trip.
    func adopt(_ conversation: Conversation, messages: [ChatLine] = []) {
        conversations[conversation.id] = conversation
        var s = stateByConversation[conversation.id] ?? ConversationChatState()
        s.messages = messages
        stateByConversation[conversation.id] = s
    }

    /// Snapshot all conversation metadata for persistence to Cache. State
    /// (messages / busy / pendingPermission) is NOT included — those live
    /// in stateByConversation and are saved per-conversation under sessions/.
    func conversationsList() -> [Conversation] {
        Array(conversations.values)
    }

    /// Drop a conversation from memory. Does NOT touch the on-disk jsonl. If
    /// the user re-opens it via history, state will be re-fetched from the
    /// server. If `id == currentConversationId`, caller is responsible for
    /// picking a new focus first (or setting it nil).
    func closeConversation(_ id: String) {
        // Cancel in-flight runs that belong to this conversation, otherwise
        // the WS will keep firing messages that route to a dead key.
        if let s = stateByConversation[id], let runId = s.currentRunId {
            Task { [weak self] in try? await self?.send(.interrupt(runId: runId)) }
            runIdToConversation.removeValue(forKey: runId)
        }
        // Also clean up any orphan runId entries pointing here.
        runIdToConversation = runIdToConversation.filter { $0.value != id }
        conversations.removeValue(forKey: id)
        stateByConversation.removeValue(forKey: id)
    }

    /// Sorted by lastUsed descending — UI iterates this to render the drawer
    /// list. Cheap; conversation count is expected in single digits.
    func sortedConversations() -> [Conversation] {
        conversations.values.sorted { $0.lastUsed > $1.lastUsed }
    }

    /// What `createConversation(cwd:)` would assign as the auto-title for the
    /// next call. UI uses this to pre-fill the new-conversation form. Calling
    /// it does NOT increment the counter.
    func peekNextAutoName(forCwd cwd: String) -> String {
        let normCwd = (cwd as NSString).standardizingPath
        let base = (normCwd as NSString).lastPathComponent.isEmpty
            ? normCwd
            : (normCwd as NSString).lastPathComponent
        let next = (conversationCounterByCwd[normCwd] ?? 0) + 1
        return "\(base) \(next)"
    }

    // MARK: - WebSocket lifecycle

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
                telemetry?.error("ws.receive.failed", error: error)
                scheduleReconnect()
                return
            }
        }
    }

    // MARK: - Receive (route by runId)

    private func handle(_ msg: ServerMessage) {
        // Resolve which conversation this message belongs to. Messages whose
        // runId we don't know — orphan reconnect frames, conversations the
        // user already closed, global errors — silently drop. They must NOT
        // bleed into currentConversationId by default.
        guard let runId = msg.runId else {
            telemetry?.warn("route.no_runid", props: ["msgType": msg.typeName])
            return
        }
        guard let convId = runIdToConversation[runId] else {
            telemetry?.warn("route.orphan_runid", props: ["runId": runId, "msgType": msg.typeName])
            return
        }
        guard var s = stateByConversation[convId] else {
            // Conversation entry is gone (closed mid-flight). Drop the runId
            // mapping defensively so the table doesn't leak.
            telemetry?.warn("route.conversation_missing", props: ["runId": runId, "convId": convId], conversationId: convId)
            runIdToConversation.removeValue(forKey: runId)
            return
        }

        switch msg {
        case .sdkMessage(_, let sdk):
            switch sdk {
            case .systemInit(let sessionId, _):
                // Bind sessionId to the conversation as soon as it arrives so
                // later prompts can `--resume` it. Persist the binding to
                // cache IMMEDIATELY — if the app dies before session_ended
                // we'd otherwise lose the link between this conversation
                // and the jsonl file the CLI is writing.
                if let sessionId, var conv = conversations[convId] {
                    conv.sessionId = sessionId
                    conv.lastUsed = Date()
                    conversations[convId] = conv
                    telemetry?.log("session.bound", props: ["sessionId": sessionId], conversationId: convId, runId: runId)
                    onConversationDirty?(convId)
                }
            case .assistantContent(let text, let toolUses):
                // Text first (if any), then one ChatLine per tool_use block.
                // Order matches how the assistant produced them so cards
                // appear after the text that introduces them.
                if let text, !text.isEmpty {
                    appendAssistantText(state: &s, text: text, runId: runId)
                }
                for tool in toolUses {
                    // Skip if a row for this tool_use_id already exists —
                    // streaming may re-deliver the same tool_use as the
                    // assistant message gets resent with growing content.
                    if let id = tool.id, s.messages.contains(where: { $0.toolUseId == id }) {
                        continue
                    }
                    s.messages.append(ChatLine(
                        role: .toolUse,
                        text: tool.name,
                        runId: runId,
                        toolName: tool.name,
                        toolInputJSON: tool.inputJSON,
                        toolUseId: tool.id
                    ))
                }
            case .toolResult, .other, .result:
                break
            }
        case .sessionEnded(_, let reason):
            s.busy = false
            s.currentRunId = nil
            // Clean the runId mapping on EVERY end reason (completed / error /
            // interrupted). Otherwise the table grows unbounded and routing
            // could mis-attribute future runs that happen to recycle the id.
            runIdToConversation.removeValue(forKey: runId)
            stateByConversation[convId] = s
            telemetry?.log(
                "turn.\(reason)",
                props: ["msgCount": String(s.messages.count)],
                conversationId: convId, runId: runId
            )
            // Snapshot to cache after every turn end (any reason — completed,
            // interrupted, errored) so partial transcripts survive a crash.
            onConversationDirty?(convId)
            // TTS only for the focused conversation. Background conversations
            // finishing in another tab shouldn't surprise-talk.
            if reason == "completed" && convId == currentConversationId {
                onTurnComplete?()
            }
            return
        case .error(_, let message):
            s.messages.append(ChatLine(role: .error, text: message, runId: runId))
            s.busy = false
            telemetry?.error("server.error", props: ["message": message], conversationId: convId, runId: runId)
            // Even on error, drop the run-id mapping to prevent leak.
            runIdToConversation.removeValue(forKey: runId)
        case .clearRunMessages:
            s.messages.removeAll { $0.runId == runId }
        case .permissionRequest(_, let requestId, let toolName, let input):
            // Permission requests live on the conversation, not the client.
            // If user has switched away, the sheet won't pop on a different
            // conversation — they'll see it when they switch back.
            s.pendingPermission = PermissionRequest(
                runId: runId, requestId: requestId, toolName: toolName, input: input
            )
            telemetry?.log(
                "permission.request",
                props: ["tool": toolName, "requestId": requestId],
                conversationId: convId, runId: runId
            )
            _ = input  // suppress unused warning if telemetry is removed
        case .unknown:
            return
        }

        stateByConversation[convId] = s
    }

    private func appendAssistantText(
        state s: inout ConversationChatState,
        text: String,
        runId: String
    ) {
        // Streamed assistant text often arrives as multiple sdk_messages with
        // the FULL accumulated text each time (not deltas). Detect that and
        // replace rather than append duplicates.
        if let last = s.messages.last,
           last.role == .assistant,
           last.runId == runId,
           text.hasPrefix(last.text) {
            s.messages[s.messages.count - 1] = ChatLine(role: .assistant, text: text, runId: runId)
            return
        }
        s.messages.append(ChatLine(role: .assistant, text: text, runId: runId))
    }

    private func appendError(toConversation convId: String, _ text: String) {
        var s = stateByConversation[convId] ?? ConversationChatState()
        s.messages.append(ChatLine(role: .error, text: text))
        stateByConversation[convId] = s
    }

    /// Title was auto-generated by `createConversation` and not edited by the
    /// user. Used to decide whether the first prompt should rewrite it.
    private static func isAutoNamedTitle(_ title: String, cwd: String) -> Bool {
        let base = (cwd as NSString).lastPathComponent
        let prefix = "\(base) "
        guard title.hasPrefix(prefix) else { return false }
        let suffix = title.dropFirst(prefix.count)
        return !suffix.isEmpty && suffix.allSatisfy(\.isNumber)
    }

    // MARK: - Send

    /// Send a prompt to a specific conversation. cwd comes from the
    /// conversation itself (set at creation). `resumeSessionId` is sourced
    /// from the conversation's metadata, so the CLI continues the same
    /// session if one was bound earlier.
    func sendPrompt(
        _ prompt: String,
        conversationId: String,
        model: String = "claude-haiku-4-5",
        permissionMode: String = "plan"
    ) {
        // Fail fast if WS isn't open — otherwise sendPrompt sets busy=true,
        // the send silently fails, and the UI gets stuck in "thinking" forever.
        guard task != nil else {
            telemetry?.warn("prompt.send.not_connected", conversationId: conversationId)
            appendError(toConversation: conversationId, "未连接后端，发送失败")
            return
        }
        guard var conversation = conversations[conversationId] else {
            // Caller bug: prompt for conversation we don't track. Defensive log.
            telemetry?.error("prompt.send.unknown_conversation", conversationId: conversationId)
            appendError(toConversation: conversationId, "对话不存在: \(conversationId)")
            return
        }
        let cwd = conversation.cwd

        let runId = UUID().uuidString
        runIdToConversation[runId] = conversationId

        var s = stateByConversation[conversationId] ?? ConversationChatState()
        s.currentRunId = runId
        s.busy = true
        s.messages.append(ChatLine(role: .user, text: prompt, runId: runId))
        stateByConversation[conversationId] = s

        // Auto-derive title from first user message ONLY if the title is
        // still the auto-generated "<basename> <n>" placeholder. If the user
        // gave it a custom name at creation, leave it alone.
        if Self.isAutoNamedTitle(conversation.title, cwd: conversation.cwd) {
            let snippet = prompt
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .prefix(30)
            if !snippet.isEmpty {
                conversation.title = String(snippet)
            }
        }
        conversation.lastUsed = Date()
        conversations[conversationId] = conversation

        let msg = ClientMessage.userPrompt(
            runId: runId,
            prompt: prompt,
            cwd: cwd,
            model: model,
            permissionMode: permissionMode,
            resumeSessionId: conversation.sessionId
        )
        telemetry?.log(
            "prompt.send",
            props: [
                "model": model,
                "mode": permissionMode,
                "promptLen": String(prompt.count),
                "resume": conversation.sessionId == nil ? "no" : "yes",
            ],
            conversationId: conversationId, runId: runId
        )
        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.send(msg)
            } catch {
                // Reset busy/runId on send failure so VoiceSession.state goes
                // back to idle and remote commands work again. The user sees
                // the error in chat and can retry.
                self.telemetry?.error("prompt.send.failed", error: error, conversationId: conversationId, runId: runId)
                if var failed = self.stateByConversation[conversationId] {
                    failed.messages.append(ChatLine(role: .error, text: "发送失败: \(error.localizedDescription)"))
                    if failed.currentRunId == runId {
                        failed.busy = false
                        failed.currentRunId = nil
                    }
                    self.stateByConversation[conversationId] = failed
                }
                self.runIdToConversation.removeValue(forKey: runId)
            }
        }
    }

    /// UI-side convenience: send to the currently-focused conversation,
    /// auto-creating one in `defaultCwdForNew` if none exists yet (typical
    /// first-launch case). Existing conversations keep their original cwd.
    func sendPromptCurrent(
        _ prompt: String,
        defaultCwdForNew: String,
        model: String = "claude-haiku-4-5",
        permissionMode: String = "plan"
    ) {
        let id: String
        if let existing = currentConversationId, conversations[existing] != nil {
            id = existing
        } else {
            id = createConversation(cwd: defaultCwdForNew).id
            currentConversationId = id
        }
        sendPrompt(prompt, conversationId: id, model: model, permissionMode: permissionMode)
    }

    /// Interrupt the run in the currently-focused conversation. Other
    /// conversations' runs keep going.
    func interrupt() {
        guard let convId = currentConversationId,
              let runId = stateByConversation[convId]?.currentRunId else { return }
        Task { [weak self] in try? await self?.send(.interrupt(runId: runId)) }
    }

    func replyPermission(_ request: PermissionRequest, decision: PermissionDecision) {
        let convId = runIdToConversation[request.runId]
        Task { [weak self] in
            try? await self?.send(.permissionReply(
                requestId: request.requestId,
                decision: decision.rawValue,
                runId: request.runId
            ))
        }
        if let convId, var s = stateByConversation[convId] {
            if s.pendingPermission?.requestId == request.requestId {
                s.pendingPermission = nil
                stateByConversation[convId] = s
            }
        }
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

// MARK: - Conversation types

struct Conversation: Identifiable, Codable, Equatable {
    let id: String
    /// Working directory the CLI runs in. Stable for the conversation's
    /// lifetime — to point at a different cwd, create a new conversation.
    let cwd: String
    var sessionId: String?
    var title: String
    let createdAt: Date
    var lastUsed: Date
}

struct ConversationChatState: Equatable {
    var messages: [ChatLine] = []
    var pendingPermission: PermissionRequest? = nil
    var currentRunId: String? = nil
    var busy: Bool = false
}

struct ChatLine: Identifiable, Codable, Equatable {
    enum Role: String, Codable {
        case user, assistant, system, error
        /// A tool invocation by the assistant. `text` holds the tool name for
        /// fallback display; rich card rendering uses `toolName` + `toolInputJSON`.
        case toolUse
        /// A tool's result coming back from the CLI. v1 doesn't link it to its
        /// originating tool_use — independent card.
        case toolResult
    }
    let id: UUID
    let role: Role
    var text: String
    var runId: String?

    /// For `.toolUse` rows: tool name (Bash, Edit, Read, TodoWrite, ...).
    /// nil for non-tool rows.
    var toolName: String?
    /// For `.toolUse` rows: serialized JSON of the tool's input dict. Card
    /// views decode this into typed structs at render time. Optional because
    /// historical sessions loaded from jsonl may not have it preserved.
    var toolInputJSON: String?
    /// For `.toolUse` rows: the tool_use block id, used to match with a
    /// later tool_result if we ever want that. v1 doesn't use it.
    var toolUseId: String?

    init(
        role: Role,
        text: String,
        runId: String? = nil,
        toolName: String? = nil,
        toolInputJSON: String? = nil,
        toolUseId: String? = nil
    ) {
        self.id = UUID()
        self.role = role
        self.text = text
        self.runId = runId
        self.toolName = toolName
        self.toolInputJSON = toolInputJSON
        self.toolUseId = toolUseId
    }

    /// What TTS should read aloud for this line. `nil` = skip (don't speak
    /// tool calls / system / error rows). Used by the TTS hook in App.
    var spokenText: String? {
        switch role {
        case .assistant: return text.isEmpty ? nil : text
        case .user, .system, .error, .toolUse, .toolResult: return nil
        }
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
