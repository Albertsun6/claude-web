# iOS Native F1 v3 — Server-backed Projects + Conversations

> **作废**：[IOS_NATIVE_F1_PLAN.md](IOS_NATIVE_F1_PLAN.md) 中的 A1 + A2，
> [IOS_NATIVE_F1_V2_PLAN.md](IOS_NATIVE_F1_V2_PLAN.md) 整份。
> A6（卡片渲染）、A7（markdown）保持原计划，等 F1 v3 落地后再做。
>
> **写于**：2026-04-29 · **状态**：F1c1 / F1c2 / F1c3 已完成；F1c4（抽屉 UX）/ F1c5（历史 jsonl 浏览）未做
>
> **进度**：
> - ✅ F1c1：后端 projects.json store + `/api/projects/*`（GET/POST/PATCH/cleanup/forget）+ 22 项 smoke test 全过
> - ✅ F1c2：BackendClient per-conversation 重构 + runId 路由 + 4 条并发不变量 + per-conversation TTS cache
> - ✅ F1c3：ProjectsAPI / SessionsAPI / TranscriptParser / Cache（Application Support, LRU 50）/ ProjectRegistry / AppSettings 持久化 / dirty-cache 集成
> - ⏳ F1c4：抽屉 UX（左侧滑动 drawer，目前用 .sheet 代理）
> - ⏳ F1c5：历史 jsonl 浏览 + 一键 resume（`/api/sessions/transcript` + TranscriptParser 已就绪，缺 UI）

---

## 1. 跟 v2 的差异（为什么又升级）

v2 是"iOS 自己维护项目列表 + 切项目 swap state"。讨论后用户拍板了三条更深的改动：

1. **服务器中央存储**：项目注册表也放服务器（`~/.claude-web/projects.json`），iOS 是 thin client + 离线缓存
2. **项目-对话两级**：一个项目下可有 N 条对话并行；切项目 / 切对话都不打断 in-flight turn；conversation 是独立单元（不只是历史 sessionId）
3. **抽屉 UX**（图中 Claude.ai 侧边栏样式）：主屏只显示当前对话，项目+对话+设置+浏览全在左侧抽屉
4. **不做删除**：项目通过 Mac 文件系统、对话通过 web 端；iOS 只有"打开/关闭" + "手动清理失效项目"
5. **离线缓存**：iOS 本地缓存最近对话内容，断网可读

---

## 2. 设计原则

1. **服务器是 source of truth**：项目注册表（projects.json）+ jsonl 对话历史。iOS 启动 fetch，本地只保留缓存副本。
2. **架构对齐 web 前端 byCwd**，但升级到 byConversation：每条 conversation 独立 state 容器
3. **conversationId（client UUID）vs sessionId（CLI 给的）解耦**：新对话先用 UUID，CLI 第一次返回 sessionId 后绑定，避免 ID 替换的复杂度
4. **抽屉是导航中心**：所有非聊天操作（建对话、切项目、打开目录、看历史、设置）都在抽屉里
5. **不做的复杂性**：跨设备实时推送、对话重命名、对话/项目删除、文件树/文件读

---

## 3. 服务器端改动

### 3.1 项目注册表

存储路径：`~/.claude-web/projects.json`（backend 用户 home 目录下）

格式：
```json
{
  "version": 1,
  "projects": [
    {
      "id": "8a4f...uuid",
      "name": "claude-web",
      "cwd": "/Users/yongqian/Desktop/claude-web",
      "createdAt": "2026-04-29T10:00:00.000Z",
      "updatedAt": "2026-04-29T15:23:00.000Z"
    }
  ]
}
```

**id**：UUID v4，不用 cwd 当 id（cwd 可能被改名 → id 稳定）。

**写入安全**：

