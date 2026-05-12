# Pilot-10 — Real-business dogfood (MessageItem fold UX) — 2026-05-13

## Goal

After v1 fan-out + Option E HTML report shipped (PR #68 @ 37 commits), validate
that AISEP produces *value* on a **real Vessel frontend bug** (not toy /
mock task). Picked `docs/IMPROVEMENTS.md #14` — `MessageItem.tsx`
`CollapsibleText` UX (no fade gradient, no top-anchored 收起 button, no
a11y wiring). 单文件 React + TS 修改，bounded scope，clear acceptance
criteria — 是经典的 trivial bug dogfood 候选.

## Setup

- Workspace: `/tmp/aisep-pilot-10-msg-fold-ux-2026-05-13/`
- Mode: `--real` (ClaudeExecutor), no `--parallel` (single-file task,
  fan-out 不自然)
- Seed: 3 UI-痛点（gradient / sticky 收起 / aria-expanded+aria-controls）
  + 显式 out-of-scope（不动阈值常量 / 不引入新 dep / 不动 ios-native）
- Pre-seed memory: 5 human-verified records in
  `~/.aisep/governance-log/evolution_log.json` (architecture 2 + verify 1
  + integrate 1 + implement 1 — 全是 Pilot-04/05/06 沉淀)

## Outcome (snapshot)

| Stage | Status | Wall (ms) | Notes |
|---|---|---|---|
| intake | succeeded | 53,941 | 高质量：scope/out-of-scope/acceptance plan/U1-U5 unknowns 全捕捉 |
| research | succeeded | 121,059 | 包含 2026 a11y best practices + token survey |
| plan | succeeded | 49,512 | Mermaid DAG + T1-T6 任务 + acceptance per task + 引用 architecture memory hits |
| architecture (brief) | succeeded | 189,778 | ADR-style decision pick (gradient token / sticky vs absolute / focus restoration) |
| contract | succeeded | 59,963 | grep-able anchors (aria-expanded / aria-controls / useId / size budget) |
| **implement** | **timeout (exit 143)** | **300,341** | **5 min hard timeout @ DEFAULT_TIMEOUT_MS** |
| verify | not reached | — | chain 在 implement failure 后 stop（per runner contract）|
| review | not reached | — | — |
| integrate | not reached | — | — |
| retrospect | not reached | — | — |

5/10 stages 跑通 + 1 stage SIGTERM。`report.html` 生成 (11,567 bytes，
6 stage_runs，0 fan-out，0 contract_grep checks)，visual 正确反映 timeline +
implement 红色失败块。

## What worked (genuinely produced value)

1. **intake.md** 不是模板填空 — 真把 seed 里隐含的 5 个 unknown (U1-U5)
   拆出来，并把"out of scope"显式列了 7 项。这是企业级 SoW 的样态.
2. **plan.md** Mermaid DAG + 每 task acceptance + memory-hit 引用 — 直接
   可读，可当 PR description 草稿.
3. **architecture-brief** 提了 4 个具体 ADR-style decisions (gradient
   token / sticky vs absolute / focus restoration / overflow threshold).
4. **contract.md** 有 grep-able anchors，跟 Phase 2.D #9 verify on-disk
   re-read 设计闭环.
5. **HTML report** 在 implement failed 状态下仍 render —— 5 succeeded +
   1 failed timeline 显色正确，table 显 status-failed + 0 fan-out group.
   Option E 的 evidence-first 价值在失败场景下也成立.

## What blocked (root cause + Phase 2.F implication)

**`packages/aisep-agents/src/claude-executor.ts:78`**:
```
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
```

5 分钟对 mock executor 和 docs-only / 简单 contract 任务够，但对**真业务
implement**（需要 claude --print 读 5 个上游 artifact + render 完整
patch.diff + 自验证）远远不够。Pilot-04 retro §3.1 当时是 hand-off
truncation，跟这次的"模型实际 reasoning 时间不够"是不同的根因，但都暴露
"5 min 是 mock-era 残留默认值"这个共性。

### Phase 2.F backlog 新增项

| # | item | priority |
|---|---|---|
| F1 | 把 `DEFAULT_TIMEOUT_MS` 5 → 10 min（或按 stage 分层：intake/contract 5min；implement 15min；verify/review 10min） | high |
| F2 | CLI 加 `--claude-timeout-ms <ms>` flag（override per-run），同时 `aisep run` HELP 里说明 | high |
| F3 | runner 对 `attempt.status="timeout"` 做 single retry with 1.5× timeout 上限 (类似 cli-runner.ts 的 stale-session retry) | medium |
| F4 | implement.hbs prompt 加 "render patch.diff incrementally; stop after first 3 files if time tight" 软兜底 | low |

## What didn't fail (R3/R4/R11 hold)

- vessel mainline working tree clean（除了原 staging 文件）
- `~/.aisep/governance-log/` 5 条记忆未受影响
- aisep-protocol@0.3.0 未变（pure pilot dogfood）

## Decisions in this retro

1. **不立即 bump default timeout** — F1 是个改动，需要单独 PR + 跨
   review（影响所有 future runs），不能 hot-patch.
2. **不 re-run Pilot-10 用 bumped timeout** — pilot 的核心 finding 就是
   "默认 5min 不够"; hot-bump 后 re-run 是把发现盖掉，不是验证.
3. **Pilot-10 partial run 是有效证据** — `intake.md` / `plan.md` /
   `architecture/brief.md` / `contract.md` 4 份高质量企业级 artifact 已
   足够证明 AISEP 在 stage 1-5 产出真实价值.

## Quantitative

- Pre-Pilot-10 baseline: 25 commits this session (Option E.1 + E.2 +
  USER_MANUAL.md + README AISEP section)
- AISEP test count post-E.2: 196 tests, 0 dep-cruiser violations
- Pilot-10 cost: ~7.5 min wall (54s + 121s + 50s + 190s + 60s + 300s
  timeout) + ~600 lines of artifact output (intake+research+plan+arch+contract)
- Memory growth: 0 new records (chain stopped before retrospect
  promote stage)

## Next actions

1. Open Phase 2.F item F1 + F2 in TodoWrite (timeout default + CLI flag)
2. (optional) Re-run Pilot-10 after F1/F2 ships — 此时是验证 fix，不是
   验证 AISEP 本身
3. Continue v1 / Option E PR #68 review process

## Files

- Workspace: `/tmp/aisep-pilot-10-msg-fold-ux-2026-05-13/`
- Generated report: `/tmp/aisep-pilot-10-msg-fold-ux-2026-05-13/report.html`
  （11,567 bytes, open in browser）
- Run log: `/tmp/aisep-pilot-10-msg-fold-ux-2026-05-13/.run-log.txt`
- State snapshot: `/tmp/aisep-pilot-10-msg-fold-ux-2026-05-13/.aisep/state.json`
- Seed: `/tmp/aisep-pilot-10-msg-fold-ux-2026-05-13/seed.txt`
