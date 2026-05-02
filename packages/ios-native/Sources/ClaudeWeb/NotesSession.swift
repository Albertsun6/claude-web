// 摘要模式 — 持续录音 + 分块转写 + 最终结构化总结。
//
// 用户场景：跟客户聊需求 / 自己一个人头脑风暴时打开此模式，按一次开始，持续录音；
// 后台每 30s 切一段送给 /api/voice/transcribe 累积成完整文字稿；
// 用户按"完成"后送给 /api/voice/notes-summary 生成 Markdown 总结。
//
// 实现策略：用 AVAudioRecorder 反复 stop+start 来切段（轮换 m4a 文件）。
// 切段时刻有 ~50ms gap，对长篇口述基本不丢词；如需零间隙可改用 AVAudioEngine。
//
// 与 VoiceSession 的关系：完全独立。本会话激活时也使用 .playAndRecord 类别，
// 不主动接管 / 还原 — VoiceSession 也用同样类别，可以共存。退出时不 deactivate
// session（VoiceSession 的 silentKeepalive 可能还在用）。

import Foundation
import AVFoundation
import Observation

@MainActor
@Observable
final class NotesSession {
    enum State: Equatable {
        case idle
        case recording           // 正在录音，定时切段
        case finishing           // 用户按完成，最后一段在转写中
        case summarizing         // 转写已全部回来，正在生成总结
        case done                // 总结完成
        case error(String)
    }

    var state: State = .idle

    /// 已转写完的段落（按时间顺序）。用于显示实时文字稿。
    var chunks: [String] = []

    /// 正在转写中的段数（chunk 已切出但 backend 还没返回）。
    var pendingChunks: Int = 0

    /// 最终的 Markdown 总结。done 状态下有值。
    var summary: String = ""

    /// 录音开始时间（用于计时显示）。
    var startedAt: Date?

    /// 录音切段间隔。30s = whisper 单次解析的舒适长度，且转写延迟用户可接受。
    private let chunkSeconds: TimeInterval = 30

    private let backendURL: () -> URL
    private let authToken: () -> String
    private weak var telemetry: Telemetry?

    private var recorder: AVAudioRecorder?
    private var currentFileURL: URL?
    private var rotateTask: Task<Void, Never>?

    /// 切段编号 — 用于把异步转写结果按顺序拼回 chunks。
    private var nextChunkIndex: Int = 0

    /// 转写结果按 index 暂存，按顺序 flush 到 chunks 里以保证显示顺序。
    private var pendingResults: [Int: String] = [:]
    private var nextToCommit: Int = 0

    init(backendURL: @escaping () -> URL, authToken: @escaping () -> String = { "" }) {
        self.backendURL = backendURL
        self.authToken = authToken
    }

    func bindTelemetry(_ t: Telemetry) { self.telemetry = t }

    /// 完整文字稿（已转写部分的拼接）。
    var fullTranscript: String {
        chunks.joined(separator: "\n\n")
    }

    /// 录音时长（秒）。recording / finishing 状态下有意义。
    var elapsedSeconds: Int {
        guard let started = startedAt else { return 0 }
        return Int(Date().timeIntervalSince(started))
    }

    // MARK: - 控制

    func start() async {
        // 已在进行中的状态不允许重启；其它状态（idle / done / error）允许开启新一轮
        switch state {
        case .recording, .finishing, .summarizing: return
        default: break
        }
        // 重置
        chunks = []
        pendingChunks = 0
        summary = ""
        pendingResults = [:]
        nextChunkIndex = 0
        nextToCommit = 0
        startedAt = nil

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

        do {
            try startNewRecorder()
        } catch {
            state = .error("录音启动失败: \(error.localizedDescription)")
            return
        }
        startedAt = Date()
        state = .recording
        telemetry?.log("notes.start")
        scheduleRotation()
    }

    /// 用户按"完成"。停止录音，转写最后一段，等所有段落到齐后生成总结。
    func finish() async {
        guard state == .recording else { return }
        state = .finishing
        rotateTask?.cancel()
        rotateTask = nil

        // 停止当前段并送去转写（这是最后一段）。
        let finalIndex = nextChunkIndex
        if let url = stopCurrentRecorderAndTakeFile() {
            nextChunkIndex += 1
            pendingChunks += 1
            await transcribeChunk(index: finalIndex, fileURL: url)
        }

        // 等所有 pending 转写完成
        while pendingChunks > 0 {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }

        let text = fullTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            state = .error("没有捕捉到任何语音")
            telemetry?.warn("notes.empty_transcript")
            return
        }

