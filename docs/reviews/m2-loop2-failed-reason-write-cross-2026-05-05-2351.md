# Cross Review — M2 Loop 2 failed_reason write paths

**Reviewer**: reviewer-cross  
**Model**: GPT-5.5  
**Date**: 2026-05-05 23:51  
**Files reviewed**:
- `packages/backend/src/harness-queries.ts`
- `packages/backend/src/scheduler.ts`
- `packages/backend/src/test-scheduler-orphan-cleanup.ts`
- `packages/backend/src/test-harness-schema.ts`
- `packages/backend/src/migrations/0001_initial.sql`
- `packages/backend/src/migrations/0002_stage_status_dispatched.sql`
- `packages/backend/src/migrations/0003_stage_failed_reason.sql`
- `packages/shared/src/harness-protocol.ts`
- `packages/backend/src/routes/harness.ts`

---

## Summary

- Blockers: 0
- Majors: 0
- Minors: 4
- 总体判断：建议合并 Loop 2；但 Loop 3 启动前必须补 Loop 2 retrospective，并最好补一条能证明三类 runtime catch path 真能写出不同 reason 的验证。

## Numeric Score

| Lens | Score (0..5) |
|---|---:|
| 正确性 | 4.2 |
| 跨端对齐 | 4.8 |
| 不可逆 | 4.7 |
| 安全 | 4.6 |
| 简化 | 4.5 |

**Overall score**: 4.6

## Loop 2 Charter Compliance

1. **没有 schema 变更滑入 Loop 2**。本次 runtime 写入依赖 Loop 1 的 `0003_stage_failed_reason.sql`，该 migration 仍只是两条 nullable additive column：`failed_reason TEXT` / `failed_at INTEGER`，见 `packages/backend/src/migrations/0003_stage_failed_reason.sql:25-26`。没有看到新的 migration 文件。

2. **没有新 routes / API endpoint**。`routes/harness.ts` 仍是既有 scheduler / initiatives / issues / stages / decisions 路由集合；stage mutation 仍只有 `PUT /stages/:id/status`，见 `packages/backend/src/routes/harness.ts:120-140`。没有新增 Loop 3 的 skip API。

3. **没有 retry / resume / auto-retry / cancellation 逻辑**。失败 stage 仍在 `computeNextStage` 里 block，提示人工把 failed stage 标 skipped 后再 tick；代码注释也明确 retry policy 留 M2 后续，见 `packages/backend/src/scheduler.ts:227-232` 和 `packages/backend/src/scheduler.ts:155-158`。

4. **没有协议版本或最低客户端版本 bump**。`HARNESS_PROTOCOL_VERSION` 仍是 `"1.1"`，`MIN_CLIENT_VERSION` 仍是 `"1.0"`，见 `packages/shared/src/harness-protocol.ts:42-48`。

5. **没有给 StageDtoSchema 加 `.strict()`**。`StageDtoSchema` 保持 Zod 默认 non-strict object，并且注释继续锁定 old-client unknown-key 兼容语义，见 `packages/shared/src/harness-protocol.ts:192-213`。全仓搜索只看到既有 `eva-config.ts` 使用 `.strict()`，没有在 harness Stage DTO 上新增。

6. **Loop 2 指定写入路径基本覆盖**。`cleanupOrphanStages` 写 `orphan_after_restart`，见 `packages/backend/src/scheduler.ts:94-102`；Phase A catch 写 `spawn_setup_failed`，见 `packages/backend/src/scheduler.ts:291-314`；Phase B `runSession` catch 写 `cli_failed`，见 `packages/backend/src/scheduler.ts:326-347`；Phase C strategy-only harvest catch 写 `spec_harvest_failed`，见 `packages/backend/src/scheduler.ts:349-361`。外层 tick catch 只做 `unknown_error` fallback，见 `packages/backend/src/scheduler.ts:210-221`。

## Findings

### m1 [MINOR] `setStageFailed` 的 first-write guard 不是跨连接原子

