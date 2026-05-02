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

### 1. 图片粘贴 / 拖拽（多模态输入）✅ 完成
- **协议**：[ImageAttachment](packages/shared/src/protocol.ts) 字段在 user_prompt 上，多模态 fixture 见 `packages/shared/fixtures/protocol/client-user-prompt-with-attachment.json`。
- **后端**：[cli-runner.ts](packages/backend/src/cli-runner.ts) 把 attachments 转为 `[{type:"text"},{type:"image",source:{type:"base64",...}}]` content array 写入 stream-json stdin。
- **Web 前端**：[InputBox.tsx](packages/frontend/src/components/InputBox.tsx) 的 `onPaste` / `onDrop` 捕获 image blobs，输入框上方显示缩略图，可删除。
- **iOS 原生**：[InputBar.swift](packages/ios-native/Sources/ClaudeWeb/Views/Chat/InputBar.swift) 用 PhotosPicker（最多 5 张），>1MB 自动 JPEG 压缩，pendingImages 缩略图行可删除。
- 仍未做：iOS 端 UIPasteboard 直接粘贴（需要单独按钮）、iPad 端 dragDestination。优先级低，PhotoPicker 已够用。

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

**B 级备选（首选，不引入新工具）**：**Tailscale Funnel** 是同栈、同账号、零代码的"开闸放公网"按钮——`tailscale funnel 3030` 即可把 backend 暴露在 `*.ts.net` 公网 https URL，自动签证书。需要时启用：GitHub webhook 调入 / 非 tailnet 朋友临时演示 / 外部 Agent 触发。**不要切到 tunwg / ngrok / Cloudflare Tunnel**——它们只是把 Tailscale 已有功能再造一遍，且会把"私网默认安全"变成"公网默认暴露"，需要重新审计所有 route 的鉴权（参考 2026-05-01 tunwg 评估）。

**评估归档（2026-05-01）**：tunwg vs Tailscale 详细对比：tunwg 给的是公网 URL（cert transparency log 会扫到子域名），适合 hapi 那种面向大众散户的产品；claude-web 是个人单用户场景，Tailscale 私网边界 + `CLAUDE_WEB_TOKEN` 双重保护已足够。切 tunwg 等于把 `/api/fs/tree`、`/api/git/diff` 这些信任 tailnet 边界的 endpoint 重新暴露到公网，必须先全路由加强鉴权——成本远高于收益。

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

---

### B-uitest. iOS UI 自动化测试基础设施 ⭐⭐

**痛点**：当前 ios-e2e-test skill 只能做 launch + WS probe + 截图。真正的 UI 交互（长按、tap、上滑、文字选择验证）做不到——cliclick / AppleScript 都需要 macOS 辅助功能权限，但 claude CLI 二进制路径含版本号（`/Users/yongqian/.local/share/claude/versions/2.1.123`），每次 claude 升级权限就失效。给一次还能撑一阵，长期不可维护。

**方案 A（首选，长期）：XCUITest**
- 在 `packages/ios-native/` 加 `ClaudeWebUITests` target（project.yml ~10 行 yaml）
- 写 swift test 文件，用 `XCUIApplication()` + `app.staticTexts.firstMatch.press(forDuration: 1.0)` 等 API
- `xcodebuild test -scheme ClaudeWebUITests -destination 'platform=iOS Simulator,id=...'`
- 跑在模拟器内部，**完全不依赖 macOS accessibility**
- 工作量：初次 ~1-2 小时（target + 第一个测试 + skill 集成）；之后每个新 UI 测试 ~15 分钟
- 集成到 ios-e2e-test skill 作为 Phase 5b：模拟器装机后自动跑 UI 测试，真机部署前必须过

**方案 B（短期 hack，已尝试放弃）**：cliclick + 给 claude CLI 加 accessibility 权限
- 失败原因：claude 二进制路径含版本号，每次升级失效；且依赖系统权限对自动化不友好

**方案 C（备选，零工程化）**：手动验证
- 我装机后告诉用户具体怎么验证（"在 X 消息上长按"），用户在 Xcode 模拟器手动操作
- 短期可用，长期不可扩展

**触发条件**：当 iOS UI 改动累积到第 3-4 次想做自动验证时启动方案 A。当前 skill 文档里写明这个限制，每次 iOS UI 改动后落地为方案 C（手动验证清单）。

**为什么不立即做**：方案 A 是工程化投资，需要权衡是否值得现在做；用户可以决定推迟。

---

### B-voice-cancel. 录音上滑取消 ⭐⭐⭐

> 详见对话规划——参考微信 / Telegram 长按麦克风录音 + 上滑取消的交互。

**待规划**：本条目写入后立即做实现规划。

---

### B-help. 端内 Help 页（iOS + Web）+ 自动同步 ⭐⭐

**痛点**：随着功能越加越多（Inbox / 长按强制中止 / Mac 心跳 / TTS 风格 / @file / git gate / 语音模式 / Skill 队列…），用户记不住所有快捷操作。打开 [docs/USER_MANUAL.md](USER_MANUAL.md) 查太重；尤其手机端不方便。

**方案**：端内"Help"页，从 `docs/USER_MANUAL.md` 自动渲染。
- iOS：SettingsView 加"使用手册"行 → push 到 `HelpView`，里面用 MarkdownUI（已有依赖）渲染 USER_MANUAL.md 的内容
- Web：右上角加 "?" 图标 → 弹同源内容
- 内容源：**single source of truth = `docs/USER_MANUAL.md`**。后端加 `GET /api/help` 端点直接返回该文件 raw markdown
- 这样手册更新（用 `update-manual` skill 已有自动化）= Help 页自动跟新，**不需要手动改 SwiftUI / React**

