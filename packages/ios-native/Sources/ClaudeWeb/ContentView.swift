// Top-level UI: connection chip + chat list + input + settings sheet.
// M1 scope: text-only. M2 will inline a PTT button next to send.

import SwiftUI

struct ContentView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(BackendClient.self) private var client
    @Environment(VoiceRecorder.self) private var recorder
    @Environment(TTSPlayer.self) private var tts
    @State private var draft: String = ""
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                connectionChip
                ChatListView(messages: client.messages)
                    .frame(maxHeight: .infinity)
                Divider()
                InputBar(
                    draft: $draft,
                    busy: client.busy,
                    onSend: send,
                    onStop: client.interrupt,
                    onTranscript: { text in
                        // Voice transcript fills the textarea — user reviews + sends.
                        // (M1.5 spec: REVIEWING step explicit, no auto-send for now.)
                        draft = text
                    }
                )
            }
            .navigationTitle("Claude")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .sheet(item: Binding(
                get: { client.pendingPermission },
                set: { _ in /* dismissed by replyPermission */ }
            )) { req in
                PermissionSheet(request: req) { decision in
                    client.replyPermission(req, decision: decision)
                }
                .presentationDetents([.medium])
            }
        }
    }

    private var connectionChip: some View {
        HStack(spacing: 6) {
            Circle().fill(chipColor).frame(width: 8, height: 8)
            Text(chipLabel).font(.caption).foregroundStyle(.secondary)
            Spacer()
            ttsControls
            Text(settings.cwd.split(separator: "/").last.map(String.init) ?? settings.cwd)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.bar)
    }

    @ViewBuilder
    private var ttsControls: some View {
        switch tts.state {
        case .fetching:
            ProgressView().scaleEffect(0.7)
        case .playing:
            Button { tts.pause() } label: {
                Image(systemName: "pause.fill")
            }
            Button { tts.cancel() } label: {
                Image(systemName: "stop.fill")
            }
        case .paused:
            Button { tts.resume() } label: {
                Image(systemName: "play.fill")
            }
            Button { tts.cancel() } label: {
                Image(systemName: "stop.fill")
            }
        case .idle:
            if tts.hasReplay {
                Button { Task { await tts.replay() } } label: {
                    Image(systemName: "arrow.counterclockwise")
                }
            }
        case .error:
            EmptyView()
        }
    }

    private var chipColor: Color {
        switch client.state {
        case .connected: return .green
        case .connecting: return .yellow
        case .disconnected: return .gray
        case .error: return .red
        }
    }

    private var chipLabel: String {
        switch client.state {
        case .connected: return "已连接"
        case .connecting: return "连接中…"
        case .disconnected: return "未连接"
        case .error(let msg): return "失败: \(msg)"
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        client.sendPrompt(text, cwd: settings.cwd, permissionMode: settings.permissionMode)
        draft = ""
    }
}

private struct ChatListView: View {
    let messages: [ChatLine]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(messages) { line in
                        ChatLineView(line: line)
                            .id(line.id)
                    }
                }
                .padding(12)
            }
            .onChange(of: messages.last?.id) { _, newID in
                guard let newID else { return }
                withAnimation { proxy.scrollTo(newID, anchor: .bottom) }
            }
            // Also follow assistant streaming updates (id stays same, text grows).
            .onChange(of: messages.last?.text) { _, _ in
                guard let last = messages.last else { return }
                withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
            }
        }
    }
}

private struct ChatLineView: View {
    let line: ChatLine

    var body: some View {
        switch line.role {
        case .user:
            HStack {
                Spacer(minLength: 40)
                Text(line.text)
                    .padding(10)
                    .background(Color.accentColor.opacity(0.18), in: .rect(cornerRadius: 12))
            }
        case .assistant:
            Text(line.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        case .system:
            Text(line.text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.vertical, 2)
        case .error:
            Text(line.text)
                .font(.caption)
                .foregroundStyle(.red)
                .padding(8)
                .background(.red.opacity(0.08), in: .rect(cornerRadius: 8))
        }
    }
}

private struct InputBar: View {
    @Binding var draft: String
    let busy: Bool
    let onSend: () -> Void
    let onStop: () -> Void
    let onTranscript: (String) -> Void

    @Environment(VoiceRecorder.self) private var recorder

