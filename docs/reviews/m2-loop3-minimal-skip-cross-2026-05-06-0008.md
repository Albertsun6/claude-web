# Cross Review — M2 Loop 3 Minimal Skip API

**Reviewer**: reviewer-cross  
**Model**: GPT-5.5  
**Date**: 2026-05-06 00:08  
**Files reviewed**:
- `packages/backend/src/harness-queries.ts`
- `packages/backend/src/routes/harness.ts`
- `packages/backend/src/index.ts`
- `packages/backend/src/auth.ts`
- `packages/backend/src/test-harness-schema.ts`
- `packages/backend/src/migrations/0001_initial.sql`
- `packages/backend/src/migrations/0002_stage_status_dispatched.sql`
- `packages/backend/src/migrations/0003_stage_failed_reason.sql`
- `docs/proposals/M2-master-plan.md`
- `docs/reviews/scheduler-orphan-cleanup-cross-2026-05-05-2228.md`

---

## Summary

- Blockers: 0
- Majors: 0
- Minors: 4
- 总体判断：建议小改后合并。Loop 3 charter 基本守住：实现只做 `failed -> skipped`，没有 retry/resume/auto-retry/reset-pending/attempt-count/parentTaskId，也没有自动 tick 或 schema/protocol 变更。需要补的是测试覆盖和机械 charter lock。

## Numeric Score

| Lens | Score (0..5) |
|---|---:|
| 正确性 | 4.4 |
| 跨端对齐 | 4.8 |
| 不可逆 | 4.7 |
| 安全 | 4.6 |
| 简化 | 4.7 |

**Overall score**: 4.64

## Loop 3 Charter Compliance

1. **没有 retry / resume / auto-retry / reset pending / attempt count / parentTaskId 逻辑偷渡。**  
   `skipFailedStage` 的实现只读 `stage.status`，对 `skipped` 返回幂等成功，对非 `failed` 返回 `invalid_state`，对 `failed` 调 `setStageStatus(..., "skipped")`；没有 task/run/session/attempt/parent 相关写入。唯一出现 forbidden words 的地方是 helper 注释里的显式排除说明。见 `packages/backend/src/harness-queries.ts:303-345`。

2. **没有自动触发 tick。**  
   `scheduler.tick(projectId)` 只在 `POST /scheduler/tick` route 内调用，见 `packages/backend/src/routes/harness.ts:46-50`。`POST /stages/:id/skip` 只调用 `skipFailedStage` 并返回 JSON，见 `packages/backend/src/routes/harness.ts:147-161`。这符合 plan v2 “operator skip 后显式再 tick”的边界。

3. **没有允许其他状态转 skipped。**  
   helper 明确 `row.status !== "failed"` 时返回 `invalid_state`，只有 `failed` 分支会写 `skipped`，见 `packages/backend/src/harness-queries.ts:333-344`。`skipped` 是 no-op，不是新转换。

4. **没有新 schema / migration / protocol bump。**  
   Loop 3 artifact 文件没有新增 migration；现有 v102 只来自 Loop 1 的 `failed_reason` / `failed_at` additive migration，见 `packages/backend/src/migrations/0003_stage_failed_reason.sql:1-26`。本次 route/helper/test 没有改 shared protocol，也没有新增 status enum。

5. **Auth 使用现有全局 `/api/*` middleware。**  
   `app.use("/api/*", authMiddleware)` 在 harness route mount 之前注册，见 `packages/backend/src/index.ts:90-91` 和 `packages/backend/src/index.ts:271-274`。`authMiddleware` 在 `CLAUDE_WEB_TOKEN` 设置时要求 bearer/query token，见 `packages/backend/src/auth.ts:82-107`。因此 skip route 没有单独 auth 代码，也没有绕过全局 auth。注意：现有产品约定是 token 未设置时 dev mode 放行，这不是 Loop 3 引入的新 bypass。

6. **范围纪律总体合格，但缺机械锁。**  
   代码视觉上守住了 charter；测试里只有注释说“不做 retry / reset pending / auto-tick”，见 `packages/backend/src/test-harness-schema.ts:775-782`。建议补静态 assert，防止后续误把 `scheduler.tick()` 或 retry 字段塞进 skip route/helper 时测试仍绿。

## Findings

### m1 [MINOR] Phase 7 没覆盖实际 status enum 的 `dispatched` 和 `rejected`

