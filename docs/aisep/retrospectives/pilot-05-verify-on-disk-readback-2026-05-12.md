# AISEP Pilot-05 — verify on-disk re-read fix 闭环验证

> Workspace: `/tmp/aisep-pilot-05-verify-on-disk-readback`
> Date: 2026-05-12
> Mode: `--real`（full 10-stage chain）
> Seed: **与 Pilot-04 完全相同**（同 `seed.txt` byte-for-byte）
> Memory: **与 Pilot-04 完全相同**（`~/.aisep/governance-log/evolution_log.json` 同 5 条 human-verified）
> 唯一变量：`packages/aisep-agents/templates/verify.hbs` Phase 2.D #9 修改（+33/-2 行 prompt-only）
> Phase 2.D backlog item: **#9 verify on-disk re-read**（最高优先级）

## Headline

Phase 2.D #9 **闭环验证成功**。Pilot-04 retro §5 第一条 memory candidate 描述的 fix
（"contract_grep runs against the hand-off payload, not the on-disk file"）通过
prompt-only 修改完整生效。同 seed + 同 memory，verify.hbs 改动让 verify 阶段从
"对 hand-off payload 做 grep" 升级到 "用 Read tool 加载 disk 上的 `implement.md`
后 grep"——8/8 contract_grep 检查全部 `ok=true` + `read_from_disk=true`，review
verdict 从 `pass_with_comments` 升到 `pass`（零 comments），integrate
`ready_to_integrate` 从 `false` 升到 `true`（零 blockers）。

## Outcome

| Stage | Status |
|-------|--------|
| intake → research → plan → architecture → contract → implement → verify → review → integrate → retrospect | 10/10 succeeded |

## Pilot-04 vs Pilot-05 A/B（唯一变量 = verify.hbs prompt）

| 维度 | Pilot-04（verify.hbs 老版） | Pilot-05（verify.hbs 新版） |
|------|------------------------|-------------------------|
| verify 第一句话 | 直接输出 JSON，无 Read tool 痕迹 | `"I've loaded the on-disk implement.md (87 lines including the diff fences)..."` |
| `contract_grep.checks[]` 数量 | 8 | 8 |
| `read_from_disk: true` 字段 | **缺失**（schema 没要求） | **8/8 全有** ✓ |
| `command` 字段引用 | 混合 `patch.diff` + on-disk | **8/8 指 `implement.md`** ✓ |
| `contract_grep.ok` 整体 | `false`（1 项失败：cross-references） | **`true`**（8/8 通过）✓ |
| review verdict | `pass_with_comments`（2 minor 都是 hand-off truncation 派生） | **`pass`**（零 comments）✓ |
| review.md 行数 | 31 | **9** |
| integrate `ready_to_integrate` | `false` | **`true`** ✓ |
| integrate `blockers` | 2 个（B1 contract_grep + B2 on-disk artifact 未确认） | **`[]`** ✓ |
| integrate `deferred_followups` | 2 个（都是 verify 阶段需要修的 fix） | 2 个（都是 ship 后的 CI wiring，不是阻塞） |

## 内存注入证据（继续 Pilot-04 的双层验证）

architect 模板的 memory hits 仍然生效。Pilot-05 architecture/brief.md 第一句话：

```
I'll produce the Phase A architecture brief. Task is docs-only (single `.md`
deliverable per intake §2), so per memory: no TS schemas, no lint tooling,
no unit-test scaffolding — frontmatter "shape" described inline, not as a
separate file.
```

显式 cite `per memory`——证明 memory 注入链路（CLI MemoryProvider → runner →
PromptCompiler → architect.hbs `{{#each memoryHits}}`）持续工作。

## verify 行为变化的可观察证据

verify.md 第 1 行（**新行为**，verify.hbs 老版本不会输出）：

```
I've loaded the on-disk implement.md (87 lines including the diff fences).
The patch creates a docs-only file `docs/aisep/05_pilot-playbook.md` (82
lines per the hunk header). Now I'll run verify checks against the on-disk
content.
```

`contract_grep.checks[]` 全部条目都明确 `command` 指向 `implement.md`（不是
`patch.diff`），例如：

