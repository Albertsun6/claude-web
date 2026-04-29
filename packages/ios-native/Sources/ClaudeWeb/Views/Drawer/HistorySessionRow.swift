import SwiftUI

/// Collapsible history session list for a project. Shows all historical
/// jsonl sessions from ~/.claude/projects/, filtered to hide sessions that
/// are already loaded as conversations. Calls registry.loadHistorySessions on
/// expand to fetch metadata from /api/sessions/list. Calls
/// registry.openHistoricalSession on row tap to load transcript and adopt.
struct CwdHistorySection: View {
    let project: ProjectDTO?
    let onSelect: () -> Void

    @Environment(ProjectRegistry.self) private var registry
    @Environment(BackendClient.self) private var client

    @State private var expanded = false
    @State private var loading = false
    @State private var loadError: String?

    @ViewBuilder
    var body: some View {
        if let project {
            VStack(spacing: 0) {
                Button { toggle(project: project) } label: {
                    HStack {
                        Label("历史会话", systemImage: "clock")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        if loading { ProgressView().scaleEffect(0.7) }
                        else {
                            Image(systemName: expanded ? "chevron.up" : "chevron.down")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                .buttonStyle(.plain).padding(.vertical, 6)

                if expanded {
                    let known = Set(client.conversations.values.compactMap { $0.sessionId })
                    let items = (registry.historyByProject[project.id] ?? [])
                        .filter { !known.contains($0.sessionId) }
                    if let err = loadError {
                        Text(err).font(.caption).foregroundStyle(.red).padding(.vertical, 4)
                    } else if items.isEmpty && !loading {
                        Text("暂无更多历史")
                            .font(.caption2).foregroundStyle(.tertiary).padding(.vertical, 4)
                    } else {
                        ForEach(items) { session in
                            HistorySessionRow(
                                session: session,
                                project: project,
                                onSelect: onSelect
                            )
                        }
                    }
                }
            }
        }
    }

    private func toggle(project: ProjectDTO) {
        expanded.toggle()
        if expanded,
           registry.historyByProject[project.id] == nil,
           !loading {
            Task { await load(project: project) }
        }
    }

    private func load(project: ProjectDTO) async {
        loading = true; loadError = nil
        do { try await registry.loadHistorySessions(forProject: project) }
        catch { loadError = error.localizedDescription }
        loading = false
    }
}

/// Single row in the history list. Shows preview text and relative time.
/// Tapping calls registry.openHistoricalSession, switches focus, and closes drawer.
struct HistorySessionRow: View {
    let session: SessionMeta
    let project: ProjectDTO
    let onSelect: () -> Void

    @Environment(ProjectRegistry.self) private var registry
    @Environment(BackendClient.self) private var client

    @State private var loading = false
    @State private var loadError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button {
                Task { await open() }
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.preview.isEmpty ? "（空会话）" : session.preview)
                            .font(.caption).lineLimit(2).foregroundStyle(.primary)
                        Text(session.modifiedAt, style: .relative)
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if loading { ProgressView().scaleEffect(0.7) }
                }
            }
            .buttonStyle(.plain).disabled(loading)

            if let err = loadError {
                Text("加载失败：\(err)")
                    .font(.caption2).foregroundStyle(.red)
            }
        }
        .padding(.vertical, 4)
    }

    private func open() async {
        loading = true; loadError = nil
        do {
            let convId = try await registry.openHistoricalSession(session, in: project)
            client.currentConversationId = convId
            onSelect()
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }
}
