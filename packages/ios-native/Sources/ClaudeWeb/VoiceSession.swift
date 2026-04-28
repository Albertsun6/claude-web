// Voice session coordinator (M4).
//
// Owns the lock-screen / hands-free state machine. While *active*:
//   1. AVAudioSession is .playAndRecord, .spokenAudio, with bluetooth options
//      so AirPods route both directions (mic + speaker).
//   2. UIBackgroundModes:audio entitlement keeps app alive while screen off.
//   3. MPRemoteCommandCenter routes lock-screen / earphone play-pause events
//      through `togglePlayPause()` which dispatches by current state.
//   4. MPNowPlayingInfoCenter shows what Claude is doing (recording, thinking,
//      speaking) on lock screen + control center.
//   5. PTT release auto-sends instead of filling the textbox (user is hands
//      off — no chance to "review and tap send").
//
// While *inactive*: nothing different from M3; foreground PTT works as
// review-then-send. Components manage their own audio session per-action.

import Foundation
import AVFoundation
import MediaPlayer
import Observation

@MainActor
@Observable
final class VoiceSession {
    enum SessionState: Equatable {
        case idle
        case recording
        case transcribing
        case thinking
        case playingTTS
        case pausedTTS
        case error(String)
    }

    /// User-facing toggle. Off by default — must be turned on explicitly.
    var active: Bool = false

    /// Last error visible in UI.
    var lastError: String?

    /// Derived from the components — single source of truth for what Claude is
    /// doing right now. Recompute when any subcomponent observable changes.
    var state: SessionState {
        if case .error(let m) = recorder?.state { return .error(m) }
        if case .error(let m) = tts?.state { return .error(m) }
        switch recorder?.state {
        case .recording: return .recording
        case .uploading: return .transcribing
        default: break
        }
        switch tts?.state {
        case .playing: return .playingTTS
        case .paused: return .pausedTTS
        case .fetching: return .thinking // Haiku → tts call counts as thinking-ish
        default: break
        }
        if client?.busy == true { return .thinking }
        return .idle
    }

    private weak var recorder: VoiceRecorder?
    private weak var tts: TTSPlayer?
    private weak var client: BackendClient?
    private weak var settings: AppSettings?

    /// Plays silent audio at volume 0 in a loop while in voice mode. This is
    /// the standard trick to convince iOS we're a real "media app" so:
    ///   1. Now Playing card actually appears in Control Center / lock screen
    ///   2. The audio session doesn't get suspended after a few minutes of idle
    ///   3. Lock-screen MPRemoteCommandCenter events keep flowing
    /// Without this, an "idle voice mode with active session" works briefly
    /// but iOS demotes us within ~30s when no audio is playing.
    private var silentLoop: AVAudioPlayer?

    /// Set by InputBar's onTranscript hook in voice mode. We need a way to
    /// fire prompts without going through the textfield.
    private var sendPromptHook: ((String) -> Void)?

    init() {}

    func bind(
        recorder: VoiceRecorder,
        tts: TTSPlayer,
        client: BackendClient,
        settings: AppSettings,
        sendPrompt: @escaping (String) -> Void
    ) {
        self.recorder = recorder
        self.tts = tts
        self.client = client
        self.settings = settings
        self.sendPromptHook = sendPrompt
    }

    // MARK: - Mode

    func enter() {
        do {
            let s = AVAudioSession.sharedInstance()
            try s.setCategory(
                .playAndRecord,
                mode: .spokenAudio,
                options: [.duckOthers, .defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP]
            )
            try s.setActive(true, options: [])
        } catch {
            lastError = "音频会话激活失败: \(error.localizedDescription)"
            return
        }
        startSilentLoop()
        registerRemoteCommands()
        active = true
        refresh()
    }

    func exit() {
        // Clean up any in-flight subcomponent before tearing the session
        // down. Otherwise we can leave a recorder still writing or a TTS
        // player blocked from rearming the audio session next time.
        switch state {
        case .recording, .transcribing:
            recorder?.cancel()
        case .playingTTS, .pausedTTS:
            tts?.cancel()
        case .thinking:
            // Don't auto-interrupt the in-flight Claude run — user might
            // still want the answer to land in chat. Just tear down audio.
            break
        default:
            break
        }
        unregisterRemoteCommands()
        stopSilentLoop()
        clearNowPlaying()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        active = false
    }

