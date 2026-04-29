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

    var body: some View {
        GeometryReader { geo in
            let drawerWidth = min(geo.size.width * 0.85, 320)
            ZStack(alignment: .leading) {
                mainContent
                    // Edge-swipe from the left opens the drawer. Constrained
                    // to the leftmost 30pt + horizontal movement dominant
                    // over vertical so list scrolls don't trigger it.
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 20)
                            .onEnded { val in
                                let startX = val.startLocation.x
                                let dx = val.translation.width
                                let dy = val.translation.height
                                guard !showDrawer else { return }
                                if startX < 30 && dx > 60 && abs(dx) > abs(dy) * 2 {
                                    withAnimation { showDrawer = true }
                                }
                            }
                    )
                    .overlay {
                        if showDrawer {
                            // Tap or swipe on the dim overlay closes the drawer.
                            Color.black.opacity(0.4)
                                .ignoresSafeArea()
                                .onTapGesture {
                                    withAnimation { showDrawer = false }
                                }
                                .gesture(
                                    DragGesture(minimumDistance: 20)
                                        .onEnded { val in
                                            if val.translation.width < -40 {
                                                withAnimation { showDrawer = false }
                                            }
                                        }
                                )
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
                    // simultaneousGesture (not .gesture) so the drawer's
                    // inner List/ScrollView still scrolls vertically while
                    // a horizontal-dominant swipe closes the drawer.
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
                    HStack(spacing: 6) {
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
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 6) {
                        ttsControls
                        // Soft pill — minimal chrome, blends into the nav bar
                        // but still readable as tap-to-switch.
                        Button {
                            withAnimation { showDrawer = true }
                        } label: {
                            HStack(spacing: 4) {
                                statusIndicator
                                followIndicator
                                Text(currentTitle)
                                    .font(.subheadline)
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Image(systemName: "chevron.up.chevron.down")
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(Color.accentColor)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Color(.tertiarySystemFill), in: .capsule)
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

    /// Indicator shown when the current conversation is mirroring a
    /// Claude Code session running in another client. Tap-to-switch via
    /// the chip already opens the drawer; user takes over by typing a
    /// prompt (BackendClient.sendPrompt unsubscribes automatically).
    @ViewBuilder
    private var followIndicator: some View {
        if client.isFollowing(client.currentConversationId) {
            Image(systemName: "dot.radiowaves.left.and.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.green)
                .symbolEffect(.pulse, isActive: true)
                .accessibilityLabel("正在跟随 Claude Code 会话")
        }
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

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        client.sendPromptCurrent(text, defaultCwdForNew: settings.cwd, model: settings.model, permissionMode: settings.permissionMode)
        draft = ""
    }
}
