// TTS playback.
//
// Pipeline: assistant text →
//   (summary mode) /api/voice/summarize → spoken-style 1-4 sentences →
//   /api/voice/tts (Edge TTS zh-CN-XiaoxiaoNeural mp3) → AVAudioPlayer.
//
// Why AVAudioPlayer not AVPlayer: AVAudioPlayer plays from in-memory Data
// directly (we already have the mp3 bytes), no streaming buffer headaches,
// pause/resume/seek all work, simpler to bridge into the audio session
// configured by VoiceRecorder.

import Foundation
import AVFoundation
import Observation

@MainActor
@Observable
final class TTSPlayer: NSObject {
    enum State: Equatable {
        case idle
        case fetching   // hitting /summarize and/or /tts
        case playing
        case paused
        case error(String)
    }

    var state: State = .idle
    /// Per-conversation replay cache. Keyed by conversation id so that
    /// switching conversations doesn't stomp the previous one's last reply.
    /// In-memory only; F1c3 caches to disk via Cache layer.
    private var lastSpokenByConversation: [String: String] = [:]
    private var lastAudioByConversation: [String: Data] = [:]
    /// Which conversation is currently playing (the one whose audio is in
    /// `player`). Used to refuse cross-conversation replay collisions.
    private var playingConversation: String?

    private var player: AVAudioPlayer?
    private let backendURL: () -> URL
    private let authToken: () -> String
    private let settings: () -> AppSettings
    private weak var telemetry: Telemetry?

    /// Bumped on cancel / new turn so in-flight fetches abandon.
    private var generation: Int = 0

    init(
        backendURL: @escaping () -> URL,
        authToken: @escaping () -> String = { "" },
        settings: @escaping () -> AppSettings
    ) {
        self.backendURL = backendURL
        self.authToken = authToken
        self.settings = settings
    }

    func bindTelemetry(_ tel: Telemetry) {
        self.telemetry = tel
    }

    private func authorize(_ req: inout URLRequest) {
        let t = authToken()
        if !t.isEmpty {
            req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization")
        }
    }

    /// Whether the given conversation has a cached audio clip ready to replay.
    /// Returned false when this conversation is mid-playback already (the UI
    /// shows pause/stop instead of replay in that case).
    func hasReplay(for conversationId: String?) -> Bool {
        guard let id = conversationId,
              lastAudioByConversation[id] != nil else { return false }
        if state == .playing && playingConversation == id { return false }
        return true
    }

    /// High-level entry point: speak Claude's full response. Goes through
    /// summarize first (unless settings.speakStyle == "verbatim") and strips
    /// markdown so the TTS doesn't read "**" as "星号星号".
    func speakAssistantTurn(_ raw: String, conversationId: String?) async {
        let s = settings()
        guard s.ttsEnabled else { return }
        cancel()

        let cleanedSource = stripForSpeech(raw)
        if cleanedSource.isEmpty {
            telemetry?.warn("tts.skip.empty_after_strip", conversationId: conversationId)
            return
        }

        let gen = generation
        state = .fetching
        telemetry?.log(
            "tts.fetch.start",
            props: ["style": s.speakStyle, "sourceLen": String(cleanedSource.count)],
            conversationId: conversationId
        )

        var toSpeak = cleanedSource
        if s.speakStyle == "summary", cleanedSource.count > 30 {
            if let summary = await fetchSummary(cleanedSource), gen == generation {
                toSpeak = summary
                telemetry?.log("tts.summary.ok", props: ["summaryLen": String(summary.count)],
                               conversationId: conversationId)
            } else if gen == generation {
                // Summary failed — read only the first ~120 chars (2-3 sentences) instead of the full text.
                toSpeak = truncateForFallback(cleanedSource)
                telemetry?.warn("tts.summary.fallback", props: ["originalLen": String(cleanedSource.count),
                                                                 "truncatedLen": String(toSpeak.count)],
                                conversationId: conversationId)
            }
        }
        if gen != generation { return }

        guard let mp3 = await fetchTTS(toSpeak), gen == generation else {
            if state == .fetching { state = .idle }
            return
        }

        if let id = conversationId {
            lastSpokenByConversation[id] = toSpeak
            lastAudioByConversation[id] = mp3
        }
        playingConversation = conversationId
        await play(mp3)
        telemetry?.log(
            "tts.play.start",
            props: ["spokenLen": String(toSpeak.count), "bytes": String(mp3.count)],
            conversationId: conversationId
        )
    }

    /// Replay this conversation's last spoken clip without re-fetching. No-op
    /// if there's no cache for that conversation.
    func replay(for conversationId: String?) async {
        guard let id = conversationId,
              let data = lastAudioByConversation[id] else { return }
        cancel()
        playingConversation = id
        await play(data)
    }

    /// Drop the per-conversation audio cache (e.g. when the conversation is
    /// closed). The currently-playing audio is unaffected if it belongs to a
    /// different conversation.
    func clearCache(for conversationId: String) {
        lastSpokenByConversation.removeValue(forKey: conversationId)
        lastAudioByConversation.removeValue(forKey: conversationId)
        if playingConversation == conversationId {
            cancel()
        }
    }

    func pause() {
        guard state == .playing, let p = player else { return }
        p.pause()
        state = .paused
    }

    func resume() {
        guard state == .paused, let p = player else { return }
        p.play()
        state = .playing
    }

    /// Stop ongoing playback AND abandon any in-flight summary/tts fetch.
    /// Cached per-conversation audio is preserved — only the live playback
    /// state and pending fetch are torn down.
    func cancel() {
        generation += 1
        player?.stop()
        player = nil
        playingConversation = nil
        if state == .playing || state == .paused || state == .fetching {
            state = .idle
        }
    }

