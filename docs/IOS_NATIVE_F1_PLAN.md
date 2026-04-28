# iOS Native v2 第一波（F1）实施计划

> ✅ **评审已过，可以开工**。范围：A1 + A2 + A6 + A7。
> 完成后 iOS app 从"能跑通"升级到"用着不痛苦"。
>
> 全部移植自 web 已有功能，**没有协议层改动**，backend 一行不动。
> 评审后预算修正为 5-6 天。
>
> **评审修正（必须执行）**：
> 1. A2 切项目时**清空 messages + reset sessionId**（不仅切 cwd）
> 2. A1 transcript 解析**新建 TranscriptParser**，不复用 SDKMessage.parse
> 3. A6 v1 **不做 tool_result → BashCard 关联**，独立 ToolResultCard 即可
> 4. A6 必须新增 `ChatLine.spokenText` helper，TTS 只读 text 块
> 5. A2 项目删除时如果删的是当前项目，要 fallback 到第一个 / 默认

## 共同前提

- 只 iOS native (`packages/ios-native/`)，不动桌面 web
- backend 协议、CLI subprocess、Edge TTS、whisper 都不变
- xcodegen 项目，单 SwiftUI target
- iOS 17+

---

## A1 — 历史会话浏览

### 目标

在 iOS 里看过去 N 天跟 Claude 聊过的 sessions，点进去**恢复对话继续**。

### 后端接口（**已存在**，0 改动）

```
GET /api/sessions/list?cwd=<absolute>
  → { sessions: [{ sessionId, preview, mtime, size }, ...] }
  按 mtime 倒序，取前 50 条

GET /api/sessions/transcript?cwd=<absolute>&sessionId=<id>
  → { sessionId, messages: [<jsonl entries normalized>] }
```

源码：[packages/backend/src/routes/sessions.ts](packages/backend/src/routes/sessions.ts)。
注意要带 `Authorization: Bearer <token>`（如果 token 设了）。

### iOS 数据模型

```swift
struct SessionMeta: Identifiable {
    var id: String { sessionId }
    let sessionId: String
    let preview: String       // 第一条 user prompt 头 120 字
    let mtime: Date           // 后端返回毫秒数转 Date
    let size: Int             // 文件大小，用作"轻重"提示
}

struct SessionsAPIResponse: Decodable {
    let sessions: [SessionMetaRaw]
}
struct SessionMetaRaw: Decodable {
    let sessionId: String
    let preview: String
    let mtime: Double
    let size: Int
}
```

### iOS UI

#### 入口

主屏 toolbar **顶部右**多一个时钟图标按钮 (`clock.arrow.circlepath`)，点击 sheet
弹出"历史会话"列表。**位置**：在 ⚙️ 设置图标和左上耳机之间。

> 备选：放进 ⚙️ 设置 → "历史会话" 菜单项。但如果用户经常查询，每次进 设置 → 退出 不方便。**首选 toolbar 按钮。**

#### 列表页（`SessionHistoryView`）

```
┌─────────────────────────────┐
│ ‹ 关闭          历史会话      │
├─────────────────────────────┤
│ /Users/yongqian/Desktop/.. │ ← 当前 cwd（小字 dim）
│                             │
│ ── 最近 50 条 ──             │
│                             │
│ 帮我重构 useVoice            │
│ 2026-04-29 14:32 · 12 KB    │
│ ─────────────                │
│ 用三句话介绍 Tailscale       │
│ 2026-04-29 12:08 · 4 KB     │
│ ...                         │
└─────────────────────────────┘
```

- 每行：preview（最多 2 行）+ 相对时间（"刚刚 / 5 分钟前 / 昨天 / 4-25"）
- 点击行 → 进入"恢复"动作
- 下拉刷新（`refreshable`）重新拉
- 空列表 → 显示"还没有历史会话"
- 错误 → 红条 + 重试按钮
- 加载中 → ProgressView

#### 恢复动作

点击一条 session 后弹 **确认 alert**：

> 恢复这个会话？
> 当前对话内容（X 条）会被替换。
> [取消] [恢复]

理由：避免误触清掉用户正在聊的内容。

