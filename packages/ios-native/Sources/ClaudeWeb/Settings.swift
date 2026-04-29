// Persisted user-tweakable knobs. Backend URL is the only one for v1; M5 will
// add: project list, default cwd, TTS toggle, etc.

import Foundation
import Observation

struct Project: Identifiable, Codable, Equatable {
    var id: String { cwd }
    var name: String
    var cwd: String
    var lastUsed: Date

    init(name: String, cwd: String, lastUsed: Date = Date()) {
        self.name = name
        self.cwd = cwd
        self.lastUsed = lastUsed
    }
}

@MainActor
@Observable
final class AppSettings {
    private static let backendKey = "com.albertsun6.claudeweb-native.backendURL"
    private static let cwdKey = "com.albertsun6.claudeweb-native.cwd"
    private static let permissionModeKey = "com.albertsun6.claudeweb-native.permissionMode"
    private static let ttsEnabledKey = "com.albertsun6.claudeweb-native.ttsEnabled"
    private static let speakStyleKey = "com.albertsun6.claudeweb-native.speakStyle"
    private static let slowTtsKey = "com.albertsun6.claudeweb-native.slowTts"
    private static let authTokenKey = "com.albertsun6.claudeweb-native.authToken"
    private static let modelKey = "com.albertsun6.claudeweb-native.model"
    private static let silentKeepaliveKey = "com.albertsun6.claudeweb-native.silentKeepalive"
    private static let currentConversationIdKey = "com.albertsun6.claudeweb-native.currentConversationId"
    private static let fontSizeKey = "com.albertsun6.claudeweb-native.fontSize"

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

    /// CLAUDE_WEB_TOKEN. Sent as `?token=` on WS upgrade and as
    /// `Authorization: Bearer <t>` on HTTP. Empty → no auth header.
    var authToken: String {
        didSet { UserDefaults.standard.set(authToken, forKey: Self.authTokenKey) }
    }

    /// Claude model id for new prompts. Persisted but applies only to
    /// FUTURE prompts — in-flight runs keep their original model.
    /// Values: claude-haiku-4-5 / claude-sonnet-4-6 / claude-opus-4-7.
    var model: String {
        didSet { UserDefaults.standard.set(model, forKey: Self.modelKey) }
    }

    /// EXPERIMENTAL — play 0-volume silent audio loop while in voice mode so
    /// iOS keeps Now Playing card visible on lock screen indefinitely. Apple
    /// docs / community forums consider this an "abuse of background audio
    /// mode" and it has been a basis for App Store rejection. Safe for
    /// personal sideload only. Default OFF.
    var silentKeepalive: Bool {
        didSet { UserDefaults.standard.set(silentKeepalive, forKey: Self.silentKeepaliveKey) }
    }

    /// Remembered focus from the previous app session so launching feels
    /// like resuming. Mirrored from BackendClient.currentConversationId on
    /// every change. Optional — first launch has no value.
    var currentConversationId: String? {
        didSet {
            if let id = currentConversationId {
                UserDefaults.standard.set(id, forKey: Self.currentConversationIdKey)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.currentConversationIdKey)
            }
        }
    }

    /// User-adjustable text size for the chat area. Maps to SwiftUI's
    /// DynamicTypeSize so the OS handles all the layout math (and we get
    /// proper accessibility behavior too). Stored as the raw enum string.
    var fontSize: String {
        didSet { UserDefaults.standard.set(fontSize, forKey: Self.fontSizeKey) }
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
        self.authToken = UserDefaults.standard.string(forKey: Self.authTokenKey) ?? ""
        self.model = UserDefaults.standard.string(forKey: Self.modelKey) ?? "claude-haiku-4-5"
        self.silentKeepalive = UserDefaults.standard.object(forKey: Self.silentKeepaliveKey) as? Bool ?? true
        self.currentConversationId = UserDefaults.standard.string(forKey: Self.currentConversationIdKey)
        self.fontSize = UserDefaults.standard.string(forKey: Self.fontSizeKey) ?? "large"
    }

    private static func detectDefaultBackend() -> URL {
        #if targetEnvironment(simulator)
        return URL(string: "http://localhost:3030")!
        #else
        return URL(string: "https://mymac.tailcf3ccf.ts.net")!
        #endif
    }

    /// Wipe all persisted UserDefaults keys this app owns, restoring init
    /// defaults. Backend / cwd / conversation focus all reset.
    /// The Cache layer's on-disk JSON files need a separate clear (Cache.eraseAll).
    static func eraseAllUserDefaults() {
        let keys = [
            backendKey, cwdKey, permissionModeKey, ttsEnabledKey,
            speakStyleKey, slowTtsKey, authTokenKey, modelKey,
            silentKeepaliveKey, currentConversationIdKey, fontSizeKey,
        ]
        for k in keys {
            UserDefaults.standard.removeObject(forKey: k)
        }
    }
}

import SwiftUI

extension AppSettings {
    /// Map the persisted fontSize string to SwiftUI's DynamicTypeSize.
    /// Unknown values fall back to `.large` (the iOS default).
    var dynamicTypeSize: DynamicTypeSize {
        switch fontSize {
        case "medium": return .medium
        case "large": return .large
        case "xLarge": return .xLarge
        case "xxLarge": return .xxLarge
        case "xxxLarge": return .xxxLarge
        case "accessibility1": return .accessibility1
        case "accessibility2": return .accessibility2
        default: return .large
        }
    }
}
