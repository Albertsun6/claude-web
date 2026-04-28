import SwiftUI

/// New-conversation form: pick from already-opened cwds, or browse to open
/// a new directory. No default — user must explicitly choose so they don't
/// accidentally land in the wrong project. Most-recent cwd is pre-selected
/// for the common "another conversation in the project I just used" flow.
struct NewConversationSheet: View {
    let pickerStartPath: String  // Where DirectoryPicker opens, NOT a cwd default
    let onCreate: (_ name: String, _ cwd: String) -> Void

    @Environment(BackendClient.self) private var client
    @Environment(\.dismiss) private var dismiss
    @State private var name: String = ""
    @State private var cwd: String? = nil
    /// Tracks whether the user has manually edited the name. While false,
    /// the name auto-updates when cwd changes (so picking a different
    /// directory updates the suggested name). User typing flips it true.
    @State private var nameEdited: Bool = false
    @State private var showPicker: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(autoNamePlaceholder, text: $name)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: name) { _, new in
                            // If user clears the field, treat as un-edited so
                            // it auto-tracks cwd again. Otherwise mark edited
                            // unless the new value matches what we'd auto-fill.
                            if new.isEmpty {
                                nameEdited = false
                            } else if new != currentAutoName {
                                nameEdited = true
                            }
                        }
                } header: {
                    Text("名称")
                } footer: {
                    Text("自动按工作目录命名。第一次发消息后会改成消息开头 30 字（除非你给了自定义名字）。")
                }
                Section {
                    Button {
                        showPicker = true
                    } label: {
                        Label("打开文件夹", systemImage: "folder.badge.plus")
                            .foregroundStyle(Color.accentColor)
                    }
                    if openedCwds.isEmpty {
                        Text("还没打开过项目，点上面浏览选一个。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(openedCwds, id: \.cwd) { item in
                            Button {
                                cwd = item.cwd
                            } label: {
                                OpenedCwdRow(
                                    item: item,
                                    selected: cwd == item.cwd
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } header: {
                    Text("工作目录")
                } footer: {
                    Text("Claude CLI 在此目录下运行。每条对话绑定一个目录，不可中途改。")
                }
            }
            .navigationTitle("新对话")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("开始") {
                        guard let chosenCwd = cwd?.trimmingCharacters(in: .whitespaces),
                              !chosenCwd.isEmpty else { return }
                        // Pass empty string for auto-name so backend's
                        // counter increments; otherwise pass user's name.
                        let finalName = nameEdited ? name : ""
                        onCreate(finalName, chosenCwd)
                    }
                    .fontWeight(.bold)
                    .disabled(cwd == nil)
                }
            }
            .navigationDestination(isPresented: $showPicker) {
                // Always start the picker at the default browse root, never
                // at the currently-selected cwd. User opening "打开文件夹"
                // again expects a fresh navigation, not "stuck inside the
                // last folder I picked".
                DirectoryPicker(initialPath: pickerStartPath) { picked in
                    cwd = picked
                }
            }
            .onAppear {
                // Pre-select most-recently-used cwd as a hint. If none, leave
                // nil and force user to pick via browse.
                if cwd == nil {
                    cwd = openedCwds.first?.cwd
                }
                if name.isEmpty {
                    name = currentAutoName
                }
            }
            .onChange(of: cwd) { _, _ in
                if !nameEdited {
                    name = currentAutoName
                }
            }
        }
    }

    /// What auto-name would be assigned given the currently-selected cwd.
    /// Empty string when no cwd is picked yet — used as the TextField
    /// placeholder and as the value when the user hasn't edited.
    private var currentAutoName: String {
        guard let c = cwd else { return "" }
        return client.peekNextAutoName(forCwd: c)
    }

    /// Placeholder shown in the name TextField. Encourages the user to pick
    /// a cwd first when none is chosen.
    private var autoNamePlaceholder: String {
        if let c = cwd {
            return client.peekNextAutoName(forCwd: c)
        }
        return "请先选工作目录"
    }

    /// All cwds with at least one existing in-memory conversation, with
    /// stats for display. Sorted most-recently-used first.
    private var openedCwds: [OpenedCwd] {
        let dict = Dictionary(grouping: client.conversations.values, by: \.cwd)
        return dict.map { cwd, convs in
            OpenedCwd(
                cwd: cwd,
                count: convs.count,
                lastUsed: convs.map(\.lastUsed).max() ?? .distantPast
            )
        }
        .sorted { $0.lastUsed > $1.lastUsed }
    }
}

private struct OpenedCwd: Identifiable {
    let cwd: String
    let count: Int
    let lastUsed: Date
    var id: String { cwd }
    var basename: String {
        let n = (cwd as NSString).lastPathComponent
        return n.isEmpty ? cwd : n
    }
}

private struct OpenedCwdRow: View {
    let item: OpenedCwd
    let selected: Bool

    private static let relFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        f.locale = Locale(identifier: "zh_CN")
        return f
    }()

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.basename)
                    .font(.body)
                    .foregroundStyle(.primary)
                Text(item.cwd)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("\(item.count) 个对话 · \(Self.relFormatter.localizedString(for: item.lastUsed, relativeTo: Date()))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Spacer()
            if selected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.accentColor)
                    .font(.title3)
            }
        }
        .contentShape(Rectangle())
    }
}
