// In-memory conversation state. Owns the registry, the runtime per-
// conversation chat state, and the currently-focused conversation. Pure
// state — networking lives in WebSocketClient, runId routing in RunRouter,
// and orchestration in the BackendClient facade.

import Foundation
import Observation

@MainActor
@Observable
final class ConversationStore {
    /// Conversation metadata keyed by conversation id (client-side UUID).
    /// `sessionId` starts nil for new conversations, gets bound on first
    /// `system:init` arrival, persists for `--resume` on subsequent prompts.
    var conversations: [String: Conversation] = [:]

    /// Runtime state per conversation. Created lazily on first prompt /
    /// explicit `createConversation`, removed when user closes the conversation.
    var stateByConversation: [String: ConversationChatState] = [:]

    /// UI focus. UI binds computed views below to this.
    var currentConversationId: String? {
        didSet {
            if oldValue != currentConversationId {
                focusGeneration += 1
            }
        }
    }

    /// Monotonic token for "the user has stayed on the same conversation".
    /// TTS captures it at completion time and checks it before speaking, so a
    /// quick switch away and back doesn't accidentally start stale audio.
    private(set) var focusGeneration: Int = 0

    /// Conversations currently in "follow" mode — receiving live jsonl
    /// updates from a Claude Code session running in another client. Keyed
    /// by Conversation.id; value records the session being tailed and the
    /// last byte offset emitted (so a reconnect can resume cleanly).
    var followingByConversation: [String: FollowState] = [:]

    struct FollowState: Equatable {
        let cwd: String
        let sessionId: String
        var byteOffset: Int
    }

    /// Per-run "auto-allow" tools — cleared when run ends. Maps runId → Set of
    /// toolNames that have been marked "always allow this turn".
    private var allowedToolsByRun: [String: Set<String>] = [:]

    /// Per-cwd auto-increment counter used to label new conversations like
    /// "claude-web 1", "claude-web 2". In-memory only (resets on app launch);
    /// F1c3 will persist with conversation metadata in the cache file.
    private var conversationCounterByCwd: [String: Int] = [:]

    /// Fires whenever a conversation's persistent state (sessionId binding,
    /// messages array, etc) becomes "dirty" — caller should re-snapshot to
    /// the on-disk Cache. Triggered immediately on systemInit (sessionId
    /// binding) so a crash before session_ended doesn't lose the binding.
    var onConversationDirty: ((String) -> Void)?

    /// Structured context for a completed turn. The App uses this for TTS so
    /// it never has to re-read "current" conversation state after async delay.
    struct CompletedTurn {
        enum Source {
            case liveRun(runId: String)
            case followedSession(sessionId: String)
        }

        let conversationId: String
        let source: Source
        let spokenText: String
        let focusGeneration: Int

        var runId: String? {
            if case .liveRun(let runId) = source { return runId }
            return nil
        }

        var sessionId: String? {
            if case .followedSession(let sessionId) = source { return sessionId }
            return nil
        }
    }

    /// Invoked once per completed turn, for both runs launched by Seaidea and
    /// followed external jsonl sessions, but ONLY when the finishing turn
    /// belongs to the currently-focused conversation. App wires this to TTS.
    var onCompletedTurn: ((CompletedTurn) -> Void)?

    private weak var telemetry: Telemetry?

    func bindTelemetry(_ tel: Telemetry) {
        self.telemetry = tel
    }

    // MARK: - Computed views (UI binds these via the BackendClient facade)

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

    // MARK: - Follow mode

    /// Mark a conversation as "following" a Claude Code session. The
    /// caller is responsible for actually wiring the WS subscription (in
    /// BackendClient) — this just records the metadata so the receive
    /// pump knows where to route incoming `session_event` frames.
    func startFollowing(convId: String, cwd: String, sessionId: String, byteOffset: Int) {
        let normCwd = (cwd as NSString).standardizingPath
        followingByConversation[convId] = FollowState(
            cwd: normCwd, sessionId: sessionId, byteOffset: byteOffset
        )
    }

    func followedConversation(cwd: String, sessionId: String) -> String? {
        let normCwd = (cwd as NSString).standardizingPath
        return followingByConversation.first { _, state in
            state.cwd == normCwd && state.sessionId == sessionId
        }?.key
    }

    /// Stop following. No-op if not currently following.
    func stopFollowing(convId: String) {
        followingByConversation.removeValue(forKey: convId)
    }

    /// Bump the recorded byte offset after emitting a session_event entry,
    /// so a reconnect can resume from the same place.
    func updateFollowOffset(convId: String, byteOffset: Int) {
        guard var st = followingByConversation[convId] else { return }
        st.byteOffset = byteOffset
        followingByConversation[convId] = st
    }

