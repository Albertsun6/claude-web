import SwiftUI

/// Left-side drawer: navigation hub for projects + conversations + actions.
/// Replaces the F1c2 ConversationDebugSheet bottom-up sheet with a slide-in
/// side menu that consolidates "+ 新建对话" / "打开文件夹" / 语音模式 /
/// 设置 / 项目分组列表 / 清理失效项目 in one panel. F1c4.
struct DrawerContent: View {
    @Binding var isOpen: Bool
    @Binding var showSettings: Bool

    @Environment(AppSettings.self) private var settings
    @Environment(BackendClient.self) private var client
    @Environment(TTSPlayer.self) private var tts
    @Environment(VoiceSession.self) private var voice
    @Environment(ProjectRegistry.self) private var registry
    @Environment(Telemetry.self) private var telemetry

    @State private var showQuickPicker = false
    @State private var missingProjects: [ProjectDTO] = []
    @State private var showCleanupConfirm = false
    @State private var cleanupRunning = false

    @State private var expandedCwds: Set<String> = []
    @State private var expandedAllCwds: Set<String> = []
    @State private var loadingCwd: String? = nil

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                header
                actionList
                Divider()
                conversationList
                Divider()
                footer
            }
            .navigationDestination(isPresented: $showQuickPicker) {
                DirectoryPicker(initialPath: settings.cwd) { picked in
                    showQuickPicker = false
                    Task { @MainActor in
                        loadingCwd = picked
                        defer { loadingCwd = nil }

                        let project = try? await registry.openByPath(cwd: picked)

                        var targetId: String? = nil
                        if let proj = project,
                           let sessions = try? await registry.loadHistorySessions(forProject: proj),
                           let latest = sessions.first {
                            targetId = try? await registry.openHistoricalSession(latest, in: proj)
                        }

                        if let targetId {
                            client.currentConversationId = targetId
                        } else {
                            let conv = client.createConversation(cwd: picked)
                            client.currentConversationId = conv.id
                        }
                        expandedCwds.insert((picked as NSString).standardizingPath)
                        closeDrawer()
                    }
                }
            }
        }
        .alert("清理失效项目", isPresented: $showCleanupConfirm) {
            Button("取消", role: .cancel) { missingProjects = [] }
            Button("全部移除", role: .destructive) {
                Task { await performCleanup() }
            }
        } message: {
            if missingProjects.isEmpty {
                Text("没有失效项目。")
            } else {
                Text("以下项目目录不存在，是否从注册表移除？jsonl 历史不会被删。\n\n" +
                     missingProjects.map { "• \($0.name) (\($0.cwd))" }.joined(separator: "\n"))
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            Text("Seaidea")
                .font(.title2.bold())
            if client.activeRunCount > 0 {
                Text("\(client.activeRunCount)")
                    .font(.caption.bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.orange, in: .capsule)
            }
            Spacer()
            if loadingCwd != nil {
                ProgressView().scaleEffect(0.7)
            }
            Button {
                closeDrawer()
            } label: {
                Image(systemName: "xmark")
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    // MARK: - Top action list

    private var actionList: some View {
        VStack(spacing: 0) {
            DrawerRow(icon: "folder.badge.plus", label: "打开文件夹", tint: .accentColor) {
                showQuickPicker = true
            }
            DrawerRow(
                icon: voice.active ? "headphones.circle.fill" : "headphones",
                label: voice.active ? "退出语音模式" : "进入语音模式",
                tint: voice.active ? .green : .accentColor
            ) {
                if voice.active { voice.exit() } else { voice.enter() }
            }
            DrawerRow(icon: "gearshape", label: "设置", tint: .secondary) {
                closeDrawer()
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    showSettings = true
                }
            }
        }
    }

    // MARK: - Conversation list

    private var conversationList: some View {
        Group {
            if client.conversations.isEmpty && groupedByCwd.isEmpty {
                AnyView(conversationListEmpty)
            } else {
                AnyView(conversationListContent)
            }
        }
    }

    private var conversationListEmpty: some View {
        List {
            Text("还没有对话。点上面打开文件夹注册工作目录，或长按目录名新建。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
    }

    private var conversationListContent: some View {
        List {
            ForEach(groupedByCwd, id: \.cwd) { group in
                Section {
                    if loadingCwd == group.cwd {
                        HStack {
                            ProgressView().scaleEffect(0.8)
                            Text("加载中…").font(.caption).foregroundStyle(.secondary)
                        }
                        .listRowBackground(Color.clear)
                    } else if expandedCwds.contains(group.cwd) {
                        let displayed = expandedAllCwds.contains(group.cwd) ? group.convs : Array(group.convs.prefix(3))
                        ForEach(displayed) { conv in
                            conversationRowView(conv)
                        }
                        if !expandedAllCwds.contains(group.cwd) && group.convs.count > 3 {
                            Button("显示全部 \(group.convs.count) 条") {
                                expandedAllCwds.insert(group.cwd)
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .listRowBackground(Color.clear)
                        }
                        CwdHistorySection(project: group.project) { closeDrawer() }
                    }
                } header: {
                    cwdSectionHeader(group)
                }
            }
        }
        .listStyle(.plain)
    }

    // MARK: - Footer

    private var footer: some View {
        VStack(spacing: 0) {
            DrawerRow(icon: "trash", label: "清理失效项目", tint: .red) {
                Task { await runCleanup() }
            }
            .disabled(cleanupRunning)
            if cleanupRunning {
                ProgressView().scaleEffect(0.8).padding(.vertical, 4)
            }
        }
        .padding(.bottom, 8)
    }

    // MARK: - Helpers

    private func closeDrawer() {
        withAnimation { isOpen = false }
    }

    private func runCleanup() async {
        cleanupRunning = true
        defer { cleanupRunning = false }
        do {
            missingProjects = try await registry.cleanup()
            telemetry.log("project.cleanup.scan", props: ["found": String(missingProjects.count)])
            showCleanupConfirm = true
        } catch {
            telemetry.error("project.cleanup.failed", error: error)
            missingProjects = []
            showCleanupConfirm = true
        }
    }

    private func performCleanup() async {
        for proj in missingProjects {
            do {
                try await registry.forgetProject(proj.id)
                telemetry.log("project.forget", props: ["id": proj.id])
            } catch {
                telemetry.error("project.forget.failed", error: error, props: ["id": proj.id])
            }
        }
        missingProjects = []
    }

    @ViewBuilder
    private func conversationRowView(_ conv: Conversation) -> some View {
        DrawerConversationRow(conv: conv)
            .contentShape(Rectangle())
            .onTapGesture {
                client.currentConversationId = conv.id
                closeDrawer()
            }
            .swipeActions {
                Button(role: .destructive) {
                    closeConversation(conv)
                } label: {
                    Label("关闭", systemImage: "xmark")
                }
            }
    }

    private func closeConversation(_ conv: Conversation) {
        let nextFocus = client.sortedConversations()
            .first { $0.id != conv.id }?.id
        client.closeConversation(conv.id)
        tts.clearCache(for: conv.id)
        if client.currentConversationId == conv.id {
            client.currentConversationId = nextFocus
        }
    }

    @ViewBuilder
    private func cwdSectionHeader(_ group: CwdGroup) -> some View {
        HStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    if expandedCwds.contains(group.cwd) {
                        expandedCwds.remove(group.cwd)
                    } else {
                        expandedCwds.insert(group.cwd)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Text(group.label)
                                .font(.subheadline.bold())
                                .foregroundStyle(.primary)
                                .textCase(nil)
                            if !group.registered {
                                Text("·未注册")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                                    .textCase(nil)
                            }
                        }
                        Text(group.cwd)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                            .textCase(nil)
                    }
                    Spacer()
                    if group.convs.count > 0 {
                        Text("\(group.convs.count)")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    Image(systemName: expandedCwds.contains(group.cwd) ? "chevron.up" : "chevron.down")
                        .font(.caption2).foregroundStyle(.secondary)
                        .padding(.leading, 4)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .contextMenu {
                if let project = group.project {
                    Button(role: .destructive) {
                        Task { try? await registry.forgetProject(project.id) }
                    } label: {
                        Label("关闭文件夹", systemImage: "folder.badge.minus")
                    }
                }
            }

            Button {
                let conv = client.createConversation(cwd: group.cwd)
                client.currentConversationId = conv.id
                expandedCwds.insert(group.cwd)
                if group.project == nil {
                    Task { try? await registry.openByPath(cwd: group.cwd) }
                }
                closeDrawer()
            } label: {
                Image(systemName: "plus.circle")
                    .font(.subheadline)
                    .foregroundColor(.accentColor)
            }
            .buttonStyle(.plain)
            .frame(width: 32)
        }
        .padding(.vertical, 2)
    }

    private var groupedByCwd: [CwdGroup] {
        var dict: [String: [Conversation]] = Dictionary(
            grouping: client.sortedConversations(),
            by: { ($0.cwd as NSString).standardizingPath }
        )
        for proj in registry.projects {
            let norm = (proj.cwd as NSString).standardizingPath
            if dict[norm] == nil { dict[norm] = [] }
        }
        return dict
            .map { (cwd, convs) -> CwdGroup in
                let project = registry.project(forCwd: cwd)
                let label = project?.name
                    ?? ((cwd as NSString).lastPathComponent.isEmpty
                        ? cwd
                        : (cwd as NSString).lastPathComponent)
                return CwdGroup(
                    cwd: cwd, label: label, registered: project != nil,
                    project: project, convs: convs
                )
            }
            .sorted { lhs, rhs in
                let lhsLatest = lhs.convs.first?.lastUsed ?? .distantPast
                let rhsLatest = rhs.convs.first?.lastUsed ?? .distantPast
                return lhsLatest > rhsLatest
            }
    }

    private struct CwdGroup {
        let cwd: String
        let label: String
        let registered: Bool
        let project: ProjectDTO?
        let convs: [Conversation]
    }
}

struct DrawerRow: View {
    let icon: String
    let label: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .frame(width: 24)
                    .foregroundStyle(tint)
                Text(label)
                    .foregroundStyle(.primary)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct DrawerConversationRow: View {
    @Environment(BackendClient.self) private var client
    let conv: Conversation

    var body: some View {
        HStack {
            Circle()
                .fill(client.currentConversationId == conv.id ? Color.accentColor : Color.clear)
                .stroke(.secondary)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(conv.title.isEmpty ? "新对话" : conv.title)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if let sid = conv.sessionId {
                        Text("sid \(sid.prefix(6))")
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                    }
                    if client.stateByConversation[conv.id]?.busy == true {
                        Text("· running")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                    Text("· \(client.stateByConversation[conv.id]?.messages.count ?? 0) msg")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
