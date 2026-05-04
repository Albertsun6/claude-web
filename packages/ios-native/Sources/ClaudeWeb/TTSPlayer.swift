// TTS playback with sentence-level pipelining.
//
// Pipeline: assistant text →
//   (summary mode, > 120 chars) /api/voice/summarize-stream → Haiku streams
//     sentences one by one → each sentence immediately queued to /api/voice/tts →
//   AVAudioPlayer plays them in order as soon as each chunk arrives.
//
// "Time to first sound" ~4s: Haiku first token ~1s + edge-tts ~3s. Subsequent
// sentences fetch concurrently with playback so there's no gap.
//
// TurnQueue uses a dynamic total that grows as streaming sentences arrive;
// isDone marks when the stream ends so finalizeTurn fires at the right time.
//
// Why AVAudioPlayer not AVQueuePlayer: AVAudioPlayer plays Data directly with
// no streaming-buffer headaches. We chain instances ourselves on
// didFinishPlaying. Pause / resume / cancel all stay simple.

import Foundation
import AVFoundation
import Observation

@MainActor
@Observable
final class TTSPlayer: NSObject {
    enum State: Equatable {
        case idle
        case fetching   // hitting /summarize and/or /tts (no chunk played yet)
        case playing
        case paused
        case error(String)
    }

    var state: State = .idle
    /// Per-conversation replay cache. Each value is the ordered list of mp3
    /// buffers (one per sentence) for that conversation's last spoken turn.
    /// In-memory only.
    private var lastSpokenByConversation: [String: String] = [:]
    private var lastAudioByConversation: [String: [Data]] = [:]
    /// Which conversation's audio is currently in `player`. Used to refuse
    /// cross-conversation replay collisions and to attribute the play.
    private var playingConversation: String?

    private var player: AVAudioPlayer?
    private let backendURL: () -> URL
    private let authToken: () -> String
    private let settings: () -> AppSettings
    private weak var telemetry: Telemetry?

    /// Bumped on cancel / new turn so in-flight fetches abandon.
    private var generation: Int = 0

    /// Per-turn pipeline state. Reset on every speakAssistantTurn / replay.
    private var queue: TurnQueue?

