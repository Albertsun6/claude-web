// Harness Board — iOS M1 thin shell.
// 3-level drill-down: Initiative list → Issue list → Stage list.
// Decision sheet appears when a stage has pending decisions (awaiting_review).
// Offline: shows "未连接" placeholder (harness requires live backend).

import SwiftUI

// MARK: - Helpers

private func stageEmoji(_ status: String) -> String {
    switch status {
    case "pending":         return "⏳"
    case "running":         return "▶️"
    case "awaiting_review": return "👀"
    case "approved":        return "✅"
    case "rejected":        return "❌"
    case "skipped":         return "⏭️"
    case "failed":          return "💥"
    default:                return "◦"
    }
}

private func stageColor(_ status: String) -> Color {
    switch status {
    case "pending":         return .secondary
    case "running":         return .orange
    case "awaiting_review": return .blue
    case "approved":        return .green
    case "rejected":        return .red
    case "skipped":         return .secondary
    case "failed":          return .red
    default:                return .secondary
    }
}

private func issueStatusColor(_ status: String) -> Color {
    switch status {
    case "in_progress":     return .orange
    case "awaiting_review": return .blue
    case "approved", "done": return .green
    case "rejected", "cancelled": return .red
    default:                return .secondary
    }
}

private func formatTime(_ ms: Int64) -> String {
    let date = Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
    let f = DateFormatter()
    f.dateFormat = "MM-dd HH:mm"
    return f.string(from: date)
}

// MARK: - Decision Sheet

private struct DecisionSheet: View {
    @Environment(HarnessAPI.self) private var api
    @Environment(\.dismiss) private var dismiss

    let decisions: [HarnessDecision]
    let stageId: String
    let onResolved: () -> Void