1. **原子 rename**：`writeFile(tmp) → rename(tmp, real)` 防"半写"
2. **进程内串行写锁**（必需，不只是原子 rename）：Node.js 单线程但 read-modify-write 不是原子，需要 promise queue 串行化。否则两个并发 POST `/api/projects` 各自 read 旧版本 + 添加自己的 entry + write，第二个会覆盖第一个的 entry（lost update）：

   ```ts
   let writeQueue: Promise<unknown> = Promise.resolve();
   export function withProjectsLock<T>(fn: () => Promise<T>): Promise<T> {
     const next = writeQueue.then(fn);
     writeQueue = next.catch(() => undefined);
     return next;
   }
   ```

   所有 POST / PATCH / forget / cleanup 都包在 `withProjectsLock` 里。GET 不需要。
3. **版本字段**：`version: 1`，未来格式升级时迁移用
4. **.bak 备份**：每次成功写入后，把上一份内容存 `projects.json.bak`；启动时如果 projects.json parse 失败 → 尝试 .bak 恢复

### 3.2 新增 endpoints（backend）

`packages/backend/src/routes/projects.ts`（新文件）：

| Method | Path | 用途 |
|---|---|---|
| `GET` | `/api/projects` | 列出全部项目（不过滤 cwd 是否存在）|
| `POST` | `/api/projects` | body `{name, cwd}` → 注册新项目；如果 cwd 已注册则返回已有 id（不重复创建）|
| `PATCH` | `/api/projects/:id` | body `{name}` → 重命名（v1 暂不开放给 iOS UI 用，但 API 留着供 web 端用）|
| `POST` | `/api/projects/cleanup` | 检查所有项目 cwd 是否存在，返回 `{missing: [{id, name, cwd}, ...]}`（带详情，UI 用来给用户确认）|
| `POST` | `/api/projects/:id/forget` | 从 projects.json 移除该条目（不删 jsonl）|

**不做**：`DELETE /api/projects/:id` 那种"完全删除连 jsonl 一起删"的危险动作。Forget 只移除注册条目；jsonl 保留。

### 3.3 Sessions 路由复用

[packages/backend/src/routes/sessions.ts](../packages/backend/src/routes/sessions.ts) 已经提供：
- `GET /api/sessions/list?cwd=<path>` 列出该 cwd 所有 jsonl 的 preview/mtime
- `GET /api/sessions/transcript?cwd=<path>&sessionId=<id>` 拉某个 session 的完整内容

iOS 通过 projectId → 后端查注册表拿 cwd → 透传给 sessions 路由。

可选优化（v1 不做）：加 `GET /api/projects/:id/sessions` 作为糖，省一次后端 lookup。

### 3.4 路径白名单兼容

如果设了 `CLAUDE_WEB_ALLOWED_ROOTS`，注册项目时 cwd 必须在白名单内。POST `/api/projects` 调 `verifyAllowedPath(cwd)`，失败返 403。

---

## 4. iOS 端核心数据模型

### 4.1 Project

```swift
struct Project: Identifiable, Codable, Equatable {
    let id: String                  // UUID from server
    var name: String
    let cwd: String                 // 不可变，要改 cwd 就重建项目
    let createdAt: Date
    var updatedAt: Date
}
```

### 4.2 Conversation

```swift
struct Conversation: Identifiable, Equatable {
    let id: String                  // client-side UUID（稳定）
    let projectId: String
    var sessionId: String?          // CLI 给的；新建对话 nil，第一次 prompt 后绑定
    var title: String               // 第一条 user message 前 30 字符（首次 prompt 后填）
    var lastUsed: Date
    var createdAt: Date
}
```

**ID 解耦的理由**：用户新建对话点完"开始"就跳进主屏，但 sessionId 要等第一次 prompt 跑完 CLI 回 systemInit 才有。如果用 sessionId 当 id，从 nil 变实值时所有引用都要更新（runIdRouting、UI selection、缓存 key）。用稳定 UUID 一劳永逸。

**conversationId 来源规则**（明确）：

| 场景 | conversationId 取值 | sessionId |
|---|---|---|
| 新建对话（UI 触发） | client UUID v4 | nil（直到第一次 systemInit 绑定）|
| 加载历史 session（jsonl）| 直接用 sessionId（**先 dedup**）| 同 sessionId |
| 加载历史前 dedup | 如果已有 Conversation `sessionId == 目标 sid` → 复用现有，不创建副本 | — |

