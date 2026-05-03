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
6. **帮助**：Web 右上角 ❓ / iOS 设置 → 使用手册 → 离线查阅本文档（24 小时本地缓存）

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

### 文字选择 / 复制
- iOS 端**所有消息类型**（用户气泡、助手回复、系统提示、错误信息、工具结果、思考块）都支持长按选片段
- 选中后弹系统菜单：复制 / 全选 / 共享
- 助手回复气泡下方还有 **复制全文** 按钮（一键全文）；代码块右上角有独立 **复制** 按钮
- Web 端原生支持文字选择

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

### 实时同步
后端用 `chokidar` 监听当前 cwd（忽略 `node_modules` `.git` `dist` `.cache` `.idea` `.vscode` `.DS_Store`），变更通过 WebSocket 推 `fs_changed` 事件：

- **文件树**：被改动文件所在的父目录如果展开过，自动重新拉一次（250ms 防抖）
- **文件预览**：当前打开的文件被改写 → 自动重载（节流 1s）；被删除 → 显示"文件已被删除"

WS 重连后会自动重新订阅。


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
麦克风按钮**嵌在输入框右侧**（不再藏在侧栏底部），手机上拇指随手就能点：

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
**☑ 整理** 勾选（默认开） → 转写后用 Haiku 清理填充词、合并断句、修同音错字、把项目专有名词词表中的词从中文谐音/错字纠回正字（如"泰尔斯凯" → `Tailscale`）。

短文本（≤ 12 字）或没填充词的句子**智能跳过 Haiku**，省 token。**注意：smart-skip 只跳过整理，不跳过审核** —— 文字仍进输入框等你点发送（除非开了"自动发送"）。

对话模式下"发送"触发**直接绕过整理**——你已经决定了。

### 自动发送 vs 手动审核
**☑ 自动发送**（默认关）独立于"整理"开关，组合矩阵：

| 整理 | 自动发送 | 行为 |
|---|---|---|
| OFF | OFF | 转写 → 输入框 → 你点发送 |
| ON | OFF | 原文立即显示 → 整理完成后**未编辑则替换为 cleaned** → 你点发送 |
| OFF | ON | 转写 → 输入框 → 立即发送 |
| ON | ON | 原文立即显示 → 整理完成后发送 cleaned |

**安全保障**：
- **整理失败永远不自动发送** — 失败时保留原文，提示"整理失败 · 已保留原文，未自动发送"
- **用户编辑后不被覆盖** — 整理 pending 期间你打字了，cleanup 完成后不会冲掉你的编辑。靠每个 voice draft 一个 `id` + InputBox 跟踪 `userEdited` flag 实现，并发 draft 也不互踩

对话模式说"发送"始终直送，不走这些规则。

### 识别准确度
六道防线层层叠加：

1. **浏览器 DSP**：`getUserMedia` 启用 `echoCancellation` / `noiseSuppression` / `autoGainControl`，移动 / 嘈杂场景大幅改善
2. **ffmpeg 滤波**：`highpass=f=80` 砍低频隆隆声 + `afftdn` 自适应去噪 + `dynaudnorm` 动态归一化音量
3. **whisper `--prompt` 词表注入**：把 `Claude / TypeScript / Tailscale / Hono / chokidar / Edge TTS / 晓晓 …` 等专有名词作为 initial_prompt 传入，让 whisper 解码时"知道"这些词，专业词错字率显著降低。可通过 `WHISPER_PROMPT_EXTRA` env 追加自定义词
4. **模型自动选优**：[`resolveWhisperModel`](packages/backend/src/routes/voice.ts) 在 `~/.whisper-models/` 中按 `large-v3.bin` → `large-v3-turbo.bin` → `large-v3-turbo-q5_0.bin` 顺序挑最准的；下载新模型即生效，无需改配置或重启
5. **AudioWorklet PCM 环形缓冲 + 300ms 预录**（仅对话模式）：取代 per-segment 重启 MediaRecorder 的旧做法。整个对话期间一个 AudioWorklet 持续抓 PCM 到 30s 环形 buffer，VAD 触发"开始说话"时往前回溯 300ms 切段 → 编码为 16-bit WAV → 送 whisper。**彻底消除每次 segment 起始 50-200ms 的截断**（首词辅音/声调丢失的根本原因）
6. **EWMA 自适应噪声基线**：每 50ms tick 在静默期慢慢更新基线（`vadNoiseFloor = 0.95 * old + 0.05 * rms`），不再依赖启动时那 500ms 的"假设安静"窗口；启动时若用户已经在说话，基线会在 1s 内自动校正

