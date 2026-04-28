// Top-level UI: connection chip + chat list + input + settings sheet.
// M1 scope: text-only. M2 will inline a PTT button next to send.

import SwiftUI
import MarkdownUI

struct ContentView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(BackendClient.self) private var client
    @Environment(VoiceRecorder.self) private var recorder
    @Environment(TTSPlayer.self) private var tts
    @Environment(VoiceSession.self) private var voice
    @State private var draft: String = ""
    @State private var showSettings = false
    @State private var showDrawer = false

    var body: some View {
        GeometryReader { geo in
            let drawerWidth = min(geo.size.width * 0.85, 320)
            ZStack(alignment: .leading) {
                mainContent
                    .overlay {
                        if showDrawer {
                            // Tap anywhere on the dim overlay to close.
                            Color.black.opacity(0.4)
                                .ignoresSafeArea()
                                .onTapGesture {
                                    withAnimation { showDrawer = false }
                                }
                                .transition(.opacity)
                        }
                    }
                if showDrawer {
                    DrawerContent(
                        isOpen: $showDrawer,
                        showSettings: $showSettings
                    )
                    .frame(width: drawerWidth)
                    .frame(maxHeight: .infinity)
                    .background(Color(.systemBackground))
                    .ignoresSafeArea(edges: .bottom)
                    .transition(.move(edge: .leading))
                    // Swipe drawer leftward to close — natural gesture for
                    // dismissing a side menu.
                    .gesture(
                        DragGesture(minimumDistance: 30)
                            .onEnded { val in
                                if val.translation.width < -50 {
                                    withAnimation { showDrawer = false }
                                }
                            }
                    )
                }
            }
            .animation(.easeInOut(duration: 0.25), value: showDrawer)
        }
        .dynamicTypeSize(settings.dynamicTypeSize)
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .sheet(item: Binding(
            get: { client.currentPendingPermission },
            set: { _ in /* dismissed by replyPermission */ }
        )) { req in
            PermissionSheet(request: req) { decision in
                client.replyPermission(req, decision: decision)
            }
            .presentationDetents([.medium])
        }
    }

    private var mainContent: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !isConnected, let label = nonConnectedLabel {
                    // Connection problem banner — only when NOT connected.
                    // Green/connected state is signaled by the dot in toolbar
                    // and doesn't need a banner.
                    HStack(spacing: 6) {
                        Circle().fill(chipColor).frame(width: 6, height: 6)
                        Text(label).font(.caption2).foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(.bar)
                }
                if let err = voice.lastError {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text(err).font(.caption)
                        Spacer()
                        Button("关闭") {
                            voice.lastError = nil
                        }
                        .font(.caption)
                    }
                    .padding(8)
                    .background(.orange.opacity(0.15))
                }
                ChatListView(messages: client.currentMessages)
                    .frame(maxHeight: .infinity)
                Divider()
                InputBar(
                    draft: $draft,
                    busy: client.currentBusy,
                    onSend: send,
                    onStop: client.interrupt,
                    onTranscript: { text in
                        if voice.active {
                            client.sendPromptCurrent(text, defaultCwdForNew: settings.cwd, model: settings.model, permissionMode: settings.permissionMode)
                        } else {
                            draft = text
                        }
                    }
                )
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    HStack(spacing: 8) {
                        Button {
                            withAnimation { showDrawer = true }
                        } label: {
                            Image(systemName: "line.3.horizontal")
                                .accessibilityLabel("打开抽屉")
                        }
                        // Connection status dot — green when WS up, otherwise
                        // colored. Banner below nav bar shows the verbose label
                        // on non-connected states.
                        Circle()
                            .fill(chipColor)
                            .frame(width: 8, height: 8)
                            .accessibilityLabel("连接状态：\(chipLabel)")
                    }
                }
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 6) {
                        Text("Seaidea").font(.headline)
                        if settings.permissionMode == "bypassPermissions" {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                                .font(.system(size: 12))
                                .accessibilityLabel("Bypass 模式：自动允许所有工具")
                        }
                        if client.activeRunCount > 0 {
                            Text("\(client.activeRunCount)")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(.orange, in: .capsule)
                                .accessibilityLabel("\(client.activeRunCount) 个对话进行中")
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 8) {
                        ttsControls
                        Button {
                            withAnimation { showDrawer = true }
                        } label: {
                            Text(currentTitle)
                                .font(.caption.monospaced())
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                                .truncationMode(.tail)
                                .frame(maxWidth: 120, alignment: .trailing)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("当前对话 \(currentTitle)，点击打开抽屉")
                    }
                }
            }
        }
    }

    private var isConnected: Bool {
        client.state == .connected
    }

    private var nonConnectedLabel: String? {
        switch client.state {
        case .connected: return nil
        case .connecting: return "连接中…"
        case .disconnected: return "未连接"
        case .error(let msg): return "失败: \(msg)"
        }
    }

    private var currentTitle: String {
        if let id = client.currentConversationId,
           let conv = client.conversations[id] {
            return conv.title
        }
        return "新建"
    }

    @ViewBuilder
    private var ttsControls: some View {
        if voice.state == .error("") || isErrored {
            Button {
                voice.dismissError()
            } label: {
                Label("清除错误", systemImage: "exclamationmark.triangle.fill")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.orange)
            }
        }
        switch tts.state {
        case .fetching:
            ProgressView().scaleEffect(0.7)
        case .playing:
            Button { tts.pause() } label: {
                Image(systemName: "pause.fill")
            }
            Button { tts.cancel() } label: {
                Image(systemName: "stop.fill")
            }
        case .paused:
            Button { tts.resume() } label: {
                Image(systemName: "play.fill")
            }
            Button { tts.cancel() } label: {
                Image(systemName: "stop.fill")
            }
        case .idle:
            if tts.hasReplay(for: client.currentConversationId) {
                Button {
                    let convId = client.currentConversationId
                    Task { await tts.replay(for: convId) }
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                }
            }
        case .error:
            EmptyView()
        }
    }

    private var isErrored: Bool {
        if case .error = recorder.state { return true }
        if case .error = tts.state { return true }
        return false
    }

    private var chipColor: Color {
        switch client.state {
        case .connected: return .green
        case .connecting: return .yellow
        case .disconnected: return .gray
        case .error: return .red
        }
    }

    private var chipLabel: String {
        switch client.state {
        case .connected: return "已连接"
        case .connecting: return "连接中…"
        case .disconnected: return "未连接"
        case .error(let msg): return "失败: \(msg)"
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        client.sendPromptCurrent(text, defaultCwdForNew: settings.cwd, model: settings.model, permissionMode: settings.permissionMode)
        draft = ""
    }
}

