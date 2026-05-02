# Harness Architecture — 完整分层架构

> **状态**：M-1 第 1 项核心契约首版（v0.1，2026-05-01）。
>
> **用途**：harness 的"地图"。每次设计讨论 / 评审 / 实现前先看这里。
>
> **同源**：本文是 [HARNESS_ROADMAP.md](HARNESS_ROADMAP.md) §0 / §1 / §2 / §3 / §4 / §16 内容的**架构视图重组**——按"层 + 职责 + 接口"看 harness，而 ROADMAP 是按"原则 + 里程碑 + 风险"看 harness。两者是同一个系统的不同切片。
>
> **导航**：[索引](HARNESS_INDEX.md) · [Roadmap](HARNESS_ROADMAP.md) · [Landscape](HARNESS_LANDSCAPE.md) · [数据模型](HARNESS_DATA_MODEL.md) · [Agents](HARNESS_AGENTS.md) · [风险](HARNESS_RISKS.md)

---

## 0. 鸟瞰图（一屏看懂）

```
                              ┌────────────────────────┐
                              │       用户             │
                              │  (纯个人自用，永不分发)  │
                              └─────────┬──────────────┘
                                        │
   ╔═══════════════════════════════════ ▼ ════════════════════════════════════╗
   ║  L1 用户接触面 — Presentation                                              ║
   ║  ┌────────────────────┐         ┌────────────────────┐                    ║
   ║  │ iOS native (thin)  │         │  Web 控制台         │                   ║
   ║  │ Seaidea SwiftUI    │  ◄────► │  Vite + React       │                   ║
   ║  │ schema 渲染 + 系统   │         │  /harness 看板路由   │                   ║
   ║  │ 能力 (录音/TTS)     │         │  /Chat 老路径        │                   ║
   ║  └─────────┬──────────┘         └──────────┬─────────┘                    ║
   ╚════════════│════════════════════════════════│═══════════════════════════════╝
                │   WebSocket  +  HTTP  +  schema config                       
   ╔════════════▼════════════════════════════════▼═══════════════════════════════╗
   ║  L2 API 与协议 — API Surface                                                ║
   ║  ┌──────────────────────────────────────────────────────────────────┐     ║
   ║  │ Hono backend  ·  /api/harness/{config, board, runs, ...}  ·       │     ║
   ║  │ /ws (multiplexed by runId)  ·  shared protocol (TS Zod + Swift)   │     ║
   ║  │ /api/harness/inbox · /api/harness/initiatives · /stages/:id/*     │     ║
   ║  └──────────────────────────────────────────────────────────────────┘     ║
   ╚═══════════════════════════════│════════════════════════════════════════════╝
                                   │
   ╔═══════════════════════════════▼════════════════════════════════════════════╗
   ║  L3 Harness 编排层 — Orchestration  ★ Seaidea 的差异化战场 ★                ║
   ║  ┌──────────────┬──────────────┬──────────────┬──────────────┐            ║
   ║  │  Scheduler   │ ContextMgr   │ Review-      │ PR Manager   │            ║
   ║  │  Stage 状态机 │ ArtifactBundle│ Orchestrator │ worktree+gh  │            ║
   ║  └──────────────┴──────────────┴──────────────┴──────────────┘            ║
   ║  ┌──────────────┬──────────────┬──────────────┐                          ║
   ║  │ Methodology- │ AgentProfile │ ResourceLock │                          ║
   ║  │ Store        │ Registry     │ (file+row)   │                          ║
   ║  └──────────────┴──────────────┴──────────────┘                          ║
   ╚═══════════════════════════════│════════════════════════════════════════════╝
                                   │  spawn `claude` 子进程 + ContextBundle + 工具白名单
   ╔═══════════════════════════════▼════════════════════════════════════════════╗
   ║  L4 Agent 执行层 — Runtime                                                  ║
   ║  ┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐            ║
   ║  │Strate-  │  PM     │ Archi-  │ Coder   │ Tester  │Reviewer-│  ...       ║
   ║  │ gist    │         │ tect    │(worktree)│         │ code/X  │            ║
   ║  └─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘            ║
   ║  每个 = 独立 spawn 的 claude CLI 子进程，cwd 隔离，prompt + skills 注入       ║
   ╚═══════════════════════════════│════════════════════════════════════════════╝
                                   │  读写 Artifact + Run transcript
   ╔═══════════════════════════════▼════════════════════════════════════════════╗
   ║  L5 数据层 — Persistence                                                    ║
   ║  ┌────────────────────────┐  ┌──────────────────────┐                      ║
   ║  │ ~/.claude-web/         │  │ ~/.claude/projects/  │                      ║
   ║  │   harness.db (SQLite+  │  │   <encoded-cwd>/     │                      ║
   ║  │   FTS5)                │  │   <sid>.jsonl        │                      ║
   ║  │   harness-audit.jsonl  │  │   (CLI 自带 transcript)│                     ║
   ║  │   artifacts/<hash>.md  │  │                      │                      ║
   ║  │   bundles/<bid>.md     │  │                      │                      ║
   ║  │   projects.json (旧)   │  │                      │                      ║
   ║  └────────────────────────┘  └──────────────────────┘                      ║
   ╚═══════════════════════════════│════════════════════════════════════════════╝
                                   │  Coder 在 worktree 写代码 → PR
   ╔═══════════════════════════════▼════════════════════════════════════════════╗
   ║  L6 目标项目 — Subject Project                                              ║
   ║  <projectCwd>/                                                             ║
   ║  ├── .worktrees/<issueId>/   ← 每个 Issue 独立 worktree                    ║
   ║  ├── .github/PR template      ← PR 强制模板                                ║
   ║  └── src/...                  ← 实际被改的代码                              ║
   ║  例：claude-web 自己 (dogfood) / toy 企业后台 / 客户企业系统                   ║
   ╚═══════════════════════════════════════════════════════════════════════════╝

   ┌─────────────────────────────────────────────────────────────────────────────┐
   │  L7 横切关注点 — Cross-cutting (贯穿 L1-L6)                                  │
   │  ┌─ 安全 ──────────────────┐  ┌─ 可观测 ──────┐  ┌─ 演化 ─────────────┐    │
   │  │ git-guard  prod-guard   │  │ telemetry     │  │ Retrospective     │    │
   │  │ allowlist  permission   │  │ cost trace    │  │ skill 提炼/anti   │    │
   │  │ worktree 隔离           │  │ FTS 全文索引   │  │ methodology v2    │    │
   │  └────────────────────────┘  └──────────────┘  └──────────────────┘     │
   └─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. 每层职责与边界

### L1 用户接触面（Presentation）

**职责**：把 harness 状态可视化、收集用户决策、提供"碎想 Inbox"零门槛入口、紧急时让用户介入对话。

**两个端**：
- **iOS native (Seaidea SwiftUI)** — 移动端主战场（用户用电脑被环境约束时的"移动办公"工具）。**thin shell 原则**：业务字符串/字段不写死，全靠后端 schema 渲染（5 个固定原生组件 + 受限 schema slot）。
- **Web 控制台** — 桌面端主战场。`/harness` 路由是任务看板（三栏 IA），老 `/` 路径保留为 chat 直入。

**关键不变量**：
- iOS 改一次锁死，业务变更不重装（[HARNESS_ROADMAP.md §0 #1](HARNESS_ROADMAP.md)）
- 离线时仅保留老聊天功能，Board / Decision 显示"未连接"占位

**与外部边界**：
- 上：用户
- 下：通过 L2 的 WS + HTTP 与 backend 通信

### L2 API 与协议（API Surface）

**职责**：让 L1 / 外部工具 / 未来 hook 集成都通过同一套协议访问 harness 状态。

**主要端点**：
- `GET /api/harness/config` — server-driven 配置（stages, agentProfiles, decisionForms, modelList, reviewMatrix, copy, ...）
- `GET /api/harness/board` — 当前看板数据
- `GET /api/harness/runs/:id` — 单 Run timeline
- `POST /api/harness/initiatives` `/issues` — 创建实体
- `POST /api/harness/stages/:id/{advance, decision}` — 推进 Stage / 提交决策
- `POST /api/harness/inbox` — **碎想入口（30 秒内能存一条）**
- `POST /api/harness/inbox/triage` — 批量把 IdeaCapture 转 Issue
- `WebSocket /ws` — 多路复用，事件包括 `harness_event { kind: stage_changed | task_started | decision_requested | run_appended | review_complete | config_changed }`

**协议契约**（M-1 第 2 项核心交付）：
- TS 类型 + Zod schema 在 `packages/shared/src/harness-protocol.ts`
- Swift Protocol 在 `packages/ios-native/Sources/ClaudeWeb/Protocol.swift`
- JSON fixture 在 `packages/shared/fixtures/harness/*.json`，TS 与 Swift 端必须 round-trip 通过

**关键不变量**：
- schema 字段必须 additive；老客户端看到不认识字段必须 graceful skip
- 加 `minClientVersion`，不满足时 iOS 回退打包内 fallback config

### L3 Harness 编排层（Orchestration）★

**这是 Seaidea 的差异化战场**。L1/L2 已经被 hapi/Paseo 占领，但 L3 的"SDLC stage gate + task lifecycle + 多 AI 评审 + 方法论 ritual"是市场结构性空白（详见 [HARNESS_LANDSCAPE.md](HARNESS_LANDSCAPE.md)）。

**七个核心模块**：

| 模块 | 职责 | 关键文件 |
|---|---|---|
| **Scheduler** | Stage 状态机驱动；事件循环把 pending → running；spawn `runSession` + `AbortController` | `packages/backend/src/scheduler.ts`（M1 新增） |
| **ContextManager** | 编排 ContextBundle，按 Stage 类型 + Issue 范围 + 显式依赖挑选最小 Artifact 集；缺失即失败 | `context-manager.ts`（M1 新增） |
| **Review-Orchestrator** | 调度多 AI 评审（risk-triggered，M2 仅 high-risk / M3 全量）；对比 Verdict；分歧 ≥ 2 分升级人审 | `review-orchestrator.ts`（M2 新增） |
| **PR-Manager** | 封装 `gh pr create/merge`；强制 PR 模板 / branch 命名 / commit 规范 / merge 规则 | `pr-manager.ts`（M2 新增） |
| **Methodology-Store** | 方法论文档 CRUD；版本绑定到 Initiative；ritual gate 落库 | `methodology-store.ts`（M1 新增） |
| **AgentProfile Registry** | 注册 12 个 Profile；prompt + skills + 工具白名单 + cwd 渲染 | `agents/profiles.ts`（M0 新增） |
| **ResourceLock** | file-lock + DB 行锁；防止多 agent 抢同一 worktree / sessionId / 临时目录 | `resource-lock.ts`（M2 新增） |

**关键不变量**：
- 状态机驱动协作，不引入消息总线（Redis/NATS）——个人自用永不需要
- backend 进程内 `setInterval` + 事件触发，不引入 launchd / Routines
- 不引入新基础组件（[HARNESS_ROADMAP.md §0 #11](HARNESS_ROADMAP.md)，个人自用规模下 SQLite + Hono+WS 足够）

### L4 Agent 执行层（Runtime）

**职责**：每个 Stage 在 runtime 化为一个或多个 spawn 的 `claude` CLI 子进程。

**12 个 AgentProfile**（详见 [HARNESS_AGENTS.md](HARNESS_AGENTS.md)）：

```
strategy stage    → Strategist  (Sonnet, checklist 模式)
discovery/spec    → PM          (Sonnet)
compliance        → Reviewer-compliance (Sonnet, 高风险触发)
design            → Architect + Reviewer-architecture (Opus)
implement         → Coder       (复杂度自适应 Opus/Sonnet, **必需 worktree**)
test              → Tester      (Sonnet, 共用 Coder worktree)
review            → Reviewer-code + Reviewer-cross (Sonnet/Opus, risk-triggered)
release           → Releaser    (Sonnet)
observe           → Observer    (Haiku, 按 cron)
跨 Stage          → Documentor  (Sonnet, M3 才上)
```

**关键不变量**：
- **永不调用 Anthropic Agent SDK** — 全部走 spawn `claude` CLI（[HARNESS_ROADMAP.md §0 #2](HARNESS_ROADMAP.md)）
- AgentProfile = `{systemPromptTemplate, skillNames[], toolAllowlist[], modelHint, defaultPermissionMode, requiresWorktree, parallelizable, contextBudget, reviewerRole?}`
- Runtime 落到 `runSession`（[packages/backend/src/cli-runner.ts:159](../packages/backend/src/cli-runner.ts#L159)）：通过 `--settings` 注入 hooks，通过 prompt 注入 system prompt + skill 列表，通过 cwd 落到 worktree
- **评审独立性约束**：Reviewer 的 ContextBundle 严格只含 `spec.md + design_doc.md + patch + diff`，**不读 Coder 的 transcript / tool calls / 思考流**

### L5 数据层（Persistence）

**职责**：harness 所有状态 + 历史 + Artifact 内容的持久化。

**两个数据源**：

| 路径 | 内容 | 说明 |
|---|---|---|
| `~/.claude-web/harness.db` | better-sqlite3 + FTS5 主表 | 13 个核心实体（详见 [HARNESS_DATA_MODEL.md](HARNESS_DATA_MODEL.md)） |
| `~/.claude-web/harness-audit.jsonl` | append-only 审计日志 | 所有写操作记录 |
| `~/.claude-web/artifacts/<hash>.md` | content-addressed Artifact 内容 | 超过 8KB 的 Artifact 落文件，DB 存 hash + path |
| `~/.claude-web/bundles/<bundleId>.md` | ContextBundle markdown snapshot | 可审计、可复盘 |
| `~/.claude-web/projects.json` | 旧项目注册表（保留兼容） | Project 实体扩展但不改字段 |
| `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` | Claude CLI 自带 transcript | DB 只存路径与摘要，不重复写入 |

**关键不变量**：
- **永不引入 Postgres**（[HARNESS_ROADMAP.md §0 #11](HARNESS_ROADMAP.md)，个人自用规模 SQLite 足够）
- 所有写操作走 `withProjectsLock` 同款 promise-queue
- schema 加 `version`，老版本 + 兼容窗口 1 个 minor（详见 ADR-0015）

### L6 目标项目（Subject Project）

**职责**：被 harness 操作的代码仓库本身。

**形态**：
- **dogfood 阶段**：claude-web 自己就是 L6 的第一个项目
- **M2 准入**：增加一个独立 toy 企业后台仓库 dry-run（避免纯 self-reflective 验证）

**Coder 与 L6 的接口**：
- 每个 Issue 在 L6 项目下创建专属 worktree：`<projectCwd>/.worktrees/<issueId>`
- 分支命名：`harness/<issueId>-<3-5word-slug>`
- 单 Issue 一个 PR（双 reviewer Verdict ≥ 4.0/5 + 用户 Decision approved + CI 全绿）
- 回滚走 `git revert`，禁止 force push / `--no-verify`

**关键不变量**：
- 所有 Coder 写入走 worktree（[HARNESS_ROADMAP.md §0 #7、§13](HARNESS_ROADMAP.md)）
- harness backend 进程不重启自身（dogfood 时改 claude-web 必须人审 release 后才合并 main）

### L7 横切关注点（Cross-cutting）

**贯穿 L1-L6 的非业务关注点**。

#### 7.1 安全边界

| 控件 | 位置 | 职责 |
|---|---|---|
| `git-guard.mjs` | `packages/backend/scripts/` | pre-push hook：阻止 force push 到 main、`--no-verify`、`--no-gpg-sign`、空 commit author |
| `prod-guard.mjs` | `packages/backend/scripts/`（M-1 新增） | 守第二道：DB migration / 三方 API / 部署 / 付费操作必须 dry-run + allowlist + 强制人审 |
| AgentProfile.toolAllowlist | runtime config | 限死每个 agent 能调的工具（如 Coder 不能 `Bash(rm -rf)`） |
| permission hook | 现有（`permission-hook.mjs`） | PreToolUse 卡点 |
| ResourceLock | `resource-lock.ts` | 防止多 agent 抢资源 |

#### 7.2 可观测性

| 控件 | 位置 | 职责 |
|---|---|---|
| 现有 telemetry | `packages/backend/src/routes/telemetry.ts` | 沿用，已有埋点 |
| Run.cost / .tokensIn / .tokensOut | harness.db | 每 Run 落库；Retrospective 汇总 |
| FTS5 全文索引 | harness.db | Issue.title/body + Artifact 内容可搜索 |
| Trace 视图 | Web `/harness/runs/:id` | timeline：Issue → Stage → Task → Run → Artifact → Verdict → Decision |

#### 7.3 演化机制

按 [HARNESS_ROADMAP.md §16](HARNESS_ROADMAP.md) 的三条进化路径：

| 路径 | 触发 | 落地 | 验证 |
|---|---|---|---|
| Retrospective → Methodology v2 | 同 Stage ≥ 5 条 retrospective | Methodology 表新版本，Initiative.methodologyVersion 切换 | Reviewer-cross + 用户拍板 |
| 成功 patch → `.claude/skills/` | Issue 合并 + 评分 ≥ 4.5 + 用户标记 | Documentor 提炼 SKILL.md | Reviewer-cross + Reviewer-architecture 双审 |
| 失败 → anti-pattern 库 | Stage failed + retrospective 标记 | 追加到 methodology.md "Anti-patterns" 段 | 人审一次入库 |

**关键不变量**：
- 任何进化产出必须经多 AI 评审，agent 不允许自改方法论 / skill 库
- `HARNESS_EVOLUTION_FROZEN=1` 环境变量冻结所有方法论 / skill 升级
- 不做 ML 化 fine-tuning（个人自用规模根本用不上）

---

## 2. 跨层数据流（典型 Issue 全链路）

以下是一个 Issue 从创建到合并的全链路数据流（M2 完工后形态）：

```
[1] 用户在 iOS 💡 按钮录一句"Inbox 想做 X"
    │
    ▼ POST /api/harness/inbox  (L2)
[2] backend 落 IdeaCapture (L5)
    │
    ▼ 用户后续在 Web 三栏 IA 选择 triage
[3] discovery agent (L4 PM) 把 IdeaCapture → Issue 草稿 (L5)
    │  ContextManager 喂 IDEAS.md / IMPROVEMENTS.md / git log 摘要
    ▼ 用户审核 → Issue.status = triaged
[4] Scheduler 创建 Issue 的 10 个 Stage (L5)
    │
    ▼ Stage 1 (strategy, checklist 模式) → Strategist agent → KPI 候选 → 用户拍板
[5] Stage 2 (discovery, light) → PM agent → spec 草稿
    │
    ▼ Stage 3 (spec, heavy) → PM agent → spec.md (含企业字段必填段)
[6] Stage 4 (compliance, checklist 默认) → 高风险才触发 agent，否则 checklist 跳过
    │
    ▼ Stage 5 (design, heavy) → Architect → design_doc.md
    │  → Reviewer-architecture (risk-triggered) → ReviewVerdict
    │  → 分歧时 Decision 升级人审
[7] Stage 6 (implement, heavy) → Coder spawn 到 worktree
    │  → ContextBundle: spec.md + design_doc.md + 相关源文件 grep
    │  → patch + commit (resource-lock 守 worktree)
    │
    ▼ Stage 7 (test) → Tester 共用 worktree → test_report
    │
    ▼ Stage 8 (review) → Reviewer-code + Reviewer-cross (M2 risk-triggered)
    │  → 两个 reviewer 独立 ContextBundle (不含 Coder transcript)
    │  → 两份 ReviewVerdict 落库
    │
    ▼ PR-Manager: gh pr create + 强制模板 (含 Verdicts + Decision 历史)
[8] Stage 9 (release) → Releaser → 用户人审 → gh pr merge → CHANGELOG 自动追加
    │
    ▼ Stage 10 (observe, light) → Observer 后续按 cron 跑 → metric_snapshot
    │
    ▼ Issue 完结 → Documentor 起草 retrospective.md
[9] Retrospective 落库 → 触发进化路径检查 (L7)
    │  - 累积 ≥5 条同 Stage retrospective → Methodology v2 ritual 提案
    │  - patch 评分 ≥4.5 + 用户标记 → skill 提炼路径
    │  - failed Stage 标记 → anti-pattern 库追加
```

---

## 3. 关键不变量速查（违反即回到 plan）

按重要性列出。每条都对应 [HARNESS_ROADMAP.md §0](HARNESS_ROADMAP.md) 的一条原则：

| # | 不变量 | 原文 |
|---|---|---|
| 1 | iOS thin shell + server-driven | §0 #1 |
| 2 | 永不调用 Anthropic Agent SDK | §0 #2 |
| 3 | M-1 奠基期产出最小完备契约 | §0 #3 |
| 4 | 每阶段方法论独立讨论（ritual gate） | §0 #4 |
| 5 | 构建期模型按复杂度自适应（不无脑 Opus） | §0 #5 |
| 6 | 多 AI 交叉评审（risk-triggered → 全量） | §0 #6 |
| 7 | 零混乱代码管理（worktree + PR + 双审 + 模板） | §0 #7 |
| 8 | 文档完整可追溯（每 Stage 必产 Artifact） | §0 #8 |
| 9 | 上下文严格管理（显式 ContextBundle） | §0 #9 |
| 10 | 每个里程碑可独立 ship + 一键回滚 | §0 #10 |
| 11 | 不引入新基础组件（个人自用 SQLite + Hono+WS 足够） | §0 #11 |
| 12 | harness 自身 dogfood 自己 | §0 #12 |
| 13 | 不做日历时间估算 | §0 #13 |
| 14 | 想法捕捉零门槛 + 延迟实现 | §0 #14 |
| 15 | 进化是副产物而非独立组件 | §0 #15 |
| 16 | 不可逆操作沙箱（dry-run + allowlist + 人审） | §0 #16 |
| 17 | 资源隔离（每 Issue 独立 worktree + sessionId 命名空间） | §0 #17 |
| 18 | 多模型集体盲区防护（M4 远期可选非 Claude 终审，个人自用不强制） | §0 #18 |
| 19 | L1/L2 不与已有强对手卷 | §0 #19 |
| 20 | 代码搬运的版权礼仪（保留 license 头 + 出处注释；个人自用不触发 AGPL） | §0 #20 |

---

## 4. 与 plan v4 各章节的映射

便于交叉查阅：

| 本架构 | plan v4 |
|---|---|
| L1 Presentation | §4 多端 UI |
| L2 API | §3 后端模块 + §4 |
| L3 Orchestration | §2 Agent 抽象 + §3 后端模块 + §14 上下文管理 |
| L4 Runtime | §2 AgentProfile + §3.3 cli-runner 改动 |
| L5 Persistence | §1 数据模型（详见 [HARNESS_DATA_MODEL.md](HARNESS_DATA_MODEL.md)） |
| L6 Subject Project | §13 PR 与代码管理 |
| L7.1 安全 | §0 #16-17 + §13 + §7 |
| L7.2 可观测 | §15 文档与记录 + §9 验证方法 |
| L7.3 演化 | §16 进化体系 |

---

## 5. 待澄清的架构问题（讨论中）

以下问题在 [HARNESS_ROADMAP.md §17 Open Questions](HARNESS_ROADMAP.md) 已经登记，本文复述以便架构层视角讨论：

1. **L3 Scheduler vs L4 spawn 的边界** — 一条全链路 spawn 8-10 个 claude 进程，cold start + 多次 Opus 烧钱。是否引入 long-lived `claude --interactive` session 池？冲突"§0 #11 不引入新基础组件"原则。
2. **Server-driven 渲染范围** — M0 选了"5 固定组件 + 受限 schema slot"折中方案，待评审挑战。
3. **L4 是否真要"层"** — 备选：折叠 L4 进 L3，作为 spawn 子模块。
4. **L6 是否属于 harness 边界外** — dogfood 阶段 harness 和它操作的对象同仓库，边界模糊。个人自用阶段如何处理？是否需要单独 toy 仓库验证非 self-reflective 路径？
5. **L7 横切是单独讨论还是穿插各层** — 本文选了单独讨论，避免遗漏。

---

## 6. 维护规则

### 何时更新本文

- 新增 / 删除 / 合并某层 → 立即更新鸟瞰图 + §1 职责段
- 跨层数据流形态变化（如新增一类 Stage / Artifact） → 更新 §2
- §0 设计原则增减 → 同步 §3 不变量速查 + §4 映射

### 同步要求

- 本文与 [HARNESS_ROADMAP.md](HARNESS_ROADMAP.md) 必须保持一致；ROADMAP §0/§1/§2 改动必须同步本文。
- 与 [HARNESS_DATA_MODEL.md](HARNESS_DATA_MODEL.md) 实体定义必须一致。
- 与 [HARNESS_AGENTS.md](HARNESS_AGENTS.md) Agent 列表必须一致。

---

## 7. 引用

- [HARNESS_ROADMAP.md](HARNESS_ROADMAP.md) — plan v4 主文档
- [HARNESS_LANDSCAPE.md](HARNESS_LANDSCAPE.md) — 竞品全景
- [HARNESS_DATA_MODEL.md](HARNESS_DATA_MODEL.md) — 数据模型详细
- [HARNESS_AGENTS.md](HARNESS_AGENTS.md) — Agent 角色详细
- [HARNESS_RISKS.md](HARNESS_RISKS.md) — 风险清单
- [HARNESS_INDEX.md](HARNESS_INDEX.md) — 文档总入口