**Where**: `packages/backend/src/harness-queries.ts:282-297`  
**Lens**: 正确性  
**Issue**: guard 先 `SELECT status, failed_reason`，再无条件 `UPDATE stage SET status='failed', failed_reason=?...`。单 Node 进程里 `better-sqlite3` 同步执行，所以当前 scheduler 内部基本不会并发穿透；但两个 backend 进程 / 两个 DB connection 同时调用时，两个调用都可能先读到 `failed_reason IS NULL`，后提交者覆盖先提交者。  
**Why this is minor**: 当前代码注释和 scheduler boot ordering 都按单 backend / 单 scheduler 假设运行；这不是 Loop 2 的 blocker。但函数注释已经承诺“首次写赢”，实现最好不要把这个承诺建立在进程模型上。  
**Suggested fix**: 把 guard 下沉到单条 SQL：`UPDATE stage SET ... WHERE id = ? AND NOT (status = 'failed' AND failed_reason IS NOT NULL)`。这样旧路径产生的 `status='failed' AND failed_reason IS NULL` 仍可被补写，同时跨连接也更接近 first-write wins。

### m2 [MINOR] Phase A/B 之间的 runtime 准备失败会落成 `unknown_error`

**Where**: `packages/backend/src/scheduler.ts:316-324`, `packages/backend/src/scheduler.ts:210-216`  
**Lens**: 正确性 / 简化  
**Issue**: `modelIdForHint(model)`、`setStageStatus(..., "running")` 和 running broadcast 位于 Phase A catch 与 Phase B catch 之间。这里如果抛错，不会写 `spawn_setup_failed` 或 `cli_failed`，而是冒泡到外层 tick catch，最终写 `unknown_error`。  
**Why this is minor**: `model` 已被归一化为 `"opus" | "sonnet" | "haiku"`，所以 `modelIdForHint` 理论上很难抛；`setStageStatus` / broadcast 抛错也更像 orchestration/runtime transition failure，不是 CLI failure。当前 fallback 能保证 stage 不会卡住。  
**Suggested fix**: Loop 2 可以接受现状；若要进一步收紧诊断语义，把 `modelIdForHint` + running transition 放进一个小 try/catch，并明确它属于 `spawn_setup_failed` 还是保留 `unknown_error`。

### m3 [MINOR] 测试覆盖了 helper 和 orphan cleanup，但没有覆盖三段 runtime catch 的 reason 区分

**Where**: `packages/backend/src/test-scheduler-orphan-cleanup.ts:73-88`, `packages/backend/src/test-harness-schema.ts:735-771`, `packages/backend/src/scheduler.ts:311-359`  
**Lens**: 正确性  
**Issue**: 新测试确认 orphan cleanup 写 `orphan_after_restart`，也确认 `setStageFailed` 首写后不被 `unknown_error` 覆盖。但没有机器验证 Phase A `spawn_setup_failed`、Phase B `cli_failed`、Phase C `spec_harvest_failed` 三条 runtime catch path。  
**Why this is minor**: 静态读代码能看到三条 catch 已写入指定 reason，Loop 2 本身可以合并。但 Loop 3 的启动条件是“retrospective confirms failed_reason can actually distinguish failure types”，仅靠当前两条测试还不能证明“actually distinguish”覆盖了所有 charter reason。  
**Suggested fix**: Loop 3 前补一个 scheduler 单测或 dogfood 记录：stub/mock `buildContextBundle`、`runSession`、`harvestSpecArtifact` 任一失败，断言 DB 中分别落入三个 canonical reason。

### m4 [MINOR] cleanup transaction 内的 audit 可能先于 transaction 成败写出

**Where**: `packages/backend/src/scheduler.ts:94-102`, `packages/backend/src/harness-queries.ts:17-20`, `packages/backend/src/harness-queries.ts:299-301`  
**Lens**: 安全 / 运维风险  
**Issue**: `cleanupOrphanStages` 把多个 `setStageFailed` 包在 DB transaction 里，但 `setStageFailed` 内部会立即 fire-and-forget `audit("set_failed", ...)`。如果 transaction 中后续某一行失败并回滚，audit JSONL 仍可能已经记录了部分 `set_failed`。  
**Why this is minor**: audit 设计本来就是 best-effort，不阻塞业务写；当前 `setStageFailed` 正常路径不太会在循环中途失败。并且这不是 `set_status` 与 `set_failed` 的重复 audit，二者没有在同一 `setStageFailed` 调用里同时写。  
**Suggested fix**: 暂不阻塞 Loop 2。后续如果 audit 要作为 operator 决策证据，应支持 transaction 后写 audit，或者在 cleanup 层统一收集已提交结果后再写 audit。

## 5-Lens Notes

### 正确性

