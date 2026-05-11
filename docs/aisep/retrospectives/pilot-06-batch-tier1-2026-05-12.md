# AISEP Pilot-06 — Tier 1 batch (Phase 2.D #3/#4/#5/#6/#7/#11/#12/#13) 闭环

> Workspace: `/tmp/aisep-pilot-06-batch-tier1`
> Date: 2026-05-12
> Mode: `--real`（full 10-stage chain）
> Seed: Pilot-04/05 同 seed.txt（docs-only playbook ship task）
> Memory: 10 条 global-verified（5 Pilot-03 promote + 5 Pilot-04 retro §5 record via Phase 2.D #1 CLI）
> 唯一变量集合：8 项 Phase 2.D backlog 一次性落地（7 项 prompt-only + 1 项 CLI feature）
> Phase 2.D 进度：**完成 9/14** = #1 + #8 + #9 + #3 + #4 + #5 + #6 + #7 + #11 + #12 + #13（11 项，留 #10 #14 schema变更 + #15 待观察 defer）

## Headline

**一次 Pilot 验证 8 项独立 fix 全部生效**。Pilot-06 跑同 seed + 同 memory，
唯一变量是 8 项 prompt + CLI 改动一次性落地。6 个 machine-checkable 验收
信号 + 1 项 CLI feature smoke test 全部通过。

## Outcome

| Stage | Status |
|-------|--------|
| intake → research → plan → architecture → contract → implement → verify → review → integrate → retrospect | 10/10 succeeded |

## 6+1 验收信号（verbatim from Pilot-06 artifacts）

| # | Phase 2.D item | 验收信号 | Pilot-06 实证 |
|---|------|----------|------|
| **#13** | planner cross-stage memory | plan.md §2.5 表格存在，逐条标 addressed? + risk-ref | `\| architecture \| Size budgets without measured ref... \| yes (T1 acceptance requires citation or 'provisional: true') \| — \|` 等 6 行 |
| **#4** | implement manifest header | implement.md 以 `\`\`\`aisep-manifest` 块开头 | 第 1 行 `files: 1 / lines_added: 158 / new_files: [...] / runtime_imports_added: []` |
| **#3** | implement runtime imports check | `runtime_imports_added: []` 字段存在 | docs-only 任务正确为空数组 |
| **#5** | verify outcome classification | JSON 块含 `outcome: build_failed \| tests_failed \| tests_passed \| skipped_no_runtime` | `"outcome": "skipped_no_runtime"` |
| **#11** | implement manifest + verify 比对 | verify.md 有 `manifest matches diff` contract_grep check + 跨参 `read_from_disk` | check #1: `{"name": "manifest matches diff (new_files referenced in diff body)", "ok": true, "read_from_disk": true}` |
| **#6** | size_budget calibration | architecture brief 的 size_budget 含 `provisional: true` 或 `measured-reference:` | ADR-003: `size_budget: { unit: lines, value: 200, provisional: true, measured-reference: null, auto-promote: "on single-digit overshoot (201–209)..." }` |
| **#12** | `aisep verify --recheck` CLI | 命令能跑通，re-run 全部 18 个 contract_grep checks | smoke test on Pilot-06 verify.md: `re-running 18/18 contract_grep check(s) ... done. 0 flip(s). contract_grep.ok=true` |
| **#7** | M4/M5 命名修正 | aisep-protocol/src/attempt.ts JSDoc 引用 `M5` (ping-pong)，非 M4 (contract freeze) | 命中：`Removed attemptN.max(2): the ping-pong cap (M5 — review stage 'revise-required' ≤ 2 rounds, see docs/aisep/02_methodology-v0.1.md L343)` |

## 一次落地 8 项的设计原则

按"prompt-only 杠杆最大"原则（Pilot-05 教训），把可 prompt-only 修复的项目
一次性聚合 commit + 一次 Pilot 验证。**没有触发任何 protocol schema 变更**
（R5 红线守住）。8 项里：

- 7 项 `.hbs` 模板修改（plan / implement / verify / architect 各 1-3 处）
- 1 项 protocol JSDoc 修正（attempt.ts 注释文字，非 schema）
- 1 项 CLI 新命令（verify.ts 新文件 + cli.ts router + 2 个 test）

**为什么能 batch**：每项独立 fix，互不依赖（除 #4 #11 一组配套——manifest
header 是 verify 跨检验的前提）。一次 commit 减少 5+ 次 CI 跑 + 5+ 个 Pilot
验证的开销。

## 不变量复核

- ✓ R3：vessel mainline `feat/eva-M2-loop7-ci-e2e` 无任何 edit
- ✓ R4：M0.5 staging 文件零变更
- ✓ R5：未触及 protocol zod schema（JSDoc 修正不构成 schema 变更）
- ✓ R6：aisep-core 无新代码（runtime 行为不变）
- ✓ R11：memory retrieve 仍强制 `tier="global"`；CLI plan-stage 拼 cross-stage
  hits 时仍只拉 global tier，不混 workspace-pending

## 测试覆盖增量

| Package | 之前 | 现在 | Δ |
|---------|------|------|---|
| aisep-protocol | 59 | 59 | 0 |
| aisep-core | 14 | 14 | 0 |
| aisep-workspace | 6 | 6 | 0 |
| aisep-memory | 9 | 9 | 0 |
| aisep-agents | 14 | 14 | 0 |
| aisep-cli | 5 | **7** | **+2**（verify --recheck full re-run + filter by check-name） |
| **TOTAL** | 107 | **109** | +2 |

dep-cruiser: 170 → 171 modules (+1: verify.ts), 293 → 295 deps (+2: node:child_process + node:util), 0 violations.