附加：对话模式下每段转写完后，前端会把上一段文本（最多 200 字）作为 `prev` query 参数发回 backend，拼到 whisper `--prompt` 末尾，给跨 segment 的连贯性打补丁。

可手动用 `WHISPER_MODEL` env 强制指定模型路径。

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
- 严格剥离 markdown：`**` `##` `` ` `` 等不会被念成"星号星号"。后端在 prompt 里加禁字规则后**还会再跑一遍 `stripMarkdownFromSummary`** 兜底，模型偶尔泄漏的格式符也不会进 TTS
- **总结失败兜底**：Haiku 调用超时 / HTTP 错 / 模型 fallback 时，不会再"全文朗读"——而是截前 ~120 个字（在 `。！？.!?` 边界切），保证不夸张。失败原因写到 telemetry（`tts.summary.http_error` / `bad_json` / `fallback_from_backend` / `request_failed`）

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
桌面端屏幕左右边缘各有一根**常驻竖条**（参考 Cursor 交互），点一下就在"展开/折叠"间切换：

- 箭头方向反映当前状态：◀ 表示点击会折叠，▶ 表示点击会展开
- 折叠后该列从 grid 完全移除，主区域占满，竖条贴到屏幕边缘
- 状态独立持久化（`sidebarHidden` / `rightbarHidden` 在 `claude-web:layout` 里）

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
| 自动发送开关 | `claude-web:voice-autosend` |
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
http://192.168.x.x:5173
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

### 大字体（≤760px 自动启用）
手机端字号整体放大约 1.2×：聊天正文 17px、markdown 标题 19-24px、工具卡 15-16px、输入框 17px。按钮高度 ≥48px 防误触。桌面端不受影响。

---

## iOS 原生 app（Seaidea）

**这是 v1 推荐的手机端方案**。SwiftUI 重写，绕开 PWA 在 iOS 上的诸多约束（autoplay、物理静音键、后台 mic）。Capacitor 路径已标 deprecated。

> Bundle 显示名是 **Seaidea**（避免跟 Anthropic 的 Claude 商标冲突）。Bundle id 仍是 `com.albertsun6.claudeweb-native`。

### 安装

源码：[`packages/ios-native/`](packages/ios-native/)。本地 build + 装机：

```bash
cd packages/ios-native

# 模拟器（UI 调试）
./scripts/deploy.sh --sim

# 真机（要 iPhone USB 线 / 已配对）
./scripts/deploy.sh
```

第一次装机要在 iPhone 上**信任开发者证书**：设置 → 通用 → VPN与设备管理 → 你的 Apple ID → 信任。

免费 Apple ID 7 天重签一次（重跑 deploy.sh 即可）。如要走 TestFlight 永久签名，需 $99/年开发者账号（M5 才订）。

### 首次配置（设置 ⚙️）

| 项 | 默认 | 说明 |
|---|---|---|
| 启动时自动进入语音模式 | ON | App 启动自动进入语音模式；设置里可关闭 |
| 语音模式 | ON（启动自动进入） | 进入后顶部锁屏 Now Playing；输入栏 mic 切到自动发送 |
| Backend | `https://mymac.tailcf3ccf.ts.net`（真机）/ `http://localhost:3030`（模拟器）| Tailscale URL 或 LAN IP |
| 浏览起始路径 | `/Users/yongqian/Desktop` | DirectoryPicker（"打开文件夹"）的默认起始位置；新对话不再用它做默认 cwd |
| 模型 | Haiku 4.5 | 可切 Sonnet 4.6 / Opus 4.7 |
| 权限模式 | **Plan**（最安全）| Plan / Default / Accept Edits / **Bypass** |
| 字体大小 | xxLarge | 聊天正文、输入框、工具卡 UI 元素字号 |
| Token | 空 | backend 设了 `CLAUDE_WEB_TOKEN` 才填 |
| 自动播报 | ON | TTS 自动念回答 |
| 风格 | 概要 | Haiku 改写为 1-4 句 vs 逐句原文 |
| 慢速朗读 | OFF | -15% 速率 |
| 后台保活（实验性）| OFF | 见下文 |

