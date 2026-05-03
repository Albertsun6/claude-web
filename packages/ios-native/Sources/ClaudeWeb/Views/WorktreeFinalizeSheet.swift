// Worktree finalize sheet — Stage A.
// Triggered after session_ended(reason=completed) for any conversation that
// has a worktreeId. Three buttons:
//   - 合到 main: backend git merge --no-ff <branch>; on conflict 409 returned
//                with hint, sheet shows error + keeps worktree alive for
//                manual resolution
//   - push 分支: backend git push -u origin; on success show "去 GitHub 开 PR"
//                hint
//   - 丢弃:     双确认 → backend git worktree remove --force + branch -D
//                + work-registry status="discarded" (record preserved)
// On success the sheet drops the conversation's worktreePath/worktreeId
// (clearWorktreeBinding) so future sends in this convo go to the user's
// original cwd.

import SwiftUI

struct WorktreeFinalizeSheet: View {
    @Environment(BackendClient.self) private var client
    @Environment(WorktreeAPI.self) private var worktreeAPI
    @Environment(\.dismiss) private var dismiss

    let conversationId: String
    let worktreeId: String

    @State private var work: WorkRecord?
    @State private var loadState: LoadState = .loading
    @State private var inFlight: FinalizeAction?
    @State private var errorMessage: String?
    @State private var showDiscardConfirm: Bool = false
    @State private var pushHint: String?

    enum FinalizeAction: String { case merge, push, discard }

    enum LoadState: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                content
                Spacer()
                actionBar
            }
            .navigationTitle("worktree 收尾")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("稍后") { dismiss() }
                }
            }
            .task { await load() }
            .alert("操作失败", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
            .alert("push 完成", isPresented: Binding(
                get: { pushHint != nil },
                set: { if !$0 { pushHint = nil } }
            )) {
                Button("OK") {
                    pushHint = nil
                    dismiss()
                }
            } message: {
                Text(pushHint ?? "")
            }
            .confirmationDialog(
                "确定丢弃这个 worktree？",
                isPresented: $showDiscardConfirm,
                titleVisibility: .visible
            ) {
                Button("丢弃", role: .destructive) {
                    Task { await runFinalize(.discard) }
                }
                Button("取消", role: .cancel) {}
            } message: {
                Text("分支 + worktree 目录都会删除。\n（work-registry 历史记录保留，方便事后查阅。）")
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch loadState {
        case .loading:
            VStack(spacing: 8) {
                ProgressView()
                Text("加载 worktree 状态…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 40)
        case .failed(let msg):
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.title)
                    .foregroundStyle(.red)
                Text("加载失败：\(msg)")
                    .font(.caption)
                    .foregroundStyle(.red)
                Button("重试") { Task { await load() } }
                    .buttonStyle(.borderedProminent)
            }
            .padding()
        case .loaded:
            if let w = work {
                workInfo(w)
            }
        }
    }

    @ViewBuilder
    private func workInfo(_ w: WorkRecord) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            // Status badge
            HStack(spacing: 8) {
                Circle()
                    .fill(statusColor(w.status))
                    .frame(width: 8, height: 8)
                Text(statusLabel(w.status))
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
            }
            // Branch + base
            HStack(spacing: 4) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.caption)
                Text(w.branch)
                    .font(.body.monospaced())
                Text("←")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Text(w.baseBranch)
                    .font(.body.monospaced())
                    .foregroundStyle(.secondary)
            }
            // Worktree path
            Text(w.worktreePath)
                .font(.caption2.monospaced())
                .foregroundStyle(.tertiary)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)
            Divider()
            // Title
            Text(w.conversationTitle)
                .font(.body)
                .foregroundStyle(.primary)
        }
        .padding()
    }

    @ViewBuilder
    private var actionBar: some View {
        HStack(spacing: 8) {
            Button {
                Task { await runFinalize(.merge) }
            } label: {
                actionLabel("合到 main", systemImage: "arrow.merge", busy: inFlight == .merge)
            }
            .buttonStyle(.borderedProminent)
            .disabled(inFlight != nil || loadState != .loaded)

            Button {
                Task { await runFinalize(.push) }
            } label: {
                actionLabel("push 分支", systemImage: "arrow.up.circle", busy: inFlight == .push)
            }
            .buttonStyle(.bordered)
            .disabled(inFlight != nil || loadState != .loaded)

            Button(role: .destructive) {
                showDiscardConfirm = true
            } label: {
                actionLabel("丢弃", systemImage: "trash", busy: inFlight == .discard)
            }
            .buttonStyle(.bordered)
            .disabled(inFlight != nil || loadState != .loaded)
        }
        .padding()
    }

    @ViewBuilder
    private func actionLabel(_ text: String, systemImage: String, busy: Bool) -> some View {
        if busy {
            ProgressView().controlSize(.small)
        } else {
            Label(text, systemImage: systemImage).font(.caption.bold())
        }
    }

    private func statusColor(_ s: String) -> Color {
        switch s {
        case "active": return .green
        case "idle": return .orange
        case "merged": return .blue
        case "discarded": return .gray
        case "pushed-pending-pr": return .purple
        default: return .gray
        }
    }

    private func statusLabel(_ s: String) -> String {
        switch s {
        case "active": return "进行中"
        case "idle": return "空闲"
        case "merged": return "已合到 main"
        case "discarded": return "已丢弃"
        case "pushed-pending-pr": return "已 push，等开 PR"
        default: return s
        }
    }

    private func load() async {
        loadState = .loading
        // No single-record GET endpoint yet; use listByCwd with includeAll
        // and filter. Cheap at Stage A scale (≤ N worktrees per cwd).
        guard let conv = client.conversations[conversationId] else {
            loadState = .failed("对话已不存在")
            return
        }
        do {
            let items = try await worktreeAPI.listByCwd(conv.cwd, includeAll: true)
            if let found = items.first(where: { $0.id == worktreeId }) {
                await MainActor.run {
                    work = found
                    loadState = .loaded
                }
            } else {
                await MainActor.run {
                    loadState = .failed("worktree 已不在 registry 中（可能被其他客户端清理）")
                }
            }
        } catch {
            await MainActor.run {
                loadState = .failed((error as NSError).localizedDescription)
            }
        }
    }

    private func runFinalize(_ action: FinalizeAction) async {
        await MainActor.run { inFlight = action }
        defer { Task { @MainActor in inFlight = nil } }
        do {
            let updated = try await worktreeAPI.finalize(id: worktreeId, action: action.rawValue)
            await MainActor.run {
                work = updated
                if action == .push {
                    pushHint = "分支 \(updated.branch) 已 push 到 origin。\n请打开 GitHub 仓库开 PR。"
                    // Don't dismiss; let the alert button do it after user reads
                } else {
                    // merge or discard → drop binding + dismiss + clear pending
                    client.clearWorktreeBinding(convId: conversationId)
                    client.clearPendingWorktreeFinalize(convId: conversationId)
                    dismiss()
                }
            }
        } catch {
            await MainActor.run {
                let nsErr = error as NSError
                if action == .merge && nsErr.code == 409 {
                    let path = work?.worktreePath ?? "worktree 目录"
                    errorMessage = "合并冲突。worktree 保留，请手动到 \(path) 解决冲突后重试，或选择「丢弃」。"
                } else {
                    errorMessage = nsErr.localizedDescription
                }
            }
        }
    }
}