## Phase 2.D backlog 状态更新

| # | 任务 | 状态 |
|---|------|------|
| 1 | aisep memory record CLI | ✅ DONE (commit 98d7aa7) |
| 2 | aisep memory record --tier workspace | ✅ DONE（#1 顺带）|
| 3 | implement runtime imports check | ✅ DONE (本 batch) |
| 4 | implement 大 patch manifest header | ✅ DONE (本 batch) |
| 5 | verify outcome classification | ✅ DONE (本 batch) |
| 6 | size_budget calibration policy | ✅ DONE (本 batch) |
| 7 | M4/M5 ping-pong cap 命名修正 | ✅ DONE (本 batch) |
| 8 | architect docs-only refusal | ✅ DONE (Pilot-04 / 05 / 06 三次验证) |
| 9 | verify on-disk re-read | ✅ DONE (commit 445a7d5) |
| 10 | review request_reverify verdict | ⏸ **DEFER** — R5 schema 变更，需 cross-review + ADR-lite |
| 11 | implement manifest + verify cross-check | ✅ DONE (本 batch) |
| 12 | aisep verify --recheck CLI | ✅ DONE (本 batch) |
| 13 | planner memory by applies_to_stage | ✅ DONE (本 batch) |
| 14 | memory.appliesToStages 强制非空 | ⏸ **DEFER** — R5 zod schema 变更 |
| 15 | contract anchor non-determinism | ⏸ **DEFER** — 待 Pilot-06 / 07 多次跑收集证据 |

**完成度**: 11/14 = **79%**（剩 3 项 defer，2 项是 R5 schema 变更要单独走
cross-review 流程，1 项要更多观察数据）

## 非显然发现（≥ 3）

1. **memory hits 提供给 plan stage 时，LLM 不仅照单全收，还会做 plan-level
   reasoning**：Pilot-06 plan §2.5 不只是机械列出 10 条 memory，而是逐条
   判断"this run 是否 address 这条 fix"，并对未 address 的项目主动 raise
   risk-ref。例如 `implement / New runtime import without package.json
   entry / n/a — docs-only, no imports / R4 (residual)` —— plan 自己
   识别"这条 fix 在 docs-only 任务下不适用，但保留为 residual risk"。这是
   AlphaEvolve memory 注入的第二层深度——不只是触发行为改写，还触发**反省
   性的 plan-time 风险评估**。

2. **一次 batch 8 项的 risk 分布**：本 batch 涉及 4 个 `.hbs` 模板 + 1 个
   protocol 注释 + 1 个 CLI 新命令。如果哪一项 Pilot-06 跑出问题，定位会
   困难（哪个 fix 引入的 regression？）。**应对策略**：6 个验收信号设计成
   独立 binary（A 信号通过/失败完全独立于 B 信号），让单 Pilot 输出能精确
   归因到具体 Phase 2.D item。这次每个信号都过了，但**这种 batch 模式只
   适合"每项变更 verifiable + 互不相干"的场景**——schema 变更 / 跨 package
   契约变更绝不能批量做（→ #10 #14 留单做）。

3. **`aisep verify --recheck` 在 healthy verify.md 上 0 flip 是预期但有意义
   的**：smoke test 18/18 ok 没翻转任何一项，证明 CLI 工作正确但本案无需
   它的修复价值。**它的真正价值在故障路径**：当某 contract_grep 假阴性
   stage integrate（如 Pilot-04 cross-references 案例）时，`--recheck`
   提供 30 秒级 fix path，不需要重跑整个 12-min 10-stage chain。这是
   Pilot-04 retro §5 integrate candidate fix 的 v0 实现。

4. **8 项 fix / 1 次 commit / 1 次 12-min Pilot 跑通**，是当前 AISEP
   开发节奏的实测上限。再 batch 大就开始撞 prompt 模板拥挤问题（多个 hard
   limits 互相冲突），或撞 verify report 大小问题（18 个 checks 已经接近
   单 verify.md JSON 块的可读性上限）。下一轮 batch 要么减少项数，要么
   做 cross-cutting 重构（如把 hard limits 抽成共享 partial template）。

## Ship / Drop / Defer

| Item | Decision | Reason |
|------|---------|--------|
| 8 项 batch 改动（4 .hbs + 1 protocol JSDoc + 1 CLI new file + tests）| **Ship** (this commit) | 6+1 信号全过 |
| 本 retro | **Ship** | A/B 证据链 + Phase 2.D 进度统计需要存档 |
| Pilot-06 实际产出的 docs/aisep/05_pilot-playbook.md 内容 | **Defer**（不 cherry-pick） | 内容跟 Pilot-04/05 都有 non-determinism；走 #15 解决 contract anchor 漂移后再统一 ship 一次 |
| #10 review request_reverify | **Defer**（schema 变更）| R5 红线：protocol/zod 改动需要 cross-review + ADR-lite，单独走 |
| #14 appliesToStages.min(1) | **Defer**（schema 变更）| 同 R5 |
| #15 contract anchor non-determinism | **Defer**（待观察）| Pilot-04/05/06 三次跑出三套不同 anchors，证据足够；下一 session 决定 fix 方向 |

## Session 收尾时机判断

本 session 已 ship:
- Phase 2.D #1 + Pilot-04 retro
- Phase 2.D #9 + Pilot-05 retro
- Phase 2.D #3/#4/#5/#6/#7/#11/#12/#13 + Pilot-06 retro

**3 commit / 3 pilot / 11 项 backlog item / 全部信号实证**。
Phase 2.D 完成度从 0/14 → 11/14 = **79%**。剩余 3 项都因合理原因 defer
（2 项 R5 红线 + 1 项待观察）——session 自然收尾。