**同步保证**：
- `update-manual` skill 已经在 `feat:` commit 后自动跑 → 它会保证 USER_MANUAL.md 永远反映现状
- Help 页运行时拉远端 markdown，所以不需要重新发 iOS 版本就能看到新功能说明
- iOS 离线时回退到上次缓存的 markdown

**为什么是 ⭐⭐ 而不是 ⭐⭐⭐**：USER_MANUAL.md 已经存在且维护良好，Help 页只是另一个观察 surface，价值是"降低查阅摩擦"而不是"新能力"。但实现量极小（~150 行 Swift + ~80 行 backend route + 0 行新依赖，MarkdownUI 已在 project.yml）。

**实现要点**：
- `packages/backend/src/routes/help.ts`：`GET /api/help` 直接 fs.readFile + 返回 markdown
- `packages/ios-native/Sources/ClaudeWeb/Views/HelpView.swift`：MarkdownUI 渲染 + 24 小时缓存
- `packages/frontend/src/components/HelpDrawer.tsx`：复用现有 markdown renderer（看 MessageItem.tsx 是不是已有）
- 维护规则：Help 页自动从 USER_MANUAL.md 取，不需要单独同步——但**新功能文档化是 update-manual skill 的责任**。这条规则已在 [CLAUDE.md "Maintenance reflex"](../CLAUDE.md) 段。

**风险**：USER_MANUAL.md 如果格式过乱（嵌套表格、特殊字符）SwiftUI MarkdownUI 渲染可能跑挂。缓解：HelpView 加 try/catch，渲染失败降级显示 raw text + "在浏览器打开" 链接。

## 低价值 / 暂不做

### 10. Tauri / Capacitor 包成 native app
不解决核心问题（Mac 在线 + 网络），只换个壳子。除非：
- iOS 推送通知（tool 完成时震一下）
- 后台音频（屏幕锁住继续说话）

这两个真有需求时再考虑。

### 11. 服务器迁移到云
目前完全依赖 Mac 在线。改成 ¥3/月 VPS + claude CLI 装那上面 + auth login。彻底脱离 Mac，但 Claude 订阅每个账号只能在一台机上用，要权衡。

### 12. 多用户协作（重新评估，详见下方"团队协作方向调研"）
原本判定"和个人工具定位冲突，不做"。2026-04-30 用户重新提出 5-10 人小团队场景，
做了一轮开源方案调研，结论是：**有最小阻力路径**（claude-relay-service 风格的 OAuth pool +
内部 token），值得保留为 P2 候选。详见文末"## 团队协作方向调研（2026-04-30）"。

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

#### B7. TTS 真流式（后端 chunked + iOS AVPlayer）⭐⭐⭐
2026-04 调研结论：现在的句子级并行（[`splitSentencesForTTS`](packages/ios-native/Sources/ClaudeWeb/TTSPlayer.swift)）是业界标准模式（Cloudflare / Deepgram / 所有 voice agent 都这么做），但首音仍然 ~6s，因为：
1. **后端 `Buffer.concat(chunks)` 等 mp3 全部出来才返回**——edge-tts 自身是流式的（WebSocket 推 chunks），白白浪费 3-5s。
2. **iOS `AVAudioPlayer` 只能播完整 Data**——无法边收边播。
3. **每句话都 spawn edge-tts 子进程**——冷启动 + 握手 ~500ms × N 句。

**改造**：
- 后端把 edge-tts stdout 直接 pipe 到 HTTP response（chunked transfer-encoding）。或换成 Node 包 `edge-tts-universal` 的 `Communicate.stream()` 异步迭代器，逐 chunk 推。
- 持久 edge-tts WebSocket 池：连一次 Microsoft，复用给后续句子，省掉冷启动。
- iOS 用 `AVPlayer(url:)` 替换 `AVAudioPlayer`，原生支持 HTTP chunked mp3 流式播放。
- Cache（每对话最后一段 mp3）、replay、pause/resume、cancel 全部围绕 AVPlayer 重写。

**收益**：首音 ~6s → ~1-2s（每句话 mp3 第一个 chunk 在 ~500ms 内到达，AVPlayer 立即开播）。
**成本**：~1-2 天，主要是 iOS 端 TTSPlayer 的 cache/replay/pause 逻辑要围绕 AVPlayer + AVPlayerItem 重做。

**为什么不优先**：当前 ~3-5s 首音（120 字阈值跳过 Haiku 的短答案）已经可用。这条等真有"首音必须 sub-second"的体验诉求时再做。Claude Code 桌面版给人感觉快是因为他们用了 OpenAI tts-1 流式（HTTP chunked 原生支持），不是 Microsoft Edge TTS。

