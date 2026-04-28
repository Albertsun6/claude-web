// Facade over WebSocketClient + ConversationStore + RunRouter. UI binds
// to this single object; under the hood each WS message is decoded by
// the transport, routed via RunRouter to a conversation, and then mutated
// into ConversationStore by the handler dispatch in `handle(_:)`.
//
// Why three pieces instead of one:
// - WebSocketClient is the only thing that knows about URLSession and
//   reconnect logic. Easy to swap or test against a mock transport.
// - ConversationStore is pure state, no networking. Receive-side mutators
//   are public so this facade can dispatch ServerMessage cases by name.
// - RunRouter is just a runId→conversationId map; isolating it makes the
//   "every msg routes; sessionEnded releases" invariant easier to audit.
//
// Public API surface here is what ContentView / ProjectRegistry /
// ClaudeWebApp call. Forwarding properties (state, currentMessages,
// conversations, etc.) preserve @Observable tracking through the
// underlying @Observable subobjects.

import Foundation
import Observation

@MainActor
@Observable
final class BackendClient {
    private let webSocket: WebSocketClient
    private let store: ConversationStore
    private let router: RunRouter

    private weak var telemetry: Telemetry?

    init(backendBase: URL, authToken: @escaping () -> String = { "" }) {
        let ws = WebSocketClient(backendBase: backendBase, authToken: authToken)
        self.webSocket = ws
        self.store = ConversationStore()
        self.router = RunRouter()

        // Wire transport → router+store. Capturing self weakly avoids a
        // retain cycle between BackendClient and WebSocketClient.
        ws.onMessage = { [weak self] msg in
            self?.handle(msg)
        }
    }

    func bindTelemetry(_ tel: Telemetry) {
        self.telemetry = tel
        webSocket.bindTelemetry(tel)
        store.bindTelemetry(tel)
    }

    // MARK: - Forwarded transport API

    var state: ConnState {
        webSocket.state
    }

    var backendBase: URL {
        get { webSocket.backendBase }
        set { webSocket.backendBase = newValue }
    }

    func connect() { webSocket.connect() }
    func disconnect() { webSocket.disconnect() }
    func reconnect() { webSocket.reconnect() }

    // MARK: - Forwarded store API

    var conversations: [String: Conversation] {
        store.conversations
    }

    var stateByConversation: [String: ConversationChatState] {
        store.stateByConversation
    }

    var currentConversationId: String? {
        get { store.currentConversationId }
        set { store.currentConversationId = newValue }
    }

    var currentMessages: [ChatLine] { store.currentMessages }
    var currentBusy: Bool { store.currentBusy }
    var currentPendingPermission: PermissionRequest? { store.currentPendingPermission }
    var activeRunCount: Int { store.activeRunCount }

    var onConversationDirty: ((String) -> Void)? {
        get { store.onConversationDirty }
        set { store.onConversationDirty = newValue }
    }

    var onTurnComplete: (() -> Void)? {
        get { store.onTurnComplete }
        set { store.onTurnComplete = newValue }
    }

    @discardableResult
    func createConversation(cwd: String, title: String? = nil) -> Conversation {
        store.createConversation(cwd: cwd, title: title)
    }

    func adopt(_ conversation: Conversation, messages: [ChatLine] = []) {
        store.adopt(conversation, messages: messages)
    }

    func conversationsList() -> [Conversation] {
        store.conversationsList()
    }

    func sortedConversations() -> [Conversation] {
        store.sortedConversations()
    }

    func peekNextAutoName(forCwd cwd: String) -> String {
        store.peekNextAutoName(forCwd: cwd)
    }