**Where**: `packages/backend/src/migrations/0002_stage_status_dispatched.sql:52-54`, `packages/backend/src/test-harness-schema.ts:803-847`  
**Lens**: 正确性  
**Issue**: 落地 schema 的 `stage.status` enum 是 `pending/dispatched/running/awaiting_review/approved/rejected/skipped/failed`，但 Phase 7 invalid-state 测试只覆盖了 `pending/running/approved/awaiting_review`。  
**Why this matters**: helper 当前会正确拒绝 `dispatched` 和 `rejected`，因为它只允许 `failed`；但测试没有锁住这两个状态，未来如果有人调整分支或引入 active-state helper，可能漏放 `dispatched -> skipped` 或 `rejected -> skipped`。  
**Suggested fix**: 在 Phase 7 seed 里加 `s-dispatched` 和 `s-rejected`，并把它们纳入 invalid-state loop。

### m2 [MINOR] Loop 3 charter 缺静态机械锁

**Where**: `packages/backend/src/test-harness-schema.ts:775-782`, `packages/backend/src/routes/harness.ts:46-50`, `packages/backend/src/routes/harness.ts:147-161`  
**Lens**: 正确性 / 简化  
**Issue**: Phase 7 注释声明“不做 retry / reset pending / auto-tick”，但没有像 Loop 1 Phase 5 那样用文件内容做机械 assert。  
**Why this matters**: Loop 3 的风险不是当前代码复杂，而是后续维护时不小心把 `scheduler.tick()`、retry/reset-pending、attempt tracking 塞进 skip route。当前测试只测 helper 结果，不会发现 route 偷渡 auto-tick。  
**Suggested fix**: 在 Phase 7 加一个小静态锁：读取 `routes/harness.ts` 和 `harness-queries.ts`，抽取 skip route/helper 附近文本，assert 不含 `scheduler.tick`, `.tick(`, `retry`, `resume`, `attempt`, `parentTaskId`, `parent_task`, `setStageStatus(..., "pending")` 等 forbidden pattern。允许注释里的 forbidden words 需要么限定只扫代码块，要么把注释移出扫描范围。

### m3 [MINOR] `skipFailedStage` 的 SELECT-then-UPDATE 对 audit 不是并发幂等

**Where**: `packages/backend/src/harness-queries.ts:328-344`  
**Lens**: 正确性 / 安全  
**Issue**: helper 先 `SELECT status`，再调用 `setStageStatus(db, stageId, "skipped")`。两个并发 skip 请求如果都在 UPDATE 前读到 `failed`，最终状态仍是 `skipped`，但两个请求都会认为自己执行了 `failed -> skipped` 并写 audit。  
**Why this matters**: 单 Node + 同一进程下实际风险低，最终 DB 状态也是正确的；问题主要是 audit 语义会重复，未来若 audit 被用来驱动 metrics / operator timeline，会把一次 operator action 记成两次 skip。  
**Suggested fix**: 如果想把 audit 也做成幂等，改成单条 `UPDATE stage SET status='skipped', ended_at=COALESCE(ended_at, ?) WHERE id=? AND status='failed'`，根据 `changes` 决定是否写 skip audit；`changes=0` 时再 SELECT 区分 `skipped` / invalid / not_found。

### m4 [MINOR] 单次 skip 产生 `set_status` + `skip` 两条 audit，没有测试或注释说明这是有意的

**Where**: `packages/backend/src/harness-queries.ts:255`, `packages/backend/src/harness-queries.ts:341-344`  
**Lens**: 正确性 / 简化  
**Issue**: `setStageStatus` 内部会写 `audit("set_status", ...)`，`skipFailedStage` 随后又写 `audit("skip", ...)`。所以一次成功 skip 会有两条 audit event。  
**Why this matters**: 这不阻塞合并，两条 event 也有解释空间：一条是通用状态变化，一条是 operator action。但当前没有测试或注释锁语义，后续 dashboard 如果按 event count 统计 skip 次数，可能误用 `set_status` 或重复计数。  
**Suggested fix**: 二选一即可：明确保留双 audit，并在注释/测试里说明 operator skip 以 `action="skip"` 为准；或者给 `setStageStatus` 增加可选 `auditAction`/`suppressAudit`，让 skip 只写一条语义 event。为了 Loop 3 scope，推荐前者。

## 5-Lens Assessment

### Lens 1 — 正确性

实现的状态机是对的：`not_found`、`alreadySkipped`、`invalid_state`、`failed -> skipped` 四类结果都存在，见 `packages/backend/src/harness-queries.ts:328-344`。`failed_reason` 为 NULL 的旧失败行也能 skip，因为 helper 只看 `status`，不依赖 `failed_reason`。主要缺口是 Phase 7 没覆盖 `dispatched` / `rejected`，以及并发请求下 audit 不是严格幂等。

### Lens 2 — 跨端对齐

这是 backend-only action RPC；没有新增 shared protocol、Swift Codable、Web store schema 或 iOS contract。HTTP 语义可接受：成功和 idempotent re-skip 都是 200，missing 是 404，非法状态是 409，并且错误也返回 JSON body，见 `packages/backend/src/routes/harness.ts:147-161`。POST 作为 action-style mutation 合理。