    private struct TurnQueue {
        let conversationId: String?
        let generation: Int
        /// Grows as streaming sentences arrive. Replays set this upfront.
        var total: Int
        /// Set when the sentence stream ends (or all sentences known upfront).
        var isDone: Bool
        /// True for replays (already-cached buffers); skips re-caching.
        let isReplay: Bool
        var pending: [Int: Data] = [:]
        var failed: Set<Int> = []
        var nextToPlay: Int = 0
    }

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
              let buffers = lastAudioByConversation[id],
              !buffers.isEmpty else { return false }
        if state == .playing && playingConversation == id { return false }
        return true
    }

    /// High-level entry point: speak Claude's full response. Goes through
    /// summarize first (unless settings.speakStyle == "verbatim" or text is
    /// short) and strips markdown so the TTS doesn't read "**" as "星号星号".
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

        // 120-char threshold: below this the Haiku roundtrip costs more than it
        // saves. Edge TTS handles ~120 chars in 3-5 seconds naturally.
        let toSpeak: String
        if s.speakStyle == "summary", cleanedSource.count > 120 {
            // 方案A: stream summary sentences from Haiku; each sentence goes to
            // TTS immediately without waiting for the full summary.
            await streamSummaryAndSpeak(cleanedSource, conversationId: conversationId, gen: gen)
            return
        } else {
            toSpeak = cleanedSource
        }
        if gen != generation { return }

        let sentences = splitSentencesForTTS(toSpeak)
        guard !sentences.isEmpty else {
            if state == .fetching { state = .idle }
            return
        }

        // Set up the queue and clear the previous turn's cache for this
        // conversation. We cache buffers as they play (first-play path), so
        // start empty.
        if let id = conversationId {
            lastSpokenByConversation[id] = toSpeak
            lastAudioByConversation[id] = []
        }
        playingConversation = conversationId
        queue = TurnQueue(
            conversationId: conversationId,
            generation: gen,
            total: sentences.count,
            isDone: true,
            isReplay: false
        )

        telemetry?.log(
            "tts.pipeline.start",
            props: ["chunks": String(sentences.count), "spokenLen": String(toSpeak.count)],
            conversationId: conversationId
        )

        // Fan out: kick off all sentence TTS fetches in parallel. As each
        // returns, handleChunkResult stores it and tries to advance the queue.
        for (idx, sentence) in sentences.enumerated() {
            Task { [weak self] in
                guard let self else { return }
                let mp3 = await self.fetchTTS(sentence)
                await self.handleChunkResult(idx: idx, mp3: mp3, gen: gen)
            }
        }
    }

    /// Replay this conversation's last spoken clip without re-fetching. Plays
    /// the cached buffers sequentially via the same queue mechanism.
    func replay(for conversationId: String?) async {
        guard let id = conversationId,
              let buffers = lastAudioByConversation[id],
              !buffers.isEmpty else { return }
        cancel()
        let gen = generation
        playingConversation = id
        var q = TurnQueue(
            conversationId: id,
            generation: gen,
            total: buffers.count,
            isDone: true,
            isReplay: true
        )
        for (idx, data) in buffers.enumerated() {
            q.pending[idx] = data
        }
        queue = q
        state = .fetching
        advanceQueueIfReady()
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
        queue = nil
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
        queue = nil
        state = .idle
    }

    // MARK: - Pipeline internals

    private func handleChunkResult(idx: Int, mp3: Data?, gen: Int) {
        guard gen == generation, var q = queue else { return }
        if let mp3, !mp3.isEmpty {
            q.pending[idx] = mp3
            // Cache as we go (first-play path only).
            if !q.isReplay, let id = q.conversationId {
                var arr = lastAudioByConversation[id] ?? []
                // Index might be out of order; pad with empty if needed.
                while arr.count < idx { arr.append(Data()) }
                if arr.count == idx {
                    arr.append(mp3)
                } else {
                    arr[idx] = mp3
                }
                lastAudioByConversation[id] = arr
            }
        } else {
            q.failed.insert(idx)
            telemetry?.warn(
                "tts.chunk.failed",
                props: ["idx": String(idx), "total": String(q.total)],
                conversationId: q.conversationId
            )
        }
        queue = q
        advanceQueueIfReady()
    }

    private func advanceQueueIfReady() {
        guard var q = queue else { return }
        // Already playing? wait for didFinishPlaying to advance.
        if state == .playing || state == .paused { return }

        // Skip any failed chunks at the head.
        while q.nextToPlay < q.total && q.failed.contains(q.nextToPlay) {
            q.nextToPlay += 1
        }
        if q.isDone && q.nextToPlay >= q.total {
            queue = q
            finalizeTurn()
            return
        }
        // Stream not done yet and next chunk not ready — keep waiting.
        if !q.isDone && !q.pending.keys.contains(q.nextToPlay) {
            queue = q
            return
        }
        guard let mp3 = q.pending[q.nextToPlay] else {
            // Next chunk not ready yet — keep waiting in .fetching.
            queue = q
            return
        }
        queue = q
        // Reserve the playing slot synchronously so subsequent
        // advanceQueueIfReady calls won't re-enter while we set up.
        state = .playing
        play(mp3)
    }

    private func finalizeTurn() {
        let gen = queue?.generation ?? generation
        let conversationId = queue?.conversationId
        queue = nil
        let isError: Bool
        if case .error = state { isError = true } else { isError = false }
        if !isError && gen == generation {
            state = .idle
        }
        telemetry?.log("tts.pipeline.done", conversationId: conversationId)
    }

    // MARK: - Audio session + play

    private func play(_ mp3: Data) {
        // state is already .playing — reserved by advanceQueueIfReady. We
        // just install the player synchronously on the main actor.
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
        } catch {
            state = .error("播放失败: \(error.localizedDescription)")
        }
    }

    // MARK: - Streaming summary (方案A)

    /// Stream Haiku summary sentences from /api/voice/summarize-stream.
    /// Each sentence is queued to /api/voice/tts immediately on arrival so
    /// TTS starts on the first sentence before Haiku finishes the rest.
    private func streamSummaryAndSpeak(_ text: String, conversationId: String?, gen: Int) async {
        // Initialise a dynamic queue: total=0, isDone=false.
        if let id = conversationId {
            lastSpokenByConversation[id] = text
            lastAudioByConversation[id] = []
        }
        playingConversation = conversationId
        queue = TurnQueue(
            conversationId: conversationId,
            generation: gen,
            total: 0,
            isDone: false,
            isReplay: false
        )

        var req = URLRequest(url: backendURL().appendingPathComponent("/api/voice/summarize-stream"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        authorize(&req)
        req.timeoutInterval = 30
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["text": text])

        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: req)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                // Fall back to verbatim truncation.
                await fallbackVerbatim(text, conversationId: conversationId, gen: gen)
                return
            }

            var sentenceIndex = 0
            var lineBuffer = ""

            for try await byte in bytes {
                guard gen == generation else { return }
                guard let ch = String(bytes: [byte], encoding: .utf8) else { continue }
                if ch == "\n" {
                    let line = lineBuffer
                    lineBuffer = ""
                    guard line.hasPrefix("data: ") else { continue }
                    let payload = String(line.dropFirst(6))
                    guard let data = payload.data(using: .utf8),
                          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                    else { continue }

                    if let sentence = json["sentence"] as? String, !sentence.isEmpty {
                        // /tts has a 2000-char hard cap and a 30s timeout — if Haiku
                        // emits a long comma-separated sentence with no early period,
                        // a single SSE payload can exceed both. Run the same splitter
                        // verbatim path uses so each /tts call stays bounded.
                        let chunks = splitSentencesForTTS(sentence)
                        for chunk in chunks {
                            let idx = sentenceIndex
                            sentenceIndex += 1
                            if var q = queue, q.generation == gen {
                                q.total = sentenceIndex
                                queue = q
                            }
                            Task { [weak self] in
                                guard let self else { return }
                                let mp3 = await self.fetchTTS(chunk)
                                await self.handleChunkResult(idx: idx, mp3: mp3, gen: gen)
                            }
                            if idx == 0 { state = .fetching }
                            telemetry?.log(
                                "tts.stream.sentence",
                                props: ["idx": String(idx), "len": String(chunk.count)],
                                conversationId: conversationId
                            )
                        }
                    } else if (json["done"] as? Bool) == true {
                        // If the backend stream finished without ever emitting a
                        // sentence (Haiku errored, claude CLI mis-spawned, etc),
                        // fall back to verbatim instead of silently going idle.
                        if sentenceIndex == 0 {
                            telemetry?.warn(
                                "tts.stream.empty",
                                props: ["sourceLen": String(text.count)],
                                conversationId: conversationId
                            )
                            await fallbackVerbatim(text, conversationId: conversationId, gen: gen)
                            return
                        }
                        // Mark stream complete so finalizeTurn can fire.
                        if var q = queue, q.generation == gen {
                            q.isDone = true
                            queue = q
                            advanceQueueIfReady()
                        }
                        break
                    }
                } else {
                    lineBuffer += ch
                }
            }
            // If stream ended without explicit done event, close the queue.
            if var q = queue, q.generation == gen, !q.isDone {
                q.isDone = true
                queue = q
                if sentenceIndex == 0 {
                    // No sentences received at all — fall back.
                    await fallbackVerbatim(text, conversationId: conversationId, gen: gen)
                } else {
                    advanceQueueIfReady()
                }
            }
        } catch {
            guard gen == generation else { return }
            telemetry?.warn("tts.stream.failed", props: ["error": error.localizedDescription],
                            conversationId: conversationId)
            await fallbackVerbatim(text, conversationId: conversationId, gen: gen)
        }
    }

    /// Fall back to verbatim truncation when streaming fails.
    private func fallbackVerbatim(_ text: String, conversationId: String?, gen: Int) async {
        guard gen == generation else { return }
        let shortened = truncateForFallback(text)
        let sentences = splitSentencesForTTS(shortened)
        guard !sentences.isEmpty else { return }
        if let id = conversationId { lastAudioByConversation[id] = [] }
        queue = TurnQueue(
            conversationId: conversationId,
            generation: gen,
            total: sentences.count,
            isDone: true,
            isReplay: false
        )
        for (idx, sentence) in sentences.enumerated() {
            Task { [weak self] in
                guard let self else { return }
                let mp3 = await self.fetchTTS(sentence)
                await self.handleChunkResult(idx: idx, mp3: mp3, gen: gen)
            }
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
        // need headroom for the mp3 transfer back over cellular.
        req.timeoutInterval = 45
        let body: [String: Any] = settings().slowTts
            ? ["text": text, "rate": "-15%"]
            : ["text": text]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? -1
                telemetry?.error("tts.http.failed", props: ["status": String(code)])
                return nil
            }
            return data
        } catch {
            // Don't surface chunk-level errors as a global .error state — the
            // pipeline will skip the failed chunk and keep playing.
            telemetry?.error("tts.request.failed", error: error)
            return nil
        }
    }
}

