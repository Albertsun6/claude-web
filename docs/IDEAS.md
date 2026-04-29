# 待做的想法

跟 Claude Code 拉齐 / 增强的功能清单。按价值排序。
所有项都已记录但**未实现**——需要时再开工。

---

## 高价值

### 0. Skill 队列 / 打断 ✅ 完成
当 Claude 正在跑任务时，能把下一条 prompt 或 `/skill` 命令加入队列（当前跑完自动发），或立即打断当前任务切到新任务。

**两种模式**：
- **队列模式（Queue）**：Claude 忙时输入框右下角出现"排队"按钮，点后 prompt 进 pending list。当前 `session_ended` 触发时自动 `sendPrompt`，不需要用户盯着等。可排多条（有序列表，可拖拽调整）。
- **打断模式（Interrupt）**：点现有的停止按钮后，弹"停止后发什么？"输入框（可预填），SIGTERM 后立即发新 prompt 继续同一 session（带 `--resume`）。

**实现（iOS）**：
- `BackendClient`：新增 `pendingQueue: [(convId, String)]`，`session_ended` 时检查 queue 头，非空则 `sendPrompt`
- 发送时若 `busy == true`：`sendButton` 变成两个：[打断并发] [排队]
- iOS 抽屉 / 底部显示队列条目，支持删除

**实现（Web）**：
- `store.ts` 加 `pendingQueue: string[]` per cwd
- `InputBox`：busy 时 send 按钮弹 popover 选 [打断] [排队]

**为什么值得**：手机场景经常"让 Claude 跑着，我去干别的，跑完继续下一步"。现在只能盯着等完才能发下一条。队列让一整个工作流能串联跑完不用守着。

**技巧**：Skills（`/skill-name`）本质也是 prompt，所以队列里可以混排普通 prompt + skill 调用，不需要额外处理。

---

### 1. 图片粘贴 / 拖拽（多模态输入）
手机 PWA 里截图后直接粘贴到输入框，发给 Claude 做视觉分析。

**实现**:
- 前端 `paste`/`drop` 事件捕获 image blobs
- base64 编码后塞进 user_prompt 的 content array：`[{type:"text",text:"..."},{type:"image",source:{...}}]`
- 后端 cli-runner 透传给 stream-json stdin
- UI 在输入框上方显示缩略图，可删除

**为什么值得**：手机定位很多场景是"看到一个东西问 Claude"——错误截图、UI 设计、菜单照片。

---

### 2. 子代理 (Task) trace 折叠
Claude 调用 Task tool 时会有 sidechain 消息流。当前 `normalizeJsonlEntry` 直接过滤掉了，前端看不到。

**实现**：
- 后端 sessions.ts 保留 `isSidechain` 消息但加 group id
- 前端把同一 sidechain 包成可折叠区域 `▶ subagent: <agent name> (12 messages)`
- 默认折叠，点开看完整 trace

**为什么值得**：Claude 跑复杂任务时大量在子代理里干活，看不见就不知道它在干啥。

---

### 3. Plan 模式专属 UI
permissionMode = `plan` 时，Claude 不执行只规划。计划写到 `~/.claude/plans/*.md`。

**实现**：
- 后端检测 plan mode 的 ExitPlanMode 调用
- 前端弹模态：显示完整 plan 文件 + 按钮 [批准并执行 / 退出 plan / 修改]
- 批准 → 切到 default mode + 重发 prompt "execute the plan"

**为什么值得**：plan mode 现在配置好了但 UI 没专门支持，纯靠用户自己看消息流。

---

### 4. 终端 ANSI color 渲染
Bash 工具结果带 ANSI 颜色码（git log 彩色输出、test runner 等），现在显示成 `[31m` 乱码。

**实现**：
- 装 `ansi_up` 或 `anser`，把 stdout 转成 HTML span
- 在 tool_result 渲染时检测 ANSI 模式开启色彩
- ~30 行代码

---

## 中价值

