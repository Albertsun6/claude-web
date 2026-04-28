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

    @State private var showNewSheet = false
    @State private var showQuickPicker = false
    @State private var missingProjects: [ProjectDTO] = []
    @State private var showCleanupConfirm = false
    @State private var cleanupRunning = false

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
                    let conv = client.createConversation(cwd: picked)
                    client.currentConversationId = conv.id
                    Task {
                        try? await registry.openByPath(cwd: picked)
                    }
                    closeDrawer()
                }
            }
        }
        .sheet(isPresented: $showNewSheet) {
            NewConversationSheet(pickerStartPath: settings.cwd) { name, cwd in
                let conv = client.createConversation(cwd: cwd, title: name)
                client.currentConversationId = conv.id
                Task {
                    try? await registry.openByPath(cwd: cwd)
                }
                showNewSheet = false
                closeDrawer()
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
            DrawerRow(icon: "plus.circle.fill", label: "新建对话", tint: .accentColor) {
                showNewSheet = true
            }
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
                // Tiny delay so the drawer's slide-out animation finishes
                // before the settings sheet pops in — otherwise they fight.
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    showSettings = true
                }
            }
        }
    }

    // MARK: - Conversation list

    private var conversationList: some View {
        List {
            if client.conversations.isEmpty {
                Text("还没有对话。点上面 + 新建一条。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(groupedByCwd, id: \.cwd) { group in
                    Section {
                        ForEach(group.convs) { conv in
                            DrawerConversationRow(conv: conv)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    client.currentConversationId = conv.id
                                    closeDrawer()
                                }
                                .swipeActions {
                                    Button(role: .destructive) {
                                        let nextFocus = client.sortedConversations()
                                            .first { $0.id != conv.id }?.id
                                        client.closeConversation(conv.id)
                                        tts.clearCache(for: conv.id)
                                        if client.currentConversationId == conv.id {
                                            client.currentConversationId = nextFocus
                                        }
                                    } label: {
                                        Label("关闭", systemImage: "xmark")
                                    }
                                }
                        }
                        CwdHistorySection(project: group.project) { closeDrawer() }
                    } header: {
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
                    }
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
            // Still show alert with empty list so user knows something happened.
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

    /// Group conversations by cwd, merged with registry.projects so that
    /// projects without current conversations still show (e.g., to browse history).
    /// Label with project name from registry when available.
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
