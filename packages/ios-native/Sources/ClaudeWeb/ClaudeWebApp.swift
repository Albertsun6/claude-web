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
        let c = BackendClient(backendBase: s.backendURL)
        _client = State(initialValue: c)
        let backendRef: () -> URL = { [weak c] in c?.backendBase ?? s.backendURL }
        _recorder = State(initialValue: VoiceRecorder(backendURL: backendRef))
        _tts = State(initialValue: TTSPlayer(
            backendURL: backendRef,
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
                    // Hook session_ended → speak last assistant turn. Done here
                    // (not in init) because closures capturing tts can't escape
                    // through a mutating self in App.init.
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
                    // Wire VoiceSession dependencies. sendPrompt closure goes
                    // from voice-mode PTT → backend without touching the textfield.
                    voice.bind(
                        recorder: recorder,
                        tts: tts,
                        client: client,
                        settings: settings,
                        sendPrompt: { [weak clientRef] text in
                            clientRef?.sendPrompt(text, cwd: settings.cwd, permissionMode: settings.permissionMode)
                        }
                    )
                }
                .onChange(of: settings.backendURL) { _, newURL in
                    client.backendBase = newURL
                }
                // Refresh Now Playing whenever any underlying state shifts.
                .onChange(of: recorder.state) { _, _ in voice.refresh() }
                .onChange(of: tts.state) { _, _ in voice.refresh() }
                .onChange(of: client.busy) { _, _ in voice.refresh() }
        }
    }
}
