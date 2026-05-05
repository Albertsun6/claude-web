# Cross Review — M2 Loop 6 Explicit Boot Ordering

**Reviewer**: reviewer-cross  
**Model**: GPT-5.5  
**Date**: 2026-05-06 01:34  
**Files reviewed**:
- `packages/backend/src/scheduler.ts`
- `packages/backend/src/routes/harness.ts`
- `packages/backend/src/test-scheduler-orphan-cleanup.ts`
- `packages/backend/src/test-e2e-pipeline.ts`
- `packages/backend/src/test-e2e-pipeline-failures.ts`
- `packages/backend/src/test-scheduler-failed-reasons.ts`

Additional static checks:
- `packages/backend/src/index.ts` route mounting order
- `packages/backend/src/harness-queries.ts` `setStageFailed()` first-write-wins guard
- repo-wide `new EvaScheduler(` / `initialize()` call-site search

---

## Summary

- Blockers: 0
- Majors: 0
- Minors: 1
- 总体判断：建议小改后合并。Loop 6 行为改动符合 charter，生产路径从隐式 constructor cleanup 变成显式 `initialize()` cleanup，未发现 retry / cancellation / schema / route / protocol / lifecycle guard 越界。

## Numeric Score

| Lens | Score (0..5) |
|---|---:|
| 正确性 | 4.8 |
| 跨端对齐 | 5.0 |
| 不可逆 | 5.0 |
| 安全 | 5.0 |
| 简化 | 4.7 |

**Overall score**: 4.9

---

## Findings

### m1 [MINOR] 少数注释仍说 constructor/实例化触发 cleanup

**Where**:
- `packages/backend/src/scheduler.ts:106`
- `packages/backend/src/test-scheduler-orphan-cleanup.ts:3-5`
- `packages/backend/src/test-scheduler-orphan-cleanup.ts:55`

**Lens**: 简化 / 正确性  
**Issue**: 实现已经改成 `new EvaScheduler(...); scheduler.initialize()`，但旧注释仍写“实例化 EvaScheduler 时扫描 active stages”或“constructor 应触发 cleanup”。这不影响运行行为，但会削弱 Loop 6 的核心目标：让 boot ordering 在调用点显式可见。  
**Why this is minor**: 代码路径、测试断言、生产调用都正确；问题只在注释准确性。  
**Suggested fix**: 把这些注释统一改成 “backend boot 调用 `initialize()` 时 cleanup”，避免未来 reviewer 或维护者误以为 constructor 又有副作用。

---

## Loop 6 Charter Compliance

**Verdict**: compliant.

- `EvaScheduler` constructor 现在是纯构造：参数注入仍在 constructor signature 中，body 只有注释，没有 DB write、broadcast、timer、route 注册或其他副作用。见 `packages/backend/src/scheduler.ts:71-82`。
- `initialize()` 是显式 boot step，并且只调用 `cleanupOrphanStages()`。没有引入 double-init guard、lifecycle state machine、async lock 或其他状态。见 `packages/backend/src/scheduler.ts:84-96`。
- `cleanupOrphanStages()` 当前行为仍是：查询 `pending` / `dispatched` / `running`，transaction 内用 `setStageFailed(..., "orphan_after_restart", cleanupAt)` 标失败，commit 后广播 `stage_changed:failed`，最后打日志。见 `packages/backend/src/scheduler.ts:122-167`。
- 没看到 retry / cancellation 逻辑改动。`tick()` 的 failed-stage block 与 spawn catch 路径保持在既有位置，Loop 6 没往这些路径新增策略。见 `packages/backend/src/scheduler.ts:169-263` 和 `packages/backend/src/scheduler.ts:325-410`。
- 没看到新 schema、route、protocol bump。`routes/harness.ts` 的实质新增点是 scheduler 构造后显式 `initialize()`；route surface 从 `app.post("/scheduler/tick"...` 开始仍保持原有 API。见 `packages/backend/src/routes/harness.ts:41-57`。
- 未添加 double-initialize guard。`initialize()` 没有 `initialized` flag，符合 charter “依赖 Loop 2 first-write-wins，不新增生命周期状态机”。见 `packages/backend/src/scheduler.ts:90-96`；first-write-wins guard 在 `setStageFailed()` 单条 SQL 中，见 `packages/backend/src/harness-queries.ts:282-295`。

## Production Behavior Preservation

**Verdict**: v0.5.0 -> v0.6.0 production behavior is preserved by static inspection.

- v0.5.0 的行为是 `new EvaScheduler(db, broadcast)` 在启动时清 orphan。Loop 6 的生产路径变成 `const scheduler = new EvaScheduler(db, broadcast); scheduler.initialize();`，仍在 harness routes 对外注册前同步完成 cleanup。见 `packages/backend/src/routes/harness.ts:41-53`。
- `buildHarnessRouter()` 内没有 async gap：`scheduler.initialize()` 在第一条 `app.post("/scheduler/tick"...` 之前执行，且 `initialize()` / `cleanupOrphanStages()` 都是同步 better-sqlite3 调用。见 `packages/backend/src/routes/harness.ts:46-53` 和 `packages/backend/src/scheduler.ts:94-167`。
- `index.ts` 中 `app.route("/api/harness", buildHarnessRouter(...))` 会先求值 `buildHarnessRouter()`，所以 scheduler cleanup 完成后才把 router 挂到 `/api/harness`。见 `packages/backend/src/index.ts:271-273`。
- `serve(...)` 出现在 harness mount 之前，但从 `server` 创建到 `app.route("/api/harness"...` 之间没有 `await` / Promise continuation；同一轮模块求值未让出事件循环，请求处理不会插入到 cleanup 和 route mount 之间。见 `packages/backend/src/index.ts:250-273`。
- broadcast 行为仍在 transaction commit 后逐条发送 `harness_event / stage_changed / status=failed`，和既有 orphan cleanup invariant 对齐。见 `packages/backend/src/scheduler.ts:132-156`。