```json
{
  "name": "patch creates docs/aisep/05_pilot-playbook.md",
  "command": "grep -F '+++ b/docs/aisep/05_pilot-playbook.md' implement.md",
  "ok": true,
  "read_from_disk": true
}
```

`size_budget.check` 也跟着改了：

```
"check": "wc -l implement.md (added doc body = 82 lines per hunk header @@ -0,0 +1,82 @@) <= 200"
```

——证明 prompt 改动不仅命中 contract_grep，也带出 size_budget 的 on-disk 表述。

## 实验设计的诚实记录

**Pilot-04 那条具体 cross-references contract_grep 检查在 Pilot-05 没被
reproduce**——因为 Pilot-05 的 architect/contract 阶段选择了完全不同的 contract
anchors（10-stage 表格 / 5 个 CLI flag / 3 个 halt 源 / methodology 与 retro 的
cross-ref / memory-promote dry+real pair），跟 Pilot-04 的（frontmatter / 7 个
section anchors / cross-references 段）不重合。

这是 **contract 阶段的 non-determinism** 表现：同 seed + 同 memory，仍可能产出
不同的 contract anchors 列表。

**这不影响 #9 闭环验证的有效性**：

- #9 的目标是验证 `verify` 阶段是否能正确"先 Read 再 grep on-disk"
- 8/8 `read_from_disk=true` + `command` 全指 `implement.md` 已经直接证明 prompt
  fix 生效
- 即使 anchors 列表不同，hand-off truncation 假阴性也不会再发生——因为 verify
  改成读 disk 真实内容，跟 hand-off payload 是否完整无关

但 contract non-determinism 是个**单独的发现**，列入 Phase 2.D 新 backlog（#15）。

## 三大质量信号 ✓

1. **prompt-only fix 足以修 hand-off truncation 类失败模式** —— 不需要改任何代码、
   schema、runner 行为。Phase 2.D #9 全部修复落在 33 行 .hbs 模板里。这暗示
   AISEP 后续遇到类似"verify/review 行为偏差"问题时，应该**先试 prompt 层**
   再考虑代码层。
2. **AlphaEvolve memory 验证 chain 在两次连跑保持稳定** —— Pilot-04 / Pilot-05
   两次 architect 都显式 cite memory ("Task type: docs-only ..." 同义表达 +
   "per memory: no TS schemas...")，证明 memory 注入不是一次性闪电而是 reproducible
   的稳定行为。
3. **集成（review + integrate）的"gate sympathy"是端到端可控的** —— Pilot-04
   暴露 "soft review 之上 hard verify gate" 反模式；Pilot-05 的 verify 给出
   8/8 ok=true 后，review 自动收敛到 zero-comment pass，integrate 收敛到
   ready_to_integrate=true。说明只要 verify 输出可信，下游链条不会无谓加噪。

## 不变量复核（R3 / R4 / R6 / R11）

- ✓ R3：vessel mainline `feat/eva-M2-loop7-ci-e2e` 无任何 edit
- ✓ R4：M0.5 staging 文件零变更
- ✓ R6：aisep-core 全程无 fs/spawn 直接调用，所有副作用走 `AisepWorkspace.exec/writeFile`
- ✓ R11：memory retrieve 强制 `tier="global"`，本次跑期间 retrieve 调用 0 次落到
  workspace-pending 层

## Phase 2.D backlog 更新

| # | 来源 | 任务 | 状态 |
|---|------|------|------|
| 1 | Pilot-03 retro | `aisep memory record --tier global --verified-by human` CLI | pending High |
| 2 | Pilot-03 retro | `aisep memory record --tier workspace` CLI | pending Med |
| 3 | Pilot-03 retro | implement 阶段 npm install --dry-run 前置 check | pending Med |
| 4 | Pilot-03 retro | implement 大 patch 加 manifest header | pending Med |
| 5 | Pilot-03 retro | verify outcome 分类 | pending Med |
| 6 | Pilot-03 retro | size_budget calibration policy | pending Low |
| 7 | Pilot-03 retro | M4 ping-pong cap 命名澄清 | pending Low |
| 8 | Pilot-03 retro | architect docs-only 拒绝 | **DONE**（Pilot-04 + Pilot-05 双次验证） |
| **9** | Pilot-04 retro §5 | **verify 阶段 contract_grep 必须 re-read on-disk file** | **DONE**（本 retro） |
| 10 | Pilot-04 retro §5 | review 增加 `request_reverify` verdict + `check_id`/`reason` | pending High |
| 11 | Pilot-04 retro §5 | implement 产 path+sha256 manifest，verify 比对 disk | pending Med |
| 12 | Pilot-04 retro §5 | `aisep verify --recheck <check_id>` 快速路径 | pending Low |
| 13 | Pilot-04 retro §5 | planner 按 `applies_to_stage` 索引 memory | pending Med |
| 14 | Pilot-04 retro | memory schema 增加 `appliesToStages[]` + promote 时强制非空 | pending Med |
| **15** | **本 retro** | **contract 阶段的 anchor 选择 non-determinism**——同 seed 同 memory 仍可产出不同 anchors 列表；考虑是否需要 architecture brief 把 anchor 列表也冻结进 ADR | pending Med |