/// Left-side drawer: navigation hub for projects + conversations + actions.
/// Replaces the F1c2 ConversationDebugSheet bottom-up sheet with a slide-in
/// side menu that consolidates "+ 新建对话" / "打开文件夹" / 语音模式 /
/// 设置 / 项目分组列表 / 清理失效项目 in one panel. F1c4.
private struct DrawerContent: View {
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

    /// Same logic as the F1c3 ConversationDebugSheet — group conversations
    /// by cwd, label with project name from registry when available.
    private var groupedByCwd: [CwdGroup] {
        let dict = Dictionary(grouping: client.sortedConversations(), by: \.cwd)
        return dict
            .map { (cwd, convs) -> CwdGroup in
                let project = registry.project(forCwd: cwd)
                let label = project?.name
                    ?? ((cwd as NSString).lastPathComponent.isEmpty
                        ? cwd
                        : (cwd as NSString).lastPathComponent)
                return CwdGroup(cwd: cwd, label: label, registered: project != nil, convs: convs)
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
        let convs: [Conversation]
    }
}

private struct DrawerRow: View {
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

private struct DrawerConversationRow: View {
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

/// New-conversation form: pick from already-opened cwds, or browse to open
/// a new directory. No default — user must explicitly choose so they don't
/// accidentally land in the wrong project. Most-recent cwd is pre-selected
/// for the common "another conversation in the project I just used" flow.
private struct NewConversationSheet: View {
    let pickerStartPath: String  // Where DirectoryPicker opens, NOT a cwd default
    let onCreate: (_ name: String, _ cwd: String) -> Void

