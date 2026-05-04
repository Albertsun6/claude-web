# Harness Roadmap — 企业级 AI Software Engineer Harness

> **本文是待办路线图，不是现状描述**。当前 claude-web 仍是"个人 Claude CLI 远程控制台"；本路线图描述如何把它演进为企业级 AI software engineer harness。
>
> **整体架构讨论尚未开始**——本路线图是"基础蓝图"，整体架构会基于此展开多轮讨论后落到 `docs/HARNESS_ARCHITECTURE.md`（M-1 第 1 项核心契约的产出）。
>
> **进度状态**：M-1 尚未启动；所有里程碑均为"待办"。
>
> **同步评审**：每次拿本路线图给外部 AI 评审，反馈走 `~/.claude/skills/debate-review/` skill 流程，结果追加到下文"评审辩论流水"段。
>
> ---

> 状态：设计中（**v4，2026-05-01**，已吸收外部 AI 评审第一轮反馈）。
> v4 关键调整（基于评审 + 作者辩论）：
> - **窄腰架构**：M-1 收缩到 4 个核心契约；其余文档改占位
> - **iOS 受限 schema 渲染**：5 个固定原生组件 + slot，不做自由 layout
> - **双 reviewer 改 risk-triggered**（M2 仅对 high-risk 启用，M3 全量）
> - **新增不可逆操作沙箱、资源锁、Reviewer 独立性、schema 迁移、集体盲区**五大约束
> - **企业字段进 spec 必填**（不再是附加字段）
> - **Stage 重量分级**（heavy / light / checklist）
> - **M2 验收改固定任务集 + 难度分层 + 返工次数指标**
> - **Coder 默认复杂度自适应**（不再无脑 Opus）
> - **Documentor 推到 M3**
> - **toy 企业后台仓库 dry-run 加入 M2 准入条件**
> - **清掉所有"周/月"残留**

---

## 评审辩论流水（v3 → v4 的判断记录）

> 用户要求把评审辩论沉淀成长期能力。本节记录本次辩论的接受/反驳论据；同步把流程抽到 §18 的 debate-review skill。未来每次外部评审都按此流程跑一遍，论据落进本节追加。

**v3 评审 → v4 辩论结果矩阵**：

| 评审主张 | 我的判断 | 处理 |
|---|---|---|
| M-1 范围过大 | ✅ 接受 | 收缩到 4 核心契约 |
| M0 不做任意 schema renderer | ⚠️ 部分接受 | 改"5 固定组件 + 受限 slot"混合 |
| M2 双 reviewer 太早 | ⚠️ 部分接受 | 改 risk-triggered；M3 全量 |
| 缺少不可逆操作沙箱 | ✅ 接受 | §0 第 16 条 + sandbox 模块 |
| M2 指标会被刷 | ✅ 接受 | 固定任务集 + 难度分层 |
| Reviewer 被污染 | ✅ 接受 | §2.4 显式上下文约束 |
| 资源锁缺失 | ✅ 接受 | §0 第 17 条 + resource-lock.ts |
| schema 迁移缺失 | ✅ 接受 | §1.2 加 Migration + ADR-0015 |
| Stage 不应等重 | ✅ 接受 | §12 加重量等级 |
| 企业字段进 spec 必填 | ✅ 接受 | §12 改必填段 |
| Coder 默认 Opus 浪费 | ✅ 接受 | 改复杂度自适应 |
| Documentor 砍掉独立 | ✅ 接受 | 推到 M3 |
| 需要 toy 仓库 dry-run | ✅ 接受 | M2 准入条件 |
| §0 与 §6.1 矛盾（"周"残留） | ✅ 接受（自打脸） | 全文清掉 |
| 评审跳过 Q3/Q6/Q8 | 反向挑战 | 加注 §17 |
| 评审跳过 §16 进化体系 | 反向挑战 | 保留请下一轮回应 |
| §14 误读 | 反向澄清 | §14 加显式说明 |
| 多模型集体盲区 | 评审遗漏 | §0 第 18 条 + §7 新增风险 |

---

## Context

claude-web 当前是"Claude CLI 的远程控制台"——iOS/Web 通过 WS 把 prompt 喂给 spawn 出来的 `claude` 子进程，复用用户 Pro/Max 订阅，单用户、对话驱动。

用户的真实目标是做一个 **企业级 AI Software Engineer Harness**：通过 web/移动端控制 AI agents 跑通**软件全生命周期**（战略 → 需求 → 反馈 → 合规 → 设计 → 编码 → 测试 → CR → 部署 → 监控 → 迭代），垂直方向押**企业管理系统**。市场类比：Devin / Cognition / Cursor Background Agents / Multica，但这个是**自托管、多端控制台、企业级方法论严格的形态**。

**用户敲定的硬约束**（不再讨论）：

1. **现阶段单用户**——自己用，不做权限/多租户/认证升级。
2. **MVP 必须打通全链**——每个 SDLC Stage 至少有最小骨架可跑通。
3. **在 claude-web 上演进**——保留 Hono+WS+spawn `claude` CLI 这一根技术栈，绝不引入 Anthropic Agent SDK。
4. **dogfood 验证**——在 claude-web 项目自身的迭代上跑这个 harness。
5. **iOS 是 thin shell + 高优先级**——iOS 改一次锁死，业务全靠 server-driven。
6. **每个 SDLC 阶段方法论需独立讨论敲定**——不是套用通用模板，要为企业管理系统垂直定制；进入新 Stage 第一次执行前必须先产出 `methodology.md` 并由人 + 评审 AI 通过。
7. **架构与框架先敲定再实现**——目录结构、模块分层、协议骨架、PR 规约、上下文协议在 M-1 一次性奠基。
8. **构建阶段用最强模型**（默认 Opus）——多花 token 比后期重构便宜得多。
9. **多 AI 交叉评审**——不依赖单一模型判断；关键卡点（design / review / release）由至少 2 个独立 agent 独立打分。
10. **PR 与代码管理零混乱**——所有写入走 worktree + PR + 双 reviewer + 模板；不允许 force push、不允许跳 hook。
11. **文档与记录完整可追溯**——Issue → Stage → Task → Run → Artifact 全链可搜索；每个 Stage 强制产出 retrospective。
12. **上下文严格管理**——agent 只看到精挑过的最小相关 Artifact bundle，不灌全项目；所有输入显式列在 Stage.inputArtifactIds[]。
13. **纯个人自用，永不分发**——本项目是用户自己的工具，不会给团队用、不会公网部署、不会商业化。所以 AGPL 项目（hapi / Paseo / Coder）可代码级搬运（保留版权声明 + 注明出处即可）；不做权限/多租户/计费/marketplace。

---

## 0. 设计原则（不可让步）

按重要性列。任何里程碑设计违反这些原则就回到 plan。

