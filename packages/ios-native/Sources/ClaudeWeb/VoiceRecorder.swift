// PTT recorder.
//
// Strategy: AVAudioRecorder writing m4a (AAC). The backend's /api/voice/transcribe
// already auto-detects content-type via ffmpeg, so m4a is fine — we send
// "audio/mp4" content-type and it's decoded the same as MediaRecorder webm output.
//
// Audio session is configured for .playAndRecord here so M3's TTS playback
// can coexist; the playback happens via AVPlayer on the same session.
// .duckOthers + .allowBluetoothHFP make AirPods + ambient music behave nicely.

import Foundation
import AVFoundation
import Observation

@MainActor
@Observable
final class VoiceRecorder {
    enum State: Equatable {
        case idle
        case recording
        case uploading
        case error(String)
    }

    var state: State = .idle
    var lastTranscript: String = ""

    private var recorder: AVAudioRecorder?
    private let backendURL: () -> URL
    private var fileURL: URL?

    init(backendURL: @escaping () -> URL) {
        self.backendURL = backendURL
    }

    /// Configure the audio session for record + playback. Idempotent — safe to
    /// call before every recording.
    private func configureSession() throws {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(
            .playAndRecord,
            mode: .spokenAudio,
            options: [.duckOthers, .defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP]
        )
        try s.setActive(true, options: [])
    }

    /// Request mic permission once (iOS will prompt on first call).
    func requestMicPermission() async -> Bool {
        await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { granted in
                cont.resume(returning: granted)
            }
        }
    }

    func start() async {
        guard state == .idle else { return }
        if !(await requestMicPermission()) {
            state = .error("麦克风权限被拒绝")
            return
        }
        do {
            try configureSession()
        } catch {
            state = .error("音频会话设置失败: \(error.localizedDescription)")
            return
        }

        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("ptt-\(UUID().uuidString).m4a")
        fileURL = tmp
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,                  // whisper's native rate, less to upload
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            let r = try AVAudioRecorder(url: tmp, settings: settings)
            r.prepareToRecord()
            r.record()
            recorder = r
            state = .recording
        } catch {
            state = .error("录音启动失败: \(error.localizedDescription)")
        }
    }

    /// Stop + upload. Returns the transcript on success, nil on cancel/error.
    func stopAndTranscribe() async -> String? {
        guard let r = recorder, state == .recording else { return nil }
        r.stop()
        recorder = nil
        guard let url = fileURL else { state = .idle; return nil }
        defer { try? FileManager.default.removeItem(at: url) }

        state = .uploading
        do {
            let data = try Data(contentsOf: url)
            // Throwaway tiny clips (< 8KB ≈ <250ms of 16k AAC) are pure noise.
            if data.count < 8_000 {
                state = .idle
                return nil
            }
            let text = try await uploadForTranscription(data)
            lastTranscript = text
            state = .idle
            return text.isEmpty ? nil : text
        } catch {
            state = .error("转写失败: \(error.localizedDescription)")
            return nil
        }
    }

    /// Cancel the current recording without uploading.
    func cancel() {
        recorder?.stop()
        recorder = nil
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        fileURL = nil
        state = .idle
    }

    private func uploadForTranscription(_ data: Data) async throws -> String {
        var req = URLRequest(url: backendURL().appendingPathComponent("/api/voice/transcribe"))
        req.httpMethod = "POST"
        req.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 60
        req.httpBody = data

        let (resBody, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            let body = String(data: resBody, encoding: .utf8) ?? ""
            throw NSError(
                domain: "VoiceRecorder", code: code,
                userInfo: [NSLocalizedDescriptionKey: "HTTP \(code): \(body.prefix(200))"]
            )
        }
        guard let json = try JSONSerialization.jsonObject(with: resBody) as? [String: Any],
              let text = json["text"] as? String else {
            throw NSError(domain: "VoiceRecorder", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "missing text in response"])
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
