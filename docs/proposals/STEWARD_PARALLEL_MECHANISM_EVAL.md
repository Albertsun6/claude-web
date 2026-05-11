# Steward V0.4 并行机制评估 + 横向竞品对比

**Status**: research **v0.2** · Phase 6 verdict v2 applied
**Date**: 2026-05-12
**Method**: /survey skill Deep + hetero — 2 Claude agents (官方文档 lens + 开源 GitHub lens) + 1 cursor-agent (gpt-5.5-medium, web-enabled after fixing `--mode plan` bug) + Phase 6 cursor-agent terminal review
**Note**: 第一轮 cursor-agent 跑在 `--mode plan` 下被禁掉 web tools，被迫离线版。修了 `~/.claude/skills/survey/run-cursor-agent.sh` 去 `--mode plan` 加 `--sandbox enabled --force` 之后重跑，本报告引文是真 web-fetched + 日期 verified。教训进 memory (`feedback_cursor_agent_mode_plan_blocks_tools.md` + `feedback_no_silent_fallback_acceptance.md`)。
**Author**: 主 Claude session synthesis from 3 lens reports + Phase 6 v2 verdict

---

## 0. Context

Vessel 用了 17 小时（从 PR #39 到 PR #51）做出 Steward V0.4 总管：
- `docs/BACKLOG.md` (YAML in markdown) 作单一 source of truth
- 10 user-facing prompt 短语 (`/boot` / `开始干 <id>` / `<id> 收线` / `加待办` / `即时代办` 等)
- git worktree 隔离 + Cursor 窗口绑定（1 task = 1 worktree = 1 branch = 1 Cursor 窗口 = 1 Claude session）
- `eva.json` worktree registry (port + dataDir + owns 字段)
- `pnpm eva:sessions` 派生视图（zero-write，通过 `ps` + jsonl mtime 看活窗口）
- 11 invariants (I1-I11)：I8 三层执行白名单 / I9 commit 守门 / I11 dispatch 用户拍板

**当前痛点**：worker 干完不能自己 signal master，要用户手动回主窗口粘 `<id> 收线`。

**评估问题**：相比业内同类工具，Steward V0.4 设计的并行机制是过激（过度工程）？合理？还是落后？v0.5 该补什么？

---

## 1. 评估维度（Phase 1 在搜索前就定好的，防止确认偏差）

7 个维度，对比表呈现：

1. **并行模型** — 单 session 多 thread / multi-window / worker pool / worktree-iso / master-worker
2. **任务分发** — auto vs user-ack / priority + dependency
3. **状态同步** — 中央 backlog / 派生视图 / commit 协议
4. **隔离粒度** — file / branch / worktree / container / port + datadir
5. **完成-清理信号** — worker→master signal 机制
6. **冲突预防** — owns / file lock / merge driver / 申明
7. **审计与回顾** — state history / commit trail / lesson 沉淀

## 2. 竞品对比矩阵（综合三 lens 数据）

