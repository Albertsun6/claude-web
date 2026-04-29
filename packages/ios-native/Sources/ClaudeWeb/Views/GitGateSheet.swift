// "Out the door" check (H5). Shown automatically after a completed turn that
// left a dirty git working tree. The user gets a snapshot of what changed
// before they walk away — no commit/test/lint actions yet, just visibility.

import SwiftUI

struct GitGateSheet: View {
    let report: GitStatusReport
    let cwd: String
    let onClose: () -> Void
    let onCopySummary: () -> Void

    @State private var copied = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "arrow.triangle.branch")
                            .foregroundStyle(Color.accentColor)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(report.branch ?? "(detached)")
                                .font(.system(.headline, design: .monospaced))
                            HStack(spacing: 8) {
                                if report.ahead > 0 {
                                    Label("ahead \(report.ahead)", systemImage: "arrow.up")
                                        .labelStyle(.titleAndIcon)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                if report.behind > 0 {
                                    Label("behind \(report.behind)", systemImage: "arrow.down")
                                        .labelStyle(.titleAndIcon)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Text("\(report.files.count) 处变化")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                    }
                    .padding(.vertical, 2)
                } footer: {
                    Text(cwd)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                if !report.staged.isEmpty {
                    Section("已暂存（\(report.staged.count)）") {
                        ForEach(report.staged) { f in fileRow(f) }
                    }
                }

                if !report.modified.isEmpty {
                    Section("已修改（\(report.modified.count)）") {
                        ForEach(report.modified) { f in fileRow(f) }
                    }
                }

                if !report.untracked.isEmpty {
                    Section("未跟踪（\(report.untracked.count)）") {
                        ForEach(report.untracked) { f in fileRow(f) }
                    }
                }

                Section {
                    Button {
                        onCopySummary()
                        copied = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
                    } label: {
                        HStack {
                            Image(systemName: copied ? "checkmark.circle.fill" : "doc.on.clipboard")
                                .foregroundStyle(copied ? .green : Color.accentColor)
                            Text(copied ? "已复制" : "复制变更摘要")
                        }
                    }
                } footer: {
                    Text("纯文本摘要：分支 + 文件路径 + 状态码。粘到日志或 commit message 用。")
                }
            }
            .navigationTitle("本轮变更")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("关闭") { onClose() }.fontWeight(.semibold)
                }
            }
        }
    }

    @ViewBuilder
    private func fileRow(_ f: GitStatusFile) -> some View {
        HStack(spacing: 8) {
            statusBadge(f)
            Text(f.path)
                .font(.system(.callout, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
        }
    }

    private func statusBadge(_ f: GitStatusFile) -> some View {
        let (label, color) = badgeContent(for: f)
        return Text(label)
            .font(.system(.caption2, design: .monospaced).bold())
            .frame(width: 18, height: 18)
            .background(color.opacity(0.18), in: .rect(cornerRadius: 4))
            .foregroundStyle(color)
    }

    private func badgeContent(for f: GitStatusFile) -> (String, Color) {
        if f.isUntracked { return ("?", .gray) }
        let i = f.indexStatus.trimmingCharacters(in: .whitespaces)
        let w = f.workingStatus.trimmingCharacters(in: .whitespaces)
        let label = i.isEmpty ? w : i
        return (label, colorForCode(label))
    }

    private func colorForCode(_ c: String) -> Color {
        switch c {
        case "M": return .orange
        case "A": return .green
        case "D": return .red
        case "R", "C": return .purple
        case "U": return .pink
        default: return .gray
        }
    }
}

extension GitStatusReport {
    /// Plain-text summary suitable for clipboard / commit-message hint.
    func renderSummary(cwd: String) -> String {
        var lines: [String] = []
        lines.append("Git 变更（\(branch ?? "?"))")
        lines.append("cwd: \(cwd)")
        if ahead > 0 || behind > 0 {
            lines.append("ahead \(ahead) behind \(behind)")
        }
        lines.append("")
        for f in files {
            lines.append("\(f.indexStatus)\(f.workingStatus) \(f.path)")
        }
        return lines.joined(separator: "\n")
    }
}
