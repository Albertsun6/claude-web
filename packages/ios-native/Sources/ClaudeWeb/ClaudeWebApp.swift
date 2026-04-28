// App entry point. Wires Settings + BackendClient into the SwiftUI environment.

import SwiftUI

@main
struct ClaudeWebApp: App {
    @State private var settings = AppSettings()
    @State private var client: BackendClient
    @State private var recorder: VoiceRecorder
    @State private var tts: TTSPlayer
    @State private var voice: VoiceSession

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
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(settings)
                .environment(client)
                .environment(recorder)
                .environment(tts)
                .environment(voice)
                .onAppear {
                    client.connect()
                    // CRITICAL ORDER: bind() must run BEFORE keepalive apply,
                    // because applySilentKeepaliveChange reads settings via
                    // the weak ref bind() injects. Calling apply first would
                    // see settings == nil and silently no-op the saved
                    // "after-restart auto-keepalive" expectation.
                    let ttsRef = tts
                    let clientRef = client
                    let voiceRef = voice
                    client.onTurnComplete = { [weak ttsRef, weak clientRef, weak voiceRef] in
                        guard let tts = ttsRef, let c = clientRef else { return }
                        guard let lastAssistant = c.messages.last(where: { $0.role == .assistant })?.text else { return }
                        Task { @MainActor in
                            try? await Task.sleep(nanoseconds: 200_000_000)
                            await tts.speakAssistantTurn(lastAssistant)
                            voiceRef?.refresh()
                        }
                    }
                    voice.bind(
                        recorder: recorder,
                        tts: tts,
                        client: client,
                        settings: settings,
                        sendPrompt: { [weak clientRef] text in
                            clientRef?.sendPrompt(text, cwd: settings.cwd, model: settings.model, permissionMode: settings.permissionMode)
                        }
                    )
                    // Now safe — settings is bound, applySilentKeepaliveChange
                    // can see the persisted flag.
                    voice.applySilentKeepaliveChange()
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
                .onChange(of: client.busy) { _, _ in voice.refresh() }
                // silentKeepalive toggle takes effect immediately — start
                // or stop the silent loop without exiting voice mode.
                .onChange(of: settings.silentKeepalive) { _, _ in
                    voice.applySilentKeepaliveChange()
                }
        }
    }
}