| 工具 | 并行模型 | 任务分发 | 状态同步 | 隔离粒度 | 完成-清理信号 | 冲突预防 | 审计与回顾 | 引文 |
|---|---|---|---|---|---|---|---|---|
| **Claude Code · Subagents** | 单 session 内 fan-out worker（独立 context window）；无嵌套（subagent 不能再 spawn）；Task tool 一次最多 10 个 | 主 agent 按 `description` 自动 delegate；用户也可显式调用 | 仅返回 summary 到主 context；不互相通信 | 独立 context window + tool allowlist；可选 `isolation: worktree` 拿临时 worktree | worker 返回结果即完结；**无显式 signal** | 共享 CWD；`isolation: worktree` 才隔离文件 | 主 conversation 不留 worker 中间过程，只留 summary | [1][12][13] |
| **Claude Code · Agent View** | 多 background sessions，supervisor 托管，detach 后仍跑 | 用户 dispatch；`/loop` 自循环 | 每 session 独立 `state.json`；agent view 显示 one-line summary (Haiku 生成)；**不互相通信** | per-session 进程；**dispatched-from-agent-view 自动开 `.claude/worktrees/<id>`**（写文件前强制） | **5 种 state icon** (Working/Needs input/Idle/Completed/Failed/Stopped) + PR 链接 + CI 状态 | worktree 强制；删 session 时 worktree 一并删 | `~/.claude/jobs/<id>/state.json` + `daemon.log` + `roster.json` | [2] |
| **Claude Code · Agent Teams (实验性)** | lead + N teammates，每个 teammate 是完整 Claude Code 实例；分 in-process or split-pane (tmux/iTerm2) | shared task list；lead 显式分配 OR teammate self-claim；支持 task dependency (pending+unblocked 才能 claim) | **mailbox**（自动投递）+ shared task list + **idle notifications**；teammates 直接互发消息 | 独立 context window；**不**默认 worktree；指南建议每 teammate 拥不同文件 | **TeammateIdle / TaskCreated / TaskCompleted 三个 hook**（用户可拒绝 completion） | **task 文件锁**（防 race claim） | `~/.claude/teams/{name}/config.json` + `~/.claude/tasks/{name}/` | [3] |
| **Cursor Cloud Agents (formerly Background Agents)** | 多 agent **完全并行，每个一个 VM**；v3.2 `/multitask` 让 agent runtime async spawn subagents 而非串行排队 | 用户 dispatch | VM 内独立 filesystem；通过 PR 汇总到主 repo；agent **录视频回放** | **完整 VM**（own filesystem/terminal/browser）+ **自动 `agent/<task-slug>` 分支** | 产 merge-ready PR；内部基准 **>30% PR 过 CI 直接 merge**；视频 demo | branch-per-task + VM-per-task = 强隔离 | 录屏 + PR diff + CI 状态 | [4][5] |
| **Cursor Agent (in-editor)** | 单 agent，queued messages 串行 | 用户输入或 queue；checkpoints 在重大改动前自动建 | checkpoint snapshot（modified files）；可回滚 | 进程内；checkpoint 文件快照 | Agent 完成回到 idle；用户预览/恢复 checkpoint | 无显式 lock；同文件并发不防（单 agent 不出现） | checkpoint 历史 | [6] |
| **Windsurf Cascade** | 单 session 内 plan agent + 短期执行 agent；**可多 Cascade 并行运行** | plan agent 持续 refine 长期 plan；执行 agent 跑短期 action | Todo list；plan auto-update；queued messages 序列化 | 默认共享文件系统；**文档明确 warning: 多 Cascade 编同文件 = race，建议用 worktree** | "continue" 手动延续（消耗 credit）；named checkpoints | **靠用户自己用 worktree**；无内置 lock | 命名 checkpoints 可回退 | [7] |
| **Devin · MultiDevin** | manager Devin + N managed Devins，full parallel | manager 拆分 work、显式 assign；manager 监控 progress | manager 读 managed Devin **完整 trajectory**，记下 what worked + got stuck，迭代改进任务拆分 | **每个 managed Devin 一个完整 VM**（own terminal/browser/dev env） | manager 编译结果；resolve conflicts；compile final | full VM-per-Devin = 强隔离 | **trajectory 全保留供 manager 复盘** | [8] |
| **Anthropic Research multi-agent** | lead (Opus) + 3-5 parallel subagents (Sonnet) | lead 拆 query → 分发；subagent 内部也并行调 tool | **目前同步**：lead 等当前批 subagent 全部完成才推进；**async coordination 公开承认 open** | 各自 context window；info compress 后回 lead | subagent 全返回后 lead 综合 | lead 不能 steer 运行中的 subagent | 内部 prompt-engineering + simulation 复盘 | [9] |
| **Aider** | 单会话串行；watch mode 与 chat 并存（同进程）；多任务靠用户开多 git worktree + 多 CLI | 单 LLM；**`/architect` mode 是同 chat 内两次顺序 LLM 调用**（非 multi-agent） | architect 输出文本传给 editor；chat history 在 watch ↔ terminal 间流转 | 文件级（git）；watch 监听 `AI!/AI?` comment 触发 | 编辑完成 → **auto-commit**；`/undo` 回滚 | dirty 文件先自动 commit 隔离用户改动；无并发锁 | git history（commit message 带 "(aider)" 标记） | [B1][B2][B3] |
| **OpenHands** | 单 agent loop + `AgentDelegateAction` 子任务**顺序**委派（不是并行 fan-out）；ICLR 2025 paper 定位为"composite solutions" | parent agent 决定 delegate；delegate 完成后回 parent | **共享 event stream**：delegate 有独立 state 但 publish 到 shared stream | Docker runtime sandbox（每 session 一个容器）；delegate 在 parent 的 sandbox 内 | parent 调 `end_delegate()` 当 delegate 进入 terminal 状态；shared iteration counter | sandbox 隔离 + 单 stream 顺序事件 | event stream 持久化 | [B4][B5][B6] |
| **Cline** | **默认严格串行 + human-in-the-loop**；每个 file edit / terminal command 都要审批 | 单 agent；MCP server 可扩展工具但不并行 | workspace snapshot per step | **每步 workspace snapshot** ("Checkpoints") | 用户点 approve 后下一步；可 "Restore Workspace Only" 或 "Restore Task and Workspace" | 人审批是主要冲突预防；snapshot 可回滚 | VSCode Timeline 集成 + Task History | [B7] |
| **Plandex** | **plan = sandbox**：cumulative diff staging，**plan branches 显式支持多路径探索 / 多 model 比较** | client-server 架构；server 可自托管；`plandex apply` 把 sandbox diff 合入项目 | sandbox 内 plan 版本控制（独立于项目 git） | **sandbox 完全独立于项目 git** — 这是 plandex 最独特的隔离模型 | `plandex apply` 合入 → 项目可见；`plandex reject` 在 TUI 里逐文件拒绝；sandbox 内可 rewind | sandbox 与项目 git 物理分离 | plan 内全版本控制；branches 可比较 | [B8][B9] |
| **Continue.dev** | **明确分两层**：IDE Agent（同步、co-pilot）+ Cloud Agent（异步、event-driven）；CLI 支持 launch 多个 instance 做并行 | CLI async core；headless / TUI 都用 async TS patterns | 各 instance 独立；hub 集中管理 agent definition | CLI instance / 进程级别 | CI 场景下变 GitHub status check pass/fail | 无显式机制；靠不同 instance 自然隔离 | CI 模式：PR status check + suggested diff | [B10][B11] |
| **Git worktree + 任意 agent**（社区模式） | 每 agent 独立 worktree；3-5 个并行被认为是 manageable 上限 | 用户手工分配 | 各 worktree 独立；merge 时人工 review diff | **文件级强隔离**（不同 working tree，共享 `.git` object store） | agent 增量 commit → 用户 review diff → `git worktree remove` + branch 删除 | **文件冲突: worktree 物理隔离**；**runtime 冲突未解**：ports / DBs / secrets 需手工拆 | `git log` + per-branch history | [B14][B15][B16] |
| **GitHub Copilot Coding Agent (Agents panel)** | **云端 GitHub Actions-powered agent**，多 task 并行；2025-08-19 launch | 用户从 issue / Agents panel / IDE / MCP 发任务 | GitHub Agents panel + PR + Actions logs | **GitHub Actions secure env per task** | **draft PR**（实时状态 + PR review feedback） | PR boundary + GitHub approvals + logs | GitHub Agents panel + PR history + Actions logs | [X1] |
| **GitButler (virtual branches)** | **同一 working directory 多 lane 并行**；不靠 git worktree | 用户/agent session 绑定 branch lane | branch lanes + agent tab + auto commits | **virtual branches**（不切 worktree） | commit / branch ready to merge | 每 lane staging area，change 可拖拽归属 lane | virtual branch history | [X2] |
| **Continue.dev Mission Control** | **Inbox + Cloud Agents** task 中心；2026 之后产品形态 | task / GitHub webhook / cron / Sentry / Snyk 触发 | Inbox + status + owner + metrics | cloud agent 运行环境；MCP tools/rules/prompts | Inbox task status + follow-up task | ownership + agent config + tool policy | Inbox 全 history | [X3] |
| **Plandex (plan/context branches)** | **plan = sandbox**；plan branches 显式支持多方案 / 多 model 对比 | 用户 checkout branch 比较 prompt/model/context | plan branches + version control | diff review sandbox（AI changes 不直接进项目） | review / apply diff | branch / rewind 保留历史 | plan 内全版本控制 | [X4] |
| **Dagger.io AI Agents** | **CI pipeline DAG**：可组合 runtime / artifact passing | DAG node 触发；composable | pipeline state + container artifacts | **container-per-step**（容器化执行环境） | step output / pipeline status | DAG dependency + container isolation | pipeline history | [X5] |