**dedup 实现**：

```swift
func openOrLoadHistorical(sessionId sid: String, in projectId: String) -> Conversation {
    if let existing = conversationsByProject[projectId]?.first(where: { $0.sessionId == sid }) {
        return existing      // 复用，不创建 SID-X 副本
    }
    let conv = Conversation(id: sid, projectId: projectId, sessionId: sid, ...)
    conversationsByProject[projectId, default: []].append(conv)
    return conv
}
```

**为什么需要 dedup**：用户新建对话 UUID-A，发 prompt 后 systemInit 绑了 sessionId X。后续用户在历史列表里看到 X 又点开，如果不 dedup 会出现 UUID-A 和 SID-X 两条 Conversation 指向同一个 jsonl 文件，UI 双开同一对话 → 状态分歧、TTS 错播、cache 双写。

### 4.3 ConversationChatState（运行时）

```swift
struct ConversationChatState: Equatable {
    var messages: [ChatLine] = []
    var pendingPermission: PermissionRequest? = nil
    var currentRunId: String? = nil
    var busy: Bool = false
}
```

不存 sessionId / title —— 这些在 Conversation 元数据里。State 只关心 in-memory 运行态。

### 4.4 BackendClient 重构

```swift
@MainActor @Observable
final class BackendClient {
    var state: ConnState = .disconnected

    // 全部 conversation 的运行时 state
    var stateByConversation: [String: ConversationChatState] = [:]

    // 当前 UI focus 的 conversation
    var currentConversationId: String?

    // runId → conversationId 路由
    private var runIdToConversation: [String: String] = [:]

    // Computed views（UI 绑定这些）
    var currentMessages: [ChatLine] { /* ... */ }
    var currentBusy: Bool { /* ... */ }
    var currentPendingPermission: PermissionRequest? { /* ... */ }

    // 全局活跃数（顶部小红点用）
    var activeRunCount: Int {
        stateByConversation.values.filter { $0.busy }.count
    }
}
```

### 4.4.1 runId 路由的并发不变量（必须保证）

1. **所有 ServerMessage 都按 runId 路由到 conversation**：sdkMessage / sessionEnded / error / clearRunMessages / permissionRequest 五个 case 都要走 `runIdToConversation[runId]` 找归属，找不到 silently drop（避免误注入到 currentConversationId）
2. **runIdToConversation 清理时机**：`sessionEnded` 任意 reason（completed / error / interrupted）后立刻 `removeValue(forKey: runId)`；不能只在 completed 时清
3. **pendingPermission 必须存在 conversation state 里**，不能挂 BackendClient 全局：否则 conversation A 的权限请求会在 B 的 UI 弹出
4. **TTS 触发条件**：`session_ended.completed && conversationId == currentConversationId`。其他 conversation 的 turn 完成不触发 TTS（也不触发 NowPlaying 更新）

### 4.5 AppSettings 改动

```swift
// 删除（迁移用一次后丢弃 UserDefaults key）
// var cwd: String  ← 不再用

// 新增
var openProjectIds: Set<String> = []                 // 本设备已"打开"的项目集合
var currentProjectId: String?
var currentConversationId: String?
var lastConversationByProject: [String: String] = [:] // 项目 id → 最后用过的对话 id（打开项目时恢复）
```

`openProjectIds` 是设备级 visibility 集合，决定抽屉里显示哪些项目。设备 A "关闭" 项目不影响设备 B。

### 4.6 ProjectRegistry（新文件）

```swift
@MainActor @Observable
final class ProjectRegistry {
    var projects: [Project] = []                     // server snapshot
    var conversationsByProject: [String: [Conversation]] = [:]
    var loadState: LoadState = .idle                 // idle / loading / synced / offline

    func bootstrap() async       // 启动：先读 cache → fetch server → diff → 写 cache
    func openByPath(_ cwd: String, name: String?) async throws -> Project
    func closeProject(_ id: String)                  // 仅设备级 visibility
    func newConversation(in projectId: String) -> Conversation
    func loadHistorySessions(_ projectId: String) async  // 拉 /api/sessions/list
    func loadConversation(_ id: String) async        // 拉 /api/sessions/:sid → cache
    func cleanupMissing() async -> [String]          // 调 /api/projects/cleanup → forget
}
```

