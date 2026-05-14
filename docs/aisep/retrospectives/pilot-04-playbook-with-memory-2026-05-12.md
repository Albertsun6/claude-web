# AISEP Pilot-04 — AlphaEvolve memory injection 活体演示

> Workspace: `/tmp/aisep-pilot-04-playbook-with-memory`
> Date: 2026-05-12
> Mode: `--real`（full 10-stage chain）
> Templates: v0.2（Phase 2.C-7 全 stage-specific 模板已就位）
> Memory wiring: commit `2192b8a` — `AisepMemoryStore.retrieve()` → `MemoryProvider` → `runner.runStage()` → `compilePromptFor()` `memoryHits`
> Seed task: **与 Pilot-03 完全相同** — ship `docs/aisep/05_pilot-playbook.md`，docs-only ≤ 200 lines
> 唯一变量：`~/.aisep/governance-log/evolution_log.json` 预置 5 条 human-verified 记忆（包含 Pilot-03 retro 提取的 5 条 fix）

## Headline

**AlphaEvolve 自学习闭环首次活体演示成功**。同样的 seed，Pilot-03 因 architect 把 docs-only 任务过度工程化为 TS schema + lint + 11 unit tests 而 `review=revise_required` / `ready_to_integrate=false` / 0 artifact 合入；Pilot-04 在 memory 注入后，architect **第一句话**就是 `Task type: docs-only (only deliverable extension = .md). No TS/JSON/YAML schema, no lint tool, no test code.`，最终 implement 产出 80 行干净 markdown patch，review 给到 `pass_with_comments`。

## Outcome

| Stage | Duration | Status |
|-------|----------|--------|
| intake | 109s | ✓ |
| research | 58s | ✓ |
| plan | 52s | ✓ |
| architecture | 112s (phase=architecture-brief) | ✓ |
| contract | 58s | ✓ |
| implement | 101s | ✓ |
| verify | 29s | ✓ (correctly fails `contract_grep:cross-references`) |
| review | 36s | ✓ verdict = **`pass_with_comments`** |
| integrate | 16s | ✓ **`ready_to_integrate: false`**（B1+B2） |
| retrospect | 48s | ✓（claude self-written） |
| **Total** | **~12 min** | 10/10 stages succeeded |

## Pilot-03 vs Pilot-04 A/B 比对

| 维度 | Pilot-03（无 memory） | Pilot-04（注入 5 条 memory） |
|------|---------------------|---------------------------|
| Architect 首句 | "the playbook ships a TypeScript-first contract..." | `Task type: docs-only ... No TS/JSON/YAML schema, no lint tool, no test code.` |
| Q1（data model）回答 | 引入 zod schema + 11 个 entities | `Conceptual entities only ... Not shipped as code. Task is docs-only; constraints enforced by verify-stage greps and wc -l, not by a runtime schema.` |
| Contract.md 性质 | TypeScript schema + zod (14 KB) | 7 条 prose contracts（markdown 描述 + grep 规则） |
| implement.md | 385 lines，含 zod TS schema + 残缺 package.json | **84 lines 干净 unified diff，单一 markdown 文件 80 行** |
| Verify 结果 | build/lint/tests 全 fail | build/lint/security 全 pass，仅 1 个 `contract_grep` fail |
| Review verdict | `revise_required` (3 critical + 2 major + 1 minor) | `pass_with_comments` (2 minor — 都是 handoff truncation 派生) |
| Integrate | `ready_to_integrate=false`（架构错误） | `ready_to_integrate=false`（hand-off bug，cheap to resolve） |
| 失败距离 ship 多远 | 需要重写架构 + 重做 implement | 1 行命令 + 1 个 stage re-issue |

## 内存注入证据链（端到端可验证）

### 1. Memory retrieve 阶段（CLI 层）

[packages/aisep-cli/src/commands/run.ts](packages/aisep-cli/src/commands/run.ts) 装配：

```typescript
const memory = new AisepMemoryStore(cwd);
const memoryProvider: MemoryProvider = {
  async retrieve(stage) {
    return memory.retrieve({ stage, tier: "global", limit: 5 });
  },
};
```

**R11 红线落地**：retrieve 强制 `tier="global"`（只读人工 verified 层），永远不会把 workspace-pending 噪音注入 prompt。

### 2. PromptCompiler 注入（aisep-agents 层）

`task-architecture-1778518766801.md` 的 `## Memory hits` 节实际内容（verbatim from disk）：

