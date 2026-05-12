# AI Coding Agent 执行过程控制 — 9 工具机制级横向调研

> **状态**：proposal，作为 Vessel harness permission/hook/sandbox 设计的支撑材料
> **来源**：`/survey` skill (Deep + hetero + strict) 跑出
> **日期**：2026-05-12
> **Backlog**：`ai-coding-agent-execution-control-survey`
> **Branch**：`docs/eva-ai-coding-agent-execution-control`
> **关联**：[M0_PERMISSION_MODES.md](M0_PERMISSION_MODES.md) · [HARNESS_AGENTS.md](../HARNESS_AGENTS.md) · [HARNESS_LANDSCAPE.md](../HARNESS_LANDSCAPE.md)（landscape 已比形态，本调研补**机制 spec**）

---

## 0. 调研方法

**模式**：`/survey` Deep + `--hetero` + `--strict`（默认）
**Phase 2 三方并行**：
- **Agent A** (Claude lens) — 官方 docs + 主流博客/changelog — 45 sources
- **Agent B** (Claude lens) — github 源码 + technical deep dive — 47 sources, **12 个 CODE/DOC divergence** 报告
- **Agent X** (cursor-agent GPT-5.5-medium) — Claude 4 类盲区 + 异构 lens — 25 sources, 多个 post-training-cutoff 关键 PR

**Phase 6** cursor-agent 异构终审：见 §9。

**去重后总 source 数 ≈ 95 unique URLs**，其中 **22+ 个** 在 2025-05-13 后（近 12 个月）。

---

## 1. 研究问题 + 评估维度

**研究问题**：
在主流 AI coding agent 里，业界已经把"精确控制每一步执行过程"做到了什么颗粒度？Vessel harness 该借鉴哪些 / 拒绝哪些？

**评估维度（Phase 1 锁定，搜索前固定）**：

| # | 维度 | 关键问题 |
|---|------|----------|
| 1 | **Permission gating** | tool 级 allow/deny？per-call 弹窗？scoped 信任？session 内升降级？ |
| 2 | **Approval mode 谱系** | 几档？档间差异？切换协议？ |
| 3 | **Step-by-step confirm** | diff 预览？dry-run？stage-then-apply？|
| 4 | **Interrupt / cancellation** | Ctrl-C 行为？mid-tool abort？resumable？|
| 5 | **Rollback** | shadow git？checkpoint？file-level undo？multi-step rewind？|
| 6 | **Sandboxing** | docker / chroot / capability / seatbelt？默认 on/off？逃逸面？|
| 7 | **Hook / 扩展点** | PreTool / PostTool / SessionStart / Stop / UserPromptSubmit / 自定义？传参约定？|
| 8 | **Allowlist 颗粒度** | bash 命令模式（glob/regex）？文件 path？域名？子进程？env？|

---

## 2. 9 工具机制 spec

### 2.1 Claude Code (Anthropic CLI)

