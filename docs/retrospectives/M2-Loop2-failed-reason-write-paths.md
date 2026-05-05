# M2 Loop 2 — failed_reason write paths in scheduler catch

**Date**: 2026-05-06（接 2026-05-05 Loop 1）
**Phase**: M2 Loop 2（second loop under M2 master plan v2 loop-by-loop approval）
**Risk addressed this loop**: "把 failed_reason 写入 cleanup / spawn setup / CLI fail / spec harvest 路径，让失败可从持久化 state 区分（不只是 console.log）"
**Exit**: **ship**
**Related PRs**:
- #30 Loop 1 — failed_reason + failed_at additive schema (v102)
- #29 M2 master plan v2 (proposal)
**Related artifacts**:
- `packages/backend/src/harness-queries.ts` — `setStageFailed` helper
- `packages/backend/src/scheduler.ts` — 5 catch paths wired
- `packages/backend/src/test-scheduler-failed-reasons.ts` (new) — Loop 3 gate test
- `packages/backend/src/test-harness-schema.ts` — Phase 6 helper invariants
- `packages/backend/src/test-scheduler-orphan-cleanup.ts` — extended with reason assertions
- `docs/reviews/m2-loop2-failed-reason-write-cross-2026-05-05-2351.md`

---

## 一句话本圈风险

让 H14 + Loop 1 准备好的 failed_reason 字段**真正被 scheduler 写入**，且**4 个 canonical reason 能在 DB 区分**。Loop 1 加列、Loop 2 写入、Loop 3 才能基于 reason 决策（minimal skip）。

## 6 步循环执行

### 1. 风险陈述

Loop 1 ship 后 stage 表有 failed_reason 列但全部 NULL。scheduler 失败路径仍只调 setStageStatus("failed")。下一圈（Loop 3 minimal skip）需要 operator 能从 DB 读到 reason 决定是否 skip — 没 reason 写入就没意义。

### 2. 最小可运行切片

- **新增**：`setStageFailed(db, stageId, reason, failedAt?)` helper 在 harness-queries.ts。Idempotent guard（first-write wins）下沉到单 SQL（cross m1 应用）：
  ```sql
  UPDATE stage SET status='failed', failed_reason=?, failed_at=?, ended_at=COALESCE(ended_at,?)
  WHERE id=? AND NOT (status='failed' AND failed_reason IS NOT NULL)
  ```
  跨进程也原子。

- **scheduler.ts 5 个 catch path 全切到 setStageFailed**：
  | 路径 | reason |
  |---|---|
  | `cleanupOrphanStages` 内 transaction | `'orphan_after_restart'` |
  | `spawnAgent` Phase A catch（bundle/createTask）| `'spawn_setup_failed'` |
  | `spawnAgent` Phase B catch（runSession CLI）| `'cli_failed'` |
  | `spawnAgent` Phase C catch（harvestSpecArtifact）| `'spec_harvest_failed'` |
  | `tick().catch` 外层兜底 | `'unknown_error'`（idempotent guard 防覆盖） |

  spawnAgent 拆三个 try/catch 段：bundle → setStageStatus(running) → CLI → harvest。bundle 在 Phase A 前 `let` 声明，Phase A 失败必然 throw，Phase B 用到时 TS strict null check 路径已确定可达。

### 3. 机器验证

- **`pnpm --filter @claude-web/shared test`** → 123/123 全绿（无 protocol 改动，全靠 Loop 1 字段）
- **`pnpm --filter @claude-web/backend test:harness-schema`** → Phase 1+2+3+4+5+6 全绿
  - Phase 6（new）— 9 项 setStageFailed 不变量：写入 + 默认 ended_at + idempotent guard 拒覆盖 + 多 stage 独立 reason
- **`pnpm --filter @claude-web/backend test:scheduler-cleanup`** → 9 项断言全绿（含新 Loop 2 reason='orphan_after_restart' + failed_at 验证）
- **`pnpm --filter @claude-web/backend test:scheduler-failed-reasons`** (NEW) → 16 项断言全绿
  - 3 fresh stage 各自落入 `spawn_setup_failed` / `cli_failed` / `spec_harvest_failed`
  - 4 reason 分布完全独立（distribution 检查）
  - idempotent guard 拒 `unknown_error` 覆盖（3 项）
  - fresh stage CAN 接受 `unknown_error` 作为首次 reason（fallback works）
- **`pnpm -r exec tsc --noEmit`** → clean

### 4. 真实 dogfood

5 个独立场景在 ad-hoc 临时 DB 上跑通：
1. ✓ Backend restart cleanup 写 `orphan_after_restart`（2 stages）
2. ✓ 第二次 restart 不覆盖（idempotent across instances）
3. ✓ `setStageFailed('spawn_setup_failed')` 写入 + ended_at 自动设置
4. ✓ `unknown_error` 不覆盖既有 `spawn_setup_failed`
5. ✓ audit log 写入无错（`set_failed` 事件）

### 5. cross-review

`docs/reviews/m2-loop2-failed-reason-write-cross-2026-05-05-2351.md` — cursor-agent gpt-5.5-medium：

