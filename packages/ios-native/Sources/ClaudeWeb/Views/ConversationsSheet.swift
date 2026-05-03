// Conversations sheet for the current project.
// Triggered by tapping the project name in the toolbar's principal slot.
// Lists every conversation whose cwd matches the focused project's cwd, with
// quick switch / rename / close actions. Mirrors the drawer's per-project
// section but in a 2-tap-from-anywhere modal.

import SwiftUI

struct ConversationsSheet: View {
    @Environment(BackendClient.self) private var client
    @Environment(AppSettings.self) private var settings
    @Environment(WorktreeAPI.self) private var worktreeAPI
    @Environment(\.dismiss) private var dismiss

    @State private var renamingConv: Conversation?
    @State private var renameDraft: String = ""
    @State private var creatingWorktree: Bool = false
    @State private var worktreeError: String?
    @State private var activeWorktreeCount: Int = 0

    /// cwd to filter by. Passed in so the sheet stays consistent even if focus
    /// changes mid-display (e.g. user taps a conversation row).
    let cwd: String

    private var conversations: [Conversation] {
        client.conversationsList()
            .filter { $0.cwd == cwd }
            .sorted { $0.lastUsed > $1.lastUsed }
    }

    private var projectName: String {
        let base = (cwd as NSString).lastPathComponent
        return base.isEmpty ? cwd : base
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(conversations) { conv in
                        row(conv)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                client.currentConversationId = conv.id
                                settings.currentConversationId = conv.id
                                dismiss()
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    client.closeConversation(conv.id)
                                } label: {
                                    Label("关闭", systemImage: "xmark.bin")
                                }
                                Button {
                                    renamingConv = conv
                                    renameDraft = conv.title
                                } label: {
                                    Label("改名", systemImage: "pencil")
                                }
                                .tint(.orange)
                            }
                    }
                } footer: {
                    Text("点行切换；左滑可改名/关闭。关闭只移除本机引用，**不删除**后端 jsonl。")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("📁 \(projectName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Menu {
                        Button {
                            createPlain()
                        } label: {
                            Label("新对话（同 cwd）", systemImage: "plus.bubble")
                        }
                        Button {
                            Task { await createWithWorktree() }
                        } label: {
                            Label(
                                activeWorktreeCount > 0
                                    ? "新对话 + 隔离 worktree（已有 \(activeWorktreeCount)）"
                                    : "新对话 + 隔离 worktree",
                                systemImage: "arrow.triangle.branch"
                            )
                        }
                        .disabled(creatingWorktree)
                    } label: {
                        if creatingWorktree {
                            ProgressView()
                        } else {
                            Label("新对话", systemImage: "plus")
                        }
                    }
                }
            }
            .alert("worktree 创建失败", isPresented: Binding(
                get: { worktreeError != nil },
                set: { if !$0 { worktreeError = nil } }
            )) {
                Button("OK") { worktreeError = nil }
            } message: {
                Text(worktreeError ?? "")
            }
            .task {
                // Lazy-load active worktree count for the toolbar Menu hint.
                // Failure is silent — Menu just doesn't show the count.
                if let items = try? await worktreeAPI.listByCwd(cwd) {
                    activeWorktreeCount = items.count
                }
            }
            .alert("改名", isPresented: Binding(
                get: { renamingConv != nil },
                set: { if !$0 { renamingConv = nil } }
            )) {
                TextField("名称", text: $renameDraft)
                    .textInputAutocapitalization(.never)
                Button("取消", role: .cancel) { renamingConv = nil }
                Button("保存") {
                    if let conv = renamingConv,
                       !renameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        client.renameConversation(conv.id, to: renameDraft)
                    }
                    renamingConv = nil
                }
            }
        }
    }

    /// Quick path: create a plain conversation reusing the current cwd. No
    /// worktree, no isolation. Same as the pre-Stage-A behavior.
    private func createPlain() {
        let conv = client.createConversation(cwd: cwd)
        client.currentConversationId = conv.id
        settings.currentConversationId = conv.id
        dismiss()
    }

    /// Stage A entry: create an isolated git worktree under the current cwd
    /// and bind a fresh conversation to it. CLI subprocess will run in the
    /// worktree path; main cwd is preserved for display + finalize base.
    /// Failure leaves no conversation behind.
    private func createWithWorktree() async {
        creatingWorktree = true
        defer { creatingWorktree = false }
        // Title hint goes to backend so the WorkRecord is identifiable; the
        // conversation itself is auto-titled by client.createConversation
        // and rewritten to the prompt's first 30 chars on first send.
        let titleHint = client.peekNextAutoName(forCwd: cwd)
        do {
            let work = try await worktreeAPI.createWorktree(
                cwd: cwd,
                conversationTitle: titleHint
            )
            let conv = client.createConversation(
                cwd: cwd,
                worktreePath: work.worktreePath,
                worktreeId: work.id
            )
            client.currentConversationId = conv.id
            settings.currentConversationId = conv.id
            dismiss()
        } catch {
            worktreeError = (error as NSError).localizedDescription
        }
    }

    @ViewBuilder
    private func row(_ conv: Conversation) -> some View {
        let isCurrent = conv.id == client.currentConversationId
        let state = client.stateByConversation[conv.id]
        let isBusy = state?.busy == true

        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if isCurrent {
                        Image(systemName: "circle.fill").font(.system(size: 6)).foregroundStyle(.blue)
                    }
                    Text(conv.title)
                        .font(.body)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .fontWeight(isCurrent ? .semibold : .regular)
                    if isBusy {
                        Image(systemName: "circle.dotted")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                            .symbolEffect(.pulse)
                    }
                }
                HStack(spacing: 6) {
                    Text(formatRelative(conv.lastUsed))
                    if let messageCount = state?.messages.count, messageCount > 0 {
                        Text("·").foregroundStyle(.tertiary)
                        Text("\(messageCount) 条消息")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }

    private func formatRelative(_ date: Date) -> String {
        let secs = -date.timeIntervalSinceNow
        if secs < 60 { return "刚刚" }
        if secs < 3600 { return "\(Int(secs / 60))m 前" }
        if secs < 86400 { return "\(Int(secs / 3600))h 前" }
        let formatter = DateFormatter()
        formatter.dateFormat = "MM-dd HH:mm"
        return formatter.string(from: date)
    }
}