### 权限模式

| 模式 | 行为 |
|---|---|
| **Plan** | Claude 只规划不执行任何工具。最安全，永远不弹权限请求 |
| **Default** | Claude 想用 Bash/Edit/Write 时弹半屏 sheet 让你 Allow / Deny |
| **Accept Edits** | 自动允许 Edit/Write，Bash 仍弹 |
| **Bypass** ⚠️ | **自动允许所有工具**。Claude 可直接 `rm -rf` 你的项目。开了主屏顶部会有红色常驻警示条 |

### 项目与对话

**模型**：项目（cwd）是容器，对话挂在项目下。一个项目可以并行多条对话，互不干扰。

**抽屉宽度**：左侧项目/对话抽屉占屏幕宽的 92%（最宽 380pt），留充足空间显示对话内容。

**顶部 chip**：
- 左侧绿点 = 已连接（其他状态：黄=连接中，灰=未连接，红=失败 + 错误信息）
- 中间标题 "Seaidea" 旁边的橙色数字 = 全局活跃 turn 数
- 右侧对话名 + ▼ 是切换器入口，点开列表

**切换器全屏 sheet**：
- 顶部 **+ 新建对话** 按钮
- 下方按项目分组（cwd 相同算一个项目），section header 显示项目名 + 完整路径
  - 如果 cwd 没在服务器 `~/.claude-web/projects.json` 注册（少见），header 后挂 "·未注册" 橙色标记
- 行右滑 → 关闭对话（仅卸载内存，jsonl 不删）

**新建对话流程**：
1. 点 **+ 新建对话**
2. **名称**字段灰字预填 `MMdd-N` 格式（如 `0430-1`；按当天日期计数，全局序号），可改
3. **工作目录**：
   - 顶部 **打开文件夹** → 进 DirectoryPicker：面包屑 + 子目录 + 上一级 + **新建文件夹…**（直接 mkdir 并自动选中）
   - 下方 **已打开**列表：本机内存里出现过的 cwd（按最近用排序），点击直接选；列表为空时显示空态文字
4. 选了 cwd 后名称随之更新（除非你已自定义）
5. 点右上 **开始**

**持久化**：
- 对话 metadata + 消息历史缓存到 `~/Library/.../Application Support/com.albertsun6.claudeweb-native/cache/`（Codable JSON，会话最多 50 条 LRU）
- 首次发 prompt → CLI 回 systemInit 立即把 `sessionId` 写到缓存，**杀掉 app 重启 sessionId 不会丢**，下次 prompt 用 `--resume` 接上原 jsonl
- 项目目录注册到服务器 `~/.claude-web/projects.json`（任意设备的 backend 都能看到同一份项目列表）
- 重启 app → 自动恢复上次焦点对话 + 消息

**离线行为**：
- WS 断 → chip 显示"未连接"或"失败"，输入栏不能发新 prompt
- 但已加载的对话**仍可读** —— 都从本地 cache 来
- 重新连接后 backend 状态回来

**TTS 缓存**：
每条对话独立缓存最后一段语音 mp3。切到对话 A 听完一段 → 切到 B 发新内容 → 切回 A 重听按钮 ↻ 还在，按下播 A 的旧回答（不重调 Haiku）。

### Run Dashboard（运行中面板）

顶部标题旁的橙色数字 badge 现在**可点**——打开 [RunsDashboardSheet](packages/ios-native/Sources/ClaudeWeb/Views/RunsDashboardSheet.swift)：
- **进行中** 分组（橙点）：每行 spinner + 对话名 + 最近一次工具调用名/输入预览（Bash 显示命令首行，Edit/Read 显示文件 basename）+ elapsed 计时器（每 2s 自动刷新）
- **最近** 分组：按 lastUsed 倒序，最多 20 条
- 点行 → 切焦点到该对话（自动关闭）
- "停止"红丸 → `client.interrupt(convId:)` 中断后台 run，**不切焦点**，对话仍在原地

