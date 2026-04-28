// Persisted user-tweakable knobs. Backend URL is the only one for v1; M5 will
// add: project list, default cwd, TTS toggle, etc.

import Foundation
import Observation

@MainActor
@Observable
final class AppSettings {
    private static let backendKey = "com.albertsun6.claudeweb-native.backendURL"
    private static let cwdKey = "com.albertsun6.claudeweb-native.cwd"
    private static let permissionModeKey = "com.albertsun6.claudeweb-native.permissionMode"

    var backendURL: URL {
        didSet {
            UserDefaults.standard.set(backendURL.absoluteString, forKey: Self.backendKey)
        }
    }

    var cwd: String {
        didSet { UserDefaults.standard.set(cwd, forKey: Self.cwdKey) }
    }

    /// "plan" (read-only, no tool execution — safe default for mobile),
    /// "default" (asks per tool — uses the permission_request modal),
    /// "acceptEdits" (auto-allow file edits, still asks for Bash).
    var permissionMode: String {
        didSet { UserDefaults.standard.set(permissionMode, forKey: Self.permissionModeKey) }
    }

    init() {
        // Default: simulator → http://localhost:3030; device → Tailscale URL.
        // We'll prompt the user to pick at first launch in the settings page.
        let saved = UserDefaults.standard.string(forKey: Self.backendKey)
        let defaultURL = Self.detectDefaultBackend()
        self.backendURL = (saved.flatMap(URL.init(string:))) ?? defaultURL
        self.cwd = UserDefaults.standard.string(forKey: Self.cwdKey)
            ?? "/Users/yongqian/Desktop"
        self.permissionMode = UserDefaults.standard.string(forKey: Self.permissionModeKey)
            ?? "plan"
    }

    private static func detectDefaultBackend() -> URL {
        #if targetEnvironment(simulator)
        return URL(string: "http://localhost:3030")!
        #else
        return URL(string: "https://mymac.tailcf3ccf.ts.net")!
        #endif
    }
}