```
- **Size budgets set in ADRs without a measured reference implementation are
  breached by single-digit deltas and force unnecessary ADR escalations.**
  → When authoring a size_budget in an ADR, require either (a) a citation to
  a measured reference file of similar shape, or (b) an explicit
  `provisional: true` flag that auto-revisits the budget after the first
  implementation. Single-digit overshoots on a provisional budget auto-
  promote to the measured value (no re-ADR). (shipCount: 0)
- **Architect over-engineers docs-only deliverable into TS schema + lint
  tooling + unit tests; integrate gate correctly refuses to ship but seed
  task delivers nothing.** → When intake.scope.deliverables contains ONLY
  .md files (no .ts / .json / .yaml / .sql / .py), architect MUST NOT
  introduce non-markdown artifacts. Mark task_type=`docs-only` in
  intake.yaml; architect template adds a 'is task docs-only?' check before
  producing C4 / ADRs. If architect believes the task warrants supporting
  code, escalate to user via question fence rather than silently expand
  scope. (shipCount: 0)
```

### 3. Architect 行为 ✓ 受影响（brief.md verbatim）

```
**Task type:** `docs-only` (only deliverable extension = `.md`).
No TS/JSON/YAML schema, no lint tool, no test code.
All artifacts in this brief are markdown; any structural constraint
travels as prose + a grep rule in the verify log, not as a checked-in
schema file.
```

7-question gate Q1 显式回应：

```
| Q1 | Data model — zod-expressible entities? |
Conceptual entities only: Frontmatter{...}, Section{...}, CaseStudy{...},
HaltSignal{...}, CLIModeRef{...}. **Not shipped as code.** Task is docs-
only; constraints enforced by verify-stage greps and `wc -l`, not by a
runtime schema. |
```

ADR-01 size_budget 也直接采纳了 size-budget memory 的语言：

```
provisional: true per memory rule — no measured reference for a playbook
of this exact shape exists. Single-digit overshoot in T7 auto-promotes
to measured value without re-ADR; ≥ 10-line overshoot routes back to
ADR-01 revision.
```

**architect 显式 cite 了 memory rule 名（"per memory rule"）**——这是行为受影响的最强证据，不是 coincidence。

### 4. 下游传染

- contract.md 紧跟 architect 的 "prose contracts" 决定，没有产出 TS schema 文件
- implement.md 单一 unified diff 创建 `docs/aisep/05_pilot-playbook.md`（80 行 markdown），无附加文件
- verify.md `size_budget.ok=true`（`wc -l = 80 <= 200`）+ build/lint/security `ok=true` + 7/8 `contract_grep` pass

## 残留 gap：cross-references contract_grep 在 hand-off 截断下假阴性

verify 报告 `contract_grep` 中 1 项失败：

```
{
  "name": "cross-references section present and non-empty",
  "command": "awk '/^## Cross-references$/{f=1; next} /^## /{f=0} f && NF' patch.diff | grep -q .",
  "ok": false
}
```

但 review 给出 `pass_with_comments` 而非 `fail`，因为 review 诊断这是 hand-off 截断（patch 在传递给 verify 时截到 `./04_pilot-02-re…` 中间），不是真正的内容缺失——review **没有独立物理文件可查**。integrate 严格执行 hard limit（任何 verify check fail 就 block），输出 `ready_to_integrate=false` + 2 个 blocker（B1: contract_grep；B2: 无法独立确认 on-disk file）。

这是 self-emitted retrospective 中的 §3.1 / §5 第一条 memory candidate：

```
stage=verify
pattern: contract_grep runs against the hand-off payload, not the on-disk
  file; large patches truncated mid-section produce false-negative
  section-anchor failures
fix: Before running any contract_grep check, re-read the target path
  from disk. Run the awk/grep against the on-disk bytes. Only emit
  ok=false if the on-disk file fails the check.
```

**讽刺点**：Pilot-02 retro F-3 已经写过同一模式（"每个 check 是可确定性重跑的命令"），但它没被 promote 到 architecture stage 之外的 stages。这正是 self-emitted retrospective §4.3 的 non-obvious finding：**memory 记的 failure mode 必须有"指向应修复 stage"的索引**，否则就成了民间传说。

## 三大质量信号 ✓

1. **Architect 行为可被 memory 改写** — 同 seed，仅 memory 变化，行为从 over-engineering 翻转到 docs-only。这是 AlphaEvolve 设计目标的核心声明，今天首次实测验证。
2. **AISEP gate 在 review 宽容时仍守住门** — review 给 `pass_with_comments`，integrate 不为所动，按 verify `ok=false` 拒绝合入。证明**机器 check 比软评审更靠谱**这个设计假设成立。
3. **Self-emitted retrospect 可直接转 memory candidate** — retrospect.md §5 列出 5 条结构化 (stage, pattern, fix) 候选，格式与 `AisepMemoryStore.recordPending` 一致；下一轮可以直接通过 `aisep memory record` 入库（Phase 2.D backlog #1/#2）。

## 不变量复核（R3 / R4 / R6 / R11）

- ✓ R3：vessel mainline `feat/eva-M2-loop7-ci-e2e` 无任何 edit（worktree 物理隔离）
- ✓ R4：M0.5 staging 文件零变更
- ✓ R6：aisep-core 全程无 fs/spawn 直接调用，所有副作用走 `AisepWorkspace.exec/writeFile`
- ✓ R11：memory retrieve 强制 `tier="global"`，workspace-pending 噪音永不进 prompt

