# Mac mini 迁移清单

> 当 Mac mini 到位准备替代 MacBook 作为 24/7 backend 主机时，照这份清单跑。
> 目的：保留所有现有能力（语音转写 / TTS / 文件 / Git / 多项目），最小停机时间。

## 前置准备（在 Mac mini 上）

- [ ] 装 macOS（≥ 14 Sonoma 推荐，已验证 26.4 兼容）
- [ ] iCloud 账号登录 → Tailscale 同账号登录
- [ ] 安装 Xcode Command Line Tools：`xcode-select --install`
- [ ] 装 Homebrew：https://brew.sh
- [ ] 装 NVM + Node v24+：
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
  nvm install 24
  nvm use 24
  npm install -g pnpm
  ```
- [ ] 装外部依赖：
  ```bash
  brew install ffmpeg whisper-cpp tailscale
  pip3 install --user edge-tts        # 或 pipx install edge-tts
  ```

## 迁移步骤

### 1. claude CLI + 订阅凭证

- [ ] 装 claude CLI：[官方安装文档](https://docs.claude.com/en/docs/claude-code/setup)
- [ ] **重要**：claude 订阅一台机器一会话。在 Mac mini 上跑 `claude /login`，登录你的 Pro/Max 账号。**MacBook 上之前的 session 会自动失效**（无法两台并存）
- [ ] 验证：`claude /status` 显示订阅 + 不需要 API key
- [ ] 检查 `~/.claude/.credentials.json` 存在

### 2. 项目源码

```bash
# Mac mini 上
git clone https://github.com/Albertsun6/claude-web ~/claude-web
cd ~/claude-web
pnpm install
pnpm --filter @claude-web/frontend build
```

如果你想保持原 `Desktop/claude-web` 路径（很多设置写死了），改成：

```bash
git clone https://github.com/Albertsun6/claude-web ~/Desktop/claude-web
```

### 3. Whisper 模型

```bash
mkdir -p ~/.whisper-models
curl -fL -o ~/.whisper-models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

`resolveWhisperModel()` 会按 `large-v3.bin → large-v3-turbo.bin → large-v3-turbo-q5_0.bin` 顺序找最准的。装哪个用哪个。

### 4. launchd plist

把 MacBook 的 `~/Library/LaunchAgents/com.claude-web.backend.plist` 复制过去。**注意路径**：

如果项目路径变了（比如不在 Desktop 而是 home），要改 plist 里这两行：

```xml
<key>WorkingDirectory</key>
<string>/Users/yongqian/Desktop/claude-web</string>   <!-- 改成实际路径 -->

<key>ProgramArguments</key>
<array>
  <string>/bin/bash</string>
  <string>-lc</string>
  <string>exec /usr/bin/caffeinate -is /Users/yongqian/.nvm/versions/node/v24.12.0/bin/pnpm dev:backend</string>
  <!-- 改 pnpm 绝对路径成 Mac mini 的实际路径：which pnpm -->
</array>
```

加载：

```bash
cp /path/to/com.claude-web.backend.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.claude-web.backend.plist
```

验证：
- `launchctl list | grep claude-web` 有 PID
- `lsof -nP -iTCP:3030 -sTCP:LISTEN` 能看到 node 在监听
- `curl http://localhost:3030/api/auth/info` 返回 JSON

### 5. Tailscale serve（HTTPS 公开）

```bash
tailscale serve --bg --https=443 http://localhost:3030
tailscale serve status
# 应该显示：https://<mac-mini-hostname>.<tailnet>.ts.net (tailnet only)
#         |-- / proxy http://localhost:3030
```

新 hostname 取决于 Mac mini 在 Tailscale admin 里的名字（默认主机名）。如果你想保留 `mymac.tailcf3ccf.ts.net`：

- 老路径：admin 把 MacBook 改名（比如 `macbook-old`）
- Mac mini 改名 `mymac`

这样所有 iOS 客户端无需改 backend URL。

### 6. iOS app 设置

