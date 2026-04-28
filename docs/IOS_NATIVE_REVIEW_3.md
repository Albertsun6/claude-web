# iOS Native — Round 3 评审 (后台保活解耦 + Bypass 权限模式)

> 第二轮评审在 `docs/IOS_NATIVE_REVIEW_2.md`，6 个问题 + 3 个 bug 已 fix
> （commit `a95f124`）。这一轮新增两个变更需要审：
>
> - `911466e` — Bypass 权限模式（自动允许所有工具）
> - `e02c3a5` — Silent keepalive 解耦于语音模式，独立运行
>
> 用户场景：每天用 iPhone 跟 Claude 协作，**切到其它 app 再回来 WS 不能断**。
> 之前 silent loop 只在语音模式启动；现在用户开 Bypass + 后台保活后，
> 切应用、锁屏都不掉链子。这是 v1 日常可用的关键。

## 这一轮要审的关键代码

### 1. Bypass 权限模式

简单：picker 多一个选项映射到 backend 已支持的 `bypassPermissions` 值。

```swift
// ContentView.swift Settings
Section {
    Picker("权限模式", selection: $draftMode) {
        Text("Plan（只读规划，最安全）").tag("plan")
        Text("Default（每次工具问允许 / 拒绝）").tag("default")
        Text("Accept Edits（自动允许编辑，Bash 仍问）").tag("acceptEdits")
        Text("Bypass（自动允许所有工具）⚠️").tag("bypassPermissions")
    }
} header: {
    Text("权限模式")
} footer: {
    Text("Bypass 模式下 Claude 可以直接跑 Bash / Edit / Write 等任何工具，不再弹询问。**只在你完全信任当前 cwd + 会话内容时**用。")
}
```

后端协议 / cli-runner 已经支持，无需改。

### 2. Silent keepalive 独立运行（核心变更）

**之前**：silent loop 只在 `voice.enter()` 启动 + `voice.exit()` 停止 →
退出语音模式即停 → 切其它 app 30 秒后 iOS 挂起 → WS 断。

**现在**：silent loop 由 `silentKeepalive` 标志独立控制 → 即使没进入
语音模式也能保活。

```swift
// VoiceSession.swift

func applySilentKeepaliveChange() {
    if settings?.silentKeepalive == true {
        ensureAudioSessionForKeepalive()
        startSilentLoop(force: true)
    } else if !active {
        stopSilentLoop()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    } else {
        // Voice mode keeps session alive; just stop the loop.
        stopSilentLoop()
    }
    refresh()
}

/// Lightweight session for keep-alive when voice mode is OFF — doesn't
/// need mic, so .playback is sufficient and avoids prompting for mic
/// permission unnecessarily.
private func ensureAudioSessionForKeepalive() {
    if active { return }  // Voice mode (.playAndRecord) wins
    let s = AVAudioSession.sharedInstance()
    do {
        try s.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers, .mixWithOthers])
        try s.setActive(true)
    } catch {
        lastError = "保活会话激活失败: \(error.localizedDescription)"
    }
}

func enter() {
    do {
        try AVAudioSession.sharedInstance().setCategory(
            .playAndRecord,    // upgrade for mic
            mode: .spokenAudio,
            options: [.duckOthers, .defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP]
        )
        try AVAudioSession.sharedInstance().setActive(true, options: [])
    } catch { ... }
    startSilentLoop()    // no-op if loop already running
    registerRemoteCommands()
    active = true
    refresh()
}

func exit() {
    // ... cancel recorder/TTS by state ...
    unregisterRemoteCommands()
    clearNowPlaying()
    active = false
    if settings?.silentKeepalive == true {
        // KEEP loop alive; just downgrade session category.
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, ...)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch { lastError = "..." }
    } else {
        stopSilentLoop()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
}
```

**App.swift wiring:**
```swift
.onAppear {
    client.connect()
    voice.applySilentKeepaliveChange()  // ← apply at launch
}
.onChange(of: settings.silentKeepalive) { _, _ in
    voice.applySilentKeepaliveChange()
}
```

### 3. UI 文案

```swift
// rename: 锁屏保活 → 后台保活
Toggle("后台保活（实验性）", isOn: $s.silentKeepalive)
// footer 改成强调"切应用 WS 不断 + 锁屏 Now Playing"两件事
```

## 我自审的几个点

### A. AVAudioSession category 切换时 silent loop 还在播 — 安全吗？

具体场景：用户开了 keepalive，session 是 `.playback`。然后进语音模式
→ `enter()` 把 category 切到 `.playAndRecord`（同一行 setCategory）。
切换瞬间 silent loop 是不是会被 hard-stop？还是因为 AVAudioPlayer 是
独立 instance，会自动跨过 category 变化继续播？

我**没在真机验证**这个切换行为。如果切换会导致 silent loop 暂停 →
WS 断的窗口可能短暂出现。

### B. setActive(true) 在 keepalive 已持有 session 时再调一次