## Phase 2.D backlog（基于本 pilot 更新）

旧的 8 条 + 本次新增：

| # | 来源 | 任务 | 优先级 |
|---|------|------|--------|
| 1 | Pilot-03 retro | `aisep memory record --tier global --verified-by human` CLI | **High** |
| 2 | Pilot-03 retro | `aisep memory record --tier workspace` CLI | Med |
| 3 | Pilot-03 retro | implement 阶段 npm install --dry-run 前置 dependency check | Med |
| 4 | Pilot-03 retro | implement 大 patch 加 manifest header | Med |
| 5 | Pilot-03 retro | verify 阶段 outcome 分类（build_failed / tests_failed / tests_passed） | Med |
| 6 | Pilot-03 retro | size_budget calibration policy（provisional + measured） | Low |
| 7 | Pilot-03 retro | M4 ping-pong cap 命名澄清 | Low |
| 8 | Pilot-03 retro | architect docs-only 拒绝 ✓ **Pilot-04 已实测有效** | DONE |
| **9** | Pilot-04 retro §5 | **verify 阶段 contract_grep 必须 re-read on-disk file** | **Highest**（B1/B2 根因） |
| **10** | Pilot-04 retro §5 | review 增加 `request_reverify` verdict + `check_id`/`reason` | High |
| **11** | Pilot-04 retro §5 | implement 产 path+sha256 manifest，verify 比对 disk | Med |
| **12** | Pilot-04 retro §5 | `aisep verify --recheck <check_id>` 快速路径 | Low |
| **13** | Pilot-04 retro §5 | planner 按 `applies_to_stage` 索引 memory，把未修复 entry 注入 plan 输出 | Med |
| **14** | 本次发现 | memory schema 增加 `appliesToStages[]`（已是 zod `AisepMemoryRecord` 字段）+ promote 时强制非空 | Med |

## Ship / Drop / Defer

| Item | Decision | Reason |
|------|---------|--------|
| Pilot-04 retro 本文档 | **Ship**（本 commit） | A/B 证据链需要存档 |
| `~/.aisep/governance-log/evolution_log.json` 5 条 memory 提升到 shipCount=1 | **Defer** | 等 Phase 2.D #1 `memory record` CLI 落地后批量 promote |
| `docs/aisep/05_pilot-playbook.md`（80 行 playbook 内容） | **Defer**（暂不 cherry-pick） | 内容对，但路径触发 R3 worktree 隔离讨论；先把 verify on-disk re-read 修了再考虑 |
| Phase 2.D #9（verify re-read on-disk）独立 commit | **Ship next** | 最高杠杆，解 B1/B2 + Pilot-02 F-3 同根 |
| Pilot-05 候选：跑 #9 patch 后重做 docs-only seed | **Defer** | 等 #9 落地 |

## 非显然发现（≥ 3）

1. **memory 注入的"显隐效"在 architect 出口处差别最大**。Architect 是整链最容易过度发挥的 stage（research/plan 输出还偏保守，coder 受 contract 强约束），所以"修 architect"这种 memory 杠杆最高。Pilot-04 的 architect 第一句话就直接复述 memory 的 fix 语言（`No TS/JSON/YAML schema, no lint tool, no test code.`），下游 contract/implement 自然就被 architecture brief 约束住了——**memory 改 architect，等于 memory 改了整条 chain**。这暗示后续 reference-library 投资应该集中在 architecture stage 的 anti-patterns。

2. **AISEP self-emitted retrospect 本身就是结构化 memory 候选源**。Pilot-04 的 retrospect.md §5 直接列出 5 条 `(stage, pattern, fix)` 三元组，格式与 `AisepMemoryRecord` 完全对齐。这暗示 retrospect stage template 可以再强化输出 schema（要求 §5 出 JSON 块而非 markdown），下一轮 `aisep memory record --from-retrospect` 一键入库。

3. **soft review verdict 在 hard verify gate 之上是反模式**。Pilot-04 review 给 `pass_with_comments` 试图"宽容地放行"，但 integrate 严格遵守 hard limit 拒绝合入——最终结果是"大家都知道有问题，但谁都不能 unblock"。这是 retrospect §4.1 的 non-obvious finding；解药是 review 增加 `request_reverify`（Phase 2.D #10），让 review 在怀疑 verify false-positive 时有路径触发 re-verify，而不是降级到软 verdict。

4. **AlphaEvolve 的价值在 architecture brief 出口处 measurable**。Pilot-03 → Pilot-04 唯一变量是 memory 非空。架构 brief 第一句话从"the playbook ships a TypeScript-first contract"翻转到"Task type: docs-only ... No TS/JSON/YAML schema, no lint tool, no test code." ——可量化、可回放、可比对。这给后续设置 self-host 双轨阈值提供了 baseline：候选 graph 的 architect 出口如果在 docs-only seed 上恢复 over-engineering 行为，立刻可被检测到。