        state = .summarizing
        telemetry?.log("notes.summarize.start", props: ["chars": String(text.count)])
        do {
            let result = try await uploadForSummary(text)
            summary = result
            state = .done
            telemetry?.log("notes.summarize.done", props: ["summaryChars": String(result.count)])
        } catch {
            // 失败时仍然让用户看到原始文字稿（NotesView 会展示 fullTranscript）
            state = .error("生成总结失败: \(error.localizedDescription)")
            telemetry?.error("notes.summarize.failed", props: ["error": error.localizedDescription])
        }
    }

    /// 用户取消整个会话。丢弃所有数据。
    func cancel() {
        rotateTask?.cancel()
        rotateTask = nil
        if let r = recorder {
            r.stop()
            recorder = nil
        }
        if let url = currentFileURL { try? FileManager.default.removeItem(at: url) }
        currentFileURL = nil
        chunks = []
        pendingChunks = 0
        pendingResults = [:]
        summary = ""
        startedAt = nil
        nextChunkIndex = 0
        nextToCommit = 0
        state = .idle
        telemetry?.log("notes.cancel")
    }

    // MARK: - 私有

    private func requestMicPermission() async -> Bool {
        await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { granted in
                cont.resume(returning: granted)
            }
        }
    }

    private func configureSession() throws {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(
            .playAndRecord,
            mode: .spokenAudio,
            options: [.duckOthers, .defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP]
        )
        try s.setActive(true, options: [])
    }

    private func startNewRecorder() throws {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("notes-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        let r = try AVAudioRecorder(url: tmp, settings: settings)
        r.prepareToRecord()
        if !r.record() {
            throw NSError(domain: "NotesSession", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "AVAudioRecorder.record() 返回 false"])
        }
        recorder = r
        currentFileURL = tmp
    }

    /// 停掉当前 recorder，把文件交出去。返回文件 URL（调用方负责 transcribe + delete）。
    private func stopCurrentRecorderAndTakeFile() -> URL? {
        guard let r = recorder, let url = currentFileURL else { return nil }
        r.stop()
        recorder = nil
        currentFileURL = nil
        // 太短 → 视为静默段，直接丢弃
        if let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
           let size = attrs[.size] as? Int, size < 8_000 {
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        return url
    }

    /// 录音中每 chunkSeconds 触发一次 — 切段、送转写、开新段。
    private func scheduleRotation() {
        rotateTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(chunkSeconds * 1_000_000_000))
                if Task.isCancelled { return }
                guard self.state == .recording else { return }
                await self.rotateChunk()
            }
        }
    }

    /// 切到下一段：停掉当前 recorder，送去转写，立即起新 recorder 继续录。
    private func rotateChunk() async {
        let index = nextChunkIndex
        let oldURL = stopCurrentRecorderAndTakeFile()
        // 立刻起新段，最小化录音 gap
        do {
            try startNewRecorder()
        } catch {
            state = .error("切段失败: \(error.localizedDescription)")
            return
        }
        if let url = oldURL {
            nextChunkIndex += 1
            pendingChunks += 1
            // 异步转写 — 不阻塞下一段录音
            Task { [weak self] in
                await self?.transcribeChunk(index: index, fileURL: url)
            }
        }
    }

    private func transcribeChunk(index: Int, fileURL: URL) async {
        defer {
            try? FileManager.default.removeItem(at: fileURL)
        }
        do {
            let data = try Data(contentsOf: fileURL)
            let text = try await uploadForTranscription(data)
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            commitChunk(index: index, text: trimmed)
        } catch {
            // 单段失败不致命：标记空字符串，让其他段继续。telemetry 记录便于诊断。
            telemetry?.warn(
                "notes.chunk.transcribe_failed",
                props: ["index": String(index), "error": error.localizedDescription]
            )
            commitChunk(index: index, text: "")
        }
    }

    /// 把转写结果按 index 顺序提交到 chunks 数组。乱序到达的段先暂存。
    private func commitChunk(index: Int, text: String) {
        pendingResults[index] = text
        pendingChunks -= 1
        while let next = pendingResults.removeValue(forKey: nextToCommit) {
            if !next.isEmpty {
                chunks.append(next)
            }
            nextToCommit += 1
        }
    }

    // MARK: - HTTP

    private func uploadForTranscription(_ data: Data) async throws -> String {
        var req = URLRequest(url: backendURL().appendingPathComponent("/api/voice/transcribe"))
        req.httpMethod = "POST"
        req.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        let token = authToken()
        if !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.timeoutInterval = 120
        req.httpBody = data
        let (resBody, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            let body = String(data: resBody, encoding: .utf8) ?? ""
            throw NSError(domain: "NotesSession", code: code,
                          userInfo: [NSLocalizedDescriptionKey: "transcribe HTTP \(code): \(body.prefix(200))"])
        }
        guard let json = try JSONSerialization.jsonObject(with: resBody) as? [String: Any],
              let text = json["text"] as? String else {
            throw NSError(domain: "NotesSession", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "transcribe 响应格式错误"])
        }
        return text
    }

    private func uploadForSummary(_ text: String) async throws -> String {
        var req = URLRequest(url: backendURL().appendingPathComponent("/api/voice/notes-summary"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let token = authToken()
        if !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.timeoutInterval = 120
        req.httpBody = try JSONSerialization.data(withJSONObject: ["text": text])
        let (resBody, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            let body = String(data: resBody, encoding: .utf8) ?? ""
            throw NSError(domain: "NotesSession", code: code,
                          userInfo: [NSLocalizedDescriptionKey: "summary HTTP \(code): \(body.prefix(200))"])
        }
        guard let json = try JSONSerialization.jsonObject(with: resBody) as? [String: Any],
              let summary = json["summary"] as? String else {
            throw NSError(domain: "NotesSession", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "summary 响应格式错误"])
        }
        return summary
    }
}
