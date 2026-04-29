// H4 context attachment panel. Tapping the paperclip in InputBar opens this
// half-sheet. Each source row shows availability + size; tapping appends a
// readable, code-fenced block to the prompt draft. The user sees the
// injected text inline in the input box and can edit/delete it freely.
//
// V1 sources: git diff (HEAD..worktree) + clipboard text. URL fetch / GitHub
// issue / git log live in later iterations.

import SwiftUI

struct ContextAttachSheet: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    let cwd: String
    let onInject: (String) -> Void

    @State private var diffState: SourceState<GitDiffResponse> = .idle
    @State private var clipboardPreview: String?

    private var contextAPI: ContextAPI {
        ContextAPI(backend: { settings.backendURL }, token: { settings.authToken })
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    gitDiffRow
                } header: {
                    Text("Git 上下文")
                }

                Section {
                    clipboardRow
                } header: {
                    Text("剪贴板")
                }
            }
            .navigationTitle("附加上下文")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("关闭") { dismiss() }.fontWeight(.semibold)
                }
            }
            .task {
                await loadDiff()
                refreshClipboard()
            }
            .onAppear {
                refreshClipboard()
            }
        }
    }

    // MARK: - Git diff

    @ViewBuilder
    private var gitDiffRow: some View {
        switch diffState {
        case .idle, .loading:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("正在读取 git diff...").foregroundStyle(.secondary)
            }
        case .empty:
            HStack(spacing: 8) {
                Image(systemName: "checkmark.seal").foregroundStyle(.green)
                Text("工作区干净（无变更）").foregroundStyle(.secondary)
            }
        case .notRepo:
            HStack(spacing: 8) {
                Image(systemName: "questionmark.folder").foregroundStyle(.secondary)
                Text("当前 cwd 不是 git 仓库").foregroundStyle(.secondary)
            }
        case .failed(let msg):
            VStack(alignment: .leading, spacing: 4) {
                Label("读取失败", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .font(.callout)
                Text(msg).font(.caption).foregroundStyle(.secondary)
                Button("重试") { Task { await loadDiff() } }
                    .font(.caption)
            }
        case .loaded(let resp):
            Button {
                onInject(formatGitDiff(resp))
                dismiss()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "doc.text.below.ecg")
                        .foregroundStyle(Color.accentColor)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("当前 git diff").font(.callout).foregroundStyle(.primary)
                        Text("\(formatBytes(resp.bytes))\(resp.truncated ? " · 已截断到 \(formatBytes(resp.maxBytes))" : "")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "plus.circle.fill")
                        .foregroundStyle(Color.accentColor)
                }
            }
        }
    }

    private func loadDiff() async {
        diffState = .loading
        do {
            guard let resp = try await contextAPI.getGitDiff(cwd: cwd) else {
                diffState = .notRepo
                return
            }
            if resp.diff.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                diffState = .empty
            } else {
                diffState = .loaded(resp)
            }
        } catch {
            diffState = .failed(error.localizedDescription)
        }
    }

    private func formatGitDiff(_ resp: GitDiffResponse) -> String {
        var lines: [String] = []
        lines.append("<git_diff cwd=\"\(cwd)\"\(resp.truncated ? " truncated=\"true\"" : "")>")
        lines.append("```diff")
        lines.append(resp.diff)
        lines.append("```")
        lines.append("</git_diff>")
        return lines.joined(separator: "\n")
    }

    // MARK: - Clipboard

    @ViewBuilder
    private var clipboardRow: some View {
        if let text = clipboardPreview, !text.isEmpty {
            Button {
                onInject(formatClipboard(text))
                dismiss()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "doc.on.clipboard")
                        .foregroundStyle(Color.accentColor)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("剪贴板文本").font(.callout).foregroundStyle(.primary)
                        Text(previewLine(text))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer()
                    Image(systemName: "plus.circle.fill")
                        .foregroundStyle(Color.accentColor)
                }
            }
        } else {
            HStack(spacing: 8) {
                Image(systemName: "doc.on.clipboard").foregroundStyle(.secondary)
                Text("剪贴板为空或非文本").foregroundStyle(.secondary)
                Spacer()
                Button("刷新") { refreshClipboard() }
                    .font(.caption)
            }
        }
    }

    private func refreshClipboard() {
        clipboardPreview = UIPasteboard.general.string
    }

    private func formatClipboard(_ text: String) -> String {
        var lines: [String] = []
        lines.append("<clipboard>")
        lines.append(text)
        lines.append("</clipboard>")
        return lines.joined(separator: "\n")
    }

    private func previewLine(_ text: String) -> String {
        let line = text.split(whereSeparator: { $0.isNewline }).first ?? Substring(text)
        return "\(text.count) 字 · \(line)"
    }

    private func formatBytes(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        let k = Double(bytes) / 1024.0
        if k < 1024 { return String(format: "%.1f KB", k) }
        return String(format: "%.1f MB", k / 1024.0)
    }
}

private enum SourceState<T: Equatable>: Equatable {
    case idle
    case loading
    case empty
    case notRepo
    case loaded(T)
    case failed(String)
}