---

## 5. UI 设计

### 5.1 主屏幕（瘦身）

```
┌──────────────────────────────────┐
│ ☰² ●connected  •claude-web 💬   │  ← 顶栏：抽屉按钮(2 个 in-flight) + 连接 + 当前对话
│ ┌──────────────────────────────┐ │
│ │  user: 帮我看一下…           │ │
│ │  assistant: ...              │ │
│ │                              │ │
│ │     [ChatListView]           │ │
│ │                              │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ [输入框]  🎤  ▶              │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

顶栏左侧 ☰ 抽屉按钮（左上角带活跃数 badge），右上角保留两个**状态可见性图标**（不是按钮，仅状态显示）：

- 🔁 仅当 `settings.silentKeepalive` 时显示，提示后台保活开着
- 🔴 仅当 Bypass 权限模式开着时显示（替代当前的全宽 banner）

**移除**：原计划的 🎧 voice mode 指示器。理由：voice 模式开着时输入栏 mic 按钮会变样、UI 整体进入语音交互流程，用户能从主交互区直接看出来；顶栏再放一个 🎧 是冗余视觉负担。voice 切换按钮放抽屉。

settings 入口、voice mode 切换、keepalive 切换都进抽屉（这些是动作）。

### 5.2 抽屉（核心）

```
┌─────────────────────────────────┐
│  ✨  新建会话              ⌘N  │
│  📁  打开目录                   │  ← 浏览 Mac fs 注册新项目
├─────────────────────────────────┤
│  🎧  语音模式 (off)             │  ← 之前在顶栏的
│  ⚙️   设置                      │
├─────────────────────────────────┤
│ claude-web                  ⋯   │  ← 项目分组（···长按出菜单：关闭项目）
│  ● 项目评估与改进建议            │  ← 当前对话（高亮）
│    TS 类型问题                   │
│    M5 plan                       │
│                                  │
│ ios-native                  ⋯   │
│    真机测试 round 3              │
│  🟢 A2 实现 (running)            │  ← 该项目 in-flight 时绿色小点
│                                  │
│ scratchpad                  ⋯   │
│    General inquiry               │
│                                  │
│ 🛠 清理失效项目                  │  ← 底部，调 cleanup endpoint
└─────────────────────────────────┘
```

**项目顺序**：按 `lastUsed` 倒序（同当前 web 端体感）

**对话顺序**：项目内按 `lastUsed` 倒序

**当前选中**：项目高亮 + 对话前置实心点

**in-flight 标识**：对话标题前 🟢 + "(running)" 后缀

### 5.3 抽屉打开方式

- 左上角 ☰ 按钮点击
- 从屏幕左缘向右滑动手势（DragGesture）
- 抽屉宽度：min(屏幕宽 × 0.85, 320pt)
- 主屏右移 + 半透明遮罩盖住主屏
- 点遮罩 / 滑回去 / 选择某项后自动关闭

实现：自定义 `DrawerContainer` view，ZStack 包主屏 + 抽屉，DragGesture 控制 offset，避开第三方依赖。

### 5.4 新建会话流

```
点 "✨ 新建会话"
   ↓
弹 sheet (.medium):
   "选择项目"
   ○ claude-web       (默认选中：当前项目)
   ○ ios-native
   ○ scratchpad
   [开始]
   ↓
开始 → registry.newConversation(in: projectId)
     → settings.currentProjectId = projectId
     → settings.currentConversationId = conversation.id
   ↓
抽屉关闭 → 主屏显示空对话 → 用户输入第一条 prompt
   ↓
prompt 走 ws → CLI systemInit 回 sessionId
   ↓
client.bindSessionId(conversationId, sessionId)
   ↓
