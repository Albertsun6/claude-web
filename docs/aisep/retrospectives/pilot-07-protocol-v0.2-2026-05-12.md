# AISEP Pilot-07 — aisep-protocol v0.2 schema migration + chain stability

> Workspace: `/tmp/aisep-pilot-07-v0.2-schema`
> Date: 2026-05-12
> Mode: `--real`（full 10-stage chain）
> Seed: Pilot-04/05/06 同 seed.txt（docs-only playbook task）
> Memory: 10 条 global-verified（continuing AlphaEvolve loop from Pilot-04+）
> 唯一变量：aisep-protocol v0.1 → v0.2 minor bump + 7 项 changes 实施

## Headline

**aisep-protocol v0.2 实施完成 + Pilot-07 验证 chain 在 schema/template 变更后
仍稳定 10/10 stages**。Phase 2.D 14/14 全部 SHIPPED（含 #10 + #14 由本 v0.2
bump 关闭，#15 documented-as-acceptable）。

## Outcome

| Stage | Status |
|-------|--------|
| intake → research → plan → architecture → contract → implement → verify → review → integrate → retrospect | 10/10 succeeded |

## v0.2 实施清单 (7 项 changes)

| # | 内容 | 文件 |
|---|------|------|
| §Change 1 | `AisepReviewVerdictKindSchema` 加 `request_reverify` enum (4-value) | `packages/aisep-protocol/src/review.ts` |
| §Change 2 | `AisepReviewVerdictSchema` 改 `z.discriminatedUnion("verdict", [...])`，checkId regex `/^[A-Za-z0-9_.:-]+$/`，reason `.max(500)` | 同上 |
| §Change 3 | `AisepAppliesToSchema.stage` 加 `.min(1)` | `packages/aisep-protocol/src/memory.ts` |
| §Change 4 | `integrate.hbs` 改 allowlist form (proceed iff verdict ∈ {pass, pass_with_comments}) + `request_reverify` 编码 in `blockers[0].id="recheckable:<checkId>"` | `packages/aisep-agents/templates/integrate.hbs` |
| §Change 5a | aisep-memory 写路径加 `AisepMemoryRecordSchema.parse()` (recordPending / recordGlobal / promote 三处) | `packages/aisep-memory/src/store.ts` |
| §Change 5b | `loadFile` 二叉 — `loadFileSafe`（inspector，fail-open-empty）+ `loadFileStrict`（mutator，throw）| 同上 |
| §Change 5c | 一次性 migration script (`migrate-v0.2-min1.mjs`) — pre-flight 扫描 empty-stage records + abort if found | `packages/aisep-memory/scripts/` |
| §Change 6 | methodology doc 更新 L138 三类→四类、L146 underscore form、L343 M5 widening | `docs/aisep/02_methodology-v0.1.md` |
| §Change 6b carve-out | aisep-core M5 enforcement 实际**未实现** — 注释更新指向 Phase 2.E baseline + v3 cycle | `packages/aisep-protocol/src/attempt.ts` + `packages/aisep-core/src/store.ts:200` |
| version bump | aisep-protocol package.json 0.0.1 → 0.2.0 | `packages/aisep-protocol/package.json` |

## 测试增量

| Package | 之前 | 现在 | Δ |
|---------|------|------|---|
| aisep-protocol | 59 | **72** | **+13** (v0.2-schema.test.ts: 4-value enum / discriminated union 6 cases / .min(1) 3 cases) |
| aisep-memory | 9 | **11** | **+2** (recordPending/recordGlobal reject empty stage) |
| aisep-core | 14 | 14 | 0 |
| aisep-workspace | 6 | 6 | 0 |
| aisep-agents | 14 | 14 | 0 |
| aisep-cli | 7 | 7 | 0 |
| **TOTAL** | 109 | **124** | **+15** |

dep-cruiser: 171 → 173 modules (+2: v0.2-schema test + migrate script), 295 → 296 deps (+1), 0 violations.

