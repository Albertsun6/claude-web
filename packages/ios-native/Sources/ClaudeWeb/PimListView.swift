// PimListView — v2.1 PIM 轻量回看视图 (M0-PIM Week 3 Day 17)
//
// 目的：在 iOS 里能扫一眼最近捕获的 PIM 条目；不是 Web /pim/list 的功能对等品.
// Web 端做完整列表 + 行内编辑 + export 等重操作；iOS 只做:
// - 看最近 N 条 (按 captured_at desc)
// - 按 commitment state 过滤 (server-driven picker)
// - FTS5 搜索 (CJK 单字自动 append `*` 做前缀匹配)
// - 行内移动 commitment state (PATCH /api/pim/:id)
// - 软删除 (DELETE /api/pim/:id)
//
// 不做 (留给 Web):
// - export
// - 多设备 audit log 查看
// - intent snapshot 浏览
// - domain / people 编辑（这些放在 PimCaptureView 创建时填写）
//
// WS 集成（D8 接入）: 通过 BackendClient 注册 pim_event 监听，收到 item_changed
// 自动 reload。本期 MVP 用手动 pull-to-refresh + toolbar refresh 按钮.

import SwiftUI

struct PimListView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(HarnessStore.self) private var harnessStore

    let pimAPI: PimAPI

    @State private var items: [PimItemDto] = []
    @State private var loadState: LoadState = .idle
    @State private var commitmentFilter: String = "" // "" = 全部
    @State private var searchText: String = ""
    @State private var debouncedSearch: String = ""
    @State private var debounceTask: Task<Void, Never>?
    @State private var pendingIds: Set<String> = []
    @State private var toast: String?

    enum LoadState: Equatable {
        case idle, loading, loaded
        case failed(String)
    }

    /// Server-driven commitment states (fallback bundle default).
    private var commitmentStates: [String] {
        harnessStore.config.pim?.commitmentStates ?? PimCommitmentState.defaultValues
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                filterBar
                content
            }
            .navigationTitle("PIM 回看 (\(items.count))")
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
            .onChange(of: commitmentFilter) { _, _ in Task { await load() } }
            .onChange(of: searchText) { _, newValue in scheduleDebounce(newValue) }
            .onChange(of: debouncedSearch) { _, _ in Task { await load() } }
            .overlay(alignment: .top) {
                if let toast {
                    Text(toast)
                        .font(.caption.bold())
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.black.opacity(0.85), in: Capsule())
                        .foregroundStyle(.white)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.2), value: toast)
        }
    }

    // MARK: - Subviews

    @ViewBuilder
    private var filterBar: some View {
        VStack(spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("FTS 搜索 (CJK 自动加 *)", text: $searchText)
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.borderless)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal)
            .padding(.top, 8)

            Picker("Commitment", selection: $commitmentFilter) {
                Text("全部").tag("")
                ForEach(commitmentStates, id: \.self) { state in
                    Text(stateLabel(state)).tag(state)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
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
                Text(debouncedSearch.isEmpty && commitmentFilter.isEmpty ? "还没有 PIM 条目" : "没有匹配结果")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            List {
                ForEach(items, id: \.id) { item in
                    row(item)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                Task { await softDelete(item) }
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
                        }
                }
            }
            .listStyle(.plain)
            .refreshable { await load() }
        }
    }

    @ViewBuilder
    private func row(_ item: PimItemDto) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(item.content)
                .font(.body)
                .lineLimit(6)
            HStack(spacing: 6) {
                commitmentPill(item.commitmentState)
                Text(item.modality)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                Text("·").foregroundStyle(.tertiary)
                Text(item.source)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if let ai = item.aiStatus, ai != .disabled {
                    Text("·").foregroundStyle(.tertiary)
                    Image(systemName: "sparkles")
                        .font(.caption2)
                        .foregroundStyle(aiColor(ai))
                    Text(ai.rawValue)
                        .font(.caption2)
                        .foregroundStyle(aiColor(ai))
                }
                Spacer()
                Text(formatTime(item.capturedAt))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
        .contextMenu {
            Section("移动到") {
                ForEach(commitmentStates.filter { $0 != item.commitmentState }, id: \.self) { target in
                    Button {
                        Task { await move(item, to: target) }
                    } label: {
                        Label(stateLabel(target), systemImage: stateIcon(target))
                    }
                }
            }
            Button {
                UIPasteboard.general.string = item.content
                showToast("已复制")
            } label: {
                Label("复制内容", systemImage: "doc.on.doc")
            }
            Button(role: .destructive) {
                Task { await softDelete(item) }
            } label: {
                Label("软删除", systemImage: "trash")
            }
        }
    }

    @ViewBuilder
    private func commitmentPill(_ state: String) -> some View {
        Text(stateLabel(state))
            .font(.caption2.bold())
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(commitmentColor(state).opacity(0.18), in: Capsule())
            .foregroundStyle(commitmentColor(state))
    }

    // MARK: - Network ops

    private func load() async {
        loadState = .loading
        do {
            let resp = try await pimAPI.list(
                commitmentState: commitmentFilter.isEmpty ? nil : commitmentFilter,
                limit: 100,
                includeDeleted: false,
                query: appendCjkPrefix(debouncedSearch)
            )
            await MainActor.run {
                items = resp.items
                loadState = .loaded
            }
        } catch {
            await MainActor.run {
                loadState = .failed((error as NSError).localizedDescription)
            }
        }
    }

    private func move(_ item: PimItemDto, to target: String) async {
        await MainActor.run { pendingIds.insert(item.id) }
        defer { Task { @MainActor in pendingIds.remove(item.id) } }
        do {
            _ = try await pimAPI.patch(id: item.id, commitmentState: target)
            await MainActor.run {
                showToast("→ \(stateLabel(target))")
            }
            await load()
        } catch {
            await MainActor.run { showToast("移动失败：\((error as NSError).localizedDescription)") }
        }
    }

    private func softDelete(_ item: PimItemDto) async {
        await MainActor.run { pendingIds.insert(item.id) }
        defer { Task { @MainActor in pendingIds.remove(item.id) } }
        do {
            try await pimAPI.softDelete(id: item.id)
            await MainActor.run {
                items.removeAll { $0.id == item.id }
                showToast("已删除")
            }
        } catch {
            await MainActor.run { showToast("删除失败：\((error as NSError).localizedDescription)") }
        }
    }

    // MARK: - Helpers

    /// CJK 单字默认不被 unicode61 tokenizer 命中部分匹配，自动 append `*`
    /// 做前缀匹配（与 Web /pim/list 行为一致）. 含空格 / 引号 / 已有 `*` 时不动.
    private func appendCjkPrefix(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.contains(" ") || trimmed.contains("\"") || trimmed.contains("*") || trimmed.contains(":") {
            return trimmed
        }
        // 全 ASCII 字母数字 → 不加 *（FTS5 自然 token match 即可）
        let asciiAlnum = CharacterSet.alphanumerics.union(.init(charactersIn: "-_"))
        if trimmed.unicodeScalars.allSatisfy({ asciiAlnum.contains($0) || $0.isASCII }) {
            return trimmed
        }
        // 含 CJK / 其他非 ASCII → append `*` 触发 FTS5 前缀匹配
        return "\(trimmed)*"
    }

    private func scheduleDebounce(_ value: String) {
        debounceTask?.cancel()
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            if !Task.isCancelled {
                await MainActor.run { debouncedSearch = value }
            }
        }
    }

    @MainActor
    private func showToast(_ message: String) {
        toast = message
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await MainActor.run { if toast == message { toast = nil } }
        }
    }

    private func stateLabel(_ state: String) -> String {
        guard let first = state.first else { return state }
        return first.uppercased() + state.dropFirst()
    }

    private func stateIcon(_ state: String) -> String {
        switch state {
        case "inbox": "tray"
        case "action": "checklist"
        case "calendar": "calendar"
        case "waiting": "hourglass"
        case "reference": "books.vertical"
        case "archived": "archivebox"
        default: "tag"
        }
    }

    private func commitmentColor(_ state: String) -> Color {
        switch state {
        case "inbox": .orange
        case "action": .blue
        case "calendar": .purple
        case "waiting": .gray
        case "reference": .green
        case "archived": .secondary
        default: .secondary
        }
    }

    private func aiColor(_ status: PimAiStatus) -> Color {
        switch status {
        case .pending, .running: .blue
        case .done: .green
        case .failed, .timeout: .red
        case .disabled: .secondary
        }
    }

    private func formatTime(_ ms: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
        let formatter = DateFormatter()
        formatter.dateFormat = "MM-dd HH:mm"
        return formatter.string(from: date)
    }
}
