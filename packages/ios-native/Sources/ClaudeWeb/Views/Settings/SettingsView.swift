import SwiftUI

struct SettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(BackendClient.self) private var client
    @Environment(VoiceSession.self) private var voice
    @Environment(Telemetry.self) private var telemetry
    @Environment(TTSPlayer.self) private var tts
    @Environment(Cache.self) private var cache
    @Environment(HeartbeatMonitor.self) private var heartbeat
    @Environment(HarnessStore.self) private var harnessStore
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
                    MacHeartbeatRow(monitor: heartbeat)
                } header: {
                    Text("Mac 状态")
                } footer: {
                    Text("移动办公时知道远程 Mac 是否在线、是否在跑任务、通知通道是否启用。背景每 5 秒轮询一次，下拉箭头可手动刷新。")
                }
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
                    Toggle("完成提示音", isOn: $s.completionChimeEnabled)
                } header: {
                    Text("朗读")
                } footer: {
                    Text("Claude 回复后是否自动 TTS 播放。**独立于「语音对话」开关**——你可以仅看着屏幕打字、让回答念出来。\n完成提示音：任务结束时播放短音效，不打扰、即时通知，适合手机放一边时。")
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
                    Toggle("启动时自动进入语音模式", isOn: $s.autoEnterVoice)
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
                Section {
                    Toggle("始终显示思考过程", isOn: $s.alwaysExpandThinking)
                    Toggle("详细工具模式", isOn: $s.verboseTools)
                } header: {
                    Text("显示")
                } footer: {
                    Text("思考块与工具卡片是否默认展开。关闭时卡片显示标题行，点击可展开。")
                }
                Section {
                    Toggle("完成后弹 Git 检查", isOn: $s.gitGateEnabled)
                } header: {
                    Text("Git 安全检查")
                } footer: {
                    Text("Claude 跑完一轮后，如果当前对话的 cwd 是 git 仓库且工作区有未提交修改，弹半屏 sheet 显示分支 + 已暂存 / 已修改 / 未跟踪文件清单。出门前快速回顾改了什么。仅监听 `completed` reason，被打断或失败不弹。")
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
                Section {
                    // M0 modelList Round: server-driven model list from HarnessStore.
                    // Filter enabled, but if current selection is in disabled list keep it
                    // displayed with "已停用" annotation (phase 3 cross m1 + arch MAJOR-4(3)).
                    let availableModels = harnessStore.config.modelList
                    let enabledIds = Set(availableModels.filter { $0.enabled }.map { $0.id })
                    let currentSelectionDisabled = !enabledIds.contains(s.model)
                        && availableModels.contains { $0.id == s.model }

                    Picker("模型", selection: $s.model) {
                        ForEach(availableModels.filter { $0.enabled || $0.id == s.model }, id: \.id) { m in
                            HStack {
                                Text(m.displayName)
                                if !m.enabled {
                                    Text("已停用")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                if let desc = m.description {
                                    Spacer()
                                    Text(desc)
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .tag(m.id)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()

                    if currentSelectionDisabled {
                        Text("⚠️ 您当前选择的模型已被服务端停用，切换后不可再选回")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    if harnessStore.isStale {
                        Text("（离线 / 未连接，使用本地缓存或打包内默认列表）")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                } header: {
                    Text("模型")
                } footer: {
                    Text("模型列表由服务端配置（/api/harness/config）。改服务端 fallback-config.json 重启 backend 后会自动同步。")
                }
                Section {
                    // M0 permissionModes Round (v1.1): server-driven from HarnessStore.
                    // Cutover: 已选 mode 仍在 list 则保留；否则切 server isDefault.
                    let permModes = harnessStore.permissionModes
                    Picker("权限模式", selection: $draftMode) {
                        ForEach(permModes, id: \.id) { mode in
                            HStack {
                                Text(mode.displayName)
                                    .foregroundStyle(riskColor(mode.riskLevel))
                                if let desc = mode.description {
                                    Spacer()
                                    Text(desc)
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                        .lineLimit(2)
                                }
                            }
                            .tag(mode.id)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("权限模式")
                } footer: {
                    Text("由服务端配置 (/api/harness/config)。Bypass 模式下 Claude 可以直接跑 Bash / Edit / Write 等任何工具，不再弹询问。**只在你完全信任当前 cwd + 会话内容时**用。")
                }
                Section {
                    // M0 agentProfiles Round (v1.2): server-driven 只读列表。
                    // M0 期 11 项 disabled + PM enabled (M1 discovery 准备); M2 真 spawn 时此处升级为可触发。
                    let profiles = harnessStore.agentProfiles
                    ForEach(profiles, id: \.id) { profile in
                        HStack(alignment: .top, spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(profile.displayName)
                                        .font(.body)
                                        .foregroundStyle(profile.enabled ? .primary : .secondary)
                                    Text(profile.modelHint)
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 1)
                                        .background(modelHintColor(profile.modelHint).opacity(0.18))
                                        .foregroundStyle(modelHintColor(profile.modelHint))
                                        .clipShape(Capsule())
                                }
                                Text(profile.description)
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                                    .lineLimit(2)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(profile.stage)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                if profile.enabled {
                                    Text("ENABLED")
                                        .font(.caption2.bold())
                                        .foregroundStyle(.green)
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Text("Agent Profiles (\(harnessStore.agentProfiles.count))")
                } footer: {
                    Text("由服务端配置 (/api/harness/config v1.2)。M0 期仅 PM 启用（M1 discovery 准备），其余 11 项 M2 真 agent spawn 时打开。改 fallback-config.json 重启 backend 即可热更。")
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
                    NavigationLink {
                        HelpView()
                    } label: {
                        HStack {
                            Image(systemName: "book.fill")
                                .foregroundStyle(Color.accentColor)
                            Text("使用手册")
                        }
                    }
                } header: {
                    Text("帮助")
                } footer: {
                    Text("离线查看功能说明和快捷键，会自动更新到最新版本。")
                }
                Section {
                    NavigationLink {
                        HealthCheckView()
                    } label: {
                        HStack {
                            Image(systemName: "stethoscope")
                                .foregroundStyle(Color.accentColor)
                            Text("诊断 / 健康检查")
                        }
                    }
                } header: {
                    Text("诊断")
                } footer: {
                    Text("逐项检查 backend 连接、Claude CLI、订阅凭证、whisper / ffmpeg / edge-tts、项目注册表是否可用。出问题时一键复制脱敏报告。")
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
                        Text("v\(BuildInfo.marketingVersion) (build \(BuildInfo.buildNumber))")
                            .foregroundStyle(.secondary)
                            .font(.caption.monospacedDigit())
                    }
                    HStack {
                        Text("Git")
                        Spacer()
                        Text(BuildInfo.gitSha)
                            .foregroundStyle(BuildInfo.gitSha.contains("dirty") ? .orange : .secondary)
                            .font(.caption.monospaced())
                    }
                    HStack(alignment: .top) {
                        Text("最后提交")
                        Spacer()
                        Text(formatGitTime(BuildInfo.gitCommitTime))
                            .foregroundStyle(.secondary)
                            .font(.caption.monospacedDigit())
                    }
                    HStack(alignment: .top) {
                        Text("提交说明")
                        Spacer()
                        Text(BuildInfo.gitCommitSubject)
                            .foregroundStyle(.secondary)
                            .font(.caption)
                            .multilineTextAlignment(.trailing)
                            .lineLimit(2)
                    }
                    HStack {
                        Text("构建于")
                        Spacer()
                        Text(formatBuildTime(BuildInfo.buildTime))
                            .foregroundStyle(.secondary)
                            .font(.caption.monospacedDigit())
                    }
                    Button {
                        UIPasteboard.general.string = BuildInfo.summary
                    } label: {
                        HStack {
                            Image(systemName: "doc.on.doc")
                            Text("复制完整版本信息")
                        }
                        .font(.caption)
                    }
                } header: {
                    Text("关于")
                } footer: {
                    Text(BuildInfo.summary).font(.caption.monospaced())
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

    /// Map server-driven riskLevel string to UI color. Unknown values fall back
    /// to .primary + telemetry warn (called via HarnessStore.notifyUnknownRiskLevel).
    /// Phase 3 cross M2 + arch react: hint-only string, NOT enum-locked.
    private func riskColor(_ riskLevel: String?) -> Color {
        switch riskLevel {
        case "low": return .primary
        case "medium": return .orange
        case "high": return .red
        case nil: return .primary
        default:
            // Unknown value (e.g. server adds "critical" later) — UI default + log
            harnessStore.notifyUnknownRiskLevel(modeId: "?", riskLevel: riskLevel ?? "")
            return .primary
        }
    }

    /// Map agentProfile.modelHint to a chip color. hint-only string, unknown values
    /// fall back to neutral. Mirrors riskColor pattern for permissionModes.
    private func modelHintColor(_ hint: String) -> Color {
        switch hint {
        case "opus": return .purple
        case "sonnet": return .blue
        case "haiku": return .teal
        case "adaptive": return .orange
        default: return .secondary
        }
    }

    /// Format ISO 8601 commit time as "MM-dd HH:mm" for compact display.
    private func formatGitTime(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let d = date else { return iso }
        let f = DateFormatter()
        f.dateFormat = "MM-dd HH:mm"
        return f.string(from: d)
    }

    /// Same as formatGitTime but for buildTime (always Z UTC; show local).
    private func formatBuildTime(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        let date = parser.date(from: iso)
        guard let d = date else { return iso }
        let f = DateFormatter()
        f.dateFormat = "MM-dd HH:mm"
        return f.string(from: d)
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
