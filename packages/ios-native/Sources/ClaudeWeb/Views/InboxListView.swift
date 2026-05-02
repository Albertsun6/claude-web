// Inbox list view — see all 碎想 captured via the 💡 button or web POST.
// Tap an item → "处理为新对话" (turn the captured text into a fresh prompt
// in a new conversation; backend marks the inbox item processed).

import SwiftUI

struct InboxListView: View {
    @Environment(InboxAPI.self) private var inboxAPI
    @Environment(BackendClient.self) private var client
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    @State private var items: [InboxItem] = []
    @State private var stats: InboxStats?
    @State private var loadState: LoadState = .idle
    @State private var showOnlyUnprocessed = true
    @State private var processingIds: Set<String> = []
    @State private var tab: Tab = .inbox

    enum Tab: Hashable { case inbox, queue }

    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $tab) {
                    Text("💡 碎想 (\(stats?.total ?? items.count))").tag(Tab.inbox)
                    Text("📥 当前队列 (\(client.currentPendingQueue.count))").tag(Tab.queue)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.top, 8)

                if tab == .inbox {
                    inboxBody
                } else {
                    queueBody
                }
            }
            .navigationTitle(tab == .inbox ? "💡 碎想 Inbox" : "📥 当前对话队列")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .task { await load() }
        }
    }

    @ViewBuilder
    private var inboxBody: some View {
        VStack(spacing: 0) {
            if let stats {
                HStack {
                    Label("总计 \(stats.total)", systemImage: "tray.full")
                    Spacer()
                    Label("未处理 \(stats.unprocessed)", systemImage: "tray.fill")
                        .foregroundStyle(stats.unprocessed > 0 ? Color.orange : Color.secondary)
                }
                .font(.caption)
                .padding(.horizontal)
                .padding(.top, 8)
            }
            Toggle("只看未处理", isOn: $showOnlyUnprocessed)
                .padding(.horizontal)
                .padding(.vertical, 6)
                .onChange(of: showOnlyUnprocessed) { _, _ in
                    Task { await load() }
                }
            content
        }
    }

    @ViewBuilder
    private var queueBody: some View {
        let queue = client.currentPendingQueue
        if queue.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "list.bullet.rectangle.portrait")
                    .font(.system(size: 40))
                    .foregroundStyle(.secondary)
                Text("当前对话没有排队消息")
                    .font(.subheadline).foregroundStyle(.secondary)
                Text("Claude 正在跑任务时，输入框旁的 [📑+ 排队] 按钮可以把下一条 prompt 加入队列。任务跑完会自动按顺序发出。")
                    .font(.caption).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
                    .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List {
                Section {
                    ForEach(queue) { qp in
                        queueRow(qp)
                    }
                    .onDelete { idx in
                        for i in idx {
                            client.removeQueuedPrompt(id: queue[i].id)
                        }
                    }
                } footer: {
                    Text("Claude 跑完当前 turn 时会按顺序自动发出。左滑或长按可删除。")
                        .font(.caption)
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    @ViewBuilder
    private func queueRow(_ qp: QueuedPrompt) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(qp.text)
                .font(.body)
                .lineLimit(4)
            HStack(spacing: 8) {
                Text(qp.model.replacingOccurrences(of: "claude-", with: ""))
                    .font(.caption2.monospaced())
                Text("·").foregroundStyle(.tertiary)
                Text(qp.permissionMode)
                    .font(.caption2.monospaced())
                Spacer()
                Button(role: .destructive) {
                    client.removeQueuedPrompt(id: qp.id)
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var content: some View {
        switch loadState {
        case .idle, .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let msg):
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle").font(.title)
                Text("加载失败：\(msg)").font(.caption).foregroundStyle(.red)
                Button("重试") { Task { await load() } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded where items.isEmpty:
            VStack(spacing: 12) {
                Image(systemName: "tray").font(.system(size: 40)).foregroundStyle(.secondary)
                Text(showOnlyUnprocessed ? "Inbox 空了" : "Inbox 里还没有碎想")
                    .font(.subheadline).foregroundStyle(.secondary)
                Text("通过 InputBar 旁的 💡 按钮，或 POST /api/inbox 录入想法")
                    .font(.caption).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).padding(.horizontal, 40)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            List {
                ForEach(items) { item in
                    inboxRow(item)
                }
            }
            .listStyle(.plain)
        }
    }

    @ViewBuilder
    private func inboxRow(_ item: InboxItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(item.body)
                .font(.body)
                .lineLimit(8)
            HStack(spacing: 8) {
                Text(formatTime(item.capturedAt))
                Text("·").foregroundStyle(.tertiary)
                Text(item.source)
                Spacer()
                if item.processedIntoConversationId != nil {
                    Label("已处理", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                } else {
                    Button {
                        Task { await processIntoConversation(item) }
                    } label: {
                        if processingIds.contains(item.id) {
                            ProgressView().scaleEffect(0.7)
                        } else {
                            Label("派给 Claude", systemImage: "paperplane.fill")
                                .labelStyle(.titleAndIcon)
                                .font(.caption.bold())
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(processingIds.contains(item.id))
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .contextMenu {
            Button {
                UIPasteboard.general.string = item.body
            } label: {
                Label("复制内容", systemImage: "doc.on.doc")
            }
        }
    }

    private func load() async {
        loadState = .loading
        do {
            let resp = try await inboxAPI.list(unprocessedOnly: showOnlyUnprocessed, limit: 200)
            await MainActor.run {
                items = resp.items
                stats = resp.stats
                loadState = .loaded
            }
        } catch {
            await MainActor.run {
                loadState = .failed((error as NSError).localizedDescription)
            }
        }
    }

    private func processIntoConversation(_ item: InboxItem) async {
        await MainActor.run { processingIds.insert(item.id) }
        defer { Task { @MainActor in processingIds.remove(item.id) } }

        // Send the inbox body as a new prompt; auto-create conversation if none.
        client.sendPromptCurrent(
            item.body,
            defaultCwdForNew: settings.cwd,
            model: settings.model,
            permissionMode: settings.permissionMode,
        )
        // Find the newly-focused conversationId so we can mark inbox item processed.
        let convId = client.currentConversationId ?? "pending"
        do {
            _ = try await inboxAPI.markProcessed(id: item.id, conversationId: convId)
            await MainActor.run {
                if let idx = items.firstIndex(where: { $0.id == item.id }) {
                    items[idx] = InboxItem(
                        id: item.id,
                        body: item.body,
                        source: item.source,
                        capturedAt: item.capturedAt,
                        processedIntoConversationId: convId,
                    )
                }
            }
        } catch {
            // mark-processed failure is non-fatal; the prompt was already sent.
        }
        await MainActor.run { dismiss() }
    }

    private func formatTime(_ ms: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
        let formatter = DateFormatter()
        formatter.dateFormat = "MM-dd HH:mm"
        return formatter.string(from: date)
    }
}
