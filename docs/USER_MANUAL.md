# claude-web 用户手册

> 个人移动端友好的 Claude Code CLI 前端。本手册覆盖**目前所有用户可见功能**。新功能加进来后，让 Claude 跑 `/update-manual` 自动维护这份文档。

## 索引

- [快速开始](#快速开始)
- [项目管理](#项目管理)
- [聊天与会话](#聊天与会话)
- [工具调用与权限](#工具调用与权限)
- [文件浏览与预览](#文件浏览与预览)
- [Git 面板](#git-面板)
- [语音输入](#语音输入)
- [语音输出（朗读）](#语音输出朗读)
- [Call Mode 全屏通话](#call-mode-全屏通话)
- [输入框增强](#输入框增强)
- [状态栏与用量](#状态栏与用量)
- [布局与持久化](#布局与持久化)
- [安全与认证](#安全与认证)
- [部署与运维](#部署与运维)
- [手机端使用](#手机端使用)
- [故障排查](#故障排查)
- [快捷键 / 命令速查](#快捷键--命令速查)

---

## 快速开始

1. **启动**：launchd 已托管，Mac 一开机后端就跑（`~/Library/LaunchAgents/com.claude-web.backend.plist`）
2. **打开**：浏览器 `http://localhost:3030`
3. **加项目**：左侧 📂 打开 → 选目录
4. **聊天**：底部输入框打字，⌘/Ctrl+Enter 发送
5. **语音**：勾左侧"对话" → 直接说话 → 说"发送"提交

---

## 项目管理

### 打开 / 新建项目
- **📂 打开** — 一步选目录，自动用文件夹名作为项目名
- **+ 新建** — 表单填名字 + 路径，可在浏览器里 mkdir 创建新目录
- **目录浏览器** — 上一级 / 路径直接编辑 / 刷新 / 新建子目录

### 多项目并行
- 项目以 **Tab** 形式呈现在主区域顶部
- 每个 tab 独立：会话 ID、消息流、busy 状态、用量
- 一个项目在跑（⏳）时可切到另一个 tab 发新指令，**真并行**
- ✕ 关闭 tab；左侧列表点项目可重新打开

### 切换 / 移除
- 左侧项目列表点击 → 打开为 tab；已打开的有 ● 蓝点
- 列表项右侧 ✕ → 移除项目（不删目录）

---

## 聊天与会话

### 模型选择
配置面板下拉，三个：
- **Haiku 4.5**（默认） — 快、便宜、日常够用
- **Sonnet 4.6** — 平衡
- **Opus 4.7** — 复杂任务

### 权限模式
- `default` — 工具调用都问
- `acceptEdits` — 文件编辑自动允许
- `plan` — 只规划不执行
- `bypassPermissions` — 全自动

### 历史会话
左侧栏 **▶ 历史会话** 折叠条：
- 列出本项目所有过往会话（首句预览 + 时间）
- 点击 → 切换并加载该会话历史消息
- 当前会话有"当前"标签

### 新建会话
配置区点 **new session (xxx)** → 清当前消息 + 解绑 sessionId，下条 prompt 起新会话。

### Stale session 自动恢复
如果 sessionId 失效（CLI 那边清理过），后端检测到 → 自动用新会话重发，前端无感。

---

## 工具调用与权限

### 工具弹窗
Claude 想用 Bash / Edit / Write 等工具时弹窗，显示工具名 + 完整参数。

### 三种允许范围
- **仅此一次** — 默认
- **本轮** — 直到对话结束
- **本项目永久** — 写入 localStorage，下次同项目同工具自动允许

### 取消
直接点"拒绝"。Claude 会收到 deny 信号继续推理。

---

## 文件浏览与预览

### 文件树
右侧 **📁 文件** tab：
- 树形展开，懒加载
- 跳过 `node_modules`（除非显式勾选）
- 显示 dotfile（默认显示）

### 文件预览（点击文件触发）
预览**在主区域中心**全宽显示，按扩展名分发：

| 类型 | 渲染 |
|---|---|
| `.png .jpg .gif .webp .svg .heic` | `<img>` 棋盘透明背景 |
| `.mp4 .webm .mov` | 原生 `<video>` 播放器 |
| `.mp3 .wav .ogg .m4a` | `<audio>` |
| `.pdf` | `<iframe>` |
| `.md .markdown` | react-markdown + 高亮 + 表格 |
| 其他文本 | CodeMirror 语法高亮（懒加载语言包） |

**关闭**：✕ 或 ESC。

### 限制
- 文本类（CodeViewer / Markdown）≤ 1MB
- 二进制（图片/视频/PDF）≤ 20MB
- 路径必须在项目目录下，越权 403

---

## Git 面板

右侧 **⎇ Git** tab：

- **Status** — 当前分支 / ahead-behind / 修改文件列表（颜色区分 staged / modified / untracked），点文件展开 inline diff
- **Log** — 最近 20 commit（sha · 作者 · 相对时间 · subject），点击展开
- **Branches** — 本地 / 远程分支，当前高亮

只读。**改动让 Claude 通过 Bash 工具做**，统一走权限模型。

---

## 语音输入

### 三种触发方式
- **按住说话**（hold-to-talk）：长按麦克风 ≥ 250ms，松手停
- **单击切换**（tap-to-toggle）：< 250ms 点按 → 切换录音开关
- **对话模式**（continuous）：勾选后自动启动 + 持续监听

### 转写模式（自动选）
- **Web Speech**（默认） — 桌面 Chrome / Android / iPhone Safari 浏览器，零延迟
- **Mac whisper（remote-stt）** — iPhone PWA standalone 自动切到这个；通过 VAD 检测语音开始/结束 → 分段送 Mac whisper-cli → 拼回完整转写

VoiceBar 下拉手动切换；都不可用时显示"不支持"。

### 对话模式
勾上"对话"后自动启动 mic（不需要再点麦克风）：
- 持续监听
- 实时转写**直接进输入框**，能看见每个字
- 红色"录音中"横条 + 闪动红点
- Claude 回完 + TTS 播完 1.5s 后 **自动续录**下一轮

iOS PWA 里也支持（VAD-driven，每段 ~1-2s 延迟）。

### 语音指令（对话模式中）

| 说什么 | 别名 | 行为 |
|---|---|---|
| **发送** | 发出去 / 发出 / 提交 / send | 提交累积内容给 Claude |
| **暂停** | 暂停录音 / 暂停监听 | 后续不进 buf，只听"继续/清除" |
| **继续** | 恢复 / 继续录音 | 解除暂停 |
| **清除** | 清空 / 重来 / 重新说 / 擦掉 | 清空 buf 重新说 |

**指令前的话照样进 buf**：说"我先想一下 暂停"会保留"我先想一下"。

**指令必须在末尾**才触发：说"发送邮件给老板"不会触发提交（防误触）。

每个指令有不同提示音（升 / 降 / 三短）。

### 整理（自动消除"嗯/啊"）
**☑ 整理** 勾选（默认开） → 转写后用 Haiku 清理填充词、合并断句、修同音错字。

短文本（≤ 12 字）或没填充词的句子**智能跳过**整理，省 token。

对话模式下"发送"触发**直接绕过整理**——你已经决定了。

### 音频设备选择
VoiceBar 麦克风按钮上方有两个下拉 + 刷新 ↻：

- **🎤 输入** — 选录音用的麦克风（默认 / AirPods / 内置 …）。授权 mic 后才能看到真实设备名
- **🔈 输出** — 选朗读音频去哪个扬声器（蓝牙耳机 / 内置喇叭）。基于 `setSinkId`，**Safari 不支持**会显示"跟随系统"
- **↻ 刷新** — 蓝牙耳机刚连上、设备列表没更新时点一下；浏览器会发 `devicechange` 自动刷新，但偶尔需要手动

选项保存在 `claude-web:audio-input-id` / `claude-web:audio-output-id`。空值 = 跟随系统默认。

---

## 语音输出（朗读）

### 概要 vs 原话
**☑ 概要** 勾选（默认开）：每轮 Claude 回完后，用 Haiku 改写成 1-4 句口语，再用 Edge TTS 朗读。
- ≤30 字短答跳过 Haiku，原文直接念
- 严格剥离 markdown：`**` `##` `` ` `` 等不会被念成"星号星号"

不勾 → **逐句完整朗读**所有原文。

### 嗓音
默认 Edge TTS **晓晓**（zh-CN-XiaoxiaoNeural），微软神经合成，比 macOS 内置自然。

### 慢读
**☑ 慢读** → TTS 速率 -15%，戴耳机 / 走路时听得清楚。

### 控制按钮
- 朗读中显示 **⏹ 停止** — 立刻静音
- 朗读结束后如果有上一段，显示 **↻ 重听**
- **🔊 / 🔇** 静音切换（持久化）

---

## Call Mode 全屏通话

对话模式开启后，主区域右下浮 **📞** 按钮，点击进入全屏通话 UI：

- 大字实时转写（中央）
- 5 道波形动画（录音时跟着声压跳动）
- 状态文字提示当前可用指令
- 控件：⏸ 暂停 / ▶ 继续 / ✗ 清除 / 停止对话 / 🔊
- 屏幕保持常亮（WakeLock）

退出：✕ 或 ESC。

---

## 输入框增强

### 历史回溯
**↑** 键（textarea 在顶部时） → 调出最近 5 条 user prompt，可往上翻。

### 命令面板
输入 `/` → 弹出命令列表：

**本地短路**（不消耗轮次）：
- `/clear` — 清当前对话视图
- `/usage` — 渲染本会话用量 + 订阅 bucket 状态

**CLI 动态拉**（system:init.slash_commands）：
`/compact /context /cost /init /review /security-review /help /agents /mcp /resume /status /model /memory` 等等，加上各种 skills（`/update-config /debug /simplify /batch /loop /schedule /claude-api`...）

### 文件引用
输入 `@` → 弹出项目根文件列表，模糊匹配 → Tab/Enter 插入 `@<filename>`，Claude 看到自动 Read。

### 图片附件
- **粘贴**：截图后 ⌘V 直接进输入框
- **拖拽**：拖图片文件到输入框
- 上方 64px 缩略图托盘，每张可 ✕ 移除
- 5MB/张上限，支持多张
- 发送时作为 image content block 传给 Claude（视觉理解）

### CLAUDE.md 缺失提示
打开项目时探测项目根没 `CLAUDE.md` → 主区域顶部弹小黄条建议 `/init` 一键生成；可"不需要"持久 dismiss。

---

## 状态栏与用量

### 底部状态栏
```
● Haiku 4.5 · default · Desktop/claude-web · ⎇ main · 12t · 89.2k · 💾 76% · ⏳ 2h15m
```
- ●  连接状态
- 模型 / 权限模式
- cwd（最后两段）
- git branch（30s 轮询）
- 累计轮次 / 总 input
- 缓存命中率
- 订阅 bucket 重置倒计时（status≠allowed 时变黄）

### 侧栏 UsageMeter
- 📊 N 轮 · 💾 cache_read · 🆕 new input · 📝 output
- 进度条显示缓存命中比例
- **>50k 黄色** "上下文偏大"
- **>100k 红色** "🔥 强烈建议开新会话" + 一键 new session 按钮

---

## 布局与持久化

### 可调宽度
左侧栏（220-520px）和右侧栏（240-720px）中间有 4px 拖拽条，鼠标悬停变蓝。宽度持久化。

### 折叠 / 展开侧栏
桌面端每个侧栏内角有 **◀ / ▶** 小按钮一键折叠：
- 折叠后该列从 grid 完全移除，主区域占满
- 屏幕边缘出现细长 **▶ / ◀** 浮条，点一下展开
- 折叠状态独立持久化（`sidebarHidden` / `rightbarHidden` 在 `claude-web:layout` 里）

手机抽屉模式不受影响。

### 抽屉模式
< 760px 屏宽自动切到 mobile 布局：
- 顶栏 ☰ 打开左抽屉（项目/配置/语音）
- 顶栏 📁 打开右抽屉（文件/Git）

### 持久化清单
所有这些 reload 后保留：

| 项 | localStorage key |
|---|---|
| 项目列表 | `claude-web:projects` |
| 已打开 tabs | `claude-web:open-cwds` |
| 各 cwd 最近 sessionId | `claude-web:sessions` |
| 模型 / 权限模式 | `claude-web:config` |
| 侧栏宽度 | `claude-web:layout` |
| 右栏 tab（files/git） | `claude-web:right-tab` |
| 历史会话面板展开 | `claude-web:session-list-open` |
| 语音 mode（web-speech/remote-stt） | `claude-web:voice-mode` |
| 语音静音 | `claude-web:voice-muted` |
| 整理开关 | `claude-web:voice-cleanup` |
| 概要 / 原话 | `claude-web:voice-speak-style` |
| 对话模式 | `claude-web:conversation-mode` |
| 慢读 | `claude-web:slow-tts` |
| 音频输入设备 | `claude-web:audio-input-id` |
| 音频输出设备 | `claude-web:audio-output-id` |
| 项目永久 allow 工具 | `claude-web:allowed-tools-by-cwd` |
| Auth token | `claude-web:auth-token` |
| CLAUDE.md banner dismiss | `claude-web:claude-md-dismissed` |

---

## 安全与认证

### Token（可选）
设 `CLAUDE_WEB_TOKEN` env → 后端要求 `Authorization: Bearer …` 或 `?token=…`。第一次打开页面会弹 AuthGate 模态框输入。WS 升级也校验。

### 路径白名单（可选）
设 `CLAUDE_WEB_ALLOWED_ROOTS=/path1:/path2` → fs / git / sessions / cli-runner 都强制检查 cwd 在白名单内，403 拒绝越权。

### 默认绑定 127.0.0.1
后端只监听 localhost；通过 Tailscale serve / 反代暴露。设 `BACKEND_HOST=0.0.0.0` 才公开。

### Per-tool 权限
PreToolUse hook → POST 后端 `/api/permission/ask` → WS 推前端 → 用户点允许/拒绝 → hook 输出决策。详见 [packages/backend/scripts/permission-hook.mjs](packages/backend/scripts/permission-hook.mjs)。

---

## 部署与运维

### launchd 自启
- Plist：`~/Library/LaunchAgents/com.claude-web.backend.plist`
- 包了 `caffeinate -is` 防 idle / system sleep
- 崩溃 5 秒内自动拉起
- 日志：`~/Library/Logs/claude-web-backend.{stdout,stderr}.log`

```bash
launchctl list | grep claude-web                                       # 看状态
launchctl unload ~/Library/LaunchAgents/com.claude-web.backend.plist   # 关
launchctl load -w ~/Library/LaunchAgents/com.claude-web.backend.plist  # 开
```

### 单端口架构
后端 `:3030` 同时出：
- `/` HTML + 静态 dist（gzip + 1 年 immutable cache）
- `/api/*` REST
- `/ws` WebSocket

`index.html` 按 mtime 自动重读，前端 build 后无需重启后端。

### Tailscale HTTPS
```bash
tailscale serve --bg --https=443 http://localhost:3030
```
得到 `https://<hostname>.<tailnet>.ts.net`，跨设备 HTTPS 访问。

### 自动重连横幅
WS 断 1 秒 → 顶部红条"后端离线，自动重连中…"+ 刷新按钮。每 2s 重连一次。

---

## 手机端使用

### 同 WiFi 直连
```
http://192.168.130.64:5173
```
（Mac 局域网 IP，端口取决于你跑哪个 server）。**麦克风需要 HTTPS**。

### Tailscale（推荐）
```
https://<your-hostname>.<tailnet>.ts.net
```
出门 4G 也能连。在 iPhone 装 Tailscale app + 同账号登录即可。

### Add to Home Screen (PWA)
Safari 分享 → 添加到主屏幕 → 全屏 standalone。
- iOS PWA 下 Web Speech 不可用 → 自动切到 **Mac whisper VAD 模式**
- 屏幕在对话/通话时不息屏（WakeLock）
- 锁屏后 mic 停（iOS 系统级限制，无解，需要原生 app）

### 移动手势
- 单击麦克风 = 切换录音
- 长按 ≥ 0.25s = 按住说话
- 截图 ⌘V → 直接粘贴图片
- 输入框上方语音波形 / 转写实时反馈

---

## 故障排查

### 黑屏 / 白屏
- 浏览器强刷 ⌘⇧R（绕开磁盘缓存）
- iOS PWA：删主屏图标 + Safari 设置 → 清网站数据 → 重新加主屏
- 后端 dist 跟不上：`pnpm --filter @claude-web/frontend build` + 刷新

### "对话" 灰掉了
你在 unsupported 模式下（既无 Web Speech 又无 MediaRecorder）。检查：
- HTTPS 是否启用（`getUserMedia` 要 HTTPS 或 localhost）
- Mac 浏览器版本 ≥ 一年内的

### 语音不进输入框
- 检查"对话"是否勾上（不勾就是 push-to-talk 模式，松手才进 cleanup 流程）
- 看 InputBox 是否显示红色"录音中"——如果没显示说明 mic 权限被拒

### 触发词没识别
- 必须在 final transcript **末尾**
- 中间说"发送"不触发（防误触）
- 试着停顿一下再说"发送"

### claude CLI 报错
- 重新 `claude auth login` 一次
- 看 `~/.claude/.credentials.json` 还在不在
- 别用 `--bare` flag（强制 API key 模式）

### Stale session
后端自动检测 + 重试，前端无感。如果还是失败 → 配置面板点 "new session"。

### 用量飙升
- UsageMeter 红色（>100k）→ 开新会话
- 频繁问简单问题 → 切到 Haiku
- 长会话 → 试 `/compact`（CLI 自带）

---

## 快捷键 / 命令速查

### 输入框
| 操作 | 键 |
|---|---|
| 发送 | ⌘/Ctrl+Enter |
| 历史回溯 | ↑（textarea 顶部时） |
| 命令面板 | `/` |
| 文件引用 | `@` |
| 粘贴图片 | ⌘V |

### 语音指令（对话模式）
| 指令 | 别名 |
|---|---|
| 发送 | 发出去 / 提交 / send |
| 暂停 | 暂停录音 / 暂停监听 |
| 继续 | 恢复 |
| 清除 | 清空 / 重来 / 重新说 |

### 全局
| 操作 | 键 |
|---|---|
| 关闭模态/预览/Call Mode | ESC |

### 本地 slash 命令（不发给 Claude）
- `/clear` 清前端视图
- `/usage` 显示用量摘要

### CLI slash 命令（动态从 system:init 加载）
按项目变化的常用：`/compact /context /cost /init /review /help /memory /agents /mcp /resume /model` 等。

### 测试命令
```bash
pnpm --filter @claude-web/backend test:e2e         # 主功能 57 项
pnpm --filter @claude-web/backend test:auth        # auth + 白名单 14 项
pnpm --filter @claude-web/backend test:permission  # 权限链路
pnpm --filter @claude-web/backend test:cli         # CLI 子进程订阅模式
pnpm --filter @claude-web/backend test:strip       # TTS markdown 剥离 16 项
pnpm --filter @claude-web/backend test:convo       # 语音指令解析 20 项
```

---

## 相关文档

- [CLAUDE.md](../CLAUDE.md) — 给未来 Claude 的架构指引（必看）
- [docs/IDEAS.md](IDEAS.md) — 已记录但未做的功能
- [docs/IMPROVEMENTS.md](IMPROVEMENTS.md) — 早期改进清单
- [docs/MOBILE_VOICE.md](MOBILE_VOICE.md) — 手机语音方案探索
- [docs/ENTERPRISE_INTERNAL.md](ENTERPRISE_INTERNAL.md) — 转企业内部工具的迁移方案