### P1. Git Worktree 隔离并行对话
灵感来自 [Paseo](https://paseo.sh)。当前多对话共享同一 cwd，并行跑两个 Claude 会互相踩文件。Worktree 方案：每开一个新对话，自动 `git worktree add` 到临时目录（单独分支），会话结束后可选合并/丢弃。

**实现**：
- 后端 `cli-runner.ts`：新建对话时检测 git repo，若启用 worktree 模式则 `git worktree add .claude-worktrees/<convId> -b wt/<convId>` 并以该目录为 cwd 启动 claude
- `session_ended` 时弹确认：[保留分支 / 合并到 main / 丢弃]
- iOS / Web UI：对话列表显示分支名；抽屉里可点"查看 diff"跳到 git diff 视图
- 后端 `/api/worktrees` CRUD

**为什么值得**：并行做两个功能、做完再合并——这才是真正的 parallel agent 工作流。当前方式两个 Claude 同时 Edit 同一文件会产生冲突。

**风险**：worktree 数量多了磁盘压力；浅克隆仓库 worktree 支持有限。可设"仅在有未修改工作区时自动创建"保守策略。

---

### P2. GitHub 深度集成
灵感来自 Paseo sidebar 的 PR / issue 面板。把 GitHub issue 或 PR 的描述 + diff 一键注入成对话上下文。

**实现**：
- 后端 `/api/github/issue?repo=&number=` → 调 GitHub REST API（用 `~/.config/gh/hosts.yml` 里的 token，或让用户配 `GITHUB_TOKEN`）
- 返回 issue body + comments 摘要
- iOS：输入框旁加"附加 GitHub issue/PR"按钮，弹 sheet 输入 URL 或 `#123`
- Web：@mention 里加 `@gh:123` 语法
- 进阶：sidebar 显示当前 cwd 仓库的 open PR 列表 + CI check 状态（用 `gh pr list --json`，不必自己调 API）

**为什么值得**：实际工作流中，经常是"看着 issue #47 写代码"，现在要手动复制粘贴。直接注入省掉这步。

**为什么不优先**：需要有 GitHub remote 的 repo 才有用；纯本地项目无效。等 worktree 和主流程稳了再做。

---

### P3. 内置加密中继（不依赖 Tailscale）
灵感来自 Paseo 的 E2E encrypted relay。我们当前靠 Tailscale expose :3030，对没有 Tailscale 的机器或他人分享场景不友好。

**方案**：
- 后端启动时可选接入一个中继服务（自建或用 `relay.example.com`）
- 客户端与中继之间走 WebSocket over TLS，端对端加密（类 Paseo 用 libsodium box）
- 中继只转发加密字节，无法读取内容
- 可自建（一台 VPS + 几十行 relay server）或用 Cloudflare Tunnel 替代（零代码，已有）

**当前替代**：Tailscale serve 已很好。这个留到"想分享给别人用但不想给 Tailscale 权限"时再做。

---

### P4. Per-project 启动脚本
灵感来自 Paseo 的 `paseo.json`。项目下放一个 `.claude-web.json`，定义随项目打开时自动跑的 dev server 或后台任务。

**示例**：
```json
{ "services": [{ "name": "dev", "cmd": "pnpm dev:frontend", "port": 5173 }] }
```

**实现**：
- 后端 ProjectsAPI 在 `openByPath` 时读 `<cwd>/.claude-web.json`
- `services` 里的命令 spawn 为后台进程，stdout 可从 `/api/projects/:id/services/:name/logs` 拉取
- iOS：项目卡片上显示服务状态小圆点

**为什么值得**：开一个新项目每次都要手动 `pnpm dev:frontend`，能自动启更顺。

**为什么不优先**：手动开 terminal 目前不是痛点；等有多项目频繁切换场景再做。

---

### 5. `--add-dir` 多目录支持
项目可能依赖隔壁目录（monorepo 兄弟包、共享配置）。Claude 需要能 Read 这些目录。

**实现**：
- Project 结构加 `extraDirs: string[]`
- ProjectPicker 添加目录时多一个"额外可读目录"区
- cli-runner spawn 时按 `--add-dir <path>` 重复传

---

### 6. 工具结果摘要 / 智能折叠改进
当前折叠是按行/字符阈值，简单粗暴。`grep` 几百行结果折叠后看不到关键。

**实现**：
- Bash 类工具结果优先按 line 折叠头/尾各 5 行
- 长 Read 结果显示文件 size + 总行数，"展开"按需
- 错误结果（is_error=true）默认完全展开

---

### 7. 动态 slash 命令
当前 [InputBox.tsx](packages/frontend/src/components/InputBox.tsx) 里的 SLASH_COMMANDS 是硬编码 5 个。CLI 在 system:init 事件里给了完整列表（看 system 消息的 `slash_commands` 字段）。

**实现**：
- Store 记录最新 system:init 的 slash_commands
- InputBox 用动态列表替代常量
- 用 desc 字段从 CLI 拿（CLI 有的话）

---

### 8. MCP 服务器列表管理
CLI 通过 `--mcp-config` 加载 MCP server。手机 PWA 上能看到/启停就更完整。

**实现**：
- 后端 `/api/mcp/list` 列出 user 级 MCP 配置
- 前端右侧 panel 多一个 MCP tab
- 切换开关 = 写 `~/.claude/mcp_servers.json`

**为什么不优先**：你目前没装 MCP server。

---

### 11. 同步多端信息展示
多设备协同：手机 PWA 看到桌面那边正在跑的 session，桌面看到手机刚发的 prompt，状态实时同步。

**实现**：
- 后端在 WebSocket 上多一条"广播"频道：每个 connection 订阅相同 cwd → 收到同一组 sdk_message + session_ended + permission_request
- store 已经按 cwd keyed（`byCwd`），消息合流到现有结构即可
- **协议字段**：`fs_subscribe` 风格，加 `session_subscribe { cwd }`、`session_unsubscribe`，server 用 `Set<send>` per cwd 广播
- 注意权限弹窗：同一个 permission_request 多端都收到，谁先回先生效，其它端要 dismiss
- 输入框：本地 draft 不同步（每端各自起草），按下发送才进 broadcast
- voice draft / live transcript：同步到只读模式，桌面看手机正说话

**风险**：
- permission 竞态：两端同时点 allow/deny → backend 已经 first-wins，UI 要 graceful 收尾
- 历史回溯：新连上的 client 需要 replay 已发生的 messages → 现有 jsonl transcript 加载逻辑可复用，加 since-cursor 增量

**为什么不优先**：单人用，目前一次只在一个设备上操作。等真有"在地铁上接着电脑活儿"的场景再做。

---

### 12. Cursor CLI 评审 MCP
把 `cursor-agent`（Cursor 的命令行）包成一个 MCP server，让 Claude 在写完代码后能主动调它做"第二眼"评审。本质是双 AI 互审。

**实现**：
- 写一个本地 MCP server（stdio）：暴露 `cursor_review { paths, context }` 工具
- 内部 spawn `cursor-agent --headless --prompt "review these changes for bugs / smells / missing tests"`，参数限制 cwd + paths
- 注册到 `~/.claude/mcp_servers.json`，user 级 MCP
- 触发：Claude 自己决定（"我写完了，需要 review"），或加 slash command `/cursor-review`

**用例**：
- "implement X then ask cursor to review" → Claude 写完 → Edit → 调 cursor_review → 拿到回复 → 决定是否再改
- 跨模型 sanity check（Claude 写、Cursor 用 GPT/Gemini 看）

**风险**：
- Cursor CLI 计费独立，需要单独订阅
- 双 AI 互审有时会陷入"互相找事"的低价值循环，需要 prompt 控制

**为什么不优先**：先验证下 cursor-agent CLI 的 review 输出质量，单独 spike 1 小时再决定。和上面的 #8 MCP 服务器列表管理（idea）有协同 — 那个先做了这个就更易接入。

---

### 13. 原生 macOS 桌面端 + VS Code / Cursor 工作台
做一个原生 macOS 桌面端，定位不是替代 Cursor / VS Code，而是成为 Claude CLI、Cursor CLI、项目状态和代码编辑器之间的"协作工作台"。参考 Claude Code 桌面版的方向：保留 CLI 订阅认证和本地项目上下文，但用原生窗口把多会话、工具权限、历史、语音、评审和编辑器联动做得更顺。

**核心想法**：
- 原生 macOS app 管理项目、会话、历史、权限、语音和通知
- VS Code / Cursor 继续负责代码编辑；桌面端通过 URL scheme / CLI / extension 打开具体文件、diff、问题位置
- Claude CLI 继续作为主执行引擎：`claude --print --input-format=stream-json --output-format=stream-json`
- Cursor CLI 作为可选第二引擎：用于代码评审、补充分析、对 Claude 的结果做 sanity check
- 两边通过 MCP / 本地 IPC 互通：Claude 可以调 Cursor review；Cursor 也可以请求 Claude 总结、规划或继续执行

**可能能力**：
- 一键从会话打开 VS Code / Cursor 到对应 cwd
- 工具调用卡片里点文件路径 → 编辑器跳转到文件/行
- Claude 写完代码 → 自动调用 Cursor CLI 评审 → 把评审结果回灌到同一会话
- Cursor CLI 发现问题 → 生成可执行 prompt 交给 Claude CLI 继续改
- 原生通知：回答完成、权限请求、长任务结束、测试失败
- 多窗口：一个项目一个窗口，或一个窗口里多 project / conversation
- 和 iOS app 共享同一套 backend：Mac 桌面端、Web、iOS 都读同一份 jsonl / projects.json

**实现路线**：
- v0 spike：macOS SwiftUI shell，只连现有 backend，显示项目/会话/消息
- v1：注册 URL scheme，支持 `vscode://file/...` / `cursor://file/...` 跳转
- v2：接入 `cursor-agent` CLI，先做手动"用 Cursor 评审当前 diff"
- v3：MCP 化，让 Claude 在合适时机主动调用 Cursor 评审工具
- v4：做 VS Code / Cursor extension，把编辑器里的选区、文件、诊断传回桌面端

**风险**：
- 容易变成"再造一个 IDE"，范围必须压住：编辑仍交给 VS Code / Cursor
- Cursor CLI 的稳定性、计费、headless 能力要先 spike
- Claude 与 Cursor 双 AI 互通如果没有边界，会产生重复建议和低价值循环
- macOS 原生端、iOS 原生端、Web 三端状态同步要避免重复造协议

**为什么不优先**：当前 iOS 端还在补齐日常使用能力。macOS 原生端适合等 iOS + backend 的 project/conversation/state 模型稳定后再做；否则会把尚未定型的状态管理复制到第四个入口。

---

### 9. 自动 /compact 触发器
现在用量到 100k 是给"开新会话"按钮。更激进：自动后台跑一次 `/compact`，保留 sessionId 但压缩历史。

**风险**：`/compact` 是 TUI slash command，stream-json 模式下不一定生效。需先实测。

**备选**：在 user_prompt 前缀加 `请先用一段话总结到此为止的对话；然后回答：` —— 半手动 compact。

---

### 9. 声纹识别（只响应主人声音）

公共场合 / 家人附近用 PWA 时，过滤掉非主人的声音。

**方案**：
- 一次性录入：浏览器录 15-30s 用户声音 → 后端用 Resemblyzer / SpeechBrain ECAPA-TDNN 算 192 维 embedding → 存 `~/.claude-web/voiceprint.npy`
- 每次 transcribe 前：算 incoming embedding，余弦相似度 vs 主人 embedding，> 0.6 通过，否则拒绝
- 前端：设置区加"声纹识别" section + "仅响应我的声音"开关；拒绝时输入框上方红条提示

**技术选型**：Resemblyzer（6MB 模型，PyTorch，~50ms/次推理）

**风险**：
- PyTorch 当前需 Python 3.12（用户机器是 3.14，需专装）
- PyTorch 包 ~800MB
- 感冒/噪音环境下可能拒绝主人，需"绕过一次"按钮
- 训练时间 ~2-3 小时

**未实现的原因**：低优先级（个人 Tailscale + token 已经做了边界），等真有公共场合误触发再做。

### 10. 唤醒词（"Hey Claude"）

iOS 后台持续 mic 监听技术上可行（Web Audio + 简单能量检测 / TFlite 模型），但：
- iOS PWA 在锁屏/切后台后会停 mic
- 持续监听耗电
- Picovoice Porcupine 商业授权要钱

**实现量**: ~6 小时。优先级低，对话模式（已实现）已覆盖大部分场景。

## 低价值 / 暂不做

### 10. Tauri / Capacitor 包成 native app
不解决核心问题（Mac 在线 + 网络），只换个壳子。除非：
- iOS 推送通知（tool 完成时震一下）
- 后台音频（屏幕锁住继续说话）

这两个真有需求时再考虑。

### 11. 服务器迁移到云
目前完全依赖 Mac 在线。改成 ¥3/月 VPS + claude CLI 装那上面 + auth login。彻底脱离 Mac，但 Claude 订阅每个账号只能在一台机上用，要权衡。

### 12. 多用户协作
共享 session、看别人在干啥。和"个人工具"定位冲突，不做。

### 13. 任务调度（cron 风格）
每天 9 点让 Claude 跑某个 prompt。CLI 已经有 schedule skill，借力就行，UI 不必专门做。

---

## iOS App v2 候选功能（F 待选）

> v1 (M1-M4.5) 完成后的下一批工作。**A = web 已有但 iOS 还没有的功能**（移植
> 价值高，桌面用过的肌肉记忆能直接搬过来）；**B = 全新功能**（提过没做）。
> 选哪几个做、什么顺序由用户拍。每个估时是粗估，只看代码量不算调试。

### A — 从 web 移植到 iOS 原生

#### A1. 历史会话浏览（jsonl 解析）⭐⭐⭐ ✅ 完成
F1c3 已实现：[SessionsAPI](packages/ios-native/Sources/ClaudeWeb/SessionsAPI.swift) (list / transcript) + [TranscriptParser](packages/ios-native/Sources/ClaudeWeb/TranscriptParser.swift) + [`ProjectRegistry.openHistoricalSession()`](packages/ios-native/Sources/ClaudeWeb/ProjectRegistry.swift) 的 dedup 加载逻辑。
UI 部分：[DrawerContent.swift](packages/ios-native/Sources/ClaudeWeb/Views/Drawer/DrawerContent.swift) 项目展开时懒加载历史会话；[HistorySessionRow.swift](packages/ios-native/Sources/ClaudeWeb/Views/Drawer/HistorySessionRow.swift) 处理加载和切换。已于 commit dad7297 实现。

#### A2. 项目列表 + 快速切换 ⭐⭐⭐ ✅ 完成 (F1c2 + F1c3)
做法跟初稿不同：升级到**项目-对话两级**模型，不只是切 cwd。
- 服务器 `~/.claude-web/projects.json` 是项目注册表（跨设备）
- iOS [ProjectRegistry](packages/ios-native/Sources/ClaudeWeb/ProjectRegistry.swift) 镜像 + 缓存
- 顶部 chip 点击进切换器；按 cwd 分组（F1c4 升级成抽屉 UX）
- 多对话并行不打断；每对话独立 sessionId / TTS cache

#### A3. @file 自动补全 ⭐⭐ ✅ 完成
输入 `@` 弹文件选择 sheet（fuzzy 搜索当前 cwd）。实现：[InputBar.swift](packages/ios-native/Sources/ClaudeWeb/Views/Chat/InputBar.swift) 检测 `@`；[AtFilePicker.swift](packages/ios-native/Sources/ClaudeWeb/Views/Chat/AtFilePicker.swift) 目录浏览 + 模糊过滤。已于 commit d0f1a1f 实现。

#### A4. / 命令面板（动态 slash） ⭐⭐
从 system:init.slash_commands 拉 CLI 实际可用命令（包括 skills），输入 `/` 弹列表。**跟 web 行为一致**。
- **工时**: 半天

#### A5. ↑ 历史 prompt 回溯 ⭐⭐
重发上一句 / 上 5 句。手机 textfield 有这个比再录一次更快。
- **工时**: 半天

#### A6. 工具卡片渲染（TodoWrite / Edit diff / Bash / Read）⭐⭐⭐ ✅ 完成
所有工具卡片已实现于 [ToolCards.swift](packages/ios-native/Sources/ClaudeWeb/ToolCards.swift)：
- BashCard：命令等宽显示 + description
- EditCard：红/绿 diff block（old_string / new_string）
- WriteCard：内容预览 + 字符数统计
- ReadCard：文件路径 + offset/limit 范围
- TodoWriteCard：复选框列表 + 状态图标（✓/⏳/○）
- GrepCard, GlobCard, GenericToolCard（JSON 回退）

所有卡片使用 CardShell（可折叠）设计，tap header 展开/收起。

#### A7. Markdown 完整渲染 ⭐⭐ ✅ 完成
`.assistant` 消息使用 `Markdown(line.text).markdownTheme(.gitHub)` 渲染（[ChatListView.swift](packages/ios-native/Sources/ClaudeWeb/Views/Chat/ChatListView.swift) line 61）。依赖 [swift-markdown-ui 2.4.1](https://github.com/gonzalezreal/swift-markdown-ui)，支持：
- 标题、列表、链接、表格、代码块
- 文本选择已启用（.textSelection(.enabled)）

#### A8. /clear 和 /usage 本地短路 ⭐
- /clear = 清当前 view（不发给 Claude）
- /usage = 弹本会话 token / cost 数据
- **工时**: 半天

#### A9. 图片粘贴 / 拖拽进 prompt ⭐⭐
iOS 自带 PhotoPicker，手机端实际可用度比想象的高（截屏发给 Claude 看）。
- attachments 走现成的 `ImageAttachment` 协议
- **工时**: 1 天

#### A10. 多项目并行 run ⭐ ✅ 完成 (F1c2)
F1c2 升级了模型 —— 多对话并行（同 cwd 或不同 cwd 都行）。runId → conversationId 路由表保证消息不串；切对话不打断后台 turn；顶部 Seaidea 标题旁 badge 显示全局活跃数。

#### A11. 工具结果智能折叠 ⭐
长 stdout 默认折叠，长按展开。
- **工时**: 半天

#### A12. 状态栏（model + cwd + tokens + cost）⭐
现在 iOS 顶部只有连接圆点 + cwd。补上 model / 累积用量 / 费用。
- **工时**: 半天

---

### B — 全新功能

#### B1. APNs 推送通知 ⭐⭐⭐
Claude tool 完成 / 收到回答时手机震一下。需要：
- Apple Developer 账号 + APNs cert
- 后端发 push（node-apns）
- iOS 注册 device token
- **工时**: 1-2 天 + Apple 配置半天

#### B2. 同步多端信息展示 ⭐⭐
桌面 + 手机看同一 session 实时同步。本质 = WS 多客户端 broadcast。已经在 IDEAS 第 11 项。
- **工时**: 2-3 天

#### B3. Cursor CLI 评审 MCP ⭐
让 Claude 写完代码主动调 cursor-agent 二审。已经在 IDEAS 第 12 项。
- **工时**: 1-2 天

#### B4. 声纹识别（只响应主人声音）⭐
公共场合用 PTT 时过滤掉别人的声音。已经在 IDEAS 第 9 项 (老条目)。
- **工时**: 6 小时

#### B5. Live Activities / 灵动岛 ⭐⭐
Claude 思考状态 / TTS 播报显示在锁屏 / 灵动岛。**真正能做到锁屏稳定显示** 的唯一正路（避开 Now Playing 那条 dead end）。
- **工时**: 2-3 天 + iOS 16+ 适配

#### B6. AirPods Pro 长按柄 PTT
评审已确认 Apple 不开放给私人 app，**不做**。

---

### iOS App v2 候选（竞品借鉴，新增）

#### A13. 代码块复制按钮 ⭐⭐⭐
每个 assistant 回复的代码块右上角加 "Copy" 按钮，点击复制代码到剪贴板。MarkdownUI `codeBlock` 修饰符实现，失败显示红 ×，成功短暂显示绿 ✓。所有主流 AI app（ChatGPT / Claude Web / GitHub Copilot）均有此标配，手机用户长按选文极难用。
- **工时**: 1 小时
- **竞品参考**: ChatGPT iOS、Claude Web、GitHub Copilot Mobile

#### A14. 信息密度切换（Verbose / Normal） ⭐⭐
Settings 加 Toggle "详细模式"，控制工具调用展示粒度：
- Verbose=false（默认）：工具卡片 (ToolUse/ToolResult) 默认折叠，仅显示标题行
- Verbose=true：全部展开，行为与现在相同
- 对标 Claude Code 桌面 Verbose 模式（2026年4月重设计）
- **工时**: 1 小时（跟 A11 一起做）
- **竞品参考**: Claude Code 桌面版 Verbose/Normal/Summary 三档

#### A15. "始终显示思考" 持久开关 ⭐⭐
Settings 加 Toggle，控制 thinking block 默认展开/折叠。当前 thinking 块支持点击折叠，但每次重启都重置为折叠状态。此开关持久化用户偏好，提升体验。
- **工时**: 30 分钟
- **社区需求**: Claude Code Issue #8477 强烈反馈，开发者需要"始终看到思考过程"的选项

#### A16. 会话搜索（SearchField） ⭐⭐
抽屉顶部加 SearchField，全文匹配项目名、会话标题、历史 preview 文字，快速定位历史对话。长期用户的高频需求。
- **工时**: 1 小时
- **竞品参考**: ChatGPT iOS 左侧栏搜索

#### A17. 会话分支 (Branch in new chat) ⭐⭐
长按助手消息弹 contextMenu，选"在新对话中继续"，创建新会话并预填当前消息作为起点。分离话题，不污染主流。
- **工时**: 1 天
- **竞品参考**: ChatGPT iOS 右滑消息的"分支"功能

---

## 已完成（参考）

详见 git log，主要里程碑：
- Phase 1-6: CLI subprocess、PWA、语音、文件树、Git、多项目并行
- Phase 7: per-tool permission via PreToolUse hook
- Phase 8: remote STT (Mac whisper) + edge-tts
- 安全: token + ALLOWED_ROOTS
- 性能: gzip + immutable cache + 懒加载 + 拆 chunk
- UX: tabs、history sessions、@file、TodoWrite UI、diff view、status bar、UsageMeter
- 自动化: 默认 Haiku、本项目永久 allow、CLAUDE.md banner、智能整理跳过