确认后：
1. 从 `/api/sessions/transcript` 拉完整 messages
2. `client.messages = parsed`（注意：jsonl 消息是 normalize 过的 SDK 格式，要走跟 sdk_message 一致的解析路径转成 `ChatLine`）
3. `client.sessionId = sessionId`
4. **不发任何 prompt** —— 状态就停在那里，等用户敲下一条
5. 关 sheet 回主页

### 边界处理

| 情况 | 处理 |
|---|---|
| 当前 busy=true（in-flight run）| 按钮禁用 + 显示"等当前回答完成再切" |
| token 不对 / 401 | 显示错误，引导去 ⚙️ 设置改 token |
| cwd 没设 | sheet 内提示"先在设置里选 cwd" |
| transcript 文件不存在（404）| 红条 + 留在 sheet |
| 切到的 session 跑过的 cwd ≠ 当前 cwd | 默认按当前 cwd 拉。**v1 不做"跨项目浏览"**（避免 cwd 不一致灾难） |
| 同时多端 / WS 抖了一下 | sessionId 替换是本地 state，下次 sendPrompt 才把它当 resumeSessionId 发出去 |

### 工时

1 天 = API client + ListView + 恢复确认 + 边界

---

## A2 — 项目快速切换

### 目标

主屏不用进 ⚙️ 设置就能切项目。常用项目持久化为 list。

### iOS 数据

```swift
struct Project: Identifiable, Codable, Equatable {
    var id: String { cwd }
    let name: String       // 显示名（Display）
    let cwd: String        // 绝对路径
    var lastUsed: Date     // 最近选中时间，用作排序
}

// AppSettings 多两条
var projects: [Project] = []           // 持久化（JSON 编码到 UserDefaults）
var currentProjectId: String?          // = current Project.cwd
```

`cwd` 取代当前 `AppSettings.cwd` 的角色 — 切项目就是切 cwd。

迁移：第一次启动时如果有旧 `cwd` 但 `projects` 为空 → 创建一条 default
project 保存。

### UI

#### 入口

主屏顶部状态条上的 cwd 文字（已经有了）改成可点击的 chip：

```
🟢 已连接   [claude-web ▾]   🕒 ⚙️
            ^ tap to switch
```

点 chip → 弹 sheet（`presentationDetents([.medium, .large])`）：

```
┌──────────────────────────┐
│ 项目                  ✕  │
├──────────────────────────┤
│ ✓ claude-web             │  ← 当前
│   ~/Desktop/claude-web   │
│ ─────                    │
│   my-other-project       │
│   ~/Desktop/foo          │
│ ─────                    │
│ + 添加新项目              │
└──────────────────────────┘
```

- "✓" 标当前项目
- 普通行 = 历史项目，点击切换
- 底部 "+ 添加新项目" → 弹 form 输入 name + cwd（绝对路径）
- 长按某行 → 删除（或 swipe-to-delete）

#### 切项目时的状态

切项目 ≠ 切 session。当前 messages **保持显示**，但提示"已切到新项目，下一条
prompt 用新 cwd"。

> 备选：自动 reset session（清空 messages + sessionId 置空）。**首选保持
> messages 显示**，因为用户可能切项目只是为了"问 A 项目的代码，但参考一下
> 刚才在 B 聊的"。明确切 session 走 A1 历史会话即可。

### 工时

半天 = settings model + chip + sheet + form

---

## A6 — 工具卡片渲染

### 目标

代替当前的 `🔧 Bash` 占位文字，把 Claude 用的工具调用渲染成跟 web 一致的卡片。

### 涉及工具（按现有 web 实现）

| 工具 | 卡片样式 |
|---|---|
| TodoWrite | 复选框列表，每条 prefix 状态 (◦ pending / ▣ in_progress / ✓ completed) |
| Edit / Write / NotebookEdit | 路径标题 + 红绿 line-diff 视图 |
| Bash | 等宽命令 + 输出折叠（>5 行默认折）|
| Read | 路径 + 行数（如有） |
| 其它（Grep / Glob / WebFetch / Task / etc.） | 通用 fallback：toolName + 一行 input 摘要 |

### iOS 实现

#### 数据流

backend `sdk_message` 的 assistant.message.content 数组里每个 block 类型可能是
`text` 或 `tool_use`。当前 `Protocol.swift` 只挑 text；要扩展：

