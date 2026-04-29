// H1 run dashboard. Tap the orange `activeRunCount` badge in the toolbar →
// half-sheet listing every conversation with state, sorted active-first.
// Each row shows: title · cwd basename · last tool + brief input preview ·
// duration. Tap a row to switch focus; tap the stop pill to interrupt the
// background run without switching.

import SwiftUI

struct RunsDashboardSheet: View {
    @Environment(BackendClient.self) private var client
    @Environment(\.dismiss) private var dismiss

    /// Re-tick to keep "running for 2m" accurate while the sheet is open.
    @State private var nowTick = Date()
    private let timer = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            List {
                let rows = makeRows()

                if rows.isEmpty {
                    Section {
                        VStack(spacing: 6) {
                            Image(systemName: "tray").font(.title2).foregroundStyle(.secondary)
                            Text("还没有对话").font(.callout).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                    }
                }

                let active = rows.filter { $0.busy }
                let idle = rows.filter { !$0.busy }

                if !active.isEmpty {
                    Section {
                        ForEach(active) { row in runRowView(row) }
                    } header: {
                        HStack(spacing: 6) {
                            Circle().fill(.orange).frame(width: 8, height: 8)
                            Text("进行中（\(active.count)）")
                        }
                    }
                }

                if !idle.isEmpty {
                    Section("最近") {
                        ForEach(idle.prefix(20)) { row in runRowView(row) }
                    }
                }
            }
            .navigationTitle("运行中")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("关闭") { dismiss() }.fontWeight(.semibold)
                }
            }
            .onReceive(timer) { now in nowTick = now }
        }
    }

    @ViewBuilder
    private func runRowView(_ row: RunRow) -> some View {
        Button {
            client.currentConversationId = row.id
            dismiss()
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if row.busy {
                        ProgressView().controlSize(.small)
                    }
                    Text(row.title)
                        .font(.callout)
                        .lineLimit(1)
                        .foregroundStyle(.primary)
                    Spacer()
                    if let dur = row.runningFor(now: nowTick) {
                        Text(dur)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    if row.busy {
                        Button {
                            client.interrupt(convId: row.id)
                        } label: {
                            Text("停止")
                                .font(.caption2.bold())
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(.red.opacity(0.15), in: .capsule)
                                .foregroundStyle(.red)
                        }
                        .buttonStyle(.plain)
                    }
                }

                HStack(spacing: 6) {
                    Image(systemName: "folder")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(row.cwdBasename)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                if let tool = row.lastToolDescription {
                    HStack(spacing: 6) {
                        Image(systemName: "wrench.and.screwdriver")
                            .font(.caption2)
                            .foregroundStyle(Color.accentColor)
                        Text(tool)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }

    // MARK: - Row construction

    private func makeRows() -> [RunRow] {
        client.conversations.values
            .map { conv in
                let s = client.stateByConversation[conv.id]
                return RunRow(conversation: conv, state: s)
            }
            .sorted { lhs, rhs in
                if lhs.busy != rhs.busy { return lhs.busy }
                return lhs.lastUsed > rhs.lastUsed
            }
    }
}

// MARK: - Row model

private struct RunRow: Identifiable {
    let id: String
    let title: String
    let cwd: String
    let busy: Bool
    let runId: String?
    let runStartedAt: Date?
    let lastToolName: String?
    let lastToolInputJSON: String?
    let lastUsed: Date

    init(conversation: Conversation, state: ConversationChatState?) {
        self.id = conversation.id
        self.title = conversation.title
        self.cwd = conversation.cwd
        self.busy = state?.busy ?? false
        self.runId = state?.currentRunId
        self.runStartedAt = state?.runStartedAt
        self.lastUsed = conversation.lastUsed

        // Find the most recent toolUse line for this run.
        if let s = state, let runId = s.currentRunId {
            let lastTool = s.messages.reversed().first { line in
                line.runId == runId && line.role == .toolUse
            }
            self.lastToolName = lastTool?.toolName
            self.lastToolInputJSON = lastTool?.toolInputJSON
        } else {
            // For non-active conversations, show the LAST toolUse ever.
            let lastTool = state?.messages.reversed().first { $0.role == .toolUse }
            self.lastToolName = lastTool?.toolName
            self.lastToolInputJSON = lastTool?.toolInputJSON
        }
    }

    var cwdBasename: String {
        (cwd as NSString).lastPathComponent
    }

    var lastToolDescription: String? {
        guard let name = lastToolName else { return nil }
        let preview = lastToolInputJSON.flatMap(toolInputPreview) ?? ""
        return preview.isEmpty ? name : "\(name): \(preview)"
    }

    func runningFor(now: Date) -> String? {
        guard busy, let started = runStartedAt else {
            // Not running — show "5 分钟前" relative for non-busy rows.
            return RelativeDateTimeFormatter().localizedString(for: lastUsed, relativeTo: now)
        }
        let elapsed = Int(now.timeIntervalSince(started))
        if elapsed < 60 { return "\(elapsed)s" }
        let m = elapsed / 60
        let s = elapsed % 60
        if m < 60 { return s == 0 ? "\(m)m" : "\(m)m\(s)s" }
        let h = m / 60
        return "\(h)h\(m % 60)m"
    }
}

/// Best-effort summarize of a tool's JSON input. Bash → command, Edit/Write/Read
/// → file_path. Falls back to empty.
private func toolInputPreview(_ json: String) -> String {
    guard let data = json.data(using: .utf8),
          let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return ""
    }
    if let cmd = dict["command"] as? String { return firstLine(cmd, limit: 60) }
    if let p = dict["file_path"] as? String { return (p as NSString).lastPathComponent }
    if let p = dict["path"] as? String { return (p as NSString).lastPathComponent }
    if let pat = dict["pattern"] as? String { return firstLine(pat, limit: 60) }
    if let url = dict["url"] as? String { return url }
    return ""
}

private func firstLine(_ s: String, limit: Int) -> String {
    let line = s.split(whereSeparator: { $0.isNewline }).first ?? Substring(s)
    return line.count > limit ? String(line.prefix(limit)) + "…" : String(line)
}
