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
    private static let ttsEnabledKey = "com.albertsun6.claudeweb-native.ttsEnabled"
    private static let speakStyleKey = "com.albertsun6.claudeweb-native.speakStyle"
    private static let slowTtsKey = "com.albertsun6.claudeweb-native.slowTts"

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

    /// Auto-speak Claude's response when a turn ends.
    var ttsEnabled: Bool {
        didSet { UserDefaults.standard.set(ttsEnabled, forKey: Self.ttsEnabledKey) }
    }

    /// "summary" (Haiku rewrites into 1-4 spoken sentences) or "verbatim".
    var speakStyle: String {
        didSet { UserDefaults.standard.set(speakStyle, forKey: Self.speakStyleKey) }
    }

    /// Slows TTS by 15% — easier to follow on the go.
    var slowTts: Bool {
        didSet { UserDefaults.standard.set(slowTts, forKey: Self.slowTtsKey) }
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
        self.ttsEnabled = UserDefaults.standard.object(forKey: Self.ttsEnabledKey) as? Bool ?? true
        self.speakStyle = UserDefaults.standard.string(forKey: Self.speakStyleKey) ?? "summary"
        self.slowTts = UserDefaults.standard.bool(forKey: Self.slowTtsKey)
    }

    private static func detectDefaultBackend() -> URL {
        #if targetEnvironment(simulator)
        return URL(string: "http://localhost:3030")!
        #else
        return URL(string: "https://mymac.tailcf3ccf.ts.net")!
        #endif
    }
}