```swift
enum SDKMessage {
    case systemInit(...)
    case assistantContent([AssistantBlock])   // ← 新，替代 .assistantText 和 .toolUse
    ...
}

enum AssistantBlock: Identifiable {
    case text(String)
    case toolUse(name: String, input: [String: Any], id: String)
    var id: String { ... }
}
```

`ChatLine` 改成持有 blocks 而不只是 text：

```swift
struct ChatLine {
    enum Body {
        case userText(String)
        case assistantBlocks([AssistantBlock])
        case system(String)
        case error(String)
    }
    let id: UUID
    var body: Body
    var runId: String?
}
```

assistant 流式去重逻辑要相应升级：判断"同一 runId + assistant role + 上次 blocks
的前缀匹配"才合并。当前 `appendOrAppendToLast` 简单 string prefix 检查会失效。

#### SwiftUI 视图

```swift
struct AssistantBlocksView: View {
    let blocks: [AssistantBlock]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(blocks) { block in
                switch block {
                case .text(let s):       MarkdownView(s)
                case .toolUse(let n, let inp, _):
                    switch n {
                    case "TodoWrite":           TodoWriteCard(input: inp)
                    case "Edit", "Write", "NotebookEdit": EditCard(input: inp, name: n)
                    case "Bash":                BashCard(input: inp)
                    case "Read":                ReadCard(input: inp)
                    default:                    GenericToolCard(name: n, input: inp)
                    }
                }
            }
        }
    }
}
```

#### 各卡片实现要点

- **TodoWriteCard**: 解析 `input.todos: [{content, status}]`，每条用对应 system
  image (`circle` / `circle.dotted` / `checkmark.circle.fill`)
- **EditCard**: 用 web 同样的 `lineDiff` 算法（已有 TS 版，移植到 Swift）
  渲染为 `Text` 行集合，红删绿增灰 ctx
- **BashCard**: 等宽 Text + DisclosureGroup 折叠输出（如有 result block 关联）
- **ReadCard**: SF Symbol "doc.text" + path 截短显示
- **GenericToolCard**: tool name + input JSON pretty-printed（折叠）

#### Tool result 关联

backend 流式中 tool_use 块和 tool_result 块（user role 包裹）是分开来的。当前
iOS 把 tool_result 整个忽略。改成：把 tool_use_id 对上，tool_result 的
output 渲染到对应 BashCard / EditCard 下方。**v1 简化版：tool_result 只渲染
到 BashCard 下面**（最常见用例），其它先不显示 result。

### 工时

1.5 天 = 协议升级 + ChatLine 重构 + 4 个 card + 流式合并测试

---

## A7 — Markdown 完整渲染

### 目标

让 Claude 回答里的 markdown 真渲染（标题加大加粗、代码块等宽、列表对齐、
链接可点、表格成 grid），不再当成纯文本显示 `**` `#` 等字符。

### 选型：第三方库 vs 自己写

