# iOS Native F1 v2 — Per-project State Architecture

> **作废说明**：此文档替代 [IOS_NATIVE_F1_PLAN.md](IOS_NATIVE_F1_PLAN.md) 中的 A1 + A2
> 两个特性。A6（卡片渲染）、A7（markdown）保持原计划不变，但要等 F1 v2 落地后再做。
>
> **写于**：2026-04-29
> **状态**：待评审 / 待用户确认

---

## 1. 背景：为什么推翻原 A1 + A2 方案

原 A2 计划是"项目快速切换器"：切项目 = 清空 messages + reset sessionId。

经过 Cursor 模型 vs 当前架构的对比分析后，发现：

1. **CLI 磁盘上已经天然是 per-project 的**：`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`，每个 cwd 独立一堆 session 文件
2. **Web 前端 `byCwd` 已经是 per-project state 模型**（[packages/frontend/src/store.ts](packages/frontend/src/store.ts)），多 tab 并行
3. **iOS 当前的"全局单 session"模型是退化版**，是从 M1-M4.5 累积下来的简化，不是设计决策
4. **真实使用场景**："在 A 项目跑一半 turn，临时切 B 看个文件，切回 A 还在" —— 原 A2 计划的"切了就清空"做不到

**结论**：A1 + A2 应该合并成一个特性 —— **per-project state**：每个项目独立维护 messages、sessionId、待审批权限等运行时状态；切项目是 swap 不是 reset；A1 的"session 历史浏览"自然变成"切项目 sheet 里展开当前 project 的历史 jsonl 列表"。

---

## 2. 设计原则

1. **架构对齐 web 前端**：iOS 的 per-project state 模型直接对标 [store.ts](../packages/frontend/src/store.ts) 的 `byCwd: Record<string, ProjectSession>`。心智模型统一，未来共享协议更改成本低。
2. **CLI 是真理来源**：jsonl 文件是 session 历史的唯一持久化层。iOS 不写自己的对话存档，重启后从 jsonl 重建。
3. **swap 不 reset**：切项目把当前 in-flight state 留在原 project 容器里，把目标 project 的状态拉出来呈现。**不打断**正在跑的 turn。
4. **TTS / Voice 是 device-global，不属于 project**：切项目时停 TTS，因为跨项目继续播会混乱。但语音模式（`voice.active`）保持。
5. **v1 不做的复杂性**：跨设备同步对话、同 project 内并行多 conversation、conversation 重命名/导出 —— 都不做。

---

## 3. 数据模型

### 3.1 Project（不变）

```swift
struct Project: Identifiable, Codable, Equatable {
    var id: String { cwd }      // cwd 作为天然主键，不会重复
    var name: String            // 用户输入的展示名
    var cwd: String             // 绝对路径
    var lastUsed: Date          // 切到此项目时刷新，UI 用来排序
}
```

### 3.2 ProjectChatState（新增）

每个 project 在内存里独立维护一份运行时状态：

```swift
struct ProjectChatState: Equatable {
    var messages: [ChatLine] = []
    var sessionId: String? = nil          // CLI session id，--resume 用
    var pendingPermission: PermissionRequest? = nil
    var currentRunId: String? = nil
    var busy: Bool = false                // turn 是否在跑
}
```

**注意**：`runId` 是 client 生成的、跟 cwd 无关的 UUID，但**通过 runId → projectId 路由**回正确的 project state。

### 3.3 BackendClient 重构

```swift
@MainActor @Observable
final class BackendClient {
    var state: ConnState = .disconnected
    var stateByProject: [String: ProjectChatState] = [:]   // key = projectId (= cwd)

    /// runId → projectId 路由表。WS 消息按 runId 找到归属 project。
    /// turn 结束（session_ended）时清掉对应条目。
    private var runIdToProject: [String: String] = [:]

    /// 当前 UI 焦点的 project。绑定到 settings.currentProjectId。
    var currentProjectId: String?

    // MARK: - Computed views（UI 直接绑这些）

    var currentMessages: [ChatLine] {
        guard let id = currentProjectId else { return [] }
        return stateByProject[id]?.messages ?? []
    }
    var currentBusy: Bool {
        guard let id = currentProjectId else { return false }
        return stateByProject[id]?.busy ?? false
    }
    var currentSessionId: String? {
        guard let id = currentProjectId else { return nil }
        return stateByProject[id]?.sessionId
    }
    var currentPendingPermission: PermissionRequest? {
        guard let id = currentProjectId else { return nil }
        return stateByProject[id]?.pendingPermission
    }
}
```

