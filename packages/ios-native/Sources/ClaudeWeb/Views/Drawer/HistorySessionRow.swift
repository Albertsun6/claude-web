import SwiftUI

/// One row representing a historical jsonl session under a cwd. Tapping calls
/// registry.openHistoricalSession (loads transcript, adopts as conversation,
/// dedups on sessionId), switches focus, and closes the drawer.
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