    var body: some View {
        VStack(spacing: 6) {
            // Recorder status hint above the bar
            if recorder.state != .idle {
                HStack(spacing: 6) {
                    Circle().fill(statusColor).frame(width: 8, height: 8)
                    Text(statusLabel).font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("输入指令，或按住麦克风说话…", text: $draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                    .submitLabel(.send)
                    .onSubmit(onSend)
                pttButton
                if busy {
                    Button(role: .destructive, action: onStop) {
                        Image(systemName: "stop.fill")
                            .frame(width: 44, height: 44)
                    }
                } else {
                    Button(action: onSend) {
                        Image(systemName: "paperplane.fill")
                            .frame(width: 44, height: 44)
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    /// Hold-to-talk: press starts, release stops + transcribes.
    /// We use a long-press gesture with min 0 sec so it engages immediately.
    private var pttButton: some View {
        Button {
            // Tap-to-toggle for accessibility — tap once starts, tap again stops.
            Task { await togglePTT() }
        } label: {
            Image(systemName: recordingIcon)
                .frame(width: 44, height: 44)
                .foregroundStyle(recordingFG)
                .background(recordingBG, in: .circle)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            // Hold-to-talk: starts on press, transcribes on release.
            // minimumDistance > 0 prevents the tap recognizer from firing for holds.
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    if recorder.state == .idle {
                        Task { await recorder.start() }
                    }
                }
                .onEnded { _ in
                    if recorder.state == .recording {
                        Task {
                            if let text = await recorder.stopAndTranscribe(), !text.isEmpty {
                                onTranscript(text)
                            }
                        }
                    }
                }
        )
        .disabled(busy)
    }

    private func togglePTT() async {
        switch recorder.state {
        case .idle:
            await recorder.start()
        case .recording:
            if let text = await recorder.stopAndTranscribe(), !text.isEmpty {
                onTranscript(text)
            }
        default:
            break
        }
    }

    private var recordingIcon: String {
        switch recorder.state {
        case .recording: return "mic.fill"
        case .uploading: return "waveform"
        default: return "mic"
        }
    }
    private var recordingFG: Color {
        recorder.state == .idle ? .accentColor : .white
    }
    private var recordingBG: Color {
        switch recorder.state {
        case .recording: return .red
        case .uploading: return .blue
        default: return Color.accentColor.opacity(0.15)
        }
    }
    private var statusColor: Color {
        switch recorder.state {
        case .recording: return .red
        case .uploading: return .blue
        case .error: return .orange
        default: return .gray
        }
    }
    private var statusLabel: String {
        switch recorder.state {
        case .recording: return "录音中…松开发送"
        case .uploading: return "上传识别中…"
        case .error(let msg): return msg
        default: return ""
        }
    }
}

struct SettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var draftURL: String = ""
    @State private var draftCwd: String = ""
    @State private var draftMode: String = "plan"

    var body: some View {
        @Bindable var s = settings
        NavigationStack {
            Form {
                Section("Backend") {
                    TextField("https://mymac.tailcf3ccf.ts.net", text: $draftURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    Button("用模拟器默认 (localhost:3030)") {
                        draftURL = "http://localhost:3030"
                    }
                    Button("用 Tailscale 默认") {
                        draftURL = "https://mymac.tailcf3ccf.ts.net"
                    }
                }
                Section("工作目录") {
                    TextField("/Users/you/Desktop", text: $draftCwd)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section("权限模式") {
                    Picker("权限模式", selection: $draftMode) {
                        Text("Plan（只读规划，最安全）").tag("plan")
                        Text("Default（每次工具问允许 / 拒绝）").tag("default")
                        Text("Accept Edits（自动允许编辑，Bash 仍问）").tag("acceptEdits")
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section("语音播报") {
                    Toggle("自动播报回答", isOn: $s.ttsEnabled)
                    Picker("风格", selection: $s.speakStyle) {
                        Text("概要（Haiku 改写为 1-4 句）").tag("summary")
                        Text("逐句（原文）").tag("verbatim")
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    .disabled(!s.ttsEnabled)
                    Toggle("慢速朗读（-15%）", isOn: $s.slowTts)
                        .disabled(!s.ttsEnabled)
                }
            }
            .navigationTitle("设置")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("保存") {
                        if let u = URL(string: draftURL) { s.backendURL = u }
                        s.cwd = draftCwd
                        s.permissionMode = draftMode
                        dismiss()
                    }
                    .fontWeight(.bold)
                }
            }
            .onAppear {
                draftURL = settings.backendURL.absoluteString
                draftCwd = settings.cwd
                draftMode = settings.permissionMode
            }
        }
    }
}

struct PermissionSheet: View {
    let request: PermissionRequest
    let onDecision: (PermissionDecision) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("工具") {
                    Text(request.toolName).font(.title3.bold())
                }
                Section("内容") {
                    Text(request.preview)
                        .font(.body.monospaced())
                        .textSelection(.enabled)
                        .lineLimit(10)
                }
                Section {
                    Button(role: .destructive) {
                        onDecision(.deny)
                        dismiss()
                    } label: {
                        Label("拒绝", systemImage: "xmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    Button {
                        onDecision(.allow)
                        dismiss()
                    } label: {
                        Label("允许", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                            .fontWeight(.semibold)
                    }
                }
            }
            .navigationTitle("权限请求")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