如果上面 hostname 保留 `mymac` 不变：**不用改任何东西**。

如果换 hostname：

- iOS app 设置 ⚙️ → Backend → 填新 URL（如 `https://macmini.tailcf3ccf.ts.net`）→ 完成 → 自动重连
- 桌面浏览器同理（输入新 URL）
- iOS app 默认值在 [Settings.swift:detectDefaultBackend](packages/ios-native/Sources/ClaudeWeb/Settings.swift) 写死了 mymac，可以改源码：
  ```swift
  return URL(string: "https://macmini.tailcf3ccf.ts.net")!
  ```
  然后重 build deploy

### 7. 桌面 web 验证

```bash
open https://<mac-mini-hostname>.<tailnet>.ts.net
```

- 看到 Claude 项目列表
- 发个 "你好" 测试 WS
- 试 PTT 录音 + TTS 播放

### 8. 安全（可选 / 推荐）

如果 Mac mini 24/7 在线 + Tailscale serve 公开，建议设 token：

```bash
# 编辑 plist
plutil -insert EnvironmentVariables.CLAUDE_WEB_TOKEN -string "$(uuidgen)" \
  ~/Library/LaunchAgents/com.claude-web.backend.plist

# 重启
launchctl unload ~/Library/LaunchAgents/com.claude-web.backend.plist
launchctl load -w ~/Library/LaunchAgents/com.claude-web.backend.plist
```

把生成的 UUID 填进：
- iOS app 设置 → CLAUDE_WEB_TOKEN
- 桌面浏览器：在 AuthGate 弹框里粘进去

也可以设 `CLAUDE_WEB_ALLOWED_ROOTS=/Users/yongqian/Desktop:/Users/yongqian/code` 限制可访问目录。

### 9. 关掉 MacBook 上的 backend

迁移完确认 Mac mini 工作 24+ 小时后：

```bash
# MacBook 上
launchctl unload ~/Library/LaunchAgents/com.claude-web.backend.plist
launchctl remove com.claude-web.backend
```

可保留 plist 文件作为备份。

## 验证清单（Mac mini 跑起来后）

- [ ] `curl http://localhost:3030/api/auth/info` OK
- [ ] iPhone Safari 访问 Tailscale URL OK
- [ ] iOS Claude Voice app 顶部小圆点绿色
- [ ] PTT 录音 → 转写 → Claude 回答 → TTS 播报全程通
- [ ] 工具调用（Default 模式）权限 sheet 弹出
- [ ] 文件 / Git 面板（桌面 web）能看到当前项目
- [ ] 背景保活开了，切到 Safari 5 分钟回来 WS 还连着

## 常见坑

| 现象 | 原因 / 修法 |
|---|---|
| pnpm 命令不存在 | `npm install -g pnpm` 或装 corepack |
| whisper-cli 报模型错 | 检查 `~/.whisper-models/` 模型文件 size 是否完整下载 |
| edge-tts 报 not found | `pip3 install --user edge-tts` 或 `pipx install`，然后 `which edge-tts` 看路径，可能要加进 plist 的 PATH |
| Tailscale serve 看着 OK 但 iPhone 连不上 | iPhone Tailscale 同账号登录、绿色 connected；iPhone Safari 测一下 URL 直接访问 |
| 之前的 sessionId 不见了 | jsonl 历史在 `~/.claude/projects/<encoded-cwd>/`，迁移时把这个目录也复制过去 |
| 切换后 MacBook claude CLI 一直不工作 | 订阅一次只能一台机；MacBook 不再用就好 |

## 用 Mac mini 之后的优势

| 项 | MacBook | Mac mini |
|---|---|---|
| 24/7 在线 | 合盖 / 出差时 backend 死 | 一直亮 |
| 后台保活需求 | 强（缓解 MacBook 不在的时段）| 弱（mini 在线，连接不易断）|
| 性能 | 共享给日常工作 | 独占 backend |
| 麦克风采样质量 | 用户笔记本麦不一定好 | 不录音用，无影响 |
