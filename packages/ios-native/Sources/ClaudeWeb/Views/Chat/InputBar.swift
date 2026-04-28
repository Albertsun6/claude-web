import SwiftUI

struct InputBar: View {
    @Binding var draft: String
    let busy: Bool
    let onSend: () -> Void
    let onStop: () -> Void
    let onTranscript: (String) -> Void

    @Environment(VoiceRecorder.self) private var recorder
    @FocusState private var inputFocused: Bool

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
                    .focused($inputFocused)
                    // Keyboard accessory bar with a "完成" button — explicit
                    // dismiss path that doesn't rely on tapping outside the
                    // textfield (which can be flaky with axis: .vertical).
                    .toolbar {
                        ToolbarItemGroup(placement: .keyboard) {
                            Spacer()
                            Button("完成") { inputFocused = false }
                        }
                    }
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