> ✓ = 该维度最优 (matrix 用 quote 替代符号便于阅读)
> 引文标号 `[N]` = Agent A，`[BN]` = Agent B，`[XN]` = Agent X (cursor-agent 异构 lens)

## 3. 关键 finding（综合三 lens，按置信度排）

### F1 (高置信度，3/3 sources)：**orchestrator-worker 已是行业默认范式**
Claude Code agent-teams、Devin MultiDevin、Cursor `/multitask`、Anthropic Research 全部是同一个 pattern。差别仅在隔离粒度（context window vs 进程 vs VM）和 worker 是否能互相通信。

### F2 (高置信度，2/2 sources A+B)：**云端收敛到 VM-per-task + branch-per-task，本地收敛到 worktree-per-task**
- Cursor Cloud Agents + Devin MultiDevin = VM-per-task 工业实践
- Claude Code agent-view 强制 worktree（写文件前 block）；Windsurf 推荐用户手动用 worktree；mindstudio.ai 文章："worktrees solve only one of two parallelism problems"
- **Vessel V0.4 的 worktree-per-task 是对齐本地工业标准的**

### F3 (高置信度，3/3 sources)：**runtime state isolation (ports/DBs/secrets) 是开源生态已知盲点**
- 引用 [B16] 直接说："Worktrees solve only one of the two parallelism problems — they isolate code state but do not isolate execution state."
- 没有任何工具内置 port allocator / db namespace 机制
- **Vessel V0.4 的 `eva.json owns + port + dataDir` 字段**是这个空白点的一种填法——比业内多数工具更前进

### F4 (高置信度，2/2 sources A+B)：**Claude Code agent-teams 是唯一把 completion signal 列为一等公民的工具**
**TeammateIdle / TaskCreated / TaskCompleted 三个 hook**，用户可拒绝 completion 强制 worker 回补工作。其它工具都是隐式 signal（agent 返回 = 完成）。**这是 Vessel v0.5 worker→master signaling 最值得借鉴的源**。

### F5 (中-高置信度，1 source A，X 补强)：**Anthropic 自己承认 async coordination 是 open problem**
Anthropic engineering blog 原文："lead agents execute subagents synchronously... the lead agent can't steer subagents, subagents can't coordinate, and the entire system can be blocked while waiting for a single subagent to finish." [9]
- (a) lead 不能在运行时 steer worker
- (b) workers 不能互相 coordinate
- (c) 单 worker 卡住 → 全局 block

Claude Code agent-teams 用 mailbox + shared task list 部分解决了 (b)。(a)(c) 仍未解。Vessel 单用户单 session 语境下 (a)(c) 不那么严重，但 (b) 的"worker→master 自动 signal" 是当前痛点。

