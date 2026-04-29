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
            // Full markdown — headings, lists, tables, links, code blocks
            // with copy button. MarkdownUI re-parses on each text change so
            // streaming updates render correctly.
            Markdown(line.text)
                .markdownTheme(.gitHub)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .thinking:
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("思考中...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fontWeight(.medium)
                }
                .padding(.bottom, 2)

                Text(line.text)
                    .font(.system(size: 13, design: .default))
                    .foregroundStyle(.secondary)
                    .italic()
                    .textSelection(.enabled)
            }
            .padding(10)
            .background(.secondary.opacity(0.08), in: .rect(cornerRadius: 8))
            .frame(maxWidth: .infinity, alignment: .leading)
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
        case .toolUse:
            ToolUseRow(line: line)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .toolResult:
            ToolResultRow(line: line)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
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
