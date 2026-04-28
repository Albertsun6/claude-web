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
    /// Last text we fetched audio for — replay button uses this so a second
    /// hit doesn't re-summarize.
    private var lastSpokenText: String?
    private var lastAudioData: Data?

    private var player: AVAudioPlayer?
    private let backendURL: () -> URL
    private let settings: () -> AppSettings

    /// Bumped on cancel / new turn so in-flight fetches abandon.
    private var generation: Int = 0

    init(backendURL: @escaping () -> URL, settings: @escaping () -> AppSettings) {
        self.backendURL = backendURL
        self.settings = settings
    }

    var hasReplay: Bool { lastAudioData != nil && state != .playing }

    /// High-level entry point: speak Claude's full response. Goes through
    /// summarize first (unless settings.speakStyle == "verbatim") and strips
    /// markdown so the TTS doesn't read "**" as "星号星号".
    func speakAssistantTurn(_ raw: String) async {
        let s = settings()
        guard s.ttsEnabled else { return }
        cancel()

        let cleanedSource = stripForSpeech(raw)
        if cleanedSource.isEmpty { return }

        let gen = generation
        state = .fetching

        var toSpeak = cleanedSource
        if s.speakStyle == "summary", cleanedSource.count > 30 {
            // Trivially short text skips Haiku roundtrip.
            if let summary = await fetchSummary(cleanedSource), gen == generation {
                toSpeak = summary
            }
        }
        if gen != generation { return }

        guard let mp3 = await fetchTTS(toSpeak), gen == generation else {
            if state == .fetching { state = .idle }
            return
        }

        lastSpokenText = toSpeak
        lastAudioData = mp3
        await play(mp3)
    }

    /// Replay the last spoken clip without re-fetching.
    func replay() async {
        guard let data = lastAudioData else { return }
        cancel()
        await play(data)
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
    func cancel() {
        generation += 1
        player?.stop()
        player = nil
        if state == .playing || state == .paused || state == .fetching {
            state = .idle
        }
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
        req.timeoutInterval = 25
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["text": text])
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
            // fallback === true ⇒ Haiku failed, just speak the raw cleaned text instead.
            if (json["fallback"] as? Bool) == true { return nil }
            return (json["summary"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            return nil
        }
    }

    private func fetchTTS(_ text: String) async -> Data? {
        var req = URLRequest(url: backendURL().appendingPathComponent("/api/voice/tts"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 25
        let body: [String: Any] = settings().slowTts
            ? ["text": text, "rate": "-15%"]
            : ["text": text]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                state = .error("TTS HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1)")
                return nil
            }
            return data
        } catch {
            state = .error("TTS 请求失败: \(error.localizedDescription)")
            return nil
        }
    }
}

extension TTSPlayer: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.state = .idle
            self.player = nil
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
