import SwiftUI
import MarkdownUI

struct ChatListView: View {
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
                // Empty chat area — tap to dismiss keyboard. Frame fills
                // remaining space so taps below the messages still hit it.
                .frame(maxWidth: .infinity, minHeight: 200, alignment: .top)
                .contentShape(Rectangle())
                .onTapGesture {
                    UIApplication.shared.sendAction(
                        #selector(UIResponder.resignFirstResponder),
                        to: nil, from: nil, for: nil
                    )
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
            // Drag chat list down → dismiss keyboard interactively. The
            // .interactively variant follows the finger so it feels like
            // iMessage / Telegram rather than an abrupt close.
            .scrollDismissesKeyboard(.interactively)
        }
    }
}

/// Crude detection for context-window-exceeded errors so we can render a
/// friendly recovery hint + "open new conversation" button. Backend's
/// auto-/compact in cli-runner.ts handles the common case; this is the
/// last-ditch UX when /compact also fails.
private func isPromptTooLong(_ msg: String) -> Bool {
    let lower = msg.lowercased()
    return lower.contains("prompt is too long")
        || lower.contains("上下文超限")
        || lower.contains("context length")
}

private struct ChatLineView: View {
    let line: ChatLine
    @Environment(AppSettings.self) private var settings
    @Environment(BackendClient.self) private var client

    var body: some View {
        switch line.role {
        case .user:
            HStack {
                Spacer(minLength: 40)
                Text(line.text)
                    .textSelection(.enabled)
                    .padding(10)
                    .background(Color.accentColor.opacity(0.18), in: .rect(cornerRadius: 12))
            }
        case .assistant:
            // Full markdown — headings, lists, tables, links, code blocks.
            // MarkdownUI re-parses on each text change so streaming updates render correctly.
            VStack(alignment: .leading, spacing: 6) {
                Markdown(line.text)
                    .markdownTheme(.gitHub)
                    .markdownBlockStyle(\.codeBlock) { configuration in
                        CodeBlockWithCopy(configuration: configuration)
                    }
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    UIPasteboard.general.string = line.text
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "doc.on.doc.fill")
                            .font(.caption2)
                        Text("复制全文")
                            .font(.caption2)
                    }
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        case .thinking:
            ThinkingBlockView(text: line.text, alwaysExpanded: settings.alwaysExpandThinking)
        case .system:
            Text(line.text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .padding(.vertical, 2)
        case .error:
            VStack(alignment: .leading, spacing: 8) {
                Text(line.text)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
                if isPromptTooLong(line.text) {
                    Text("提示：上下文超限通常是和 Mac 端 Claude Code 共用了同一对话，transcript 累积到模型上限。后端已尝试 /compact，如果反复出错建议开新对话。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        Button {
                            let cwd = client.conversations[client.currentConversationId ?? ""]?.cwd ?? settings.cwd
                            let newConv = client.createConversation(cwd: cwd)
                            client.currentConversationId = newConv.id
                        } label: {
                            Label("开新对话", systemImage: "plus.bubble")
                                .font(.caption.bold())
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    }
                }
            }
            .padding(8)
            .background(.red.opacity(0.08), in: .rect(cornerRadius: 8))
        case .toolUse:
            ToolUseRow(line: line)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .toolResult:
            ToolResultRow(line: line)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ThinkingBlockView: View {
    let text: String
    let alwaysExpanded: Bool
    @State private var expanded: Bool?

    var isExpanded: Bool {
        expanded ?? alwaysExpanded
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                expanded = !(isExpanded)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("思考中...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fontWeight(.medium)
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .buttonStyle(.plain)
            .padding(.bottom, 2)

            if isExpanded {
                Text(text)
                    .font(.system(size: 13, design: .default))
                    .foregroundStyle(.secondary)
                    .italic()
                    .textSelection(.enabled)
            }
        }
        .padding(10)
        .background(.secondary.opacity(0.08), in: .rect(cornerRadius: 8))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CodeBlockWithCopy: View {
    let configuration: CodeBlockConfiguration
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(configuration.language ?? "code")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    UIPasteboard.general.string = configuration.content
                    copied = true
                    Task {
                        try? await Task.sleep(nanoseconds: 1_500_000_000)
                        copied = false
                    }
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            .font(.caption2)
                        Text(copied ? "已复制" : "复制")
                            .font(.caption2)
                    }
                    .foregroundStyle(copied ? Color.green : .secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color(.systemGray5))

            ScrollView(.horizontal, showsIndicators: false) {
                configuration.label
                    .relativeLineSpacing(.em(0.25))
                    .markdownTextStyle { FontFamilyVariant(.monospaced) }
                    .padding(10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.systemGray6))
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct ToolResultRow: View {
    let line: ChatLine
    @State private var expanded = false

    private static let previewLines = 10

    var body: some View {
        let allLines = line.text.components(separatedBy: "\n")
        let lineCount = allLines.count
        let isLong = lineCount > Self.previewLines && !line.text.isEmpty

        VStack(alignment: .leading, spacing: 3) {
            // Header row: icon + count + expand button
            HStack(spacing: 5) {
                Image(systemName: line.isError ? "xmark.circle.fill" : "checkmark.circle.fill")
                    .font(.caption2)
                    .foregroundStyle(line.isError ? .red : .secondary)
                if line.text.isEmpty {
                    Text(line.isError ? "错误（无输出）" : "完成（无输出）")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                } else {
                    Text(line.isError ? "错误 · \(lineCount) 行" : "\(lineCount) 行")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if isLong {
                    Spacer()
                    Button(expanded ? "收起" : "展开全部") {
                        withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
                    }
                    .font(.caption2)
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.accentColor)
                }
            }

            // Content preview / full
            if !line.text.isEmpty {
                let shownText = (!expanded && isLong)
                    ? allLines.prefix(Self.previewLines).joined(separator: "\n")
                    : line.text
                Text(shownText)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(line.isError ? .red.opacity(0.85) : .secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                    .background(.secondary.opacity(0.07), in: .rect(cornerRadius: 6))

                if !expanded && isLong {
                    Text("… 还有 \(lineCount - Self.previewLines) 行")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}
