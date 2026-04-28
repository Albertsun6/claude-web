// App entry point. Wires Settings + BackendClient into the SwiftUI environment.

import SwiftUI

@main
struct ClaudeWebApp: App {
    @State private var settings = AppSettings()
    @State private var client: BackendClient
    @State private var recorder: VoiceRecorder

    init() {
        let s = AppSettings()
        _settings = State(initialValue: s)
        let c = BackendClient(backendBase: s.backendURL)
        _client = State(initialValue: c)
        // Recorder reads backend URL via closure so it always sees the latest
        // even after the user changes it in Settings.
        let backendRef: () -> URL = { [weak c] in c?.backendBase ?? s.backendURL }
        _recorder = State(initialValue: VoiceRecorder(backendURL: backendRef))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(settings)
                .environment(client)
                .environment(recorder)
                .onAppear {
                    client.connect()
                }
                .onChange(of: settings.backendURL) { _, newURL in
                    client.backendBase = newURL
                }
        }
    }
}