`enter()` 不管之前状态都调 `setActive(true)`。如果 keepalive 已经
activated 了 session，再次 setActive 是否安全 / 还是会触发 audio
interruption？iOS 的语义不太清晰。

### C. .mixWithOthers 选项对其他媒体 app 的影响

我加了 `.mixWithOthers`：用户开着保活 → 在 YouTube / Spotify 听东西
→ 我们的静音循环不应该 ducking 它们。但 `.duckOthers` 也在 options
里，两个一起放是矛盾的（duck 是降低别的，mix 是允许并行）。

我**应该删掉 .duckOthers** 在 keepalive 模式下 —— 否则用户开着保活
的瞬间，Spotify 音量会降低（即使我们一直静音）。语音模式才需要
duck。

### D. iOS 后台 audio session 的真实保活上限

文档说 `audio` background mode + active session 可以保持 app 不被挂
起。但这是有上限的：
- iOS 会在某些情况下回收资源（系统压力 / 内存不够）
- 用户主动滑掉 app 后 audio mode 也救不了
- 飞行模式 + 切应用可能导致 setActive 失败

**最坏情况下用户切应用 5 分钟回来发现 WS 还是断了**。我应该承诺
"大多数情况下 WS 不断"，不能承诺 100%。文档里要不要写这个免责？

### E. 第一次开保活时 setActive(true) 可能弹麦克风权限？

`.playback` category 不需要麦权限。`.playAndRecord` 才需要。我目前
keepalive 用的是 `.playback`，所以**不应该**弹麦权限。但用户首次
进入语音模式时还是会弹（VoiceRecorder.requestMicPermission）。

### F. App 退到后台时 .onChange / .onAppear 不会触发

如果用户在前台开了保活 → 切到其它 app → 30s 后回来 → onAppear 又
跑一次 applySilentKeepaliveChange。这是 idempotent 的（loop 已在跑
就跳过），不应该有 double-init 问题。但是**如果 iOS 已经把我们挂起
了**，onAppear 触发时 loop 已经停了 — 重启 loop 应该工作？

## 给评审的 6 个问题

1. **Category 切换时 AVAudioPlayer 持续性**：从 .playback 升级到
   .playAndRecord 时，已经在 numberOfLoops=-1 播的 silent loop 会
   被打断吗？需要 setActive(false) → setCategory → setActive(true)
   还是直接 setCategory 即可？

2. **`.duckOthers` + `.mixWithOthers` 同时设是不是冲突**？应该按状态
   分开（语音模式用 duckOthers，保活模式用 mixWithOthers）吗？

3. **keepalive 模式应不应用 `.allowBluetoothHFP`**？现在没加。如果
   用户 AirPods 在听，我们的 session 切到 .playback 会不会强制 A2DP
   而非 HFP？

4. **applySilentKeepaliveChange 的 idempotency**：场景 — 用户在前台
   切换开关、进入退出语音模式、应用进入后台再回来，每个组合下行为
   都应该一致。我没穷举测试。哪些场景最容易踩坑？

5. **Bypass 模式默认值**：我没改默认（仍是 plan）。Bypass 这种"自动
   允许所有"在用户重启 app / 重连 WS 后**应该重置回 Default 还是
   持久化保留**？现在持久化。如果不小心 Bypass 留着了，下次开 app
   随便说话可能跑了不该跑的命令。是否应该 session-only？

6. **App Store 风险**：现在 silent loop 是默认关，但用户开了之后
   即使切到 TestFlight / 公开版本也持久化。要不要在 Apple Developer
   subscription 检测到时强制关闭 silentKeepalive？或者只在 sideload
   build 暴露这个开关？

## v1 通过门槛检查

第二轮评审定义的 v1 门槛：

| 项 | 状态 |
|---|---|
| Section 1/2/3/5 全部通过 | 1/2/3/5: ✅ Section 1 完成（含 1.11/1.12 模型切换需补测）；2/3/5 待真机测 |
| 前台 PTT 连续 20 次 | 待测 |
| TTS 在 AirPods 和扬声器都稳定 | 待测 |
| 不开 keepalive 核心流程仍好用 | ✅ 设计上是 |
| 模型切换至少验一次 new + resume | 待测 |

新增的"切应用 WS 不断"是用户日常使用的隐性必达项，靠这次的 keepalive
解耦修复实现，需要审查上面 6 个问题确认稳健。

## 文件变更范围

```
packages/ios-native/Sources/ClaudeWeb/
├── VoiceSession.swift   # applySilentKeepaliveChange decoupled, exit() conditional
├── ContentView.swift    # 后台保活 rename + footer 重写; Bypass 选项
└── ClaudeWebApp.swift   # onAppear apply keepalive
```

提交：
- `911466e` feat(ios-native): add Bypass permission mode to settings
- `e02c3a5` feat(ios-native): silent keepalive now runs independently of voice mode

## 请你回答

1. 上面 6 个问题
2. 还有什么场景 / 边界 round 3 引入的新风险？
3. v1 现在能不能日常用？还差什么必做？
