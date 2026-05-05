# M2 Loop 6 — explicit boot ordering refactor (cleanupOrphanStages → initialize())

**Date**: 2026-05-06
**Phase**: M2 Loop 6（sixth loop under M2 master plan v2 loop-by-loop approval）
**Risk addressed this loop**: "EvaScheduler constructor 副作用 cleanupOrphanStages — boot ordering 隐式（读 routes/harness.ts 才知道 cleanup 何时触发）。Cross-review Loop 1 / 3 / 5 都提过这点。"
**Exit**: **ship**
**Related PRs**:
- #28 F orphan cleanup (引入 cleanupOrphanStages)
- #34 Loop 4 e2e (Lesson C: test infra 也走螺旋)
- #35 Loop 5 failure-path e2e
**Related artifacts**:
- `packages/backend/src/scheduler.ts` — pure constructor + new `initialize()` method
- `packages/backend/src/routes/harness.ts` — explicit `scheduler.initialize()` 在 routes mount 前
- 4 test files — 全部加 `.initialize()` 调用
- `docs/reviews/m2-loop6-explicit-boot-ordering-cross-2026-05-06-0134.md`

---

## 一句话本圈风险

让 EvaScheduler 构造函数变成纯构造，cleanupOrphanStages 通过显式 `initialize()` 调用。boot ordering 在调用点可见，承接 Loop 1 cross m1 + Loop 4 注入对称。

## 6 步循环执行

### 1. 风险陈述

Loop 1 cross m1 直接说："constructor 副作用 hides irreversible state mutation; prefer explicit `initialize()` or `EvaScheduler.createStarted(...)`"。Loop 5 retrospective 推荐它作为下一 Loop。Cross-review 视角累积反馈三次都指向同一 follow-up — 该收掉了。

### 2. 最小可运行切片

**Production**：
```typescript
// scheduler.ts (target)
constructor(db, broadcast, runSessionFn = runSession) {
  // pure construction — no side effects (Loop 6)
}

public initialize(): void {
  this.cleanupOrphanStages();
}

// routes/harness.ts (target)
const scheduler = new EvaScheduler(db, broadcast);
scheduler.initialize();  // ← explicit boot step before routes mount
```

**特别拒绝**（charter 严格）：
- ❌ `private initialized: boolean` lifecycle guard — cleanupOrphanStages 已 idempotent (Loop 2 first-write-wins guard)，不引入新状态机
- ❌ `EvaScheduler.createStarted(db, broadcast)` static factory — 当前不需要，保持 minimal

### 3. 机器验证

- **`pnpm --filter @claude-web/shared test`** → 123/123
- **`pnpm --filter @claude-web/backend test:harness-schema`** → Phase 1-7 全绿（无相关代码改动，纯回归）
- **`pnpm --filter @claude-web/backend test:scheduler-cleanup`** → 全部断言绿，**含 4 项新 Loop 6 charter test**：
  - ✅ pure constructor emits 0 broadcasts
  - ✅ pure constructor doesn't mutate DB（fresh orphan 仍 pending）
  - ✅ `.initialize()` triggers cleanup（orphan → failed + reason）
  - ✅ `.initialize()` emits 1 stage_changed:failed broadcast
- **`pnpm --filter @claude-web/backend test:scheduler-failed-reasons`** → 全过（Loop 2 行为 + Loop 6 init 调用）
- **`pnpm --filter @claude-web/backend test:e2e-pipeline`** → Loop 4 happy path 27 项 regression 全过
- **`pnpm --filter @claude-web/backend test:e2e-failures`** → Loop 5 failure path 全过
- **`pnpm -r exec tsc --noEmit`** → clean

### 4. 真实 dogfood

通过 Loop 6 charter test 覆盖最关键的 boot ordering invariant：构造函数 vs initialize() 行为分离。所有现有 e2e tests 也证明 `new + initialize()` 模式与 v0.5.0 行为等价（happy path + failure path 均无 regression）。

### 5. cross-review

`docs/reviews/m2-loop6-explicit-boot-ordering-cross-2026-05-06-0134.md` — cursor-agent gpt-5.5-medium：

- **0 BLOCKER + 0 MAJOR + 1 MINOR**，**overall 4.9/5（史上最高）**
- **Charter compliance: held（6 项独立 verification）**：
  1. ✅ Constructor 纯（无 DB write / broadcast / timer / route 注册）
  2. ✅ initialize() 仅调 cleanupOrphanStages（无 lifecycle guard）
  3. ✅ cleanupOrphanStages 行为完全保留（同 transaction + 同 reason + 同 broadcast）
  4. ✅ retry/cancellation 路径未触动
  5. ✅ 无新 schema/route/protocol bump
  6. ✅ 无 double-init guard（依赖 Loop 2 first-write-wins）