    /// Append a single ChatLine to a conversation's transcript. Used by the
    /// session-event pump (each jsonl entry parses to 0..N ChatLines).
    func appendChatLine(convId: String, line: ChatLine) {
        var s = stateByConversation[convId] ?? ConversationChatState()
        s.messages.append(line)
        stateByConversation[convId] = s
        // Bump lastUsed so the drawer surfaces "actively-followed" sessions.
        if var conv = conversations[convId] {
            conv.lastUsed = Date()
            conversations[convId] = conv
        }
    }

    /// A followed external Claude Code session emitted a jsonl `result` row.
    /// Treat that as the same semantic boundary as `session_ended` for runs we
    /// launched ourselves, so TTS/telemetry can share one event model.
    func handleFollowedSessionCompleted(convId: String, sessionId: String) -> Bool {
        guard let s = stateByConversation[convId] else { return false }
        onConversationDirty?(convId)
        guard convId == currentConversationId else { return false }
        if let spoken = s.messages.reversed().compactMap(\.spokenText).first {
            let turn = CompletedTurn(
                conversationId: convId,
                source: .followedSession(sessionId: sessionId),
                spokenText: spoken,
                focusGeneration: focusGeneration
            )
            telemetry?.log(
                "turn.completed.followed_session",
                props: ["sessionId": sessionId, "textLen": String(spoken.count)],
                conversationId: convId
            )
            onCompletedTurn?(turn)
            return true
        }
        return false
    }

    /// Rename an existing conversation. No-op if the id is unknown or the
    /// new title is empty after trimming. Fires onConversationDirty so the
    /// rename survives a relaunch without waiting for the next session_ended.
    func renameConversation(_ id: String, to newTitle: String) {
        guard var conv = conversations[id] else { return }
        let trimmed = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        conv.title = trimmed
        conversations[id] = conv
        onConversationDirty?(id)
    }

    /// Drop a conversation from memory. Returns the runIds the caller should
    /// interrupt + release through RunRouter so the WS doesn't keep firing
    /// messages routed to a dead key. Does NOT touch the on-disk jsonl.
    @discardableResult
    func closeConversation(_ id: String) -> [String] {
        var runs: [String] = []
        if let s = stateByConversation[id], let runId = s.currentRunId {
            runs.append(runId)
        }
        conversations.removeValue(forKey: id)
        stateByConversation.removeValue(forKey: id)
        followingByConversation.removeValue(forKey: id)
        return runs
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

    // MARK: - Send-side mutations

    struct StartedTurn {
        let cwd: String
        let resumeSessionId: String?
    }

    /// Mark a new turn as in-flight: sets busy / currentRunId, appends the
    /// user message, rewrites the title if it's still auto-named, bumps
    /// lastUsed. Returns the cwd + resumeSessionId the caller needs to
    /// build the ClientMessage. Returns nil if the conversation isn't tracked.
    func startTurn(convId: String, runId: String, prompt: String) -> StartedTurn? {
        guard var conversation = conversations[convId] else { return nil }
        let cwd = conversation.cwd

        var s = stateByConversation[convId] ?? ConversationChatState()
        s.currentRunId = runId
        s.busy = true
        s.messages.append(ChatLine(role: .user, text: prompt, runId: runId))
        stateByConversation[convId] = s

        // Auto-derive title from first user message ONLY if the title is
        // still the auto-generated "<basename> <n>" placeholder. If the user
        // gave it a custom name at creation, leave it alone. Goes through
        // TitleHelper so hook-injected XML blocks don't bleed into the title.
        if Self.isAutoNamedTitle(conversation.title, cwd: conversation.cwd) {
            let derived = TitleHelper.makeTitle(from: prompt)
            if !derived.isEmpty {
                conversation.title = derived
            }
        }
        conversation.lastUsed = Date()
        conversations[convId] = conversation
        return StartedTurn(cwd: cwd, resumeSessionId: conversation.sessionId)
    }

    /// Reset busy/currentRunId after a send failure and surface the error
    /// to the user. Caller is responsible for releasing the runId from
    /// the router.
    func handleSendFailure(convId: String, runId: String, errorDescription: String) {
        guard var failed = stateByConversation[convId] else { return }
        failed.messages.append(ChatLine(role: .error, text: "发送失败: \(errorDescription)"))
        if failed.currentRunId == runId {
            failed.busy = false
            failed.currentRunId = nil
        }
        stateByConversation[convId] = failed
    }

    /// Clear pendingPermission after the user replies. No-op if it's already
    /// been replaced by a different request.
    func clearPendingPermission(convId: String, requestId: String) {
        guard var s = stateByConversation[convId] else { return }
        if s.pendingPermission?.requestId == requestId {
            s.pendingPermission = nil
            stateByConversation[convId] = s
        }
    }

    /// Append an error row without otherwise touching state. Used for the
    /// sendPrompt "WS not connected" / "unknown conversation" early-return.
    func appendError(toConversation convId: String, _ text: String) {
        var s = stateByConversation[convId] ?? ConversationChatState()
        s.messages.append(ChatLine(role: .error, text: text))
        stateByConversation[convId] = s
    }

    // MARK: - Receive-side mutations (called by BackendClient.handle after route)

    func handleSystemInit(convId: String, runId: String, sessionId: String?) {
        // Bind sessionId to the conversation as soon as it arrives so later
        // prompts can `--resume` it. Persist the binding to cache IMMEDIATELY
        // — if the app dies before session_ended we'd otherwise lose the link
        // between this conversation and the jsonl file the CLI is writing.
        guard let sessionId, var conv = conversations[convId] else { return }
        conv.sessionId = sessionId
        conv.lastUsed = Date()
        conversations[convId] = conv
        telemetry?.log("session.bound", props: ["sessionId": sessionId], conversationId: convId, runId: runId)
        onConversationDirty?(convId)
    }

    func handleAssistantContent(
        convId: String,
        runId: String,
        text: String?,
        toolUses: [ToolUseInfo]
    ) {
        guard var s = stateByConversation[convId] else { return }
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
        stateByConversation[convId] = s
    }

    /// Returns true iff the caller fired `onCompletedTurn` (i.e. the finishing
    /// run belongs to the currently-focused conversation, has speakable text,
    /// and the reason is "completed"). Caller is also responsible for releasing
    /// the runId from RunRouter — store no longer touches it on this path.
    func handleSessionEnded(convId: String, runId: String, reason: String) -> Bool {
        guard var s = stateByConversation[convId] else { return false }
        s.busy = false
        s.currentRunId = nil
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
            // Capture the exact text for this completed run now. The App may
            // delay TTS briefly; reading `currentMessages` later can point at a
            // different conversation after a user switch.
            if let spoken = s.messages.reversed().compactMap({ line -> String? in
                guard line.runId == runId else { return nil }
                return line.spokenText
            }).first {
                let turn = CompletedTurn(
                    conversationId: convId,
                    source: .liveRun(runId: runId),
                    spokenText: spoken,
                    focusGeneration: focusGeneration
                )
                telemetry?.log(
                    "turn.completed.live_run",
                    props: ["textLen": String(spoken.count)],
                    conversationId: convId,
                    runId: runId
                )
                onCompletedTurn?(turn)
                return true
            }
        }
        return false
    }