## Charter Test Fidelity

**Verdict**: adequate.

- 旧 orphan cleanup invariant 仍被同一个测试覆盖：`pending` / `dispatched` / `running` -> `failed`，`awaiting_review` 不动，`approved` / `rejected` 不动。见 `packages/backend/src/test-scheduler-orphan-cleanup.ts:63-104`。
- failed reason 与 failed_at 仍覆盖：3 个 orphan 都写入 `failed_reason='orphan_after_restart'` 且 `failed_at` 有值。见 `packages/backend/src/test-scheduler-orphan-cleanup.ts:73-88`。
- broadcast invariant 仍覆盖：3 个 orphan 对应 3 个 `stage_changed:failed` event，且 stageId 覆盖正确。见 `packages/backend/src/test-scheduler-orphan-cleanup.ts:106-118`。
- idempotency 仍覆盖：第二个 scheduler + `initialize()` 在无 orphan 时 0 broadcast。见 `packages/backend/src/test-scheduler-orphan-cleanup.ts:120-127`。
- Loop 6 新 charter test 覆盖两件关键事：只 `new EvaScheduler` 不触发 DB mutation / broadcast；随后调用 `initialize()` 才把 fresh orphan 标 failed 并广播。见 `packages/backend/src/test-scheduler-orphan-cleanup.ts:129-178`。

## Call Site Completeness

**Verdict**: complete for current source tree.

Repo-wide `new EvaScheduler(` search only found the production router and the four requested test files:

| Call site | Initialize status |
|---|---|
| `packages/backend/src/routes/harness.ts:46-47` | `new` 后立即 `initialize()` |
| `packages/backend/src/test-scheduler-orphan-cleanup.ts:60-61` | `new` 后 `initialize()` |
| `packages/backend/src/test-scheduler-orphan-cleanup.ts:122-123` | re-instantiate 后 `initialize()` |
| `packages/backend/src/test-scheduler-orphan-cleanup.ts:148-163` | 先刻意不调 `initialize()` 验 pure constructor，再调用 |
| `packages/backend/src/test-e2e-pipeline.ts:157-158` | `new` 后 `initialize()` |
| `packages/backend/src/test-e2e-pipeline-failures.ts:120-121` | scenario 1 `initialize()` |
| `packages/backend/src/test-e2e-pipeline-failures.ts:233-234` | scenario 2 `initialize()` |
| `packages/backend/src/test-e2e-pipeline-failures.ts:304-305` | scenario 3 first scheduler `initialize()` |
| `packages/backend/src/test-e2e-pipeline-failures.ts:322-323` | scenario 3 restart scheduler `initialize()` |
| `packages/backend/src/test-scheduler-failed-reasons.ts:72-73` | `new` 后 `initialize()` |

No other source call site still relies on constructor-side-effect cleanup.

---

## 5-Lens Review

### Lens 1 — 正确性

No blocker / major found. Constructor purity is real in code (`packages/backend/src/scheduler.ts:71-82`), `initialize()` has exactly one effect (`packages/backend/src/scheduler.ts:94-96`), and cleanup remains synchronous and transactional around DB mutation (`packages/backend/src/scheduler.ts:132-140`). The only correctness-adjacent issue is stale comments described in `m1`.

### Lens 2 — 跨端对齐

No finding. This is backend-only boot ordering. No iOS / web / shared protocol file is touched, and the existing broadcast event shape remains `type: "harness_event", kind: "stage_changed", stageId, status: "failed"` (`packages/backend/src/scheduler.ts:143-150`). No `.strict()` / DTO decode surface appears.

### Lens 3 — 不可逆

No finding. No persisted schema, enum, route, protocol, migration version, or client-visible contract changes. The only durable effect remains the existing orphan cleanup write through `setStageFailed(..., "orphan_after_restart")` (`packages/backend/src/scheduler.ts:135-140`).

### Lens 4 — 安全 / 运维风险

No finding. No new auth surface. Harness routes still mount under `/api/harness` after global `/api/*` auth middleware in production (`packages/backend/src/index.ts:90-91`, `packages/backend/src/index.ts:271-273`). Cleanup broadcast behavior remains post-commit best-effort, so notification failure does not roll back DB truth (`packages/backend/src/scheduler.ts:142-156`).

### Lens 5 — 简化

One minor. The code takes the simple route: `initialize()` is a thin explicit boot step, and there is no extra guard/state machine (`packages/backend/src/scheduler.ts:84-96`). The only simplification cleanup is wording: remove old constructor-side-effect comments so the code and docs teach the same boot sequence.

---

## False-Positive Watch

- F? `index.ts` calls `serve(...)` before mounting harness routes. I do **not** treat this as a race because there is no async gap before `app.route("/api/harness", buildHarnessRouter(...))`, and Node will not process incoming requests until the current module-evaluation turn yields. If a future refactor inserts an `await` between `serve` and harness mount, this should be re-reviewed.

## What I Did Not Look At

- Did not run the backend tests; this was a static cross-review.
- Did not perform a machine byte-compare against the v0.5.0 implementation. I inspected the current cleanup body and invariants, but did not diff against a tagged production checkout.
- Did not review frontend, iOS, Swift Codable, or shared protocol files because Loop 6 is backend-only and no cross-end artifact was listed.
- Did not review migrations in full because this loop should not change schema; I only checked `setStageFailed()` for the idempotent first-write-wins claim.
- Did not inspect author transcripts or prior implementation discussion; review is based on the artifact files and source search.