## Pilot-07 4-signal acceptance（5a happy path + 5c schema enforcement subset）

| # | 检查 | 结果 |
|---|------|------|
| review verdict 在 4-value enum | review.md `"verdict": "pass_with_comments"` | ✓ schema 接受 |
| integrate allowlist form 生效 | integrate.md `ready_to_integrate: false` + human summary verbatim "in the allowlist" | ✓ §Change 4 prompt 生效 |
| plan §2.5 cross-stage memory 表 | 出现 6 行 memory entries 标 addressed?/risk-ref | ✓ Phase 2.D #13 持续 |
| memory 注入持续生效 | architect brief 第一句话仍 memory-aware | ✓ AlphaEvolve loop 持续 |

**注意**：reviewer 没自然 emit `request_reverify` — 这正是 review.hbs 新 prompt
设计的。contract_grep failures 是真实 content gaps（§"When to halt the chain"
bullet count、retro citations 缺日期），不是 hand-off truncation 派生的 false
positive。reviewer 正确判别 + 走 pass_with_comments + suggested_patches 路径。

## 5b carve-out 记录（M5 boundary acceptance test 没跑）

Phase 5b "two consecutive `request_reverify` must trigger M5 cut-scope" 在本
session **未验证** —— aisep-core M5 enforcement 代码本就不存在（grep 显示零
hit per cross-review post-arbitration discovery）。proposal §6b 明确标 carve-out
到 Phase 2.E baseline + v3 cycle。

**为什么 carve-out 可接受**：
1. v0 chain 是线性 single-pass，没有 review→implement loop 机制 — 用户重跑
   `aisep run --stages review` 也是新 stageRunId，counter 重置
2. M5 enforcement 是 runtime 行为，schema 层（本 v0.2 范围）只承诺"用 4-value
   enum + 强制 payload"。runtime counter 是单独工程任务
3. proposal §Risks RISK-M5 文档化了 carve-out — 不是隐藏问题

## 实施过程亮点

1. **migration pre-flight 验证 `.min(1)` 零数据破坏**：`node migrate-v0.2-min1.mjs`
   扫 10/10 global records 全部 non-empty + 零 workspace pending file → ✓ 安全
   tightening。Cross-review B.F5 + A.F5 的 audit gap 完整闭合。
2. **zod default lenient 行为成为 v0.2 schema 的 free-bonus**：discriminated
   union 默认 strip extra fields（不 reject），所以
   `{verdict:"pass", requestReverify:{...}}` 实际被 strip 成 `{verdict:"pass"}`，
   TS narrowing 让 consumer 无法访问 stripped 字段。Test `strips requestReverify
   from non-reverify variants (zod default lenient)` 验证此行为。
3. **dep-cruiser 一次过**：172 → 173 modules + 295 → 296 deps，0 violations
   — schema 重构没新加 import 跨包，干净 minor bump。

## 不变量复核

- ✓ R3：vessel mainline `feat/eva-M2-loop7-ci-e2e` 无任何 edit
- ✓ R4：M0.5 staging 文件零变更
- ✓ R5：本次 protocol 变更**已**走 ADR-lite + cross-review (commit `c57498b`)
- ✓ R6：aisep-core 无新 fs/spawn 代码（只改 store.ts 注释）
- ✓ R11：memory retrieve 强制 `tier="global"`；新写路径 parse 强化 R11 trust
  boundary（.min(1) 拒绝 silent-global-pollution 风险）

## Phase 2.D 最终状态

**14/14 dispositioned**：

