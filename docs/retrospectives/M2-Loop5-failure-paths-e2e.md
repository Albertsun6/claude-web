# M2 Loop 5 — failure-path e2e pipeline test

**Date**: 2026-05-06
**Phase**: M2 Loop 5（fifth loop under M2 master plan v2 loop-by-loop approval）
**Risk addressed this loop**: "Loop 4 ship 了 happy-path e2e；失败路径只有单元 test，没经过 e2e scheduler.spawnAgent 三段 catch 真触发的端到端验证"
**Exit**: **ship**
**Related PRs**:
- #34 Loop 4 — happy-path e2e + runSession 注入接缝
- #31 Loop 2 — failed_reason 写入 5 个 catch path
- #32 Loop 3 — minimal skip API
**Related artifacts**:
- `packages/backend/src/test-e2e-pipeline-failures.ts` (new) — 3 scenarios + ~24 项 assertion
- `docs/reviews/m2-loop5-failure-paths-cross-2026-05-06-0057.md`

---

## 一句话本圈风险

证明 scheduler.spawnAgent 三段 try/catch 中 Phase B (cli_failed) + Phase C (spec_harvest_failed) 真发抛错时，Loop 1+2+3 全链路（schema → write reason → skip API）都正确响应。

## 6 步循环执行

### 1. 风险陈述

Loop 4 验证了 happy path，但失败路径只有：
- (a) 单元测试 `test-scheduler-failed-reasons.ts` 直接调 setStageFailed（不走 spawnAgent 三段 catch）
- (b) `test-scheduler-orphan-cleanup.ts` 仅覆盖 cleanupOrphanStages（不触发 Phase B/C catch）

无机器证据证明：runSession 真抛错时 Phase B catch 写 cli_failed；strategy 不写 spec.md 时 Phase C catch 写 spec_harvest_failed。

### 2. 最小可运行切片

新建 `test-e2e-pipeline-failures.ts`（330 行，3 scenarios）：

**Scenario 1 — cli_failed (Phase B)**：mock runSession 直接 throw
- 验证 `failed_reason='cli_failed'` + `failed_at` + `ended_at` 落 DB
- 验证 stage_failed broadcast 含 error string + stage_changed:failed broadcast
- 验证 Loop 3 skip API：failed → skipped + failed_reason 保留（诊断价值）
- 验证 re-tick → 下一 stage 推进
- **BONUS** verification 6（cross m1）：implement 失败 reason 是 `spawn_setup_failed`（不是 cli_failed）—— 这是 cross-Loop 集成意外覆盖：skip strategy 后 implement mustHave='spec' 找不到 → buildContextBundle 抛 → Phase A catch → spawn_setup_failed

**Scenario 2 — spec_harvest_failed (Phase C)**：mock runSession 不写 spec.md
- 验证 strategy 失败 reason 是 `spec_harvest_failed`
- 验证 stage_message 触发 2 次（Phase B 完成后 Phase C 才抛）证明 phase 顺序正确

**Scenario 3 — failure idempotent across scheduler restart**：
- 模拟 backend 重启（实例化第二个 EvaScheduler）
- 验证 cleanup 不动 already-failed stages（failed_reason / failed_at 不变）

### 3. 机器验证

- **`pnpm --filter @claude-web/shared test`** → 123/123
- **`pnpm --filter @claude-web/backend test:harness-schema`** → Phase 1-7 全绿
- **`pnpm --filter @claude-web/backend test:e2e-pipeline`**（Loop 4 regression）→ 27 项绿
- **`pnpm --filter @claude-web/backend test:e2e-failures`**（new）→ ~24 项 assertion + 3 scenarios 全绿
- **`pnpm --filter @claude-web/backend test:e2e-all`**（new）→ 串跑 Loop 4 + Loop 5
- **`pnpm -r exec tsc --noEmit`** → clean

### 4. 真实 dogfood

3 scenarios 各跑：
- ✅ Scenario 1: 11 assertions（含 BONUS 跨 Loop 集成 spawn_setup_failed）
- ✅ Scenario 2: 7 assertions
- ✅ Scenario 3: 4 assertions
- ✅ DATA_DIR isolation（Loop 4 LEARNINGS.md #6 模式）— 0 prod 污染

### 5. cross-review

`docs/reviews/m2-loop5-failure-paths-cross-2026-05-06-0057.md` — cursor-agent gpt-5.5-medium：

- **0 BLOCKER + 0 MAJOR + 3 MINOR**，overall **4.68/5**
- Charter compliance held（5 项独立 verification）
- **Phase A bonus coverage 判定为合法 emergent**（不是 charter 违规）—— charter 排除"添加 Phase A 注入接缝"，不排除"通过其他 Loop 自然触发 Phase A"。这正是 Loop-by-loop 设计期望的：Loop N 的副作用可以揭示之前 Loop 没意识到的覆盖
- finding 处理：
  - m1 (顶部 / 底部注释自相矛盾) ✅ 应用：统一描述 — Phase A 直接注入留 Loop 6+，但跨 Loop 集成已天然覆盖
  - m2 (nullable 字段类型断言不准) ✅ 应用：DB schema 允许 NULL → 类型反映这点 (`string | null` / `number | null`) + 显式 not-null check
  - m3 (test:e2e-failures 没接入 broader test entry) ✅ 应用：加 `test:e2e-all` 串跑 Loop 4 + 5 的 e2e

### 6. retrospective + ship/drop/defer

