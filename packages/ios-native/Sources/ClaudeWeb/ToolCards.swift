// Per-tool card views. ChatLineView dispatches a .toolUse ChatLine to one
// of these based on `toolName`. Each card decodes the tool's input JSON
// into typed fields and renders something more useful than "🔧 Bash".
//
// Cards keep themselves compact by default (collapsed body) so a long
// answer with many tool calls doesn't overflow the screen. Tap to expand.

import SwiftUI

struct ToolUseRow: View {
    let line: ChatLine

    var body: some View {
        switch line.toolName {
        case "Bash":      BashCard(line: line)
        case "Edit":      EditCard(line: line)
        case "Write":     WriteCard(line: line)
        case "Read":      ReadCard(line: line)
        case "TodoWrite": TodoWriteCard(line: line)
        case "Grep":      GrepCard(line: line)
        case "Glob":      GlobCard(line: line)
        default:          GenericToolCard(line: line)
        }
    }
}

// MARK: - Card chrome

private struct CardShell<Content: View>: View {
    let icon: String
    let title: String
    let subtitle: String?
    let initiallyExpanded: Bool
    @State private var expanded: Bool
    let content: () -> Content

    init(icon: String, title: String, subtitle: String? = nil, initiallyExpanded: Bool = false, @ViewBuilder content: @escaping () -> Content) {
        self.icon = icon
        self.title = title
        self.subtitle = subtitle
        self.initiallyExpanded = initiallyExpanded
        self._expanded = State(initialValue: initiallyExpanded)
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                expanded.toggle()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: icon)
                        .foregroundStyle(Color.accentColor)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(.caption.bold())
                            .foregroundStyle(.primary)
                        if let subtitle {
                            Text(subtitle)
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                    Spacer()
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .foregroundStyle(.tertiary)
                        .font(.caption2)
                }
                .padding(8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if expanded {
                Divider()
                content()
                    .padding(8)
            }
        }
        .background(Color(.systemGray6), in: .rect(cornerRadius: 8))
    }
}

// MARK: - Helpers

private func decodeInput<T: Decodable>(_ json: String?, as type: T.Type) -> T? {
    guard let json, let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
}

private struct PrettyJSON: View {
    let raw: String?
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(raw ?? "{}")
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}

// MARK: - Bash

private struct BashCard: View {
    let line: ChatLine
    @Environment(AppSettings.self) private var settings
    private struct Input: Decodable {
        let command: String?
        let description: String?
    }
    var body: some View {
        let input = decodeInput(line.toolInputJSON, as: Input.self)
        let cmd = input?.command ?? ""
        CardShell(
            icon: "terminal.fill",
            title: "Bash",
            subtitle: cmd.isEmpty ? nil : cmd,
            initiallyExpanded: settings.verboseTools
        ) {
            VStack(alignment: .leading, spacing: 6) {
                if let desc = input?.description, !desc.isEmpty {
                    Text(desc).font(.caption2).foregroundStyle(.secondary)
                }
                Text(cmd.isEmpty ? "(no command)" : cmd)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(Color(.systemGray5), in: .rect(cornerRadius: 6))
            }
        }
    }
}

// MARK: - Edit