title 用 first user prompt 派生（同步进 conversationsByProject）
```

### 5.5 打开目录流（参考 Cursor）

```
点 "📁 打开目录"
   ↓
push 一个 DirectoryPicker view（NavigationLink）
   起点：/Users/yongqian/Desktop（v1 hardcode；v2 改）
   ↓
界面：
   - 当前路径面包屑
   - 子目录列表（点击进入）
   - "[打开此目录]" 按钮
   ↓
点 "[打开此目录]"
   ↓
弹 alert "项目名称": <默认填目录名>
   ↓
确认 → POST /api/projects {name, cwd}
   ↓
返回的 project 加进 registry.projects
settings.openProjectIds.insert(project.id)
settings.currentProjectId = project.id
   ↓
自动加载该项目最近一条对话；没有则 newConversation
   ↓
抽屉关闭，主屏切到新对话
```

后端调 `/api/fs/tree?path=<cwd>`（已存在）列子目录。受 ALLOWED_ROOTS 限制。

### 5.6 切项目

抽屉里点项目分组标题（不是对话行）→ `settings.currentProjectId = id`，自动加载 `lastConversationByProject[id]`，没有就拉 `/api/sessions/list` 取最近一条；还没有就 newConversation。

### 5.7 切对话

抽屉里点对话行 → `settings.currentConversationId = id`：
- 如果该 conversation 在 stateByConversation 已有 → 直接 swap UI focus
- 如果没有 → 先从本地 cache 读 → UI 显示 → 后台 fetch `/api/sessions/:sid` 更新

### 5.8 关闭项目

长按项目分组 → 弹 ActionSheet "关闭项目"：
- `settings.openProjectIds.remove(id)` —— 从抽屉消失
- 该项目所有 in-memory conversation state 清掉（释放内存）
- 服务器 projects.json 不动
- 之后可通过"打开目录"重新打开（cwd 重新匹配）

### 5.9 关闭对话

抽屉里对话行右滑 → "关闭"：
- `stateByConversation.removeValue(forKey: id)` —— 仅卸载 in-memory
- jsonl 不动
- 下次再点就重新 fetch
- **不做"删除对话"**

### 5.10 手动清理失效

抽屉底部 "🛠 清理失效项目"：
- POST `/api/projects/cleanup`
- 服务器返 `{missing: [{id, name, cwd}, ...]}`
- 弹 alert "以下项目目录已不存在，是否从注册表移除？"
  - claude-web (/Users/yongqian/Desktop/claude-web)
  - old-project (/tmp/old)
- 用户可勾选要移除的（默认全选）
- 确认 → 对每个勾选的 id POST `/api/projects/:id/forget`

### 5.11 全局活跃指示器

顶栏 ☰ 按钮上 `activeRunCount > 0` 时叠加红点 + 数字：

```
☰² ●connected ...
```

点击打开抽屉时这些 in-flight 的 conversation 在列表里有 🟢 标记。

---

## 6. 离线缓存

### 6.1 文件布局

```
Application Support/com.albertsun6.claudeweb-native/cache/
├── projects.json                    # GET /api/projects 的最近快照
├── conversations.json               # 全部已知 conversation 元数据 (按项目 id 索引)
└── sessions/
    ├── <conversationId>.json        # ConversationChatState 的快照（仅 messages）
    └── ...