### 3.4 AppSettings 增减

**新增**：
```swift
var projects: [Project] = []
var currentProjectId: String?
```

**删除**：旧 `cwd: String` 字段（保留 UserDefaults key 用于一次性迁移）。

**持久化**：`projects` 数组用 JSONEncoder 写到 UserDefaults。`currentProjectId` 单独存 String。

---

## 4. 关键流程

### 4.1 启动迁移

```swift
init() {
    // ... 已有字段加载
    let savedProjectsData = UserDefaults.standard.data(forKey: Self.projectsKey)
    let decoded = savedProjectsData.flatMap { try? JSONDecoder().decode([Project].self, from: $0) }
    self.projects = decoded ?? []
    self.currentProjectId = UserDefaults.standard.string(forKey: Self.currentProjectIdKey)

    // 迁移：旧 cwd key 存在但 projects 空 → 自动建一个
    if projects.isEmpty {
        let legacyCwd = UserDefaults.standard.string(forKey: Self.cwdKey) ?? "/Users/yongqian/Desktop"
        let migrated = Project(name: deriveName(from: legacyCwd), cwd: legacyCwd)
        self.projects = [migrated]
        self.currentProjectId = migrated.id
        persistProjects()
    } else if currentProjectId == nil || projects.first(where: { $0.id == currentProjectId }) == nil {
        // currentProjectId 悬空 → 兜底到第一个
        self.currentProjectId = projects.first?.id
    }
}

private func deriveName(from cwd: String) -> String {
    URL(fileURLWithPath: cwd).lastPathComponent
}
```

### 4.2 切项目（swap）

```swift
// AppSettings
func switchToProject(_ projectId: String) {
    guard projects.contains(where: { $0.id == projectId }) else { return }
    currentProjectId = projectId
    if let idx = projects.firstIndex(where: { $0.id == projectId }) {
        projects[idx].lastUsed = Date()
        persistProjects()
    }
}
```

```swift
// BackendClient
.onChange(of: settings.currentProjectId) { _, newId in
    client.currentProjectId = newId
    // 确保新 project 在 stateByProject 里有条目（首次切到时初始化）
    if let id = newId, client.stateByProject[id] == nil {
        client.stateByProject[id] = ProjectChatState()
    }
    // TTS / 语音的处理
    tts.stop()                    // 停掉跨项目的播放
    voice.refresh()               // Now Playing 刷新
}
```

**不做**：
- ❌ interrupt 当前 in-flight turn（让它在原 project state 里跑完，runId 路由会送到对应位置）
- ❌ 清空原 project 的 messages

### 4.3 添加项目

```swift
func addProject(name: String, cwd: String) {
    let normalized = (cwd as NSString).standardizingPath
    guard !projects.contains(where: { $0.cwd == normalized }) else {
        // 已存在 → 切过去，不重复添加
        switchToProject(normalized)
        return
    }
    let p = Project(name: name.isEmpty ? deriveName(from: normalized) : name, cwd: normalized)
    projects.append(p)
    persistProjects()
    switchToProject(p.id)
}
```

### 4.4 删除项目（含 fallback）

```swift
func removeProject(_ projectId: String) {
    let wasCurrent = (projectId == currentProjectId)
    projects.removeAll { $0.id == projectId }
    persistProjects()

    if wasCurrent {
        if let first = projects.first {
            switchToProject(first.id)
        } else {
            // 一个都不剩 → 重建默认 project
            let fallback = Project(name: "Desktop", cwd: "/Users/yongqian/Desktop")
            projects = [fallback]
            persistProjects()
            switchToProject(fallback.id)
        }
    }
    // 同时让 BackendClient 丢掉那个 project 的 state（释放内存）
    // 通过 onChange of projects 触发
}
```

注意：删除一个**有 in-flight turn** 的非当前 project 怎么办？v1 简单处理：直接删，让后台那个 turn 的消息进 `runIdToProject` 找不到归属时 silently drop。罕见 case，不值得复杂化。

### 4.5 sendPrompt 路由

```swift
func sendPrompt(_ prompt: String, model: String, permissionMode: String) {
    guard let projectId = currentProjectId,
          let project = settings?.projects.first(where: { $0.id == projectId }) else {
        return  // UI 应该已经禁用了发送
    }
    guard task != nil else {
        appendError(to: projectId, "未连接后端")
        return
    }

    let runId = UUID().uuidString
    runIdToProject[runId] = projectId
    var s = stateByProject[projectId] ?? ProjectChatState()
    s.currentRunId = runId
    s.busy = true
    s.messages.append(ChatLine(role: .user, text: prompt, runId: runId))
    stateByProject[projectId] = s

    let msg = ClientMessage.userPrompt(
        runId: runId,
        prompt: prompt,
        cwd: project.cwd,
        model: model,
        permissionMode: permissionMode,
        resumeSessionId: s.sessionId
    )
    Task { /* send like before */ }
}
```

