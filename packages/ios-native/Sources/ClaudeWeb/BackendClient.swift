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
        ws.onConnected = { [weak self] in
            self?.resubscribeFollowedSessions()
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

    var focusGeneration: Int { store.focusGeneration }

    var onCompletedTurn: ((ConversationStore.CompletedTurn) -> Void)? {
        get { store.onCompletedTurn }
        set { store.onCompletedTurn = newValue }
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

    func renameConversation(_ id: String, to newTitle: String) {
        store.renameConversation(id, to: newTitle)
    }

    // MARK: - Follow mode (live jsonl tail of an external Claude Code session)

    var followingByConversation: [String: ConversationStore.FollowState] {
        store.followingByConversation
    }

    /// True iff `convId` is currently following an external session.
    func isFollowing(_ convId: String?) -> Bool {
        guard let convId else { return false }
        return store.followingByConversation[convId] != nil
    }

    /// Start tailing the jsonl for `(cwd, sessionId)` and routing each new
    /// entry into `convId`. `fromByteOffset` should be the file size at the
    /// moment the caller fetched the historical transcript, so the stream
    /// picks up right after that snapshot.
    func subscribeSession(convId: String, cwd: String, sessionId: String, fromByteOffset: Int) {
        store.startFollowing(convId: convId, cwd: cwd, sessionId: sessionId, byteOffset: fromByteOffset)
        Task { [weak self] in
            try? await self?.webSocket.send(
                .sessionSubscribe(cwd: cwd, sessionId: sessionId, fromByteOffset: fromByteOffset)
            )
        }
        telemetry?.log("session.follow.start",
                       props: ["sessionId": sessionId, "offset": String(fromByteOffset)],
                       conversationId: convId)
    }

    private func resubscribeFollowedSessions() {
        let follows = store.followingByConversation
        guard !follows.isEmpty else { return }
        telemetry?.log("session.follow.resubscribe", props: ["count": String(follows.count)])
        for (convId, st) in follows {
            Task { [weak self] in
                try? await self?.webSocket.send(
                    .sessionSubscribe(cwd: st.cwd, sessionId: st.sessionId, fromByteOffset: st.byteOffset)
                )
            }
            telemetry?.log(
                "session.follow.resubscribe.one",
                props: ["sessionId": st.sessionId, "offset": String(st.byteOffset)],
                conversationId: convId
            )
        }
    }

    /// Stop tailing. Idempotent — no-op if not currently following.
    func unsubscribeSession(convId: String) {
        guard let st = store.followingByConversation[convId] else { return }
        store.stopFollowing(convId: convId)
        Task { [weak self] in
            try? await self?.webSocket.send(
                .sessionUnsubscribe(cwd: st.cwd, sessionId: st.sessionId)
            )
        }
        telemetry?.log("session.follow.stop",
                       props: ["sessionId": st.sessionId],
                       conversationId: convId)
    }

    /// Drop a conversation. Sends an interrupt for any in-flight run, then
    /// releases the runId from the router and clears the state. Caller is
    /// responsible for picking a new focus if `id == currentConversationId`.
    func closeConversation(_ id: String) {
        // If we're following an external session for this conversation, tell
        // backend to release the watcher subscription. Must run BEFORE
        // store.closeConversation since that clears followingByConversation.
        if let st = store.followingByConversation[id] {
            Task { [weak self] in
                try? await self?.webSocket.send(.sessionUnsubscribe(cwd: st.cwd, sessionId: st.sessionId))
            }
        }
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

        // Auto "take over": if this conversation is currently following an
        // external Claude Code session, drop the subscription before we fire
        // a prompt of our own. Otherwise the CLI's --resume on this sid would
        // race with whatever client is on the other end.
        if isFollowing(conversationId) {
            unsubscribeSession(convId: conversationId)
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
                runId: request.runId,
                toolName: request.toolName
            ))
        }
        if let convId = router.resolve(runId: request.runId) {
            store.clearPendingPermission(convId: convId, requestId: request.requestId)
        }
    }

    func allowToolForRun(_ runId: String, _ toolName: String) {
        store.allowToolForRun(runId, toolName)
    }

    func isToolAllowedForRun(_ runId: String, _ toolName: String) -> Bool {
        store.isToolAllowedForRun(runId, toolName)
    }

    func forgetRunAllowlist(_ runId: String) {
        store.forgetRunAllowlist(runId)
    }

    // MARK: - Receive routing

    private func handle(_ msg: ServerMessage) {
        // session_event has no runId — route by sessionId directly to the
        // followed conversation.
        if case .sessionEvent(let cwd, let sessionId, let byteOffset, let entryJSON) = msg {
            handleSessionEvent(cwd: cwd, sessionId: sessionId, byteOffset: byteOffset, entryJSON: entryJSON)
            return
        }

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
            case .toolResult(let content, let isError):
                store.handleToolResult(convId: convId, runId: runId, content: content, isError: isError)
            case .other, .result:
                break
            }
        case .sessionEnded(_, let reason):
            // Clean the runId mapping on EVERY end reason (completed / error /
            // interrupted). Otherwise the table grows unbounded and routing
            // could mis-attribute future runs that happen to recycle the id.
            _ = store.handleSessionEnded(convId: convId, runId: runId, reason: reason)
            router.release(runId: runId)
            forgetRunAllowlist(runId)
        case .error(_, let message):
            store.handleError(convId: convId, runId: runId, message: message)
            // Even on error, drop the run-id mapping to prevent leak.
            router.release(runId: runId)
        case .clearRunMessages:
            store.handleClearRunMessages(convId: convId, runId: runId)
        case .permissionRequest(_, let requestId, let toolName, let input):
            // Auto-allow if user opted in for this run+tool
            if store.isToolAllowedForRun(runId, toolName) {
                Task { [weak self] in
                    try? await self?.webSocket.send(.permissionReply(
                        requestId: requestId,
                        decision: "allow",
                        runId: runId,
                        toolName: toolName
                    ))
                }
                telemetry?.log(
                    "permission.auto_allow",
                    props: ["tool": toolName, "requestId": requestId],
                    conversationId: convId, runId: runId
                )
                return
            }
            store.handlePermissionRequest(
                convId: convId,
                runId: runId,
                requestId: requestId,
                toolName: toolName,
                input: input
            )
        case .sessionEvent:
            // Already handled at the top of `handle(_:)` — early-return guard
            // means switch never reaches this case in practice. Listed for
            // exhaustiveness.
            return
        case .unknown:
            return
        }
    }

    /// Route an incremental jsonl entry into the conversation that's
    /// currently following this sessionId. The `entryJSON` payload is the
    /// raw JSON of one normalized entry — same shape as items returned by
    /// `/api/sessions/transcript`. Decoded into `TranscriptEntry`, run
    /// through `TranscriptParser`, and any resulting ChatLines are
    /// appended to the conversation's transcript.
    private func handleSessionEvent(cwd: String, sessionId: String, byteOffset: Int, entryJSON: Data) {
        // Find which conversation is following this session. Match against
        // `followingByConversation` (NOT just `conversation.sessionId`) so
        // we don't accidentally inject events into a conversation that's
        // simply a historical load with the same sid but isn't subscribed.
        guard let convId = store.followedConversation(cwd: cwd, sessionId: sessionId),
              let follow = store.followingByConversation[convId] else {
            telemetry?.warn("session_event.no_follower", props: ["cwd": cwd, "sessionId": sessionId])
            return
        }
        guard store.stateByConversation[convId] != nil else {
            telemetry?.warn("session_event.conversation_missing",
                            props: ["sessionId": sessionId], conversationId: convId)
            return
        }
        guard byteOffset > follow.byteOffset else {
            telemetry?.warn(
                "session_event.duplicate_offset",
                props: ["sessionId": sessionId, "offset": String(byteOffset), "current": String(follow.byteOffset)],
                conversationId: convId
            )
            return
        }

        do {
            let entry = try JSONDecoder().decode(TranscriptEntry.self, from: entryJSON)
            let lines = TranscriptParser.parse([entry])
            for line in lines {
                store.appendChatLine(convId: convId, line: line)
            }
            store.updateFollowOffset(convId: convId, byteOffset: byteOffset)
            if entry.type == "result" {
                _ = store.handleFollowedSessionCompleted(convId: convId, sessionId: sessionId)
            }
            // Persist after each event so a force-quit doesn't lose what we
            // mirrored from the external session.
            onConversationDirty?(convId)
        } catch {
            telemetry?.error("session_event.decode_failed", error: error,
                             props: ["sessionId": sessionId], conversationId: convId)
        }
    }
}
