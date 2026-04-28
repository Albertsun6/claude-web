# iOS Native App — M1 to M4 评审报告

> 给另一个 AI 评审用。M1 到 M4 已经实现并 ship 到 GitHub
> (https://github.com/Albertsun6/claude-web)。M5（抛光 / TestFlight）尚未做。
> 请你按"是否真的能稳定支撑日常生产力工具使用"这条主线找问题。

## 项目背景

用户日常依赖语音 + 锁屏 + 耳机的工作流跟 Claude Code 协作。原 PWA / Capacitor
路径在 iOS 上音频会话（物理静音键、autoplay、后台 mic）有根本性约束，所以决定
重写"手机这一头"为 Swift 原生 app，**Mac 后端 / 协议 / Edge TTS / whisper 不动**。

## 已经达成的设计共识

- 主 STT: Mac whisper（保留 prompt 词表 + Haiku cleanup），不走 SFSpeechRecognizer
- 主 TTS: Edge TTS zh-CN-XiaoxiaoNeural，AVSpeechSynthesizer 仅作离线兜底（未做）
- 默认 `permissionMode: plan`（Claude 只规划不执行 → 不会触发 permission_request）
- 锁屏远程命令仅承诺 `MPRemoteCommandCenter` (play/pause/stop/skipForward)，
  不承诺 AirPods stem 长按
- 项目选择器 v1 = 设置里手动输入 cwd，不做完整管理
- 砍对话模式 / VAD，PTT 主导
- 文件树 / Git / 多面板回桌面 web 干

## M1-M4 实现状态

### M1 — SwiftUI shell + WebSocket text chat
- xcodegen 驱动的 Xcode 项目（`project.yml` → `ClaudeWeb.xcodeproj`）
- iOS 17+, iPhone-only, bundle id `com.albertsun6.claudeweb-native`
  （故意 `-native` 后缀，跟现有 Capacitor app 共存便于 A/B 对比）
- Single SwiftUI target，源码全在 `packages/ios-native/Sources/ClaudeWeb/`
- `BackendClient`: `@MainActor @Observable` 包 `URLSessionWebSocketTask`
  - 自动重连，指数退避 1s → 30s
  - 流式 assistant 文本去重（CLI 是累积发送非 delta）
  - `interrupt()` 支持
- `Protocol.swift`: 手写映射 `packages/shared/src/protocol.ts`
  - 解码 sdk_message 的子类型（system:init / assistant text / tool_use / result）
- `AppSettings`: backendURL + cwd + permissionMode + tts 偏好持久化到 UserDefaults
  - 模拟器默认 `http://localhost:3030`，真机默认 `https://mymac.tailcf3ccf.ts.net`
  - 用 `#if targetEnvironment(simulator)` 区分

### M1.5 — 权限弹窗
- `Protocol.swift`: 加 `permission_request` 解码 + `permission_reply` 编码
- `BackendClient.pendingPermission` @Observable，UI 用 `.sheet(item:)` 弹出
- `PermissionSheet`: 显示 toolName + smart preview (Bash command / Edit
  file_path / Read path / JSON fallback) + Allow/Deny 按钮
- 默认 permissionMode 改为 `plan`，Settings 里可改

### M2 — PTT 录音 + 远程 STT
- `VoiceRecorder.swift`: AVAudioRecorder → 16kHz mono AAC m4a → POST
  `/api/voice/transcribe` (audio/mp4 content-type，后端 ffmpeg 自动检测格式)
- AVAudioApplication.requestRecordPermission (iOS 17 API)
- 状态: idle | recording | uploading | error
- `< 8KB` 的录音判作噪声不上传
- `InputBar`: 圆形麦克风按钮，`simultaneousGesture(DragGesture)` 实现按住录、
  松开转写。fallback tap-to-toggle
- 状态行在输入栏上方："录音中…松开发送" / "上传识别中…" / 错误

### M3 — TTS 播放（前台）
- `TTSPlayer.swift`:
  - `speakAssistantTurn(text)`: 高层入口
    - `stripForSpeech` 剥 markdown（移植 web 前端的 stripForSpeech）
    - text > 30 chars 且 speakStyle=summary → POST `/api/voice/summarize`
      (Haiku 改写 1-4 句口播版)
    - POST `/api/voice/tts` → mp3 bytes
    - AVAudioPlayer 从 in-memory Data 播放
  - `replay()` 缓存上次的 mp3，不重复调 Haiku
  - `pause()` / `resume()` / `cancel()`
  - `generation` 计数器：cancel 时让在飞的 fetch 自动放弃
- `BackendClient.onTurnComplete` 回调：`session_ended` 且 `reason=completed`
  时触发，App 在 `.onAppear` 里 wire 到 TTSPlayer.speakAssistantTurn
  （init 不能 escape self 进 closure）
- ContentView 顶栏 chip 区域加播放控件：fetching ProgressView /
  playing pause+stop / paused resume+stop / idle replay（如有缓存）
- Settings: 自动播报 toggle / 风格 picker (concise/verbatim) / 慢速朗读 toggle

### M4 — Voice Session + Lock Screen
- `VoiceSession.swift`: 状态机协调器
  - 6 个状态：idle / recording / transcribing / thinking / playingTTS / pausedTTS
  - 状态由 recorder.state / tts.state / client.busy 派生（**single source of truth**）
  - `enter()`: 激活 `.playAndRecord` / `.spokenAudio` 会话，注册 5 个 remote
    commands (togglePlayPause / play / pause / stop / nextTrack)，初始化
    Now Playing
  - `exit()`: 反操作
- 远程命令路由按当前状态决定语义：
  - togglePlayPause:
    - idle → 开始录音
    - recording → 停止 + 转写 + **自动发送**（语音模式下没有 review）
    - playingTTS → 暂停
    - pausedTTS → 继续
    - transcribing/thinking → no-op
  - stop: 按状态分别 cancel recording / cancel TTS / interrupt run
  - nextTrack: skip 当前 TTS 回 idle
- `MPNowPlayingInfoCenter`:
  - title 跟随状态变化（待命 / 录音中 / 识别中 / Claude 在想 / 正在播报 / 已暂停）
  - artist=Claude，IsLiveStream=true（避免 thinking 时显示空白进度条）
  - playbackRate 在 playingTTS 时为 1.0
- ContentView toolbar 左上加 headphones 图标按钮：进入/退出语音模式
- App.swift `.onChange(of: ...)` 触发 `voice.refresh()` 让 Now Playing 跟上
- InputBar onTranscript 闭包检查 `voice.active`：on → 自动发送，off → 进 textfield

## 关键架构决策（请帮我审）

1. **Now Playing 的 IsLiveStream=true 是否合理？**
   语音模式下没有"轨道时长"概念。我设了 IsLiveStream=true 让 iOS 不画进度条。
   不确定锁屏 UI 是否会因此隐藏某些按钮。

2. **AVAudioSession 在 voice 模式下从不主动 deactivate**（除非 `exit()`）
   连续状态切换不再调 setActive，靠 setCategory(_:options:) 的幂等性。
   担心：在 thinking 等待几秒后，iOS 是否会因为没有"audio playing"而挂起 app？
   `UIBackgroundModes: audio` 应该保活，但有个文档说"audio session must
   actually be playing or recording"才算激活态。**M4 的最大未知：用户进 voice
   mode 但当前空闲（IDLE 几分钟）后锁屏，play/pause 还能工作吗？**

3. **状态从 components 派生 vs 单独维护**
   现在 `VoiceSession.state` 是计算属性，从 recorder/tts/client 算出。
   优点：永远一致。缺点：依赖 .onChange(of:) 触发 refresh()，错过一次就 Now
   Playing 不更新。考虑过用 withObservationTracking 但 @Observable 协议下没
   现成 reactive subscribe。

4. **PTT 起始时机的 race**
   togglePlayPause 处理 idle→start：`Task { await recorder.start() }`。在 start
   返回前再来一次 togglePlayPause（用户连续点两次）会有问题——第二次仍看到
   `state == .idle`，启动第二个 recorder。有 `recorder.state == .idle` guard
   但 `start()` 是 async 的，存在 race。**需要在 VoiceSession 加个 inFlight 锁吗？**

5. **Backend WebSocket 在 audio session 激活后是否还能正常运行？**
   URLSessionWebSocketTask 不依赖音频，应该没事。但 iOS 的网络后台行为复杂，
   长时间锁屏 + 4G/wifi 切换时 ws 会不会 silent disconnect？有指数退避重连
   但 reconnect 后 sessionId 是用旧的还是从 backend 拉？我现在用旧的，应该
   触发 stale-session-recovered 自动恢复。

6. **AVAudioPlayer 从 Data 播放是否在锁屏后台稳定？**
   M3 的 TTS 走 AVAudioPlayer.init(data:)。播放期间锁屏应该 OK（auidoplayer
   在 background 受 audio entitlement 保护）。但如果在 thinking 阶段（无音频）
   锁屏，几秒后 TTS 才到，AVAudioPlayer 创建 + play 是否还能从 background
   状态成功唤起音频会话？

7. **HEX 风险点**
   - **M4 的实测**未在真机上跑过，全部在模拟器（模拟器锁屏不真）。最大不确定。
   - **Mac mini 还没就位**，目前后端跑在 MacBook + caffeinate，最终迁移时
     URL / 证书 / Tailscale 可能要重配
   - **Apple Developer 账号未订**（按计划 M5 订）→ 真机测 7 天重签
   - **Capacitor 路径还在 repo 里**（packages/frontend/ios），未删，但停止
     维护

## 没做的（已知）

- ❌ AirPods stem 长按
- ❌ APNs 推送（M5+ 之后）
- ❌ Live Activities / 灵动岛
- ❌ 项目列表（v1 设置里手动 cwd）
- ❌ 历史会话恢复（M5 才考虑从 jsonl 拉）
- ❌ 本地缓存最近转写（v1 用完即丢）
- ❌ M5: 重连指数退避 / 错误 banner / TestFlight / 签名

## 你最有可能挑出的坑（自审）

1. M4 没跑过真机，远程命令在锁屏时实际触发率未验证
2. 状态机的 race 没加锁
3. 错误状态 (.error) 的恢复路径不清晰——目前只能手动 exit→enter
4. 输入文字后切到语音模式，draft 内容怎么处理（消失？保留？）—— 没定义
5. 语音模式 active 但用户没说话也没收到 TTS，过几分钟系统会不会判为
   "non-active audio session" 而挂起？
6. iOS 17 vs 18 vs 26 上 MPRemoteCommandCenter 行为可能不一致
7. CFBundleDisplayName="Claude" 跟 Anthropic 真 Claude app 重名可能 App
   Store 审核问题（v1 sideload 不影响）

## 文件位置（评审参考）

```
packages/ios-native/
├── project.yml                 # xcodegen spec
├── ClaudeWeb.xcodeproj/        # generated
├── scripts/deploy.sh           # build → install → launch (sim/device)
├── Sources/ClaudeWeb/
│   ├── ClaudeWebApp.swift      # @main, dependency wiring
│   ├── ContentView.swift       # SwiftUI top-level
│   ├── BackendClient.swift     # WS + state machine
│   ├── VoiceRecorder.swift     # M2 PTT
│   ├── TTSPlayer.swift         # M3 TTS
│   ├── VoiceSession.swift      # M4 coordinator
│   ├── Settings.swift          # UserDefaults persistence
│   ├── Protocol.swift          # ClientMessage / ServerMessage
│   ├── Info.plist              # NSMicrophoneUsageDescription, UIBackgroundModes:audio
│   └── Assets.xcassets/        # AppIcon placeholder + AccentColor
```

## 请你回答

1. 上面"关键架构决策"的 7 个不确定点，哪些是真问题、哪些是我多虑了？
2. 我说的 M4 最大未知（"长时间空闲在 voice 模式后锁屏，远程命令还能工作吗"）
   你的判断？
3. 还漏了什么 v1 必做但我没意识到的事？
4. 真机实测前能在模拟器做到的最大覆盖范围是什么？
5. M5 我打算只做：WS 重连指数退避（已有）+ 错误 banner + TestFlight 配置 +
   $99/年订阅。还有什么必做？