```

格式都用 Codable JSON。

### 6.2 写入时机

- `projects.json`：每次成功 fetch `/api/projects` 后覆写
- `conversations.json`：
  - list sessions 成功后
  - newConversation 后
  - **systemInit 收到 sessionId 立刻 flush**（关键：crash 不丢绑定）
  - title 更新后
- `sessions/<id>.json`：load conversation 成功 / 收到 session_ended 完成时

### 6.3 读取时机

- 启动：先读 cache → UI 显示 → 后台 fetch 更新
- 切对话：先读 cache → UI 显示 → 后台 fetch 详情
- 离线（fetch 失败）：保持 cache 数据；UI 顶部显示离线 banner，输入框禁用（无法发新 prompt）

### 6.4 LRU 上限

- 最多保留 50 条 session 文件
- 超过 → 按文件 mtime 删最旧
- 删的时候不影响服务器 jsonl，只删本地缓存

### 6.5 缓存清空

- 在设置页加一个 "清空本地缓存" 按钮（v1 选做）
- "关闭项目" 时，可选清掉该项目所有 conversation 的本地 cache（节省空间）

---

## 7. 关键流程总览

| 流程 | 步骤 |
|---|---|
| **冷启动** | 读 cache → UI 显示 → connect WS → fetch /api/projects → diff → 更新 |
| **新建对话** | 选项目 → newConversation → 主屏 → 第一次 prompt → systemInit 绑 sessionId → 派生 title → 写 cache |
| **打开目录** | DirectoryPicker → POST /api/projects → 加入 openProjectIds → 加载最近对话或新建 |
| **切项目** | currentProjectId 变 → 加载 lastConversationByProject → 没就拉 list 取最近 → 没就 newConversation |
| **切对话** | currentConversationId 变 → state 已有就 swap → 没就 fetch /api/sessions/:sid → 更新 cache |
| **关闭项目** | openProjectIds 移除 + 清 in-memory state；服务器不动 |
| **关闭对话** | stateByConversation 移除；服务器不动 |
| **清理失效** | POST cleanup → 用户确认 → 对每个 id POST forget |
| **跑 prompt** | sendPrompt(conversationId) → runIdToConversation 路由 → state 更新 |
| **TTS 触发** | session_ended.completed && conversationId == currentConversationId → speak |

---

## 8. 文件改动清单

### Backend

| 文件 | 改动 |
|---|---|
| `packages/backend/src/routes/projects.ts` | **新文件**：CRUD（不含 DELETE）+ cleanup + forget |
| `packages/backend/src/index.ts` | 挂载 projectsRouter |
| `packages/backend/src/projects-store.ts` | **新文件**：projects.json 读写（原子 rename）|

### iOS

| 文件 | 改动 |
|---|---|
| `Settings.swift` | 删 `cwd` 字段；加 openProjectIds / currentProjectId / currentConversationId / lastConversationByProject + 迁移 |
| `BackendClient.swift` | 大改：stateByConversation + runIdToConversation 路由 + computed views + sendPrompt 注入 conversation |
| `ProjectRegistry.swift` | **新文件**：bootstrap / openByPath / newConversation / loadHistory / loadConversation / cleanupMissing |
| `Cache.swift` | **新文件**：Codable JSON 缓存读写、LRU |
| `ProjectsAPI.swift` | **新文件**：HTTP client for /api/projects |
| `SessionsAPI.swift` | **新文件**：HTTP client for /api/sessions（list + detail）|
| `TranscriptParser.swift` | **新文件**：jsonl 格式 → [ChatLine]，独立于 SDKMessage.parse |
| `DrawerContainer.swift` | **新文件**：抽屉容器 + DragGesture |
| `DrawerView.swift` | **新文件**：抽屉内容（新建会话 / 打开目录 / 项目分组列表）|
| `DirectoryPicker.swift` | **新文件**：远程目录浏览 |
| `NewConversationSheet.swift` | **新文件**：新建对话的项目选择器 |
| `ContentView.swift` | 顶栏改 ☰ + chip；包一层 DrawerContainer；移除 settings/voice 按钮 |
| `ClaudeWebApp.swift` | 注入 ProjectRegistry / Cache 到 environment；onAppear 调 registry.bootstrap |
| `Protocol.swift` | 加 ServerMessage.runId computed prop（如果还没）|
| `VoiceSession.swift` | sendPrompt 闭包注入改造（之前是 cwd，现在用 currentConversationId 让 client 内部解析）|
| `TTSPlayer.swift` | 触发改成基于 currentConversationId |
| `ClaudeWebApp.swift onAppear` | voice.bind 的 sendPrompt 闭包：`clientRef?.sendPrompt(text, conversationId: settings.currentConversationId)` 而非 cwd 直传 |

---

## 9. 实施分期

工作量大，分 5 期，每期独立可 build / 可测：

### F1c1 — 后端 projects API（0.5 天）
- projects-store.ts（原子读写 projects.json）
- projects.ts router（GET / POST / PATCH / cleanup / forget）
- 挂载 + 手动 curl 测试

**验收**：`curl POST /api/projects {name:"test", cwd:"/Users/yongqian/Desktop"}` 写入 projects.json；`curl /api/projects` 读出来；`/api/projects/cleanup` 检测虚假 cwd 后 forget 它。

### F1c2 — iOS BackendClient 重构（per-conversation state）（2 天）
- ConversationChatState 数据结构
- stateByConversation + runIdToConversation 路由
- sendPrompt 注入 conversationId
- handle 消息按 runId 分发（5 个 case 全覆盖）
- computed views
- **不动主 UI**，但加一个 debug 入口（settings 隐藏页 / 长按 chip 进 debug menu）

**验收（关键，必须全过）**：
1. 在 debug menu 启动 2 条 conversation 同 cwd 并行发不同 prompt → 消息进各自 state，**不串**
2. 切到对话 B 时，对话 A 的 turn 完成 → **不触发 TTS**（只在 currentConversationId 完成才播）
3. 对话 A 发 prompt 触发 PreToolUse 权限弹窗后切到 B → permission sheet **不在 B 上弹**
4. 任何 sessionEnded（completed / error / interrupted）都正确清 `runIdToConversation` 条目，无内存泄漏

### F1c3 — ProjectRegistry + Cache + APIs（1.5 天）
- ProjectsAPI / SessionsAPI HTTP clients
- Cache（Codable JSON 写读 + LRU）
- ProjectRegistry（bootstrap / loadHistory / loadConversation）
- TranscriptParser（先 curl 探活后端实际格式再写）

**验收**：启动调 bootstrap → cache 命中显示离线快照；网络回来后 fetch 更新；切对话 fetch /api/sessions/:sid 后 cache 写入。

### F1c4 — 抽屉 UI（2 天）
- DrawerContainer + DrawerView
- ContentView 顶栏改造
- 项目分组列表 + 当前对话高亮 + in-flight 标记
- NewConversationSheet
- DirectoryPicker
- 切项目 / 切对话 / 关闭项目 / 关闭对话的交互

**验收**：手机打开 app → 抽屉展开 → 看到项目+对话 → 点新建跑通 → 浏览打开新目录跑通 → 切项目切对话不掉数据。

### F1c5 — 离线 + 清理（1 天）
- 离线 banner + 输入禁用
- 启动顺序：cache 先 → server 后
- 手动"清理失效项目"按钮 + 确认流
- 设置页"清空本地缓存"按钮（选做）

**验收**：开飞行模式 → 启动仍能看到上次对话；连回来自动 fetch；rm 一个项目目录后点清理 → 弹 alert → 确认后从抽屉消失。

### 总工作量

7 天 ± 1 天。比 v2 的 5-6 天多 1-2 天，多换的：
- 服务器中央存储（跨设备基础）
- 抽屉 UX
- 离线缓存

---

## 10. 边界情况

| 情况 | 决策 |
|---|---|
| 新建对话还没发第一条 prompt 就被切走 | conversation 留在 stateByConversation，但 sessionId nil；下次切回去能继续；冷启动会丢（没写 cache）|
| 新对话发第一条 prompt 失败（网络） | busy = false，conversation 仍在 in-memory；用户重发 |
| 切对话时正在跑 turn | 不打断，turn 在原 conversation state 跑完；切回去看到结果 |
| 同 cwd 在 projects.json 里被注册两次（race） | POST /api/projects 检测 cwd 重复，返回已有 project（不重复创建）|
| 项目 cwd 在 Mac 上被改名（mv） | 注册条目里的 cwd 失效；下次 cleanup 标记 missing；用户手动清理后再"打开目录"重建 |
| iOS 离线时点新建对话 | 允许（client UUID 创建本地 conversation）；发 prompt 时报错 |
| 离线时切对话到没缓存的 | UI 显示空 + 提示 "无离线缓存，请联网" |
| jsonl 文件很大（千条 message） | v1 不分页；如果性能问题再说 |
| 多设备同时 cleanup 撞车 | projects.json 写入是原子 rename，最坏情况是某次写入被覆盖；幂等操作可重试 |
| sessionId 还没绑就用户手动切对话刷新 cache | cache key 用 conversationId（client UUID）不会出问题 |
| 抽屉打开时 in-flight turn 完成触发 TTS | TTS 只在 conversationId == currentConversationId 时触发；in-flight 不在 current 的 turn 完成不响 |
| 启动时 settings.currentConversationId 指向已删除的 conversation | bootstrap 后兜底：找不到就清掉，加载该项目 lastConversation 或新建 |

---

## 11. 不做（明确）

- ❌ 跨设备实时推送（v3 远期）
- ❌ 对话 / 项目重命名（v1；后端 PATCH endpoint 留着但 iOS 不调）
- ❌ 对话 / 项目删除（项目去 Mac 删；对话去 web 删）
- ❌ 同步 openProjectIds 到服务器（保持设备本地状态）
- ❌ 文件树浏览 / 文件读取（F2 做）
- ❌ Conversation 重命名（自动从首条 prompt 派生）
- ❌ 多 conversation 同 sessionId（一对一）
- ❌ 自动清理 missing 项目（只手动）

---

## 12. 风险

| 风险 | 缓解 |
|---|---|
| BackendClient 改造大，影响现有 voice/permission/TTS | 分期实施；F1c2 不动 UI；每期完跑模拟器+真机 smoke |
| TranscriptParser 跟实际 jsonl 格式不一致 | F1c3 先 curl 探活再写代码 |
| 离线 cache 写入并发竞争（多个 conversation 同时收到 session_ended） | Cache 用 actor 隔离写入；同步序列化 |
| 抽屉手势跟系统 swipe-back 冲突（NavigationStack） | 用纯 DragGesture，不嵌 NavigationStack 在抽屉 push 路径 |
| projects.json 损坏（手动改坏 / 进程异常） | 读取失败时 fallback 到空数组，备份 .bak；启动 log warning |
| iOS app 升级后 cache 格式不兼容 | cache 文件首字段 `version: 1`；解码失败清空 cache 重 fetch |

---

## 13. 评审已过 + 5 条修正（2026-04-29）

外部 AI review 通过，要求修正 5 点已全部落实在本文档：

1. ✅ 修正 sessions transcript 接口路径为 `/api/sessions/transcript?cwd=&sessionId=`（§3.3）
2. ✅ 明确历史 session → conversationId 映射规则 + dedup（§4.2）
3. ✅ VoiceSession 发送路径纳入改造范围（§8 文件清单）
4. ✅ projects-store 加进程内写锁 + 版本字段 + .bak 备份（§3.1）
5. ✅ cleanup 返回 missing project 详情（id + name + cwd），不只 ids（§3.2 + §5.10）

附加自查（评审未提但我自己补的）：
- ✅ ConversationId 唯一性 dedup 规则（§4.2 表后段落）
- ✅ runId 路由 5 个并发不变量（§4.4.1）
- ✅ systemInit 收到 sessionId 立刻 flush conversations.json（§6.2）
- ✅ 顶部状态可见性 indicator 保留（语音 / keepalive / Bypass）（§5.1）
- ✅ F1c2 验收增加 4 条并行验证（§9）

## 14. 验收总闸（不通过 = 不合格）

来自评审压缩后的硬验收，F1c5 完成时全部必须过：

1. 两个 conversation 同时跑，消息不会串
2. 切到别的 conversation 后，原 run 完成不会错误播报 TTS
3. 新建 conversation 收到 systemInit 后，sessionId 立刻持久化（杀 app 后重启绑定还在）
4. 重启 app 后能从 cache 恢复项目、conversation、最近消息
5. POST /api/projects 并发注册同 cwd 不会产生重复或覆盖

可以从 F1c1 开工。