private struct EditCard: View {
    let line: ChatLine
    @Environment(AppSettings.self) private var settings
    private struct Input: Decodable {
        let file_path: String?
        let old_string: String?
        let new_string: String?
        let replace_all: Bool?
    }
    var body: some View {
        let input = decodeInput(line.toolInputJSON, as: Input.self)
        let path = input?.file_path ?? ""
        CardShell(
            icon: "square.and.pencil",
            title: "Edit",
            subtitle: (path as NSString).lastPathComponent,
            initiallyExpanded: settings.verboseTools
        ) {
            VStack(alignment: .leading, spacing: 6) {
                if !path.isEmpty {
                    Text(path).font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
                if let old = input?.old_string, !old.isEmpty {
                    diffBlock(label: "−", text: old, color: .red)
                }
                if let new = input?.new_string, !new.isEmpty {
                    diffBlock(label: "+", text: new, color: .green)
                }
                if input?.replace_all == true {
                    Text("replace_all = true")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }
        }
    }

    private func diffBlock(label: String, text: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(label).font(.caption.bold()).foregroundStyle(color)
            Text(text)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(6)
                .background(color.opacity(0.08), in: .rect(cornerRadius: 4))
        }
    }
}

// MARK: - Write

private struct WriteCard: View {
    let line: ChatLine
    @Environment(AppSettings.self) private var settings
    private struct Input: Decodable {
        let file_path: String?
        let content: String?
    }
    var body: some View {
        let input = decodeInput(line.toolInputJSON, as: Input.self)
        let path = input?.file_path ?? ""
        let content = input?.content ?? ""
        CardShell(
            icon: "doc.fill.badge.plus",
            title: "Write",
            subtitle: (path as NSString).lastPathComponent,
            initiallyExpanded: settings.verboseTools
        ) {
            VStack(alignment: .leading, spacing: 6) {
                if !path.isEmpty {
                    Text(path).font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
                Text("\(content.count) 字符")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(content)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .lineLimit(20)
                    .padding(6)
                    .background(Color(.systemGray5), in: .rect(cornerRadius: 4))
            }
        }
    }
}

// MARK: - Read

private struct ReadCard: View {
    let line: ChatLine
    @Environment(AppSettings.self) private var settings
    private struct Input: Decodable {
        let file_path: String?
        let offset: Int?
        let limit: Int?
    }
    var body: some View {
        let input = decodeInput(line.toolInputJSON, as: Input.self)
        let path = input?.file_path ?? ""
        var line2 = (path as NSString).lastPathComponent
        if let limit = input?.limit {
            let start = input?.offset ?? 1
            line2 += "  · \(start)..\(start + limit - 1)"
        }
        return CardShell(
            icon: "doc.text.magnifyingglass",
            title: "Read",
            subtitle: line2,
            initiallyExpanded: settings.verboseTools
        ) {
            VStack(alignment: .leading, spacing: 4) {
                if !path.isEmpty {
                    Text(path).font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
                if let offset = input?.offset {
                    Text("offset: \(offset)").font(.caption2).foregroundStyle(.secondary)
                }
                if let limit = input?.limit {
                    Text("limit: \(limit)").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }
}

// MARK: - TodoWrite

private struct TodoWriteCard: View {
    let line: ChatLine
    @Environment(AppSettings.self) private var settings
    private struct Input: Decodable {
        let todos: [Todo]?
    }
    private struct Todo: Decodable, Identifiable {
        let content: String?
        let status: String?
        let activeForm: String?
        var id: String { (content ?? "") + (status ?? "") }
    }
    var body: some View {
        let input = decodeInput(line.toolInputJSON, as: Input.self)
        let todos = input?.todos ?? []
        let summary = "\(todos.count) 项 · " +
            "\(todos.filter { $0.status == "completed" }.count) 完成"
        return CardShell(
            icon: "checklist",
            title: "TodoWrite",
            subtitle: summary,
            initiallyExpanded: settings.verboseTools
        ) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(todos) { todo in
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: icon(for: todo.status))
                            .foregroundStyle(color(for: todo.status))
                        Text(displayText(for: todo))
                            .font(.caption)
                            .strikethrough(todo.status == "completed")
                            .foregroundStyle(todo.status == "completed" ? .secondary : .primary)
                    }
                }
                if todos.isEmpty {
                    Text("(empty list)").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func icon(for status: String?) -> String {
        switch status {
        case "completed": return "checkmark.circle.fill"
        case "in_progress": return "play.circle.fill"
        default: return "circle"
        }
    }
    private func color(for status: String?) -> Color {
        switch status {
        case "completed": return .green
        case "in_progress": return .orange
        default: return .secondary
        }
    }
    private func displayText(for todo: Todo) -> String {
        // While in_progress, the activeForm reads better ("Refactoring..."
        // vs "Refactor..."). Otherwise the imperative content is clearer.
        if todo.status == "in_progress", let active = todo.activeForm, !active.isEmpty {
            return active
        }
        return todo.content ?? ""
    }
}

// MARK: - Grep

private struct GrepCard: View {
    let line: ChatLine
    @Environment(AppSettings.self) private var settings
    private struct Input: Decodable {
        let pattern: String?
        let path: String?
        let glob: String?
        let output_mode: String?
    }
    var body: some View {
        let input = decodeInput(line.toolInputJSON, as: Input.self)
        return CardShell(
            icon: "magnifyingglass",
            title: "Grep",
            subtitle: input?.pattern,
            initiallyExpanded: settings.verboseTools
        ) {
            VStack(alignment: .leading, spacing: 4) {
                if let pat = input?.pattern {
                    Text("pattern: \(pat)").font(.caption2.monospaced())
                }
                if let path = input?.path {
                    Text("path: \(path)").font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
                if let glob = input?.glob {
                    Text("glob: \(glob)").font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
                if let mode = input?.output_mode {
                    Text("mode: \(mode)").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }
}

// MARK: - Glob

private struct GlobCard: View {
    let line: ChatLine
    @Environment(AppSettings.self) private var settings
    private struct Input: Decodable {
        let pattern: String?
        let path: String?
    }
    var body: some View {
        let input = decodeInput(line.toolInputJSON, as: Input.self)
        return CardShell(
            icon: "doc.on.doc",
            title: "Glob",
            subtitle: input?.pattern,
            initiallyExpanded: settings.verboseTools
        ) {
            VStack(alignment: .leading, spacing: 4) {
                if let pat = input?.pattern {
                    Text("pattern: \(pat)").font(.caption2.monospaced())
                }
                if let path = input?.path {
                    Text("path: \(path)").font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
            }
        }
    }
}

// MARK: - Generic fallback

private struct GenericToolCard: View {
    let line: ChatLine
    @Environment(AppSettings.self) private var settings
    var body: some View {
        CardShell(
            icon: "wrench.and.screwdriver",
            title: line.toolName ?? "Tool",
            subtitle: nil,
            initiallyExpanded: settings.verboseTools
        ) {
            PrettyJSON(raw: line.toolInputJSON)
        }
    }
}
