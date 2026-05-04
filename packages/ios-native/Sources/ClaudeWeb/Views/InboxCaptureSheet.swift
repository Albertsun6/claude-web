// 30-秒-Idea capture sheet.
// Goal: tap the 💡 button → this sheet appears focused on the text field →
// user types or dictates a thought → tap "存入 Inbox" → toast → sheet dismisses.
// No project / priority / tag selection required (those are processed later).

import SwiftUI

struct InboxCaptureSheet: View {
    let api: InboxAPI
    let onDismiss: () -> Void

    @Environment(VoiceRecorder.self) private var recorder
    @State private var text: String = ""
    @State private var submitting = false
    @State private var error: String?
    @State private var saved = false
    @State private var transcribing = false
    @State private var voiceSource = "ios"
    @State private var pulseOn = false
    @FocusState private var focused: Bool

    private let timer = Timer.publish(every: 0.6, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("把刚才想到的事情存下来，回头再处理。（完整版 Idea 捕捉）")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                TextEditor(text: $text)
                    .focused($focused)
                    .scrollContentBackground(.hidden)
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .frame(minHeight: 160)
                    .padding(.horizontal)
                    .overlay(alignment: .topLeading) {
                        if text.isEmpty {
                            Text("用键盘输入，或长按麦克风听写…")
                                .foregroundStyle(.secondary)
                                .padding(.top, 12)
                                .padding(.leading, 24)
                                .allowsHitTesting(false)
                        }
                    }

                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                }

                if saved {
                    HStack {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        Text("已存入 Inbox").foregroundStyle(.green)
                        Spacer()
                    }
                    .padding(.horizontal)
                }

                // Voice capture: tap-to-toggle, NOT push-to-talk, since the
                // sheet has a single-purpose UI (less risk of accidental
                // release). On stop, the transcribed text is appended to the
                // existing draft so users can mix voice + edit.
                HStack(spacing: 12) {
                    Button {
                        Task { await toggleRecording() }
                    } label: {
                        HStack {
                            if transcribing {
                                ProgressView().scaleEffect(0.8)
                                Text("识别中…").font(.callout)
                            } else if recorder.state == .recording {
                                Image(systemName: "stop.circle.fill").foregroundStyle(.red)
                                Text("点击停止").font(.callout)
                            } else {
                                Image(systemName: "mic.circle.fill").foregroundStyle(Color.accentColor)
                                Text("语音输入").font(.callout)
                            }
                            Spacer()
                            if recorder.state == .recording {
                                Circle().fill(.red).frame(width: 8, height: 8)
                                    .opacity(pulseOn ? 0.3 : 1.0)
                            }
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity)
                        .background(recorder.state == .recording ? Color.red.opacity(0.1) : Color(.systemGray6))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                    .disabled(transcribing || submitting)
                }
                .padding(.horizontal)
                .onReceive(timer) { _ in
                    if recorder.state == .recording { pulseOn.toggle() }
                }

                Spacer()
            }
            .padding(.top, 12)
            .navigationTitle("💡 Idea Inbox")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { onDismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: submit) {
                        if submitting {
                            ProgressView()
                        } else {
                            Text("存入").bold()
                        }
                    }
                    .disabled(submitting || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear { focused = true }
        }
    }

    private func toggleRecording() async {
        switch recorder.state {
        case .idle:
            voiceSource = "voice"
            await recorder.start()
        case .recording:
            transcribing = true
            defer { transcribing = false }
            if let transcript = await recorder.stopAndTranscribe(), !transcript.isEmpty {
                // Append (don't replace) so users can keep iterating.
                if text.isEmpty {
                    text = transcript
                } else {
                    text = text.trimmingCharacters(in: .whitespacesAndNewlines) + "\n" + transcript
                }
            }
        case .starting, .uploading, .error:
            // Transient or error state — best to cancel and reset.
            recorder.cancel()
        }
    }

    private func submit() {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !submitting else { return }
        submitting = true
        error = nil
        Task {
            do {
                _ = try await api.capture(body: body, source: "ios")
                await MainActor.run {
                    submitting = false
                    saved = true
                    text = ""
                }
                // Auto-dismiss after a short success indicator
                try? await Task.sleep(nanoseconds: 700_000_000)
                await MainActor.run { onDismiss() }
            } catch {
                await MainActor.run {
                    submitting = false
                    self.error = (error as NSError).localizedDescription
                }
            }
        }
    }
}