extension TTSPlayer: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.player = nil
            self.telemetry?.log("tts.chunk.finished", props: ["success": String(flag)])
            // Advance the queue regardless of success — a decode failure for
            // one chunk shouldn't strand the rest.
            if var q = self.queue {
                q.nextToPlay += 1
                self.queue = q
                if self.state == .playing { self.state = .fetching }
                self.advanceQueueIfReady()
            } else {
                self.state = .idle
            }
        }
    }
    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in
            self.player = nil
            self.telemetry?.error("tts.decode.failed", error: error)
            // Skip and continue.
            if var q = self.queue {
                q.nextToPlay += 1
                self.queue = q
                self.state = .fetching
                self.advanceQueueIfReady()
            } else {
                self.state = .error(error?.localizedDescription ?? "解码失败")
            }
        }
    }
}

// MARK: - Sentence splitter

/// Split TTS text into chunks suitable for parallel synthesis. Targets
/// 1 sentence per chunk where possible; coalesces very short fragments
/// (≤ 8 chars) with the previous chunk so we don't ship "好。" alone to TTS,
/// and caps each chunk at 200 chars to keep individual requests fast.
func splitSentencesForTTS(_ text: String) -> [String] {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return [] }

    // Sentence terminators: ! ? . 。！？
    let terminators: Set<Character> = ["。", "！", "？", ".", "!", "?", "\n"]
    var raw: [String] = []
    var current = ""
    for ch in trimmed {
        current.append(ch)
        if terminators.contains(ch) {
            let s = current.trimmingCharacters(in: .whitespacesAndNewlines)
            if !s.isEmpty { raw.append(s) }
            current = ""
        }
    }
    let tail = current.trimmingCharacters(in: .whitespacesAndNewlines)
    if !tail.isEmpty { raw.append(tail) }

    // Coalesce short fragments + cap long ones.
    var result: [String] = []
    let minChunkLen = 8
    let maxChunkLen = 200
    for s in raw {
        if let last = result.last, last.count < minChunkLen {
            result[result.count - 1] = last + s
        } else if s.count > maxChunkLen {
            // Soft-split a long sentence at character boundaries to keep
            // single-request latency bounded. Rare: usually a giant comma-
            // separated list with no terminator.
            var idx = s.startIndex
            while idx < s.endIndex {
                let end = s.index(idx, offsetBy: maxChunkLen, limitedBy: s.endIndex) ?? s.endIndex
                result.append(String(s[idx..<end]))
                idx = end
            }
        } else {
            result.append(s)
        }
    }
    return result
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
