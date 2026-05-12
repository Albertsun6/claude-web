# Vessel macOS installer

`.pkg` 安装包：把 Vessel 后端（Hono + WebSocket + 前端静态资源 + bundle 的 Node 24）一键装到 `/usr/local/vessel/`，并通过 launchd 在登录时自动启动。

## 给打包者：本地构建一份 .pkg

前置条件：
- macOS（Apple Silicon 或 Intel；首版只构 arm64）
- 已装 `pnpm`（仓库根 `packageManager: pnpm@9.0.0`）
- 已装 `pkgbuild`（Xcode Command Line Tools 自带，`xcode-select --install`）
- 网络可达 `nodejs.org/dist/`（脚本自动下载 Node 二进制）

构建：

```bash
cd /path/to/Vessel
bash scripts/build-pkg.sh
```

产物：`dist/Vessel-Backend-v<version>-arm64.pkg`（约 120 MB）。

干净缓存：`rm -rf build/ installer/cache/`。

## 给用户：安装

1. 双击 `Vessel-Backend-v*.pkg`
2. 第一次打开 macOS 会拦未签名包，按提示操作：
   - **方法 A**：右键 .pkg → 打开（系统会再弹一次"仍要打开"确认）
   - **方法 B**：终端跑 `xattr -dr com.apple.quarantine ~/Downloads/Vessel-Backend-*.pkg` 然后再双击
3. 按引导一路 Next → 输入管理员密码 → 完成
4. 安装结束时，后端已经在跑：浏览器打开 `http://localhost:3030` 看到 Vessel UI 即成功
5. 如果桌面出现 `Vessel-需要补装的依赖.txt`，按里面的指引补装 `claude` / `ffmpeg` / `whisper-cli` / `edge-tts`，然后 `launchctl kickstart -k gui/$(id -u)/com.vessel.backend`

### 安装后产物路径

| 路径 | 内容 |
|---|---|
| `/usr/local/vessel/` | 后端代码 + bundle Node + 前端 dist + uninstall.sh |
| `~/Library/LaunchAgents/com.vessel.backend.plist` | launchd 启动单 |
| `~/Library/Logs/vessel-backend.{stdout,stderr}.log` | 运行日志 |
| `~/.claude-web/` | 运行时数据（telemetry / projects / harness.db） — 不归 installer 管 |

## 常用运维命令

```bash
# 查看运行状态
launchctl list | grep com.vessel.backend
# PID != 0 即正常

# 看日志
tail -F ~/Library/Logs/vessel-backend.stderr.log

# 重启后端
launchctl kickstart -k gui/$(id -u)/com.vessel.backend

# 临时停掉
launchctl bootout gui/$(id -u)/com.vessel.backend

# 重新启用
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.vessel.backend.plist

# 自定义环境变量（PORT、VESSEL_TOKEN、CLAUDE_CLI 等）
echo 'export PORT=3031' >> ~/.vessel.env
launchctl kickstart -k gui/$(id -u)/com.vessel.backend
```

## 升级

直接双击新版本 `.pkg`：preinstall 会先 `launchctl bootout` 旧实例，postinstall 再 `bootstrap` 新版本。`~/.claude-web/` 数据保留，schema 由后端自身的 [packages/backend/src/harness-store.ts](../packages/backend/src/harness-store.ts) 负责迁移。

## 卸载

```bash
sudo /usr/local/vessel/uninstall.sh
```

这会：
- `launchctl bootout` 当前实例
- 删除 `~/Library/LaunchAgents/com.vessel.backend.plist`
- 删除 `/usr/local/vessel/`
- `pkgutil --forget com.vessel.backend`

**保留**：`~/.claude-web/` 数据、`~/.claude/` 凭证、`~/.whisper-models/`。需要彻底清理就手动 `rm -rf` 它们。

## 故障排查

| 症状 | 排查 |
|---|---|
| 装完 `launchctl list` 没看到 `com.vessel.backend` | 看 `/var/log/install.log` 找 postinstall 报错 |
| 后端起不来，stderr log 报 `NODE_MODULE_VERSION` | bundle 的 Node 和 native module（better-sqlite3 等）ABI 不匹配。重新 build .pkg，确认 `scripts/build-pkg.sh` 走了 `npm rebuild` 这一步 |
| 后端起来了但 iOS 发现不了 | mDNS 受网络环境影响：确认 Mac 与 iPhone 同一 SSID、关闭"专用 Wi-Fi 地址"、用 `dns-sd -B _vessel._tcp` 验证后端是否在广播 |
| 报 `claude: command not found` | 桌面提示文件里的步骤还没做；装好 Claude Code CLI 后 `launchctl kickstart -k gui/$(id -u)/com.vessel.backend` |
| Mac 进了睡眠后 iPhone 连不上 | `KeepAlive=true` 不跨睡眠；要常驻服务跑 `sudo pmset -a sleep 0`（仅限插电的 Mac mini 之类的） |

## 设计文档

完整的 plan 与权衡见 `~/.claude/plans/vessel-macos-splendid-pnueli.md`（仓库外，开发者本地）。
