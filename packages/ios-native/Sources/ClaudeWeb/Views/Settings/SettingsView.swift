import SwiftUI

struct SettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(BackendClient.self) private var client
    @Environment(VoiceSession.self) private var voice
    @Environment(Telemetry.self) private var telemetry
    @Environment(TTSPlayer.self) private var tts
    @Environment(Cache.self) private var cache
    @Environment(\.dismiss) private var dismiss
    @State private var draftURL: String = ""
    @State private var draftCwd: String = ""
    @State private var draftMode: String = "plan"
    @State private var showResetConfirm = false
    @State private var showResetDone = false

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown"
    }

    var body: some View {
        @Bindable var s = settings
        NavigationStack {
            Form {
                Section {
                    Toggle("自动朗读回答", isOn: $s.ttsEnabled)
                    Picker("风格", selection: $s.speakStyle) {
                        Text("概要（Haiku 改写为 1-4 句）").tag("summary")
                        Text("逐句（原文）").tag("verbatim")
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    .disabled(!s.ttsEnabled)
                    Toggle("慢速朗读（-15%）", isOn: $s.slowTts)
                        .disabled(!s.ttsEnabled)
                } header: {
                    Text("朗读")
                } footer: {
                    Text("Claude 回复后是否自动 TTS 播放。**独立于「语音对话」开关**——你可以仅看着屏幕打字、让回答念出来。")
                }
                Section {
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
                    Text("语音对话（Hands-free）")
                } footer: {
                    Text("戴耳机锁屏后的连续语音对话：接管麦克风 + 锁屏 / 耳机按键 + 显示 Now Playing 卡片 + 长按麦松开**直接发送**。**不影响「自动朗读」独立设置**——开了语音模式但关了自动朗读也能用。")
                }
                Section {
                    Toggle("后台保活（实验性）", isOn: $s.silentKeepalive)
                } header: {
                    Text("后台连接")
                } footer: {
                    Text("仅用于切走 app / 锁屏后**保持 WebSocket 不掉线**，不接管麦克风、不影响 PTT。原理是播放 0 音量循环音频骗过 iOS 后台挂起。**显著提高**保持率但不保证 100%。Apple 视为后台音频滥用，**不要在 App Store 版本启用**；sideload 自用没事，电池影响很小。")
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
                Section {
                    Button("重置应用数据", role: .destructive) {
                        showResetConfirm = true
                    }
                } header: {
                    Text("危险操作")
                } footer: {
                    Text("清除所有本地数据：UserDefaults（backend / cwd / 当前对话焦点 / 设置）+ 缓存对话和消息历史。**后端 jsonl 不删**。重置后请关闭并重新打开 app。")
                }
                Section {
                    HStack {
                        Text("版本")
                        Spacer()
                        Text(appVersion)
                            .foregroundStyle(.secondary)
                            .font(.caption)
                    }
                    HStack {
                        Text("构建")
                        Spacer()
                        Text(buildNumber)
                            .foregroundStyle(.secondary)
                            .font(.caption)
                    }
                } header: {
                    Text("关于")
                } footer: {
                    Text("Seaidea v\(appVersion) (build \(buildNumber))")
                }
            }
            .alert("确认重置应用数据？", isPresented: $showResetConfirm) {
                Button("取消", role: .cancel) {}
                Button("重置", role: .destructive) { performReset() }
            } message: {
                Text("此操作不可撤销。重置后请关闭并重开 app。")
            }
            .alert("已重置", isPresented: $showResetDone) {
                Button("好", role: .cancel) {}
            } message: {
                Text("数据已清除。请双击 Home 上滑关闭 app，再重新打开以应用。")
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

    /// Wipe all client-side state. Intentionally does NOT touch backend
    /// data (~/.claude-web/projects.json, ~/.claude/projects/*.jsonl).
    /// Caller must restart the app for new state to take effect.
    private func performReset() {
        telemetry.warn("app.reset")
        // Cancel TTS + interrupt any in-flight runs first so we don't
        // leave background audio / sockets pointing at stale state.
        tts.cancel()
        client.disconnect()
        cache.eraseAll()
        AppSettings.eraseAllUserDefaults()
        showResetDone = true
    }
}
