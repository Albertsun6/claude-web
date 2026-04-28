// App entry point. Wires Settings + BackendClient + Cache + ProjectRegistry +
// HTTP API clients into the SwiftUI environment, runs the bootstrap sequence
// on launch (cache → reconcile with server), and hooks onConversationDirty
// so every state-changing event flushes to disk.

import SwiftUI

@main
struct ClaudeWebApp: App {
    @State private var settings = AppSettings()
    @State private var client: BackendClient
    @State private var recorder: VoiceRecorder
    @State private var tts: TTSPlayer
    @State private var voice: VoiceSession
    @State private var cache: Cache
    @State private var projectsAPI: ProjectsAPI
    @State private var sessionsAPI: SessionsAPI
    @State private var registry: ProjectRegistry
    @State private var telemetry: Telemetry

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
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(settings)
                .environment(client)
                .environment(recorder)
                .environment(tts)
                .environment(voice)
                .environment(registry)
                .environment(telemetry)
                .onAppear {
                    bootstrap()
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
        telemetry.log("app.launch")
        cache.bindTelemetry(telemetry)
        registry.bindTelemetry(telemetry)
        registry.bind(client: client)
        client.bindTelemetry(telemetry)

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
        client.onTurnComplete = { [weak ttsRef, weak clientRef, weak voiceRef] in
            guard let tts = ttsRef, let c = clientRef else { return }
            let convId = c.currentConversationId
            // Walk messages back to find the last *spoken* line — usually
            // the trailing assistant text, but skip past any tool_use rows
            // that came after (where the answer ends with "I'll do X")
            // because those don't carry text the user wants read aloud.
            let spoken = c.currentMessages.reversed().compactMap { $0.spokenText }.first
            guard let text = spoken else { return }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 200_000_000)
                await tts.speakAssistantTurn(text, conversationId: convId)
                voiceRef?.refresh()
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

        client.connect()

        // Bootstrap is async — fires in background, UI is already showing the
        // cache snapshot loaded synchronously by registry.bootstrap.
        Task { @MainActor in
            await registry.bootstrap()
            // Restore last focus AFTER cache replay seeded BackendClient.
            if let savedId = settings.currentConversationId,
               client.conversations[savedId] != nil {
                client.currentConversationId = savedId
            }
        }
    }
}