    @State private var resolving: String?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                ForEach(decisions.filter { $0.chosen_option == nil }) { d in
                    Section {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("由 \(d.requested_by) 请求 · \(formatTime(d.created_at))")
                                .font(.caption).foregroundStyle(.secondary)
                            ForEach(d.options, id: \.self) { opt in
                                Button {
                                    Task { await resolve(d.id, option: opt) }
                                } label: {
                                    HStack {
                                        if resolving == d.id + opt {
                                            ProgressView().scaleEffect(0.8)
                                        }
                                        Text(opt == "approve" ? "✅ 批准" :
                                             opt == "reject"  ? "❌ 拒绝" : opt)
                                            .font(.body.bold())
                                        Spacer()
                                    }
                                    .padding(.vertical, 6)
                                }
                                .buttonStyle(.bordered)
                                .disabled(resolving != nil)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("待审批决策")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
            .overlay {
                if let error {
                    VStack(spacing: 8) {
                        Text("操作失败：\(error)").font(.caption).foregroundStyle(.red)
                        Button("关闭") { dismiss() }
                    }
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }

    private func resolve(_ decisionId: String, option: String) async {
        resolving = decisionId + option
        do {
            try await api.resolveDecision(decisionId: decisionId, chosenOption: option)
            onResolved()
            dismiss()
        } catch {
            self.error = (error as NSError).localizedDescription
        }
        resolving = nil
    }
}

// MARK: - Stage List

private struct StageListView: View {
    @Environment(HarnessAPI.self) private var api

    let issue: HarnessIssue
    @State private var stages: [HarnessStage] = []
    @State private var loading = true
    @State private var err: String?
    @State private var addingStage = false
    @State private var newStageKind = "spec"
    @State private var decisionStage: HarnessStage?
    @State private var pendingDecisions: [HarnessDecision] = []

    private let allKinds = ["strategy","discovery","spec","compliance","design","implement","test","review","release","observe"]

    var body: some View {
        List {
            if loading {
                ProgressView().frame(maxWidth: .infinity)
            } else if stages.isEmpty {
                HStack {
                    Spacer()
                    VStack(spacing: 8) {
                        Image(systemName: "square.stack.3d.up").font(.title2).foregroundStyle(.secondary)
                        Text("还没有 Stage").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .listRowBackground(Color.clear)
            } else {
                ForEach(stages) { stage in
                    stageRow(stage)
                }
            }

            // Add stage
            Section {
                if addingStage {
                    VStack(spacing: 8) {
                        Picker("Stage 类型", selection: $newStageKind) {
                            ForEach(availableKinds, id: \.self) { kind in
                                Text(kind).tag(kind)
                            }
                        }
                        .pickerStyle(.wheel)
                        .frame(height: 100)
                        .clipped()
                        HStack {
                            Button("取消") { addingStage = false }
                                .buttonStyle(.bordered)
                            Spacer()
                            Button("创建") { Task { await addStage() } }
                                .buttonStyle(.borderedProminent)
                        }
                    }
                } else {
                    Button {
                        newStageKind = availableKinds.first ?? "spec"
                        addingStage = true
                    } label: {
                        Label("添加 Stage", systemImage: "plus.circle")
                    }
                    .disabled(availableKinds.isEmpty)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(issue.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $decisionStage) { stage in
            DecisionSheet(
                decisions: pendingDecisions,
                stageId: stage.id,
                onResolved: { Task { await load() } }
            )
        }
    }

    @ViewBuilder
    private func stageRow(_ stage: HarnessStage) -> some View {
        HStack(spacing: 10) {
            Text(stageEmoji(stage.status)).font(.title3)
            VStack(alignment: .leading, spacing: 2) {
                Text(stage.kind)
                    .font(.subheadline.bold())
                HStack(spacing: 6) {
                    Text(stage.assigned_agent_profile).font(.caption2).foregroundStyle(.secondary)
                    Text("·").foregroundStyle(.tertiary)
                    Text(stage.weight).font(.caption2).foregroundStyle(.secondary)
                    Text("·").foregroundStyle(.tertiary)
                    Text(formatTime(stage.created_at)).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(stage.status)
                .font(.caption.bold())
                .foregroundStyle(stageColor(stage.status))
        }
        .padding(.vertical, 2)
        .swipeActions(edge: .trailing) {
            if stage.status == "awaiting_review" {
                Button {
                    Task { await openDecisions(for: stage) }
                } label: {
                    Label("审批", systemImage: "checkmark.circle")
                }
                .tint(.blue)
            }
            if stage.status == "pending" {
                Button {
                    Task { try? await api.setStageStatus(stageId: stage.id, status: "running"); await load() }
                } label: {
                    Label("开始", systemImage: "play.fill")
                }
                .tint(.orange)
            }
            if stage.status == "running" {
                Button {
                    Task { try? await api.setStageStatus(stageId: stage.id, status: "awaiting_review"); await load() }
                } label: {
                    Label("等审批", systemImage: "eyes")
                }
                .tint(.purple)
            }
            if stage.status == "approved" {
                Button {
                    Task { try? await api.setStageStatus(stageId: stage.id, status: "skipped"); await load() }
                } label: {
                    Label("跳过", systemImage: "forward.fill")
                }
                .tint(.secondary)
            }
        }
    }

    private var availableKinds: [String] {
        let existing = Set(stages.map { $0.kind })
        return allKinds.filter { !existing.contains($0) }
    }

    private func load() async {
        loading = true
        err = nil
        do {
            stages = try await api.listStages(issueId: issue.id)
        } catch {
            err = (error as NSError).localizedDescription
        }
        loading = false
    }

    private func addStage() async {
        do {
            let s = try await api.createStage(issueId: issue.id, kind: newStageKind)
            stages.append(s)
            addingStage = false
        } catch {}
    }

    private func openDecisions(for stage: HarnessStage) async {
        do {
            pendingDecisions = try await api.listDecisions(stageId: stage.id)
            decisionStage = stage
        } catch {}
    }
}

// MARK: - Issue List

private struct IssueListView: View {
    @Environment(HarnessAPI.self) private var api
    @Environment(AppSettings.self) private var settings

    let initiative: HarnessInitiative
    let projectId: String
    @State private var issues: [HarnessIssue] = []
    @State private var loading = true
    @State private var showAdd = false
    @State private var newTitle = ""

    var body: some View {
        List {
            if loading {
                ProgressView().frame(maxWidth: .infinity)
            } else if issues.isEmpty {
                HStack {
                    Spacer()
                    VStack(spacing: 8) {
                        Image(systemName: "list.bullet.rectangle").font(.title2).foregroundStyle(.secondary)
                        Text("还没有 Issue").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .listRowBackground(Color.clear)
            } else {
                ForEach(issues) { issue in
                    NavigationLink(destination: StageListView(issue: issue)) {
                        issueRow(issue)
                    }
                }
            }

            Section {
                if showAdd {
                    VStack(spacing: 8) {
                        TextField("Issue 标题", text: $newTitle)
                            .textFieldStyle(.roundedBorder)
                        HStack {
                            Button("取消") { showAdd = false; newTitle = "" }
                                .buttonStyle(.bordered)
                            Spacer()
                            Button("创建") { Task { await addIssue() } }
                                .buttonStyle(.borderedProminent)
                                .disabled(newTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                } else {
                    Button { showAdd = true } label: {
                        Label("新建 Issue", systemImage: "plus.circle")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(initiative.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder
    private func issueRow(_ issue: HarnessIssue) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(issue.title).font(.subheadline)
            HStack(spacing: 6) {
                Text(issue.priority).font(.caption2).foregroundStyle(.secondary)
                Text("·").foregroundStyle(.tertiary)
                Text(issue.status)
                    .font(.caption2.bold())
                    .foregroundStyle(issueStatusColor(issue.status))
                Text("·").foregroundStyle(.tertiary)
                Text(formatTime(issue.created_at)).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    private func load() async {
        loading = true
        do {
            issues = try await api.listIssues(projectId: projectId, initiativeId: initiative.id)
        } catch {}
        loading = false
    }

    private func addIssue() async {
        let t = newTitle.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        do {
            let issue = try await api.createIssue(projectId: projectId, initiativeId: initiative.id, title: t)
            issues.insert(issue, at: 0)
            newTitle = ""
            showAdd = false
        } catch {}
    }
}

// MARK: - Board Root

struct HarnessBoardView: View {
    @Environment(HarnessAPI.self) private var api
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    // Use activeCwd (same logic as web HarnessPage) as projectId.
    var projectId: String
    var cwd: String

    @State private var initiatives: [HarnessInitiative] = []
    @State private var loading = true
    @State private var error: String?
    @State private var showAdd = false
    @State private var newTitle = ""
    @State private var newIntent = ""

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView("加载中…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle").font(.title).foregroundStyle(.orange)
                        Text(error).font(.caption).foregroundStyle(.secondary)
                            .multilineTextAlignment(.center).padding(.horizontal)
                        Button("重试") { Task { await load() } }.buttonStyle(.bordered)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        if initiatives.isEmpty {
                            HStack {
                                Spacer()
                                VStack(spacing: 8) {
                                    Image(systemName: "flag").font(.system(size: 40)).foregroundStyle(.secondary)
                                    Text("还没有 Initiative").font(.subheadline).foregroundStyle(.secondary)
                                    Text("点右上角 + 创建第一个").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                            .listRowBackground(Color.clear)
                            .padding(.top, 40)
                        } else {
                            ForEach(initiatives) { init_ in
                                NavigationLink(destination: IssueListView(initiative: init_, projectId: projectId)) {
                                    initiativeRow(init_)
                                }
                            }
                        }

                        if showAdd {
                            Section("新建 Initiative") {
                                TextField("标题", text: $newTitle)
                                TextField("目标（可选）", text: $newIntent)
                                HStack {
                                    Button("取消") { showAdd = false; newTitle = ""; newIntent = "" }
                                        .buttonStyle(.bordered)
                                    Spacer()
                                    Button("创建") { Task { await addInitiative() } }
                                        .buttonStyle(.borderedProminent)
                                        .disabled(newTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .refreshable { await load() }
                }
            }
            .navigationTitle("🔬 Harness 看板")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button { showAdd = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private func initiativeRow(_ init_: HarnessInitiative) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(init_.title).font(.subheadline.bold())
            if !init_.intent.isEmpty {
                Text(init_.intent).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            HStack(spacing: 6) {
                Text(init_.status)
                    .font(.caption2.bold())
                    .foregroundStyle(init_.status == "active" ? .green : .secondary)
                Text("·").foregroundStyle(.tertiary)
                Text(formatTime(init_.created_at)).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    private func load() async {
        loading = true
        error = nil
        do {
            initiatives = try await api.listInitiatives(projectId: projectId)
        } catch {
            self.error = (error as NSError).localizedDescription == "The data couldn't be read because it isn't in the correct format."
                ? "Harness 未启用（后端未连接或 HARNESS_DISABLED=1）"
                : (error as NSError).localizedDescription
        }
        loading = false
    }

    private func addInitiative() async {
        let t = newTitle.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        do {
            let init_ = try await api.createInitiative(
                projectId: projectId, cwd: cwd,
                title: t, intent: newIntent.trimmingCharacters(in: .whitespaces)
            )
            initiatives.insert(init_, at: 0)
            newTitle = ""; newIntent = ""; showAdd = false
        } catch {}
    }
}
