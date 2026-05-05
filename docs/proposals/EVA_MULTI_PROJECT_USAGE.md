# Eva 多项目使用与短期调整建议 — 调研报告 v0.1

> **Status**: research / proposal · **Date**: 2026-05-05 · **Author**: Claude Sonnet 4.6
> **Review depth**: Phase 1 + Phase 2 + Phase 3（不可逆度中等，必须走完整三相评审）
> **不可逆度**: 中 — 涉及 cli-runner spawn 环境模型 + harness_project schema 加字段 + iOS 维度抽象。spawn env 白名单是单点行为切换可一键回滚；harness_project 加列是 additive minor bump；iOS 改动需要 server-driven 配合。
> **范围边界**：本 proposal 只覆盖**短期 / 可逆 / 即将做**的多项目使用 + 风险 + P0/P1/P2 调整。**长期"Eva 演化为私人贾维斯"愿景**走独立 proposal `EVA_AS_PERSONAL_JARVIS.md`（Phase D）。两份 proposal 必须分别评审分别收敛。

---

## 0. Context

用户在 4 轮对话中提出了一个 multi-stage 问题：

1. Eva 当前是 dogfood "对自己跑 harness"——以 Eva 自己为 L6 Subject Project（参见 [docs/HARNESS_ARCHITECTURE.md](../HARNESS_ARCHITECTURE.md) §L6）
2. 用户的真实工作目标：**M2-M4 把 harness 跑通后，用 Eva 来开发自己的工程项目**（订单系统 / CRM / 等企业管理系统）。这是从 dogfood 单 Subject 走到多 Subject 的相变
3. 这次相变的"独立性"是分层的：物理仓库独立 / 数据元数据耦合 / 运行时强依赖 / 方法论共享池 / 法律边界假设破裂
4. 用户后续追加：长期方向是**私人贾维斯**（"我的而不是别人的"），所以法律商业边界假设保留为"个人自用、永不分发"，对应 [docs/HARNESS_INDEX.md](../HARNESS_INDEX.md) §跨文档关键约束 #5

**用户拍板的硬约束（不再讨论）**：

- 并行进行：本 proposal 与 M2 loop2+ 同时推进（M2 loop1 已 ship dev `c4c08a6`，进入 loop1→loop2 空窗期，是开 jarvis proposal 的最佳窗口）
- 不引入新基础组件：保留 [docs/HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md) §0 #11
- 不调用 SDK：保留 §0 #2
- worktree 隔离：本 proposal 在 `~/Desktop/claude-web-jarvis` 独立 worktree 起草，与 M2 主工作树物理隔离

本 proposal 的目标：把"用 Eva 做工程项目"从模糊愿望落到**3 条 P0 + 4 条 P1 + 1 条 P2 的具体清单**，每条带事实证据 + 退出条件。

---

## 1. 业界 N 种典型架构（从轻到重）

业界 2026 年同类工具如何在"主体过程 + 多 Subject"形态上做隔离与编排，按"实现成本"从轻到重排：

