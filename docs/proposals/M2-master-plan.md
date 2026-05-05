# M2 Master Plan — Anchor Gate + 螺旋圈映射（v2）

**Status**: PROPOSAL v2（pending user approval + cursor-agent cross-review）
**Author**: Claude Opus 4.7 (1M context)
**Date**: 2026-05-05
**Revision**: v1 → v2（用户 + 另一AI PK 评审收敛后）
**Trigger**: 用户在 PR #28 (F orphan cleanup) 节点指出 M2 scope 没对齐——之前做的 H14 + G + H + F 都是 H14 派生的 housekeeping，没系统推进 M2。

---

## 总则（v2 引入）

**M2 不再采用 5-wave batch。M2 采用 loop-by-loop approval**：每个 Loop 有自己的风险陈述、anchor gate、最小切片、机器验证、dogfood、cross-review、retrospective、ship/drop/defer。**后续 Loop 的启动必须基于上一 Loop 的证据**（强 retrospective 输入）；不允许预设"5 个 wave 一次性走通"。

§3 的目标→圈映射作为**全景地图**保留（信息有价值），但**不等于执行批次**。任何时刻只有"当前已批准启动的 Loop"+ "下一候选 Loop（待证据触发）"两个状态。

理由：v1 把 #1.1 + #2.1 + #4.1 三个独立骨架捆绑在 Wave A，恰恰是 §0.5 刚立的"防大爆炸"反面。三者风险面不同（schema additive / 新模块 / iOS 兼容高风险），不应该用同一 anchor gate 一次过。

---

## 0. 现状摘要（截止 2026-05-05）