**Exit**: **ship**

## Phase A 跨 Loop 集成发现

Scenario 1 verification 6 是 Loop 5 的最大 surprise：

**触发链**：
1. Scenario 1 mock runSession 在 strategy 阶段 throw → stage 标 failed (cli_failed)
2. Loop 3 skip API → failed → skipped
3. Re-tick → scheduler 看 strategy.status=skipped（不是 approved）→ implement stage 创建
4. implement spawnAgent Phase A：buildContextBundle 调 ContextManager mustHave=['spec']
5. spec artifact 不存在（strategy 没产）→ ContextBundleMissingMustInclude 抛
6. Phase A catch → setStageFailed('spawn_setup_failed')

**意义**：
- Loop 1 schema + Loop 2 写入 + Loop 3 skip + ContextManager mustHave 四层叠加产生的 emergent 行为
- 证明 plan v2 §3 #1.3 "完整 retry policy 留 Loop 4+" 的 trade-off 是真的——operator skip 不是免费的，下游 stage 会因 mustHave 失败
- 这种"skip 制造级联失败"是 documented 行为（plan v2 §1 #1.2 ContextBundle mustHave fail-loud），Loop 5 把它从设计承诺升级到机器证据

## M2 #1 Pipeline Stability Coverage After Loop 5

cursor-agent 评估：**~60-63%**（Loop 4 ~52-56% 起）。

| MUST-do | 状态 | 备注 |
|---|---|---|
| MD1 持久化失败原因 | ✅ Loop 1+2 |
| MD2 minimal skip + 集成验证 | ✅ Loop 3 + Loop 5 cross-loop e2e | 完整 retry policy 仍 hold |
| MD3 e2e reproducible test | ✅ Loop 4 happy + Loop 5 failure |
| MD7 stage cancellation | ❌ Loop 6+ 候选 |
| MD8 explicit boot ordering | ❌ refactor 候选 |
| **跨 Loop 集成 e2e**（Loop 4 没覆盖） | ✅ **Loop 5** |

**可诚实 claim**：scheduler 状态机 happy + failure 路径都有 e2e 机器证据；Loop 1+2+3 全链路集成验证；Phase A/B/C 三种失败 reason distribution 覆盖
**不能 claim**：真 Claude CLI 流程；cancellation；retry policy；多 agent 并行

## 学到的（Trans-context lessons）

### Lesson A — 跨 Loop 集成会揭示 emergent 行为

Loop 5 charter 显式排除 Phase A，但 Loop 3 + ContextManager mustHave 的 cross-Loop 副作用让 Phase A 在测试里"免费"覆盖了。这种 emergent integration coverage 是 Loop-by-Loop 节奏的天然红利—— charter 边界以内做 minimal slice，charter 边界外的整合会在执行时显现。

**记入 reviewer-cross/LEARNINGS.md（待补）**：cross-Loop emergent coverage 出现时，必须显式归类为 charter 内 / 外 / 边界，不能默默接受。Loop 5 通过 cross-review 显式归类为"合法 emergent"。

### Lesson B — DB schema 允许 NULL 时类型必须反映

cross m2 finding：原版 `as { failed_reason: string }` 隐藏了 schema 实际允许 NULL 的事实。这种"为方便 assertion 而硬断言 non-null"是 trap：
- 测试用例正常时 OK
- 但如果未来某 path 让 failed_reason 是 NULL，类型不会报警，runtime assertion 才发现
- 修：`as { failed_reason: string | null }` + 显式 not-null check（如果是测试断言）或 `?? "fallback"`（如果是处理逻辑）

### Lesson C — 测试 entry point 也要 broader-discoverable

cross m3：`test:e2e-failures` 单独 script，CI / future maintainer 可能只跑老 e2e 漏掉新的。修：加 `test:e2e-all` 串跑入口。这不是新功能，是 discoverability 维护。

## Follow-up（不阻塞 Loop 5 ship）

- **MD7 stage cancellation** — 涉及 stage.status enum 加 'cancelled'（schema-rebuild migration + iOS 兼容评估）。是骨架层，需要单独 anchor gate
- **MD8 explicit boot ordering refactor** — 把 EvaScheduler constructor 副作用 cleanupOrphanStages 改成 explicit `initialize()` 由 backend boot 序列调用
- **MD2 完整 retry policy** — 涉及 schema (attempt_count + parent_task_id) 和 scheduler 状态机扩展。骨架层
- **CI 接入 e2e**：当前 `test:e2e-all` 是 manual entry。考虑加进 GitHub Actions 让 PR 自动跑

## Loop 6 候选（待用户拍板）

按 plan v2 §7 + Loop 5 retrospective：

| Pri | Loop | 类型 | 推荐理由 |
|---|---|---|---|
| 🥇 | MD8 explicit boot ordering refactor | 螺旋 | 纯 refactor，scope 小，cross-review 风险低 |
| 🥈 | MD7 stage cancellation | 骨架 (enum + iOS 兼容) | 用户可见价值高，但 H14 教训表明 iOS minClient bump 高风险 |
| 🥉 | MD2 完整 retry policy | 骨架 (schema 改) | 让 retry/skip 闭环完整 |
| 4️⃣ | CI 接入 e2e | 螺旋 (infra) | 让 e2e 跑进 PR check |

我推荐 **MD8 boot ordering refactor**：纯 refactor，承接 Loop 1 cross m1 + Loop 4 follow-up，scope 极清晰。