**[swift-markdown-ui](https://github.com/gonzalezreal/swift-markdown-ui)**（推荐）：
- SwiftUI 原生
- 支持 GitHub Flavored Markdown
- 可定制样式
- iOS 15+ 兼容
- MIT
- ~一两百 K bundle

**自己写**：会做不完整 + 维护负担。**不推荐**。

**Apple 自带 `AttributedString` + `Text(markdown:)`**:
- 只支持极小子集（粗体 / 斜体 / 链接）
- 不支持代码块、表格、列表
- **不够用**

### 集成

xcodegen `project.yml` 里加 SPM 依赖：

```yaml
packages:
  MarkdownUI:
    url: https://github.com/gonzalezreal/swift-markdown-ui
    from: 2.4.0

targets:
  ClaudeWeb:
    dependencies:
      - package: MarkdownUI
```

### 用在哪

```swift
struct MarkdownView: View {
    let text: String
    var body: some View {
        Markdown(text)
            .markdownTheme(.gitHub)         // 或 customize
            .markdownTextStyle(\.code) {
                FontFamilyVariant(.monospaced)
                FontSize(.em(0.95))
                BackgroundColor(Color(.systemGray6))
            }
            .textSelection(.enabled)
    }
}
```

ChatLine 渲染时，assistant.text 块全部走 `MarkdownView`。

### 代码块复制按钮

`Markdown` 的 codeBlock 自定义渲染加复制按钮：

```swift
.markdownBlockStyle(\.codeBlock) { configuration in
    VStack(alignment: .leading) {
        HStack {
            Text(configuration.language ?? "code").font(.caption.monospaced()).foregroundStyle(.secondary)
            Spacer()
            Button(action: { UIPasteboard.general.string = configuration.content }) {
                Image(systemName: "doc.on.doc")
            }
        }
        configuration.label
            .relativeLineSpacing(.em(0.25))
            .markdownTextStyle { FontFamilyVariant(.monospaced) }
            .padding()
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
```

### TTS 兼容

注意 `stripForSpeech` 已经在 TTSPlayer 把 markdown 剥掉再合成。一份 markdown
两路渲染（视觉用 MarkdownUI / TTS 用 stripForSpeech），互不干扰。✅

### 工时

1 天 = SPM 集成 + MarkdownView 包装 + 主题定制 + 代码块复制 + TTS 路径验证不受影响

---

## 整体工序

| 顺序 | 任务 | 估时 |
|---|---|---|
| 1 | A2 项目快速切换（最小、最独立）| 半天 |
| 2 | A1 历史会话浏览（依赖 A2 的 cwd 概念变化）| 1 天 |
| 3 | A7 Markdown 渲染（A6 的依赖）| 1 天 |
| 4 | A6 工具卡片（最复杂，最后干）| 1.5-2 天 |

合计 4-4.5 天专注。

## 跨任务一致性

1. **Settings 文案 / 持久化键命名**：所有新加 key 走 `com.albertsun6.claudeweb-native.<feature>`
2. **错误显示**：复用现有 `voice.lastError` banner 范式 — orange 横条 + 关闭按钮。新 API client 失败时 push 到这里
3. **认证**：所有新 HTTP 请求走 `authToken()` getter，跟 VoiceRecorder/TTSPlayer 一致
4. **网络重试**：v1 不做指数退避，失败就提示用户手动刷新

## 风险点（自审）

1. **A1 transcript 解析**：jsonl messages 跟 stream-json 流不完全一样
   ([backend normalizeJsonlEntry](packages/backend/src/routes/sessions.ts#L100))。要确认 iOS 的 `SDKMessage.parse` 能消费 normalize 过的输出
2. **A2 settings 迁移**：用户已有的 `cwd` 设置必须自动转成第一条 Project，
   否则升级后看不到项目
3. **A6 协议变更**：从 `case .assistantText(String)` 改成 `.assistantContent([Block])`
   是 breaking change for the SDKMessage enum。所有引用都要改。流式去重逻辑要
   重写
4. **A7 swift-markdown-ui 依赖**：bundle 多 ~200KB，要确认对 launch time 影响
   < 100ms
5. **键盘**：项目切换 sheet 弹出时 textfield + safe area 的兼容；A1 sheet 同样

## 评审要回答的问题

1. **A1 入口位置**：toolbar clock 按钮 vs 设置菜单项 vs 主屏底部 tab bar，哪个最合理？
2. **A1 跨 cwd 浏览**：v1 限当前 cwd 是不是太严格？还是先这样安全？
3. **A2 切项目时是否清空 messages**：保持 vs reset，哪个更对？
4. **A6 ChatLine 重构**：直接把 SDKMessage 替换为 blocks 数组，会不会让现有 TTS
   流（feedAssistantChunk）逻辑出问题？
5. **A6 tool_result**：v1 只关联到 BashCard 是否够用？Edit 需不需要显示 result（"3 lines edited"）？
6. **A7 swift-markdown-ui 库**：MIT 协议 / 还在维护 / 性能 — 你看有没有更好的选择？
7. **整体顺序**：A2 → A1 → A7 → A6 — 你认为应该插队吗？
8. **持久化兼容**：升级 app 后老用户的 settings 应该平滑迁移，我有遗漏吗？

## 不在 F1 范围（明确不做）

- 项目跨设备同步（B2）
- 历史会话搜索 / 删除
- 多项目并行 run（A10 已否决）
- 工具卡片动画 / 折叠记忆
- Markdown 数学公式（KaTeX）

---

## 给评审的请求

1. 上面 8 个问题
2. 还有什么 F1 引入但我没考虑的风险
3. 顺序 / 优先级是否合理（4-4.5 天预算）
4. 跟 round 1-3 已修的问题有没有交叉退化风险