| # | 架构 | 代表项目 | 隔离层 | 调度层 | 凭据建模 | Subject 形态 | 适合场景 |
|---|---|---|---|---|---|---|---|
| 1 | 单进程 + per-Subject worktree + cwd 隔离 | [Paseo](https://paseo.sh) / Eva 当前 | git worktree | 单进程 setInterval | 默认全继承 env | git 仓库 | 个人自用 1-3 active Subject |
| 2 | 单进程 + worktree + 显式凭据继承模型 | OpenHands [#13268](https://github.com/OpenHands/OpenHands/issues/13268) + [#13506](https://github.com/OpenHands/OpenHands/issues/13506) | Sandbox + worktree | SDK control plane | SaaS settings 继承显式建模 | git 仓库 | 个人/小团队 ≤5 Subject |
| 3 | Pod 容器隔离 + multi-repo fan-out | [Kelos](https://github.com/kelos-dev/kelos) | K8s Pod per agent run | Kubernetes-native | K8s Secret + ServiceAccount | git 仓库 + 多 LLM provider | 团队多 repo |
| 4 | 物理 VM 隔离 + 主子任务分层 | [Devin 2026 managed Devins](https://www.cognition-labs.com/blog/devin-can-now-manage-devins) | VM per child task | 主 Devin 调度子 Devin + ACU | VM 自带凭据 | 任意 | 商业 SaaS |
| 5 | 声明式 manifest + label-driven promotion | [harnext](https://www.flowhunt.io/harnext/) / [Lex](https://project-lex.co.uk/) | GitHub Actions runner | YAML 工作流 | Actions secrets | GitHub PR | 团队 CI |

**Eva 的位置**：第 1 档（单进程 + worktree + cwd 隔离），紧贴 Paseo。**升级方向**：往第 2 档移动（保留单进程，但**显式凭据建模**），不抄第 3-5 档（违反 §0 #11）。

升级到第 2 档不是抄 OpenHands 实现（他们用 Docker Sandbox），而是**抄"凭据继承显式建模"这个识别问题的角度**——这是 Eva 当前最薄弱的一环（事实证据见 §3 / §4）。

---

## 2. 共识规律（5 篇深读交叉验证）

5 篇外部深读（[Devin 2026 release notes](https://docs.devin.ai/release-notes/2026) / [Cognition managed Devins](https://www.cognition-labs.com/blog/devin-can-now-manage-devins) / [OpenHands #13268 SDK 凭据继承](https://github.com/OpenHands/OpenHands/issues/13268) / [OpenHands #13506 audit 加固](https://github.com/OpenHands/OpenHands/issues/13506) / [Mem0 2026 state of agent memory](https://mem0.dev/blog/blog/state-of-ai-agent-memory-2026)）的机制级共识：

| 共识 | 出处 | 在 Eva 的对应 |
|---|---|---|
| 项目身份必须是第一类公民——所有跨实体引用都要先按 projectId 分桶 | Devin managed Devins / Kelos multi-repo fan-out | Eva 已有 `harness_project.id` 但 Inbox / Decision / Skills 没贯穿 |
| 凭据必须显式继承模型，默认全继承是 SDK 时代的反模式 | OpenHands #13268 | Eva [cli-runner.ts:80](../../packages/backend/src/cli-runner.ts#L80) 默认 `env: process.env`——典型反模式 |
| 不可逆操作必须有 sandbox 层 + audit log | OpenHands #13506 minimal agent-scoped identity | Eva `prod-guard.mjs` 是路线图项，未实现 |
| 长期记忆比扩 context window 性价比高 90% 量级 | Mem0 benchmark：91% 延迟降 / 90% token 省 / 53%→67% 准确率 | Eva 当前没有长期记忆层，retrospective 是离散文档（**长期 proposal 的范围**） |
| 主子任务分层 + 子任务读全 trajectory 学习 | Devin reading full trajectories of managed Devins | Eva Strategist 当前不读历史 retrospective（**长期 proposal 的范围**） |

**短期 proposal 重点采纳前 3 条**（项目身份 / 凭据显式 / 不可逆 sandbox），后 2 条留给长期 proposal。

---

## 3. 失败模式清单

业界已暴露 + Eva 通过事实推断可能暴露的失败模式：

| # | 失败模式 | 出处 / 事实证据 | 原因 | 缓解（对应 §5 P0/P1/P2） |
|---|---|---|---|---|
| F1 | spawn 子进程默认全继承 env，敏感凭据泄露到测试代码 | [cli-runner.ts:80](../../packages/backend/src/cli-runner.ts#L80) 直接 `env: process.env` —— 事实存在 | 默认行为是反模式，OpenHands 2026 Q1 重构同款问题 | P0-1 spawn env 白名单 |
| F2 | agent 误触不可逆操作（DB migration / 第三方 API / 部署） | OpenHands #13506 audit log 提案的触发原因；[docs/HARNESS_ROADMAP.md §0 #16](../HARNESS_ROADMAP.md) 已识别但 prod-guard.mjs 未上线 | 缺乏强制 sandbox 层 | P0-2 prod-guard.mjs 上线 |
| F3 | 方法论垂直假设过窄，新 Subject 强行套企业管理系统模板 | [migrations/0001_initial.sql:108](../../packages/backend/src/migrations/0001_initial.sql#L108) `methodology.applies_to` enum 只有 3 选 ('claude-web','enterprise-admin','universal') | 没有 Project 维度的 domainProfile 字段 | P0-4 harness_project 加 domainProfile |
| F4 | 单 SQLite 单进程并发瓶颈 | better-sqlite3 同步 API + Scheduler [setInterval](../../packages/backend/src/scheduler.ts) 全局单 tick | M2 期间只跑 1-2 active；多 Subject 时全局轮询会抖 | P1-1 Scheduler per-project rate limit |
| F5 | iOS Inbox 多 Subject 混乱，30 秒入口反成 30 秒困惑 | [packages/ios-native/Sources/ClaudeWeb/BackendClient.swift](../../packages/ios-native/Sources/ClaudeWeb/BackendClient.swift) 当前 per-conversation 不 per-project | iOS 数据模型缺 project 维度抽象 | P1-2 iOS Inbox/Decision 加 projectName 前缀 + 切换器 |
| F6 | harness.db 单文件损坏 = 所有 Subject 元数据归零 | 当前无任何备份机制；[harness-store.ts:24](../../packages/backend/src/harness-store.ts#L24) 单文件路径 | 备份未实现 | P1-3 harness.db cron 备份 |
| F7 | skill 全局激活，dogfood 提炼的 anti-pattern 喂到非 dogfood Subject | `.claude/skills/*/SKILL.md` 全局 trigger 短语匹配，无 Subject / domainProfile 过滤 | skill frontmatter 缺 appliesTo 字段 | P1-4 skill 加 appliesTo 过滤 |
| F8 | dogfood 改 Eva backend 改坏 harness 进程自身 | [docs/HARNESS_RISKS.md](../HARNESS_RISKS.md) R4.2 已识别但 Eva backend 自重启限制目前靠人工 release 流程 | 自指风险 | 不在本 proposal 范围（已有 release 流程托底） |

**已修正的伪风险**（对话过程中我提过但事实核对推翻的）：

- ~~"ContextBundle 跨项目串导致 agent 误读别项目 spec"~~ —— [migrations/0001_initial.sql](../../packages/backend/src/migrations/0001_initial.sql) `artifact.stage_id NOT NULL REFERENCES stage(id)` + `stage.issue_id NOT NULL REFERENCES issue(id)` + `issue.project_id NOT NULL REFERENCES harness_project(id)` 的 FK 链严格隔离。`listArtifactsForIssue(db, input.issue.id)`（[context-manager.ts:204](../../packages/backend/src/context-manager.ts#L204)）已经间接 by-projectId。**该风险不存在，不进 §5 P0**
- ~~"商业项目用 AGPL 搬运代码触发 license 红线"~~ —— 用户拍板"私人贾维斯，永不分发"，整条排除

---

## 4. 对接现有 harness 数据模型 / 代码

| 维度 | 状态 | 文件证据 |
|---|---|---|
| ✅ Project 已有 schema | `harness_project(id, cwd, name, default_branch, worktree_root, harness_enabled, created_at)` | [migrations/0001_initial.sql:18-26](../../packages/backend/src/migrations/0001_initial.sql#L18-L26) |
| ✅ Project / Initiative / Issue / Stage / Task / Run / Artifact FK 链已严格按 projectId 隔离 | 所有 stage→issue→project_id NOT NULL REFERENCES | [migrations/0001_initial.sql:50-65, 120-142, 205-237](../../packages/backend/src/migrations/0001_initial.sql#L50-L237) |
| ✅ methodology 有 applies_to enum（domainProfile 雏形）| `methodology.applies_to TEXT NOT NULL CHECK (applies_to IN ('claude-web','enterprise-admin','universal'))` | [migrations/0001_initial.sql:108](../../packages/backend/src/migrations/0001_initial.sql#L108) |
| ✅ ContextManager 已 fail-loud + budget pruning | mustHave 缺 throw、mayHave budget 削、prunedFiles 记录 | [context-manager.ts:124-198](../../packages/backend/src/context-manager.ts) |
| ✅ schema migration runner 支持 additive | 用 schema_migrations 表 + transaction 包装 + schema-rebuild mode | [harness-store.ts:108-200](../../packages/backend/src/harness-store.ts) |
| ✅ eva.json + worktree lifecycle hooks 已 ship | H12 v1 + H13 v1 已落地，本 proposal 用同模式登记 jarvis-vision | [eva.json](../../eva.json) + [WORKTREE_LOCK.md](../../WORKTREE_LOCK.md) |
| ❌ cli-runner spawn env 白名单 | 当前 `env: process.env` 默认全继承 | [cli-runner.ts:80](../../packages/backend/src/cli-runner.ts#L80) |
| ❌ harness_project 缺 domainProfile 字段 | 与 methodology.applies_to 概念已存在但 Project 层缺 | 同 schema |
| ❌ prod-guard.mjs 未实现 | [docs/HARNESS_ROADMAP.md §0 #16](../HARNESS_ROADMAP.md) 计划项 | — |
| ❌ Scheduler 全局单 tick，无 per-project 信号量 | [scheduler.ts](../../packages/backend/src/scheduler.ts) 全局 setInterval | — |
| ❌ iOS 数据模型 per-conversation 不 per-project | BackendClient `stateByConversation` | [BackendClient.swift](../../packages/ios-native/Sources/ClaudeWeb/BackendClient.swift) |
| ❌ harness.db 无备份机制 | launchd plist 无 backup job | [`~/Library/LaunchAgents/com.claude-web.backend.plist`](../../README.md) |
| ❌ skill frontmatter 无 appliesTo | `.claude/skills/*/SKILL.md` 当前只有 name + description | — |

---

## 5. 推荐方案：3 阶段渐进（P0 / P1 / P2）

每条带 **核心 + 不做 + 退出条件**，按 [docs/HARNESS_ROADMAP.md §0 #13](../HARNESS_ROADMAP.md) outcome-based 退出条件，不用日历。

### 阶段 P0：开做工程项目之前必须落（3 条）

#### P0-1 cli-runner spawn env 白名单

**核心**：在 [cli-runner.ts:77-81](../../packages/backend/src/cli-runner.ts#L77-L81) 改 `env: process.env` 为 env 白名单：

- AgentProfile 类型加 `inheritEnv: string[]` 字段（默认 `['PATH', 'HOME', 'CLAUDE_CONFIG_DIR', 'LANG', 'LC_*', 'TMPDIR']`）
- AgentProfile 加 `injectEnv?: Record<string, string>` 用于显式注入 worktree 内 `.env.harness`
- spawn 时根据 AgentProfile 计算最终 env 而不是 `process.env`

**不做**：

- 不引入 Docker Sandbox（违反 §0 #11）
- 不抄 OpenHands SaaS-credentials-inheritance 完整实现（用户单机自托管不需要那层抽象）
- 不强制注入 dummy env 防止 agent 探测——只默认拒绝 unsafe 凭据

**退出条件**：

- cli-runner.ts 测试覆盖"AgentProfile 没列入白名单的 env 变量在子进程中读不到"
- 至少 1 个 dogfood Run 实测：在 Eva backend 进程 set `OPENAI_API_KEY=fake-leak-canary`，spawn 后子进程读不到此变量
- AgentProfile fixture 更新所有现有 profile 加 `inheritEnv` 字段（M0 引入的 5 个 profile + M1 mini2 引入的 stage-aware 默认 profile）

#### P0-2 prod-guard.mjs 上线

**核心**：实现 [docs/HARNESS_ROADMAP.md §0 #16](../HARNESS_ROADMAP.md) 长期 plan 的 `prod-guard.mjs`，最小形态：

- 一个 PreToolUse hook 脚本，与 `permission-hook.mjs` 相同机制
- 黑名单命令模式（regex）：
  - `db:migrate` / `prisma migrate deploy` / `alembic upgrade head` / `flyway migrate`
  - `gh release create` / `gh release upload`
  - `aws ` / `gcloud ` / `kubectl apply` / `terraform apply`
  - `stripe ` / `paypal `
  - 任何带 `--prod` / `--production` flag 的命令
- 命中即 return `permissionDecision: deny`，不进 Decision 队列直接拒
- backend 启动时 cli-runner 注入此 hook 到 `--settings`，与 permission hook 同链路（multiple hooks per matcher 支持，[Claude Code hooks 文档](https://docs.claude.com/en/docs/claude-code/hooks)）

**不做**：

- 不写复杂 policy DSL（Lex 风格 enforceable policies 个人自用过重）
- 不接 OPA / Rego / HashiCorp Sentinel
- 不跑 dry-run sandbox（M2 之后 ResourceLock 完整时再加）

**退出条件**：

- prod-guard.mjs 单元测试覆盖 5 类黑名单命令各 1 反例
- 至少 1 个 dogfood Run 实测：spawn agent 时 prompt 含 "请帮我跑 `gh release create v0.5.0`"，agent 调 Bash 时被 hook 拒绝并显示 deny 消息
- IDEAS.md / HARNESS_RISKS.md 引用本 P0-2 落地状态

#### P0-4 harness_project 加 domainProfile 字段

**核心**：在 `harness_project` 表加 `domain_profile TEXT NOT NULL DEFAULT 'software-enterprise'` 字段，与 methodology.applies_to 概念对齐：

- enum 值：`software-enterprise` (=企业管理系统，dogfood 默认) / `software-library` (npm/pypi 包) / `software-cli` (CLI 工具) / `infra-script` (脚本/launchd) / `dogfood-self` (Eva 自己)
- migration 文件 `0004_project_domain_profile.sql`，TARGET_VERSION = 103，default 'software-enterprise' 让 dogfood Project 自动归类
- methodology.applies_to 的 enum 加 `software-library`/`software-cli`/`infra-script` 三选（与 project.domain_profile 对齐）
- PM agent prompt 模板按 domain_profile 分支选 spec 必填段
- iOS 项目创建表单加 domain_profile picker 必填

**不做**：

- 长期 proposal 范围内的 `health` / `finance` / `routine` / `knowledge` 等非软件 domain（留 jarvis 长期 proposal）
- domain 之间的 inheritance / mixin（M5+ 议题）
- iOS 老 build 的兼容性兜底（fallback config 已覆盖未识别 enum→ default 行为）

**退出条件**：

- 0004 migration 跑通 + harness-store 测试 28/28 仍绿
- methodology.applies_to enum 同步扩展且 fixture round-trip TS↔Swift 通过
- 至少 1 个非 dogfood Project 实测创建（如 `~/code/test-cli-tool` 用 `software-cli` profile）+ PM agent 跑 spec 阶段产出按对应模板

### 阶段 P1：跑工程项目第一周必须补（4 条）

#### P1-1 Scheduler per-project rate limit

**核心**：

- Scheduler [scheduler.ts](../../packages/backend/src/scheduler.ts) tick 时按 `task.cwd → project_id` 分桶
- 每桶有独立 `maxConcurrentRuns`（default 2，可在 server-driven config 配置）
- 全局上限保留，per-project 上限叠加

**不做**：

- 不引入 Redis / NATS / BullMQ（§0 #11）
- 不引入 priority queue（v1 FIFO 即可）
- 不引入跨 backend 进程的分布式锁（个人自用单进程）

**退出条件**：

- scheduler 单元测试覆盖"3 个 active project 各 5 个 pending Run，并发 ≤ 6（=3×2）"
- 至少 1 个并发 dogfood + 非 dogfood Run 不互相饿死的实测

#### P1-2 iOS Inbox / Decision 加 projectName 前缀 + 项目切换器

**核心**：

- iOS push 通知 title 前加 `[<projectName>]` 前缀（修改 backend 推送字符串，不动 iOS 代码即可基础生效）
- iOS 顶栏增加项目切换器（沿用 [ProjectRegistry.swift](../../packages/ios-native/Sources/ClaudeWeb/ProjectRegistry.swift)），项目维度优先于对话维度
- iOS Inbox 按项目分组显示
- server-driven `decisionForms[]` 增加 `applicableProjectIds: ['*']` 字段，默认通配

**不做**：

- 不为 iOS 引入新 stateByProject 顶层（保留 BackendClient 现有 stateByConversation 模型，只在 UI 层做 group-by）
- 不动 iOS 协议 schema（向后兼容，老 iOS 装包看到 [<name>] 前缀仍能用）

**退出条件**：

- 至少 2 个并行 active project 时 iOS 看板能按项目分组显示
- iOS 测试覆盖：切换项目时不丢失另一个项目的 pending Decision

#### P1-3 harness.db 每天 cron 备份

**核心**：

- launchd plist 加一个 daily job：`sqlite3 ~/.claude-web/harness.db ".backup ~/.claude-web/backups/harness-$(date +%Y%m%d).db"`
- 保留 30 天（每天清理 30+ 天前的备份）
- backup 用 SQLite 自带 backup API（热备，不需停 backend）

**不做**：

- 不引入 SQLite WAL 流式 replication（§0 #11 灰色地带）
- 不引入 PITR（point-in-time recovery）—— 个人自用按天粒度足够
- 不上传到云（保持本地）

**退出条件**：

- launchd plist 在生产 Mac 跑通至少 7 天，每天有 1 个 .db 文件
- 模拟"主 db 损坏"场景：手动 `mv harness.db harness.db.bak && cp backups/harness-YYYYMMDD.db harness.db`，backend 重启后能正常工作

#### P1-4 skill 加 appliesTo 过滤

**核心**：

- 每个 `.claude/skills/*/SKILL.md` frontmatter 加：

```yaml
---
name: harness-architecture-review
appliesTo:
  domainProfiles: [dogfood-self, software-enterprise]
  projectIds: ['*']
---
```

- agent spawn 前由 cli-runner 计算 当前 Project 的 domainProfile vs skill.appliesTo 是否匹配，不匹配的 skill 不激活
- claude CLI 的 skill 触发是通过 trigger phrase 自动激活，所以这条需要在 CLI 配置层（`~/.claude/skills` 用 symlink 切？或 prompt 里显式告诉 agent "本 Subject 不要调 skill X"）—— **TBD：具体激活机制需要 phase 1 评审时挖一下 claude CLI 文档**

**不做**：

- 不实现 skill 自动归档（M3+）
- 不实现 skill version pinning per project（v1 全局共享版本）

**退出条件**：

- 至少 3 个核心 skill（harness-architecture-review / harness-review-workflow / borrow-open-source）加 appliesTo
- dogfood 实测：在非 dogfood Project Run 时这 3 个 skill 不被自动激活（需要 phase 1 评审时确认 CLI skill 激活机制是否能拦）

### 阶段 P2：长期演进（1 条）

#### P2-3 Worktree spawn 完全独立 .env

**核心**：P0-1 的强化版。每个 worktree 内放 `.env.harness`（gitignore），cli-runner spawn 时优先加载 `<cwd>/.env.harness` 注入子进程 env。

**不做**：

- 不抄 [OpenHands SANDBOX_WORKING_DIR](https://github.com/OpenHands/OpenHands/pull/12660) 的硬编码替换（Eva 路径已 env 化）
- 不强制每个 Project 必须有 .env.harness（可选）

**退出条件**：

- 至少 1 个 worktree 实测：`.env.harness` 内 STRIPE_TEST_KEY 仅在该 worktree spawn 的 agent 内可见，其他 worktree 不可见

### 移到长期 proposal / 删除的项

- ~~P0-3 ContextManager projectId 过滤~~ — 事实推翻：FK 链已隔离（§4 ✅ 行）
- ~~P0-5 元数据镜像到工程项目仓库~~ — 用户愿景修正"思想留 Eva"，**降为 P3 可选**：仅当某 Subject 真的要交付 / 转手 / 归档时按需手动导出（不自动）
- ~~P2-1 商业项目模式~~ — 用户拍板"私人贾维斯永不分发"排除
- ~~P2-2 跨项目 trajectory learning~~ — **移到长期 proposal**（贾维斯记忆层范围）

---

## 6. 关键不变量（防止抄成失败案例的护栏）

| # | 不变量 | 防什么失败 |
|---|---|---|
| K1 | 不引入新基础组件（[§0 #11](../HARNESS_ROADMAP.md)） | Kelos K8s 路径过重、§4 拒绝 Redis/NATS |
| K2 | 不调 Anthropic SDK（[§0 #2](../HARNESS_ROADMAP.md)） | OpenHands 自建 runtime 路径 |
| K3 | 不引入 Docker / VM 隔离 | Devin VM 个人成本天文数字 |
| K4 | iOS thin shell + server-driven（[§0 #1](../HARNESS_ROADMAP.md)） | iOS 改一次锁死，protocol additive |
| K5 | 所有 cli spawn 走 cli-runner.ts 单点 | 防 P0-1 凭据白名单被绕过 |
| K6 | 所有 unsafe 命令走 PreToolUse hook | 防 P0-2 prod-guard 被绕过 |
| K7 | schema migration additive 优先（PRAGMA user_version 单调升） | [docs/HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md) ADR-0015 |
| K8 | per-project rate limit 不引入分布式锁 | P1-1 个人自用单进程足够 |
| K9 | iOS 协议字段 additive + 加 minClientVersion | P1-2 老 iOS 装包看到不识别字段 graceful skip |

---

## 7. 与现有 IDEAS / RISKS / ROADMAP 的合并建议

### 7.1 在 [docs/HARNESS_RISKS.md](../HARNESS_RISKS.md) 新增

加 §8 "多项目使用风险"组，含 8 条：

- R8.1 凭据混杂（事实证据 cli-runner.ts:80）→ P0-1
- R8.2 不可逆操作误触（业界 OpenHands #13506 同款）→ P0-2
- R8.3 方法论领域不贴 → P0-4
- R8.4 单 SQLite 并发瓶颈 → P1-1
- R8.5 iOS 多项目混乱 → P1-2
- R8.6 harness.db 单文件 = 元数据归零 → P1-3
- R8.7 skill 集体盲区跨项目放大 → P1-4
- R8.8 元数据归属（参考性，**降为低风险**因用户愿景"思想留 Eva"）→ P3 可选

### 7.2 在 [docs/IDEAS.md](../IDEAS.md) 新增

在 Borrow 池 H 段后新增 H18-H22 五条：

- H18 spawn env 白名单 → 对应 P0-1（标 ⭐⭐⭐ 必做）
- H19 prod-guard.mjs → 对应 P0-2（标 ⭐⭐⭐ 必做）
- H20 harness_project domainProfile → 对应 P0-4
- H21 Scheduler per-project rate limit → 对应 P1-1
- H22 iOS 项目维度抽象 → 对应 P1-2

P1-3 / P1-4 如已被现有 H 条目覆盖则附加引用而非新建。

### 7.3 在 [docs/HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md) 修订

- §0 #16 不可逆操作沙箱 段加注："P0-2 prod-guard.mjs 落地状态见 EVA_MULTI_PROJECT_USAGE proposal §5"
- §0 #17 资源隔离原则 段加注："P0-1 spawn env 白名单是该原则在凭据维度的具体落地"
- 不新增 M5+ 段（留给长期 proposal）

### 7.4 在 [docs/HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md) 修订

- §1.1 Project 段加 domain_profile 字段说明
- §1.6 Methodology 段更新 applies_to enum

---

## 8. 待用户拍板的决策（≤3 条）

按 [`harness-review-workflow` SKILL.md](../../.claude/skills/harness-review-workflow/SKILL.md) L254 硬约束 ≤ 3 条。

### D1. P0-1 inheritEnv 默认白名单具体含哪些变量？

| 选项 | 内容 | 优劣 |
|---|---|---|
| A 严格最小 | `PATH HOME LANG TMPDIR` | 最安全；可能 break tsx / pnpm 等需要的 NVM_DIR / PNPM_HOME |
| B 推荐（参考 [WORKTREE_LOCK.md L41](../../WORKTREE_LOCK.md) curated env） | `PATH HOME USER SHELL TMPDIR LANG LC_* TERM NVM_DIR PNPM_HOME` | 与现有 hook env 一致；已被 cross M3 评审通过 |
| C 宽松 | B + `XDG_*` + `CLAUDE_CONFIG_DIR` + 其他 dev tool 常用 | 兼容性最好但增加面 |

**推荐 B**——与现有 [eva.json hook](../../WORKTREE_LOCK.md) curated env 一致，已经过 cross M3 评审，避免双套标准。

### D2. P0-4 domain_profile enum 的初始 5 选是否合适？

提议的 enum：`software-enterprise / software-library / software-cli / infra-script / dogfood-self`

- 是否需要在 v1 加 `prototype-throwaway`（玩具实验项目）？
- 是否需要 `data-analysis`（jupyter notebook 类）？
- 长期 proposal 会加 `health / finance / routine / knowledge` 这些非软件 domain，这次留扩展点即可

**默认推荐**：5 选不变，留扩展空间。

### D3. P1-3 备份文件保留 30 天是否合适？

- 30 天 × 当前 harness.db 大小（M2 期间约几 MB） = 几百 MB 占用，可接受
- 替代：14 天滚动 + 每月 1 号 monthly snapshot（永久留存）
- 极端：仅保留最近 7 天（最省空间但故障窗口短）

**默认推荐**：30 天 daily 即可，monthly 永久 snapshot 等 harness.db ≥ 100MB 时再加。

---

## 9. 关键 Open Questions（评审时挑战）

留给 phase 1 reviewer 挑战的开放问题：

- **OQ1**：claude CLI 的 skill 自动激活机制能否被 cli-runner 拦截？P1-4 假设可以，但需要确认 `~/.claude/skills/` 是 CLI 内部读取还是通过 hook/prompt 注入。如果 CLI 内部直接 glob 读取所有 SKILL.md，appliesTo 字段无法运行时拦截，需要走 symlink swap 或 prompt 黑名单。
- **OQ2**：P0-1 inheritEnv 白名单与 `--add-dir` / `--include-cwd` 这类 CLI 参数交互如何？是否 cli-runner 还需要传 `cwd` 之外的额外环境提示？
- **OQ3**：P0-2 prod-guard 的命令 regex 是否会误伤合法命令？比如 `pnpm db:migrate:dev`（dev 别名）会被 `db:migrate` regex 命中——需要白名单覆盖黑名单还是黑名单更严格匹配？
- **OQ4**：P0-4 domain_profile 加在 harness_project 后，老 dogfood Project 的 default 'software-enterprise' 是否合适？dogfood-self 是否应该作为单独 enum 而非 default？
- **OQ5**：P1-1 per-project rate limit 上限 2 是否过低？dogfood 期间往往一个 issue 跑 strategy / discovery / spec 三个 stage 串行，不需要并发；但多 Subject 时希望 concurrent。

---

## 10. Phase 2/3 评审 skip 原因

**不 skip**——本 proposal 触动多个不变量（K1 / K5 / K6 / K7），且 P0-1 / P0-4 涉及 schema + cli-runner spawn 行为切换，必须走完整 phase 1+2+3。

- Trigger check: P0-1 改 cli-runner spawn 是 backend 进程行为切换；P0-4 是 schema additive；P0-2 是新增 hook 文件
- Decision: **跑 phase 1 + phase 2 + phase 3，不 skip**
- Why: 多点动 + 影响下游 R 风险列表 + 影响 IDEAS / RISKS / ROADMAP 多 doc 同步修订
- Escalate condition: 如果 phase 1 任一 reviewer 提出 BLOCKER 否定 P0-1 / P0-2 / P0-4 任一条，phase 2 必须重点 cross-pollinate 该条；phase 3 author 仲裁如果 ≥ 3 条用户决定，回 phase 2 再跑

---

## 11. 引用源

外部参照（按出现顺序）：

- [Devin 2026 Release Notes](https://docs.devin.ai/release-notes/2026)
- [Cognition: Devin can now Manage Devins](https://www.cognition-labs.com/blog/devin-can-now-manage-devins)
- [OpenHands #13268 — SDK credential inheritance](https://github.com/OpenHands/OpenHands/issues/13268)
- [OpenHands #13506 — Audit log + agent-scoped identity](https://github.com/OpenHands/OpenHands/issues/13506)
- [OpenHands #12660 — SANDBOX_WORKING_DIR env](https://github.com/OpenHands/OpenHands/pull/12660)
- [Mem0 — State of AI Agent Memory 2026](https://mem0.dev/blog/blog/state-of-ai-agent-memory-2026)
- [Kelos — K8s-native AI agent orchestration](https://github.com/kelos-dev/kelos)
- [harnext — CI harness for issue-to-PR](https://www.flowhunt.io/harnext/)
- [Lex — AI orchestration for engineering teams](https://project-lex.co.uk/)
- [Paseo — Developer-first agent platform](https://paseo.sh)

内部 Eva 代码引用（已 fact-check 锚点）：

- [packages/backend/src/cli-runner.ts L77-81](../../packages/backend/src/cli-runner.ts#L77-L81) — spawn `env: process.env` 现状
- [packages/backend/src/migrations/0001_initial.sql L18-26](../../packages/backend/src/migrations/0001_initial.sql#L18-L26) — harness_project schema
- [packages/backend/src/migrations/0001_initial.sql L108](../../packages/backend/src/migrations/0001_initial.sql#L108) — methodology.applies_to enum
- [packages/backend/src/migrations/0001_initial.sql L50-65, 120-142, 205-237](../../packages/backend/src/migrations/0001_initial.sql) — Issue/Stage/Artifact FK 链
- [packages/backend/src/context-manager.ts L45-57](../../packages/backend/src/context-manager.ts#L45-L57) — STAGE_SELECTORS 当前形态
- [packages/backend/src/context-manager.ts L204](../../packages/backend/src/context-manager.ts#L204) — listArtifactsForIssue 已按 issue→project 隔离
- [packages/backend/src/harness-store.ts L24, L31](../../packages/backend/src/harness-store.ts) — harness.db 单文件路径 + HARNESS_SCHEMA_VERSION = 102
- [packages/ios-native/Sources/ClaudeWeb/BackendClient.swift](../../packages/ios-native/Sources/ClaudeWeb/BackendClient.swift) — iOS per-conversation 状态模型
- [eva.json](../../eva.json) — H12 v1 worktree 注册表（含本 proposal jarvis-vision 行）
- [WORKTREE_LOCK.md L41](../../WORKTREE_LOCK.md) — H13 hook curated env 白名单（被 D1 选项 B 引用）

内部文档引用：

- [docs/HARNESS_ARCHITECTURE.md](../HARNESS_ARCHITECTURE.md)
- [docs/HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md)
- [docs/HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md)
- [docs/HARNESS_RISKS.md](../HARNESS_RISKS.md)
- [docs/HARNESS_LANDSCAPE.md](../HARNESS_LANDSCAPE.md)
- [docs/HARNESS_INDEX.md](../HARNESS_INDEX.md)
- [docs/IDEAS.md](../IDEAS.md)
- [.claude/skills/harness-review-workflow/SKILL.md](../../.claude/skills/harness-review-workflow/SKILL.md)
- [.claude/skills/reviewer-cross/SKILL.md](../../.claude/skills/reviewer-cross/SKILL.md)
- [.claude/skills/harness-architecture-review/SKILL.md](../../.claude/skills/harness-architecture-review/SKILL.md)