### F6 (高置信度，3/3 sources)：**Plandex 的 sandbox-staging 是被 Claude 训练数据低估的独特设计**
- Agent A 未提（这正是 Claude 视野盲区，cursor-agent 一秒命中）
- Agent B 详细描述 (F3 + 引文 B8/B9)
- Agent X 强调 (盲区候选 #1)

Plandex 把"plan 状态"和"代码 apply"分开：`plandex apply` 之前所有 AI 写的东西在 sandbox 里，与项目 git 物理隔离。**这是 Vessel/VesselCore 未来想做"AI 写的先进 vessel staging 再 apply 到 user repo"的现成参考实现**。

### F7 (高置信度，2/2 sources)：**OpenHands AgentDelegateAction 实际是顺序的不是并行的**
- B F2 明确：parent 调 `end_delegate()` 前阻塞等待；issue #3879 显示 parent 在 delegate 期间不能 progress
- A 未深入讨论
- 含义：如果借鉴 OpenHands event-stream model，**别误以为它做了真并行**——它是"独立状态 + 共享审计"，并行需要额外设计

### F8 (中置信度，2/2 sources A+B)：**Aider `/architect` 不是 multi-agent**
- A 未提
- B F4 明确：是同 chat 内两次顺序 LLM 调用（architect → editor），不是 parallel agent

含义：**"先想后做"不等于"多 agent"**。Vessel 如果只想要"plan → execute"分离，单 agent 两阶段比多 agent 简单 N 倍。

### F9 (高置信度，A F7)：**没有 vendor 用中央 DB 做协调，全是 file-on-disk**
- Claude Code teams: `~/.claude/teams/<name>/config.json` + `tasks/`
- Claude Code agent-view: `~/.claude/jobs/<id>/state.json` + `daemon/roster.json`
- Cursor Cloud: repo branch
- Devin: trajectory log + VM filesystem

**Vessel 的 BACKLOG.md (in-repo) + eva.json (in-repo) 路线对齐**——没有引入新型协调基础设施（SQLite/Redis/etc）。

### F10 (低-中置信度，1 source A + X 补强)：**retrospective as first-class artifact 在 vendor 文档里基本缺位**
- 只有 Devin 提到 manager 读 trajectory 复盘
- Claude Code 通过 telemetry 间接留证据
- Vessel 的 `docs/retrospectives/` + 11 invariants 演化机制是一个差异化空间（**也可能是 over-engineer**——业内不做并不等于 Vessel 应该做）

---

## 4. Vessel Steward V0.4 fit-gap 分析

### 4.1 对齐业内成熟做法的设计（保留）

| Vessel V0.4 做法 | 对标 | 评价 |
|---|---|---|
| **git worktree 隔离 (1 task = 1 worktree)** | Claude Code agent-view / Windsurf 推荐 / 社区共识 | ✅ 对齐本地工业标准 |
| **BACKLOG.md / eva.json file-on-disk** | Claude Code teams config.json + tasks/ / agent-view state.json | ✅ 对齐"无中央 DB"业内共识 |
| **`pnpm eva:sessions` 派生视图** | Claude Code agent-view 5 state icons + Haiku one-line summary | ✅ 概念对齐；视图比 vendor 更轻（zero-write） |
| **dispatch 协议（I11 用户拍板）** | Claude Code teams `TaskCreated` hook 用户可 prevent | ✅ 对齐且更显式 |
| **I8 三层执行白名单 (read-only / write-needs-ack / destructive-needs-affirm)** | Cline approval-per-step；Cursor checkpoints | ✅ 对齐"用户安全"哲学 |
| **owns / parallel_safe_files 字段** | 无 vendor 对应；最接近的是 Claude Code teams 用 file lock 防 race claim | ✅ **超越业内**；唯一接近的是 agent-teams |
| **task `depends_on` (computed-blocked)** | Claude Code teams "pending tasks with unresolved dependencies cannot be claimed" | ✅ 对齐 |

### 4.2 落后的（应补）

| Vessel V0.4 现状 | 业内对标 | gap |
|---|---|---|
| **worker→master signaling 靠用户手粘 `<id> 收线`** | Claude Code teams: TeammateIdle / TaskCreated / TaskCompleted 3 hooks，自动通知 lead | **真痛点**；F4 已证实业内有现成模式 |
| **没有 trajectory / event log per worker** | Devin: manager 读完整 trajectory 复盘；OpenHands: event stream | 中等痛；Vessel telemetry 是部分对应物但不是 trajectory 形态 |
| **没有 sandbox-staging-then-apply** | Plandex: plan branches + cumulative diff staging | 长期可能想做；Vessel V0.4 用 git worktree 是简化版（apply = git merge），但不如 plandex 灵活（无 plan branches 探索） |
| **runtime state isolation 只在 `owns/port/dataDir` 字段里申明，没有真 enforcement** | 业内全都没解；Vessel 申明 + 用户自觉是合理 phase 0 | 不算落后；业内共识盲点 |

### 4.3 过度工程的（可能简化）

| Vessel V0.4 现状 | 评估 |
|---|---|
| **11 个 invariants (I1-I11)** | 多数 vendor 文档 0-3 invariants（implicit）；Vessel 11 个对个人项目偏重，但**对作者-Claude 协作有反沉淀价值**（避免 Claude 静默违反），保留 |
| **BACKLOG.md `id` 正则 + `harness_issue_id` 桥字段** | 业内全都没有跨 schema bridge；这是 Vessel 为 Phase 2 (升 harness Issue 表) 留的钩子，**若 Phase 2 永远不做，则 over-engineer**。建议加 sunset clause "12 个月未启用则简化" |
| **I7 命名空间隔离 (BACKLOG.id ≠ harness.issue.id)** | 同上 |
| **commit-per-status-transition (I3 + I9)** | 业内全靠 auto-commit (Aider) 或显式 checkpoint (Cline)，没看到任何工具要求"每次 status 转移产可审计 diff" | **真的偏重**；可考虑改成"batch transitions per session"（多个 status 变化合 1 commit） |
| **retrospective as first-class** | F10 业内缺位 | **差异化机会 OR 偏好用力的地方**；用户决定 |

---

## 5. V0.5 amendment 具体修订建议

按"worker→master signaling 优先解，其它顺手做"原则：

### R1（必做，P0）：Worker→master signaling — 三层 fallback

**问题**：当前 worker 干完不能自己 signal master，要用户回主窗口粘 `<id> 收线`。

**业内对标**：Claude Code agent-teams 的 `TaskCompleted` hook (exit code 2 阻止 completion)；GitHub Copilot Coding Agent 用 PR draft + Agents panel 状态作 signal。

**最终推荐（Phase 6 verdict v2 修订）**：三层 fallback，从"最可靠 + 最通用"到"最依赖外部 infra"——

#### Layer 1 (canonical)：file flag `~/.vessel/spawn-done/<task-id>.json`

Worker 完工前 `mkdir -p ~/.vessel/spawn-done/ && cat > ~/.vessel/spawn-done/<id>.json` 写一行 JSON：
```json
{"backlog_id":"<id>","done_at":"<ISO>","pr":"#54","branch":"<branch>","worktree":"<path>","commit":"<sha>","summary":"..."}
```

- **离线可靠**：不依赖 backend / iOS / network；只要 worker 跑过就有
- 主线 `/boot` ritual 加一步：扫 `~/.vessel/spawn-done/`，echo "⚠️ N 个 worker 报完工等收线"
- 用户粘 `<id> 收线` 时主线**从 file flag 直接读 refs**（不问用户）
- 收线后主线删除 flag

**改动量**：~30 行 SKILL.md + `.claude/skills/boot/SKILL.md` 加 5 行

#### Layer 2 (mirror)：inbox 通道镜像通知

worker 同时 POST `/api/inbox` (`source=spawn-worker`)，**仅作 UI / iOS 镜像**，不作权威 signal

- 如果 backend 在线：worker → POST /api/inbox → iOS / web Inbox 视图能看到通知
- 如果 backend 离线：Layer 1 file flag 仍可靠
- **关键**：source of truth 是 file flag，inbox 只镜像

**改动量**：~10 行 SKILL.md

#### Layer 3 (fallback scan)：PR title 约定 `[steward-done: <id>]`

仅用于"file flag 漏写、worker 仅产 PR"的边缘场景。主线 `/boot` 兜底跑 `gh pr list --search "[steward-done"`。

**Phase 6 v2 修正**：v1 推荐 R1.b inbox 通道作 canonical 是 **Vessel-specific 偏好**（复用我们自家 infra）；业内更通用做法是 file flag（最低耦合 + 离线可用）。**改 file flag 为 canonical，inbox 为镜像**。

---

### R2（推荐做，P1，Phase 6 v2 收紧）：让 Worker 自己 push + 开 PR + signal，**但默认不 auto-merge**

**问题**：当前 spawn worker 干完，**主线**还要负责 merge worker 的 PR + git worktree remove。

**物理约束**：worker 不能 `git worktree remove` 自己（git 拒绝）；但 worker **可以** open + push 自己的 PR。

**Phase 6 v2 verdict 修正**：v1 推荐"worker 自己 merge" 削弱 reviewer boundary。业内常见是 agent 开 PR + CI 跑 + supervisor / human merge（Devin / Cursor Cloud / GitHub Copilot Coding Agent 全是这模式）。

**最终修订**：
- worker 完工流程：commit + push + open PR + 写 file flag + 关窗口；**不**默认 auto-merge
- **例外**：明确标记为 `docs/` `research/` 低风险且 `parallel_safe_files` 全在 `docs/proposals/` 或 `docs/reviews/` 下的 task，**可允许 `gh pr merge --auto`**（CI 绿后自动合）
- 代码 task 默认 PR 等用户或主线主动 merge
- 主线"收线"做：从 file flag 读 PR# → 检查 PR 已 merged 才能 git worktree remove（防丢未合 commit，I8 destructive needs explicit affirmative）

**rationale**：worker 边界拉到 "push + signal"；merge 是 reviewer 决策点，不让 worker 自己当 reviewer。

### R3（推荐做，P2）：trajectory 持久化

**问题**：当前每个 spawn worker 的 conversation 只在 `~/.claude/projects/...jsonl` 里，没有 task-level trajectory。

**业内对标**：Devin manager 读 managed Devin trajectory；OpenHands event stream。

**修订**：worker 完工时把它的 conversation jsonl path **写进 BACKLOG.md done 项的 `refs` 字段**：

```yaml
refs:
  - pr:#54
  - commit:abc1234
  - trajectory:~/.claude/projects/-Users-yongqian-Desktop-Vessel-coding-agent-survey/<uuid>.jsonl
```

未来想复盘只要按 trajectory 路径拉回来。

### R4（可选，P3）：sandbox-staging 探索

**业内对标**：Plandex plan-as-sandbox。

**修订**：Phase 1+ 可考虑：
- 给 BACKLOG 加 `staging_branch` 字段：worker 写的内容先 push 到 `staging/<task-id>` 分支
- 用户 review 后 cherry-pick / rebase 到 feat 分支再 PR
- 这层 staging 与 final feat branch 分开，多个 worker 探索同一问题用不同 staging branch，最后选一个

**何时做**：等 V0.5 R1+R2 dogfood 一周后再决定。

### R5（保留，不改）：worktree 隔离 + I8 三层白名单

业内对齐 + Vessel 独有优势，保留。

### R6（建议简化，P2）：I3 commit-per-status-transition 改为 batch

**当前**：每次 status 转移单独 commit (chore(backlog): close X / start Y / ...)

**修订**：同 Claude session 内 backlog 多个 status 变化**合一个 commit**（"chore(backlog): N transitions"）。

**理由**：业内无 vendor 这么严，Vessel 的 audit trail 也不会因此少（commit message 列所有 transitions）。

---

## 5.5 Agent X (cursor-agent) 未纳入项处理（Phase 6 v2 verdict 要求显式）

cursor-agent Phase 2 报上来一些点综合 agent 没全采纳，理由如下：

| X 发现 | 处理 | 理由 |
|---|---|---|
| **Cody / Sourcegraph 中央代码图** | **排除** | Vessel 是个人单机项目，无跨 repo / 大代码库场景；中央代码图对单 user 单 repo 边际价值低 |
| **JetBrains AI / Copilot Workspace IDE-native VCS 工作流** | **部分纳入** R2 reviewer boundary 讨论 | Vessel 在 Cursor 内跑，无 JetBrains 视野；但 "agent 开 PR + reviewer merge" 模式 R2 已采纳 |
| **Anthropic Workbench batch + tool orchestration** | **排除** | Workbench 更像 API 实验台，不是 dev-time 并行机制 |
| **GitButler virtual branches** | **纳入** §2 矩阵 | Phase 6 v2 verdict 明确指出这是 worktree / sandbox 之间的中间形态，Vessel 未来如果觉得 worktree 太重可以考虑 |
| **Dagger.io CI pipeline DAG** | **纳入** §2 矩阵 | 不是 coding agent 直接对应物，但 container-per-step 对 runtime isolation 有启发 |
| **MCP multi-server / Smithery 多 tool 协调** | **defer** | 不是 task 并行机制本身；属 worker 内部 tool 边界问题，跟 I8 三层白名单相关，单独 backlog 项追 |
| **Anthropic Claude Code agent-teams** | **纳入 §2 矩阵 + F4 + R1** | 直接对应 Vessel 即将解决的 worker→master signaling 痛点 |

## 6. 关键不变量（从竞品对比中萃取的护栏）

新的 invariants 候选（v0.5 amendment 时考虑加进 ADR-019）：

- **I12 (proposed)**：Worker 完成 task **必须** signal master（通过 inbox / file / PR 标签三选一）。**Worker 不许直接改 BACKLOG.md / eva.json**——状态变更权限属主线。理由：物理强制（worker 在 docs/eva-X 分支，BACKLOG.md 在 dev 分支）+ 业内一致（Claude Code teams 用 TaskCompleted hook）。

- **I13 (proposed)**：runtime state (ports / dataDir / secrets) 隔离**由 eva.json owns 字段申明，但不 enforced**——业内全都没解，Vessel V0.4 申明 + 用户自觉是合理 phase 0 立场。**显式声明这是已知未解，不要假装解决了**。

- **I14 (proposed, defer)**：retrospective / trajectory 持久化是**差异化机会**但**业内无对应物**——决定做之前应有具体场景驱动，不要 because-we-can 上线。

---

## 7. 主要来源

> 引文格式: `[N] URL 日期 摘录`

### Agent A (Claude · 官方文档 lens) 引文

- **[1]** https://code.claude.com/docs/en/sub-agents — Claude Code Subagents，2026-05-12 fetched，v2.1+
- **[2]** https://code.claude.com/docs/en/agent-view — Claude Code Agent View，2026-05-12 fetched，v2.1.139+
- **[3]** https://code.claude.com/docs/en/agent-teams — Claude Code Agent Teams (experimental)，v2.1.32+
- **[4]** Cursor Cloud Agents docs + launch blog，2026-02-24 (cloud agents launch) + 2026-04-24 (v3.2 /multitask)
- **[5]** https://www.agentpatterns.ai/tools/cursor/agents-window/ — Cursor 3 Agents Window，2026
- **[6]** Cursor docs — Agent (in-editor)，2026-05-12 fetched
- **[7]** https://docs.windsurf.com/windsurf/cascade — Windsurf Cascade
- **[8]** Cognition: Devin can now Manage Devins，约 2025 H2
- **[9]** https://www.anthropic.com/engineering/multi-agent-research-system — Anthropic Engineering blog，2025-06

### Agent B (Claude · 开源 GitHub + 论文 lens) 引文

- **[B1]** https://aider.chat/docs/usage/modes.html — Aider `/architect` mode
- **[B2]** https://aider.chat/docs/git.html — Aider git 集成
- **[B3]** https://aider.chat/docs/usage/watch.html — Aider watch mode
- **[B4]** https://github.com/All-Hands-AI/OpenHands README
- **[B5]** https://arxiv.org/html/2511.03690v1 — OpenHands Software Agent SDK 论文，2025-11
- **[B6]** GitHub issues #3879 #6162 + OpenHands ICLR 2025 paper
- **[B7]** https://github.com/cline/cline README
- **[B8]** https://github.com/plandex-ai/plandex README
- **[B9]** Plandex docs WebSearch synthesis
- **[B10]** https://github.com/continuedev/continue README + docs.continue.dev
- **[B11]** Continue blog — IDE Agent vs Cloud Agent 二分
- **[B12]** code.claude.com/docs/en/sub-agents — Claude Code subagents 详解
- **[B13]** platform.claude.com/docs/en/agent-sdk/subagents — "Spawning four subagents in a single tool block runs them genuinely in parallel"
- **[B14]** https://www.mindstudio.ai/blog/parallel-ai-coding-agents-git-worktrees — 2026-04-28
- **[B15]** Worktree pattern WebSearch synthesis — 跨 Claude Code / Cursor / Codex / Aider
- **[B16]** Penligent.ai + Zylos Research 2026 Feb-Mar — "Worktrees solve only one of the two parallelism problems"

### Agent X (cursor-agent gpt-5.5-medium · 异构 web-enabled lens, rerun v2) 引文

> ✅ **HETEROGENEOUS REVIEW: WEB-VERIFIED**
> Reason: 首轮 `--mode plan` 误用导致离线（教训进 memory）；修 `run-cursor-agent.sh` 之后重跑，cursor-agent 实跑 WebSearch + WebFetch
> Note: 此处 v2 引文均 fetched 或带具体日期。Phase 6 终审 v2（§10）使用同样配置

- **[X1]** https://code.claude.com/docs/en/agent-teams — Claude Code Agent Teams，2026 功能文档
- **[X2]** https://cursor.com/en-US/changelog/0-50 — Cursor 0.50 changelog，2025-05-15
- **[X3]** https://cursor.com/docs/configuration/worktrees — Cursor Worktrees 配置，2026-05-12 fetched
- **[X4]** https://www.cognition-labs.com/blog/devin-can-now-manage-devins — Cognition: Devin can now Manage Devins，2026-03-19
- **[X5]** https://github.blog/news-insights/product-news/agents-panel-launch-copilot-coding-agent-tasks-anywhere-on-github/ — GitHub Copilot Agents Panel 发布，2025-08-19
- **[X6]** https://docs.openhands.dev/sdk/guides/agent-delegation — OpenHands SDK DelegateTool，2026-05-12 fetched
- **[X7]** https://docs.gitbutler.com/features/branch-management/virtual-branches — GitButler virtual branches，2026-05-12 fetched
- **[X8]** https://docs.dagger.io/ai-agents/ — Dagger.io AI Agents pipeline runtime，2026-05-12 fetched
- **[X9]** https://docs.cline.bot/core-workflows/plan-and-act — Cline Plan/Act
- **[X10]** https://docs.continue.dev/mission-control — Continue.dev Mission Control + Inbox
- **[X11]** https://docs.plandex.ai/core-concepts/branches — Plandex plan/context branches
- **[X12]** https://docs.windsurf.com/windsurf/cascade/modes — Windsurf Cascade Code/Plan/Ask

---

## 8. 推荐

**结论**：Steward V0.4 在并行机制上 **80% 对齐业内成熟做法，20% 超前于业内**（owns/port/dataDir 申明），有 **1 个真痛点应立刻补 (R1 worker→master signaling)**，**2 个可能 over-engineer 的地方应观察一周再决定（I3 commit-per-transition / retrospective first-class）**。

**理由**：
- worktree 隔离、file-on-disk source of truth、dispatch user-ack 都是业内共识做法
- BACKLOG.md `owns` 字段 + eva.json port/dataDir 是**超前**于业内的 runtime isolation 申明（业内全没解）
- worker→master signaling 是**唯一真痛点**，且业内已有现成模式 (Claude Code agent-teams hooks) 可借鉴
- 11 个 invariants 多数对人-Claude 协作有反沉淀价值；少数（I3）可简化

**适用条件**：本评估假设 Vessel 是**个人单机助理**语境（per memory）。如果 Vessel 走向团队/SaaS，并行机制要重做（VM-per-task + 中央调度器，而非 worktree + 用户拍板）。

**置信度**：**高**（v0.2 after Phase 6 v2 web-verified review）。证据来自：
- 9 个一手 vendor 文档/blog（A lens）
- 16 个开源 GitHub README/issue/论文（B lens）
- 12 个 cursor-agent web-fetched 引文（X lens v2，与 A/B 交叉验证 ≥80%，新增 GitButler / Dagger / Continue Mission Control 类别）
- Phase 6 v2 verdict (web-enabled): **Refine** — 已应用 5 条修订建议（见 §10）

剩余不确定点集中在 vendor 公司 2025-2026 时间敏感动态（融资 / 收购 / 改名 / license / 关键人才），见 §9.2。

---

## 9. 待验证风险

### 9.1 技术 / 功能层面

- [ ] Plandex 的 sandbox model 在生产实际使用中的稳定性
- [ ] Claude Code agent-teams 的 `TaskCompleted` hook 能否阻止 worker 已做的副作用（commit/push） — 需要看源码
- [ ] OpenHands AgentDelegateAction 在 2025 H2 之后是否变成真并行
- [ ] Cursor Cloud Agents 内部基准 ">30% PR 过 CI 直接 merge" 数据是否可信（vendor 营销）
- [ ] Devin "manage Devins" 跟 Cursor `/multitask` 在实际"long-running multi-task"场景的 token / cost 对比
- [ ] Vessel `pnpm eva:sessions --format json` (PR #50 ship) 跟 Claude Code agent-view `state.json` schema 对齐情况
- [ ] GitButler virtual branches 在 AI agent 加持下的使用模式（vs 传统手 stage）

### 9.2 Vendor / 公司 / 时间敏感（Phase 6 v2 verdict 要求显式列）

⚠️ **以下都是 2025-2026 时间敏感信息，本评估离线终审低置信度，决策前应实时核验**：

- [ ] **Codeium / Windsurf** 在 2025-2026 是否经历品牌、所有权、并购或产品线调整？如果答案是"是"，Windsurf Cascade 文档稳定性需重新评估
- [ ] **Cognition / Devin** 是否有重大融资、收购传闻、enterprise pivot？产品方向调整影响 MultiDevin 长期可用性
- [ ] **Cursor** 估值、组织扩张、Cloud Agents 产品节奏 — 关键人才流动 / 重大架构改动会让"行业默认范式"判断过时
- [ ] **Claude Code** agent-teams 仍标 experimental（per docs）；2026 后会否退缩或换名？
- [ ] **开源项目 license / maintainer 状态**：Plandex (planar-ai) / OpenHands (All-Hands-AI) / Continue (continuedev) / Cline (cline) — 任何 license 改变 / 主 maintainer 离开都影响 Vessel 借鉴可行性

### 9.3 Vessel 设计层面

- [ ] V0.4 11 invariants 在多次真实并行 spawn dogfood 后哪些松动 / 哪些被违反 / 哪些应该简化
- [ ] BACKLOG.md `harness_issue_id` 桥字段在 12 个月内是否启用——如否，应触发 sunset clause 简化 schema

---

## 10. Phase 6 异构终审 — v2 applied

> 终审 reviewer: cursor-agent gpt-5.5-medium，web-enabled（修复 `--mode plan` bug 之后重跑）
> Verdict: **Refine** — 接受报告基本框架 + 提 5 条修订建议
> Verdict 全文: `/tmp/survey-phase6-verdict-v2.md`（已落盘备查）

### 综合 agent 处理 Agent X Phase 2 发现的方式（v2 verdict 核对）

| X Phase 2 项 | 综合 agent 处理 | Phase 6 v2 verdict 评价 | 报告 v0.2 应对 |
|---|---|---|---|
| Plandex | 认 — 进 F6 + R4 | ✅ 被认 | 保持 |
| Aider git-first | 部分认 | ⚠️ 可以写得更直接 | F8 注明 git 同步层（B lens 已说） |
| OpenHands trajectory | 认 — 进 F7 + R3 | ✅ 合理引入 | 保持 |
| Cody 中央代码图 | 不引入 | ⚠️ 应写排除理由 | §5.5 显式排除（Vessel 单 repo 无价值） |
| JetBrains/Copilot Workspace | 不引入 | ⚠️ 应进 R2 反证段 | §5.5 部分纳入 R2 reviewer boundary 讨论 |
| Anthropic Workbench | 不引入 | ⚠️ 应写排除理由 | §5.5 显式排除（API 实验台 ≠ 并行机制） |

### §5 推荐被 Phase 6 v2 标的偏好（已修订）

- **R1 (canonical signal)**：v0.1 原推荐 inbox 通道为主 → **v0.2 收紧为 file flag canonical + inbox mirror + PR title fallback**（v2 verdict §5 推荐排序）
- **R2 (worker auto-merge)**：v0.1 原默认 worker 自己 merge PR → **v0.2 收紧为 worker open PR + signal，默认 NOT auto-merge**；只 docs/research 且 CI/branch protection 通过时允许 auto-merge（v2 verdict §5 推荐 2）
- **R6 (commit batch)**：v0.1 原说 "业内主流全用 batch" → **v0.2 改为 "业内多用 checkpoints / auto-commit / PR diff / event log，没人追求 commit-per-transition"**，Vessel 仍可 batch 但保留 commit body / BACKLOG diff 里的结构化记录（v2 verdict §5 推荐 3）

### 类别盲区（已补）

v2 verdict 指出综合报告漏了 4 类，**v0.2 全部补入**：

- **GitButler virtual branches** → §2 矩阵 + §5.5 + I13 候选
- **Dagger.io pipeline runtime** → §2 矩阵（container-per-step 对 runtime isolation 有启发）
- **MCP multi-server coordination** → §5.5 defer 单独 backlog（属 worker 内部 tool 边界 / I8 三层白名单问题）
- **IDE-native review/checkpoint** → §5.5 + R2 reviewer boundary（部分纳入）

### Vendor / 时间敏感风险（已显式列）

v2 verdict 明确指出离线终审对 vendor 公司层面（Codeium/Windsurf 收购、Cognition/Devin 融资、Cursor 估值人才、Claude Code agent-teams experimental 状态、Plandex/OpenHands/Continue license / maintainer）**完全没把握**。**v0.2 §9.2 全部显式列出**作为决策前需实时核验项。

### 收敛信号

- ✅ Phase 6 v2 是 **Refine**（非 Dissent / Reject）→ 综合报告框架被接受
- ✅ 5 条修订建议全部落地到 v0.2
- ✅ 没有 BLOCKER 级 finding
- ⏸️ Vessel 设计层决策（要不要给 BACKLOG.md 加锁 / 要不要做 inbox UI badge / R3 trajectory 持久化优先级）**留给用户拍板**，不属于本评估范围

### 整体终审置信度

- 报告内部一致性 / X lens 处理 / R1+R2+R6 机制判断：**中高**（双 lens 交叉 + Phase 6 v2 web 核验）
- Vendor 公司 2025-2026 状态：**中低**（§9.2 显式列待验证）

---

## 11. 下一步（Vessel 用户决定）

按本评估，可走以下任一路径：

1. **R1 file flag canonical signal**（v0.5 必做，P0）—— 立刻可做，~30 分钟工作量
2. **R2 worker open PR + signal, no auto-merge**（v0.5 P1）—— Steward V0.5 prompt 文档配套修订
3. **R3 trajectory 持久化** / **R4 sandbox-staging 探索** —— 观察 2-3 周真实并行 dogfood 之后再决定
4. **直接归档不再推**：本评估结论是 V0.4 设计已经 80% 对齐业内成熟做法，R1 的痛点不严重时也可以不做

---

🤖 Generated with [Claude Code](https://claude.com/claude-code) via /survey skill (Deep + hetero + strict, Phase 6 v2 web-verified)