### 4.6 接收消息路由

```swift
private func handle(_ msg: ServerMessage) {
    let projectId = projectIdFor(msg)
    guard let pid = projectId, var s = stateByProject[pid] else {
        // 消息归属不明 → 丢弃（罕见：项目已删除、跨重连孤儿）
        return
    }

    switch msg {
    case .sdkMessage(_, let sdk):
        switch sdk {
        case .systemInit(let sessionId, _):
            if let sessionId { s.sessionId = sessionId }
        case .assistantText(let text):
            appendOrAppendToLast(state: &s, role: .assistant, text: text)
        // ...
        }
    case .sessionEnded(_, let reason):
        s.busy = false
        s.currentRunId = nil
        runIdToProject.removeValue(forKey: msg.runId)
        // 只在当前 UI 焦点的 project 上触发 TTS
        if reason == "completed" && pid == currentProjectId {
            onTurnComplete?()
        }
    // ... 其他 case 类似
    }

    stateByProject[pid] = s
}

private func projectIdFor(_ msg: ServerMessage) -> String? {
    let runId = msg.runId
    return runIdToProject[runId]
}
```

**ServerMessage.runId**：所有 ServerMessage case 都带 runId（`sdkMessage(runId:_:)`、`sessionEnded(runId:_)`、`error(runId:_:)` 等），加个 computed property 提取就行。

---

## 5. UI 改动

### 5.1 顶部 chip 区域

当前：
```
[●] connected · /Users/yongqian/Desktop  [voice] [tts] [settings]
```

新：
```
[●] connected · [📁 claude-web ▼]  [voice] [tts] [settings]
                  ^^^^^^^^^^^^^^ tappable，弹 ProjectSwitcherSheet
```

cwd 完整路径不再显示（太长），改成 project name。长按或在 sheet 里看 cwd。

### 5.2 ProjectSwitcherSheet（.medium detent）

```
┌─────────────────────────────────────┐
│  项目                          [+]  │
├─────────────────────────────────────┤
│ ● claude-web              [v]      │   ← 当前项目，齿轮展开历史
│   /Users/yongqian/Desktop/claude-web│
│   ↳ 历史会话 (3)                   │   ← 展开后
│      • 2 小时前 · "TS 类型问题"    │
│      • 昨天 · "M5 plan"            │
│      • 上周 · ...                  │
│                                     │
│ ○ ios-native                        │   ← 其他项目
│   /Users/yongqian/Desktop/ios-...   │
│                                     │
│ ○ scratchpad              [删除]   │   ← 滑动右滑删除按钮
│   ~/scratch                         │
└─────────────────────────────────────┘
```

**交互**：
- 点项目行 → switchToProject
- 当前项目右侧的 `[v]` 展开 / 收起历史 session 列表（A1 的活）
- 点历史 session 条目 → 加载到当前 project state，覆盖 in-memory messages（带确认 alert："覆盖当前对话？"）
- 滑动删除项目（有确认）
- `[+]` → 弹 alert 输 name + cwd
- 长按项目行 → 显示完整 cwd 路径（accessibility）

### 5.3 ContentView 绑定改动

```swift
// 从
ChatListView(messages: client.messages)
// 改成
ChatListView(messages: client.currentMessages)

// busy
InputBar(... busy: client.currentBusy ...)

// pendingPermission sheet
.sheet(item: $client.currentPendingPermission) { ... }
// 注意 currentPendingPermission 是 computed，不能直接 binding。
// 需要包一层：用 currentProjectId 派生的 Binding。
```

**Binding 包装**（pendingPermission 是 set/get 都有的）：

```swift
private var pendingPermissionBinding: Binding<PermissionRequest?> {
    Binding(
        get: { client.currentPendingPermission },
        set: { newValue in
            guard let id = client.currentProjectId else { return }
            client.stateByProject[id]?.pendingPermission = newValue
        }
    )
}
```

---

## 6. Session 历史（A1 的归宿）

A1 不再是独立 sheet，而是 ProjectSwitcherSheet 内的一节。

### 6.1 后端 endpoint