仅活跃运行 ≥1 时 badge 才出现；要单纯看历史，照样用 chip 切换器。

### 碎想 Inbox（💡 快速捕捉 + 分流）

InputBar 旁的 **💡 按钮** 弹 [InboxCaptureSheet](packages/ios-native/Sources/ClaudeWeb/Views/InboxCaptureSheet.swift)——纯文本 / 语音输入框 + 发送，**30 秒内能存下一个想法**是硬指标。POST `/api/inbox`，落到后端 `~/.claude-web/inbox.jsonl`（多设备共用一份）。

底部工具栏 **📥** 进 [InboxListView](packages/ios-native/Sources/ClaudeWeb/Views/InboxListView.swift)，两个 tab：
- **💡 碎想**：所有捕捉的想法
- **📥 当前队列**：当前对话的 prompt 队列（详见 [输入框增强](#输入框增强)）

碎想 tab 顶部两个开关：**只看未处理** / **含归档**（默认隐藏归档项）。

每条 row 带彩色 badge，4 种状态由 `status + processedIntoConversationId + triage` 组合 derive：

| Badge | 触发 | 含义 |
|---|---|---|
| 🟠 未处理 | 新捕捉 | 还没人管 |
| 🟢 已派给 Claude | 点 [派给 Claude] | 已转成新对话 prompt |
| 🔵 已分到 IDEAS | swipe / 长按 "分到 IDEAS" | 复制了 body 到剪贴板，等你手动粘到 [docs/IDEAS.md](docs/IDEAS.md) |
| ⚪ 已归档 | swipe / 长按 "归档" | `status="archived"`，默认隐藏，灰色删除线 |

**每条 row 的动作**（任选）：
- **swipe leading（左→右）→ 蓝色 "分到 IDEAS"**：UIPasteboard 复制 body + 后端打 triage 标签 + 顶部 toast `已复制 — 粘到 docs/IDEAS.md`。后端**绝不**自动改 docs（边界硬约束，对应 `HARNESS_ROADMAP.md §16.3 #1`），你需要自己粘
- **swipe trailing（右→左）→ 红色 "归档"**：`POST /api/inbox/:id/triage destination=archive`
- **长按（contextMenu）**：复制内容 / 分到 IDEAS / 归档 全部入口
- **[派给 Claude] 按钮**：仅 🟠 未处理状态出现，转新对话发 prompt 然后 `POST /api/inbox/:id/processed`

Backend 端点（给 web / 脚本用）：

| 端点 | 用途 |
|---|---|
| `POST /api/inbox` | 捕捉。`status` / `triage` 字段会被服务端拒绝（400），后端是它们的唯一写者 |
| `POST /api/inbox/:id/triage` | 分流。body `{destination: "ideas" \| "archive", note?}` |
| `GET /api/inbox/list?unprocessed=1&includeArchived=0&limit=50` | 列表 |

> Web 端 inbox UI 还没有（见 [docs/IDEAS.md](docs/IDEAS.md) P6），当前只能 `curl POST /api/inbox` 或走 iOS。

### Git 安全检查（完成后弹）

`session_ended(reason=completed)` 触发时，如果对话的 cwd 是 git 仓库且工作区有未提交修改，弹 [GitGateSheet](packages/ios-native/Sources/ClaudeWeb/Views/GitGateSheet.swift)：
- 顶部 chip：分支名（等宽）+ ahead/behind + "N 处变化"
- 三段：**已暂存** / **已修改** / **未跟踪**，每行带状态码彩色徽章（M 橙 / A 绿 / D 红 / R/C 紫 / U 粉 / ? 灰）+ 等宽文件路径
- **复制变更摘要** 按钮：写到剪贴板的纯文本格式 `XY <path>`（一行一个文件），方便贴 commit message
- 关闭即清掉 gate；下次完成会重新弹

仅完成（completed）触发；被打断（interrupted）/ 报错（error）不弹。开关在设置 → "Git 安全检查"，默认 ON。

### 附加上下文（paperclip）

InputBar 上 PhotoPicker 旁的 📎 → 打开 [ContextAttachSheet](packages/ios-native/Sources/ClaudeWeb/Views/ContextAttachSheet.swift)：
- **当前 git diff**（HEAD..worktree）：走 `/api/context/git-diff`，最大 200KB（超过截断并标记）。点击后注入为 `<git_diff cwd="…">…```diff…```</git_diff>` 块
- **剪贴板文本**：UIPasteboard 的纯文本，注入为 `<clipboard>…</clipboard>`

注入直接拼到 draft，与已有内容用空行分隔。**用户可见、可改、可删**，不走单独的 attachment 协议——发送前自己确认。

### 文件浏览（右侧抽屉）

主屏右侧边缘**右滑**，或点工具栏 🔎 按钮 → 打开当前 cwd 的文件抽屉（占屏宽 80%，最宽 320pt）。

- 树形浏览，点目录递进，`..` 上一级，↻ 刷新
- 文件按扩展名图标区分（swift / ts / py / md / 图片 / 视频 / 音频 …）
- 点文件 → 弹半屏预览 sheet：
  | 类型 | 渲染 |
  |---|---|
  | 文本（默认） | 等宽（代码扩展名）/ 普通衬线 |
  | `.md` | `AttributedString` 渲染（标题 / 列表 / 链接） |
  | `.png .jpg .gif .webp .heic .bmp .ico` | AsyncImage（走 `/api/fs/blob`，token 在 query） |
  | `.pdf .mp4 .webm .mov .mp3 .wav .m4a` | "尚不支持在 app 内预览" 占位 |
- 文件大小限制：文本 ≤ 1MB（`/api/fs/file`），二进制 ≤ 20MB（`/api/fs/blob`）
- 抽屉左滑或点遮罩关闭

### 前台 PTT（推按说话）

输入框右下圆形 mic 按钮：
- **按住** ≥ 250ms 说话，松手停录 → 上传 whisper 转写 → 文本进**输入框**等你审 → 点纸飞机发送
- **单击切换** < 250ms 点按 → 录音开关
- 第一次用会弹麦克风权限

**上滑取消**（参考微信交互）：
- 长按麦克风录音时屏幕中下方弹出**白底 HUD**，提示"↑ 上滑取消"
- 手指**上滑超过 80pt** → HUD 切红底，提示"松开取消"，**触觉反馈**确认（仅真机）
- 在红区松开 → 录音作废，不上传不发送
- 在白区松开 → 正常上传识别（原行为）
- 用于"说错了想重来"的场景；只取消当前录音，draft 保留

转写走 Mac 后端 `/api/voice/transcribe`（whisper-cli + 项目词表 + Haiku cleanup）。识别率比 SFSpeechRecognizer 高，但要后端在线。

### 语音模式（设置里的开关）

设置 ⚙️ → 顶部"语音模式"行点击切换。F1c2 之后从顶栏耳机按钮挪到了设置里（顶栏腾给项目+对话切换）。

进入语音模式后：
- PTT **不再进输入框，自动发送**（hands-free 优化）
- AVAudioSession 升级到 `.playAndRecord` + `.spokenAudio` + `.duckOthers`
- AirPods 路由到 mic + 扬声器，非 Claude 的音频被压低

退出回前台 review 模式。

### 后台保活（实验性）

设置里"实验功能"区块的开关。**默认关**。

**作用**：开了之后 app 一直播 0 音量循环音频 → iOS 不挂起 → **切其它 app 5 分钟回来 WebSocket 仍连着**。

**限制 / 注意：**
- Apple 视为对 background audio 的滥用 → **不要在 App Store 版本启用**（M5 上 TestFlight 时也别开），仅供 sideload 个人用
- iOS 仍可能在内存压力 / 网络切换 / 用户滑掉 app 时挂起，**不保证 100% 不断**
- 电池影响很小（0 音量信号处理）

**典型场景**：你在 Claude Voice 里发了一个 prompt，等回答的过程中切到 Safari 看个文档 → 1 分钟后切回来 → 答案已经回完，TTS 在等你重听。

### TTS 控制

顶部 chip 中段：
- **⏸ 暂停** / **▶ 继续** / **⏹ 停止**：在 TTS 播放期间显示
- **↻ 重听**：上一段播完后显示，**用缓存 mp3 直接重播**，不重调 Haiku
- 切对话 → 当前播放停（不会跨对话串音）；缓存仍在，切回去 ↻ 还能听

### 可用 / 不可用一览

| 场景 | 可用 |
|---|---|
| 前台文字聊天 | ✅ |
| 前台 PTT 录音 → 上传 → 编辑 → 发送 | ✅ |
| Claude 回答自动播报 TTS（晓晓声） | ✅ |
| 模型切换 Haiku / Sonnet / Opus | ✅ |
| 权限模式四档（含 Bypass） | ✅ |
| TTS 播放期间锁屏 / 控制中心看到 Now Playing 卡片 | ✅ |
| TTS 播放期间锁屏 play/pause 按钮控制 | ✅ |
| 语音模式自动发送（hands-free） | ✅ |
| 后台保活 → 切 app WS 不断 | ⚠️ 实验性，大多数情况可用 |
| 多对话并行（不同 cwd 或同 cwd 都行） | ✅ |
| 切对话不打断后台正在跑的 turn | ✅ |
| 切对话时停 TTS / 每对话独立 ↻ 缓存 | ✅ |
| 杀 app 重启恢复对话 + 消息 + sessionId 绑定 | ✅ |
| 项目跨设备共享列表（服务器 projects.json）| ✅ |
| DirectoryPicker 浏览 + 新建文件夹 | ✅ |
| 文件浏览右抽屉 + 文本/Markdown/图片预览 | ✅ |
| 设置 → 诊断页（CLI / 凭证 / whisper / ffmpeg / edge-tts / 注册表健康检查）| ✅ |
| 点 badge 看 Run Dashboard（活跃 + 最近 + 后台 stop）| ✅ |
| 完成后弹 Git 安全检查（dirty 工作区 + 复制摘要）| ✅ |
| InputBar 📎 附加 git diff / 剪贴板文本到 prompt | ✅ |
| 离线只读最近对话 | ✅（cache 命中）|
| **闲置语音模式 → 锁屏 → 用 play 按键启动新录音** | ❌ **iOS 平台限制** |
| **AirPods 长按柄触发 PTT** | ❌ Apple 不开放给 app |
| **后台麦克风长时间录音** | ❌ Apple 只发给 VOIP entitlement |
| 历史 jsonl session 浏览 / 一键 resume | ⏳ F1c4-c5 |
| 项目重命名 / 删除（iOS 内）| ⏳ F1c4 / web 端做 |

### 已知限制（不打算修）

1. **Now Playing 卡片只在 TTS 真在播时稳定显示**。idle 语音模式 + silent keepalive 也写了 metadata，但 iOS 不一定显示。这是平台行为（参考 [WWDC22 PushToTalk](https://developer.apple.com/videos/play/wwdc2022/10117/)），不投入修
2. **首次进入语音模式不自动开 keepalive**，要手动到设置开。设计如此（保活独立于语音模式）
3. **App 名"Seaidea"** 跟 Anthropic 官方"Claude" app 区分；图标暂用 Capacitor 占位
4. **新对话不发 prompt 也会写 cache**，便于"创建后切走再回来"。空对话 metadata 占用极小，不主动清理

### 故障排查

| 现象 | 排查 |
|---|---|
| 装上去打不开 | 设置 → VPN与设备管理 → 信任你的 Apple ID |
| 7 天后打不开 | 免费 cert 过期；插 USB 重跑 `./scripts/deploy.sh` |
| 顶部小圆点黄/红 | iPhone Tailscale 没开 / Mac backend 死 / 网络切换中 |
| 切其它 app 回来连接断 | 设置开"后台保活"；或接受偶尔重连 |
| TTS 没响 | 检查 iPhone 物理静音键、AirPods 路由 |
| 录音转写空 | 麦权限被拒 → 设置 → Seaidea → 麦克风 |
| 切到对话发现消息没了 | cache 没命中 / 对话刚被关；重新发 prompt 会以同 sessionId resume（如果绑过）|
| 项目分组 header 显示 "·未注册" | 服务器项目注册失败（backend 死过 / token 错）；下次有网时手动重发个 prompt 可触发再次注册 |
| Bypass 误开 | 主屏顶部红条提示；设置改回 Plan |
| 锁屏 play 按钮没反应 | 平台限制，不是 bug |

### 端内使用手册

设置 ⚙️ → "使用手册"。本文档（`docs/USER_MANUAL.md`）实时从后端 `/api/help` 读取并 Markdown 渲染：
- **离线可用** — 24 小时本地缓存，飞机模式下能查
- **永远最新** — 后端读源文件，新功能加进 `update-manual` 后立即可见，不用重发 iOS 版本
- **Web 端等价入口** — 浏览器右上角 ❓ 图标弹出同源内容，sessionStorage 缓存

### 诊断 / 健康检查

设置 ⚙️ → "诊断 / 健康检查"。打开后并发跑一次后端 `/api/health/full`，逐项渲染：

| 检查项 | 含义 |
|---|---|
| Claude CLI | `claude --version` 能跑 |
| Claude 订阅凭证 | `~/.claude/.credentials.json` **或** macOS Keychain `Claude Code-credentials` 存在 |
| whisper-cli | `whisper-cli --help` 退出 0 |
| Whisper 模型 | `~/.whisper-models/ggml-large-v3*.bin` 至少有一个 |
| ffmpeg | `ffmpeg -version` 能跑 |
| edge-tts | `edge-tts --help` 退出 0 |
| 项目注册表 | `~/.claude-web/projects.json` 所在目录可写 |
| Token 鉴权 | `CLAUDE_WEB_TOKEN` 是否已配（未配 = warn，公开暴露要配） |
| 路径白名单 | `CLAUDE_WEB_ALLOWED_ROOTS` 是否已配 |

每行绿/黄/红圆点 + detail + 修复 hint。底部还显示 backend node 版本、平台、已运行时长、app 版本/构建。

**复制脱敏诊断报告** 按钮：把状态汇总成纯文本贴到剪贴板（**只含主机名，不含 token**），出问题时贴到 issue。

### 埋点 / 调试日志

设置 ⚙️ 底部"调试 / 埋点"区块：
- **查看最近事件**：进 in-app 列表，倒序显示内存里 ring 的事件（最多 1000 条）
- **上次上报**：显示最近一次成功上报到后端的相对时间
- **立即上报**：触发一次 flush

事件写到后端 `~/.claude-web/telemetry.jsonl`（10 MB 滚动到 `.1`），Mac 上 `tail -f` / `jq` 排查。

iOS 埋点的关键事件（用于排查 bug）：
- `app.launch` / `app.foreground` / `app.background` / `app.terminate`
- `ws.connect.start` / `ws.connect.ok` / `ws.receive.failed`
- `route.orphan_runid` / `route.no_runid` / `route.conversation_missing` —— **路由 drop 信号**，并行对话或重连后出现说明有 bug
- `prompt.send` / `prompt.send.failed` / `prompt.send.not_connected`
- `session.bound`（systemInit 绑了 sessionId）
- `turn.completed` / `turn.error` / `turn.interrupted`
- `permission.request`
- `project.open` / `project.open.failed`
- `cache.decode.failed` / `cache.encode.failed` / `cache.lru.evicted`
- `registry.refresh.ok` / `registry.refresh.offline`

不捕：prompt 文本、回答内容、文件内容（PII）。捕：内部 ID（conversationId / sessionId / runId）、错误描述、HTTP 状态码、模型名 / 权限模式。

### 后续工作

- **F1c4** 抽屉 UX（项目侧栏，把切换器从 sheet 改成左侧 drawer；项目重命名 / 关闭）
- **F1c5** 历史 jsonl session 浏览 + 一键 resume
- **A6** 工具调用卡片（Edit/Bash/Read 各自卡片渲染）+ **A7** Markdown
- TestFlight 配置 + Apple Developer $99 订阅（M5）
- 真机长时间使用稳定性验证
- Mac mini 迁移（见 [docs/MAC_MINI_MIGRATION.md](docs/MAC_MINI_MIGRATION.md)）

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
