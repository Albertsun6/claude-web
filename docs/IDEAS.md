# 待做的想法

跟 Claude Code 拉齐 / 增强的功能清单。按价值排序。
所有项都已记录但**未实现**——需要时再开工。

---

## 高价值

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

## 已完成（参考）

详见 git log，主要里程碑：
- Phase 1-6: CLI subprocess、PWA、语音、文件树、Git、多项目并行
- Phase 7: per-tool permission via PreToolUse hook
- Phase 8: remote STT (Mac whisper) + edge-tts
- 安全: token + ALLOWED_ROOTS
- 性能: gzip + immutable cache + 懒加载 + 拆 chunk
- UX: tabs、history sessions、@file、TodoWrite UI、diff view、status bar、UsageMeter
- 自动化: 默认 Haiku、本项目永久 allow、CLAUDE.md banner、智能整理跳过