- `status='failed' AND failed_reason IS NOT NULL` 会返回 `false` 且不覆盖，见 `packages/backend/src/harness-queries.ts:282-288`。
- `status='failed' AND failed_reason IS NULL` 不会被 guard 拦住，会继续 `UPDATE`，所以旧路径留下的 failed/null 行可以补写，见 `packages/backend/src/harness-queries.ts:286-297`。
- 外层 `unknown_error` 不会覆盖内层已写 reason，因为第二次调用会被 guard 拦住，见 `packages/backend/src/scheduler.ts:210-216` 和 `packages/backend/src/harness-queries.ts:282-288`。
- `bundle` 在 Phase A 前声明，Phase A catch 里总是 `throw err`，所以 Phase B 使用 `bundle.prompt` 前没有可达的未初始化路径，见 `packages/backend/src/scheduler.ts:291-314` 和 `packages/backend/src/scheduler.ts:326-343`。

### 跨端对齐

- Loop 2 是 backend-only write path；字段已由 Loop 1 通过 `StageDtoSchema` 的 optional `failedReason` / `failedAt` 暴露，见 `packages/shared/src/harness-protocol.ts:207-213`。
- 没有 `.strict()` 泄漏到 Stage DTO；old clients 依赖 unknown key ignore 的兼容模型仍成立，见 `packages/shared/src/harness-protocol.ts:207-210`。
- 没有协议 bump 或 min client bump，符合 Loop 2 charter，见 `packages/shared/src/harness-protocol.ts:42-48`。

### 不可逆

- Loop 2 只写已有 nullable columns；既有 v102 rows 的 `failed_reason` / `failed_at` 会保持 NULL，直到之后真的失败并走 `setStageFailed`。
- Reason 目前是自由文本，没有 schema CHECK / enum / index，所以 canonical value 未来仍可调整；不可逆成本低。

### 安全

- `setStageFailed` 接收任意 string reason，但 DB update 使用 bind parameter，audit 走 `JSON.stringify`，没有 SQL 注入风险，见 `packages/backend/src/harness-queries.ts:290-301`。
- 主要安全/运维边界是 audit best-effort 可能与 transaction 成败不完全一致，见 m4。

### 简化

- 自由文本 reason 是合理的 Loop 2 最小实现；不需要本圈引入 enum 表、CHECK 约束或 protocol enum。
- 但 plan v2 §3 #1.2 已经有 canonical values，建议在 Loop 3 或 dashboard 查询前把 reason 常量集中到一个小 union/const tuple，避免字符串散落。

## Loop 3 Trigger Readiness

**结论：Loop 3 还不满足启动条件。**

理由不是 Loop 2 代码不能合并，而是启动条件写的是“Loop 2 retrospective confirms failed_reason can actually distinguish failure types”。当前仓库只找到 `docs/retrospectives/M2-Loop1-failed-reason-schema.md`，没有找到 Loop 2 retrospective。现有测试也只覆盖 orphan cleanup 和 helper invariants，见 `packages/backend/src/test-scheduler-orphan-cleanup.ts:73-88` 与 `packages/backend/src/test-harness-schema.ts:735-771`，还没有覆盖 `spawn_setup_failed` / `cli_failed` / `spec_harvest_failed` 三条 runtime catch 的实际区分。

建议 Loop 2 合并后补 retrospective，并在其中明确记录至少一次静态/机器/狗粮证据：四个 reason 能落库且 outer `unknown_error` 不覆盖真实 reason。满足这条后再解冻 Loop 3 minimal skip API。

## False-Positive Watch

- F? m1 的跨连接 race 可能被当前部署模型完全规避：单 backend / 单 scheduler / `better-sqlite3` 同步执行时，SELECT 与 UPDATE 之间没有 JS `await`，同进程内不会被其他 scheduler path 插入。若项目明确 M2 不考虑多进程 backend，这条只应保留为 future hardening。
- F? m2 是否应归类为 `spawn_setup_failed` 取决于作者对 Phase A 的定义。如果 Phase A 只包含 bundle/task setup，running transition 落到 `unknown_error` 是有意选择；建议在注释里写清楚。

## What I Did Not Look At

- 没有运行测试；本次是静态 cross-review。
- 没有阅读作者对本实现的 transcript / 思考流 / 工具调用历史。
- 没有评审 Loop 3 skip API 设计、auth 行为或 retry policy，因为它们明确不在 Loop 2 scope。
- 没有做真实 backend restart dogfood，只核对了 orphan cleanup 测试与代码路径。
- 没有检查 Swift UI 是否展示 `failedReason`，因为 Loop 2 charter 是 backend write path，不是客户端展示或新 API。