    // MARK: - Silent loop (Now Playing keep-alive)

    /// Public so App can call when settings.silentKeepalive flips while
    /// voice mode is already active — toggle takes effect immediately
    /// instead of waiting until next enter().
    func applySilentKeepaliveChange() {
        guard active else { return }
        if settings?.silentKeepalive == true {
            startSilentLoop()
        } else {
            stopSilentLoop()
        }
        refresh()
    }

    private func startSilentLoop() {
        // Opt-in only — see AppSettings.silentKeepalive doc for the App Store
        // rejection caveat. Default OFF, user toggles in Settings if they
        // want to test long-idle lock-screen behavior.
        guard settings?.silentKeepalive == true else { return }
        guard silentLoop == nil else { return }
        do {
            let p = try AVAudioPlayer(data: Self.silentWAV)
            p.numberOfLoops = -1
            p.volume = 0
            p.prepareToPlay()
            p.play()
            silentLoop = p
        } catch {
            // Non-fatal: voice mode still works, but lock-screen Now Playing
            // may not show consistently. Surface to UI for diagnosis.
            lastError = "静音保活失败: \(error.localizedDescription)"
        }
    }

    private func stopSilentLoop() {
        silentLoop?.stop()
        silentLoop = nil
    }

    /// Cached 0.5 second silent 16-bit mono WAV (16kHz). ~16KB.
    private static let silentWAV: Data = {
        let sampleRate: UInt32 = 16_000
        let seconds: Double = 0.5
        let samples = Int(Double(sampleRate) * seconds)
        let dataBytes = samples * 2 // 16-bit
        var d = Data()
        d.append("RIFF".data(using: .ascii)!)
        d.append(le(UInt32(36 + dataBytes)))
        d.append("WAVE".data(using: .ascii)!)
        d.append("fmt ".data(using: .ascii)!)
        d.append(le(UInt32(16)))               // PCM chunk size
        d.append(le(UInt16(1)))                // PCM
        d.append(le(UInt16(1)))                // mono
        d.append(le(sampleRate))
        d.append(le(UInt32(sampleRate * 2)))   // byte rate
        d.append(le(UInt16(2)))                // block align
        d.append(le(UInt16(16)))               // bits per sample
        d.append("data".data(using: .ascii)!)
        d.append(le(UInt32(dataBytes)))
        d.append(Data(repeating: 0, count: dataBytes))
        return d
    }()

    private static func le<T: FixedWidthInteger>(_ v: T) -> Data {
        var le = v.littleEndian
        return withUnsafeBytes(of: &le) { Data($0) }
    }

    /// Recover from any .error state without restarting the app.
    func dismissError() {
        recorder?.resetError()
        tts?.resetError()
        lastError = nil
        refresh()
    }

    /// Called from anywhere subcomponent state changes — keeps Now Playing
    /// in sync on lock screen.
    func refresh() {
        guard active else { return }
        updateNowPlaying()
    }

    // MARK: - Remote command handlers

    /// Lock-screen / earphone togglePlayPauseCommand handler. Semantics
    /// depend on current state — this is the "smart" remote button.
    @discardableResult
    func togglePlayPause() -> MPRemoteCommandHandlerStatus {
        switch state {
        case .idle:
            Task { await self.recorder?.start(); self.refresh() }
        case .recording:
            Task {
                if let text = await self.recorder?.stopAndTranscribe(), !text.isEmpty {
                    self.sendPromptHook?(text)
                }
                self.refresh()
            }
        case .playingTTS:
            tts?.pause()
            refresh()
        case .pausedTTS:
            tts?.resume()
            refresh()
        case .transcribing, .thinking, .error:
            return .commandFailed
        }
        return .success
    }

    /// Explicit `playCommand`. NEVER reverses an active playback (unlike
    /// togglePlayPause which would). Resumes paused TTS, kicks off recording
    /// from idle, otherwise no-op.
    @discardableResult
    func handlePlay() -> MPRemoteCommandHandlerStatus {
        switch state {
        case .idle:
            Task { await self.recorder?.start(); self.refresh() }
            return .success
        case .pausedTTS:
            tts?.resume()
            refresh()
            return .success
        default:
            return .commandFailed
        }
    }