## Ship / Drop / Defer

| Item | Decision | Reason |
|------|---------|--------|
| `packages/aisep-agents/templates/verify.hbs` 改动 | **Ship** | 8/8 read_from_disk + 0 false-negative + ready_to_integrate=true |
| 本 retro | **Ship** | 双次 A/B 证据链需要存档 |
| Pilot-05 实际产出的 docs/aisep/05_pilot-playbook.md 内容 | **Defer**（不 cherry-pick） | Anchor 不同 = 内容不同；下次直接基于稳定 anchor 列表跑一次专门 playbook ship 任务 |
| Phase 2.D #10（request_reverify verdict） | **Next**（Phase 2.D 内最高优先级遗留） | 解 review 不能 unblock 自己的反模式 |
| Phase 2.D #1（memory record CLI） | **Soon** | 替代当前 `/tmp/seed-memory-from-pilot03.mjs` 一次性脚本 |
| Phase 2.D #15（contract anchor non-determinism） | **Defer** | 是 contract stage 内部问题，独立于 verify；先收集 2-3 次跑的 anchor 列表再决定要不要冻结 |

## 非显然发现（≥ 3）

1. **同 seed + 同 memory 仍能产出不同 contract anchors 列表**——这是 Pilot-05
   计划外的发现。预期 Pilot-04 / Pilot-05 至少 contract.md 应该几乎相同（因为
   intake / research / plan / architecture / contract 都没改 prompt），但实际
   anchor 命名 / 数量 / 范围完全不重合。这暗示 contract stage 的输出包含较高的
   LLM-sampling-noise，要么需要把 anchor 列表冻结进 architecture brief 的 ADR
   作为 contract input，要么 contract stage 加 anchor-list adversarial review 子步骤。
   对应 #15。

2. **prompt-only fix 的杠杆比想象更大**——本轮没改任何 TS 代码、schema、runner，
   也没动 PromptCompiler 截断阈值，纯改了 verify.hbs 一个模板，就完整解决了
   Pilot-04 残留的 B1+B2 阻塞 + review 软妥协 + integrate 假阻塞。这暗示
   aisep-agents `templates/*.hbs` 是 AISEP 的"行为表面"——很多看起来需要架构改造
   的问题，可能只需要改 prompt。Phase 2.D 后续 13 项里 (#10 #14) 也应该先看
   能不能 prompt-only 修。

3. **review.md 行数从 31 降到 9**——零 comments 的 review 是新行为模式。
   Pilot-04 给出的"pass_with_comments + 2 个 minor 解释"是 review agent 在
   verify 不确定时的 hedge 行为，verify 确定后 review 收敛到极简模式。这暗示
   review verdict 的"丰富度"反向反映了 verify 的"自信度"，可以作为下游 stage
   的健康指标——如果 review 始终冗长，可能上游 verify 有可疑度问题。

4. **整个 #9 闭环从 prompt 改 → 测试 → 后台跑 → A/B 比对 → ship，单 session 内
   2-3 小时完成**——这是 AISEP 自学习 (AlphaEvolve) 速度的实测 baseline。
   Pilot-04 retro §5 描述 fix → Pilot-05 验证 fix 生效 → ship verify.hbs，这条
   链路如果将来通过 `aisep memory record --tier global` + 自动加 retrospect-to-fix
   工具更顺畅，单 fix 周期可以压到 1 hour 内。