    /// Drop a conversation. Sends an interrupt for any in-flight run, then
    /// releases the runId from the router and clears the state. Caller is
    /// responsible for picking a new focus if `id == currentConversationId`.
    func closeConversation(_ id: String) {
        let runs = store.closeConversation(id)
        for runId in runs {
            Task { [weak self] in try? await self?.webSocket.send(.interrupt(runId: runId)) }
            router.release(runId: runId)
        }
        // Defensive: drop any remaining router entries pointing here in case
        // multiple runs were ever in flight for the same conversation.
        router.releaseAll(forConversation: id)
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
        guard webSocket.isOpen else {
            telemetry?.warn("prompt.send.not_connected", conversationId: conversationId)
            store.appendError(toConversation: conversationId, "未连接后端，发送失败")
            return
        }
        guard store.conversations[conversationId] != nil else {
            // Caller bug: prompt for conversation we don't track. Defensive log.
            telemetry?.error("prompt.send.unknown_conversation", conversationId: conversationId)
            store.appendError(toConversation: conversationId, "对话不存在: \(conversationId)")
            return
        }

        let runId = UUID().uuidString
        router.bind(runId: runId, to: conversationId)

        // We just verified the conversation exists, so startTurn cannot fail.
        guard let started = store.startTurn(convId: conversationId, runId: runId, prompt: prompt) else {
            router.release(runId: runId)
            return
        }

        let msg = ClientMessage.userPrompt(
            runId: runId,
            prompt: prompt,
            cwd: started.cwd,
            model: model,
            permissionMode: permissionMode,
            resumeSessionId: started.resumeSessionId
        )
        telemetry?.log(
            "prompt.send",
            props: [
                "model": model,
                "mode": permissionMode,
                "promptLen": String(prompt.count),
                "resume": started.resumeSessionId == nil ? "no" : "yes",
            ],
            conversationId: conversationId, runId: runId
        )
        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.webSocket.send(msg)
            } catch {
                self.telemetry?.error("prompt.send.failed", error: error, conversationId: conversationId, runId: runId)
                self.store.handleSendFailure(convId: conversationId, runId: runId, errorDescription: error.localizedDescription)
                self.router.release(runId: runId)
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
        if let existing = store.currentConversationId, store.conversations[existing] != nil {
            id = existing
        } else {
            id = store.createConversation(cwd: defaultCwdForNew).id
            store.currentConversationId = id
        }
        sendPrompt(prompt, conversationId: id, model: model, permissionMode: permissionMode)
    }

    /// Interrupt the run in the currently-focused conversation. Other
    /// conversations' runs keep going.
    func interrupt() {
        guard let convId = store.currentConversationId,
              let runId = store.stateByConversation[convId]?.currentRunId else { return }
        Task { [weak self] in try? await self?.webSocket.send(.interrupt(runId: runId)) }
    }

    func replyPermission(_ request: PermissionRequest, decision: PermissionDecision) {
        Task { [weak self] in
            try? await self?.webSocket.send(.permissionReply(
                requestId: request.requestId,
                decision: decision.rawValue,
                runId: request.runId
            ))
        }
        if let convId = router.resolve(runId: request.runId) {
            store.clearPendingPermission(convId: convId, requestId: request.requestId)
        }
    }

    // MARK: - Receive routing

    private func handle(_ msg: ServerMessage) {
        // Resolve which conversation this message belongs to. Messages whose
        // runId we don't know — orphan reconnect frames, conversations the
        // user already closed, global errors — silently drop. They must NOT
        // bleed into currentConversationId by default.
        guard let runId = msg.runId else {
            telemetry?.warn("route.no_runid", props: ["msgType": msg.typeName])
            return
        }
        guard let convId = router.resolve(runId: runId) else {
            telemetry?.warn("route.orphan_runid", props: ["runId": runId, "msgType": msg.typeName])
            return
        }
        guard store.stateByConversation[convId] != nil else {
            // Conversation entry is gone (closed mid-flight). Drop the runId
            // mapping defensively so the table doesn't leak.
            telemetry?.warn("route.conversation_missing", props: ["runId": runId, "convId": convId], conversationId: convId)
            router.release(runId: runId)
            return
        }

        switch msg {
        case .sdkMessage(_, let sdk):
            switch sdk {
            case .systemInit(let sessionId, _):
                store.handleSystemInit(convId: convId, runId: runId, sessionId: sessionId)
            case .assistantContent(let text, let toolUses):
                store.handleAssistantContent(convId: convId, runId: runId, text: text, toolUses: toolUses)
            case .toolResult, .other, .result:
                break
            }
        case .sessionEnded(_, let reason):
            // Clean the runId mapping on EVERY end reason (completed / error /
            // interrupted). Otherwise the table grows unbounded and routing
            // could mis-attribute future runs that happen to recycle the id.
            _ = store.handleSessionEnded(convId: convId, runId: runId, reason: reason)
            router.release(runId: runId)
        case .error(_, let message):
            store.handleError(convId: convId, runId: runId, message: message)
            // Even on error, drop the run-id mapping to prevent leak.
            router.release(runId: runId)
        case .clearRunMessages:
            store.handleClearRunMessages(convId: convId, runId: runId)
        case .permissionRequest(_, let requestId, let toolName, let input):
            store.handlePermissionRequest(
                convId: convId,
                runId: runId,
                requestId: requestId,
                toolName: toolName,
                input: input
            )
        case .unknown:
            return
        }
    }
}