### Lens 3 — 不可逆

没有新增 enum、migration、protocol version、minClientVersion 或持久化 retry metadata。`failed_reason` 在 skip 后保留，见 `packages/backend/src/test-harness-schema.ts:856-863`，这保留了诊断价值。唯一需要注意的是 skip API 行为一旦被前端/iOS使用，`alreadySkipped: false` 这个 response shape 就会变成事实契约；当前是简单 JSON，风险低。

### Lens 4 — 安全

skip 是 mutation route，但挂在 `/api/harness` 下，受 `/api/*` 全局 authMiddleware 保护，见 `packages/backend/src/index.ts:90-91` 和 `packages/backend/src/index.ts:271-274`。`authMiddleware` 在 token 设置时返回 401，见 `packages/backend/src/auth.ts:101-107`。route 没有 path input、shell input、FTS query 或 SQL string 拼接；`stageId` 通过 bind param 进入 helper，见 `packages/backend/src/harness-queries.ts:328-330`。

### Lens 5 — 简化

实现基本保持最薄：一个 helper、一个 route、一个 Phase 7 测试段。没有引入 retry policy、attempt table、parent task link、runtime_state 或 scheduler side effect。建议补的只是测试锁，不需要引入新的 abstraction。

## Route Behavior

- `ok` / `alreadySkipped`: 200 JSON，见 `packages/backend/src/routes/harness.ts:149-151`。
- `not_found`: 404 JSON，见 `packages/backend/src/routes/harness.ts:152-154`。
- `invalid_state`: 409 JSON，带 `currentStatus`，见 `packages/backend/src/routes/harness.ts:155-160`。
- `POST` 作为 action RPC 可以接受；这里不是通用 partial resource update，用 `PATCH` 不是必须。

## Test Coverage

Phase 7 覆盖了 happy path、idempotent re-skip、already skipped、4 个非法状态、not_found、failed_reason preserved，见 `packages/backend/src/test-harness-schema.ts:813-863`。缺口如下：

- 缺 `dispatched` / `rejected` invalid-state 覆盖。
- 缺 `failed` + `failed_reason IS NULL` 的显式组合；当前代码会通过，但测试没锁住老行兼容。
- 缺并发 skip 测试；考虑到单进程和最终状态幂等，这不是当前 blocker。
- 缺 route 层测试；helper 已覆盖主要状态语义，route JSON/status code 仍靠静态读。
- 缺静态 charter lock，见 m2。

## M2 #1 Pipeline Stability Coverage

F 原始评审把 orphan cleanup 判为约 **20%** 覆盖，理由是它只把 backend restart 后的 active-stage deadlock 变成 visible failed stage，见 `docs/reviews/scheduler-orphan-cleanup-cross-2026-05-05-2228.md:99-121`。

Loop 1+2+3 之后，我会把 M2 #1 覆盖评估提升到约 **40-45%**：

- MD1 “持久化失败原因 + recovery metadata” 已基本覆盖：Loop 1 加 schema，Loop 2 写入 4 类 canonical reason。
- MD2 已被 v2 拆分；Loop 3 只覆盖其中 minimal skip 的 operator unblock，不覆盖 retry/resume/auto-retry/attempt count。按原 full MD2 只能算部分完成。
- 仍未覆盖 MD3 e2e reproducible pipeline test、MD7 cancellation、MD8 explicit boot ordering 的完整 hardening。
- 跨端 reconcile / backlog / stale review 更多归到 M2 #4/#5 横切，但它们仍影响 “pipeline stability done” 的可信度。

所以当前可以诚实 claim：“失败可诊断 + operator 可以把 failed stage 标 skipped，再显式 tick 推进下一步。”还不能 claim：“M2 #1 任务流水线稳定已完成。”

## False-Positive Watch

- F? m3 并发 audit 重复可能在 better-sqlite3 同一 connection 的同步执行模型下难以真实触发；如果 Hono 在当前部署里不会并发进入这段同步 DB 代码，它就是 theoretical minor。但从 DB 语义看，SELECT-then-UPDATE 不是 audit 幂等。
- F? m4 双 audit 可能是作者有意保留的“通用状态事件 + operator action 事件”。如果后续 dashboard 明确只统计 `action="skip"`，这条可以降为 note。

## What I Did Not Look At

- 没有运行测试；本次是静态 cross-review。
- 没有审 `EvaScheduler.computeNextStage` skip 后是否一定推进到正确下一 stage；本轮 charter 只要求 skip API + operator 显式 re-tick。
- 没有审 Web/iOS UI 是否会调用该 route；Loop 3 明确是 backend-only minimal RPC。
- 没有审完整 audit log consumer，因为当前 repo里本轮 artifact 只涉及写入侧。
- 没有审 PR 描述、GitHub checks、部署状态或真实 prod 数据。
