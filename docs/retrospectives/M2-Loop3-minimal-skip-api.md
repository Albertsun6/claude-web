# M2 Loop 3 — minimal skip API (POST /api/harness/stages/:id/skip)

**Date**: 2026-05-06
**Phase**: M2 Loop 3（third loop under M2 master plan v2 loop-by-loop approval）
**Risk addressed this loop**: "operator unblock failed stage — 把 failed stage 标 skipped，让 scheduler 下次 tick 能 advance"
**Exit**: **ship**
**Related PRs**:
- #30 Loop 1 — additive schema (failed_reason / failed_at)
- #31 Loop 2 — write paths in scheduler catch
- #29 M2 master plan v2 (proposal — defines OQ-G charter for Loop 3)
**Related artifacts**:
- `packages/backend/src/harness-queries.ts` — `skipFailedStage` helper
- `packages/backend/src/routes/harness.ts` — `POST /stages/:id/skip`
- `packages/backend/src/test-harness-schema.ts` — Phase 7（14 invariants + 9 charter locks = 23）
- `docs/reviews/m2-loop3-minimal-skip-cross-2026-05-06-0008.md`

---

## 一句话本圈风险

让 operator 能用 HTTP POST 一键把 failed stage 标 skipped，scheduler 下次 tick 看到的不再是 blocked。**严格不做** retry / resume / auto-retry / reset pending / attempt count / parentTaskId / 自动 tick — 完整 retry policy 留 Loop 4+ 重新 gate。

## 6 步循环执行

### 1. 风险陈述

Loop 2 ship 后失败被持久化（4 个 canonical reason），但 operator 仍没 API 让 failed stage 解锁——只能 manual SQL 改状态。这违反"operator-friendly"原则，也让 dogfood 流程依赖 SQL 操作。

### 2. 最小可运行切片

**helper** (`harness-queries.ts`):
```ts
skipFailedStage(db, stageId): { ok, alreadySkipped? } | { ok: false, error }
```
4 个返回路径：ok（failed→skipped）/ alreadySkipped（idempotent noop）/ invalid_state（其他状态）/ not_found。

**route** (`routes/harness.ts`):
```
POST /api/harness/stages/:id/skip
  → 200 { ok: true, alreadySkipped: false }       — 首次成功
  → 200 { ok: true, alreadySkipped: true }        — 已 skipped
  → 404 { ok: false, error: "stage not found" }   — 不存在
  → 409 { ok: false, error, currentStatus }       — 非 failed
```

Auth: 全局 `app.use("/api/*", authMiddleware)` 自动覆盖（**cross m3 from plan v2 满足**——无单独 auth 代码、无绕过）。

**严格不做**（charter compliance held）：
- 不调 `scheduler.tick()`（operator 须显式 POST /scheduler/tick）
- 不允许任何非 `failed → skipped` 转换
- 不写 retry / attempt_count / parent_task_id / reset_pending
- 不动 schema / protocol / minClientVersion

### 3. 机器验证

- **`pnpm --filter @claude-web/shared test`** → 123/123
- **`pnpm --filter @claude-web/backend test:harness-schema`** → Phase 1+2+3+4+5+6+7 全绿
  - **Phase 7（new）— 23 项 Loop 3 验证**：
    - 14 项 skipFailedStage 不变量（含全部 8 个 stage.status enum 值的 skip 行为，cross m1 应用）
    - 9 项 charter 静态机械锁（grep 实现层 forbidden patterns：scheduler.tick / .retry / reset_pending / attempt_count / parentTaskId / setStageStatus pending|running，全应不出现）+ sanity check skipFailedStage 真被 route 调用
- **`pnpm -r exec tsc --noEmit`** → clean

### 4. 真实 dogfood

启动隔离 dev backend `:3032` + DATA_DIR=`~/.claude-web-loop3`，seed failed stage + pending stage。4 个 e2e 场景：

| 场景 | 结果 |
|---|---|
| `POST /skip` 真 failed stage | ✅ 200 `{ok:true, alreadySkipped:false}` + DB status='skipped' + failed_reason='cli_failed' 保留 |
| 同 stage 第二次 `POST /skip` | ✅ 200 `{ok:true, alreadySkipped:true}`（idempotent）|
| `POST /skip` 一个 pending stage | ✅ 409 `{ok:false, error:"...status='pending'..."}` |
| `POST /skip` 不存在的 stage | ✅ 404 `{ok:false, error:"stage not found"}` |

**关键观察**：skip 后 `failed_reason='cli_failed'` 仍保留——诊断信息在状态转换中不丢失。这是 Loop 2 写入 + Loop 3 跳过 的设计承诺。

### 5. cross-review

`docs/reviews/m2-loop3-minimal-skip-cross-2026-05-06-0008.md` — cursor-agent gpt-5.5-medium：

- **0 BLOCKER + 0 MAJOR + 4 MINOR**，overall **4.64/5**
- **Charter compliance held（6 项独立 verification）**：
  1. ✅ 无 retry/resume/auto-retry/reset-pending/attempt-count/parentTaskId 偷渡
  2. ✅ 无自动 tick（scheduler.tick 仅在 /scheduler/tick route 内）
  3. ✅ 仅 failed → skipped 单向转换
  4. ✅ 无 schema / migration / protocol bump
  5. ✅ Auth 走全局 middleware，无 bypass
  6. ⚠️ "范围纪律视觉合格但缺机械锁" → m2 应用