- **0 BLOCKER + 0 MAJOR + 4 MINOR**，overall **4.6/5**
- **Charter compliance held**：
  - 无 schema 变更（Loop 1 已加好列，Loop 2 只写）
  - 无新 routes/API（Loop 3 任务）
  - 无 retry/cancellation 逻辑
  - HARNESS_PROTOCOL_VERSION 仍 1.1
  - StageDtoSchema 无 `.strict()` 泄漏

- **关键发现**：cursor-agent 显式判定 **"Loop 3 still NOT ready"** — 因为 plan v2 §7 启动条件是 "retrospective confirms failed_reason can actually distinguish failure types"，cleanup + helper 测试不足以证明三段 runtime catch 真区分。**这条判定推动了 m3 应用**：补 `test-scheduler-failed-reasons.ts` 完整覆盖 4 个 canonical reason 分布。

- **finding 处理**：
  - m1 (跨连接原子 guard) ✅ 应用：guard 下沉到单 SQL，跨进程也原子
  - m2 (Phase A/B 之间 unknown_error fallback) — acknowledged as design choice，注释已说明
  - m3 (覆盖三段 runtime catch — Loop 3 gate)** ✅ 应用**：新增 `test-scheduler-failed-reasons.ts` 16 项断言，证明 4 reason 分布独立 + idempotent guard
  - m4 (audit best-effort 与 transaction 不完全一致) — acknowledged，跨 Loop 改进项

### 6. retrospective + ship/drop/defer

**Exit**: **ship**

## Loop 3 启动条件（plan v2 §7）评估

> Loop 2 retrospective 确认 failed_reason 实际能区分失败类型 → 才启动 minimal skip API

**已满足**：
- ✅ 4 个 canonical reason 在 DB 落地：`orphan_after_restart` / `spawn_setup_failed` / `cli_failed` / `spec_harvest_failed`
- ✅ 5 个 catch path 全切到 setStageFailed，外层 `unknown_error` 兜底
- ✅ `test-scheduler-failed-reasons.ts` 16 项机器验证 distribution 互不干扰
- ✅ Idempotent guard（cross-review 抓的 m1 已应用）让多次 catch 不会互相 stomping
- ✅ Cross-review 确认 charter compliance held

**Loop 3 charter 候选**（待用户启动批批准）：
- `POST /api/harness/stages/:id/skip` — failed → skipped 单向，触发下次 tick
- 必须走现有 `CLAUDE_WEB_TOKEN` bearer auth（cross m3 from plan v2）
- **不**做：retry / resume / auto-retry / reset pending / attempt count / parentTaskId（plan v2 OQ-G 显式排除）
- **不**改 schema（status enum 已有 `skipped`，无需扩展）
- **不**动 protocol

## 学到的（Trans-context lessons）

### Lesson A — Loop 3 trigger 不是文档承诺，是机器证据

cursor-agent 显式判定 "Loop 3 still NOT ready" 因为没有覆盖三段 runtime catch 的测试。我之前以为"实施 + dogfood + cross-review 4.6/5 就 done"——但 plan v2 §7 写"retrospective confirms can actually distinguish"，这个 confirmation 必须有机器证据，不是 retrospective 自说自话。

**应用**：以后每个 Loop 完成时，先问"下一 Loop 的启动条件具体什么？什么算 actually confirmed？"——把启动条件转换成"如果 X 测试不存在，下一 Loop 不能启动"。

### Lesson B — Idempotent guard 应放 SQL 不放代码

cross m1 抓的核心：原版 SELECT-then-UPDATE 在跨连接场景不原子。修后单条 SQL 用 `WHERE NOT (...)` 让 SQLite 帮你做条件原子化。**记入 reviewer-cross/LEARNINGS.md（待补）**：guard 类逻辑首选放 WHERE 子句而不是应用层判断。

### Lesson C — spawnAgent 三段拆开是对的

Loop 2 把原本一个 spawnAgent 函数拆成 Phase A/B/C 三段独立 try/catch。看似多了 boilerplate，但每段的失败语义清晰：
- Phase A 失败 → setup 出问题，scheduler 自身 bug 概率高
- Phase B 失败 → CLI 子进程问题，外部环境概率高
- Phase C 失败 → spec 文件不规范，agent 输出问题

未来 Loop（dashboard / retry policy / agent profile 调优）可以基于这三类做不同决策。

## Follow-up（不阻塞 Loop 2 ship）

- **m2 follow-up**：Phase A/B 之间的 runtime transition（modelIdForHint + setStageStatus(running) + broadcast）现在落 `unknown_error`。可在后续 Loop 把这段也包进 try/catch 标 `runtime_transition_failed`。低优先级
- **m4 follow-up**：audit log 在 transaction 内 fire-and-forget；如要强一致 audit-with-tx，需要 audit infrastructure 升级（跨 Loop 任务）
- **canonical reason enum**：现在 reason 是自由文本。Loop 3 dashboard / 查询前可加一个 const tuple 集中常量（plan v2 §3 #1.2 提及）
- **LEARNINGS.md 更新**：写 Lesson A / B 进 `.claude/skills/reviewer-cross/LEARNINGS.md`