**参考**：
- [Time to First Audio · Gradium](https://gradium.ai/blog/time-to-first-audio)
- [Text Chunking for TTS · Deepgram](https://developers.deepgram.com/docs/tts-text-chunking)
- [edge-tts streaming artifacts · issue #187](https://github.com/rany2/edge-tts/issues/187)（chunk 边界 mp3 解码可能有 tiny gaps，要注意）

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

## Claude CLI Harness 候选（2026-04 调研）

> 定位：`claude-web` 不重新实现 agent。真正的 agent 仍是 `claude` CLI；`claude-web` 要做的是更好的 harness：把权限、安全、上下文、会话、通知、移动端控制、Git/PR 工作流和可观察性包起来。
>
> 调研参考：Claude Code docs（permissions / settings / hooks / MCP / resume）、Aider（git 自动提交、architect/ask/code modes、/test /lint /undo /voice）、OpenCode（TUI sessions、permissions、MCP、GitHub agent）、Goose（CLI/Desktop/API、SQLite session、MCP extensions、memory/todo/chat recall）、Continue（@context providers、MCP）、Cursor Bugbot/Background Agents（PR review、后台任务、规则）、Paseo（移动端、worktree、E2E relay）。

### H1. Harness 状态总览 / Run Dashboard ⭐⭐⭐ ✅ iOS v1 完成
点 toolbar 橙色 activeRunCount badge → [RunsDashboardSheet](packages/ios-native/Sources/ClaudeWeb/Views/RunsDashboardSheet.swift)：进行中的对话排前，每行显示标题 + cwd basename + 最近一次 toolUse 名 + 输入预览 + 实时 elapsed timer。点行切焦点；点"停止"红丸调 `client.interrupt(convId:)` 中断后台 run 不切焦点。
**v1 范围**：单客户端从 `stateByConversation` 生成 dashboard，没新增 backend 路由。`runStartedAt` 存在 ConversationChatState。
**未做**：跨客户端广播（`/api/runs` 或 WS `run_status`），web 端 Runs tab。这俩等真出现"iOS + 桌面同看一份"场景再补。

### H2. 权限策略编辑器 / Permission Rules UI ⭐⭐⭐
灵感来自 Claude Code `/permissions`、OpenCode allow/ask/deny 规则。

**可借鉴点**：
- 当前已有 PreToolUse hook 和 permission sheet，但规则主要靠 CLI / settings。
- 做成 UI：按项目配置 `allow / ask / deny`，支持工具名、Bash 命令前缀、路径范围。
- 显示"为什么这次要问我"：命中了哪条规则、工具名、cwd、runId。

**适用性**：
- 用户价值：5
- 架构贴合：4，现有 permission route 可扩展
- 实现复杂度：3
- 风险：4，安全功能不能做错；deny 必须优先于 allow
- 优先级：P1

**实现草案**：
- 先做只读规则查看：读取 Claude settings / project settings 中的 permission 配置。
- 第二步做本项目 `.claude/settings.local.json` 的可视化编辑。
- permission sheet 展示规则来源：user / project / local / runtime。

### H3. Hook 可视化与安全审计 ⭐⭐
灵感来自 Claude Code hooks：PreToolUse、PostToolUse、Notification、Stop。

**可借鉴点**：
- Claude Code hooks 能在工具执行前后跑脚本。对 harness 来说，关键不是再造 hooks，而是让用户知道 hooks 在做什么。
- UI 列出当前项目启用的 hooks、触发次数、最近输出、失败原因。
- 高风险 hook 警告：会修改文件、会执行 shell、来源于 project settings。

**适用性**：
- 用户价值：4
- 架构贴合：4
- 实现复杂度：3
- 风险：3，读取/展示为主风险低，编辑风险高
- 优先级：P2

**实现草案**：
- `/api/claude/settings` 只读解析 user/project/local settings。
- iOS 设置页加"Hooks"调试入口。
- Stop / Notification hook 可以接到 iOS 本地通知或 APNs，作为 B1 推送的低成本前置版本。

### H4. Context Attachment 面板 ⭐⭐⭐ ✅ iOS v1 完成（git diff + 剪贴板）
[ContextAttachSheet](packages/ios-native/Sources/ClaudeWeb/Views/ContextAttachSheet.swift) 从 InputBar 的 paperclip 按钮打开。v1 两源：
- **当前 git diff**：[/api/context/git-diff](packages/backend/src/routes/context.ts) 跑 `git diff HEAD`，capped 200KB。注入为 `<git_diff cwd="…">…```diff…```</git_diff>`
- **剪贴板文本**：注入为 `<clipboard>…</clipboard>`

注入策略：直接拼到 draft（用户可见、可改、可删），不走单独的 attachment 协议。
**未做**：URL 抓取、GitHub issue/PR、终端输出。这些插槽在 sheet 里加 row + ContextAPI 加方法即可。

### H5. Git Safety Gate / 变更出门前检查 ⭐⭐⭐ ✅ iOS v1 完成
[GitGateSheet](packages/ios-native/Sources/ClaudeWeb/Views/GitGateSheet.swift) 在 `sessionEnded(reason: completed)` 之后弹出（仅当 cwd 是 git repo 且 dirty）：分支 + ahead/behind + 已暂存 / 已修改 / 未跟踪三段。"复制变更摘要"按钮把状态码 + 文件路径写到剪贴板。Settings 加 `gitGateEnabled` toggle（默认 ON）。
**v1 范围**：复用 `/api/git/status`，新加 [GitAPI client](packages/ios-native/Sources/ClaudeWeb/GitAPI.swift) + ConversationChatState.pendingGitGate（per-conversation，与 pendingPermission 同模式）。
**未做**：跑测试 / lint / 自动检测 secrets / 接 Cursor 二审。"建议测试命令"和"上次测试结果"也没做——那一档要 backend 加更多端点。

### H6. Session Replay / 可复现运行包 ⭐⭐
灵感来自 OpenCode/Goose 的 session 管理、Claude Code resume。

**可借鉴点**：
- 当前能读 jsonl 历史，但缺少"这次 run 当时到底带了哪些参数"。
- 保存可复现元数据：cwd、model、permissionMode、resume sessionId、prompt、附件摘要、环境变量白名单、Claude CLI 版本。
- 出错时一键生成 bug report 或重新跑。

**适用性**：
- 用户价值：4
- 架构贴合：5，runId 已经存在
- 实现复杂度：2
- 风险：3，注意不要记录 token / secrets
- 优先级：P2

**实现草案**：
- backend 在启动 run 前写 `~/.claude-web/runs/<runId>.json`。
- iOS/Web 历史里加"运行详情"。
- 出错时可复制一段脱敏诊断信息。

### H7. Worktree Task Launcher ⭐⭐⭐
灵感来自 Paseo worktree、Cursor Background Agents。

**可借鉴点**：
- 当前已有 Worktree 隔离并行对话 idea；这里补一个更产品化的入口。
- 用户选择任务类型："修 bug / 做功能 / 写测试 / 重构"，harness 自动创建 worktree、命名分支、启动 Claude、跑检查、最后给 merge/丢弃选项。

**适用性**：
- 用户价值：5
- 架构贴合：4
- 实现复杂度：4
- 风险：4，分支/冲突/磁盘清理要稳
- 优先级：P1/P2

**实现草案**：
- 在 P1 Worktree 隔离基础上加模板化 launcher。
- 默认只在 clean working tree 自动创建；dirty 时要求用户确认。
- 完成后生成"变更包"：diff + 测试结果 + Claude summary。

### H8. 移动端远程连接模式：Tailscale 优先，E2E Relay 备选 ⭐⭐
灵感来自 Paseo 的 E2E encrypted relay。

**可借鉴点**：
- 现在 Tailscale 已够个人使用；但如果未来分享给其他设备/家人/临时机器，harness 需要更平滑的配对方式。
- relay 只转发加密字节，不读 prompt、代码、输出。
- QR code / pairing link 作为信任根。

**适用性**：
- 用户价值：3
- 架构贴合：3
- 实现复杂度：5
- 风险：5，安全和运维复杂
- 优先级：P3

**实现草案**：
- 暂不实现自建 relay。
- 先把 Tailscale / Cloudflare Tunnel / LAN URL 的配置做成引导页和健康检查。
- 真有多网络分享需求时，再 spike relay。

### H9. Harness 自检 / Health Check ⭐⭐⭐
灵感来自 Goose/CLI 工具的 doctor/config 命令、Claude Code settings 层级。

**可借鉴点**：
- 黑屏、签名、后端、CLI auth、Tailscale、token、allowed roots、外部工具缺失，这些都不是 agent 能力，是 harness 可靠性问题。
- 做一个 `/api/health/full` 和 iOS 设置页"诊断"：逐项显示绿/黄/红。

**适用性**：
- 用户价值：5
- 架构贴合：5
- 实现复杂度：2
- 风险：2，注意不要泄露路径/token
- 优先级：P0/P1

**实现草案**：
- 检查项：backend reachable、WS connect、Claude CLI path/version、credentials 存在、allowed roots、whisper/ffmpeg/edge-tts、projects.json 可写、iOS backend URL、app version/build、最近 telemetry error。
- 一键复制脱敏诊断报告。
- iOS 首次启动失败时至少显示诊断页，而不是黑屏。

### H10. Agent 模式路由 / Mode-aware UI ⭐⭐
灵感来自 Claude Code plan/permission modes、Aider ask/code/architect modes。

**可借鉴点**：
- harness 应该清楚告诉用户当前是在"问答、规划、执行、旁路权限、只读"哪个模式。
- 输入框和按钮随模式变化：Plan 模式显示"批准并执行"，Ask 模式禁用工具风险提示，Bypass 模式红色常驻警告。

**适用性**：
- 用户价值：4
- 架构贴合：5，settings 已有 permissionMode/model
- 实现复杂度：2
- 风险：2
- 优先级：P2

**实现草案**：
- iOS 顶部标题旁显示 mode chip。
- `permissionMode == plan` 时把 ExitPlanMode 计划文件作为一等 UI，而不是普通消息。
- 对 `bypassPermissions` 加二次确认和会话内红色标识。

---

### A1. 模型自动选择：Opus 复杂度路由 ⭐⭐⭐
用户不用手动选模型。发送 prompt 前先用 Opus 做一次轻量复杂度判断，输出选用哪个模型（haiku / sonnet / opus）及理由，再用选出的模型跑实际任务。

**触发场景**：
- 设置页开启"自动选模型"后，InputBar 里的 model picker 变成"自动"。
- 每次 sendPrompt 前调用 `/api/model-router`（单独轻量端点）：把 prompt 前 500 chars 发给 Opus，返回 `{ model, reason }`，再走正常 sendPrompt 流程。

**实现草案**：
- 后端新增 `POST /api/model-router`：spawn claude --model opus，system prompt："根据任务复杂度选择模型：haiku（问答/翻译/简单生成）/ sonnet（代码/分析/多步骤）/ opus（架构设计/复杂推理/大型重构）。只输出 JSON `{model, reason}`"。
- iOS：`BackendClient.sendPrompt` 增加 `autoSelectModel` 路径，先 await router，然后用返回的 model 跑任务；UI 在 bubble 旁显示"自动选 sonnet"标签。
- 超时兜底：router 调用超过 3s 则直接用 sonnet。

**适用性**：
- 用户价值：4，省去手动切模型心智负担
- 架构贴合：4，sendPrompt 已有 model 参数
- 实现复杂度：3
- 风险：2，多一次 LLM 调用增加约 1-2s 延迟
- 优先级：P2

---

### A2. 完成时发声提示 ⭐⭐
任务跑完（`session_ended completed`）时播放一个短提示音（非语音摘要，而是一个 UI chime），告知用户可以回来看结果——适合手机放到一边、戴耳机干别的时。

**与现有 TTS 的区别**：TTS 读摘要需要 10-15s 延迟；chime 是立刻的、不打扰的 0.5s 提示音。两者可以共存：先 chime → 再 TTS 摘要。

**实现草案**：
- iOS：在 `onTurnCompleted` 回调里，用 `AudioServicesPlaySystemSound` 播放系统音效（如 `1057` Tweet 或自定义短 mp3），不需要任何后端改动。
- 设置页加开关：完成提示音（开/关），和语音摘要开关独立。
- 后台完成（非当前对话）也发声，当前对话完成用不同音色区分。

**适用性**：
- 用户价值：4
- 架构贴合：5，onTurnCompleted 已有
- 实现复杂度：1
- 风险：1
- 优先级：P1

---

### A3. PR 驱动 Agent 调度 ⭐⭐⭐
用户只写 PR 描述（或 issue），app 自动调度 agent 去实现、测试、提 PR——无需盯着对话。核心理念：从"对话驱动"升级为"任务驱动"。

**工作流**：
1. 用户在 iOS 输入框贴 GitHub issue URL 或直接写需求描述。
2. App 解析出任务目标，用 Worktree 隔离（P1）开一个新对话，后台静默跑。
3. Agent 完成后自动用 `gh pr create` 提 PR，把 PR URL 推送给用户（通知/消息）。
4. 用户点链接在 GitHub 上 review，按需 approve 或追加 comment 继续迭代。

**实现草案**：
- 依赖 A1（自动选模型）、P1（Worktree 隔离）、P2（GitHub 集成）。
- iOS 新增"调度任务"入口：InputBar 长按/菜单 → "后台完成后通知我"。
- 后端：`POST /api/schedule-task`，接收 `{cwd, description, notifyOnDone: true}`，在 worktree 里 spawn agent，完成后推送 iOS 通知 + PR URL。
- 通知：`UNUserNotificationCenter` 本地通知，内容是"任务完成，PR #123 已提"。

**适用性**：
- 用户价值：5，真正的异步 agentic 工作流
- 架构贴合：3，需要 A1 + P1 + P2 先就位
- 实现复杂度：5
- 风险：4，无人监督的 agent 需要安全边界
- 优先级：P2/P3，先做依赖项

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

---

## 团队协作方向调研（2026-04-30）

> **⚠️ 已废弃（2026-05-01）**：用户敲定项目定位为"纯个人自用，永不分发、永不商业化、永不团队化"——见 [docs/HARNESS_ROADMAP.md §Context #13](HARNESS_ROADMAP.md)。本节作为历史调研归档保留，但其中"5-10 人团队"前提已不成立；如果想看当前竞品对比，请看 [docs/HARNESS_LANDSCAPE.md](HARNESS_LANDSCAPE.md)。
>
> 历史调研内容（已废弃）：

> **场景**：5-10 人小团队共用一个工作目录、共用同一个 Claude Pro/Max 订阅、
> 看彼此对话和编辑历史。在十多个开源同类项目中找最小阻力实现路径。
> 完整调研见对话归档；下面只列结论与可借鉴的设计。

### 核心结论

1. **完全实时多人共编辑同一目录是反生产力的**——Gitpod 多年没做成是教训。
   claude-web 的差异化应该是"**异步**共享会话历史 + git 当 source of truth +
   谁在跑哪个 run 实时可见"，不是 Google Docs 式实时多光标。

2. **有最小阻力路径存在**：参照 `claude-relay-service` (Wei-Shaw, MIT) 的
   OAuth pool + 内部 token + per-key quota 三件套，1 周内可让 claude-web 多人化。

3. **License 红线**：避免直接借鉴 Coder（AGPL）、CloudCLI/siteboon（AGPL）、
   **hapi / Paseo（均 AGPL-3.0 风格）**、
   Open WebUI（自定义品牌限制）的代码；可放心借鉴的是
   claude-relay-service / Clay / LibreChat / AnythingLLM / Meridian（都是 MIT）。

> **2026-05-01 补充**：完整竞品/参考全景图见 [docs/HARNESS_LANDSCAPE.md](HARNESS_LANDSCAPE.md)。本节强项池**只列团队协作场景**相关项目；harness L3/L4/L7 层的同类工具（Multica/Paseo/Temporal/Coze/OpenHands）见 LANDSCAPE 文档。

### 强项池（按借鉴优先级排序）

| 项目 | License | 借鉴指数 | 一句话 |
|---|---|---|---|
| **Multica** (multica-ai/multica) | Modified Apache-2.0 | ⭐⭐⭐⭐ | Agent-as-teammate + task state machine + local daemon/runtime 模型，适合借鉴任务编排，不适合直接搬商业/前端代码 |
| **claude-relay-service** (Wei-Shaw) | MIT | ⭐⭐⭐⭐⭐ | OAuth pool + 内部 cw_xxx token + per-key quota，直接抄三件套 |
| **Clay** (chadbyte/claude-relay) | MIT | ⭐⭐⭐⭐⭐ | "Self-hosted team workspace for Claude Code"，已经做出 claude-web 想做的 80%；OS 用户 + setfacl 做文件 ACL |
| **hapi** (tiann/hapi) | AGPL-3.0 | ⭐⭐⭐⭐ | **Seaidea L1/L2 最直接同类竞品**：跨设备访问本地 CLI Agent，Web/PWA/Telegram Mini App，WG+TLS 中继，npx 一行启动，3.8k star 活跃。借鉴 Telegram 通道；AGPL 不抄代码 |
| **Paseo** (getpaseo/paseo) | AGPL-3.0 风格 | ⭐⭐⭐⭐ | L3 多 Agent session 调度参考：git worktree 一等公民、`paseo.json` 仓库内配置、分支域名自动分配 (`web.<branch>.<app>.localhost`)、E2E 加密中继。AGPL 不抄代码 |
| **AnythingLLM** | MIT | ⭐⭐⭐⭐ | Workspace 容器化抽象（每 workspace 是隔离对话+文档+成员），可直接照抄 schema |
| **LibreChat** | MIT | ⭐⭐⭐⭐ | OIDC/OAuth2/LDAP/local 认证子系统成熟，可整段抄 |
| **Open WebUI** | 自定义 | ⭐⭐⭐ | 用户/组/workspace 三层 RBAC 结构，license 不友好只学不抄 |
| **Continue.dev** | Apache | ⭐⭐⭐ | "团队同步 config 不同步 session" 是反例，验证 claude-web 的差异化空间 |
| **Coder** | AGPL | ⭐⭐ | 隔离方向相反 + AGPL 风险，仅看架构思路 |

### Multica 对比补充（2026-04-30）

**资料来源**：`multica-ai/multica` README / docs，HEAD `51fdc5aec39181be505d11c859c341ad3ade9a88`。

**它强在**：
- 把 agent 变成 issue assignee：任务不是一次聊天，而是 `queued → dispatched → running → completed/failed/cancelled` 的生命周期。
- server / daemon / AI coding tool 三层分离：server 只管 workspace、issue、task queue、WebSocket；daemon 在用户机器上 poll 任务、心跳、执行本地 CLI；代码和密钥留在本机。
- 多 provider 抽象：Claude Code、Codex、Cursor、Gemini、Kimi、OpenCode 等统一成 runtime provider，并显式记录每个 provider 是否支持 resume、MCP、skills。
- 失败恢复清楚：runtime offline / timeout 可自动 retry，agent_error 不盲目重试；manual rerun 继承 session id。
- 技能复用是团队资产：同一 workspace 里的 skills 可以被不同 agent 复用。

**对 claude-web / Seaidea 的适用性**：
- 用户价值：4/5。适合未来“手机上派任务、回来看结果”的异步工作流。
- 架构贴合：3/5。claude-web 已有 backend + WS + Claude CLI subprocess，但没有 issue/task 数据模型，也没有 daemon/server 分离。
- 实现复杂度：4/5。若完整照 Multica 做，会引入数据库、任务队列、runtime 心跳、agent registry，超过当前个人工具的范围。
- 风险：3/5。Multica license 是 modified Apache-2.0：内部使用可参考，但不能直接把其源码当成商业托管/嵌入式服务基础；前端 logo/copyright 也有限制。
- 优先级：P2。先借鉴轻量 task state / rerun / runtime health，不急着做完整团队平台。

**最值得借鉴的轻量版实现草案**：
- 给当前 `runId` 增加持久化 `TaskRecord`：`queued / running / completed / failed / cancelled`，先存 `~/.claude-web/tasks.jsonl` 或 SQLite。
- iOS conversation list 显示任务状态：正在跑、上次失败、可一键 rerun。
- `session_ended(reason: error)` 时保留 sessionId，提供“重跑此任务”按钮，继续使用 Claude CLI `--resume`。
- 后端增加 runtime health：记录 backend、Claude CLI、Tailscale/self URL、whisper/edge-tts 可用性，iOS 设置页展示。
- 长期再考虑 agent profiles / issue board；短期不要引入完整 Multica 式 workspace/team/role 系统。

#### M1. 轻量任务状态机（借鉴 Multica Task lifecycle）
Multica 把每次 agent 执行建模成 task：`queued → dispatched → running → completed/failed/cancelled`。claude-web 现在只有 WS run 和会话消息，跑完后缺少“这件事最后成功了吗、失败能不能重跑、什么时候开始/结束”的稳定记录。

**可借鉴点**：
- 把 `runId` 提升成持久化的任务记录，而不是只在 WS 内存里存在。
- 记录 `conversationId / cwd / prompt preview / model / permissionMode / sessionId / startedAt / endedAt / status / error`。
- iOS 会话列表显示最近任务状态：正在跑、失败、完成、已取消。
- 失败任务保留“重跑”入口，重跑时沿用 `sessionId` 做 `--resume`。

**适用性**：
- 用户价值：5/5。手机场景最需要“发出去后不用盯着，回来知道结果”。
- 架构贴合：5/5。现有 `runIdToConversation` 和 `session_ended` 已经能支撑。
- 实现复杂度：2/5。先用本地 jsonl / cache 就能做，不必上数据库。
- 风险：2/5。主要风险是状态和真实 CLI 结果不同步，需要在所有结束路径写入。
- 优先级：P1。

**实现草案**：
- 后端新增 `tasks-store.ts`，append-only 写 `~/.claude-web/tasks.jsonl`。
- `cli-runner.ts` 开始 run 时写 `running`，结束/中断/错误时写最终状态。
- `routes/sessions.ts` 或新 `/api/tasks` 返回每个 conversation 的最近 task。
- iOS `ProjectRegistry` 拉会话时合并 task 状态，`NotesView` / 会话抽屉显示 badge。

#### M2. 失败重跑 / Manual rerun（借鉴 Multica retry 规则）
Multica 区分 automatic retry 和 manual rerun，并且 rerun 会继承旧 session。claude-web 不需要完整自动重试，但非常适合做“失败后点一下继续”。

**可借鉴点**：
- 只对明确失败的 run 展示“重跑此任务”。
- 默认不自动 retry，避免 Claude 额度和文件修改被重复消耗。
- 手动重跑继承原始 prompt、cwd、model、permissionMode、sessionId。
- 新 run 用新 `runId`，但关联 `parentTaskId`，方便看同一任务尝试了几次。

**适用性**：
- 用户价值：4/5。移动端网络断开、CLI 报错、权限中断后很常见。
- 架构贴合：4/5。已有 `resumeSessionId` 字段。
- 实现复杂度：2/5。
- 风险：2/5。需要避免对已产生文件修改的失败 run 盲目重复执行，所以先只做人工触发。
- 优先级：P1。

**实现草案**：
- `TaskRecord` 增加 `attempt`, `parentTaskId`, `lastError`。
- iOS 失败 badge 点开弹确认：“使用上次上下文重跑”。
- Web 后续可在消息尾部加 “Retry run”。

#### M3. Runtime 健康页（借鉴 Multica Runtime dashboard）
Multica 的 daemon 会注册 runtime、心跳，并展示可用 provider。claude-web 是个人工具，不需要 daemon 注册，但需要一个“当前后端到底能不能工作”的健康页。

**可借鉴点**：
- 把运行环境状态集中展示：backend 在线、Claude CLI 可用、Claude OAuth 凭据存在、当前 cwd 可访问、Tailscale/self URL、whisper、ffmpeg、edge-tts。
- 后端暴露只读 `/api/health/runtime`。
- iOS 设置页显示“运行环境检查”，红黄绿状态一眼看懂。

**适用性**：
- 用户价值：4/5。排查“手机发不出去 / 语音不能用 / backend 没起来”会快很多。
- 架构贴合：5/5。所有检查都在 backend 本机完成。
- 实现复杂度：2/5。
- 风险：1/5。注意不要返回敏感路径以外的凭据内容。
- 优先级：P1。

**实现草案**：
- 后端新增 `/api/health/runtime`，只返回 boolean/status/message。
- 检查 `claude --version`、`~/.claude/.credentials.json` 是否存在、外部工具路径是否可执行。
- iOS `SettingsView` 增加“运行环境”入口，显示最近一次检查结果和刷新按钮。

#### M4. Provider 能力矩阵（只借鉴概念，不急着多 provider）
Multica 支持 11 个 coding CLI，并维护 provider 能力矩阵：是否支持 session resume、MCP、skills、model selection。claude-web 现在应继续以 Claude CLI 为核心，但可以借鉴“能力显式化”的设计。

**可借鉴点**：
- 把 Claude CLI 的能力作为结构化 metadata：支持 resume、支持 MCP、支持 permission hook、支持 image attachment、支持 plan mode。
- UI 根据能力开关功能，而不是散落硬编码。
- 将来如果接入 Cursor Agent / Codex，只新增 provider adapter，不改 UI 主流程。

**适用性**：
- 用户价值：2/5。短期用户感知不强。
- 架构贴合：3/5。需要抽象 `cli-runner`，但不能破坏 Claude CLI 订阅路线。
- 实现复杂度：3/5。
- 风险：3/5。容易过度设计；禁止为了多 provider 引入 Anthropic SDK。
- 优先级：P3。

**实现草案**：
- 先只建 `ClaudeProviderCapabilities` 常量，不改执行路径。
- Settings 里 debug 展示当前能力。
- 等真正需要 Cursor/Codex 时再抽 provider interface。

#### M5. Agent Profile / 常用任务模板（借鉴 Multica Agents as teammates）
Multica 的 agent 有名字、provider、model、instructions。claude-web 不适合现在做团队 agent 成员，但适合做“常用任务模板”：例如 Review、Fix tests、写 iOS UI、整理文档。

**可借鉴点**：
- 用户可以保存常用 system/instruction 片段。
- 发 prompt 前选择一个 profile，自动拼接约束。
- profile 只影响当前 run，不改变全局 Claude 配置。

**适用性**：
- 用户价值：3/5。适合重复工作流，但不如任务状态机紧急。
- 架构贴合：4/5。可以作为 prompt 前缀处理，不碰 CLI 底层。
- 实现复杂度：2/5。
- 风险：2/5。要让用户清楚看到最终会发送什么，避免隐形 prompt 造成困惑。
- 优先级：P2。

**实现草案**：
- `~/.claude-web/profiles.json` 保存 `{ name, description, promptPrefix, defaultModel, permissionMode }`。
- iOS 输入框旁增加 profile picker。
- 首批内置：`Code Review`、`Fix Failing Tests`、`Plan First`、`Update Manual`。

### 推荐实现路径（如果决定做）

#### Phase T1: 凭据池（1 周）—— 最小可用多人版
**灵感来自 claude-relay-service**：

- 后端加一层 `OAuthPool`：配置多个 Claude OAuth credential（每个对应一个 Claude Pro 订阅 / 或同一订阅在不同账号下的多 token），轮询/最少使用调度
- 用户拿 `cw_xxx` 内部 token 访问 backend（替代当前的 `CLAUDE_WEB_TOKEN` 单一 token）
- 每个 cw_xxx token 配置：成员归属、月配额（token / 请求数）、并发上限、模型白名单
- 前端登录页输入 cw_xxx，后端识别 user_id

**保留 claude CLI subprocess 模式**（不切到 SDK），因为：
- CLI 进程隔离比 SDK 调度更简单（每次 spawn 一个新 claude，pool 只决定走哪个 OAuth credential 目录）
- 通过 `CLAUDE_CONFIG_DIR` 环境变量控制 spawn 时用哪份 credential

**改动文件**（粗估）：
- `packages/backend/src/auth.ts` — 扩展为 `cw_xxx` token 注册 + 用户元数据
- `packages/backend/src/oauth-pool.ts` (新) — credential 调度
- `packages/backend/src/cli-runner.ts` — spawn 时注入 `CLAUDE_CONFIG_DIR`
- `packages/backend/src/routes/admin.ts` (新) — admin 看每用户配额 / 用量
- `packages/frontend/AuthGate.tsx` — 真正的登录页

#### Phase T2: 共享 workspace（1 周）—— 谁在干啥实时可见
**灵感来自 Clay + AnythingLLM 的 workspace 抽象**：

- `~/.claude-web/projects.json` 加 `members: [userId]` + `permissions: { read, write }`
- 当 user_A 在某 workspace 跑 prompt，**其他成员在抽屉里看到 "user_A 正在跑 [run_id]"** badge
- jsonl session 列表加上 `author` 字段，drawer 里显示"@用户 X 的会话"
- 点击别人的会话 = 只读视图（不能继续 send_prompt，但可 fork 成自己的）

**冲突处理（参考 Aider 的 git-as-source-of-truth 思路）**：
- 不做实时锁，依赖 git 处理（要求 workspace 必须是 git repo）
- 每次 PreToolUse Edit / Write 前 backend 自动 `git status` 检查 dirty，dirty 时弹 permission 让用户决定继续/暂停

#### Phase T3: 审计 + admin（3 天）
- 所有 user_prompt / tool_use / permission_grant 写 SQLite (替代当前 jsonl)
- Admin Web 页面（仅 admin token 可见）：用户列表、月度 token 用量、最近 50 条 audit、按 toolName 聚合（看谁频繁用 Bash）

### 不做的事（从调研里得到的反面教训）

- ❌ **绕 OAuth token 做 API 转 proxy**（claude-code-proxy 系列）—— Anthropic 多次封堵，
  ToS 灰色，稳定性双高风险。claude-web 当前 subprocess 模式合规，不要降级
- ❌ **实时多光标共编辑**（Gitpod 教训）—— 几个人同时改一个文件没人真的需要
- ❌ **自建 Identity Provider**—— 直接用 OIDC（Google Workspace / GitHub OAuth），
  小团队场景靠企业邮箱白名单足够
- ❌ **fork siteboon/claudecodeui**—— AGPL，会强制公开 claude-web 改动

### 关键风险

1. **`CLAUDE_CONFIG_DIR` 多 OAuth credential 隔离**未实测，可能 claude CLI 在
   并发 spawn 时存在 cache / lock 冲突。Phase T1 第一周必须先做 spike test
2. **OAuth credential 池是否违反 Anthropic ToS** 需要看 2026 年最新条款
   （2026-04 已封过几轮 OAuth token 滥用）。最稳妥是改成"每用户绑自己的
   Claude 订阅 OAuth"——退化成"集中管理多账号"而非"共享一个订阅"
3. **iOS PWA + cookie + Tailscale 跨 host SSO** 需实测（参考 ENTERPRISE_INTERNAL.md
   B-1 阶段已识别此风险）

### 下一步

不立即开工。**触发条件**：
- 真的有 ≥3 个团队成员明确说"我要这功能"
- 或者用户决定从个人工具转成内部工具（参考 ENTERPRISE_INTERNAL.md 路径 B）

触发后第一步：把 claude-relay-service 跑起来 + 把 Clay 跑起来,**实地验证**这两个项目
能不能直接满足需求。如果 Clay 已经够好,不用自己写。

---

## 团队意愿汇总 + 预算约束自动下单(2026-04-30)

> 多人版 claude-web 的"上层应用":把员工各自的需求集中成一次预算受限的代表团决策,自动执行。
> 后期实现,先记下来。

**场景**:
- 全公司员工都装一个客户端,每人有自己**完全隔离**的对话框
- 各自跟 Claude 说想要什么(例:"周四下午茶想喝瑞幸大杯生椰拿铁"、"想要 XX 礼物")
- 最上层管理员(如孙总)下达约束:"周四下午茶,全员预算 ¥200 以内"
- Agent 汇总每个人的意愿 → 按预算筛选 → 挑出最终方案 → 关联孙总绑定的银行卡 / 外卖账号 → 直接下单送到办公室

**核心机制**:
- **个人对话 = 意愿收集**:每人只看到自己的对话,互相不可见
- **管理员对话 = 下达约束**:总预算、品类限制、参与人名单、配送地址、截止时间
- **跨用户 agent 任务**:Claude 跨所有人的 inbox 抽取"该用户本轮的意愿条目",做汇总 + 优化(coverage / 偏好 / 价格)+ 执行下单

**依赖前置**:
- T1 凭据池 / 多用户(参考上面"团队协作方向调研")
- T2 共享 workspace + admin 角色 + per-user 隔离的对话存储
- 外卖 / 电商平台的下单能力,以 MCP server 形式接入(美团、饿了么、京东、瑞幸 app)
- 支付授权:管理员一次性绑定 token,agent 只能在预算和品类白名单内动用

**安全闸(必须有)**:
- 自动下单前必须出"最终订单确认"给管理员,人工点一下才执行(agent 不裸跑刷卡)
- 单次金额硬上限,超过则强制人工
- 个人对话内容不能被 admin 直接读,只能由 agent 抽出"该用户的本轮意愿条目"返回,避免隐私越界
- 全部下单动作进 audit log(参考 T3)

**风险**:
- 平台 ToS:第三方 agent 直接下单外卖 / 电商未必合规,需先 spike 验证(可能要走"生成订单链接让人工点"的退化方案)
- 偏好冲突:N 个人想要 N 家不同店,预算只够一家,谁妥协?需要在 prompt 里把决策规则讲清楚(例:轮换、多数票、最大覆盖)
- 误识别 / 过敏 / 忌口:agent 必须把每个人的过敏/忌口当 hard constraint 而非软偏好

**为什么记下来**:这个用例把 claude-web 从"开发工具"扩成"团队 ops 平台"——
是 T1/T2/T3 之上的一个北极星应用场景。T1/T2/T3 完成后才能开工;目前不上日程,
但作为团队版的目标用例存档,反过来也帮助 T1/T2/T3 的设计取舍(例如必须支持
"管理员对所有 workspace 下达 meta-instruction"的能力)。