- **finding 处理**：
  - m1（Phase 7 缺 dispatched/rejected）✅ 应用：现在覆盖**全部** 8 个 stage.status enum
  - m2（charter 静态机械锁）✅ 应用：9 个 forbidden pattern 静态扫
  - m3（SELECT-then-UPDATE 并发非 audit-幂等）— acknowledged：单 Node 进程下不实际触发；m2 静态锁防 future 引入并发问题
  - m4（双 audit set_status + skip）— 设计选择 acknowledged：保留双 audit（一条通用状态变化 + 一条 operator action）。如果未来 dashboard 仅按 action='skip' 统计 operator 行为，无需修改

### 6. retrospective + ship/drop/defer

**Exit**: **ship**

**M2 #1 Pipeline Stability Coverage**（cursor-agent 评估）：
- F 圈（PR #28）orphan cleanup 把覆盖率从 0% 推到 ~20%
- **Loop 1+2+3 累计推到 ~40-45%**
- 已覆盖：MD1（持久化失败原因 + recovery metadata）+ MD2 部分（minimal skip）
- 未覆盖：MD2 完整 retry policy / MD3 e2e reproducible pipeline test / MD7 stage cancellation / MD8 explicit boot ordering
- **可诚实 claim**：失败可诊断 + operator 可 unblock pipeline + 显式 tick 推进
- **不能 claim**：M2 #1 任务流水线稳定已完成

## Loop 4+ 候选 scope

按 plan v2 §7 + cursor-agent verdict M2 #1 coverage assessment，建议优先级（待用户单独 anchor gate 评估）：

1. **完整 retry policy**（MD2 剩余）— 在 Loop 1-3 基础上增加 retry：reset failed → pending + 加 attempt_count + 加 parent_task_id schema。涉及 schema 变更 = 骨架层
2. **e2e reproducible pipeline test**（MD3）— fixture 化 issue → stage → bundle → agent → result，可重复跑（不只 dogfood 一次）。纯测试基础设施 = 螺旋层
3. **stage cancellation**（MD7）— `POST /stages/:id/cancel`（in-flight stage SIGTERM CLI + 标 cancelled）。涉及 stage.status enum 加 'cancelled' = 骨架层 + iOS 兼容（v0.4.4 教训）
4. **explicit boot ordering**（MD8）— 把 EvaScheduler constructor 副作用改成 explicit `initialize()`。纯 refactor = 螺旋层

我推荐 **#2 e2e test** 作为下一 Loop——理由：
- 螺旋层（无骨架触碰）
- 是 plan v2 §7 多次提到的 stability gate
- 可独立验收，不依赖其他 Loop
- 完成后能为 #1/#3/#4 任一 Loop 提供更可信的 dogfood 基础

但用户可能基于直觉给不同优先级（如 stage cancellation 是 dogfood 急用），等用户拍板。

## 学到的（Trans-context lessons）

### Lesson A — Charter mechanical lock 是螺旋上升的护栏

Loop 1 引入 charter mechanical lock（Phase 5 grep 0003 SQL 内容）；Loop 3 cross m2 直接复用模式（grep skip route + helper 内容）。这成为可重用的 Loop pattern：**每个螺旋圈完成时给自己的 charter 加机器锁，防止后续 Loop 偷渡 forbidden 行为**。

未来 Loop 4+ 启动时直接复用这个 pattern：在 retrospective 写完时**为本 Loop 的 forbidden pattern 加 grep assert**，作为下一个 Loop 的 regression test。

**记入 reviewer-cross/LEARNINGS.md（待补）**：跨 Loop 的 charter 不变量必须机器化。

### Lesson B — failed_reason 保留贯穿状态转换是设计承诺

skip 操作只改 status，**不**清空 failed_reason。这让"为什么之前失败"这条信息**贯穿**状态转换（failed → skipped → 未来或许 pending → ...）。诊断信息不在转换中丢失。Phase 7 第 9 项 assert 显式 lock 这个承诺。

### Lesson C — Loop-by-loop 让覆盖率评估变成连续过程

cursor-agent 给 Loop 3 的 M2 #1 coverage 估算 40-45%（vs F 当时的 20%），不是因为代码量翻倍，而是因为 charter 紧密 + 每圈机器证据累积让"覆盖了什么 / 没覆盖什么"变得可量化。这反证了 plan v2 loop-by-loop 比 wave batch 更"可观察进度"。

## Follow-up（不阻塞 Loop 3 ship）

- **m3 follow-up**：如果未来真做并发 skip（如 dashboard 自动批量 skip），把 audit dedup 也下沉到 SQL（同 Loop 2 cross m1 模式）
- **m4 follow-up**：dashboard / metrics 启动时显式记录"operator skip 统计基于 audit action='skip' 不是 set_status"
- **LEARNINGS.md 更新**：写 Lesson A / B / C 进 `.claude/skills/reviewer-cross/LEARNINGS.md`
- **Loop 4 选题**：等用户拍板（推荐 #2 e2e test）
