Backlog: 0 in_progress · 3 planned · 4 blocked。这个文件是 Phase 2 react-review 提示，内容已经把 Reviewer A、自己的 Phase 1 verdict 和 artifact 都内联了，我会按它要求直接产出 verdict markdown。# Phase 2 React — Cross lens
> Reviewer: vessel-cross-reviewer · Date: 2026-05-13 · Phase 2 (cross-pollinate)

## React to Reviewer A's findings

### A.BLOCKER-1 — agree
**Quote**: ADR-0010 不存在，schema 迁移策略实际是 ADR-006。  
**My verdict**: agree  
**Reasoning**: 与我的 B1 完全收敛。A 进一步指出 ADR-006 的 “breaking change 仅跨 major” 与提案里的 0.4.0 论据冲突，这比我 Phase 1 的 “citation confabulated” 更精确。应按 A 的 supersede-light 方案修。

### A.BLOCKER-2 — refine
**Quote**: `superRefine` 的 implement-only 限制必须被显式拆除。  
**My verdict**: refine  
**Reasoning**: 同意这是 blocker，但我会把修法收紧：不能把 `integrate` 放进 fan-out 白名单。`integrate` 是聚合终点，不应该成为 fan-out parent。  
**Concrete edit**: 新增 §Q1b，明确 `FAN_OUT_ALLOWED_STAGES = {"implement", "verify", "review"}`；`integrate` 只能作为 normal aggregation stage，不能 `fanOutRole="parent"`。

### A.MAJOR-1 — agree
**Quote**: Q5 retry-child 语义 vs F3 timeout retry 的“一致性”论据反了。  
**My verdict**: agree  
**Reasoning**: 与我的 B3 部分重叠。A 对 F3 实现的事实核查更准确：F3 是 transparent retry，retry-child 是用户显式 forensic retry。提案必须删除 “consistent with F3” 论据。

### A.MAJOR-2 — agree
**Quote**: v1 预留的 `predecessorIds[]` 路径被静默放弃。  
**My verdict**: agree  
**Reasoning**: 我 Phase 1 漏了这个。schema 注释和 v1 proposal 已经给未来实现者留下预期，如果 v2 改走 `subStages` 镜像，必须显式 revoke，否则实现阶段很容易误加字段。

### A.MAJOR-3 — refine
**Quote**: R1 retry races with parent settling 的 mitigation 太单薄。  
**My verdict**: refine  
**Reasoning**: 同意 in-process mutex 不够；但建议不要在 proposal 阶段承诺 `.aisep/.lock` 的完整跨进程锁设计，除非当前 AISEP 已有 workspace lock pattern。  
**Concrete edit**: R1 先改成 “retry-child 只允许 parent terminal 且无 active child run”；另加 R7 “cross-process retry race”，把具体锁机制列为 implementation decision，但 dogfood gate 必须覆盖双进程 fail-fast。

### A.MAJOR-4 — agree
**Quote**: 出口条件缺 v0.3 ↔ v0.4 cross-version round-trip 硬门禁。  
**My verdict**: agree  
**Reasoning**: 这是我的 B2/B4 兼容性担忧的机器验证版本。既然 proposal 声称 v0.3 workspaces continue to load，就必须把双向 round-trip 放进 dogfood gate，而不是只放在 test matrix 草稿里。

### A.minor-1 — agree
**Quote**: Context 省略了 `patch_set` artifact kind 的 schema 改动。  
**My verdict**: agree  
**Reasoning**: 与我的 M2 相关。proposal 需要说清楚 conflict/status 信息是否进入 patch_set manifest。若 v2 不改 manifest，也必须明确 per-child status 来自 stage_run，而不是 manifest。

### A.minor-2 — agree
**Quote**: “any new required field is a MAJOR.MINOR bump” 是空气引文。  
**My verdict**: agree  
**Reasoning**: 与 B1 同源。不能引用仓库里不存在的原文，应复述 ADR-006 的真实条款，或者在 ADR-lite 中定义 v0.x 阶段的例外规则。

### A.minor-3 — agree
**Quote**: report.html size budget 850 cells 算式可能低估/虚高。  
**My verdict**: agree  
**Reasoning**: 这是非阻塞文案修正。R6 仍然成立，但估算式应按实际 fan-out stages 计算，避免 reviewer 误判风险等级。

## Self-correction of my own Phase 1 verdict

### B1 (ADR confabulation): stand
A 完全确认该问题，并补强为 ADR-006 supersede 问题。

### B2 (required affects ↔ v0.3 compat): stand
A.MAJOR-4 和 A.BLOCKER-1 都支持这个兼容性风险。若 required `affects` 保留，就必须有明确 migration / round-trip gate。

### B3 (id-stable retry ↔ terminal state machine): stand
A.MAJOR-1 支持 “当前论据错误”；A.MAJOR-3 支持 retry 状态机风险。仍应作为 blocker，除非 proposal 明确改 state-machine invariant。

### M1 (`fan_in` role unspecified): stand
A 没直接覆盖。仍需把 `fan_in` 说明为 derived behavior，或定义新 enum/field；不能只在 prose 里命名。

### M2 (conflict detection source of truth): stand
A.minor-1 间接支持。manifest / `affects` / actual modified files 三者必须定一个 source of truth。

### M3 (report contract under-specifies multiple verify children): stand
A 只提 report size，没有覆盖 report projection/schema。该 finding 仍成立。

### M4 (migration CLI names promised before command surface exists): stand
A.MAJOR-4 支持 migration gate 缺口。`aisep migrate` 不能既 deferred 又作为用户路径前提。

### m1 (baseline test count inconsistent): stand
A 没覆盖。仍是小问题。

### m2 (emergency bypass open issue): stand
A 没覆盖。仍建议 v2 开工前决定 plan.md edit vs logged force flag。

## New findings revealed by reading A

### NEW-1 [MAJOR] `predecessorIds[]` revocation must be explicit
A.MAJOR-2 成立。v2 若采用 `subStages` 镜像，应在 proposal 和 `stage.ts` 注释中明确撤回 v1/v0 注释里的 `predecessorIds[]` 计划。

### NEW-2 [MAJOR] fan-out stage whitelist is a schema contract, not an implementation detail
A.BLOCKER-2 成立并应收紧：白名单建议只含 `implement`, `verify`, `review`；`integrate` 不应进入 fan-out parent 白名单。

## Convergence assessment

Reviewer A 与我的 Phase 1 有高度收敛：A 的 2 个 blocker、4 个 major、3 个 minor 中，我 agree 7 条、refine 2 条、disagree 0 条。

真正分歧不在方向，而在修法颗粒度：我建议把 `integrate` 排除出 fan-out 白名单，并把跨进程锁从具体 `.aisep/.lock` 承诺降为 implementation decision + dogfood gate。总体结论仍是：proposal 方向可接受，但必须先修 schema citation、stage whitelist、retry semantics、migration/round-trip gate 后才能进入 implement gate。
