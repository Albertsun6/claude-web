# iOS Native — Round 2 评审 (M4.5 + A + 模型选择器 + 锁屏挂起)

> 评审给另一个 AI。第一轮评审报告在 `docs/IOS_NATIVE_REVIEW.md`，对方提了
> 8 条全部接受，已经在 M4.5 commit `3ad534b` 修了。这次评审范围是
> M4.5 之后的两个 commit + 一处架构决策：
>
> - `710e7f3` — 锁屏 Now Playing 静音保活 + 错误 banner + 文案对齐
> - `6cb852d` — 静音保活降级为实验 opt-in，新增模型选择器
> - 设计决策：Section 4（锁屏长时间空闲后远程命令）被挂起作为实验性功能

## 这一轮要审的关键代码

### 1. 静音保活循环 + 实验性 opt-in

**目的**：iOS 不会为"激活但没有真实音频在播"的 audio session 显示
Now Playing 卡片。WWDC22 PushToTalk 才是 Apple 给的"正路"，但需要专门
entitlement，私人 Claude 助手拿不到。所以走通用 hack：播 0 音量循环
WAV 让 iOS 视为媒体 app。

但这个 hack [Apple 论坛](https://developer.apple.com/forums/thread/91872)
提到过会被 App Review 拒，所以 round 2 把它降成 opt-in 默认关。

**关键代码** ([packages/ios-native/Sources/ClaudeWeb/VoiceSession.swift](packages/ios-native/Sources/ClaudeWeb/VoiceSession.swift)):

```swift
private var silentLoop: AVAudioPlayer?

func enter() {
    do {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(.playAndRecord, mode: .spokenAudio, options: [...])
        try s.setActive(true, options: [])
    } catch { lastError = "..."; return }
    startSilentLoop()       // ← 新增
    registerRemoteCommands()
    active = true
    refresh()
}

private func startSilentLoop() {
    // Opt-in only.
    guard settings?.silentKeepalive == true else { return }
    guard silentLoop == nil else { return }
    do {
        let p = try AVAudioPlayer(data: Self.silentWAV)
        p.numberOfLoops = -1
        p.volume = 0
        p.prepareToPlay()
        p.play()
        silentLoop = p
    } catch {
        lastError = "静音保活失败: \(error.localizedDescription)"
    }
}

private func stopSilentLoop() {
    silentLoop?.stop()
    silentLoop = nil
}

/// In-memory 0.5s silent 16kHz mono WAV (~16KB)
private static let silentWAV: Data = {
    let sampleRate: UInt32 = 16_000
    let seconds: Double = 0.5
    let samples = Int(Double(sampleRate) * seconds)
    let dataBytes = samples * 2
    var d = Data()
    d.append("RIFF".data(using: .ascii)!)
    d.append(le(UInt32(36 + dataBytes)))
    d.append("WAVE".data(using: .ascii)!)
    d.append("fmt ".data(using: .ascii)!)
    d.append(le(UInt32(16)))
    d.append(le(UInt16(1)))      // PCM
    d.append(le(UInt16(1)))      // mono
    d.append(le(sampleRate))
    d.append(le(UInt32(sampleRate * 2)))
    d.append(le(UInt16(2)))
    d.append(le(UInt16(16)))
    d.append("data".data(using: .ascii)!)
    d.append(le(UInt32(dataBytes)))
    d.append(Data(repeating: 0, count: dataBytes))
    return d
}()
```

### 2. Now Playing metadata 调整

```swift
private func updateNowPlaying() {
    var info: [String: Any] = [:]
    info[MPMediaItemPropertyTitle] = "Claude Voice · " + title()
    info[MPMediaItemPropertyArtist] = "claude-web"
    // playbackRate=1.0 even in non-playing states is intentional: lock-
    // screen card requires it to display the play button as "current"
    // when nothing is actively playing. Combined with the silent keep-
    // alive loop, this stabilizes the Now Playing UI.
    info[MPNowPlayingInfoPropertyPlaybackRate] = state == .pausedTTS ? 0.0 : 1.0
    info[MPNowPlayingInfoPropertyIsLiveStream] = true
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
}
```

### 3. lastError surface 到 UI

```swift
// ContentView.swift VStack 顶部
if let err = voice.lastError {
    HStack {
        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        Text(err).font(.caption)
        Spacer()
        Button("关闭") { voice.lastError = nil }.font(.caption)
    }
    .padding(8)
    .background(.orange.opacity(0.15))
}
```

### 4. 模型选择器

**Settings.swift**:
```swift
var model: String {
    didSet { UserDefaults.standard.set(model, forKey: Self.modelKey) }
}
// init: ?? "claude-haiku-4-5"
```

**ContentView.swift Settings UI**:
```swift
Section("模型") {
    Picker("模型", selection: $s.model) {
        Text("Haiku 4.5（快、便宜，默认）").tag("claude-haiku-4-5")
        Text("Sonnet 4.6（平衡）").tag("claude-sonnet-4-6")
        Text("Opus 4.7（最强、最贵）").tag("claude-opus-4-7")
    }
    .pickerStyle(.inline).labelsHidden()
}
```

**所有 sendPrompt 调用站**都改成读 `settings.model`：
- ContentView.send() (手动发送)
- onTranscript voice mode 自动发送
- VoiceSession.bind() 注入的 sendPrompt 闭包

```swift
client.sendPrompt(
    text,
    cwd: settings.cwd,
    model: settings.model,         // ← 新
    permissionMode: settings.permissionMode
)
```

**约束**: 切换 model 只影响下一次 sendPrompt；当前 in-flight run 保持原 model
不变（CLI 子进程已经起来了，没法中途切）。

### 5. Section 4 文档更新

`docs/IOS_NATIVE_DEVICE_TEST.md` 顶部加了说明，明确 v1 验收范围 =
Section 1+2+3+5。Section 4 改成"实验性 / 已挂起"，引用 WWDC22
PushToTalk 解释平台约束。

## 我自评的几个点

1. **playbackRate=1.0 在所有非 paused 状态**
   原本 idle 时是 0.0，现在改成 1.0 是为了配合静音循环让 iOS 更愿意显示
   Now Playing。但**没启用静音循环时**也是 1.0，可能给 iOS 错误信号
   "在播但没声音"。是不是应该按 silentKeepalive 开关动态决定？

2. **silent loop 和真实 TTS 共存**
   AVAudioPlayer 静音循环 + AVAudioPlayer TTS 同时 active 在同一
   audio session 上。猜测 iOS 会把它们 mix 输出，TTS 时 silent loop
   依然在静默循环。但**实测**还没做，担心：
   - 真实 TTS 播放被 silent loop 影响节奏
   - VoiceRecorder 录音时 silent loop 仍在播会不会污染输入（不应该，因为
     是输出 bus，但 AirPods 上回环不知道）

3. **模型选择器没暴露 cleanup/summarize 用的 model**
   `/api/voice/summarize` 走的是 Haiku，UI 这里只切 prompt 的 model。
   不是 bug 但用户可能误以为切了模型连 TTS 概要也变了。要不要在文案
   说明？

4. **didSet 持久化 + Bindable 双向绑定**
   AppSettings 用 `@Observable` + `var x: T { didSet { UserDefaults... } }`
   配合 `@Bindable var s = settings` 在 Form 里直接绑 `$s.model`。
   验证过 picker 切换会立刻持久化，但担心 iOS 26 的 @Observable 行为
   是否在所有路径都触发 didSet（比如 nested struct 改了 didSet 会不会
   不触发）。这里都是 String/Bool 标量，应该没事。

5. **新加的 1024 PNG appicon 是直接复制 Capacitor 那个的占位**，长期
   要换成 Claude Voice 自己的图标。功能上不影响。

## 给评审的 6 个问题

1. **playbackRate 在没启用静音循环时硬设 1.0** 是否合理？或者改成
   按 silentKeepalive 决定（关时 0.0，开时 1.0）？

2. **silent loop 和 AVAudioRecorder 共存**有没有已知问题？比如录音 buffer
   质量受影响，或者 audio session category 被 iOS 重新协商。

3. **模型选择**对实现影响 = `model` 字段透传。但 backend 协议里
   `permissionMode` 切换中、`model` 切换中分别会触发 stale-session
   或新 session 吗？我现在用 `resumeSessionId` + 新 model 发出去，CLI
   端的行为没验过。

4. **lastError UI** 现在是 fixed banner 在顶栏下面，所有 view 都看
   得到。错误自动 dismiss 时机？现在只能用户手动关。是否应该 5s 自动
   消失，避免一直停留遮挡？

5. **WAV header 字节序**写死 little-endian（`le()` helper）。iOS 都是
   ARM64 little-endian，但 swift 的 `withUnsafeBytes` 在某些平台行为
   微妙。这段代码 `withUnsafeBytes(of: &le) { Data($0) }` 是否完全
   安全？

6. **没用 PushToTalk framework**：你认同吗？还是认为应该试试申请
   entitlement，以备 v2 真的想要锁屏 PTT？

## 没改的（继续按 round 1 评审执行）

- 鉴权（M4.5 已修）
- send 失败 busy 恢复（M4.5）
- VoiceRecorder.start race（M4.5）
- error reset（M4.5）
- exit() 清理（M4.5）
- play/pause/toggle 拆分（M4.5）
- NSLocalNetworkUsageDescription（M4.5）
- App 名 Claude Voice（M4.5）

## 文件位置

```
packages/ios-native/Sources/ClaudeWeb/
├── VoiceSession.swift     # silent loop, Now Playing 文案
├── Settings.swift         # model + silentKeepalive
├── ContentView.swift      # Settings UI 新增 picker + 实验功能 section
├── ClaudeWebApp.swift     # bind 闭包用 settings.model
└── BackendClient.swift    # sendPrompt 多了 model 参数（已是默认）

packages/ios-native/Sources/ClaudeWeb/Assets.xcassets/
└── AppIcon.appiconset/
    ├── AppIcon-1024.png   # 占位（来自 Capacitor 那套）
    └── Contents.json
```

## 请你回答

1. 上面 6 个问题
2. 还有什么 round 1 没看到、round 2 引入的新风险？
3. v1 的"实际可日常用"门槛，你觉得现在到了吗？还差什么必做？