[packages/backend/src/routes/sessions.ts](../packages/backend/src/routes/sessions.ts) 已经存在，提供：
- `GET /api/sessions?cwd=<path>` → 列出该 cwd 下所有 jsonl 的 sessionId + preview + mtime
- `GET /api/sessions/:id?cwd=<path>` → 该 session 的完整消息列表

iOS 直接用即可。

### 6.2 SessionsAPI client

```swift
struct SessionPreview: Identifiable, Decodable, Equatable {
    let id: String                   // sessionId
    let modifiedAt: Date
    let firstUserPrompt: String?     // 预览
    let messageCount: Int
}

struct SessionTranscript: Decodable {
    let id: String
    let entries: [TranscriptEntry]
}

@MainActor @Observable
final class SessionsAPI {
    private let backend: () -> URL
    private let token: () -> String

    func listSessions(cwd: String) async throws -> [SessionPreview] { /* ... */ }
    func loadSession(id: String, cwd: String) async throws -> SessionTranscript { /* ... */ }
}
```

### 6.3 TranscriptParser（独立，不复用 SDKMessage.parse）

**评审修正 #2**：jsonl 里的格式跟 stream-json 不一样：
- 多了 `parentUuid`, `isSidechain`, `cwd`, `gitBranch` 等
- `user` role 在 jsonl 里有真正的用户消息（不只是 tool_result）
- 后端 `normalizeJsonlEntry` 会处理一部分，但 iOS 端拿到的还是 normalize 后的 SDKMessage 结构

实际上：调研后端 `/api/sessions/:id` 返回的具体格式，决定 iOS 是直接拿"已 normalize 的 SDKMessage 列表"还是"原始 jsonl entry"。如果是前者，可以**部分**复用 SDKMessage.parse 但要扩展处理 user role 真正的用户消息。

**待确认动作**：实现前先 `curl http://localhost:3030/api/sessions/:id?cwd=<path>` 看返回结构，确定后再决定 parser 形态。

### 6.4 加载历史 session 的副作用

点历史 session → 弹 alert："覆盖当前对话？此操作不会删除磁盘上的会话文件。"

确认后：
```swift
let transcript = try await sessionsAPI.loadSession(id: sid, cwd: project.cwd)
let lines = TranscriptParser.parse(transcript)   // [ChatLine]
client.stateByProject[project.id]?.messages = lines
client.stateByProject[project.id]?.sessionId = sid   // 关键：让后续 prompt 用 --resume 接上
client.stateByProject[project.id]?.busy = false
client.stateByProject[project.id]?.currentRunId = nil
```

---

## 7. 文件改动清单

| 文件 | 改动 |
|---|---|
| `Settings.swift` | 加 `Project` struct（已加）、`projects: [Project]`、`currentProjectId: String?`、迁移、helper（add/remove/switch）、persistProjects |
| `BackendClient.swift` | **大改**：`stateByProject: [String: ProjectChatState]` + `runIdToProject` 路由、computed views、sendPrompt 注入 cwd、handle 路由分发、`currentProjectId` |
| `ClaudeWebApp.swift` | onChange currentProjectId → tts.stop + 同步到 client；sendPrompt 闭包用 settings 当前 project cwd |
| `ContentView.swift` | chip 改 project button、`client.currentMessages` 替换 `client.messages`、`currentBusy`、permission binding 包一层、加 ProjectSwitcherSheet |
| `ProjectSwitcherSheet.swift` | **新文件**：list + add + delete + 展开历史 session |
| `SessionsAPI.swift` | **新文件**：fetch list / detail |
| `TranscriptParser.swift` | **新文件**：jsonl entries → [ChatLine]，独立于 SDKMessage.parse |
| `Protocol.swift` | 加 `ServerMessage.runId` computed property（如果还没有） |
| `VoiceRecorder.swift` / `TTSPlayer.swift` | 不改，跟 project 无关 |
| `VoiceSession.swift` | 不改 |

---

## 8. 实施分期

### Phase F1a — Per-project state core（2 天）

1. Settings.swift 完整改造（projects + currentProjectId + helpers + 迁移）
2. BackendClient 重构（stateByProject + 路由 + computed views）
3. ClaudeWebApp.swift onChange 接线
4. ContentView 用 currentMessages + currentBusy
5. **不做** UI 项目切换器，先用 settings 里改 currentProjectId 测试架构对不对