    /// Force back to idle from any state including .error.
    func resetError() {
        generation += 1
        player?.stop()
        player = nil
        playingConversation = nil
        state = .idle
    }

    // MARK: - Private

    private func play(_ mp3: Data) async {
        do {
            // Re-arm audio session for playback (user may have just released PTT).
            let s = AVAudioSession.sharedInstance()
            try? s.setCategory(.playback, mode: .spokenAudio,
                               options: [.duckOthers, .allowBluetoothHFP, .allowBluetoothA2DP])
            try? s.setActive(true)
            let p = try AVAudioPlayer(data: mp3)
            p.delegate = self
            p.prepareToPlay()
            p.play()
            player = p
            state = .playing
        } catch {
            state = .error("播放失败: \(error.localizedDescription)")
        }
    }

    private func fetchSummary(_ text: String) async -> String? {
        var req = URLRequest(url: backendURL().appendingPathComponent("/api/voice/summarize"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        authorize(&req)
        req.timeoutInterval = 35
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["text": text])
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? -1
                telemetry?.warn("tts.summary.http_error", props: ["status": String(code)])
                return nil
            }
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                telemetry?.warn("tts.summary.bad_json")
                return nil
            }
            if (json["fallback"] as? Bool) == true {
                let err = json["error"] as? String ?? "unknown"
                telemetry?.warn("tts.summary.fallback_from_backend", props: ["reason": err])
                return nil
            }
            return (json["summary"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            telemetry?.warn("tts.summary.request_failed", props: ["error": error.localizedDescription])
            return nil
        }
    }

    /// When summarization fails, read the first ~120 Chinese characters (about 2 sentences)
    /// instead of dumping the full response.
    private func truncateForFallback(_ text: String) -> String {
        let limit = 120
        guard text.count > limit else { return text }
        // Try to break at a sentence boundary (。！？) within the first limit+20 chars.
        let window = text.prefix(limit + 20)
        if let idx = window.lastIndex(where: { "。！？.!?".contains($0) }) {
            let cut = text[...idx]
            if cut.count >= 20 { return String(cut) }
        }
        return String(text.prefix(limit)) + "…"
    }

    private func fetchTTS(_ text: String) async -> Data? {
        var req = URLRequest(url: backendURL().appendingPathComponent("/api/voice/tts"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        authorize(&req)
        // 45s: backend's edge-tts subprocess has a 30s timeout, plus we
        // need headroom for the mp3 transfer back over cellular. Anything
        // tighter and a slow Microsoft TTS endpoint + weak signal both fail.
        req.timeoutInterval = 45
        let body: [String: Any] = settings().slowTts
            ? ["text": text, "rate": "-15%"]
            : ["text": text]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                state = .error("TTS HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1)")
                telemetry?.error(
                    "tts.http.failed",
                    props: ["status": String((response as? HTTPURLResponse)?.statusCode ?? -1)]
                )
                return nil
            }
            return data
        } catch {
            state = .error("TTS 请求失败: \(error.localizedDescription)")
            telemetry?.error("tts.request.failed", error: error)
            return nil
        }
    }
}

extension TTSPlayer: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.state = .idle
            self.player = nil
            self.telemetry?.log("tts.play.finished", props: ["success": String(flag)])
        }
    }
    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in
            self.state = .error(error?.localizedDescription ?? "解码失败")
            self.player = nil
        }
    }
}

// MARK: - Markdown stripping

/// Mirror of frontend stripForSpeech — keeps TTS from reading code fences,
/// hash signs, asterisks, etc. as literal characters.
func stripForSpeech(_ s: String) -> String {
    var out = s
    // Fenced code blocks → "代码块"
    out = out.replacingOccurrences(of: "```[\\s\\S]*?```", with: " 代码块。 ", options: .regularExpression)
    // Inline `code` → keep contents
    out = out.replacingOccurrences(of: "`([^`\\n]+)`", with: "$1", options: .regularExpression)
    // Image ![alt](url) → "图：alt" or "图"
    out = out.replacingOccurrences(of: "!\\[([^\\]]*)\\]\\([^)]+\\)", with: "图$1", options: .regularExpression)
    // Link [text](url) → text
    out = out.replacingOccurrences(of: "\\[([^\\]]+)\\]\\([^)]+\\)", with: "$1", options: .regularExpression)
    // bold/italic
    out = out.replacingOccurrences(of: "\\*\\*\\*([^*\\n]+)\\*\\*\\*", with: "$1", options: .regularExpression)
    out = out.replacingOccurrences(of: "\\*\\*([^*\\n]+)\\*\\*", with: "$1", options: .regularExpression)
    out = out.replacingOccurrences(of: "\\*([^*\\n]+)\\*", with: "$1", options: .regularExpression)
    out = out.replacingOccurrences(of: "_([^_\\n]+)_", with: "$1", options: .regularExpression)
    // Headings — drop leading #s
    out = out.replacingOccurrences(of: "(?m)^#{1,6}\\s+", with: "", options: .regularExpression)
    // Tables — collapse pipes to commas, just for readability when dictated
    out = out.replacingOccurrences(of: "\\|", with: "，", options: .regularExpression)
    // Bullets
    out = out.replacingOccurrences(of: "(?m)^\\s*[-*]\\s+", with: "", options: .regularExpression)
    // Multiple newlines → period+space
    out = out.replacingOccurrences(of: "\\n{2,}", with: "。 ", options: .regularExpression)
    out = out.replacingOccurrences(of: "\\n", with: " ", options: .regularExpression)
    return out.trimmingCharacters(in: .whitespacesAndNewlines)
}