    func handleError(convId: String, runId: String, message: String) {
        guard var s = stateByConversation[convId] else { return }
        s.messages.append(ChatLine(role: .error, text: message, runId: runId))
        s.busy = false
        stateByConversation[convId] = s
        telemetry?.error("server.error", props: ["message": message], conversationId: convId, runId: runId)
    }

    func handleClearRunMessages(convId: String, runId: String) {
        guard var s = stateByConversation[convId] else { return }
        s.messages.removeAll { $0.runId == runId }
        stateByConversation[convId] = s
    }

    func handlePermissionRequest(
        convId: String,
        runId: String,
        requestId: String,
        toolName: String,
        input: [String: Any]
    ) {
        guard var s = stateByConversation[convId] else { return }
        // Permission requests live on the conversation, not the client.
        // If user has switched away, the sheet won't pop on a different
        // conversation — they'll see it when they switch back.
        s.pendingPermission = PermissionRequest(
            runId: runId, requestId: requestId, toolName: toolName, input: input
        )
        stateByConversation[convId] = s
        telemetry?.log(
            "permission.request",
            props: ["tool": toolName, "requestId": requestId],
            conversationId: convId, runId: runId
        )
    }

    // MARK: - Permission management

    func allowToolForRun(_ runId: String, _ toolName: String) {
        var set = allowedToolsByRun[runId] ?? Set()
        set.insert(toolName)
        allowedToolsByRun[runId] = set
    }

    func isToolAllowedForRun(_ runId: String, _ toolName: String) -> Bool {
        return allowedToolsByRun[runId]?.contains(toolName) ?? false
    }

    func forgetRunAllowlist(_ runId: String) {
        allowedToolsByRun.removeValue(forKey: runId)
    }

    // MARK: - Internals

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

    /// Title was auto-generated by `createConversation` and not edited by the
    /// user. Used to decide whether the first prompt should rewrite it.
    private static func isAutoNamedTitle(_ title: String, cwd: String) -> Bool {
        let base = (cwd as NSString).lastPathComponent
        let prefix = "\(base) "
        guard title.hasPrefix(prefix) else { return false }
        let suffix = title.dropFirst(prefix.count)
        return !suffix.isEmpty && suffix.allSatisfy(\.isNumber)
    }
}