    @Environment(BackendClient.self) private var client
    @Environment(\.dismiss) private var dismiss
    @State private var name: String = ""
    @State private var cwd: String? = nil
    /// Tracks whether the user has manually edited the name. While false,
    /// the name auto-updates when cwd changes (so picking a different
    /// directory updates the suggested name). User typing flips it true.
    @State private var nameEdited: Bool = false
    @State private var showPicker: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(autoNamePlaceholder, text: $name)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: name) { _, new in
                            // If user clears the field, treat as un-edited so
                            // it auto-tracks cwd again. Otherwise mark edited
                            // unless the new value matches what we'd auto-fill.
                            if new.isEmpty {
                                nameEdited = false
                            } else if new != currentAutoName {
                                nameEdited = true
                            }
                        }
                } header: {
                    Text("名称")
                } footer: {
                    Text("自动按工作目录命名。第一次发消息后会改成消息开头 30 字（除非你给了自定义名字）。")
                }
                Section {
                    Button {
                        showPicker = true
                    } label: {
                        Label("打开文件夹", systemImage: "folder.badge.plus")
                            .foregroundStyle(Color.accentColor)
                    }
                    if openedCwds.isEmpty {
                        Text("还没打开过项目，点上面浏览选一个。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(openedCwds, id: \.cwd) { item in
                            Button {
                                cwd = item.cwd
                            } label: {
                                OpenedCwdRow(
                                    item: item,
                                    selected: cwd == item.cwd
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } header: {
                    Text("工作目录")
                } footer: {
                    Text("Claude CLI 在此目录下运行。每条对话绑定一个目录，不可中途改。")
                }
            }
            .navigationTitle("新对话")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("开始") {
                        guard let chosenCwd = cwd?.trimmingCharacters(in: .whitespaces),
                              !chosenCwd.isEmpty else { return }
                        // Pass empty string for auto-name so backend's
                        // counter increments; otherwise pass user's name.
                        let finalName = nameEdited ? name : ""
                        onCreate(finalName, chosenCwd)
                    }
                    .fontWeight(.bold)
                    .disabled(cwd == nil)
                }
            }
            .navigationDestination(isPresented: $showPicker) {
                // Always start the picker at the default browse root, never
                // at the currently-selected cwd. User opening "打开文件夹"
                // again expects a fresh navigation, not "stuck inside the
                // last folder I picked".
                DirectoryPicker(initialPath: pickerStartPath) { picked in
                    cwd = picked
                }
            }
            .onAppear {
                // Pre-select most-recently-used cwd as a hint. If none, leave
                // nil and force user to pick via browse.
                if cwd == nil {
                    cwd = openedCwds.first?.cwd
                }
                if name.isEmpty {
                    name = currentAutoName
                }
            }
            .onChange(of: cwd) { _, _ in
                if !nameEdited {
                    name = currentAutoName
                }
            }
        }
    }

    /// What auto-name would be assigned given the currently-selected cwd.
    /// Empty string when no cwd is picked yet — used as the TextField
    /// placeholder and as the value when the user hasn't edited.
    private var currentAutoName: String {
        guard let c = cwd else { return "" }
        return client.peekNextAutoName(forCwd: c)
    }

    /// Placeholder shown in the name TextField. Encourages the user to pick
    /// a cwd first when none is chosen.
    private var autoNamePlaceholder: String {
        if let c = cwd {
            return client.peekNextAutoName(forCwd: c)
        }
        return "请先选工作目录"
    }

    /// All cwds with at least one existing in-memory conversation, with
    /// stats for display. Sorted most-recently-used first.
    private var openedCwds: [OpenedCwd] {
        let dict = Dictionary(grouping: client.conversations.values, by: \.cwd)
        return dict.map { cwd, convs in
            OpenedCwd(
                cwd: cwd,
                count: convs.count,
                lastUsed: convs.map(\.lastUsed).max() ?? .distantPast
            )
        }
        .sorted { $0.lastUsed > $1.lastUsed }
    }
}

private struct OpenedCwd: Identifiable {
    let cwd: String
    let count: Int
    let lastUsed: Date
    var id: String { cwd }
    var basename: String {
        let n = (cwd as NSString).lastPathComponent
        return n.isEmpty ? cwd : n
    }
}

private struct OpenedCwdRow: View {
    let item: OpenedCwd
    let selected: Bool

    private static let relFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        f.locale = Locale(identifier: "zh_CN")
        return f
    }()

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.basename)
                    .font(.body)
                    .foregroundStyle(.primary)
                Text(item.cwd)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("\(item.count) 个对话 · \(Self.relFormatter.localizedString(for: item.lastUsed, relativeTo: Date()))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Spacer()
            if selected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.accentColor)
                    .font(.title3)
            }
        }
        .contentShape(Rectangle())
    }
}