**已 ship**：
- v0.4.0-M1 — Scheduler 骨架 + stage-aware prompts + ContextBundle snapshot
- v0.4.3 — M2 v1 (3.2-A') ContextManager rich-prompt + spec artifact harvest
- v0.4.4 — H14 dispatched 状态加入 stage.status enum（**prod 失败**，rollback）
- v0.4.5 — H14 hot-fix（schema-rebuild mode + prod-shape gate + 双层原则首次自我演进）
- dev 累积（未 release）— G modelHint single source / H runner negative test / F scheduler orphan cleanup

**缺口**（cursor-agent verdict + 用户列的 5 大目标）：见 §3。

---

## 1. M2 5 大目标（用户定义）

| # | 名称 | 一句话 |
|---|---|---|
| **#1** | 任务流水线稳定 | Issue → Scheduler → stage 推进 → ContextBundle → agent → 失败可诊断 → 结果可 review，能反复跑 |
| **#2** | 并行资源不撞 | 1-2 个 agent 并行时不混乱（eva.json + ResourceLock + worktree lifecycle + 端口/DATA_DIR/branch/owned files 结构化）|
| **#3** | 上下文从能用→可靠 | selector 策略 / mustHave-mayHave / budget pruning / artifact lifecycle / fail-loud |
| **#4** | 状态可观察 | queued / dispatched / running:thinking / running:tool_use / running:waiting_permission / completed / failed / cancelled |
| **#5** | 评审进入流程 | review 标准化输入（diff + spec + test + bundle）+ 标准化输出（BLOCKER/MAJOR/MINOR）+ 通过/返工/人审闭环 |

**M2 不做**（用户明确）：完整多 provider runtime / 完整 fs sandbox / 完整自动 PR manager / 完整云 daemon / 完整 App Store 发布 / 10 个 agent 并行。这些是 M3+。

---

## 2. cursor-agent 反向喂的 8 项 MUST-do（聚焦 #1）

来自 [docs/reviews/scheduler-orphan-cleanup-cross-2026-05-05-2228.md](../reviews/scheduler-orphan-cleanup-cross-2026-05-05-2228.md)：

| # | MUST-do | 归属 |
|---|---|---|
| MD1 | 持久化失败原因 + recovery metadata（`failed_reason` 字段 / audit log） | M2 #1 |
| MD2 | retry/resume/skip policy 闭环 + 测试覆盖每条选择路径 | M2 #1 |
| MD3 | 端到端可重复 pipeline 测试（fixture 化的 issue → stage → bundle → agent → result） | M2 #1 |
| MD4 | 跨端 reconcile（重连时拉 stage 列表，不靠 send-once broadcast） | M2 #4（跨 #1 #5 横切）|
| MD5 | backlog/queue 可视化 | M2 #4 |
| MD6 | stale `awaiting_review` 处理（年龄 + 提醒 + 转交 + cancel/skip/approve/reject） | M2 #5（跨 #4） |
| MD7 | stage cancellation（operator-safe 终止 + 持久化 terminal state） | M2 #1（部分 #4）|
| MD8 | boot ordering 显式化（explicit `initialize()` 而非 constructor 副作用） | M2 #1（housekeeping） |

---

## 3. M2 目标 ↔ 螺旋圈映射

每个目标按 §0.5 双层拆分：**骨架圈**（schema/protocol/分层 改动 → 走 ADR/proposal）vs **螺旋圈**（在已锁骨架内的实施）。

### M2 #1 — 任务流水线稳定（最大模块）

| 圈 | 内容 | 骨架/螺旋 | 依赖 |
|---|---|---|---|
| **#1.1** | `failed_reason` + `failed_at` 字段加进 stage 表（schema v102，schema-rebuild migration）；audit log 写入失败 context | 骨架 #1 | — |
| **#1.2** | `cleanupOrphanStages` 写入 `failed_reason='orphan_after_restart'`；其他 catch path 类似（`spawn_setup_failed` / `cli_failed` / `spec_harvest_failed`） | 螺旋（依赖 #1.1）| #1.1 |
| **#1.3** | retry/resume/skip API：`POST /api/harness/stages/:id/retry` (重置为 pending)，`/skip`，`/abandon-issue`；scheduler `computeNextStage` 处理 retry 后的 stage 状态 | 螺旋 + 部分骨架 (新 routes + ReviewVerdict 行为) | #1.1, #1.2 |
| **#1.4** | end-to-end pipeline test：fixture 化 issue → tick → 模拟 spec artifact → tick → 模拟 implement → 验证最终 issue=done。可重复跑 | 螺旋（test infra） | #1.3 |
| **#1.5** | stage cancellation：`POST /api/harness/stages/:id/cancel`（in-flight stage 标 cancelled，spawn 端 SIGTERM CLI）；新增 `cancelled` enum 值 | 骨架 (schema CHECK enum + protocol bump) | #1.1 |
| **#1.6** | boot ordering 显式化：scheduler `initialize()` 由 backend 启动序列调用（而非 constructor 副作用） | 螺旋（refactor） | — |

### M2 #2 — 并行资源不撞

| 圈 | 内容 | 骨架/螺旋 | 依赖 |
|---|---|---|---|
| **#2.1** | ResourceLock 模块：`packages/backend/src/resource-lock.ts` + sqlite 表 `resource_lock(id, resource_type, resource_id, holder, acquired_at, expires_at)` + 文件锁双重防护（§0 #17 早已写明）| 骨架 #6 (worktree/ResourceLock 持久化模型) | — |
| **#2.2** | worktree lifecycle 自动化：H13 hooks 已有 pre-start / post-merge / pre-remove；补 `eva.json` 状态机的 active→done→released 转换 + 实际触发 hooks | 螺旋（在 H12/H13 骨架内） | — |
| **#2.3** | 端口分配规则：active worktree 自动占 :3030+N；DATA_DIR 自动选 `~/.claude-web-track-N`；branch 命名规约 `eva/<issue-id>-<slug>` | 螺旋（auto-assign 函数） | #2.1 |
| **#2.4** | owned files 矩阵 v2：从 WORKTREE_LOCK.md 文档式锁升级到 `eva.json` 字段（H12 已 lay 基础） | 螺旋扩展 | #2.1 |

### M2 #3 — 上下文可靠

| 圈 | 内容 | 骨架/螺旋 | 依赖 |
|---|---|---|---|
| **#3.1** | ContextManager v2 selector 策略：按 stage.kind + agent profile 过滤 artifact（spec / design / test 等 kind 优先级） | 螺旋（context-manager.ts 重构） | — |
| **#3.2** | mustHave / mayHave fail-loud：每个 stage profile 声明所需 artifact kinds；缺 mustHave 直接 fail（已部分有）；mayHave 警告 | 螺旋 + 配置 schema 加字段（fallback-config.json modelist 兼容） | #3.1 |
| **#3.3** | budget pruning：context bundle 总 token < N（profile 配置）；用 size_bytes / token-aware truncation | 螺旋 | #3.1 |
| **#3.4** | artifact lifecycle / GC：`artifact.superseded_by` 链 / 显式 retire；旧 stage 完成后过期 artifact 不进 future bundle | 螺旋 + 可能加 `retired_at` 列 | — |

### M2 #4 — 状态可观察

| 圈 | 内容 | 骨架/螺旋 | 依赖 |
|---|---|---|---|
| **#4.1** | stage.status enum 扩展：加 `cancelled`（M2 #1.5 同步），可能加 `queued`（细分 pending）。涉及 schema-rebuild migration（同 H14 v0.4.5 模式） | 骨架 #1 + #2 | — |
| **#4.2** | running 子状态：`running:thinking` / `running:tool_use` / `running:waiting_permission`。两选一：(a) 加新 enum 值；(b) 在 `task` 表加 `runtime_state` 字段（更灵活） | 骨架 #1（如选 (b)）| — |
| **#4.3** | iOS / Web 三端 reconcile：连上 WS 后调 `GET /api/harness/issues/:id/full` 拉完整 stage list，render 失败 orphan + 子状态 | 螺旋（API + iOS UI） | #4.1, #4.2 |
| **#4.4** | backlog/queue 可视化：`GET /api/harness/dashboard` 返回 queued issues + active stages + stale review + recently failed；iOS 主屏卡片化 | 螺旋（API + UI） | #4.3 |

### M2 #5 — 评审进入流程

| 圈 | 内容 | 骨架/螺旋 | 依赖 |
|---|---|---|---|
| **#5.1** | review stage 真接入 scheduler：实施 stage 完成后自动创建 review stage，调用 cursor-agent / harness-architecture-review skill；ReviewVerdict 落 SQLite | 骨架（review_verdict 表已有，但 scheduler 集成 = 行为骨架） | #1.1 |
| **#5.2** | verdict → decision：BLOCKER → 自动 reject + 创建 retry stage；MAJOR/MINOR → awaiting_review 等人审；MINOR/cleanup → auto-approve 阈值 | 螺旋 | #5.1 |
| **#5.3** | stale `awaiting_review` 处理（MD6）：年龄展示 + 提醒（hourly cron）+ operator UI 控件（cancel/skip/approve/reject） | 螺旋 | #4.3, #5.1 |

---

## 4. Anchor Gate 7 问草答（按 §0.5 #1 加强版）

每个 M2 目标进入螺旋实施前必须答全 7 问。下面是初步答案（可能需细化）。

### M2 #1 anchor gate

| # | 问题 | 草答 |
|---|---|---|
| 1 | 数据模型变更明确 + **prod-shape 验证**？ | 待定：stage 加 `failed_reason TEXT NULL` + `failed_at INTEGER NULL` + (#1.5) `cancelled` enum 值。schema v102 schema-rebuild migration（参考 v101 模板）。**prod-shape 测试必须包含 failed stages + cancelled stages + retry 后 stage** |
| 2 | wire protocol 对齐 + minClientVersion？ | StageDtoSchema 加 `failedReason` `failedAt` 字段；`stage_changed` event payload 加 `failedReason`；HARNESS_PROTOCOL_VERSION 1.1 → 1.2；MIN_CLIENT_VERSION 保持 1.0（老客户端忽略新字段）|
| 3 | iOS/Web/backend 兼容？ | 老 iOS（无 `failedReason` Codable case）会忽略——非 breaking。但 `cancelled` enum 老客户端会 decode 失败 → 必须 bump MIN_CLIENT_VERSION 1.1 同步 iOS 装机 |
| 4 | 不可逆迁移？ | schema v102 forward-only，rollback 路径同 v0.4.5（manual restore from backup） |
| 5 | 权限/凭据/sandbox？ | retry/skip/cancel APIs 需要 `CLAUDE_WEB_TOKEN` auth；cancel 涉及 SIGTERM CLI 子进程（已有路径）|
| 6 | 多 agent/worktree 资源？ | 不直接涉及 — 但 cancel 可能要 release worktree lock（依赖 #2.1 ResourceLock）|
| 7 | rollback/cleanup？ | 同 H14 v0.4.5 路径；cancel 失败要可重试 |

### M2 #2 anchor gate

| # | 问题 | 草答 |
|---|---|---|
| 1 | 数据模型？ | 新表 `resource_lock`（schema v103？或合并 v102）；prod-shape 测试包含 lock 持有 + 释放 + 过期场景 |
| 2 | wire protocol？ | `eva.json` 状态机已有；可能加 `worktree_assignment` event |
| 3 | 兼容？ | 新 lock 表对老客户端透明 |
| 4 | 不可逆？ | 仅加表，schema 改动小 |
| 5 | 权限？ | ResourceLock acquire/release 需要 token；强制 holder 字段防越界释放 |
| 6 | 多 agent 资源？ | **本目标核心** — ResourceLock 即是为此 |
| 7 | rollback？ | lock 表清空可恢复（操作幂等）|

### M2 #3 anchor gate

| # | 问题 | 草答 |
|---|---|---|
| 1 | 数据模型？ | artifact 加 `retired_at INTEGER NULL`；`mustHave/mayHave` 进 fallback-config.json profile 字段（schema 不动）；prod-shape 测试包含 retired artifact |
| 2 | wire protocol？ | ArtifactDtoSchema 加 `retiredAt`；profile schema 加 `mustHaveArtifactKinds` `mayHaveArtifactKinds` |
| 3 | 兼容？ | 老客户端忽略新字段 |
| 4 | 不可逆？ | retired_at 加列，向后兼容 |
| 5 | 权限？ | retire 操作需要 token |
| 6 | 多 agent? | 不直接涉及 |
| 7 | rollback？ | 加列可降级（写 NULL 退化成 v0.4.5 行为） |

### M2 #4 anchor gate

| # | 问题 | 草答 |
|---|---|---|
| 1 | 数据模型？ | stage.status enum 加 `cancelled`（同 #1.5）；task 表加 `runtime_state`（dispatched/thinking/tool_use/waiting_permission）；schema-rebuild migration |
| 2 | wire protocol？ | StageStatusSchema + iOS Swift 同步；HARNESS_PROTOCOL_VERSION 1.2 |
| 3 | 兼容？ | **Breaking** — 老 iOS Codable 不识别 `cancelled` 会 decode fail。MIN_CLIENT_VERSION 1.1 必须 bump，且 iOS 装机端必须升级 |
| 4 | 不可逆？ | 同 H14 模式 |
| 5 | 权限？ | dashboard read-only |
| 6 | 多 agent? | dashboard 显示并行情况（消费 ResourceLock 表）|
| 7 | rollback？ | 同 H14 v0.4.5 模式 |

### M2 #5 anchor gate

| # | 问题 | 草答 |
|---|---|---|
| 1 | 数据模型？ | review_verdict 表已有（M-1 落地）；scheduler review stage 集成是 behavior 改 |
| 2 | wire protocol？ | `review_complete` event 已有 schema |
| 3 | 兼容？ | review 流程对老客户端透明 |
| 4 | 不可逆？ | verdict 持久化是新数据，不影响旧数据 |
| 5 | 权限？ | review skill 调用走现有 cursor-agent shell（`harness-review-workflow` SKILL.md 已定义） |
| 6 | 多 agent? | review 可能并行多 reviewer（cursor-agent + reviewer-cross），需要 ResourceLock 协调（依赖 #2.1）|
| 7 | rollback？ | verdict 不写入主流程关键路径前可降级 |

---

## 5. §0 #21 元工作冻结评估（v2 — loop-scoped 解冻）

当前默认 `HARNESS_EVOLUTION_FROZEN=1`。v1 一次性解冻 v102-v105 + protocol 1.2 + MIN_CLIENT_VERSION + 多个新 routes + ResourceLock 模块 — **过大，违反 §0 #21 启动批分次原则**。

v2 改成 **loop-scoped 解冻**：本 proposal 通过仅授权 Loop 1 启动批，其余 Loop 的解冻随各自启动时单独申请。

### Loop 1 启动批解冻清单（**仅此**）

- **schema v102（additive only）**：
  - `stage` 表加 `failed_reason TEXT NULL` + `failed_at INTEGER NULL`
  - 默认 mode（不需要 schema-rebuild — 加列不动 CHECK enum，不触发 H14 那种 FK 检查）
- **wire protocol additive 字段**：
  - `StageDtoSchema` 加 `failedReason?: string` + `failedAt?: number`
  - `HARNESS_PROTOCOL_VERSION` **暂不 bump**（additive 字段对老客户端透明，老 Zod schema 用 `passthrough` 接受 extra fields）
  - `MIN_CLIENT_VERSION` **保持 1.0**
- **prod-shape migration test**：Loop 1 的 v102 必须在 prod-shape fixture（含 issue + stage + decision）上验证（§0.5 anchor gate #1 加强后的硬要求）
- **iOS Codable**：`Stage` struct 加可选字段（不动 enum）

### **冻结期内仍不允许**（M2 master plan 通过后也不解锁）

- 任何骨架 #1（schema CHECK enum 改动 — 即 schema-rebuild migration）
- 任何骨架 #2（wire protocol breaking 改动 / minClientVersion bump）
- 新模块（ResourceLock / dashboard 等）
- 新基础组件（§0 #11 不可让步）
- 多 provider runtime / fs sandbox（M3+）

### 后续 Loop 的解冻申请

Loop 2 / Loop 3 / Loop 4+ 启动前各自独立提交解冻申请（修订本文档对应段或新 mini proposal），由用户 + cross-review 单独批准。这是 §0 #21 启动批分次的精神。

---

## 6. 依赖关系图

```
                                           ┌────────────────────────────┐
                                           │ M2 #2.1 ResourceLock 模块  │
                                           │   (骨架 schema v103)       │
                                           └────┬───────────────────────┘
                                                │
       ┌────────────────────┬───────────────────┼───────────────────┐
       │                    │                   │                   │
       ▼                    ▼                   ▼                   ▼
┌──────────────┐   ┌─────────────────┐  ┌─────────────┐  ┌──────────────┐
│ M2 #1.1      │   │ M2 #2.2-2.4     │  │ M2 #3.1-3.4 │  │ M2 #5.1      │
│ failed_reason│   │ worktree自动化  │  │ ContextMgr2 │  │ review接入    │
│ (骨架 v102)  │   │ (螺旋)          │  │ (螺旋为主)  │  │ (骨架行为)    │
└──┬───────────┘   └─────────────────┘  └──────┬──────┘  └──────┬───────┘
   │                                            │                │
   ├──────────────┐                             │                │
   ▼              ▼                             ▼                ▼
┌──────────┐  ┌──────────┐                 ┌──────────┐    ┌──────────┐
│ M2 #1.2  │  │ M2 #1.5  │                 │ retry时  │    │ M2 #5.2  │
│ failed   │  │ cancelled│                 │ 复用上下 │    │ verdict→ │
│ context  │  │ (骨架    │                 │ 文       │    │ decision │
│ (螺旋)   │  │  v102)   │                 │ (mustHv) │    │          │
└────┬─────┘  └────┬─────┘                 └──────────┘    └────┬─────┘
     │             │                                             │
     ▼             ▼                                             ▼
┌──────────┐  ┌──────────┐                                 ┌──────────┐
│ M2 #1.3  │  │ M2 #4.1  │                                 │ M2 #5.3  │
│ retry/   │  │ stage    │                                 │ stale    │
│ skip API │  │ status   │                                 │ review   │
│ (螺旋)   │  │ enum 扩展│                                 │ (螺旋)   │
└────┬─────┘  └────┬─────┘                                 └──────────┘
     │             │
     │             ▼
     │       ┌──────────┐
     │       │ M2 #4.2  │
     │       │ runtime  │
     │       │ _state   │
     │       │ (骨架)   │
     │       └────┬─────┘
     │            │
     ▼            ▼
┌──────────────────────┐
│ M2 #4.3 三端 reconcile│←┐
│ (跨 #1 #4 #5 横切)   │ │
└──────────┬───────────┘ │
           │              │
           ▼              │
┌──────────────────────┐  │
│ M2 #4.4 dashboard   │  │
│ (螺旋)              │  │
└──────────────────────┘  │
                          │
┌──────────────────────┐  │
│ M2 #1.6 boot ordering│──┘
│ (螺旋 / refactor)    │
└──────────────────────┘
                                ┌──────────────────────┐
                                │ M2 #1.4 e2e pipeline │
                                │ test (螺旋, gate所有)│
                                │ —— must pass before  │
                                │ "M2 #1 done" claim   │
                                └──────────────────────┘
```

**可并行的根节点**（无前置依赖）：
- M2 #1.1（failed_reason schema） — 骨架先行
- M2 #2.1（ResourceLock） — 骨架独立模块
- M2 #3.1（ContextMgr v2 selector） — 螺旋独立
- M2 #1.6（boot ordering） — 螺旋独立 housekeeping
- M2 #5.1（review stage 集成） — 依赖 #1.1，但本身设计可并行起草

**关键路径**（最长链）：
`#2.1 → #1.1 → #1.5 → #4.1 → #4.2 → #4.3 → #4.4` ≈ 7 圈

**M2 done 判定**：所有 5 大目标的核心圈完成 + #1.4 e2e pipeline test 反复跑通过 + cursor-agent 三角评审 verdict + retrospective。

---

## 7. 推荐执行顺序（v2 — Loop-by-Loop）

**v1 的 5 wave 撤销**。v2 用 Loop-by-Loop approval：每个 Loop 完成后用 retrospective 触发下一 Loop 的批准决策；不预设"5 wave 一次性走通"。

### 已批准启动的 Loop

仅 **Loop 1**（待本 proposal 通过 + cross-review）：

| Loop | 风险陈述 | 最小切片 | 依赖 |
|---|---|---|---|
| **Loop 1** | "M2 #1 失败可诊断 — 当前 stage 失败仅 console.log，无法从持久化 state 区分 orphan / spawn fail / harvest fail / CLI fail" | schema v102 additive: `stage.failed_reason TEXT NULL` + `stage.failed_at INTEGER NULL`；Zod / Swift / fixture 加可选字段；prod-shape migration test | — |

### 候选 Loop（**hold，待 Loop 1 retrospective 后重新评估**）

| Loop | 内容 | 触发条件 |
|---|---|---|
| **Loop 2** | failed_reason 写入路径：cleanupOrphanStages → `'orphan_after_restart'`；scheduler catch handler → `'spawn_setup_failed'` / `'cli_failed'`；harvestSpecArtifact catch → `'spec_harvest_failed'` | Loop 1 retrospective 确认 schema 落地稳定 + dogfood 验证 prod 上加列无副作用 |
| **Loop 3** | minimal skip API：`POST /api/harness/stages/:id/skip`（**仅** `failed → skipped` 单向转换 + 触发下次 tick 推进）。**不**做 retry / resume / auto-retry / reset pending / attempt count / parentTaskId | Loop 2 retrospective 确认 failed_reason 实际能区分失败类型 |
| **Loop 4+** | **不预设**。等 Loop 1-3 retrospective 累积证据再决定下一圈。可能候选：ResourceLock / cancelled enum / ContextMgr v2 selector / e2e pipeline test / ... | 由 Loop 3 retrospective + 当时 prod 状态 + 剩余风险排序决定 |

**Loop 3 与原 plan #1.3 (full retry/skip policy in Wave C) 切开**：

- Loop 3 = unblock operator（minimal skip）
- 完整 retry policy（自动重试、reset pending、attempt count、parent-task tracking）属于后续未预设的 Loop，scope 不在 Loop 3 里

### Loop 之间的 anchor gate 调用

每个 Loop 启动前**独立**过 §0.5 anchor gate 7 问。Loop 1 草答见 §4 M2 #1 anchor gate（仅适用其中"加 failed_reason / failed_at"部分，不覆盖 cancelled enum / retry API 等）。Loop 2 / Loop 3 启动时各自补 anchor gate 草答。

### 不再有"M2 总进度估算"

v1 写"5 wave × 3-4 圈 = 17 圈"是机械估算。v2 不再估总数。每个 Loop 1-3 天，但**之后多少 Loop 取决于实证信号**——可能 Loop 3 之后 dogfood 显示 retry policy 实际可推迟到 M3，那 M2 #1 在 Loop 3 即可宣告"足够稳"。

---

## 8. Open Questions（pending 用户决策）

| OQ | 问题 | 推荐 |
|---|---|---|
| OQ-A | running 子状态用 `task.runtime_state` 列还是 `stage.status` 加 enum 值？ | **task.runtime_state**（更灵活，runtime 状态本就是 task 级而非 stage 级；stage 状态机保持稳定） |
| OQ-B | iOS 兼容性 — bump MIN_CLIENT_VERSION 1.0 → 1.1 强制升级，还是延后？ | **延后到 #4.1**（cancelled enum 真要 ship 时）；之前所有改动都向后兼容 |
| OQ-C | review skill 怎么"嵌进流水线" — 仍走外部 shell `cursor-agent`？还是接入 review-orchestrator API？ | **M2 仍走 shell**；orchestrator 是 M3 |
| OQ-D | M2 的"e2e pipeline test"是否调真 Claude CLI？ | **不调** — fixture 化模拟 agent output（避免每次 test 烧 token）；prod dogfood 单独走 |
| OQ-E | M2 期间 prod release 节奏？ | **每个 Loop 结束做 ship/drop/defer decision**：触碰 prod runtime / schema / protocol 的 Loop 倾向 release（不机械规定）；纯文档 / 测试 / 内部 refactor 可合 dev 后批量 release。decision 写进 retrospective。 |
| OQ-F | anchor gate 是 Loop 级还是单圈级？ | **每 Loop 独立 anchor gate**。**+ 偷渡防护**：如果 Loop 内触碰未授权骨架项（不在该 Loop 启动批解冻清单里），必须暂停并重新过 gate；不允许 Loop 内偷加骨架变更 |
| OQ-G（v2 新增）| Loop 3 限定为 minimal skip API（不含 retry / resume / auto-retry / reset pending / attempt count），完整 retry policy 留后续 Loop？ | **是**。Loop 3 仅做 unblock operator 最薄能力（`failed → skipped` 单向 + 触发 tick）；retry policy 易膨胀，不能挤进同 Loop |
| OQ-H（v2 新增）| 正式弃用 "wave" 术语，统一改 "Loop"？ | **是**。"wave" 暗示 batch；"Loop" 与 §0.5 螺旋一圈语义一致。本文档已改；后续 retrospective / commit / PR 描述均用 Loop |

---

## 9. Roadmap.md 整合建议（v2）

合并后修订 [HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md) §6 里程碑表 — **不预设 Loop 总数**：

```
| 6.M2 | M2: 任务流水线 + 并行资源 + 上下文可靠 + 状态可观察 + 评审进流程 | 待办 — loop-by-loop approval（不预设总 Loop 数）|
| 6.M2.L1 | Loop 1: failed_reason + failed_at（schema v102 additive）| 候选启动（pending proposal v2 通过）|
| 6.M2.L2 | Loop 2: failed_reason 写入路径（cleanup / spawn / harvest）| hold — 待 Loop 1 retrospective |
| 6.M2.L3 | Loop 3: minimal skip API（failed → skipped 单向）| hold — 待 Loop 2 retrospective |
| 6.M2.L4+ | 后续 Loop | 不预设。Loop 3 retrospective 后基于实证排序 |
```

原 §3 圈映射表（17 圈 / 5 大目标）保留为**全景地图**——参考用，不当批次。

---

## 10. 评审与解冻请求（v2）

本 proposal v2 提交后请求：

1. **用户审 v2**：是否同意
   - 总则（M2 改 loop-by-loop approval）
   - §5 解冻列表缩成 Loop 1 only
   - §7 Loop 1/2/3 + Loop 4+ hold
   - OQ-A~F 答案 + 新增 OQ-G/OQ-H 答案

2. **cursor-agent cross-review** on plan v2（model: gpt-5.5-medium）：
   - Lens 重点：
     - scope 收缩后是否仍自洽（5 大目标 + 8 项 MUST-do 仍有覆盖路径，但延后到对应 Loop）
     - Loop 1 启动批解冻清单是否真"additive only"（再 catch 一次 v0.4.4 那种"以为 additive 实际触发 schema-rebuild"的盲点）
     - Loop 2 / Loop 3 的依赖关系是否会形成新的隐式 batch
     - OQ-G（minimal skip 边界）+ OQ-H（loop 重命名）是否完整执行
   - 输出 verdict 到 `docs/reviews/m2-master-plan-v2-cross-<ts>.md`

3. **解冻批准**：通过后只解冻 Loop 1 启动批；Loop 2 / Loop 3 / Loop 4+ 启动时各自单独申请

4. **HARNESS_ROADMAP.md §6 同步修订**：按 §9 表格写入

5. **后续 Loop 工作流模板**：每个 Loop 启动时 issue / PR 描述均含：
   - "本 Loop 风险陈述（一句话）"
   - "本 Loop anchor gate 7 问草答"（针对该 Loop 的 scope，不复制全 M2 master plan）
   - "本 Loop 启动批解冻清单"（限定该 Loop 用到的）
   - 完成后 retrospective + ship/drop/defer decision

---

## Appendix A — H14 / G / H / F 已 ship 与本 plan 对齐

| 已 ship | M2 哪一项 | 备注 |
|---|---|---|
| H14 dispatched 状态（v0.4.5） | M2 #4 子项（部分） | dispatched 是 running 子状态化的第一步；后续 M2 #4.1/4.2 扩展 |
| G modelHint single source（PR #26） | 横切 housekeeping | 不在 M2 5 目标里，但防 future drift |
| H runner negative test（PR #27） | M2 #1 基础设施（部分） | migration runner 健壮性是 #1.1 的前提 |
| F orphan cleanup（PR #28） | M2 #1.2 雏形 | 当前仅清理 orphan，cursor-agent 标记仅占 #1 ~20% |

