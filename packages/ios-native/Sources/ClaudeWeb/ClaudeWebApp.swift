// App entry point. Wires Settings + BackendClient into the SwiftUI environment.

import SwiftUI

@main
struct ClaudeWebApp: App {
    @State private var settings = AppSettings()
    @State private var client: BackendClient

    init() {
        let s = AppSettings()
        _settings = State(initialValue: s)
        _client = State(initialValue: BackendClient(backendBase: s.backendURL))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(settings)
                .environment(client)
                .onAppear {
                    client.connect()
                }
                .onChange(of: settings.backendURL) { _, newURL in
                    client.backendBase = newURL
                }
        }
    }
}