    /// Explicit `pauseCommand`. NEVER starts something new. Pauses TTS,
    /// stops a currently running recording, otherwise no-op.
    @discardableResult
    func handlePause() -> MPRemoteCommandHandlerStatus {
        switch state {
        case .playingTTS:
            tts?.pause()
            refresh()
            return .success
        case .recording:
            Task {
                if let text = await self.recorder?.stopAndTranscribe(), !text.isEmpty {
                    self.sendPromptHook?(text)
                }
                self.refresh()
            }
            return .success
        default:
            return .commandFailed
        }
    }

    @discardableResult
    func stop() -> MPRemoteCommandHandlerStatus {
        switch state {
        case .recording:
            recorder?.cancel()
        case .playingTTS, .pausedTTS:
            tts?.cancel()
        case .thinking:
            client?.interrupt()
        default:
            return .commandFailed
        }
        refresh()
        return .success
    }

    @discardableResult
    func skipForward() -> MPRemoteCommandHandlerStatus {
        // Skip the current TTS clip without restarting recording.
        if state == .playingTTS || state == .pausedTTS {
            tts?.cancel()
            refresh()
            return .success
        }
        return .commandFailed
    }

    // MARK: - Remote command registration

    private func registerRemoteCommands() {
        let cc = MPRemoteCommandCenter.shared()
        cc.togglePlayPauseCommand.isEnabled = true
        cc.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.togglePlayPause() ?? .commandFailed
        }
        cc.playCommand.isEnabled = true
        cc.playCommand.addTarget { [weak self] _ in
            self?.handlePlay() ?? .commandFailed
        }
        cc.pauseCommand.isEnabled = true
        cc.pauseCommand.addTarget { [weak self] _ in
            self?.handlePause() ?? .commandFailed
        }
        cc.stopCommand.isEnabled = true
        cc.stopCommand.addTarget { [weak self] _ in
            self?.stop() ?? .commandFailed
        }
        cc.nextTrackCommand.isEnabled = true
        cc.nextTrackCommand.addTarget { [weak self] _ in
            self?.skipForward() ?? .commandFailed
        }
    }

    private func unregisterRemoteCommands() {
        let cc = MPRemoteCommandCenter.shared()
        for cmd in [cc.togglePlayPauseCommand, cc.playCommand, cc.pauseCommand,
                    cc.stopCommand, cc.nextTrackCommand] {
            cmd.removeTarget(nil)
            cmd.isEnabled = false
        }
    }

    // MARK: - Now Playing

    private func updateNowPlaying() {
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = "Claude Voice · " + title()
        info[MPMediaItemPropertyArtist] = "claude-web"
        // playbackRate truth-table (be honest with iOS):
        //   playingTTS                              → 1.0  (real audio)
        //   pausedTTS                               → 0.0  (real but paused)
        //   silentKeepalive ON  + any other state   → 1.0  (silent loop is playing)
        //   silentKeepalive OFF + any other state   → 0.0  (nothing playing)
        // Lying with 1.0 when nothing plays makes Control Center display the
        // wrong UI (and it doesn't actually keep the card alive — only real
        // audio does that).
        let rate: Double
        switch state {
        case .playingTTS: rate = 1.0
        case .pausedTTS: rate = 0.0
        default: rate = (settings?.silentKeepalive == true && silentLoop != nil) ? 1.0 : 0.0
        }
        info[MPNowPlayingInfoPropertyPlaybackRate] = rate
        info[MPNowPlayingInfoPropertyIsLiveStream] = true
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func clearNowPlaying() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func title() -> String {
        switch state {
        case .idle: return "待命 · 按播放开始录音"
        case .recording: return "录音中… · 再按一次结束"
        case .transcribing: return "识别中…"
        case .thinking: return "Claude 在想…"
        case .playingTTS: return "正在播报 · " + (settings?.cwd.split(separator: "/").last.map(String.init) ?? "")
        case .pausedTTS: return "已暂停"
        case .error(let m): return "出错: \(m)"
        }
    }
}