private struct ChatListView: View {
    let messages: [ChatLine]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(messages) { line in
                        ChatLineView(line: line)
                            .id(line.id)
                    }
                }
                .padding(12)
            }
            .onChange(of: messages.last?.id) { _, newID in
                guard let newID else { return }
                withAnimation { proxy.scrollTo(newID, anchor: .bottom) }
            }
            // Also follow assistant streaming updates (id stays same, text grows).
            .onChange(of: messages.last?.text) { _, _ in
                guard let last = messages.last else { return }
                withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
            }
        }
    }
}

private struct ChatLineView: View {
    let line: ChatLine

    var body: some View {
        switch line.role {
        case .user:
            HStack {
                Spacer(minLength: 40)
                Text(line.text)
                    .padding(10)
                    .background(Color.accentColor.opacity(0.18), in: .rect(cornerRadius: 12))
            }
        case .assistant:
            // Full markdown — headings, lists, tables, links, code blocks
            // with copy button. MarkdownUI re-parses on each text change so
            // streaming updates render correctly.
            Markdown(line.text)
                .markdownTheme(.gitHub)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .system:
            Text(line.text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.vertical, 2)
        case .error:
            Text(line.text)
                .font(.caption)
                .foregroundStyle(.red)
                .padding(8)
                .background(.red.opacity(0.08), in: .rect(cornerRadius: 8))
        case .toolUse:
            ToolUseRow(line: line)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .toolResult:
            // A6 v1: independent tool-result row, not linked to its tool_use.
            Text("✓ tool result")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .padding(.vertical, 2)
        }
    }
}

private struct InputBar: View {
    @Binding var draft: String
    let busy: Bool
    let onSend: () -> Void
    let onStop: () -> Void
    let onTranscript: (String) -> Void

    @Environment(VoiceRecorder.self) private var recorder