| # | 任务 | 状态 |
|---|------|------|
| 1 | aisep memory record CLI | ✅ SHIPPED commit 98d7aa7 |
| 2 | --tier workspace CLI | ✅ SHIPPED (#1 顺带) |
| 3 | implement runtime imports check | ✅ SHIPPED commit e40b944 |
| 4 | implement 大 patch manifest header | ✅ SHIPPED commit e40b944 |
| 5 | verify outcome classification | ✅ SHIPPED commit e40b944 |
| 6 | size_budget calibration policy | ✅ SHIPPED commit e40b944 |
| 7 | M4/M5 ping-pong cap 命名修正 | ✅ SHIPPED commit e40b944 |
| 8 | architect docs-only refusal | ✅ SHIPPED + 验证 commit f97250f |
| 9 | verify on-disk re-read | ✅ SHIPPED commit 445a7d5 |
| 10 | review request_reverify verdict | ✅ SHIPPED this commit (aisep-protocol@0.2.0) |
| 11 | implement manifest + verify 比对 | ✅ SHIPPED commit e40b944 |
| 12 | aisep verify --recheck CLI | ✅ SHIPPED commit e40b944 |
| 13 | planner memory by applies_to_stage | ✅ SHIPPED commit e40b944 |
| 14 | memory.appliesToStages 强制非空 | ✅ SHIPPED this commit (aisep-protocol@0.2.0) |
| 15 | contract anchor non-determinism | ✅ DOCUMENTED-AS-ACCEPTABLE commit 0cb5081 |

**完成度 100%**（11 ship + 1 wontfix + 2 cross-review-converged-then-ship）。

## 后续 backlog

新出现 (Phase 2.E)：

1. **Phase 2.E #1**：aisep-core 实施 M5 ping-pong cap enforcement（baseline
   first，然后 widen counter set）— attempt.ts JSDoc 承诺存在但 v0 没实现，
   需要 runner cross-attempt verdict counter + store helper
   `countReviewVerdictsByStageRun()`
2. **Phase 2.E #2**：v3 cycle 实施 — `review→implement` 回环机制（当前 chain
   是 single-pass，无回环），让 M5 counter 有 enforcement 触发场景
3. **memory 候选记录** (per arbitration log §"Risk noted for future
   cross-reviews"): "Proposal §Migration claims 'existing code does X, no
   change needed' but X 实际不成立" — 应该入库 review stage memory，强化
   future cross-review 流程

## 非显然发现（≥ 3）

1. **zod discriminated union 默认 strip 而非 reject**——这跟 superRefine 行为
   不同。如果 schema 用 superRefine 强制 biconditional，
   `{verdict:"pass", requestReverify:{...}}` 会 reject；而 discriminated union
   只是 strip。这意味着 schema 层 enforcement 比 cross-review proposal 预期
   稍弱 — 但 TS narrowing 让 consumer 无法误用 stripped 字段，所以**实际安全
   等价**。test `strips requestReverify from non-reverify variants` 显式 lock
   in 这个行为，避免未来 maintainer 误以为该 reject。

2. **integrate LLM 自动用 prompt 里的关键词**——Pilot-07 integrate.md human
   summary verbatim 写 "review came back `pass_with_comments` (in the
   allowlist)"。说明 §Change 4 prompt "Allowlist gate" 表述被 LLM 内化为
   action-level 概念，不只是 prompt 装饰。**强 prompt 词汇 → 强 model output
   词汇 → 强可观察行为**——是个可量化的 prompt-engineering 杠杆指标。

3. **migration pre-flight idempotent 的实际价值**——本次跑 0 violations，但
   保留这个 script 在 repo 里是有意义的：future v0.3 / v1 引入更多 zod
   tightening 时，同一 idempotent script 模式可复用（grep `appliesTo.stage` →
   widen 到任何 `.min(N)` 约束，可参数化）。这是 §Change 5c 的隐性长期价值：
   建立了"schema 紧化必须 pre-flight 数据迁移"这一惯例的第一个 instance。

4. **aisep-core M5 enforcement 缺失 surface 时机晚**——一直到 cross-review
   Phase 2 cursor-agent fact-check 才发现（attempt.ts JSDoc 是 aspirational
   lie）。说明"docstring 描述运行时行为"是个 audit-blind-spot 类风险，
   docstring 应该有自动化验证（"该行为是否有对应 test"）。这一类 finding 是
   Phase 2.D 的隐性教训，应该作为 v3+ 阶段考虑的 invariant 之一。
