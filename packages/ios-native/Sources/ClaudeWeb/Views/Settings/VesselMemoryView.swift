// VesselMemoryView — list / add / search Vessel long-term memory records via
// /api/vessel/memory* (M1C-B+ HTTP API).
//
// Pushed onto the Settings navigation stack via a "Vessel 记忆" row.
// Requires the backend to be a Vessel-flavored vessel-core (NOT a stock Eva
// claude-web backend) — when the routes are missing, calls return 404 and
// the view shows a hint to switch backendURL.

import SwiftUI

struct VesselMemoryView: View {
    @Environment(AppSettings.self) private var settings

    @State private var records: [MemoryRecord] = []
    @State private var isLoadingList = false
    @State private var listError: String?

    @State private var showAddSheet = false
    @State private var showSearchSheet = false
    @State private var statusText: String = ""

    private var api: MemoryAPI {
        MemoryAPI(backend: { settings.backendURL }, token: { settings.authToken })
    }

    var body: some View {
        List {
            if let err = listError {
                Section {
                    Label(err, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                } footer: {
                    Text("路径不通常因为后端没启用 Vessel 记忆模块。检查 Backend 设置是否指向 Vessel 端口（默认 :3032）而不是 Eva 端口（默认 :3030）。")
                }
            }

            if !statusText.isEmpty {
                Section("状态") {
                    Text(statusText).font(.caption.monospaced()).foregroundStyle(.secondary)
                }
            }

            if records.isEmpty && !isLoadingList && listError == nil {
                Section { Text("（暂无记忆）").foregroundStyle(.secondary) }
            }

            ForEach(records) { r in
                row(for: r)
            }
            .onDelete(perform: handleDelete)
        }
        .navigationTitle("Vessel 记忆")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { showAddSheet = true } label: { Label("新增记忆", systemImage: "plus.circle") }
                    Button { showSearchSheet = true } label: { Label("搜索", systemImage: "magnifyingglass") }
                    Button { Task { await refresh() } } label: { Label("刷新", systemImage: "arrow.clockwise") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .refreshable { await refresh() }
        .sheet(isPresented: $showAddSheet) {
            NavigationStack {
                MemoryAddSheet(api: api) {
                    Task { await refresh() }
                }
            }
        }
        .sheet(isPresented: $showSearchSheet) {
            NavigationStack { MemorySearchSheet(api: api) }
        }
        .task {
            if records.isEmpty { await refresh() }
        }
    }

    @ViewBuilder
    private func row(for r: MemoryRecord) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(r.kind)
                    .font(.caption.bold())
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(kindColor(r.kind).opacity(0.2))
                    .foregroundStyle(kindColor(r.kind))
                    .clipShape(Capsule())
                if let s = r.source, !s.isEmpty {
                    Text(s).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                Text("#\(r.id)").font(.caption2.monospaced()).foregroundStyle(.secondary)
            }
            Text(r.content).lineLimit(3)
        }
        .padding(.vertical, 2)
    }

    private func kindColor(_ kind: String) -> Color {
        switch kind {
        case "note": return .blue
        case "fact": return .green
        case "episode": return .orange
        case "preference": return .purple
        default: return .gray
        }
    }

    private func refresh() async {
        isLoadingList = true
        listError = nil
        do {
            async let list = api.list(limit: 100)
            async let s = api.status()
            let (rs, st) = try await (list, s)
            records = rs
            statusText = "\(st.records) 条 · \(st.embedder.model) · \(st.embedder.loaded ? "已加载" : "待加载")"
        } catch {
            listError = error.localizedDescription
        }
        isLoadingList = false
    }

    private func handleDelete(_ offsets: IndexSet) {
        let toDelete = offsets.map { records[$0] }
        records.remove(atOffsets: offsets)
        Task {
            for r in toDelete {
                do {
                    try await api.delete(id: r.id)
                } catch {
                    // Re-fetch on error to keep state consistent.
                    await refresh()
                    return
                }
            }
        }
    }
}

// MARK: - Add sheet

struct MemoryAddSheet: View {
    let api: MemoryAPI
    let onAdded: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var kind: String = "note"
    @State private var content: String = ""
    @State private var source: String = ""
    @State private var isSubmitting = false
    @State private var error: String?

    var body: some View {
        Form {
            Picker("类型", selection: $kind) {
                Text("笔记 note").tag("note")
                Text("事实 fact").tag("fact")
                Text("事件 episode").tag("episode")
                Text("偏好 preference").tag("preference")
            }

            Section("内容") {
                TextField("写点什么...", text: $content, axis: .vertical)
                    .lineLimit(5...12)
            }

            Section("来源（可选）") {
                TextField("例：morning standup / iPhone 灵光乍现", text: $source)
                    .textInputAutocapitalization(.never)
            }

            if let err = error {
                Section { Text(err).foregroundStyle(.red) }
            }
        }
        .navigationTitle("新增记忆")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("取消") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(isSubmitting ? "保存中…" : "保存") {
                    submit()
                }
                .disabled(isSubmitting || content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func submit() {
        isSubmitting = true
        error = nil
        Task {
            do {
                _ = try await api.add(kind: kind, content: content, source: source.isEmpty ? nil : source)
                isSubmitting = false
                onAdded()
                dismiss()
            } catch {
                self.error = error.localizedDescription
                isSubmitting = false
            }
        }
    }
}

// MARK: - Search sheet

struct MemorySearchSheet: View {
    let api: MemoryAPI
    @Environment(\.dismiss) private var dismiss

    @State private var query: String = ""
    @State private var top: Int = 5
    @State private var hits: [MemorySearchHit] = []
    @State private var isSearching = false
    @State private var error: String?
    @State private var hasSearched = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                TextField("搜索语义相似的记忆...", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.search)
                    .onSubmit { run() }
                Button { run() } label: {
                    if isSearching { ProgressView().controlSize(.small) }
                    else { Image(systemName: "magnifyingglass.circle.fill").font(.title2) }
                }
                .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSearching)
            }
            .padding()

            if let err = error {
                Text(err).foregroundStyle(.red).padding(.horizontal)
            }

            List {
                if hasSearched && hits.isEmpty && !isSearching && error == nil {
                    Text("（无匹配）").foregroundStyle(.secondary)
                }
                ForEach(hits) { h in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(h.kind).font(.caption.bold()).foregroundStyle(.secondary)
                            Spacer()
                            Text(String(format: "dist %.3f", h.distance))
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                        }
                        Text(h.content).lineLimit(4)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .navigationTitle("记忆搜索")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("关闭") { dismiss() }
            }
        }
    }

    private func run() {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        isSearching = true
        error = nil
        Task {
            do {
                hits = try await api.search(query: q, top: top)
                hasSearched = true
            } catch {
                self.error = error.localizedDescription
            }
            isSearching = false
        }
    }
}
