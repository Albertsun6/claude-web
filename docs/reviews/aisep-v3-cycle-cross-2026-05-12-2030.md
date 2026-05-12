# Phase 1 Review — cross-correctness lens
> Reviewer: reviewer-cross  
> Date: 2026-05-12  
> Target: `docs/proposals/aisep-v3-cycle-review-implement-loop.md`

## Summary verdict
**REQUIRES-PHASE-2**

有 2 个 blocker：版本号和 `stageRunId` 语义。现在不能直接进入实现。

## Fact-check results
- `AisepAttempt` 已经支持 `attemptN >= 2`，不需要在 `AisepStageRun` 上新增 `attemptN`。
- `runner.runStage()` 当前每次都会创建新的 `stage_run`，不会复用旧 `stageRunId`。
- `state-machine.ts` 当前严格禁止 `succeeded -> running`。
- `checkM5Cap()` 已存在，但确实没有被 runner 调用。
- v1 fan-out 已收敛为 `0.2.0 -> 0.3.0`，所以 v3 cycle 不能再占用 `0.3.0`。

## Findings
### F1. v3 cycle 版本号与 v1 fan-out 冲突 — BLOCKER
**Issue**: v3 proposal 仍写 `aisep-protocol 0.2.0 -> 0.3.0`，但 v1 fan-out 已明确收敛为 `0.2.0 -> 0.3.0`，且 v3 应改成 `0.3.0 -> 0.4.0`。

**Why it matters**: 两个不同协议变更占同一个 minor version，会让 schema、artifact kind、client compatibility 全部不可追踪。

**Suggested fix**: v3 proposal 全文改为 `0.3.0 -> 0.4.0`，并声明依赖 v1 fan-out 已完成或明确冲突解决顺序。

### F2. `stageRunId` 语义混乱：review verdict、implement retry、M5 counter 混在一起 — BLOCKER
**Issue**: proposal 多处说“retry implement on same stageRunId”，但当前模型里 `AisepReviewVerdict.stageRunId` 指向 review stage_run；implement stage_run 是 review 的上游，不是同一个 id。

当前 schema 只有单 stage：

```95:100:/Users/yongqian/Desktop/Vessel-aisep/packages/aisep-protocol/src/stage.ts
export const AisepStageRunSchema = z.discriminatedUnion("phase", [
  AisepStageRunNoneSchema,
  AisepStageRunBriefSchema,
  AisepStageRunSliceSchema,
]);
export type AisepStageRun = z.infer<typeof AisepStageRunSchema>;
```

**Why it matters**: 如果 M5 计数 keyed on review stageRunId，但 retry 执行 keyed on implement stageRunId，cycle action 必须显式携带两个 id。否则实现时很容易要么重跑错 stage，要么每轮新建 review stage_run 导致 M5 永远不累积。

**Suggested fix**: `AisepCycleAction.retry` 至少区分：
- `sourceReviewStageRunId`
- `targetStageRunId`
- `targetStage: "implement" | "verify"`
- `newAttemptN`

### F3. `retryPendingFor` 是突然出现的新协议字段，未纳入 schema 设计 — MAJOR
**Issue**: 风险表说新增 `retryPendingFor: stageRunId[]`，但 Q1、Migration、schema diff 都没把它正式纳入 `AisepStageRunSchema`。当前 schema `.strict()`，未声明字段会被拒绝。

**Suggested fix**: 要么删除 `retryPendingFor`，改用 `cycle_decision` artifact 作为 pending 状态来源；要么在 Q1/Migration 明确加入 `AisepStageRunSchema`，并说明 backward default。

### F4. `cut_scope` 被同时描述成 action 和 artifact kind，但 artifact enum 只规划了 `cycle_decision` — MAJOR
**Issue**: proposal 写 cap exceeded 时“emit `cut_scope` artifact”，但 Q1 只新增 `cycle_decision` artifact kind。当前 artifact kind enum没有 `cut_scope`。

**Suggested fix**: 统一为 `cycle_decision` artifact，内容里 `action: "cut_scope"`；不要新增单独 `cut_scope` artifact kind，除非明确加 enum。

### F5. `--cycle-cap N` 与 M5 threshold 容易冲突 — MINOR
**Issue**: `checkM5Cap()` 固定 `M5_CAP_THRESHOLD = 2`，proposal 又加 `--cycle-cap N`。如果用户传 `N=3`，会不会违反 M5？

**Suggested fix**: `--cycle-cap` 只能低于或等于 M5 hard cap；M5 仍是不可放宽上限。CLI help 要写清楚。

## Strong points
- `checkM5Cap()` 的纯函数边界是对的，runner 集成方向也合理。
- `request_reverify` 已经是 discriminated union，安全边界比普通 optional field 强。
- v3 cycle 默认 off + Pilot-08 dogfood gate 是合适的发布节奏。

## Open questions
1. v3 是否明确排在 v1 fan-out 之后，并使用 `0.4.0`？
2. cycle 的“逻辑轮次”到底 keyed on review stage_run，还是 target implement stage_run？
3. `retryPendingFor` 是必须的协议字段，还是可以由 `cycle_decision` artifact 推导？
