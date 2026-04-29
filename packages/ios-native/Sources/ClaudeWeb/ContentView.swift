// Top-level UI: connection chip + chat list + input + settings sheet.
// M1 scope: text-only. M2 will inline a PTT button next to send.

import SwiftUI

struct ContentView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(BackendClient.self) private var client
    @Environment(VoiceRecorder.self) private var recorder
    @Environment(TTSPlayer.self) private var tts
    @Environment(VoiceSession.self) private var voice
    @Environment(ProjectRegistry.self) private var registry
    @State private var draft: String = ""
    @State private var showSettings = false
    @State private var showDrawer = false
    @State private var showFilePanel = false
    @State private var selectedFile: (cwd: String, relativePath: String, entry: FsEntry)? = nil

    var body: some View {
        GeometryReader { geo in
            let drawerWidth = min(geo.size.width * 0.92, 380)
            ZStack {
                mainContent
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 20)
                            .onEnded { val in
                                let startX = val.startLocation.x
                                let endX = val.startLocation.x + val.translation.width
                                let dx = val.translation.width
                                let dy = val.translation.height
                                guard !showDrawer, !showFilePanel else { return }
                                // Left-edge swipe → left drawer
                                if startX < 30 && dx > 60 && abs(dx) > abs(dy) * 2 {
                                    withAnimation { showDrawer = true }
                                }
                                // Right-edge swipe → file drawer
                                if endX > geo.size.width - 30 && dx < -60 && abs(dx) > abs(dy) * 2 {
                                    withAnimation { showFilePanel = true }
                                }
                            }
                    )
                    .overlay {
                        if showDrawer || showFilePanel {
                            Color.black.opacity(0.4)
                                .ignoresSafeArea()
                                .onTapGesture {
                                    withAnimation {
                                        showDrawer = false
                                        showFilePanel = false
                                    }
                                }
                                .transition(.opacity)
                        }
                    }

                // Left drawer
                if showDrawer {
                    HStack(spacing: 0) {
                        DrawerContent(
                            isOpen: $showDrawer,
                            showSettings: $showSettings
                        )
                        .frame(width: drawerWidth)
                        .frame(maxHeight: .infinity)
                        .background(Color(.systemBackground))
                        .ignoresSafeArea(edges: .bottom)
                        .simultaneousGesture(
                            DragGesture(minimumDistance: 30)
                                .onEnded { val in
                                    let dx = val.translation.width
                                    let dy = val.translation.height
                                    if dx < -50 && abs(dx) > abs(dy) * 2 {
                                        withAnimation { showDrawer = false }
                                    }
                                }
                        )
                        Spacer()
                    }
                    .transition(.move(edge: .leading))
                }

                // Right file drawer
                if showFilePanel {
                    HStack(spacing: 0) {
                        Spacer()
                        FileBrowserPanel(
                            cwd: currentCwd,
                            onFileSelected: { cwd, relativePath, entry in
                                selectedFile = (cwd: cwd, relativePath: relativePath, entry: entry)
                            }
                        )
                        .frame(width: min(geo.size.width * 0.80, 320))
                        .frame(maxHeight: .infinity)
                        .background(Color(.systemBackground))
                        .ignoresSafeArea(edges: .bottom)
                        .simultaneousGesture(
                            DragGesture(minimumDistance: 30)
                                .onEnded { val in
                                    let dx = val.translation.width
                                    let dy = val.translation.height
                                    if dx > 50 && abs(dx) > abs(dy) * 2 {
                                        withAnimation { showFilePanel = false }
                                    }
                                }
                        )
                    }
                    .transition(.move(edge: .trailing))
                }
            }
            .animation(.easeInOut(duration: 0.25), value: showDrawer)
            .animation(.easeInOut(duration: 0.25), value: showFilePanel)
        }
        .dynamicTypeSize(settings.dynamicTypeSize)
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .sheet(item: Binding(
            get: { client.currentPendingPermission },
            set: { _ in /* dismissed by replyPermission */ }
        )) { req in
            PermissionSheet(request: req, client: client) { decision in
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
                if let err = voice.displayError {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text(err)
                            .font(.caption)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                        Button("关闭") {
                            voice.dismissError()
                        }
                        .font(.caption)
                    }
                    .padding(8)
                    .background(.orange.opacity(0.15))
                }
                ChatListView(messages: client.currentMessages)
                    .frame(maxHeight: .infinity)
                Divider()
                if client.activeRunCount > 0 {
                    HStack(spacing: 4) {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.secondary)
                        Text("Wandering...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.bar)
                }
                if !client.currentPendingQueue.isEmpty {
                    QueueStrip(
                        queue: client.currentPendingQueue,
                        onRemove: { id in client.removeQueuedPrompt(id: id) }
                    )
                }
                InputBar(
                    draft: $draft,
                    cwd: currentCwd,
                    busy: client.currentBusy,
                    onSend: { attachments in send(attachments) },
                    onQueue: { attachments in enqueue(attachments) },
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
                            // Show a colored dot ONLY when something's wrong —
                            // healthy connection is silent (no clutter). Errors
                            // get a red dot here AND the verbose banner below.
                            if !isConnected {
                                Circle()
                                    .fill(chipColor)
                                    .frame(width: 8, height: 8)
                                    .accessibilityLabel("连接状态：\(chipLabel)")
                            }
                        }
                    }
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 1) {
                            HStack(spacing: 4) {
                                Text(currentProjectName)
                                    .font(.headline)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
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
                            HStack(spacing: 3) {
                                statusIndicator
                                Text(currentTitle)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        HStack(spacing: 8) {
                            ttsControls
                            Button {
                                withAnimation(.easeInOut(duration: 0.25)) { showFilePanel.toggle() }
                            } label: {
                                Image(systemName: "doc.text.magnifyingglass")
                                    .foregroundStyle(showFilePanel ? Color.accentColor : .secondary)
                            }
                            .accessibilityLabel(showFilePanel ? "关闭文件面板" : "打开文件面板")
                        }
                    }
                }
        }
        .sheet(isPresented: Binding(
            get: { selectedFile != nil },
            set: { if !$0 { selectedFile = nil } }
        )) {
            if let (cwd, relativePath, entry) = selectedFile {
                FilePreviewSheet(cwd: cwd, relativePath: relativePath, entry: entry)
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
            // Stale cache may have persisted the sessionId UUID as the title.
            if isUUIDLike(conv.title) { return "（历史会话）" }
            return conv.title
        }
        return "新建"
    }

    private func isUUIDLike(_ s: String) -> Bool {
        s.count == 36 && s.filter({ $0 == "-" }).count == 4
    }

    private var currentCwd: String {
        if let id = client.currentConversationId,
           let conv = client.conversations[id] {
            return conv.cwd
        }
        return settings.cwd
    }

    /// Project name shown in the toolbar's principal slot. Falls back to
    /// the cwd's basename if the cwd isn't registered as a server project,
    /// and to "Seaidea" when there's no current conversation at all.
    private var currentProjectName: String {
        guard let id = client.currentConversationId,
              let conv = client.conversations[id] else {
            return "Seaidea"
        }
        if let project = registry.project(forCwd: conv.cwd) {
            return project.name
        }
        let base = (conv.cwd as NSString).lastPathComponent
        return base.isEmpty ? "Seaidea" : base
    }


    /// Tiny prefix icon inside the conversation chip. Mirrors the most
    /// load-bearing slice of `voice.state` so the user can tell at a glance
    /// whether Claude is recording / transcribing / thinking — without
    /// having to look at the chat list. TTS-playing/paused states are
    /// intentionally omitted because `ttsControls` already shows them
    /// explicitly with playback buttons. Errors live in the banner.
    @ViewBuilder
    private var statusIndicator: some View {
        switch voice.state {
        case .recording:
            Image(systemName: "mic.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.red)
        case .transcribing:
            Image(systemName: "waveform")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.blue)
                .symbolEffect(.variableColor.iterative, isActive: true)
        case .thinking:
            Image(systemName: "ellipsis")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.orange)
                .symbolEffect(.pulse, isActive: true)
        case .idle, .playingTTS, .pausedTTS, .error:
            EmptyView()
        }
    }

    @ViewBuilder
    private var ttsControls: some View {
        // Error indicator removed — all voice/TTS errors now surface through
        // the single banner above ChatListView (driven by voice.displayError).
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

    private func send(_ attachments: [ImageAttachment] = []) {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let atts: [ImageAttachment]? = attachments.isEmpty ? nil : attachments
        guard !text.isEmpty || atts != nil else { return }
        client.sendPromptCurrent(
            text.isEmpty ? "(图片)" : text,
            defaultCwdForNew: settings.cwd,
            model: settings.model,
            permissionMode: settings.permissionMode,
            attachments: atts
        )
        draft = ""
    }

    private func enqueue(_ attachments: [ImageAttachment] = []) {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let atts: [ImageAttachment]? = attachments.isEmpty ? nil : attachments
        guard !text.isEmpty || atts != nil else { return }
        client.enqueuePromptCurrent(
            text.isEmpty ? "(图片)" : text,
            model: settings.model,
            permissionMode: settings.permissionMode,
            attachments: atts
        )
        draft = ""
    }
}

// MARK: - QueueStrip

private struct QueueStrip: View {
    let queue: [QueuedPrompt]
    let onRemove: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 12)
                ForEach(queue) { item in
                    HStack(spacing: 4) {
                        Text(String(item.text.prefix(28)) + (item.text.count > 28 ? "…" : ""))
                            .font(.caption)
                            .lineLimit(1)
                        Button { onRemove(item.id) } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 9, weight: .semibold))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.secondary.opacity(0.15), in: .capsule)
                }
            }
            .padding(.trailing, 12)
            .padding(.vertical, 6)
        }
        .background(.bar)
    }
}