- **Production behavior preservation 单独 verification**：
  - v0.5.0：`new EvaScheduler(...)` 在 constructor 跑 cleanup
  - v0.6.0：`new + initialize()`，但 routes/harness.ts 内**没 async gap**（同模块 evaluation turn，Node 不让出 event loop）
  - 等价。byte-equivalent 生产行为
- **Call site completeness verification**：
  - cursor-agent grep 全仓 `new EvaScheduler(` — 找到 10 处全部更新
  - 4 test files + 1 production router
- **finding 处理**：
  - m1 (stale 注释 still says constructor triggers cleanup) ✅ 应用：3 处注释统一改"backend boot 调用 initialize() 时 cleanup"

### 6. retrospective + ship/drop/defer

**Exit**: **ship**

## M2 #1 Pipeline Stability Coverage After Loop 6

cursor-agent 没单独评估 Loop 6 对 M2 #1 coverage 的影响。我的判断：从 Loop 5 ~60-63% **保持不变**或略升（~62-65%）。

**理由**：Loop 6 不增 feature，纯 refactor。但它推进 M2 #1 的 MD8（explicit boot ordering）—— cursor-agent F 圈最初评估 8 项 MUST-do 之一。MD8 完成意味着 M2 #1 8 项 MUST-do 中 4 项完成（MD1 / MD2 partial / MD3 / MD8）。

| MUST-do | 状态 |
|---|---|
| MD1 持久化失败原因 | ✅ Loop 1+2 |
| MD2 minimal skip | ✅ Loop 3（完整 retry hold）|
| MD3 e2e reproducible test | ✅ Loop 4+5 |
| **MD8 explicit boot ordering** | ✅ **Loop 6** |
| MD7 stage cancellation | ❌ Loop 7+ |
| MD2 完整 retry policy | ❌ Loop 7+ |

剩 2 项核心 MUST-do (MD7 + MD2 完整)，都属骨架层。

## 学到的（Trans-context lessons）

### Lesson A — Cross-review 反馈累积有质变

Cross-review 在 Loop 1 / 3 / 5 各提过"constructor 副作用建议 explicit init"。每次都标 minor 或 follow-up，但不强制。Loop 6 真做了之后回头看：**这 3 次反馈累积才是它的真信号**。

如果某条 finding 在多 Loop cross-review 中重复出现（即便每次都被归为低优先级），它已经升级为系统性 follow-up，应当主动调度而非等触发。

**记入 reviewer-cross/LEARNINGS.md（候选）**：cross-review verdict 应统计"重复 finding"——同一类问题出现 ≥3 次自动升级为下一 Loop 候选。

### Lesson B — 纯 refactor 也是螺旋

Loop 4 retrospective Lesson C 说"测试基础设施扩展也是螺旋"。Loop 6 进一步：**纯 refactor 也是螺旋**——cursor-agent 给出 4.9/5 高分，正是因为 charter 极清晰 + scope 极小 + 行为完全保留。

未来类似的 refactor follow-up（如 audit consumer infrastructure / migrationsDir injection / etc）都该按 Loop 节奏推：每个独立 Loop，charter 只覆盖一个 refactor item，cross-review 焦点在"行为是否保留"而非"功能是否新增"。

### Lesson C — Loop 6 验证了双层原则的"无骨架风险螺旋"也有真价值

按 §0.5 双层定位，Loop 6 是螺旋层（无 schema/protocol/route）。但它收掉了 3 次 cross-review 反馈，提升了系统的可读性 + 测试可分离度 + boot ordering 显式度。这种"非功能性收益"也是螺旋层的合法目标，不必每个 Loop 都 push 新 feature 才有价值。

## Follow-up（不阻塞 Loop 6 ship）

- **Loop 7+ 候选已收敛到 2 项**：MD7 stage cancellation（骨架，需 enum + iOS 兼容评估）/ MD2 完整 retry policy（骨架，schema 改 + scheduler 状态机）
- **CI 接入 e2e**：`test:e2e-all` 当前是 manual entry。可在 GitHub Actions 加进 PR check（螺旋层 infra 改动，scope 小，独立 Loop）
- **LEARNINGS.md 更新**：把 Lesson A/B/C 写进 `.claude/skills/reviewer-cross/LEARNINGS.md`

## 当前 dev 累积（待 release v0.6.0）

v0.5.0 之后到 dev 的 Loop：
- Loop 1+2+3 都已合 v0.5.0（在 prod）
- **Loop 4 / 5 / 6 累积在 dev**（test infra + refactor，未 release）

按 plan v2 OQ-E "触碰 prod runtime 才 release"：
- Loop 4 / 5: 纯 test infra
- Loop 6: 改 EvaScheduler constructor 形态 + routes/harness.ts boot 序列 — **触碰 prod runtime**（虽然行为等价）

→ Loop 6 ship 后是合理的 v0.6.0 release 节点 (Loop 4+5+6 一起；用户拍板)。