**验收**：
- 启动后从旧 cwd 自动迁移成 1 个 project
- 发 prompt → 能跑通（cwd 来自 currentProject）
- 手动改 settings.currentProjectId（在 SwiftUI Preview 或 hardcode test）→ messages 切换
- WS 收到 sessionEnded → 只在 currentProjectId 触发 onTurnComplete

### Phase F1b — Project Switcher UI（1 天）

1. ProjectSwitcherSheet（list + add + delete）
2. ContentView chip 改成 project button
3. 切项目 + tts.stop 联动

**验收**：
- 添加项目 → 自动切过去
- 删除当前项目 → 自动切到剩下第一个 / fallback 到默认
- 切项目期间正在跑的 turn → swap 后切回来还在跑/已完成
- 切项目时 TTS 立即停

### Phase F1c — Session History（1.5 天）

1. SessionsAPI client
2. 验证后端返回格式 → 决定 TranscriptParser 形态
3. ProjectSwitcherSheet 当前 project 展开历史列表
4. 加载历史 session 的覆盖逻辑 + 确认 alert

**验收**：
- 当前 project 展开 → 看到 jsonl 列表（按 mtime 倒序）
- 点某条 → 加载消息进当前 project state
- 加载后再发新 prompt → CLI `--resume <oldSessionId>` 接上历史

### 总工作量

5-6 天（vs 原 A1 + A2 单做的 3.5 天，多 1.5-2.5 天换得架构对齐 + 真实使用场景顺）。

---

## 9. 边界情况与决策

| 情况 | 决策 |
|---|---|
| 切项目时 in-flight turn | 让原 project 后台跑完，不 interrupt |
| 切项目时 TTS 在播 | tts.stop()，不让跨项目播 |
| 切项目时 voice mode 开着 | 保持 voice 模式（设备级状态），但 mic 录音输出到新 project |
| 加载历史 session 时另一个 project 正在跑 turn | 历史加载只影响目标 project 的 state，跨 project 无影响 |
| 删除非当前 project，但它有 in-flight turn | 删除其 stateByProject 条目；后台 WS 消息找不到归属 → drop。罕见 |
| 同一 cwd 重复 add | 不重复添加，直接 switchToProject 切过去 |
| 用户输入相对路径 cwd | `(cwd as NSString).standardizingPath` 标准化；如果还是相对，append `~` 用户家目录前缀 |
| jsonl 解析失败 | 弹 toast "无法加载该会话"，不覆盖现状态 |
| 历史 session 加载时 messages 数组很大（千条） | v1 不分页；如果出现性能问题再说 |
| 同 cwd 在 BackendClient 重启后丢内存 state | 接受。重启后从 sessionId 走 --resume，CLI 会加载最近 session |

---

## 10. 不做（明确）

- ❌ 跨设备同步（CLI jsonl 在 Mac 上，iOS 是 thin client）
- ❌ 同 project 内并行多 conversation（v1 一次一个 active；多 conversation 通过冷切换历史 session 实现）
- ❌ Conversation 重命名 / 导出（jsonl 文件名是 sessionId，重命名要改文件，复杂）
- ❌ Conversation 跨 project 移动（语义不清晰）
- ❌ 删除单条 jsonl 文件（v1 不做删除；要删的话用户自己去 Mac 上删）
- ❌ 项目排序（lastUsed 倒序就够，不做手动拖拽）
- ❌ 项目搜索（项目少时不需要）

---

## 11. 风险

| 风险 | 缓解 |
|---|---|
| 重构 BackendClient 破坏现有 voice / TTS / permission 流程 | 分 phase 实施，每 phase 都跑模拟器 smoke test；F1a 不动 UI 让回归测试聚焦 |
| 后端 `/api/sessions/:id` 实际返回格式跟设想的不一样 | F1c 第一步先 curl 探活，不要先写 parser |
| stateByProject 内存增长（项目多时） | 单设备个人工具，预期 < 10 项目，每项目几十条 message，可忽略 |
| ServerMessage 没带 runId 的 case | 检查 Protocol.swift 所有 case；如果有不带的（比如全局错误）→ 路由到 currentProjectId |

---

## 12. 评审请求

把这个 plan 给另外一个 AI 评审，重点看：

1. 数据模型 ProjectChatState / runIdToProject 路由够不够 robust？
2. 切项目 swap 不 reset 的方案有没有遗漏的 edge case？
3. 历史 session 加载覆盖当前 in-memory 的 UX 合理吗？
4. F1a / F1b / F1c 的拆分够不够细？有没有循环依赖？
5. 跟 web 前端 byCwd 模式对齐有没有学到错的东西？

通过后再实施。
