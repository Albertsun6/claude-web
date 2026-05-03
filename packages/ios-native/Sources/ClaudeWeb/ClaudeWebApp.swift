// App entry point. Wires Settings + BackendClient + Cache + ProjectRegistry +
// HTTP API clients into the SwiftUI environment, runs the bootstrap sequence
// on launch (cache → reconcile with server), and hooks onConversationDirty
// so every state-changing event flushes to disk.

import SwiftUI
import AudioToolbox

@main
struct ClaudeWebApp: App {
    @State private var settings = AppSettings()
    @State private var client: BackendClient
    @State private var recorder: VoiceRecorder
    @State private var tts: TTSPlayer
    @State private var voice: VoiceSession
    @State private var notes: NotesSession
    @State private var cache: Cache
    @State private var projectsAPI: ProjectsAPI
    @State private var sessionsAPI: SessionsAPI
    @State private var registry: ProjectRegistry
    @State private var telemetry: Telemetry
    @State private var gitAPI: GitAPI
    @State private var heartbeat: HeartbeatMonitor
    @State private var inboxAPI: InboxAPI
    @State private var worktreeAPI: WorktreeAPI
    @State private var harnessConfigAPI: HarnessConfigAPI
    @State private var harnessStore: HarnessStore

    init() {
        let s = AppSettings()
        _settings = State(initialValue: s)
        let c = BackendClient(backendBase: s.backendURL, authToken: { s.authToken })
        _client = State(initialValue: c)
        let backendRef: () -> URL = { [weak c] in c?.backendBase ?? s.backendURL }
        let tokenRef: () -> String = { s.authToken }
        _recorder = State(initialValue: VoiceRecorder(backendURL: backendRef, authToken: tokenRef))
        _tts = State(initialValue: TTSPlayer(
            backendURL: backendRef,
            authToken: tokenRef,
            settings: { s }
        ))
        _voice = State(initialValue: VoiceSession())
        _notes = State(initialValue: NotesSession(backendURL: backendRef, authToken: tokenRef))

        let cacheInst = Cache()
        _cache = State(initialValue: cacheInst)
        let projAPI = ProjectsAPI(backend: backendRef, token: tokenRef)
        _projectsAPI = State(initialValue: projAPI)
        let sessAPI = SessionsAPI(backend: backendRef, token: tokenRef)
        _sessionsAPI = State(initialValue: sessAPI)
        _registry = State(initialValue: ProjectRegistry(
            cache: cacheInst,
            projectsAPI: projAPI,
            sessionsAPI: sessAPI
        ))
        _telemetry = State(initialValue: Telemetry(backend: backendRef, token: tokenRef))
        _gitAPI = State(initialValue: GitAPI(backend: backendRef, token: tokenRef))
        _heartbeat = State(initialValue: HeartbeatMonitor(baseURL: backendRef))
        _inboxAPI = State(initialValue: InboxAPI(baseURL: backendRef))
        _worktreeAPI = State(initialValue: WorktreeAPI(baseURL: backendRef))
        let harnessAPIInst = HarnessConfigAPI(backend: backendRef, token: tokenRef)
        _harnessConfigAPI = State(initialValue: harnessAPIInst)
        _harnessStore = State(initialValue: HarnessStore(cache: cacheInst, api: harnessAPIInst))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(settings)
                .environment(client)
                .environment(recorder)
                .environment(tts)
                .environment(voice)
                .environment(notes)
                .environment(registry)
                .environment(telemetry)
                .environment(cache)
                .environment(heartbeat)
                .environment(inboxAPI)
                .environment(worktreeAPI)
                .environment(harnessStore)
                .onAppear {
                    bootstrap()
                    Task { @MainActor in heartbeat.start() }
                    Task { @MainActor in await harnessStore.refetch() }
                }
                .onChange(of: client.currentConversationId) { _, newId in
                    // Switching conversations cuts off TTS from the previous
                    // one — otherwise the playback bleeds across conversations
                    // and the user hears A's reply while looking at B.
                    tts.cancel()
                    // Mirror to settings so app restart restores focus.
                    settings.currentConversationId = newId
                }
                .onChange(of: settings.backendURL) { _, newURL in
                    client.backendBase = newURL
                }
                // Token change forces a reconnect so the new ?token= takes effect.
                .onChange(of: settings.authToken) { _, _ in
                    client.reconnect()
                }
                // Refresh Now Playing whenever any underlying state shifts.
                .onChange(of: recorder.state) { _, _ in voice.refresh() }
                .onChange(of: tts.state) { _, _ in voice.refresh() }
                .onChange(of: client.currentBusy) { _, _ in voice.refresh() }
                // silentKeepalive toggle takes effect immediately — start
                // or stop the silent loop without exiting voice mode.
                .onChange(of: settings.silentKeepalive) { _, _ in
                    voice.applySilentKeepaliveChange()
                }
        }
    }

    /// One-shot launch sequence. Order matters:
    ///   1. Bind ProjectRegistry to BackendClient so adopt() can route into it
    ///   2. Hook onConversationDirty → save to Cache (must be set BEFORE
    ///      adopt() runs, otherwise initial cache read won't trigger writes
    ///      but that's fine — they're already cached)
    ///   3. Wire VoiceSession.bind (must precede applySilentKeepaliveChange
    ///      because the latter dereferences settings via bind's weak ref)
    ///   4. Connect WS
    ///   5. Run registry.bootstrap (cache → fetch → reconcile)
    ///   6. Restore currentConversationId from last session
    private func bootstrap() {
        telemetry.log("app.launch", props: [
            "version": BuildInfo.marketingVersion,
            "build": BuildInfo.buildNumber,
            "sha": BuildInfo.gitSha,
            "buildTime": BuildInfo.buildTime,
        ])
        cache.bindTelemetry(telemetry)
        registry.bindTelemetry(telemetry)
        registry.bind(client: client)
        client.bindTelemetry(telemetry)
        tts.bindTelemetry(telemetry)
        notes.bindTelemetry(telemetry)
        harnessStore.bindTelemetry(telemetry)

        // Persist to disk on every dirty signal. Two writes per signal:
        //   sessions/<convId>.json — full ChatLine[] for this conversation
        //   conversations.json     — metadata for ALL conversations
        // The conversations.json write is necessary every time because the
        // dirty conversation might have just received its sessionId binding.
        let cacheRef = cache
        let clientRef = client
        client.onConversationDirty = { [weak clientRef] convId in
            guard let c = clientRef else { return }
            cacheRef.saveSession(convId, messages: c.stateByConversation[convId]?.messages ?? [])
            cacheRef.saveConversations(c.conversationsList())
        }

        let ttsRef = tts
        let voiceRef = voice
        client.onCompletedTurn = { [weak ttsRef, weak clientRef, weak voiceRef] turn in
            guard let tts = ttsRef, let c = clientRef else { return }
            telemetry.log(
                "tts.turn.captured",
                props: [
                    "source": turn.sessionId == nil ? "live_run" : "followed_session",
                    "textLen": String(turn.spokenText.count),
                ],
                conversationId: turn.conversationId,
                runId: turn.runId
            )
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 200_000_000)
                // If the user switched conversations during the small settle
                // delay, do not start reading the old conversation.
                guard c.currentConversationId == turn.conversationId,
                      c.focusGeneration == turn.focusGeneration else {
                    telemetry.warn(
                        "tts.turn.skipped_focus_changed",
                        props: [
                            "capturedGeneration": String(turn.focusGeneration),
                            "currentGeneration": String(c.focusGeneration),
                        ],
                        conversationId: turn.conversationId,
                        runId: turn.runId
                    )
                    return
                }
                await tts.speakAssistantTurn(turn.spokenText, conversationId: turn.conversationId)
                voiceRef?.refresh()
            }
        }

        // H5 git safety gate: after every completed turn, if the cwd is a git
        // repo and dirty, surface a sheet on next focus of that conversation.
        // Toggle in Settings (gitGateEnabled, default ON).
        let settingsRef = settings
        let gitAPIRef = gitAPI
        let telemetryRef = telemetry
        client.onTurnCompleted = { [weak clientRef, weak gitAPIRef, weak telemetryRef] convId, cwd in
            // A2: chime — fires immediately on completion, before TTS kicks in.
            // Sound 1057 ("Tweet") is short and distinctive. Respects silent mode.
            if settingsRef.completionChimeEnabled {
                AudioServicesPlaySystemSound(1057)
            }
            // Stage A: arm worktree finalize sheet if this conversation has a
            // worktree. Independent of git gate — even no dirty changes, user
            // may want to push branch / discard. Sheet is shown AFTER GitGate
            // (ContentView chains them) so user sees status first.
            if let c = clientRef,
               let conv = c.conversations[convId],
               let worktreeId = conv.worktreeId
            {
                c.setPendingWorktreeFinalize(convId: convId, worktreeId: worktreeId)
            }
            guard settingsRef.gitGateEnabled else { return }
            guard let c = clientRef, let api = gitAPIRef else { return }
            Task { @MainActor in
                do {
                    if let report = try await api.getStatus(cwd: cwd), report.isDirty {
                        c.setPendingGitGate(convId: convId, report: report)
                        telemetryRef?.log(
                            "git_gate.armed",
                            props: [
                                "files": String(report.files.count),
                                "branch": report.branch ?? "?",
                            ],
                            conversationId: convId
                        )
                    }
                } catch {
                    telemetryRef?.warn(
                        "git_gate.fetch_failed",
                        props: ["error": error.localizedDescription],
                        conversationId: convId
                    )
                }
            }
        }

        voice.bind(
            recorder: recorder,
            tts: tts,
            client: client,
            settings: settings,
            sendPrompt: { [weak clientRef] text in
                clientRef?.sendPromptCurrent(text, defaultCwdForNew: settings.cwd, model: settings.model, permissionMode: settings.permissionMode)
            }
        )
        voice.applySilentKeepaliveChange()
        if settings.autoEnterVoice { voice.enter() }

        client.connect()

        // Bootstrap is async — fires in background, UI is already showing the
        // cache snapshot loaded synchronously by registry.bootstrap.
        Task { @MainActor in
            await registry.bootstrap()
            // Migrate old title format (e.g. "claude-web 1") to new MMdd-N format.
            migrateConversationTitles()
            // Restore last focus AFTER cache replay seeded BackendClient.
            if let savedId = settings.currentConversationId,
               client.conversations[savedId] != nil {
                client.currentConversationId = savedId
            }
        }
    }

    private func migrateConversationTitles() {
        // Check each conversation: if title is in old format (not MMdd-N), rename it.
        let convIds = Array(client.conversations.keys)
        var needsSave = false
        for convId in convIds {
            guard let conv = client.conversations[convId] else { continue }
            if !ConversationNamer.isAutoGenerated(conv.title) {
                let existingTitles = Array(client.conversations.values.map { $0.title })
                let newTitle = ConversationNamer.title(for: conv.createdAt, existingTitles: existingTitles)
                client.updateConversationTitle(convId, to: newTitle)
                needsSave = true
            }
        }
        if needsSave {
            cache.saveConversations(client.conversationsList())
        }
    }
}