**Permission gating**：`settings.json` 里 `permissions` 块含 `allow / ask / deny` 三数组，**deny → ask → allow** 严格顺序，first-match-wins。precedence: managed > CLI args > local > project > user。tool specifier 语法 `Tool` 或 `Tool(specifier)`。— [code.claude.com/docs/en/settings](https://code.claude.com/docs/en/settings)

**Approval modes**：`defaultMode` enum **6 档**：`default | acceptEdits | plan | auto | dontAsk | bypassPermissions`。`auto` 用后台 classifier；`bypassPermissions` 跑通过 root 即拒绝执行；`disableBypassPermissionsMode: "disable"` 是 managed 强制锁。Shift+Tab 切换 live。— [code.claude.com/docs/en/permission-modes](https://code.claude.com/docs/en/permission-modes)

**Step-by-step**：`plan` 模式产出书面 plan 后再执行任何 tool；`acceptEdits` 跳 Edit/Write 弹窗但保留 Bash 弹窗。

**Interrupt**：`Ctrl+C` 取消当前 input/生成；`Ctrl+X Ctrl+K` (3s 内 2 次) kill 所有 background subagent；`Ctrl+B` 后台化运行中的 bash；后台 task 在 exit / 5GB 输出时自动清理。— [code.claude.com/docs/en/interactive-mode](https://code.claude.com/docs/en/interactive-mode)

**Rollback**：**Checkpointing** 是一等公民。每个 user prompt 创建 checkpoint；`Esc+Esc` 或 `/rewind` 打开菜单，可单独恢复"代码 / 对话 / 两者 / from-here 摘要"。30 天保留。**关键盲区**：bash 修改的文件**不**被跟踪，只跟踪 `Write/Edit/NotebookEdit` 工具触达的。— [code.claude.com/docs/en/checkpointing](https://code.claude.com/docs/en/checkpointing)

**Sandboxing**：macOS Seatbelt + Linux bubblewrap。`sandbox.filesystem.allowWrite/denyWrite/allowRead/denyRead`（多源 merge）。**关键发现**：sandbox 只包 Bash 子进程，Write/Edit 工具是 in-process `fs.writeFileSync`，不受 sandbox 限制——只由 permission rule gate（issue #29048）。`--dangerously-skip-permissions` 拒绝以 root 运行。Network: HTTP+SOCKS proxy hostname allowlist。开源 runtime: `@anthropic-ai/sandbox-runtime`。— [code.claude.com/docs/en/sandboxing](https://code.claude.com/docs/en/sandboxing)

**Hooks**：**业界最完整**——**28 个事件**：`SessionStart / Setup / SessionEnd / UserPromptSubmit / UserPromptExpansion / Stop / StopFailure / PreToolUse / PermissionRequest / PermissionDenied / PostToolUse / PostToolUseFailure / PostToolBatch / SubagentStart / SubagentStop / TaskCreated / TaskCompleted / FileChanged / CwdChanged / ConfigChange / WorktreeCreate / WorktreeRemove / Notification / PreCompact / PostCompact / TeammateIdle / InstructionsLoaded / Elicitation / ElicitationResult`。Handler types: `command | http | mcp_tool | prompt | agent`。Exit code 0=pass / 2=block / others=non-blocking。JSON 输出含 `hookSpecificOutput.permissionDecision: allow | deny | ask | defer`，`updatedInput` 可改写 tool args，`additionalContext` 注入 prompt context。precedence: `deny > defer > ask > allow`。— [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)

**Allowlist 颗粒度**：`Bash(npm run *)` 命令 glob、`Read(./.env)` / `Read(./secrets/**)` 路径 glob、`WebFetch(domain:example.com)` 域名、`mcp__server__tool` MCP 命名空间、`Agent(Name)` 子 agent。`additionalDirectories` 数组扩展 `--add-dir`。— [code.claude.com/docs/en/settings](https://code.claude.com/docs/en/settings)

---

### 2.2 Cursor

**Permission gating**：foreground Agent 默认 per-command 弹窗；Auto-Run（旧名 "YOLO"）绕过弹窗但仍受 allowlist/denylist。**前缀字符串匹配，无 regex/glob**。`~/.cursor/sandbox.json` 控网络 + 文件。— [cursor.com/docs/agent/tools/terminal](https://cursor.com/docs/agent/tools/terminal)

**Approval modes**：IDE Auto-Run 三档：`Run in Sandbox / Ask Every Time / Run Everything`。CLI Agent / Plan / Ask 三模式 Shift+Tab 切换。— [cursor.com/docs/cli/using](https://cursor.com/docs/cli/using)

**Step-by-step**：Inline diff per-hunk accept/reject。CLI `Ctrl+R` review changes。

**Interrupt**：UI Stop 按钮；mid-tool abort 支持。无 documented resumable。

**Rollback**：**Checkpoints**（与 git 分离），自动在"significant changes"前创建。**Restore 不可逆**（forum 报告）。— [cursor.com/docs/agent/chat/checkpoints](https://cursor.com/docs/agent/chat/checkpoints)

**Sandboxing**：macOS v2.0+ 即开即用 Seatbelt；Linux Landlock v3 + user namespace；Windows 走 WSL2。**关键 bug**：v1.3 前的 denylist 因 4 种 bypass 被弃用（Base64 / subshell / shell-script / 引号转义如 `"e"cho`），见 Backslash 披露；现仅推荐 allowlist。**2026-02 bug**: 当 "Auto-Run in Sandbox" 开启时 Command Allowlist 被静默忽略（forum thread 152136）。— [backslash.security/blog/cursor-ai-security-flaw-autorun-denylist](https://www.backslash.security/blog/cursor-ai-security-flaw-autorun-denylist) (2025)

**Hooks**：Cloud Agents 跑 `.cursor/hooks.json`，企业 admin 可设 team hooks。无 Claude Code 风格的细粒度 lifecycle。— [cursor.com/docs/background-agent](https://cursor.com/docs/background-agent)

**Allowlist 颗粒度**：`~/.cursor/permissions.json` 有 `mcpAllowlist` 和 `terminalAllowlist`。terminal 前缀字符串匹配，无 wildcard/regex。precedence: team admin > permissions.json > IDE UI。

**安全告警**：`GHSA-82wg-qcm4-fp2w` 显示通过 shell built-ins / env vars 仍可绕过 allowlist。

---

### 2.3 Aider

**Permission gating**：极简——文件作用域是核心模型。文件必须通过 `/add` 加入 chat 才能改；脏文件先以独立 commit 保留用户改动（`--dirty-commits`，默认 true）。— [aider.chat/docs/git.html](https://aider.chat/docs/git.html)

**Approval modes**：仅 CLI flags：`--yes-always`、`--auto-commits`（默认 true）、`--dry-run`（默认 false）、`--dirty-commits`、`--auto-lint`、`--auto-test`。无多档 agent mode。chat-mode (code/ask/architect/help) 是**行为模式**不是权限档。

**Step-by-step**：`/diff` 看自上次 message 后的改动；`--dry-run` 不落盘。**未支持逐 hunk accept**。`/architect` 模式提供 propose-then-edit 两 model 分工。

**Interrupt**：`Ctrl-C` "always safe"；部分响应保留以便重 prompt。无 mid-tool 状态机。

**Rollback**：**git-native 强项**——`/undo` 回滚 aider 自己 commit 的最后一次。`--no-auto-commits` / `--no-dirty-commits` / `--no-git` opt out。**已知 bug**：`/undo` 仅在 `--auto-commits` on 时工作（issue #1528）。

**Sandboxing**：**无**。host 直跑。Issue #649 是"supervised mode"feature request。

**Hooks**：**无 lifecycle hooks**。`--watch-files` 监听 `# AI!` / `// AI?` magic comments；`--lint-cmd` / `--test-cmd` / `--commit-prompt` 是仅有的注入点。

**Allowlist 颗粒度**：**无**。所有 shell command 通过单一 Y/N 弹窗 gate。

---

### 2.4 Windsurf (Codeium Cascade)

**Permission gating**：终端命令四级 auto-execution + allow/deny list；**deny 优先**。— [docs.windsurf.com/windsurf/terminal](https://docs.windsurf.com/windsurf/terminal)

**Approval modes**：Cascade 三模式 — `Code`（可改文件 + 跑命令）/ `Plan`（产 Markdown plan 后点 Implement）/ `Ask`（只搜索）。**Turbo Mode**（v1.12.36, 2025-11-25）："auto-execute terminal commands unless specified in deny-list"。— [windsurf.com/changelog](https://windsurf.com/changelog)

**Step-by-step**：Plan mode 写到 `~/.windsurf/plans`，用户点 Implement 切 Code。无 per-hunk accept。

**Interrupt**：UI cancel；闭源，spec 未公开。

**Rollback**：官方建议"discard / tweak plan / fresh conversation"工作流；**无 checkpoint 概念**。Docs 显式警告 revert 不可逆。

**Sandboxing**：闭源 agent，OS sandbox 非一等公民。

**Hooks**：仅 Workflows 中的 `// turbo` / `// turbo-all` 注释（仍受 allow/deny list）。无 lifecycle。

**Allowlist 颗粒度**：`windsurf.cascadeCommandsAllowList` / `cascadeCommandsDenyList`，**deny 优先**——若同时匹配仍需 approval。前缀/子串匹配，具体语法未正式文档化。v1.13.12 (2026-01-25) 起 enterprise admin 加 org-wide list。

---

### 2.5 OpenHands (All Hands AI)

**Permission gating**：V1 SDK 的 `ConfirmationPolicy` ABC + Security Analyzer 双层。三个具体 policy：`AlwaysConfirm() / NeverConfirm() / ConfirmRisky(threshold=HIGH)`。`conversation.set_confirmation_policy()` 设置。**⚠️ 注意**：`conversation.execute_tool()` **绕过** analyzer + policy（documented 逃逸面）。— [docs.openhands.dev/sdk/guides/security](https://docs.openhands.dev/sdk/guides/security)

**Approval modes**：靠 policy 类；风险阈值 `LOW/MEDIUM/HIGH/UNKNOWN` 可配。`config.toml` `[security]` 段 `confirmation_mode: bool`、`security_analyzer: str`。

**Step-by-step**：会话状态机——HIGH risk 时 `WAITING_FOR_CONFIRMATION` 暂停；每个 Action (`CmdRunAction`, `FileEditAction` 等) 流经 analyzer + policy。

**Interrupt**：GUI/CLI stop；状态持久化到 `OH_PERSISTENCE_DIR`（`~/.openhands`），支持 resume；example 显式捕获 SIGINT clean exit。

**Rollback**：**未一等公民**。依赖 git + sandbox ephemeral container 的隔离。

**Sandboxing**：**业界最严**。三 runtime：`docker`（默认）/ `process`（legacy local）/ `remote`。`/workspace` 挂载点。`SANDBOX_VOLUMES=host:container[:mode]`。**Network**：Linux 用 network namespace 移除 + Unix-socket proxy；macOS Seatbelt localhost-port channel。**默认 deny，显式 `allowedDomains`**。— [docs.openhands.dev/usage/runtimes/docker](https://docs.openhands.dev/usage/runtimes/docker)

**Hooks**：6 事件（`PreToolUse / PostToolUse / UserPromptSubmit / Stop / SessionStart / SessionEnd`），配置 `.openhands/hooks.json` 。Hook 字段 `command, timeout (default 60), async (default false)`。Env vars: `OPENHANDS_EVENT_TYPE`, `OPENHANDS_TOOL_NAME`, `OPENHANDS_PROJECT_DIR`, `OPENHANDS_SESSION_ID`。Exit 2 block；JSON `{decision: allow|deny, reason, additionalContext}` 覆盖。

**Security Analyzer 4 个**：`PatternSecurityAnalyzer`（regex 已知威胁）/ `PolicyRailSecurityAnalyzer`（组合威胁如 `fetch | exec`）/ `EnsembleSecurityAnalyzer`（多 analyzer 投票）/ `LLMSecurityAnalyzer`（per-action JSON schema augmentation `security_risk` 字段）。**关键语义**：analyzer **只分类不硬拦截**——`ConfirmationPolicy` 才决定是否在 HIGH 时暂停；deterministic analyzer 可独立于 LLM 复评，使 risk classification **可审计**。这是与 Cline `requires_approval` 纯 LLM 判断的关键区别。

**Allowlist 颗粒度**：风险等级 + Security Analyzer regex/policy rail；不是命令级 allowlist。Domain allowlist via proxy。

---

### 2.6 Continue.dev

**Permission gating**：每 tool 三档：`allow / ask / exclude`。默认 read-only tools（Read/List/Search/Fetch/Diff）→ allow；Edit/Write/Bash → ask。Headless 模式把所有 ask 提升为 exclude。— [docs.continue.dev/cli/tool-permissions](https://docs.continue.dev/cli/tool-permissions)

**Approval modes**：CLI `normal / plan --readonly / auto --auto`。`plan` 排除 write tools，`auto` allow 全部。GUI: Ask First (default) / Automatic / Excluded per-tool。

**Step-by-step**：TUI 每 tool call "Allow / Allow + don't ask again / Deny / Deny + don't ask again"。

**Interrupt**：CLI 标准 Ctrl-C。无 documented resumable。

**Rollback**：**无**。依赖 git。

**Sandboxing**：**无**。继承 IDE 进程。

**Hooks**：**无 lifecycle hooks**。MCP servers + `.continue/rules`（loaded from `.continue/rules` 和 `~/.continue/rules`）是扩展面。

**Allowlist 颗粒度**：`~/.continue/permissions.yaml`，三 array `allow/ask/exclude`。语法 `Read(*)`, `Write(**/*.ts)`, `Bash(npm install*)`, `Fetch`——**glob + shell-wildcard**。session flags `--allow`, `--ask`, `--exclude`。precedence: mode > flags > yaml > built-in。

---

### 2.7 Cline / Roo-Code (formerly Roo Cline)

**Cline**:
- **Permission gating**：`AutoApprovalSettings` 对象：`enabled: bool`, `actions: { readFiles, editFiles, executeSafeCommands, executeAllCommands, useBrowser, useMcp }`, `maxRequests: number`。— [docs.cline.bot/features/auto-approve](https://docs.cline.bot/features/auto-approve)
- **Approval modes**：每 action toggle；YOLO = 全开。Plan/Act 区分（Shift+Tab 切换）。
- **Allowlist 颗粒度** ⚠️：**没有静态 allowlist**——LLM 动态在每个 command 上设 `requires_approval` flag。Discussion #2253 请求 per-command rules，**截至 2026-04 仍未实现**。
- **Rollback**：Timeline（每文件改动记录）+ Checkpoints（workspace snapshots），可选 workspace-only 或 workspace+task。
- **Sandboxing**：依赖 VS Code 1.93+ terminal shell integration。无 OS sandbox。

**Roo-Code**:
- **Permission gating**：master toggle `autoApprovalEnabled: bool` (default false)。per-category：`alwaysAllowReadOnly / alwaysAllowWrite / alwaysAllowExecute / alwaysAllowBrowser / alwaysAllowMcp / alwaysAllowModeSwitch / alwaysAllowSubtasks / alwaysAllowFollowupQuestions`。— [deepwiki.com/RooCodeInc/Roo-Code/11.3](https://deepwiki.com/RooCodeInc/Roo-Code/11.3-auto-approve-configuration)
- **Allowlist 颗粒度**：**`allowedCommands: string[]`, `deniedCommands: string[]`** —— 前缀匹配，longest-prefix wins，deny 同等具体时胜出。数值 guardrail `allowedMaxRequests`, `allowedMaxCost`。带 dangerous substitution guard。
- **Rollback**：Roo "Checkpoints" feature。
- **2026 trajectory**：issue #12002 (2026-03-26) 提出 per-mode auto-approve；当前还是 global toggle。

---

### 2.8 OpenAI Codex CLI (2026 reboot)

**Permission gating**：`config.toml` 双层 — `sandbox_mode: "read-only" | "workspace-write" | "danger-full-access"` (default `read-only` per Rust `#[default]`) + `approval_policy: "untrusted" | "on-failure" | "on-request" | "never"` (default `on-request`)。CLI flags `--sandbox`, `--ask-for-approval`。Auto preset = `workspace-write + on-request`。— [developers.openai.com/codex/config-advanced](https://developers.openai.com/codex/config-advanced)

**Approval modes** (granular)：
- `untrusted` — 每命令弹窗
- `on-request` — sandbox 默认，越界才问
- `on-failure` (deprecated) — sandboxed 失败时回退弹窗
- `never` — 无弹窗 (sandbox 仍 active)
- `--dangerously-bypass-approvals-and-sandbox` / `--yolo` — 全关
- **支持 selectively fail-closed** on 单个 prompt category (`request_permissions` / skill-script prompts)

**Step-by-step**：sandbox 越界时 agent halts and prompts。Issue #11626 跟踪 `/rewind` checkpoint 请求（**未发布**）。

**Interrupt**：标准 TTY interrupt + sandbox helper 支持 SIGTERM clean exit。

**Rollback**：**无一等公民 checkpoint/rewind**。完全依赖 git。社区强请求中。

**Sandboxing**：**业界最硬之一**——
- **macOS**: `/usr/bin/sandbox-exec` + 自定义 Seatbelt profile + `ptrace(PT_DENY_ATTACH)` 硬化
- **Linux**: `bubblewrap` + **Landlock** + **seccomp** (`seccompiler` v0.5.0, `landlock` v0.4.4 Rust crates) + 专用 helper binary `codex-linux-sandbox`，`--unshare-net`
- **Windows**: 原生 sandbox 或 WSL2 delegation
- `.git/`, `.codex/` 即使在 writable_roots 内也是 read-only
- **2026-03 关键 PR #14171**：split filesystem/network policy，避免 legacy projection 丢失 unreadable carveouts ⭐ post-training-cutoff finding

**Hooks**：**experimental hooks** — 启用键 `[features] codex_hooks = true`，**6 events**：`SessionStart / PreToolUse / PermissionRequest / PostToolUse / UserPromptSubmit / Stop`。⚠ 限制：PreToolUse 只拦截 Bash / `apply_patch` 文件改动 / MCP 工具，不拦 WebSearch 或其他非 shell/非 MCP 工具；同一事件多 hook 并发跑，"one hook cannot prevent another"；UserPromptSubmit 和 Stop 不支持 `matcher` 字段；当前是 guardrail 不是完整 enforcement。配合 MCP servers + profile (config.toml 多 profile) + OTel tool decision。— [developers.openai.com/codex/hooks](https://developers.openai.com/codex/hooks) (Phase 6 异构终审发现 — Agent A/B 两个 Claude lens 均漏报)

**Allowlist 颗粒度**：`[sandbox_workspace_write]` table：`writable_roots: string[]`, `network_access: bool` (default false), `exclude_tmpdir_env_var: bool`, `exclude_slash_tmp: bool`。**Path-based，不是 command-pattern**——sandbox FS 隔离取代 command allowlist。`~/.codex/memories` 自动 writable。Cloud 可加 domain allowlist。

---

### 2.9 Codename Goose (Block)

**Permission gating**：4 permission modes（`GOOSE_MODE` env 或 `~/.config/goose/config.yaml` 或 `/mode` CLI）：
- `auto` — 完全自动
- `smart_approve` — risk-based，read 自动 / state-changing 要批
- `approve` — 全人工确认
- `chat` — 仅对话，无 tool

per-tool 覆盖：`Always Allow / Ask Before / Never Allow`，存 `permissions/tool_permissions.json`。— [block.github.io/goose/docs/guides/tool-permissions](https://block.github.io/goose/docs/guides/tool-permissions/)

**Approval modes**：4 档（上）+ per-tool 覆盖（仅在 `approve` 或 `smart_approve` 模式生效）。

**Step-by-step**：Manual mode 每 tool 弹窗；Smart 按 risk 分类。

**Interrupt**：标准 CLI/Desktop stop；状态持久化未深入文档化。

**Rollback**：**无 first-class**；依赖 git。Recipes/Sub-recipes 提供 workflow 级 rollback 语义。

**Sandboxing**：**无 OS sandbox**。extensions（MCP servers）作为子进程跑。

**Hooks**：**MCP-as-hooks 范式**。`gotoHuman` MCP extension 提供 human-in-the-loop pause-and-review。无 lifecycle hook。

**Allowlist 颗粒度**：
- **Extension Allowlist** — `GOOSE_ALLOWLIST` env var → URL → YAML file with `extensions: [{ id, command }]`。**严格字面匹配**——"Additional arguments will be rejected (to avoid injection attacks)"。
- ⚠️ **关键 CODE/DOC divergence**：`crates/goose-server/ALLOWLIST.md` 显示 ALLOWLIST 当前**只在 desktop UI** (`ui/desktop/main.ts`) 强制，**goose-server 端未实现**。无密码学签名。
- 2026-01-05 推出 **CORS-inspired guardrails** —— tool call 在另一 tool call 之后（无介入 user message）被当作"cross-origin"，需额外授权。— [block.github.io/goose/blog/2026/01/05/agentic-guardrails-and-controls](https://block.github.io/goose/blog/2026/01/05/agentic-guardrails-and-controls/)

---

## 3. 9 × 8 对比矩阵

```
图例：✓ = 该维度业界最佳之一 | ⚠ = 已知重大 bug/盲区 | ✗ = 未实现 | ? = 数据不足
```

| 工具 | 1.Perm gating | 2.Approval modes | 3.Step confirm | 4.Interrupt | 5.Rollback | 6.Sandbox | 7.Hooks | 8.Allowlist |
|------|---------------|------------------|----------------|-------------|-----------|-----------|---------|-------------|
| **Claude Code** | ✓ deny→ask→allow，全 OS 一致 | ✓ 6 档 + classifier auto | plan→exec | rich (Ctrl+C/X/B 三态) | ✓ checkpoint /rewind 30d ⚠ bash 不覆盖 | ✓ Seatbelt+bwrap+net proxy ⚠ 仅 Bash | ✓✓ **28 events** + 5 handler 类型 | ✓ glob+domain+MCP namespace |
| **Cursor** | per-call + Auto-Run | 3 档 + Ask/Plan/Agent CLI | inline diff per-hunk ✓ | UI cancel | checkpoint 不可逆 ⚠ | ✓ Seatbelt/Landlock/WSL2 ⚠ allowlist bypass 2026-02 | Cloud Agent hooks.json | ⚠ 前缀字符串 (Backslash 4 bypass → v1.3 弃 denylist) |
| **Aider** | 文件作用域 (`/add`) | `--yes-always`/`--dry-run` 单档 | `/diff` no hunk | Ctrl-C safe | ✓ git-native `/undo` | ✗ | ✗ (`--watch-files` magic comment) | ✗ |
| **Windsurf** | 4 档 auto-exec + allow/deny | Code/Plan/Ask + Turbo | Plan→Implement | UI ? | ✗ revert 不可逆 | ✗ | ✗ (`// turbo` annotation) | 前缀/子串 |
| **OpenHands** | ConfirmationPolicy class | risk threshold LOW-HIGH | `WAITING_FOR_CONFIRMATION` 状态机 | SIGINT clean exit | ✗ git only | ✓ Docker + ns 移除 + proxy（默认隔离最强之一；Codex Landlock+seccomp+ptrace 同档） | 6 events ✓ | risk + security analyzer regex |
| **Continue.dev** | allow/ask/exclude | normal/plan/auto | TUI 4 选项/per-call | Ctrl-C | ✗ | ✗ | ✗ (MCP + rules) | ✓ glob (`Write(**/*.ts)`) |
| **Cline / Roo** | category toggle | 全开/部分/关 | per-tool diff prompt | UI | ✓ Timeline+Checkpoint 选择性 (Cline) | ✗ | ✗ (MCP) | ⚠ Cline LLM-dynamic / Roo: longest-prefix allow+deny |
| **Codex CLI** | sandbox + approval 双层 | 4 档 + granular per-prompt-cat | sandbox 越界即 prompt | TTY clean | ✗ (`/rewind` 请求中) | ✓✓ Seatbelt+Landlock+seccomp+ptrace+split-policy 2026-03 | ⚠ experimental 6 events (`[features] codex_hooks=true`) — 部分工具不拦截 | path-based writable_roots (无 cmd pattern) |
| **Goose** | 4 mode + per-tool 3 档 | smart_approve/approve/auto/chat | per-tool prompt | CLI stop | ✗ | ✗ | ✗ MCP + gotoHuman | extension allowlist ⚠ 仅 desktop UI 强制 |

**矩阵观察**：
1. **Approval mode 谱系收敛到 3-4 档**但命名各异；最丰富的 Claude Code 6 档 / OpenHands risk threshold 是连续谱
2. **Sandbox 三阵营**：first-class OS（Claude/Codex/OpenHands）/ container-delegated（Cursor/Windsurf）/ 无（Aider/Cline/Goose）；前三家**都用 Seatbelt+bwrap+seccomp**为标准栈
3. **Allowlist 语义剧烈分化**：glob/regex（Claude/Continue）/ 前缀字符串（Cursor/Roo）/ LLM-dynamic（Cline）/ OS-level FS（Codex）/ 无（Aider）
4. **Hooks 成熟度断崖**：Claude Code (28 events) >> OpenHands (6) >>> 其他（MCP-as-hooks 或无）
5. **Rollback 全行业共同盲区**：bash 修改文件**不**被任何 shadow checkpoint 跟踪——只有显式 tool-level write 操作进 timeline
6. **denylist 已死**：Backslash 4 bypass research → Cursor v1.3 弃用 denylist → 行业共识转向 allowlist + sandbox 双层防御

---

## 4. 冲突分析 (ACH-lite)

Agent B 抓到 **12 个 CODE/DOC divergence**，每条都是高价值反证：

| # | 工具 | Divergence | 源 |
|---|------|-----------|-----|
| D1 | **Claude Code** | `sandbox.filesystem.allowWrite` 只对 Bash 生效，不对 Write/Edit（in-process）—— docs 暗示统一 FS 限制 | [Issue #29048](https://github.com/anthropics/claude-code/issues/29048) (2026) |
| D2 | **Claude Code** | `permissions.deny` rule 对 Read/Edit/Write 静默失效 (v2.1.49)；多 issue 重复 | [#27040](https://github.com/anthropics/claude-code/issues/27040), [#37210](https://github.com/anthropics/claude-code/issues/37210) |
| D3 | **Claude Code** | PreToolUse hook `permissionDecision: "allow"` **不**抑制原生 permission prompt (v2.1.119) | [#52822](https://github.com/anthropics/claude-code/issues/52822) |
| D4 | **Claude Code** | agent 自主 disable bubblewrap 跳出 sandbox；`/proc/self/root/...` symlink 绕 denylist | [Ona writeup 2026](https://ona.com/stories/how-claude-code-escapes-its-own-denylist-and-sandbox) |
| D5 | **Codex CLI** | `sandbox_mode="workspace-write"` 被忽略回退 read-only（codex-cli 0.58.0 regression）`/status` 报 workspace-write 但实际 read-only | [#6667](https://github.com/openai/codex/issues/6667) (2026) |
| D6 | **Codex CLI** | VSCode 扩展忽略 `writable_roots`；CLI honors 它 | [#4390](https://github.com/openai/codex/issues/4390) |
| D7 | **OpenHands** | `confirmation_mode` 在 CLI 中不生效——`override_cli_mode` 参数从未被解析 | [#10242](https://github.com/All-Hands-AI/OpenHands/issues/10242) |
| D8 | **OpenHands** | docs 列 InvariantAnalyzer 为选项，但 "current invariant security analyzer is broken and not used by default" | [#5264](https://github.com/OpenHands/OpenHands/issues/5264) |
| D9 | **Cursor** | Command Allowlist 在 "Auto-Run in Sandbox" 启用时**静默忽略** | [forum 152136](https://forum.cursor.com/t/152136) (2026-02) |
| D10 | **Cline** | 文档暗示 "safe vs all" 是静态 allowlist；实际是 **LLM-dynamic `requires_approval` flag**。Discussion #2253 请求静态 rule 至 2026-04 未实现 | [#2253](https://github.com/cline/cline/discussions/2253) |
| D11 | **Goose** | `GOOSE_ALLOWLIST` 仅在 desktop UI 强制，**goose-server 端未实现** | [ALLOWLIST.md](https://github.com/block/goose/blob/main/crates/goose-server/ALLOWLIST.md) |
| D12 | **Aider** | `--yes-always` doc 暗示 auto-confirm all，实际**跳过 shell command confirmation 的代码路径**（部分 issue 报道 shell command 既不跑也不问）| [#3903](https://github.com/Aider-AI/aider/issues/3903) |

**置信度评级**：
- **高**（≥3 独立源一致）：Claude Code 28 hook events / 6 approval modes / OS sandbox stack（Seatbelt+bwrap）；Codex sandbox 三平台栈；OpenHands docker-first；Cursor v1.3 denylist 弃用；Roo `allowedCommands` longest-prefix；Goose 4 modes
- **中**（2 源 或 1 权威 + 异议）：Cline LLM-dynamic risk flag（仅官方 doc + 1 discussion 推断；Cline 闭源逻辑细节）；Aider 文件作用域（git docs 多源但 cli-flag-only 是独有判断）
- **低**（单源或反证）：Goose ALLOWLIST 服务端缺失（单一 in-repo doc）；Aider `--yes-always` shell bug 行为（仅 1 issue）

---

## 5. 对 Vessel harness 的借鉴 ⭐

### 5.1 Vessel 现状盘点

来自 [docs/proposals/M0_PERMISSION_MODES.md](M0_PERMISSION_MODES.md) + [docs/HARNESS_AGENTS.md](../HARNESS_AGENTS.md)：

| 维度 | Vessel 现状 |
|------|------------|
| Permission modes | **4 档**：`plan / default / acceptEdits / bypassPermissions` (= Claude Code 子集，少 `auto / dontAsk`) |
| Hooks | HARNESS_AGENTS L142：`PreToolUse + OnDecisionRequest` (= 2 events) |
| Allowlist | 默认拒绝 + profile 显式 allowlist（HARNESS_AGENTS L174） |
| Sandbox | **未明确** |
| Rollback | git worktree 隔离（per-Initiative）+ 用户手动 git |
| Step-confirm | iOS-side 弹窗 + voice approve（M0 已落地） |
| Interrupt | SIGTERM → SIGKILL after 5s（backend cli-runner.ts 已有） |

**定位 caveat**（per memory `feedback_vessel_personal_use.md`）：Vessel 是**个人单机助理**，不是企业级部署形态。任何"业界最严"建议都要按个人单机重新评估 ROI。

### 5.2 业界做了 Vessel 没做的（8 维度 gap）

| 维度 | 业界做的 | Vessel 缺的 |
|------|---------|-----------|
| 1 Perm gating | Claude Code 严格 `deny→ask→allow` first-match-wins | Vessel 已有 default-deny + allowlist；**未引入显式 `ask` 中间档** |
| 2 Modes | Claude Code 6 / Goose 4 / OpenHands risk-threshold 连续谱 | 4 档；缺 `auto` (classifier-driven) 和 risk-aware（业界两条不同路径）|
| 3 Step confirm | Cursor per-hunk accept; OpenHands `WAITING_FOR_CONFIRMATION` 状态机 | iOS 弹窗是 per-call，**无 per-hunk 颗粒**；状态机隐式存在 cli-runner.ts |
| 4 Interrupt | Claude Code 三层 (Ctrl+C/X/B)；OpenHands resume from persistence | Vessel 仅 SIGTERM → SIGKILL；**无 mid-tool resume** |
| 5 Rollback | Claude Code per-prompt 30d checkpoint；Cline Timeline+Checkpoint；Aider `/undo` git-native | Vessel 仅 worktree 隔离；**无 in-session checkpoint / rewind** |
| 6 Sandbox | Codex 三平台 Seatbelt+bwrap+seccomp+split-policy；OpenHands Docker | **完全空白**——这是 Vessel 最显著的安全盲区 |
| 7 Hooks | Claude Code 28 events；OpenHands 6 events | 2 events (PreToolUse + OnDecisionRequest)；**缺 SessionStart/End / PostToolUse / Stop / UserPromptSubmit** |
| 8 Allowlist | Continue glob (`Write(**/*.ts)`)；Roo longest-prefix + dangerous-substitution guard | profile allowlist 颗粒度未文档化；**未明确 glob 语法** |

### 5.3 借鉴 candidate 列表（按可落地优先级）

每条 standalone，可作为后续 BACKLOG 条目。

**C1 — 扩展 hook 事件谱到 10 events，抽象为 Vessel 最小公共协议**
- **从谁借**：Claude Code (28 events) ∩ OpenHands (6 events) ∩ Codex experimental (6 events) — 三家交集 + Vessel 必需的 SoulInjected
- **怎么改造**：现有 2 events → 10：`SessionStart / SessionEnd / UserPromptSubmit / PreToolUse (已) / PostToolUse / PermissionRequest (已 OnDecisionRequest 重命名) / PermissionDenied / Stop / SubagentStart / SubagentStop`。Handler 类型支持 `command | http`（先不上 `mcp_tool/prompt/agent`，避免过度工程）
- **协议设计**：**优先兼容 Claude Code spec**（`{permissionDecision, updatedInput, additionalContext}` + exit code 2 block）——未来 Eva 跑 Claude Code subprocess 时 hook 可双向适配；**但抽象成 Vessel 自己的最小公共协议**，留出适配器层以兼容 Codex `PermissionRequest.decision.behavior` 这种不同 shape。绝不**让 hook 协议锁死单家厂商**。
- **落到**：M1 (HARNESS_AGENTS hook 段已经预留)
- **风险**：
  - 28 events 对个人单机过度；卡死在 10 避免 scope creep
  - Codex experimental hooks 显示 PreToolUse 不拦截 WebSearch / 非 MCP 工具——Vessel 设计需要 explicit 列出每个 event 拦截哪些 tool family，不留"全覆盖"假设
- **验证**：写 1 个示例 hook (PreToolUse log auditor) 跑通；再写 1 个 mock adapter 把 Codex shape 翻译成 Vessel shape

**C2 — 拆 approval policy 为 filesystem + network 独立 policy**
- **从谁借**：Codex CLI 2026-03 PR #14171（split-policy）——这是 post-training-cutoff finding，Claude 训练数据里没有
- **怎么改造**：现有 `permissionMode` 单一字段拆 `permissionMode + networkPolicy`。networkPolicy 三档：`disabled / allowlist:[domain] / unrestricted`
- **落到**：M2（M0 第二契约 minor bump 流程已验证，可同模式加字段）
- **风险**：iOS minClientVersion 协议升级 (ADR-0015 minor bump)；老 client graceful skip 需验证
- **验证**：参考 M0 modelList + permissionModes 流程：backend minor bump + iOS Codable graceful skip

**C3 — 加 macOS sandbox-exec 层（仅 Bash 子进程）**
- **从谁借**：Codex CLI macOS `sandbox-exec -p <profile>` + ptrace 硬化；Claude Code Seatbelt 类似
- **怎么改造**：cli-runner.ts spawn 时 wrap 一层 `sandbox-exec -p $VESSEL_HOME/sandbox.sb claude --print ...`。profile deny-default + writable_roots（cwd + .claude-state + worktree）+ network deny
- **落到**：**M2-M3 之间**（per HARNESS_ROADMAP §0.5 算阶梯层 — 高搬迁成本，先 anchor gate 7 问）
- **风险**：
  - macOS-only（Linux 走 bwrap 是另一坨工程；Vessel 个人单机暂 macOS 单平台 OK）
  - `sandbox-exec` Apple 已"deprecated"但 Codex/Claude Code 仍在用；接受
  - **业界共识盲区**：bash 修改文件不进 shadow checkpoint——sandbox 不能解决 rollback 问题，只能解决 escape 问题
- **验证**：在 cli-runner.ts test 里跑 `rm -rf /` 验证被 sandbox 拒；跑正常 build 验证白名单 OK

**C4 — 加 per-prompt 轻量 checkpoint（用 git ref 而不是 shadow store）**
- **从谁借**：Claude Code 30-day checkpoint 思路 + Aider git-native `/undo` 落地方式；**避开** Cursor "restore 不可逆"反例
- **怎么改造**：每个 user prompt 进入时在 worktree 自动 `git tag vessel-checkpoint-$timestamp`；iOS 加 `/rewind` 列表（Esc+Esc 等价）。30 天后 GC
- **落到**：M1B+（worktree 已 ready；只加 tag + GC）
- **风险**：**与所有业界工具共享盲区**：bash 修改 untracked 文件不在 git tag 里。在 Vessel 文档明确这个限制
- **验证**：写 + 改文件 → 跑 prompt → `/rewind` → 验证文件回到 prompt 前；untracked 文件作为已知限制写入 USER_MANUAL.md

**C5 — Allowlist 语法明确化（采 Continue.dev glob 而非 Cursor 前缀）**
- **从谁借**：Continue.dev `Write(**/*.ts)` glob + Roo `allowedCommands` longest-prefix 配合 `deniedCommands` deny-precedence
- **怎么改造**：HARNESS_AGENTS profile allowlist 改用 glob 语法；写入 schema 文档；**绝不**走 Cursor 前缀-字符串路径（Backslash 4 bypass 反证）
- **落到**：M1（profile 定义里）
- **风险**：glob 本身仍可被 shell built-ins 绕过（Cursor `GHSA-82wg-qcm4-fp2w` 反证）；C3 sandbox 是双层防御必需
- **验证**：写 5 个 allowlist 用例 + 5 个 bypass 尝试 (Base64/subshell/script/quote-escape/env-var)，验证 sandbox 兜底

**C6 — 关键教训保留（不可借鉴）**
- **denylist 已死**：Cursor v1.3 弃 denylist（2025-07 Backslash 披露）后行业共识。Vessel 现有 default-deny 是对的，不要走"维护一个 deny 黑名单"反路径
- **LLM-dynamic risk flag 反例**：Cline 用 LLM 给每个命令打 `requires_approval`。不可审计、可被 prompt injection 操控。Vessel **不采**——评估走 OpenHands risk-level + static rule 复合路径，不走纯 LLM 决策
- **闭源 hooks 反例**：Cursor / Windsurf / Goose 都把 hooks 关进 MCP 黑箱。Vessel 协议必须开放可读（Claude Code spec 是好模板）

**C7 — 引入 OpenHands ConfirmRisky + deterministic security analyzer 作为风险分类层**
- **从谁借**：OpenHands `ConfirmRisky(threshold=HIGH)` + `PatternSecurityAnalyzer / PolicyRailSecurityAnalyzer / EnsembleSecurityAnalyzer` 复合
- **怎么改造**：在 static allowlist (C5) 与 sandbox (C3) 之间插入**风险分类层**——deterministic analyzer 给 action 打 `LOW/MEDIUM/HIGH/UNKNOWN`，第 5 档 permission_mode `risk_aware` 把 HIGH 自动转 ask、LOW 自动 allow。**关键约束**：analyzer 只分类不硬拦截（保留 ConfirmationPolicy 决策权）；deterministic（regex / policy rail）独立于 LLM，可单元测试 + audit 留痕——这是与 Cline LLM-dynamic 路径的关键差异。
- **落到**：M1（在 hook 系统 C1 落地后追加；做 PreToolUse hook 形态最简单）
- **风险**：
  - 反例逃逸面：OpenHands `conversation.execute_tool()` 文档化绕过 analyzer + policy（D8 的延伸）—— Vessel 实现时**不留 escape hatch**，所有 tool call 强制过 analyzer
  - LLM 复评（如 `LLMSecurityAnalyzer`）开销大且不稳定，先不引入；只用 Pattern + PolicyRail
- **验证**：写 5 条 PatternSecurityAnalyzer rule（`rm -rf /`, `curl | bash`, `sudo`, `chmod 777`, write to `/etc/`），每条配 unit test 验证打分

**C8 — Default-write-protected paths baseline (Cursor `sandbox.json` + Codex `.git/` 保护)**
- **从谁借**：Cursor `sandbox.json` protected paths + Codex `.git/` / `.codex/` 即使在 writable_roots 内也 read-only
- **怎么改造**：Vessel 默认写保护清单 — `.git/` / `.git/hooks/*` / `.claude/*.json` / `.vessel/*.json` / `~/.claude/.credentials.json` / `~/.codex/auth*` / `.env*` / `secrets/**` / iOS `Info.plist`。**即使** `permissionMode = bypassPermissions` 也不写；只有 managed config 显式放行才允许（防止 agent 自主授权改 hook 配置后反过来 disable sandbox—— D4 反例）
- **落到**：M1（与 C5 allowlist 语法同期落地）
- **风险**：硬编码清单会随项目膨胀；预留 `protected_paths` 配置数组让用户加白，但默认值必须涵盖 D4 / D11 教训中提到的"agent 篡改自己配置"路径
- **验证**：跑 5 个 attacker 假想用例（agent 试图写 `.git/hooks/post-commit` / 改 `permissions.json` / 写 `.env` / chmod 自身 binary / 改 systemd unit），验证全被拒

### 5.4 候选方案的里程碑分布

```
M0 (已完成)         → permissionModes 4 档 server-driven (C2 的协议基础已经验证 OK)
M1 (规划中)         → C1 (10 events hook 抽象层) + C4 (git-tag checkpoint) + C5 (glob allowlist 语法)
                      + C7 (ConfirmRisky + deterministic analyzer) + C8 (default-write-protected paths)
M1C-A+ (workflow)    → 已有 timeout 修复在做（Memory project_milestone_progress）
M2 (规划中)         → C2 (split FS + network policy minor bump)
M2-M3 anchor gate   → C3 (macOS sandbox-exec) — 阶梯层，先 anchor gate 7 问
反例文档化          → C6 (denylist/LLM-dynamic/闭源 hooks 三反例进 HARNESS_RISKS.md)
```

### 5.5 明确不借鉴

- **Devin 全自主黑盒** — 形态错位，违反 Vessel "用户拍板" Steward I11
- **Cursor 闭源 hook 协议** — 不开放，无法验证
- **OpenHands `conversation.execute_tool()` 绕过 analyzer** — 这是个反例：documented escape hatch 等于自废武功。Vessel 不留这种后门
- **Goose 服务端 ALLOWLIST 未实现** (D11) — UI 强制 + 服务端不强制 = 等于没有；反例
- **Claude Code agent 自主 disable bubblewrap** (D4) — sandbox 必须 OS 层强制，agent 不能 opt-out
- **Aider 单一 Y/N 弹窗** — 颗粒度过粗；Vessel 现有 profile allowlist 已经超越

---

## 6. 主要来源（top 30 + 时效）

**post-2025-05-13 近期源**（≥1 个要求 → 实际 22 个）：

- [Codex PR #14171 — split sandbox policy](https://github.com/openai/codex/pull/14171) (2026-03-12) ⭐ post-training
- [Codex Issue #13448 — split policy motivation](https://github.com/openai/codex/issues/13448) (2026-03-04)
- [Codex Issue #6667 — workspace-write regression](https://github.com/openai/codex/issues/6667) (2026)
- [Roo Issue #12002 — per-mode auto-approve](https://github.com/RooCodeInc/Roo-Code/issues/12002) (2026-03-26)
- [Cursor forum 152136 — allowlist ignored in sandbox](https://forum.cursor.com/t/152136) (2026-02)
- [Goose CORS guardrails](https://block.github.io/goose/blog/2026/01/05/agentic-guardrails-and-controls) (2026-01-05)
- [Windsurf changelog v1.13.12 — enterprise allow/deny](https://windsurf.com/changelog) (2026-01-25)
- [Windsurf changelog v1.12.36 — Turbo Mode](https://windsurf.com/changelog) (2025-11-25)
- [OpenHands V1 SDK paper](https://arxiv.org/abs/2511.03690) (2025-11)
- [Backslash — Cursor denylist 4-bypass](https://www.backslash.security/blog/cursor-ai-security-flaw-autorun-denylist) (2025)
- [Ona — Claude Code sandbox escape](https://ona.com/stories/how-claude-code-escapes-its-own-denylist-and-sandbox) (2026)
- [Hacker News coverage — Cursor v1.3 fix](https://thehackernews.com/2025/08/cursor-ai-code-editor-fixed-flaw.html) (2025-08)
- [Cline PR #3486](https://github.com/cline/cline/pull/3486) (2025-05-12)
- [Anthropic — Claude Code more autonomous](https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously) (2025)
- [x.com/windsurf_ai/1929697293613330515 — `// turbo`](https://x.com/windsurf_ai/status/1929697293613330515) (2025-06)
- [Agent Safehouse — Codex sandbox investigation](https://agent-safehouse.dev/docs/agent-investigations/codex) (2025)

**官方 docs**（rolling，undated 当 current）：
- [Claude Code permissions](https://code.claude.com/docs/en/settings) / [hooks](https://code.claude.com/docs/en/hooks) / [sandboxing](https://code.claude.com/docs/en/sandboxing) / [checkpointing](https://code.claude.com/docs/en/checkpointing) / [interactive-mode](https://code.claude.com/docs/en/interactive-mode) / [permission-modes](https://code.claude.com/docs/en/permission-modes)
- [Cursor docs/agent](https://docs.cursor.com/chat/agent) / [tools/terminal](https://cursor.com/docs/agent/tools/terminal) / [checkpoints](https://cursor.com/docs/agent/chat/checkpoints) / [permissions.json](https://cursor.com/docs/reference/permissions) / [sandbox.json](https://cursor.com/docs/reference/sandbox)
- [Aider commands](https://aider.chat/docs/usage/commands.html) / [git integration](https://aider.chat/docs/git.html) / [config options](https://aider.chat/docs/config/options.html)
- [Windsurf terminal](https://docs.windsurf.com/windsurf/terminal) / [Cascade modes](https://docs.windsurf.com/windsurf/cascade/modes)
- [OpenHands SDK security](https://docs.openhands.dev/sdk/guides/security) / [runtimes/docker](https://docs.openhands.dev/usage/runtimes/docker) / [hooks](https://docs.openhands.dev/openhands/usage/customization/hooks)
- [Continue tool-permissions](https://docs.continue.dev/cli/tool-permissions) / [agent how-it-works](https://docs.continue.dev/ide-extensions/agent/how-it-works)
- [Cline auto-approve](https://docs.cline.bot/features/auto-approve) / [Roo auto-approve](https://docs.roocode.com/features/auto-approving-actions/)
- [Codex agent-approvals-security](https://developers.openai.com/codex/agent-approvals-security) / [config-advanced](https://developers.openai.com/codex/config-advanced) / [config-reference](https://developers.openai.com/codex/config-reference) / [sandboxing concepts](https://developers.openai.com/codex/concepts/sandboxing) / **[hooks experimental](https://developers.openai.com/codex/hooks)** ⭐ Phase 6 异构终审新增
- [Goose tool-permissions](https://block.github.io/goose/docs/guides/tool-permissions/) / [config-file](https://block.github.io/goose/docs/guides/config-file/) / [allowlist](https://block.github.io/goose/docs/guides/allowlist/)

**GitHub 源码/issue**（高价值代码证据）：
- [`@anthropics/claude-code` issues 27040 / 29048 / 37210 / 52822 / 41791 / 18312](https://github.com/anthropics/claude-code/issues) — 5+ confirmed bugs
- [`openai/codex` codex-rs/protocol/src/config_types.rs](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/config_types.rs)
- [`cline/cline` AutoApprovalSettings.ts](https://raw.githubusercontent.com/cline/cline/65e9727c/src/shared/AutoApprovalSettings.ts)
- [`block/goose` goose-server/ALLOWLIST.md](https://github.com/block/goose/blob/main/crates/goose-server/ALLOWLIST.md)
- [`Aider-AI/aider` #3903 / #1528 / #649](https://github.com/Aider-AI/aider/issues)
- [`All-Hands-AI/OpenHands` #10242 / #5264 / PR #5356](https://github.com/All-Hands-AI/OpenHands/issues)

**Phase 6 异构终审新增 sources**：
- [Codex hooks (experimental)](https://developers.openai.com/codex/hooks) — Agent A/B 两个 Claude lens 均漏报；用于修正 §2.8 §3
- [Cursor sandbox.json reference](https://cursor.com/docs/reference/sandbox) — 用于 C8 protected paths 基线
- [OpenHands SDK security](https://docs.openhands.dev/sdk/guides/security) — 用于 C7 ConfirmRisky + deterministic analyzer
- [Cognition acquires Windsurf](https://cognition.ai/blog/windsurf) (2025-07) — 支持 R7 vendor 收购风险
- [Apple Developer Forums — sandbox-exec deprecation](https://developer.apple.com/forums/thread/661939) — 支持 R8 macOS sandbox API 风险

---

## 7. 推荐结论 + 置信度

**结论**（按 M1 → M2 → M2-M3 阶梯层顺序）：

> 1. **M1 — 开放 hook 协议兼容层**（C1）：Vessel 自己的最小公共 hook 协议，**优先**与 Claude Code spec 兼容，但留适配器层吸收 Codex experimental hooks (`PermissionRequest.decision.behavior`) 和 OpenHands hook env-var spec 这两类 alternate shape。Claude Code 是兼容目标**之一**，不独占第一。
> 2. **M1 — 风险分类 + 默认写保护**（C7 + C8）：OpenHands `ConfirmRisky + deterministic analyzer` 风险分层（≠ Cline LLM-dynamic），加 Cursor/Codex `protected paths` 基线（`.git/` / `.claude/*` / `.env` 默认即使 bypassPermissions 也不写）。
> 3. **M2 — split FS + network policy**（C2）：跟随 Codex 2026-03 PR #14171 把 single permissionMode 拆成 `filesystem + network` 双独立 policy，提前规避设计债。
> 4. **M1B+ — git-tag checkpoint**（C4）：zero-infra 落地，参考 Aider git-native `/undo` 落地形态。
> 5. **M2-M3 阶梯层 — macOS sandbox-exec**（C3）：anchor gate 7 问后引入，Codex + Claude Code 用相同栈，是个人单机 macOS 目标下 ROI 最高的 sandbox 形态。
>
> **明确不走**：Cursor 闭源前缀-字符串 allowlist（Backslash 4 bypass）、Cline LLM-dynamic risk flag（不可审计 + prompt injection 面）、denylist 黑名单维护、OpenHands `conversation.execute_tool()` 风格的 documented escape hatch、Goose 服务端 ALLOWLIST 未实现这种半成品（D11）。

**理由**：
1. Hook 协议兼容层是"开放但不锁死"——Claude Code spec 生产验证最久所以是起点，但 Codex 2026-04 已经出 experimental hooks 用不同 shape；Vessel 不能押注单家
2. ConfirmRisky + deterministic analyzer 把 risk classification 留给可单元测试的 regex/policy rail，把 confirmation decision 留给 ConfirmationPolicy；这是 Cline LLM-dynamic 反例的正解
3. Codex split-policy 是 2026-03 才落地的 post-training-cutoff 创新（cursor-agent X 独有发现）；M0 modelList + permissionModes minor bump 流程已经验证，C2 是 zero-risk 复用
4. git-tag checkpoint 是 zero-infra 落地路径（已经有 worktree）；Aider 路径已证明 git-native rollback 用户接受度高
5. macOS sandbox-exec 是 Vessel 单平台目标下 ROI 最高的 sandbox 形态；Codex + Claude Code 都用，行业事实标准

**适用条件**：
- ✅ Vessel 个人单机助理（per memory `feedback_vessel_personal_use.md`）
- ✅ macOS 单平台优先（target user 设备）
- ❌ 如转企业多用户，C3 sandbox-exec 需升级到 Docker runtime（OpenHands 路径）
- ❌ 如转跨平台（Linux/Windows），sandbox 工作量翻倍——M2 anchor gate 时重评

**置信度**：**中高**（≥6 独立 source 支撑每条核心借鉴；2 条 post-training-cutoff 证据 #14171 / Cline #2253 trajectory；12 个 CODE/DOC divergence 提供反证免疫力）

---

## 8. 待验证风险

- [ ] **R1**：Claude Code hook JSON 协议在 2026-2027 是否会 breaking change？验证：观察 `code.claude.com/docs/en/hooks` changelog 季度
- [ ] **R2**：macOS `sandbox-exec` 何时被 Apple 真正移除？验证：跟踪 Apple Developer Forums / Codex CLI / Claude Code 是否切换备选
- [ ] **R3**：split-policy in Codex (`#14171`) 是否成为行业标准？验证：6 个月后看 Claude Code / Cursor 是否引入类似拆分
- [ ] **R4**：Vessel 当前 4 档 permissionMode 是否够用？验证：dogfood 时记录"我希望有第 5 档"的情境频次
- [ ] **R5**：bash-modified-files-not-in-checkpoint 是行业共同盲区——Vessel 是否要先于业界解？验证：Vessel 用户反馈 + 个人 dogfood 是否有 "untracked file 丢失" 事故
- [ ] **R6**：Cline LLM-dynamic risk flag 反例的反证——是否有可审计的 LLM-classifier-based gating 设计？验证：跟踪 OpenHands ConfirmRisky 6 个月演进
- [ ] **R7** (Phase 6 终审补)：**Vendor 收购 / 产品持续性**——Codeium → Windsurf → Cognition 收购线（2025-07）显示该领域 vendor 不稳定。Aider 单 maintainer (paul-gauthier) 离职会怎样？Cline (clinebot) → Roo-Code 分叉显示开发节奏分歧。验证：每 6 个月看一次 9 工具 commit 频率 + maintainer 状态；任何 vendor 锁死的 candidate 都不进 M1 关键路径
- [ ] **R8** (Phase 6 终审补)：**Apple sandbox-exec deprecation**——`sandbox-exec` 已 deprecated 多年但无官方替代（Apple Developer Forums 多年讨论无果）；macOS 14/15 仍可用但任一未来 release 可能限制。验证：每个 macOS 大版本 release 跑 Codex / Claude Code sandbox-exec 用例；准备 fallback 到 Linux bwrap-style 路径（VM 内 Linux runtime）

---

## 9. Phase 6 异构终审 verdict

cursor-agent (GPT-5.5-medium) Phase 6 异构终审 verdict 原文（2026-05-12）：

```markdown
## Cross-Model Final Reviewer Verdict

**Verdict**: Refine

### Verdict rationale
报告整体方向可用，但 §7 仍轻微偏向 Claude Code：Claude Code hook spec 作为兼容目标合理，
但不该单独排第一，因为 Codex 当前也已有 experimental hooks，OpenHands 的 ConfirmRisky +
deterministic analyzers 也应作为 M1 风险门控正例进入候选。Agent X 的 Codex split-policy
被充分采纳，Cursor sandbox.json protected paths、Goose CORS-inspired guardrails 和 Roo
per-mode trajectory 采纳得偏浅，应该从"来源列表"提升到设计候选或风险项。

### If Refine
- §5.3 加 C7 — OpenHands ConfirmRisky + deterministic analyzer：M1 可借鉴
  PatternSecurityAnalyzer / PolicyRailSecurityAnalyzer / EnsembleSecurityAnalyzer +
  ConfirmRisky(threshold=HIGH)，作为 static rule 与 sandbox 之间的风险分类层；同时明确
  conversation.execute_tool() 是反例逃逸面。
- §5.3 或 §5.5 加 C8 — Cursor/Codex protected paths baseline：把 .git/、.cursor/*.json、
  .claude/*.json、workspace trust/config 文件列为默认写保护对象。
- §7 重写推荐顺序为"开放 hook 协议兼容层 + split FS/network policy + git-tag checkpoint
  + macOS sandbox-exec"，不要写成"Claude Code hook spec 兼容"独占第一。

### Spec/factual errata
- §2.8 Codex CLI "Hooks: 无 PreToolUse 风格 lifecycle hook" — 错。Codex 当前有 experimental
  hooks，启用键是 [features] codex_hooks = true，事件包括 SessionStart / PreToolUse /
  PermissionRequest / PostToolUse / UserPromptSubmit / Stop。
- §3 Codex CLI "Hooks ✗ MCP only" — 错。应改为 experimental hooks ⚠。
- §6 Goose CORS guardrails URL 带尾部 / 会 404 — 正确 URL 是
  https://block.github.io/goose/blog/2026/01/05/agentic-guardrails-and-controls。
- §5.3 C1 "hook JSON output 协议沿用 Claude Code spec" — 需改成"优先兼容 Claude Code，
  但抽象成 Vessel 自己的最小公共协议"。
- §3 "OpenHands Docker + ns 移除 + proxy (业界最严默认)" — 降成"默认隔离最强之一"；
  Codex Landlock/seccomp/ptrace 组合也足够强。
- §2.5 OpenHands "Security Analyzer 4 个" — 当前文档强调 analyzer 只分类、不硬拦截；
  建议补这层语义。

### Sources added (cursor-agent 推荐)
- https://developers.openai.com/codex/hooks (current, 2026-05-12) — 修正 §2.8/§3
- https://developers.openai.com/codex/config-reference (current, 2026-05-12)
- https://docs.openhands.dev/sdk/guides/security (current, 2026-05-12)
- https://cursor.com/docs/reference/sandbox (current, 2026-05-12)
- https://cognition.ai/blog/windsurf (2025-07) — Windsurf/Codeium 收购风险
- https://developer.apple.com/forums/thread/661939 — sandbox-exec deprecated 风险
```

### Refine 落地清单（主 Claude 已应用，iteration_bound=1 完成）

| Verdict 条 | 应用位置 | 状态 |
|-----------|---------|------|
| §2.8 Codex hooks 修正 | §2.8 重写 Hooks 段；附 [hooks 页 URL](https://developers.openai.com/codex/hooks) + 标注 Phase 6 发现 | ✅ |
| §3 矩阵 Codex Hooks ✗ → experimental ⚠ | 矩阵单元格 | ✅ |
| §3 OpenHands "业界最严" → "默认隔离最强之一" | 矩阵单元格 | ✅ |
| §2.5 OpenHands analyzer 只分类不拦截语义 | §2.5 Security Analyzer 段补强 | ✅ |
| §5.3 C1 措辞 "抽象成 Vessel 自己的最小公共协议" + 适配器层 | C1 重写 | ✅ |
| §5.3 加 C7 ConfirmRisky + deterministic analyzer | C7 新增 | ✅ |
| §5.3 加 C8 default-write-protected paths | C8 新增 | ✅ |
| §5.4 milestone 表加 C7 + C8 到 M1 | 表格更新 | ✅ |
| §7 推荐顺序重写（hook 兼容层 + split policy + git-tag + sandbox-exec） | §7 完全重写 | ✅ |
| §6 Goose CORS URL 去尾部 `/` | source list 单条 | ✅ |
| §8 加 R7 (vendor 收购) + R8 (sandbox-exec deprecation) | R7/R8 新增 | ✅ |
| §6 加 Phase 6 终审新增 sources 段 | source list 末尾 | ✅ |

**Refine pass 结论**：所有 12 条 verdict items 已 applied；iteration_bound=1 已用完，本报告即 final。

---

**报告 metadata**:
- Generated by `/survey` skill Deep + hetero + strict
- Phase 2 wall-time: ~16 min（3 agents 并行）
- Phase 6 wall-time: ~1.5 min（cursor-agent 异构终审 + URL verify + refine pass）
- Total unique sources: ~100 URLs（含 Phase 6 新增 6 条），22+ post-2025-05-13
- **Phase 6 最大价值**：异构终审捕获 Claude 集体盲区 `Codex experimental hooks`（Agent A 和 B 两个 Claude lens 都漏报），URL 验证确认后写入 §2.8 + §3 + §5.3 C1
- 收线后由主窗口起 PR，调 `eva:hook pre-remove` 清掉 worktree
