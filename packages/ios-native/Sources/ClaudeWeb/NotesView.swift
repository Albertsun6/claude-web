// 摘要模式 UI — 持续录音 → 实时显示文字稿 → 完成后展示 Markdown 总结。

import SwiftUI
import MarkdownUI

struct NotesView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(NotesSession.self) private var session

    @State private var tickToken: Int = 0  // 强制 SwiftUI 每秒重绘计时

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                header
                Divider()
                content
            }
            .navigationTitle("摘要模式")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("关闭") { handleClose() }
                }
            }
            .task(id: tickToken) {
                // 录音中每秒驱动一次计时器更新
                if session.state == .recording {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    tickToken &+= 1
                }
            }
        }
    }

    // MARK: - Header

    @ViewBuilder
    private var header: some View {
        switch session.state {
        case .idle:
            VStack(spacing: 6) {
                Text("打开麦克风后开始持续录音")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("讲完后按「完成」自动生成总结")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)

        case .recording:
            HStack(spacing: 10) {
                Image(systemName: "mic.fill")
                    .foregroundStyle(.red)
                    .font(.system(size: 16, weight: .semibold))
                    .symbolEffect(.pulse, isActive: true)
                Text(timeString(session.elapsedSeconds))
                    .font(.system(.title3, design: .monospaced).weight(.semibold))
                Spacer()
                Text(chunkProgress)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

        case .finishing:
            HStack(spacing: 10) {
                ProgressView().scaleEffect(0.9)
                Text("正在转写最后一段…")
                    .font(.subheadline)
                Spacer()
                Text("\(session.pendingChunks) 段处理中")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

        case .summarizing:
            HStack(spacing: 10) {
                ProgressView().scaleEffect(0.9)
                Text("正在生成总结…")
                    .font(.subheadline)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

        case .done:
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("总结完成")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

        case .error(let msg):
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text(msg)
                    .font(.caption)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.orange.opacity(0.15))
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch session.state {
        case .idle:
            VStack(spacing: 20) {
                Spacer()
                Button {
                    Task { await session.start() }
                } label: {
                    Label("开始录音", systemImage: "mic.circle.fill")
                        .font(.title2)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .recording:
            VStack(spacing: 0) {
                transcriptScroller
                Divider()
                Button {
                    Task { await session.finish() }
                } label: {
                    Label("完成 · 生成总结", systemImage: "stop.circle.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .padding(16)
            }

        case .finishing, .summarizing:
            transcriptScroller

        case .done, .error:
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !session.summary.isEmpty {
                        sectionHeader("总结", systemImage: "sparkles")
                        Markdown(session.summary)
                            .markdownTheme(.gitHub)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        HStack(spacing: 12) {
                            Button {
                                UIPasteboard.general.string = session.summary
                            } label: {
                                Label("复制总结", systemImage: "doc.on.doc")
                            }
                            .buttonStyle(.bordered)
                            ShareLink(item: session.summary) {
                                Label("分享", systemImage: "square.and.arrow.up")
                            }
                            .buttonStyle(.bordered)
                        }
                        .padding(.top, 4)
                    }
                    if !session.fullTranscript.isEmpty {
                        sectionHeader("原始文字稿", systemImage: "text.alignleft")
                        Text(session.fullTranscript)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button {
                            UIPasteboard.general.string = session.fullTranscript
                        } label: {
                            Label("复制原稿", systemImage: "doc.on.doc")
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    Button {
                        Task { await session.start() }
                    } label: {
                        Label("再来一段", systemImage: "arrow.clockwise.circle")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 12)
                }
                .padding(16)
            }
        }
    }

    private var transcriptScroller: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if session.chunks.isEmpty && session.pendingChunks == 0 {
                        Text("（开始说话即可，文字稿会逐段出现）")
                            .font(.callout)
                            .foregroundStyle(.tertiary)
                    } else {
                        ForEach(Array(session.chunks.enumerated()), id: \.offset) { idx, chunk in
                            Text(chunk)
                                .font(.callout)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                                .id(idx)
                        }
                        if session.pendingChunks > 0 {
                            HStack(spacing: 6) {
                                ProgressView().scaleEffect(0.7)
                                Text("\(session.pendingChunks) 段转写中…")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .id("__pending__")
                        }
                    }
                }
                .padding(16)
            }
            .onChange(of: session.chunks.count) { _, _ in
                let lastIdx = session.chunks.count - 1
                if lastIdx >= 0 {
                    withAnimation { proxy.scrollTo(lastIdx, anchor: .bottom) }
                }
            }
        }
    }

    private func sectionHeader(_ title: String, systemImage: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
        }
    }

    private var chunkProgress: String {
        let done = session.chunks.count
        let pending = session.pendingChunks
        if pending == 0 { return "\(done) 段已转写" }
        return "\(done) 段已转写 · \(pending) 段处理中"
    }

    private func timeString(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        return String(format: "%02d:%02d", m, s)
    }

    /// 关闭弹窗。若仍在录音 / 处理，先取消会话避免后台残留。
    private func handleClose() {
        switch session.state {
        case .recording, .finishing, .summarizing:
            session.cancel()
        default:
            break
        }
        dismiss()
    }
}