    var body: some View {
        VStack(spacing: 6) {
            // Recorder status hint above the bar
            if recorder.state != .idle {
                HStack(spacing: 6) {
                    Circle().fill(statusColor).frame(width: 8, height: 8)
                    Text(statusLabel).font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("输入指令，或按住麦克风说话…", text: $draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                    .submitLabel(.send)
                    .onSubmit(onSend)
                pttButton
                if busy {
                    Button(role: .destructive, action: onStop) {
                        Image(systemName: "stop.fill")
                            .frame(width: 44, height: 44)
                    }
                } else {
                    Button(action: onSend) {
                        Image(systemName: "paperplane.fill")
                            .frame(width: 44, height: 44)
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    /// Hold-to-talk: press starts, release stops + transcribes.
    /// We use a long-press gesture with min 0 sec so it engages immediately.
    private var pttButton: some View {
        Button {
            // Tap-to-toggle for accessibility — tap once starts, tap again stops.
            Task { await togglePTT() }
        } label: {
            Image(systemName: recordingIcon)
                .frame(width: 44, height: 44)
                .foregroundStyle(recordingFG)
                .background(recordingBG, in: .circle)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            // Hold-to-talk: starts on press, transcribes on release.
            // minimumDistance > 0 prevents the tap recognizer from firing for holds.
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    if recorder.state == .idle {
                        Task { await recorder.start() }
                    }
                }
                .onEnded { _ in
                    if recorder.state == .recording {
                        Task {
                            if let text = await recorder.stopAndTranscribe(), !text.isEmpty {
                                onTranscript(text)
                            }
                        }
                    }
                }
        )
        .disabled(busy)
    }

    private func togglePTT() async {
        switch recorder.state {
        case .idle:
            await recorder.start()
        case .recording:
            if let text = await recorder.stopAndTranscribe(), !text.isEmpty {
                onTranscript(text)
            }
        default:
            break
        }
    }

    private var recordingIcon: String {
        switch recorder.state {
        case .recording: return "mic.fill"
        case .uploading: return "waveform"
        default: return "mic"
        }
    }
    private var recordingFG: Color {
        recorder.state == .idle ? .accentColor : .white
    }
    private var recordingBG: Color {
        switch recorder.state {
        case .recording: return .red
        case .uploading: return .blue
        default: return Color.accentColor.opacity(0.15)
        }
    }
    private var statusColor: Color {
        switch recorder.state {
        case .recording: return .red
        case .uploading: return .blue
        case .error: return .orange
        default: return .gray
        }
    }
    private var statusLabel: String {
        switch recorder.state {
        case .recording: return "录音中…松开发送"
        case .uploading: return "上传识别中…"
        case .error(let msg): return msg
        default: return ""
        }
    }
}

struct SettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(VoiceSession.self) private var voice
    @Environment(Telemetry.self) private var telemetry
    @Environment(\.dismiss) private var dismiss
    @State private var draftURL: String = ""
    @State private var draftCwd: String = ""
    @State private var draftMode: String = "plan"

    var body: some View {
        @Bindable var s = settings
        NavigationStack {
            Form {
                Section {
                    // Voice mode toggle moved here from the top bar — F1c4
                    // will live in the drawer instead.
                    Button {
                        if voice.active { voice.exit() } else { voice.enter() }
                    } label: {
                        HStack {
                            Image(systemName: voice.active ? "headphones.circle.fill" : "headphones")
                                .foregroundStyle(voice.active ? .green : .accentColor)
                            Text(voice.active ? "退出语音模式" : "进入语音模式")
                                .foregroundStyle(.primary)
                            Spacer()
                            if voice.active {
                                Text("ON").font(.caption.bold()).foregroundStyle(.green)
                            }
                        }
                    }
                } header: {
                    Text("语音模式")
                } footer: {
                    Text("打开后顶部锁屏显示 Now Playing 卡片，输入栏 PTT 切换为按播放=录音的语音流。")
                }
                Section("Backend") {
                    TextField("https://mymac.tailcf3ccf.ts.net", text: $draftURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    Button("用模拟器默认 (localhost:3030)") {
                        draftURL = "http://localhost:3030"
                    }
                    Button("用 Tailscale 默认") {
                        draftURL = "https://mymac.tailcf3ccf.ts.net"
                    }
                }
                Section {
                    TextField("/Users/you/Desktop", text: $draftCwd)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("浏览起始路径")
                } footer: {
                    Text("DirectoryPicker 的默认起始位置。新对话不再用这个作为默认 cwd —— 必须显式选目录。在没选对话时直接发消息会用这里建一条兜底对话。")
                }
                Section {
                    SecureField("CLAUDE_WEB_TOKEN（可选）", text: $s.authToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("鉴权")
                } footer: {
                    Text("如果 backend 启用了 token 认证，粘贴这里。WS 用 ?token= 拼，HTTP 用 Bearer。改完会自动重连。")
                }
                Section("模型") {
                    Picker("模型", selection: $s.model) {
                        Text("Haiku 4.5（快、便宜，默认）").tag("claude-haiku-4-5")
                        Text("Sonnet 4.6（平衡）").tag("claude-sonnet-4-6")
                        Text("Opus 4.7（最强、最贵）").tag("claude-opus-4-7")
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section {
                    Picker("权限模式", selection: $draftMode) {
                        Text("Plan（只读规划，最安全）").tag("plan")
                        Text("Default（每次工具问允许 / 拒绝）").tag("default")
                        Text("Accept Edits（自动允许编辑，Bash 仍问）").tag("acceptEdits")
                        Text("Bypass（自动允许所有工具）⚠️").tag("bypassPermissions")
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("权限模式")
                } footer: {
                    Text("Bypass 模式下 Claude 可以直接跑 Bash / Edit / Write 等任何工具，不再弹询问。**只在你完全信任当前 cwd + 会话内容时**用。")
                }
                Section {
                    Picker("聊天区字号", selection: $s.fontSize) {
                        Text("小").tag("medium")
                        Text("默认").tag("large")
                        Text("大").tag("xLarge")
                        Text("特大").tag("xxLarge")
                        Text("超大").tag("xxxLarge")
                        Text("辅助 1").tag("accessibility1")
                        Text("辅助 2").tag("accessibility2")
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("字号")
                } footer: {
                    Text("用 iOS 标准 DynamicType。改完整个 app 立即生效，包括对话区、菜单、按钮。")
                }
                Section("语音播报") {
                    Toggle("自动播报回答", isOn: $s.ttsEnabled)
                    Picker("风格", selection: $s.speakStyle) {
                        Text("概要（Haiku 改写为 1-4 句）").tag("summary")
                        Text("逐句（原文）").tag("verbatim")
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    .disabled(!s.ttsEnabled)
                    Toggle("慢速朗读（-15%）", isOn: $s.slowTts)
                        .disabled(!s.ttsEnabled)
                }
                Section {
                    Toggle("后台保活（实验性）", isOn: $s.silentKeepalive)
                } header: {
                    Text("实验功能")
                } footer: {
                    Text("开启后会一直播放 0 音量循环音频，**显著提高**切应用 / 锁屏后 WebSocket 保持连接的概率，但**不保证 100% 不断**（iOS 在内存压力 / 网络切换 / 用户滑掉 app 等情况下仍可能挂起）。Apple 视为对后台音频的滥用，**不要在 App Store 版本启用**。仅供 sideload 个人用，电池影响很小。")
                }
                Section {
                    NavigationLink("查看最近事件 (\(telemetry.ring.count))") {
                        TelemetryDebugView()
                    }
                    HStack {
                        Text("上次上报")
                        Spacer()
                        if let t = telemetry.lastFlush {
                            Text(t, format: .relative(presentation: .numeric))
                                .foregroundStyle(.secondary)
                                .font(.caption)
                        } else {
                            Text("还没上报").foregroundStyle(.secondary).font(.caption)
                        }
                    }
                    if let err = telemetry.lastFlushError {
                        Text("上报失败: \(err)")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    Button("立即上报") { telemetry.flushNow() }
                } header: {
                    Text("调试 / 埋点")
                } footer: {
                    Text("事件日志写到后端 ~/.claude-web/telemetry.jsonl。在 Mac 上 `tail -f` 排查 bug 用。")
                }
            }
            .navigationTitle("设置")
            .toolbar {
                // Single "完成" button. Pickers / Toggles bind directly to
                // $s.xxx so they commit inline; only the textfield drafts
                // (URL / cwd) and permission mode need explicit save here.
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") {
                        if let u = URL(string: draftURL) { s.backendURL = u }
                        s.cwd = draftCwd
                        s.permissionMode = draftMode
                        dismiss()
                    }
                    .fontWeight(.bold)
                }
            }
            .onAppear {
                draftURL = settings.backendURL.absoluteString
                draftCwd = settings.cwd
                draftMode = settings.permissionMode
            }
        }
    }
}

/// In-app viewer for the telemetry ring buffer. Newest first; tap a row to
/// see full props. Useful for diagnosing without leaving the device.
struct TelemetryDebugView: View {
    @Environment(Telemetry.self) private var telemetry

    var body: some View {
        List(telemetry.ring) { event in
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(event.event)
                        .font(.caption.monospaced().bold())
                        .foregroundStyle(levelColor(event.level))
                    Spacer()
                    Text(event.timestamp, format: .dateTime.hour().minute().second())
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                }
                if let conv = event.conversationId {
                    Text("conv: \(conv.prefix(8))").font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
                if let runId = event.runId {
                    Text("run: \(runId.prefix(8))").font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
                if let props = event.props, !props.isEmpty {
                    ForEach(props.sorted(by: { $0.key < $1.key }), id: \.key) { kv in
                        Text("  \(kv.key) = \(kv.value)")
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                    }
                }
            }
        }
        .navigationTitle("最近事件")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func levelColor(_ level: Telemetry.Level) -> Color {
        switch level {
        case .info: return .secondary
        case .warn: return .orange
        case .error, .crash: return .red
        }
    }
}

struct PermissionSheet: View {
    let request: PermissionRequest
    let onDecision: (PermissionDecision) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("工具") {
                    Text(request.toolName).font(.title3.bold())
                }
                Section("内容") {
                    Text(request.preview)
                        .font(.body.monospaced())
                        .textSelection(.enabled)
                        .lineLimit(10)
                }
                Section {
                    Button(role: .destructive) {
                        onDecision(.deny)
                        dismiss()
                    } label: {
                        Label("拒绝", systemImage: "xmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    Button {
                        onDecision(.allow)
                        dismiss()
                    } label: {
                        Label("允许", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                            .fontWeight(.semibold)
                    }
                }
            }
            .navigationTitle("权限请求")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