1. **iOS thin shell + server-driven**：[CLAUDE.md:31-35](CLAUDE.md#L31-L35) 已落位。iOS 改一次锁死。
2. **永不调用 Anthropic Agent SDK**——所有 LLM 工作走 spawn `claude` CLI。
3. **架构先行**：M-1 奠基期产出最小完备的架构与方法论文档；M0 之后任何分层/协议变更都需要走 ADR 流程（[docs/ENGINEERING_GOVERNANCE.md](docs/ENGINEERING_GOVERNANCE.md) 的 ADR 段落已存在）。
4. **每阶段方法论独立讨论**：进入新 SDLC Stage 第一次执行前，必须由用户 + Reviewer-cross 评审通过 `methodology.md`。这是 ritual gate，不是可选项。
5. **构建期不省 token**：Coder/Architect 默认 Opus；Reviewer/PM/Tester 按角色匹配（详见 §2 模型策略）。
6. **多 AI 交叉评审**：design / implement / review / release 四个 Stage 的产出必须由至少 2 个独立 agent 独立验证（不同模型 + 不同 prompt 视角），分歧时升级人审。
7. **零混乱代码管理**：worktree 隔离 + PR 流程 + 双 reviewer + 强制模板。禁用 `git push -f` / `--no-verify` / `git reset --hard origin/*`。
8. **文档完整可追溯**：每个 Stage 必产 Artifact，每个 Issue 必有 retrospective，全部 content-addressed 入库。
9. **上下文严格管理**：agent 看到的输入 = 精挑过的 Artifact bundle，由 Context Manager 按 Stage 类型 + Issue 范围 + 显式依赖编排。绝不"把整个 repo 塞进去"。
10. **每个里程碑可独立 ship + 一键回滚**——不允许"改一半要等下一 M"。
11. **不引入新基础组件**（Redis/NATS/BullMQ/Postgres/launchd/Routines/RN/Flutter）。SQLite + better-sqlite3 是除 Hono+WS 之外唯一允许的新依赖。个人自用规模下绝不需要这些。
12. **harness 自身 dogfood 自己**：M2 起 claude-web 项目自身就是 harness 的第一个 Project。
13. **不做日历时间估算**——AI 协作下"几周完成"已失效。所有里程碑用 **准入条件 + 退出条件 + kill switch** 推进；任何"周/月"概念只用于描述阶段顺序，不附带具体周数。完成度由门槛达成判定，不由时钟判定。
14. **想法捕捉零门槛 + 延迟实现**——用户思维发散、碎片化，需要随时记录但不立即实现。Harness 必须提供"30 秒内能存下一个想法"的入口（语音直接落库），不强迫立刻分类、估优先级、拆 Stage。
15. **进化是副产物而非独立组件**——不建独立"进化引擎"。所有进化（方法论迭代、成功 pattern 提炼成 skill、失败 anti-pattern 收集）都内嵌在 Stage 退出 ritual + Retrospective 里。直接复用 Claude CLI 已有的 `.claude/skills/` 自动激活机制，不重复造轮。
16. **不可逆操作沙箱**——agent 默认无生产凭据。任何 DB migration / 真实三方 API 调用 / 部署命令 / 付费操作必须满足：(a) 显式 allowlist 命中、(b) dry-run 先跑且产 Artifact、(c) 强制人审 Decision、(d) 凭据走环境隔离（worktree 内独立 .env，不继承主进程）。git-guard 之外加 `prod-guard.mjs` 守住第二道。
17. **资源隔离原则**——每个 Issue 有专属 worktree、专属 sessionId 命名空间、专属临时文件目录、专属 logical port range。多 agent 并行时不允许共享可写资源。新增 `resource-lock.ts` 模块用 file-lock + DB 行锁双重防护。
18. **多模型集体盲区防护**——多 AI 评审默认全是 Claude 系列，对同类盲点会一致漏看。每个 Stage 至少有一个 reviewer 用**不同 prompt 视角**（如 ultrareview / 安全 / 性能 / 业务规则反推）。M4 远期可选引入一个非 Claude 模型（OpenAI / Gemini / Kimi）做 read-only 终审，个人自用不强制。
19. **L1/L2 不与已有强对手卷**——iOS native + Web + Tailscale 在跨设备控制台层级已和 hapi (3.8k star) / Paseo 持平。**plan 不在 L1/L2 增加新形态功能**（如 Telegram 通道 / 自建加密中继 / Web 聊天美化），把预算集中到 L3+L7。需要的 L1/L2 能力可以**直接代码级搬运** hapi/Paseo（个人自用不触发 AGPL 限制，详见 §0 #13）。详见 [docs/HARNESS_LANDSCAPE.md](docs/HARNESS_LANDSCAPE.md)。
20. **代码搬运的版权礼仪**——从开源项目搬代码时，文件顶部注释保留 `// borrowed from <project> v<version> (<license>), <url>`。这是版权法基本要求，也给未来自己留余地（万一改变项目定位）。
21. **元工作冻结默认开**（v0.2 2026-05-04 Meta-Freeze P1-7 引入）——`HARNESS_EVOLUTION_FROZEN=1` 是项目默认状态。冻结期内不写新 ADR / proposal / methodology / framework 升级，启动批豁免（[HARNESS_META_FREEZE_v0.2 §1 P0-1](proposals/HARNESS_META_FREEZE_v0.1.md)）。解冻条件硬卡：M1 跑出 ≥1 个真 dogfood Issue。冻结期方法论缺陷登记到 `~/.claude-web/telemetry.jsonl` event=`methodology.debt`，**不新增 store**。详细机制见 [HARNESS_RISKS.md R7.1](HARNESS_RISKS.md)。
22. **输出侧仪式预算**（v0.2 2026-05-04 Meta-Freeze P1-7 引入）——§0 #14 保护输入侧 30s 入口；本条对称保护输出侧。评审 / 决策 / arbitration 不得无上限拖延：fast-path 分级（[harness-review-workflow SKILL.md](../.claude/skills/harness-review-workflow/SKILL.md)）按改动规模分微 / 中 / 大三档评审；用户跳过 ritual 不视为失败而是信号，记入 telemetry 触发 #21 冻结。详细机制见 [HARNESS_RISKS.md R7.2](HARNESS_RISKS.md)。

---

## 1. 数据模型（详细见 [HARNESS_DATA_MODEL.md](HARNESS_DATA_MODEL.md)）

新增持久层 `~/.claude-web/harness.db`（better-sqlite3 + FTS5），现有 `~/.claude-web/projects.json` 不动。

**13 个核心实体**：Project / Initiative / Issue / IdeaCapture / Stage / Methodology / Task / ContextBundle / Run / Artifact / ReviewVerdict / Decision / Retrospective。详细字段、关系、DDL、迁移策略 → [HARNESS_DATA_MODEL.md](HARNESS_DATA_MODEL.md)。

**Stage.kind 10 值固定顺序**：`strategy → discovery → spec → compliance → design → implement → test → review → release → observe`。

**关键不变量**：
- 不引入 Postgres（§0 #11，个人自用永不需要）
- schema 加 `version`，老版本 + 兼容窗口 1 个 minor（ADR-0015）
- Artifact content-addressed；超过 8KB 落 `~/.claude-web/artifacts/<hash>.md`
- 审计日志走 `~/.claude-web/harness-audit.jsonl` append-only
- Run.transcript 仍指向 `~/.claude/projects/<encoded-cwd>/<sid>.jsonl`，DB 只存路径

---

## 2. Agent 角色 + 模型策略 + 多 AI 评审矩阵（详细见 [HARNESS_AGENTS.md](HARNESS_AGENTS.md)）

**12 个默认 AgentProfile**：Strategist (M2) / PM (M1) / Reviewer-compliance (M3) / Architect (M2) / Reviewer-architecture (M2 risk-triggered) / Coder (M2) / Tester (M2) / Reviewer-code (M2) / Reviewer-cross (M2 risk-triggered) / Releaser (M2) / Observer (M3) / Documentor (M3)。

**关键不变量**：
- AgentProfile 通过 server-driven config 注册，运行时 spawn 一次 `claude` CLI 子进程
- Coder 默认**复杂度自适应**（不再无脑 Opus）；高风险路由 Opus，CRUD 路由 Sonnet
- 双 reviewer **risk-triggered**（M2 仅 high-risk / M3 全量 / M4 远期可选非 Claude 终审）
- **评审独立性约束**：Reviewer 不读 Coder transcript（详见 [HARNESS_RISKS.md R3.2](HARNESS_RISKS.md)）
- 成本仅观察落库不设硬上限，超预期触发方法论调整 ritual

完整字段定义、Coder 复杂度自适应规则、评审矩阵触发策略、工具白名单 → [HARNESS_AGENTS.md](HARNESS_AGENTS.md)

<details>
<summary>原 v4 完整 §2 内容（已迁移到 HARNESS_AGENTS.md，此处折叠保留）</summary>

### 2.1 AgentProfile 抽象

`AgentProfile = { id, name, systemPromptTemplate, skillNames[], toolAllowlist[], modelHint, defaultPermissionMode, requiresWorktree, parallelizable, contextBudget, reviewerRole? }`。

通过 server-driven config 注册。runtime 渲染成一次 [packages/backend/src/cli-runner.ts:159](packages/backend/src/cli-runner.ts#L159) `runSession`。

### 2.2 默认 Profile 集（v3 升级）

> **v4 调整**：Coder 改"复杂度自适应"；Documentor 推 M3；Reviewer-architecture 与 Reviewer-cross 在 M2 改 risk-triggered。

| Profile | Stage | 默认模型 | 上 M | 复用 Skill | 需 worktree | 并行 | reviewer 角色 |
|---|---|---|---|---|---|---|---|
| Strategist | strategy | Sonnet（轻量 checklist 模式不需要 Opus） | M2 | — | 否 | 是 | — |
| PM | discovery / spec | Sonnet | M1 | — | 否 | 是 | — |
| Reviewer-compliance | compliance | Sonnet | M3 | `security-review` | 否 | 是 | 评 spec（仅高风险触发，否则跳过） |
| Architect | design | **Opus** | M2 | `borrow-open-source` | 只读 | 是 | — |
| Reviewer-architecture | design | **Opus**（独立 prompt） | M2（risk-triggered）/ M3（全量） | — | 只读 | 是 | 评 design_doc |
| Coder | implement | **复杂度自适应** | M2 | `init` | **必需** | 是 | — |
| Tester | test | Sonnet | M2 | — | 共用 Coder worktree | 串行于 Coder | — |
| Reviewer-code | review | Sonnet（普通）/ Opus（high-risk） | M2 | `review` | 只读 | 是 | 评 patch |
| Reviewer-cross | review | **Opus**（独立 prompt） | M2（risk-triggered）/ M3（全量） | `security-review` | 只读 | 是 | 评 patch（独立视角） |
| Releaser | release | Sonnet | M2 | `update-manual` | — | 串行 | — |
| Observer | observe | Haiku | M3 | — | — | 是；按 cron 触发 | — |
| Documentor | 跨 Stage | Sonnet | **M3**（M1/M2 由各 Stage 自带产出） | `update-manual` | — | 是 | 持续维护 docs |

**Coder 复杂度自适应规则**（server-driven config，可热调）：
- Opus 触发条件（任一即触发）：架构变更 / 跨 packages 协议改动 / 安全相关 / 数据迁移 / 用户标注 risk=high。
- Sonnet 默认：CRUD、表单、单文件 UI 改动、文档、测试用例。
- Haiku 不用于 Coder。

### 2.3 模型策略原则（v4 修订：复杂度自适应优先）

- **架构 / 设计 / 高风险 / 跨端协议用 Opus**——值得多花钱避免重构。
- **CRUD / 文档 / 小 UI / 普通 patch 用 Sonnet**——默认。
- **Observer / 摘要 / 通知用 Haiku**——不烧钱。
- 模型选择写到 server-driven config，dogfood 期可热调；M3 上线 IDEAS.md A1 自动路由。
- **每条 Run 必须记录 cost**（tokens × 单价），Retrospective 汇总。
- **成本是观察阈值不是硬退出门槛**（v4 评审反馈）：超预期时触发方法论调整 ritual，不直接 kill task。

### 2.4 多 AI 交叉评审矩阵

| 被评对象 | 评审者 1（建设性） | 评审者 2（独立验证） | 分歧处理 |
|---|---|---|---|
| spec.md | Reviewer-compliance | PM 自检（不同模型） | 升级人审 Decision |
| design_doc.md | Architect 自检 | **Reviewer-architecture**（独立 prompt + ultrareview 视角） | 升级人审 Decision |
| patch | **Reviewer-code** | **Reviewer-cross**（独立 prompt：安全/性能/边界） | 升级人审 Decision |
| release | Releaser 自检 | 用户人审 | 不允许跳过 |

**实现机制**：
- 每个 reviewer 是独立 spawn 的 `claude` 子进程，**不同 cwd**（worktree 副本，只读），不同 system prompt。
- **评审独立性约束（v4 新增，评审反馈"evaluator 被污染"）**：Reviewer 的 ContextBundle 严格只含 `spec.md + design_doc.md + patch + diff`，**不读 Coder 的 transcript / tool calls / 思考流**。Context Manager 强制 enforce；违反即 Run 失败。
- 评分维度由 server-driven config 定义（如 `correctness, completeness, security, performance, maintainability, alignment_with_spec`），每维 1-5 分 + 结构化 notes。
- 两个 reviewer 任一维度差距 ≥ 2 分自动升级人审。
- 借鉴 Claude Code 的 `/ultrareview` slash command 机制；harness 内自建轻量版本。
- 所有 ReviewVerdict 落库，Retrospective 阶段统计"分歧率"作为方法论健康度指标。

**v4 触发策略调整**（评审反馈"M2 双 reviewer 全量太早"）：
- **M2**：双 reviewer 仅在以下任一情况触发——Issue.priority=high、Issue.labels 含 `security/migration/cross-package`、用户在 spec 阶段手动标 risk=high。其他普通 Issue 用单 reviewer + 用户审。
- **M3**：扩到全量 design / patch（基于 M2 数据回看分歧率与漏检率证明双 reviewer 必要后再开闸）。
- **M4 远期**：可选引入一个非 Claude 模型（OpenAI / Gemini / Kimi）做 read-only 终审，对抗集体盲区。个人自用不强制。

</details>

---

## 3. 后端模块改动

### 3.1 Server-driven config 端点（M0 上线）

[packages/backend/src/routes/harness-config.ts](packages/backend/src/routes/harness-config.ts)：

`GET /api/harness/config` → `{ stages, agentProfiles, decisionForms, modelList, reviewMatrix, methodologyTemplates, promptTemplates, featureFlags, copy, healthChecks }`

WS 事件 `harness_config_changed` 触发热更。客户端 ETag 缓存。

**离线兜底**（用户敲定）：iOS fallback config 仅保留老聊天功能；Board / Decision / 创建 Initiative 在离线时显示"未连接"占位。

### 3.2 Harness 主体新增模块

按依赖顺序：

1. [packages/shared/src/harness-protocol.ts](packages/shared/src/harness-protocol.ts) — TS 类型 + Zod schema + JSON fixture（[ENGINEERING_GOVERNANCE.md](docs/ENGINEERING_GOVERNANCE.md) 已规定 shared 协议必须有 fixture）
2. [packages/backend/src/harness-store.ts](packages/backend/src/harness-store.ts) — better-sqlite3 + FTS5 封装；写锁 + audit log
3. [packages/backend/src/context-manager.ts](packages/backend/src/context-manager.ts) — **新增**：编排 ContextBundle，按 Stage 类型 + Issue 范围 + 显式依赖挑选最小 Artifact 集（详见 §15）
4. [packages/backend/src/methodology-store.ts](packages/backend/src/methodology-store.ts) — **新增**：方法论 CRUD 与版本绑定
5. [packages/backend/src/review-orchestrator.ts](packages/backend/src/review-orchestrator.ts) — **新增**：调度多 AI 评审，对比 Verdict，触发分歧升级
6. [packages/backend/src/scheduler.ts](packages/backend/src/scheduler.ts) — Stage 状态机驱动；事件循环
7. [packages/backend/src/agents/profiles.ts](packages/backend/src/agents/profiles.ts) — AgentProfile 注册 + prompt 渲染
8. [packages/backend/src/worktree.ts](packages/backend/src/worktree.ts) — `git worktree add/remove`，路径 `<projectCwd>/.worktrees/<issueId>`
9. [packages/backend/src/pr-manager.ts](packages/backend/src/pr-manager.ts) — **新增**：封装 `gh pr create/merge`，强制模板/branch 命名/commit 规范（详见 §14）
10. [packages/backend/src/routes/harness.ts](packages/backend/src/routes/harness.ts) — REST 端点
11. [packages/backend/src/routes/inbox.ts](packages/backend/src/routes/inbox.ts) — **新增**：`POST /api/harness/inbox` 接受 `{body, audioPath?}`，落 IdeaCapture；`POST /api/harness/inbox/triage` 批量把 IdeaCapture 转成 Issue（discovery agent 触发）；`GET /api/harness/inbox` 列表查看
11. [packages/backend/scripts/decision-hook.mjs](packages/backend/scripts/decision-hook.mjs) — 仿 [permission-hook.mjs](packages/backend/scripts/permission-hook.mjs)
12. WS 新消息 `harness_event { kind: stage_changed | task_started | decision_requested | run_appended | review_complete | config_changed }`
13. `package.json` 加 `better-sqlite3`

### 3.3 现有模块改动

- [packages/backend/src/cli-runner.ts:7-22](packages/backend/src/cli-runner.ts#L7-L22) `RunSessionParams` 加 `taskId? / systemPromptOverride? / extraSettings? / contextBundleId?`；onMessage 内同时落 Run 记录。
- [packages/backend/src/index.ts:340](packages/backend/src/index.ts#L340) `runs` Map 升级为 "WS 临时引用 + harness-store 持久化" 双写。
- [packages/backend/src/routes/sessions.ts:128-162](packages/backend/src/routes/sessions.ts#L128-L162) `transcript` 增 `?taskId` 查询。
- [packages/backend/src/routes/projects.ts](packages/backend/src/routes/projects.ts) Project 加 `harnessEnabled` 标志。
- [packages/backend/src/auth.ts](packages/backend/src/auth.ts) `verifyAllowedPath` 把 worktree 加隐式白名单。

**不动**：permission 子系统、stream-json 协议、telemetry-store、fs-watcher、session-watcher、voice、context（旧的 git-diff 注入路由）、health。

---

## 4. 多端 UI 设计（v2 不变）

### 4.1 iOS（M0 一次性改造）

iOS 改动只发生在 M0。M1 起所有 Stage / Agent / Decision / 模型扩展都通过后端配置下发。

新增（M0）：
- `Sources/ClaudeWeb/Harness/{HarnessAPI, HarnessStore, SchemaRenderer, FallbackConfig}.swift`
- 现有 [Settings.swift](packages/ios-native/Sources/ClaudeWeb/Settings.swift) 删除硬编码列表，改为读 `HarnessStore.config`。

新增（M1）：
- `Views/Harness/{StageBoardView, DecisionSheet, InitiativeListView}.swift`

iOS 六个核心 flow（schema-driven）：
1. **碎想 Inbox**（M0 即上）——InputBar 旁加"💡"按钮；点按打开极简表单，**默认聚焦语音输入**（复用现有 STT），录完一句就提交。**30 秒内能存下一个想法**是硬指标。所有捕捉的想法走 `POST /api/harness/inbox`，不要求选项目/优先级/标签。
2. 创建 Initiative（schema 驱动表单）
3. 看 Stage 进度 + Inbox 队列（segmented control 加第三段 "Inbox"，可看/编辑/批量 triage 触发）
4. 审批 Decision（schema 驱动表单 + 多 AI 评审分歧时强制人审）
5. 完成通知（本地 `UNUserNotificationCenter`）
6. 紧急介入（Board 行右滑 → 复用现有 transcript 流）

### 4.2 Web（M1 主战场）

新路由 `/harness`，老 `/` 保留 chat 直入。三栏 IA：

```
┌──────────────┬─────────────────────────────┬──────────────────┐
│ Initiative   │  Stage 看板                 │  Run / Review    │
│ ▼ project A  │  [strategy✓][discovery✓]    │  agent: Coder    │
│   Initiative │  [spec✓][compliance✓]       │  ┌─ verdicts ──┐ │
│   ▼ Issue 1  │  [design✓][implement▶]      │  │ R-code: 4.2 │ │
│     Issue 2  │  [test ][review ]           │  │ R-cross: 3.8│ │
│   Initiative │  [release ][observe ]       │  │ DIVERGE!    │ │
│              │                             │  └─────────────┘ │
└──────────────┴─────────────────────────────┴──────────────────┘
```

新组件位于 `packages/frontend/src/components/harness/`。

---

## 5. dogfood 验证用例

| # | 用例 | 验证 7 条要求中的 |
|---|---|---|
| 1 | IDEAS.md A3 "PR 驱动 Agent 调度" 全链路 | 全部 7 条 |
| 2 | IDEAS.md A1 "模型自动选择" | 模型策略、上下文管理 |
| 3 | docs/IMPROVEMENTS.md 性能/可观测性项批量推进 | 多 AI 评审、PR 管理 |
| 4 | "Multica 借鉴" 架构 spike | 方法论讨论 ritual、文档追踪 |
| 5 | iOS Seaidea F1 系列下一项 | 跨 packages、上下文管理边界 |

---

## 6. 里程碑

> 关键节奏：**M-1 是奠基**（架构 + 方法论 + 协议 + 规约），**M0 是 iOS 唯一一次大改装**，之后所有迭代都是后端 + Web。
>
> **不写时长**——按准入条件（entry）+ 退出条件（exit）推进。完成度由门槛达成判定。

| M | 准入条件 | 退出条件（必须全部满足才能进下一 M） | 重装 iOS | kill switch |
|---|---|---|---|---|
| **M-1 架构与方法论奠基** | 用户对 plan v3 拍板 | §6.1 全部交付物 + 4 个核心 ADR 三方审过 + protocol fixture 双端 round-trip 通过 + discovery & spec 方法论用户拍板 | 否 | 不需要（仅文档 + schema） |
| **M0 server-driven 底座 + Inbox** | M-1 退出条件全部满足 | iOS 装新版后老聊天功能零回归 + 离线 fallback 验证通过 + 后端改 config 后 iOS 不重装能热更 + 硬编码列表全部迁移到 server + **Inbox 端点上线 + iOS 💡 按钮可用 + 30 秒内能存一条想法** + **Review Mechanism v2 期所有 review 决策接受 author single-arbitration bias 作为显式妥协项**（[REVIEW_MECHANISM_V2.md](proposals/REVIEW_MECHANISM_V2.md) §6 OQ3） | **是（一次性）** | 删 `/api/harness/config`，iOS 走 fallback；Inbox 表清空 |
| **M1 骨架** | M0 退出条件满足 | Web `/harness` 三栏 IA 跑通 + 单 Issue 走 discovery → spec → awaiting_review → approve → 后续 stub 跳过 + SQLite audit log 完整 + iOS 不重装可见 Board + kill switch 验证通过 + **Review Mechanism v2 期 author solo phase 3 决策不视为 final-irreversible，M3+ Synthesizer 上线后允许 retro re-arbitrate（加 audit trail 字段）** | 否 | `HARNESS_DISABLED=1` |
| **M2 真 agent + dogfood** | M1 退出条件满足 + 已选定固定 dogfood 任务集（5 个 Issue 分难度 S/M/L/XL/XXL）+ 已选定一个独立 toy 企业后台仓库（评审反馈：避免纯 self-reflective 验证） | 固定任务集端到端全跑：S/M 难度成功率 ≥ 90% + L/XL 难度 ≥ 70% + XXL 至少跑通一次 + **每个 Issue 返工次数 ≤ 2** + 平均人审决议 ≤ 3 + risk-triggered 双 reviewer 在 high-risk 项启用率 100% + cost 落库可分析（**不设硬上限**，作观察阈值） + transcript/Verdict/Decision 全可回溯 + Retrospective 自动产出 + toy 企业后台仓库至少 1 条全链路跑通 | 否 | 同 M1 |
| **M3 质量与可观测** | M2 ship 后 Retrospective 显示 ≥ 5 条改进项已收敛 | A1 模型自动选择上线 + Reviewer-compliance 在所有 spec 自动评 + Observer 已反向产至少 3 个真 Issue + 全文搜索可用 + iOS push 通知打通 | 否 | Observer cron 关停 |
| **M4 方法论沉淀** | M3 跑过至少 10 个 dogfood Issue | 10 个 SDLC Stage 方法论全部到 v2 + 至少 1 套 Initiative 模板（企业后台从 0 开始）落库 + 成本/质量报表 UI 可用 | 否 | 切回 v1 方法论 |

**M4 是终点**（项目定位为纯个人自用，永不商业化、永不开放给 team。原 plan v3/v4 的 M5（多人化）/ M6（外部化）已删除——见 §0 #13）。

**关键的"门槛而非时钟"原则**：每个 M 的进出由 checklist 验收，不由日历推动。哪怕一夜跑完 M0 也合法，哪怕卡 M2 几个月不前进也不重排里程碑——卡住时只调方法论和 prompt，不调里程碑结构。

### 6.1 M-1 详细交付物（用户问的"先做架构"答案）

**目标**：在写一行业务代码前敲定所有"敲一次锁很久"的约定。

> **窄腰策略（v4 收缩）**：M-1 只锁 4 个核心契约——其余文档改"占位 + 进入对应 Stage 时再敲"。理由：评审指出 M-1 同时要 8 文档 + 5 ADR 会变成平台工程。

**M-1 必产 4 个核心契约**：

1. **数据模型契约** — `docs/HARNESS_DATA_MODEL.md` + `harness-store.ts` DDL + ADR-0010（SQLite + FTS5）+ ADR-0015（schema 迁移策略：版本号 + 向后兼容窗口 + Artifact 文件 / SQLite / Swift Protocol / TS Zod 四端同步流程）
2. **协议契约** — `packages/shared/src/harness-protocol.ts`（类型 + Zod）+ `packages/shared/fixtures/harness/*.json` round-trip + `packages/ios-native/Sources/ClaudeWeb/Protocol.swift` 对齐 + ADR-0011（Server-driven thin-shell）
3. **ContextBundle 契约** — `docs/HARNESS_CONTEXT_PROTOCOL.md` + ADR-0014（显式 ArtifactBundle + 缺失即失败 + 不做语义检索）
4. **PR & worktree 契约** — `docs/HARNESS_PR_GUIDE.md` + `.github/PULL_REQUEST_TEMPLATE.md` + `COMMIT_CONVENTION.md` + `branch-naming.md` + `git-guard.mjs` + `prod-guard.mjs` + ADR-0013（worktree + PR + risk-triggered 双 reviewer）

**M-1 必产方法论奠基（仅 2 个）**：

- `methodologies/00-discovery.md` — 从 IDEAS / IMPROVEMENTS / git log / telemetry / Inbox 提炼 Issue（M1 用）
- `methodologies/01-spec.md` — 把 Issue 写成可验收 spec；**企业管理系统专属字段（业务实体 / 权限矩阵 / 审批流 / 报表口径）为必填段，不是附加**（M1 用）
- 其余 8 个 Stage 的方法论占位文件——具体内容进入对应 Stage 时再讨论敲定

**M-1 占位（不必完工）**：

- `HARNESS_ARCHITECTURE.md / DIRECTORY.md / REVIEW_MATRIX.md / MODEL_POLICY.md` 仅留大纲 + TBD 标记，进入相关 Stage 时由对应方法论 ritual 补完
- ADR-0012（多 AI 评审）改为 risk-triggered 版本，M3 升级为全量时再发新 ADR

**M-1 不做的事**（评审强烈建议）：
- 不写完整架构文档
- 不写完整目录结构
- 不写 review matrix 全量评分维度
- 不写完整模型策略——只在 ADR-0011 里写一句"Coder 默认复杂度自适应"

**M-1 验收**（必须全部通过才能进 M0）：

1. 4 个核心契约文档由用户 + Reviewer-cross + Reviewer-architecture 三方独立审过（多 AI 评审在 M-1 末尾就开始用，验证机制本身）。
2. 协议骨架的 fixture 在 TS 与 Swift 端能互相 round-trip parse。
3. discovery + spec 方法论由用户最终拍板。
4. git-guard + prod-guard 在 dev 环境跑通拒绝场景测试。
5. 0 行业务代码——M-1 是纯契约 + 协议奠基。

**M-1 不做的事**：
- 不实现任何 agent profile 的真逻辑
- 不写 scheduler
- 不动 iOS UI
- 不动 Web UI
- 不写 8 个 Stage 中除 discovery / spec 外的方法论

### 6.2 各 M 的 ritual gate

每进入新 SDLC Stage 第一次实现前，触发 **方法论讨论 ritual**：

1. PM agent 起草 `methodology.md` 草案（基于已有占位 + dogfood 经验）
2. Reviewer-cross 评一遍（独立 prompt：可执行性 / 可度量性 / 与已有方法论一致性 / 企业管理系统贴谱性）
3. Reviewer-architecture 评一遍（架构契合度）
4. **用户最终拍板**——这是 ritual gate
5. 落到 Methodology 表，对应 Stage 才能进入 running

每 Issue 完结：

1. Documentor agent 起草 retrospective.md
2. 用户 + Reviewer-cross 各加批注
3. 落 Retrospective 表，喂回方法论的下一版

---

## 7. 风险与缓解

**18 条完整风险与缓解 → [HARNESS_RISKS.md](HARNESS_RISKS.md)**

按主题分组：
1. **Agent 行为**（4 条）：自由度过高 / CLI 长链路稳定性 / 上下文失败 / 多 AI 分歧瘫痪
2. **流程与节奏**（4 条）：卡点过多 / MVP 战线长 / 奠基 ritual 不收敛 / 方法论拖延
3. **多 Agent 协作**（3 条）：资源争抢 / Reviewer 被污染 / 集体盲区
4. **不可逆与生产**（2 条）：不可逆操作误触 / dogfood 改坏自己
5. **演化与垂直**（3 条）：企业垂直不贴谱 / schema 演化失败 / 进化反向恶化
6. **运维**（4 条）：iOS 协议演化 / Mac 离线 / 成本波动 / 成本失控

每条对应 §0 某条原则。详细缓解策略 → [HARNESS_RISKS.md](HARNESS_RISKS.md)。
按里程碑分布 → [HARNESS_RISKS.md §7](HARNESS_RISKS.md)

---

## 8. 关键文件

**直接修改**：
- [packages/backend/src/cli-runner.ts](packages/backend/src/cli-runner.ts)
- [packages/backend/src/index.ts](packages/backend/src/index.ts)
- [packages/backend/src/projects-store.ts](packages/backend/src/projects-store.ts)
- [packages/backend/src/routes/sessions.ts](packages/backend/src/routes/sessions.ts)
- [packages/backend/src/routes/projects.ts](packages/backend/src/routes/projects.ts)
- [packages/backend/src/auth.ts](packages/backend/src/auth.ts)
- [packages/backend/package.json](packages/backend/package.json)（加 better-sqlite3）
- [packages/ios-native/Sources/ClaudeWeb/Settings.swift](packages/ios-native/Sources/ClaudeWeb/Settings.swift)（删硬编码列表）

**M-1 新增（纯文档 + 协议骨架）**：
- `docs/HARNESS_ARCHITECTURE.md` `HARNESS_DIRECTORY.md` `HARNESS_PROTOCOL.md` `HARNESS_DATA_MODEL.md` `HARNESS_CONTEXT_PROTOCOL.md` `HARNESS_PR_GUIDE.md` `HARNESS_REVIEW_MATRIX.md` `HARNESS_MODEL_POLICY.md`
- `docs/adr/ADR-0010..0014-*.md`
- `methodologies/00-discovery.md` `01-spec.md` + 8 占位
- `packages/shared/src/harness-protocol.ts` + fixtures
- `.github/PULL_REQUEST_TEMPLATE.md` `COMMIT_CONVENTION.md` `branch-naming.md`
- `packages/backend/scripts/git-guard.mjs`

**M0 新增**：
- `packages/backend/src/routes/harness-config.ts`
- `packages/backend/src/agents/profiles.ts`（descriptor 部分）
- `packages/ios-native/Sources/ClaudeWeb/Harness/{HarnessAPI, HarnessStore, SchemaRenderer, FallbackConfig}.swift`

**M1 新增**：
- `packages/backend/src/{harness-store, scheduler, methodology-store, context-manager}.ts`
- `packages/backend/src/routes/harness.ts`
- `packages/frontend/src/components/harness/{InitiativeTree, StageBoard, StageCard, DecisionModal, AgentBadge, ReviewVerdictPanel}.tsx`
- `packages/frontend/src/routes/HarnessPage.tsx`
- `packages/ios-native/Sources/ClaudeWeb/Views/Harness/{StageBoardView, DecisionSheet, InitiativeListView}.swift`

**M2 新增**：
- `packages/backend/src/{worktree, pr-manager, review-orchestrator}.ts`
- `packages/backend/scripts/decision-hook.mjs`

---

## 9. 验证方法

### M-1 验收
1. 8 份架构文档逐份过 Reviewer-cross + Reviewer-architecture + 用户三方审。
2. `pnpm --filter @claude-web/shared build` 通过；fixtures 在 TS 端 Zod parse 全部通过。
3. iOS Xcode build 通过（Protocol.swift 含 harness 骨架）。
4. `methodologies/00-discovery.md` 与 `01-spec.md` 由用户最终拍板（ritual gate）。
5. 0 行业务代码 commit。

### M0 验收
1. `pnpm install` → `pnpm dev:backend` 启动；`curl /api/harness/config` 返回完整 schema。
2. iOS 装新版到真机；**断 Mac 网络**，应能用打包内 fallback 启动并看老聊天界面正常工作；Board / Decision 入口显示"未连接"占位。
3. 恢复网络，HarnessStore 拉新 config 后 Settings 模型/permissionMode/onboarding 文案与后端一致；改后端 config → WS 推 `harness_config_changed` → iOS 自动 refetch（不重装）。
4. 老路径回归：聊天、语音、权限弹窗、TTS、断线重连、文件浏览全部正常。
5. 跑 [docs/IOS_NATIVE_DEVICE_TEST.md](docs/IOS_NATIVE_DEVICE_TEST.md)。

### M1 验收
1. Web `/harness` 三栏 IA。
2. UI 创建 Initiative → 触发 PM agent stub → 1-2 秒产出固定 spec.md → Stage 切 awaiting_review → Approve → 后续 stub 跳过 → 终止于 implement。
3. iOS 不重装，Board segmented control 看到刚才那条 Issue。
4. SQLite 查询：5 条 Stage 记录与正确状态时间戳；audit log 完整。
5. `HARNESS_DISABLED=1` 重启 → `/harness` 503，老路径正常；iOS Board 显示"未启用"占位。

### M2 验收（v4 修订：固定任务集 + 难度分层 + 返工指标，避免被刷）

**固定 dogfood 任务集**（M2 准入前由用户敲定，覆盖不同难度避免选择偏差）：

| 难度 | 来源 | 例 |
|---|---|---|
| S（小） | docs/IMPROVEMENTS.md 单文件改动项 | 如某个 message 渲染优化 |
| M（中） | IDEAS.md 单 packages 内特性 | 如 InputBox 加一个按钮 |
| L（大） | IDEAS.md 跨 packages 特性 | 如 IDEAS.md A3 PR 驱动调度 |
| XL（架构） | 涉及协议变更 | 如 §16 进化体系一条进化路径上线 |
| XXL（外仓） | toy 企业后台仓库 | 如某个真实 CRUD 模块 + 权限 + 报表 |

**指标**（按难度分层，不再单一阈值）：

- 成功率：S/M ≥ 90%，L/XL ≥ 70%，XXL 至少跑通 1 次
- **返工次数**（每 Issue Stage 重跑次数）：≤ 2 次（评审反馈："避免被刷"的关键指标）
- 平均人审决议次数：≤ 3
- 多 AI 评审分歧率（仅在 high-risk 项启用时统计）：≤ 30%
- cost：**仅观察落库**，不设硬上限；超预期触发模型策略调整 ritual
- 失败时 transcript + Verdict + Decision 完整可回溯
- Retrospective 自动产出且喂回方法论 v2 候选
- toy 企业后台仓库至少 1 条全链路跑通（验证非 dogfood 自指）

---

## 10. 文档维护规则

| 文件 | 触发更新条件 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 加新硬约束；新增 harness invariant |
| [docs/ENGINEERING_GOVERNANCE.md](docs/ENGINEERING_GOVERNANCE.md) | 新 ADR；技术路线变更；harness 抽象层重大调整 |
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | 用户能看到的新功能；M0 不变更，M1+ 用 update-manual skill |
| [docs/IDEAS.md](docs/IDEAS.md) | idea 进入 plan = 移除；新冒出的未做想法落入 |
| [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) | 老 punch list 项被 harness 流水线吃掉 → ✅ |
| [docs/IOS_NATIVE_DEVICE_TEST.md](docs/IOS_NATIVE_DEVICE_TEST.md) | 仅 M0/M3（涉及系统能力或重装时）|
| `docs/HARNESS_*.md` | M-1 创建；每个 M 增量更新；任何架构/协议变更必更新 |
| `docs/adr/ADR-*.md` | 仅在新决策或决策反转时新增；既有 ADR 标 deprecated 不删 |
| `methodologies/*.md` | 进入新 Stage 第一次执行前必更新；每完成 N 个 Issue 触发 retrospective 喂回更新 |
| [docs/HARNESS_LANDSCAPE.md](docs/HARNESS_LANDSCAPE.md) | 发现新对标项目 / 现有对标项目重大变更 / Seaidea 路线被某项目验证或推翻；每次外部评审前必喂给评审 AI |
| 代码搬运版权礼仪 | 从开源项目搬代码时文件顶部注释保留 `// borrowed from <project> v<version> (<license>), <url>`。个人自用不触发 AGPL 限制，但保留出处是版权法基本要求 |

**长期原则**（已落 [CLAUDE.md:31-35](CLAUDE.md#L31-L35) 与 [docs/ENGINEERING_GOVERNANCE.md:67-74](docs/ENGINEERING_GOVERNANCE.md#L67-L74)）：

1. 移动端新功能默认进 `packages/ios-native/`，不进 Capacitor wrapper。
2. 可变内容尽量 server-driven config。
3. 协议变化必须同步 Swift 协议和 fixture。
4. 系统能力相关改动必须复核真机测试文档。
5. SwiftUI 是长期 iOS 路线，不擅自迁回 Capacitor/PWA 或 RN/Flutter。

---

## 11. 评审重点（给外部 AI）

**评审 AI 请按以下 4 个维度依次给反馈**（用户敲定）：

1. **架构可行性**——server-driven shell + 状态机 + agent profile + 多 AI 评审 + Context Manager 这套抽象在 6 个月后还撑得住吗？哪些抽象会变成负债？
2. **里程碑裁剪是否合理**——M-1 / M0 / M1 / M2 拆分（v4 用准入/退出条件而非时长，详见 §0 第 13 条与 §6）是否过粗或过细？M2 验收门槛（固定任务集 + 难度分层 + 返工次数指标，详见 §9 v4 版）合理吗？
3. **企业管理系统垂直是否贴谱**——10 个 Stage + 12 个 Profile（含 reviewer + Documentor）在样例企业后台项目（CRUD + 表单 + 审批 + 报表 + 权限）上跑得通吗？哪些 Stage 在该垂直里其实是空跑？方法论模板是否需要专门的"业务实体""权限矩阵""审批流""报表口径"字段？
4. **风险是否遗漏**——除了 §7 列的 12 条，还有什么？特别关注：安全（agent 误操作生产/三方）、成本（多 AI 评审 + Opus 默认的烧钱速度）、不可逆操作（DB 迁移 / API 调用）、多 agent 资源争抢（同 worktree / 同 sessionId 冲突）、上下文管理失效。

**重点挑战的取舍**：

1. **M-1 范围 v4 已收缩到 4 核心契约**——评审第一轮已确认。下一轮请挑战：4 项是否仍然过多？哪一项可以推到首次进入对应 Stage 时再敲？
2. **多 AI 评审是不是过早**？M2 就上双 reviewer 会不会显著拖慢迭代？是否应该 M3 才上、M2 单 reviewer 即可？
3. **Coder 默认 Opus 是不是浪费**？典型 CRUD 改动 Sonnet 已经够；建议改成"复杂度自适应"（架构变更 / 安全相关用 Opus，其他 Sonnet）？
4. **Documentor agent 是否多余**？文档可以由各 Stage 完成时强制产出，专门 agent 是否过设计？
5. **Server-driven shell 是不是过早抽象**——M0 只抽最痛的两块（模型列表 + decisionForm），其他保留硬编码到 M1 再扩？
6. **SQLite vs 扩 projects.json**——当前规模（<100 Issue, <1000 Run）下 JSON 是否够用？
7. **Stage 一定要 10 个吗**——M1 只做 4 个（spec / implement / review / release），其他 M3 再补？
8. **Coder 必须 worktree 吗**——M2 用 git stash + branch，M3 再上 worktree？
9. **iOS Board 是不是优先级排错**——M1 完全不动 iOS、Web 看板成熟后 M2 再让 iOS 接入？
10. **CLI spawn 多进程的性能与成本瓶颈**——一条全链路 spawn 8-10 个进程，Opus token 成本 + 启动延迟。是否引入 long-lived `claude --interactive` session 池？这冲突"不引入新基础组件"原则吗？
11. **dogfood 在 claude-web 自己上跑会不会太自反**——是否应该先在另一个 toy 企业后台仓库跑通再回来 dogfood？
12. **上下文管理用 Context Manager 服务是不是过度**——Claude CLI 自带 `/clear` 和 context engineering 是否够用？

---

## 12. SDLC 方法论框架（每个 Stage 的方法论模板）

> M-1 时只敲 discovery + spec 两个详细方法论；其他 8 个仅准备模板大纲，进入 Stage 第一次执行前再讨论敲定（用户敲定的 ritual）。

每份 `methodologies/<stage>.md` 必含字段：

```
---
stage: <kind>
version: <semver>
appliesTo: claude-web | enterprise-admin | universal
approvedBy: <user> + <reviewer-cross> + <reviewer-architecture>
approvedAt: <ISO>
---

## 1. 输入定义
   - 上游 Stage 必须产出哪些 Artifact 类型
   - 必填字段、可选字段
   - Context Manager 应挑选哪些 Artifact 进 ContextBundle

## 2. 产出定义
   - 必产 Artifact 类型 + 验收准则
   - 失败回退策略

## 3. Agent 提示词模板
   - System prompt 骨架
   - Skill 集
   - 工具白名单

## 4. 人审 checklist
   - Decision 表单字段
   - 跳过条件（什么场景下可以无人审自动通过）

## 5. QA 标准
   - 多 AI 评审矩阵中本 Stage 的 reviewer 角色
   - 评分维度
   - 分歧升级阈值

## 6. Retrospective 触发
   - 哪些指标偏离触发方法论调整 ritual
   - 升级流程

## 7. 企业管理系统专属附加
   - 业务实体补充规则
   - 权限矩阵补充
   - 审批流补充
   - 报表口径补充
```

**Stage 重量分级**（v4 评审反馈："Stage 不应每个等重"）：

- **heavy**（独立 agent + worktree + 完整产 Artifact）：design / implement / test / review / release —— 企业后台核心
- **light**（一个 agent run，简化产出）：discovery / spec / observe —— 基础但不复杂
- **checklist**（一段 prompt + 人勾选确认，不开独立 agent）：strategy / compliance —— 早期 Issue 大多数情况下不需要重度展开

进入 Stage 时若用户判断该 Issue 上当前 Stage 不需要"heavy 模式"，可直接降级到 light 或 checklist，由方法论决定降级条件。

10 个 Stage 的方法论简介（具体内容进 Stage 时讨论）：

| Stage | 重量 | 关键方法论焦点（草） |
|---|---|---|
| strategy | checklist | KPI 量化标准；trade-off 决策树 |
| discovery | light | 来源加权（IDEAS / 反馈 / telemetry / git / Inbox）；去重；优先级矩阵 |
| spec | heavy | 验收准则可测试化；**企业管理系统必填段（业务实体 / 权限矩阵 / 审批流 / 报表口径）** |
| compliance | checklist（默认）/ heavy（高风险触发） | 数据 / 安全 / 许可合规 checklist |
| design | heavy | 接口契约 + 数据流图；架构决定上 ADR；企业字段约束传递 |
| implement | heavy | 拆 commit 粒度；测试同步写；防过度工程；不引新依赖；resource-lock 守 worktree |
| test | heavy | 单测 / 集成 / 回归 / 数据迁移；coverage 按风险分级 |
| review | heavy | risk-triggered 双 reviewer + 评分维度 + 分歧升级 + 评审独立性约束 |
| release | heavy | 灰度策略；回滚预案；用户通知；prod-guard 守不可逆操作 |
| observe | light | 监控指标基线 / 告警阈值 / 反向产 Issue 路径 |

---

## 13. PR 与代码管理规约（M-1 落 docs/HARNESS_PR_GUIDE.md）

### 13.1 强制要求

1. **所有 Coder 写入走 worktree**——`<projectCwd>/.worktrees/<issueId>`，分支名 `harness/<issueId>-<slug>`。
2. **每个 Issue 一个 PR**——多 commit 但单 PR；PR 描述自动从 spec.md + design_doc.md + review_verdicts 拼接。
3. **PR 模板强制字段**：Issue 链接 / Stage / AgentProfile / Reviewer Verdicts (双) / Decision 历史 / 回滚预案 / changelog 摘要 / cost。
4. **commit 消息**：`<type>(<scope>): <subject>` + 末尾必加 `harness-stage: <kind>` + `Co-Authored-By: <agent>`。type 复用现有 `feat / fix / docs / refactor / test / perf / chore`。
5. **branch 命名**：`harness/<issueId>-<3-5word-slug>`；`harness/discovery-*` `harness/hotfix-*` 是预留前缀。
6. **merge 规则**：双 reviewer Verdict 全部 ≥ 4.0/5 + 用户 Decision approved + CI 全绿；任一不满足必走人审。**禁用 squash 之外的合并方式**（保持 commit 序列清晰但 main 干净）。
7. **回滚**：发现问题走 `git revert`，**禁止** `git reset --hard origin/main` 或 `git push --force` 到任何远程分支。
8. **git-guard pre-push hook**（[packages/backend/scripts/git-guard.mjs](packages/backend/scripts/git-guard.mjs)）阻止：force push 到 main/master、`--no-verify`、`--no-gpg-sign`、commit author 为空。

### 13.2 多 PR 协作

- 不同 Issue 并行时各自独立 worktree + 独立 PR；冲突由 Issue 优先级 + 时间序处理（先 merge 高优 / 先就绪的）。
- 同一 Issue 多次迭代不开新 PR，force-push-with-lease 到自己的 worktree 分支可（远程是 worktree 分支不是 main）。
- Hotfix 单独 issueId 前缀 `hotfix-`，跳 strategy / discovery / spec，直接 design → implement → release。

---

## 14. 上下文管理体系（M-1 落 docs/HARNESS_CONTEXT_PROTOCOL.md）

> 用户要求：避免无用信息干扰。这是企业级 harness 与玩具级的核心差异之一。

### 14.1 设计原则

1. **agent 看到的输入 = ContextBundle**——明确列举的 Artifact 集合，不是"整个 repo 任意访问"。
2. **Context Manager 服务**（[packages/backend/src/context-manager.ts](packages/backend/src/context-manager.ts)）按规则编排 Bundle，结果落库便于复盘。
3. **agent 显式声明依赖**——AgentProfile 加 `contextBudget: { maxArtifacts, maxTokens, mustInclude[], mayInclude[] }`，Context Manager 按 budget 挑。
4. **找不到必需 Artifact 时 agent 必须 fail，不允许脑补**——methodology.md 与 system prompt 都要写清这条。
5. **每个 ContextBundle 落 SQLite + 写一份 markdown snapshot 到 `~/.claude-web/bundles/<bundleId>.md`**——可审计、可复盘、可作为 dogfood retrospective 输入。

### 14.2 默认挑选规则（按 Stage）

| Stage | mustInclude | mayInclude（按 budget 削） |
|---|---|---|
| strategy | Initiative.intent / 现状摘要 / KPI 历史 | 旧 Initiative retrospective |
| discovery | IDEAS.md / IMPROVEMENTS.md / git log 摘要 / telemetry summary | 旧 Issue 标题列表 |
| spec | Issue.body / methodology.md / 类似 Issue 的 spec.md | 业务实体既有清单 |
| compliance | spec.md / docs/ENGINEERING_GOVERNANCE.md 合规段 | 历史 compliance 决议 |
| design | spec.md / 现有架构 ADR / 类似 design_doc | 重要源文件按 grep |
| implement | spec.md / design_doc.md / 相关源文件 grep / 测试样例 | 类似 patch 历史 |
| test | spec.md / patch / 现有测试 | coverage 历史 |
| review | spec.md / design_doc.md / patch / 现有 review 模板 | 类似 review_notes |
| release | merged PR / changelog / deploy 历史 | 失败 release 教训 |
| observe | telemetry / metrics / 用户反馈 | 现有 alerts 配置 |

### 14.3 反例（绝对不做）

- ❌ 把整个 `packages/` 作为输入丢给 agent。
- ❌ 让 agent 自由 `Glob/Grep` 在主 cwd（只能在 worktree 副本，且只能 grep 不能读非 ContextBundle 文件）。
- ❌ 复用前一 Run 的 transcript 作为下一 Run 的 context（除非显式作为 Artifact 列入）——长链路撞墙的主因。

---

## 15. 文档与记录追踪体系（贯穿全周期）

> 用户要求：完整可追溯。

1. **每个 Stage 必产 Artifact**——methodology.md（首次执行 Stage）/ spec.md / design_doc.md / patch / pr_url / test_report / review_notes / review_verdict / decision_note / retrospective.md / changelog_entry。
2. **Artifact 全部 content-addressed**——hash + path，永不修改（修改产生 superseded link）。
3. **SQLite FTS5 全文索引**——Issue.title/body、Artifact.contentRef 文件内容，UI 提供搜索框。
4. **审计日志**——`~/.claude-web/harness-audit.jsonl` append-only，记录所有写操作。
5. **自动 changelog**——Releaser 阶段 Documentor agent 从该 Issue 全部 Artifact 拼出 changelog entry，写 `CHANGELOG.md`。
6. **每 Issue retrospective**——whatWentWell / whatToImprove / methodologyFeedback / costSummary，用户 + Reviewer-cross 加批注后落库；统计学上 N 个 Issue 后触发方法论 v2 ritual。
7. **Trace 视图**——Web `/harness/runs/:id` 提供 timeline：Issue → Stage 切换 → Task spawn → Run transcript → Artifact 产出 → Verdict → Decision，全部时间戳 + cost。
8. **Stage 失败保留全部材料**——transcript + 部分 patch + verdicts，不删；用户介入时直接看到。

---

## 16. 进化体系（"越用越聪明"的可靠实现）

> 用户要求：进化体系，但要考虑实现复杂度和可靠性。

### 16.1 核心判断（用户敲定后落在 §0 第 15 条）

**不建独立"进化引擎"**——进化是 Stage 退出 ritual + Retrospective 的副产物。这避免重复造 Claude CLI 已有机制（`.claude/skills/` 自动激活 + memory），把复杂度留给真正有价值的部分。

### 16.2 三条进化路径

**触发分类（不是新组件，只是给已有触发起名）**

下面三条路径在被触发时分两种来源——**用户拍板式**（用户主动开口"Stage 5 方法论太重，简化"，相当于人手把 ritual 跑一遍）和**累积式**（retrospective 自动累积到阈值起评审）。两种来源**走同一套评审矩阵**（reviewer-cross + reviewer-architecture 双审 + 用户拍板）+ **同一冻结开关**（`Initiative.methodologyVersion` 一键回滚 + `HARNESS_EVOLUTION_FROZEN=1` 全局停 ritual，参考 §16.3）。**不存在独立的"主动进化引擎" / "evolution scheduler"**——用户拍板只是 §16.2 三路径的人工触发版，对应 §0 第 15 条 Invariant。任何"自动 / 累积式"措辞默认隐含 reviewer-cross + 用户拍板必经环节，agent 不允许自改方法论 / skill 库（§16.3 第 1 条）。

**路径 1：Retrospective → Methodology v2**

- 触发：每 Issue 完结自动产 retrospective.md。
- 累积：同 Stage 累积 ≥ 5 条 retrospective 触发方法论 v2 ritual 提案。
- 验证：Reviewer-cross 评提案 + 用户拍板。
- 落库：Methodology 表新增版本，新 Issue 默认绑 v2，老 Issue 不动。
- 失败兜底：v2 出问题用 `Initiative.methodologyVersion` 字段直接切回 v1（一键回滚）。

**路径 2：成功 patch → `.claude/skills/`**

- 触发：Issue 成功合并 + Retrospective 评分 ≥ 4.5/5 + 用户标记"该 pattern 可复用"。
- 提炼：Documentor agent 读 patch + spec.md + design_doc.md，产出候选 `.claude/skills/<name>/SKILL.md`。
- 验证：Reviewer-cross + Reviewer-architecture 双审，**两人都通过才落到 `.claude/skills/` 目录**。
- 自动激活：Claude CLI 原生机制（按 description 匹配），不用 harness 自己做 skill 路由。
- 审计：每月 audit，N 个月未触发的 skill 自动归档（不删，移到 `.claude/skills/_archive/`）。

**路径 3：失败 anti-pattern 库**

- 触发：Stage failed 且 Retrospective 标记"未来要避免"。
- 落地：以 `methodology` 类型 Artifact 的形式追加到对应 Stage 的 methodology.md 的"Anti-patterns"段，下次 spawn 同类 agent 时由 Context Manager 显式包含。
- 验证：人审一次入库即可（anti-pattern 比正向 pattern 容错高，加错最多让 prompt 啰嗦）。

### 16.3 可靠性约束（防止反向恶化）

1. **任何进化产出必须经多 AI 评审**——不允许 agent 自己修改自己的方法论 / skill 库。
2. **进化变更走 ADR-lite**——methodology v2 / 新 skill 上库都生成一份 mini-ADR，落 `docs/adr/` 可追溯。
3. **降级开关**——`HARNESS_EVOLUTION_FROZEN=1` 环境变量冻结所有方法论 / skill 升级，只读模式跑 harness。
4. **指标驱动**——每周自动报表：方法论命中率、skill 触发率、anti-pattern 阻挡了多少次重复错误；指标恶化触发用户审视。
5. **不做 ML 化 fine-tuning**——个人自用规模根本用不上；进化全部基于 prompt + skill 文件 + methodology markdown，可读、可改、可回滚。

### 16.4 进化体系里程碑分布

- **M0**：仅上 Inbox 端点（捕捉想法本身就是进化的输入源头）。
- **M1**：每 Issue 退出强制产 retrospective.md（Documentor stub）。
- **M2**：retrospective 真实产出 + 累积统计；尚不触发方法论 v2。
- **M3**：路径 2（成功 patch → skills）打通 + 路径 3（anti-pattern）打通。
- **M4**：路径 1（methodology v2 ritual）成熟 + 月度 audit 报表。

---

## 17. Open Questions（v4 状态：评审第一轮已回应，留给下一轮）

| Q | v3 问题 | v3 评审第一轮回应 | v4 状态 |
|---|---|---|---|
| Q1 | M2 双 reviewer 默认化 | 推 M3 全量 | ✅ 已采纳改 risk-triggered（M2 仅 high-risk）；M3 全量 |
| Q2 | Coder 默认 Opus | 复杂度自适应 | ✅ 已采纳，规则见 §2.2 |
| Q3 | M2 验收门槛过严？ | 评审未回答 | 🟡 v4 已改固定任务集 + 难度分层；仍需评审挑战 |
| Q4 | toy 仓库 dry-run？ | 必须做 | ✅ 已加入 M2 准入条件 |
| Q5 | Documentor 独立 agent | 砍掉，推 M3 | ✅ 已采纳 |
| Q6 | Initiative 模板时机 M1 / M4 | 评审未回答 | 🟡 v4 维持 M4；待挑战 |
| Q7 | Inbox 附件支持 | M0 仅文本+语音 | ✅ 已采纳，图片/链接进 §17 新 Q11 |
| Q8 | 方法论 v2 ritual 阈值 | 评审未回答 | 🟡 v4 暂定 5 条 retrospective；待数据校验 |
| Q9 | 成功 pattern 量化判定 | 必须量化 | ✅ 已采纳，量化边界见 §16.2 路径 2 |
| Q10 | M0 schema renderer 边界 | 评审建议固定组件 | ⚠️ v4 改"5 固定组件 + 受限 slot"折中；待挑战折中点是否合理 |
| Q11 | Inbox 图片/链接附件何时上 | — | 🟡 留给 M3 一并设计 |
| Q12 | toy 企业后台仓库选哪个 | — | 🟡 待用户敲定（自建一个最小 CRUD repo？还是借用既有开源后台模板？） |
| Q13 | M3 推 Documentor 是否需要专属审计 ritual | — | 🟡 留给 M3 入口讨论 |
| Q14 | 用户主动触发进化的 UI 入口挂哪 | — | 🟡 候选：iOS 设置页"进化"入口 / `/evolve <stage>` slash command / harness CLI 子命令；涉及 [packages/ios-native/Sources/ClaudeWeb/](packages/ios-native/Sources/ClaudeWeb/) 与 [.claude/skills/](.claude/skills/) 联动，留 M-3 决 |
| Q15 | 结构化审视 skill (`architecture-audit`) 自动 fire 准入条件 | — | 🟡 候选：`.claude/skills/` ≥ 10 个 **且** methodology v1→v2 至少升过 1 次 → 每月最多 1 次自动审视。**强约束**：自动 fire 需先给 `Retrospective` schema 加 `antiPatternLabel` 字段（[HARNESS_DATA_MODEL.md](HARNESS_DATA_MODEL.md) Retrospective 实体扩展），未做前不可启用，仅 manual `/architecture-audit` 触发 |

---

## 18. 评审辩论流程（待批后落地为 `~/.claude/skills/debate-review/SKILL.md`）

> 用户要求：把这次评审辩论沉淀为可复用 skill，每次评审都用并自我完善。

**Skill 名**：`debate-review`

**SKILL.md 内容草案**（plan 批准后我会用 Write 实际创建）：

```markdown
---
name: debate-review
description: 收到外部 AI 对架构 plan / PR / 设计 / spec 的评审反馈后，用结构化辩论流程评估每条意见，形成接受 / 部分接受 / 反驳的判断矩阵，并把改动落到原文件。Use when user pastes a code review / architecture review / design critique from another AI and wants me to weigh each point with my own judgment instead of blindly accepting.
---

# debate-review skill

## 触发场景

用户粘贴外部评审反馈并明示或暗示要"有主见地处理"。常见提示词：
- "以下是评审结果"
- "另一个 AI 评审"
- "你要有主见，评估他的结果"
- "经过多轮辩论"

## 五步流程

### 1. 通读 + 抽提主张

把评审分解为独立"主张单元"——每个单元一句话能复述。区分：
- **必须先改类**（评审者标 must / blocker）
- **方向类**（评审者整体判断）
- **细节类**（具体设计点）
- **未回答类**（评审跳过的原 Q）

### 2. 逐条判断（四档）

每个主张分到下面四档之一：

| 档 | 触发条件 | 处理 |
|---|---|---|
| ✅ 接受 | 主张属实 + 改动可控 + 无更优替代 | 落 plan，无须辩论 |
| ⚠️ 部分接受 | 方向对但分寸过 / 不及；或评审给的方案过简 / 过繁 | 写反提案，融合双方视角 |
| 🚫 反驳 | 评审有事实/理解错误，或有更强反论据 | 写论据 + 引文，不落 plan，等下一轮挑战 |
| 🟡 挂起 | 缺数据，需 dogfood 验证 | 标 Open Question 留下一轮 |

### 3. 反向挑战评审者

评审 AI 也会有盲点。必查：
- 哪些原 Q 评审跳过了？
- 评审是否误读了某段？（看是否引用 plan 段号正确）
- 评审有没有"集体盲区"——如果它和被评者用同代模型，会不会一致漏看？
- 评审给的建议是否过抽象（如"窄腰架构"），缺具体取舍？

挑战写进辩论矩阵，下一轮评审时呈给评审者。

### 4. 写辩论矩阵到原文件

在原 plan / 设计文档里加一节"评审辩论流水"，用表格记录：

| 评审主张 | 我的判断 | 处理 |
|---|---|---|
| ... | ✅/⚠️/🚫/🟡 | 段号 |

下次评审时同节追加新一轮。这个矩阵就是长期记忆——同一个 plan 可经多轮评审而不丢失早期决策依据。

### 5. 落改动 + 收尾

- 接受类的改动直接 Edit 落地
- 部分接受类写反提案进 plan
- 反驳类不改 plan，但在矩阵里写论据
- 收尾时简短报告（接受 N / 部分接受 N / 反驳 N / 挂起 N + 关键反提案 1-2 条）

## 自我完善机制

每次跑完 debate-review：
- 在 `~/.claude/skills/debate-review/log.jsonl` 追加一条：date, planFile, totalClaims, accepted, partial, rejected, hung, biggestInsight, biggestMistake
- 累积 ≥ 5 次后：把高频的反提案 / 反驳论据沉淀进 SKILL.md "常见模式" 段
- 每次 skill 触发先读 log 末尾 3 条，避免重复犯错

## 反例

- 全盘接受评审：失去主见，plan 反复被同一意见来回拉扯
- 全盘反驳：自负，浪费评审价值
- 不写矩阵直接改 plan：丢失辩论历史
- 把"评审跳过的问题"当成"评审认可"：跳过 ≠ 同意，要主动追问
```

**为什么把 skill 写在 plan 里再批准创建**：当前在 plan mode，只能编辑 plan 文件。批准 plan 后我用 Write 创建实际的 skill 目录和文件。
