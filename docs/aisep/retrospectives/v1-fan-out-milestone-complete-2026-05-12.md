# AISEP v1 fan-out milestone complete — aisep-protocol@0.3.0 release

> Date: 2026-05-12
> Branch: `feat/aisep-bootstrap` (worktree `/Users/yongqian/Desktop/Vessel-aisep`)
> Tag: `aisep-protocol@0.3.0`
> Reference: v1 proposal v2 CONVERGED 13/13 accept (commit `748e4d8`)

## Headline

**AISEP v1 fan-out milestone 完整 ship**：proposal cross-review converge
→ 4-sub-stage staged implementation → Pilot-09 9a happy + 9b mock 双重
验证 → SIGTERM cancel + auto-detect from plan.md。v0.3 wire protocol
冻结 + 实测可用 + R3/R4/R5/R6/R7/R11 全 invariant hold。

## Ship inventory（v1 fan-out 完整 commit 链）

| # | commit | 内容 | LOC |
|---|--------|------|-----|
| 1 | `1e2c7cc` | v3 cycle + v1 fan-out proposals (DRAFT) | +611/0 |
| 2 | `748e4d8` | v1 fan-out cross-review v1→v2 (13/13 accept) | +850/0 |
| 3 | `c1d0e47` | hotfix AISEP_PROTOCOL_VERSION 0.1.0→0.2.0 | +1/-1 |
| 4 | `7bccd29` | **Stage 1**: schema (fanOutRole + .superRefine) + scheduler pure function (aisep-protocol@0.3.0) | +679/-7 |
| 5 | `79a83fd` | **Stage 2.runner**: runFanOutParent + executeStageRunBody helper + 5 integration tests | +352/-17 |
| 6 | `5641dbc` | **Stage 2.cli-A**: scheduler concurrency wire + CLI --parallel/--children/--concurrency flags | +186/-6 |
| 7 | `96085a8` | **Stage 2.cli-B**: subStageName 端到端流转 + plan/implement.hbs fan-out 描述 | +105/-6 |
| 8 | `9b1de7c` | **Pilot-09 Phase 9a happy** retro (端到端活体验证) | +177/0 |
| 9 | `cf64fae` | Pilot-09 9b mock boundary (failOnSubStages + 1-of-3 partial fail test) | +49/-1 |
| 10 | `28fb21f` | **Stage 3.1**: SIGTERM/SIGKILL cancel (workspace + executor + runner AbortController) | +149/-17 |
| 11 | `aaaaaaa`* | **Stage 2.cli-C**: parse plan.md `parallel:` block + auto-detect + 11 parser tests | +369/-10 |

*= this commit

**总计 ~3500 净增 LOC + ~50 测试 + 1 真 Pilot 跑 + Phase 1+2+3 cross-review
完整 audit trail (5 review files + arbitration log)**。

## v0.3 protocol 交付（aisep-protocol@0.3.0）

### Schema additions

```typescript
// stage.ts
export const AisepFanOutRoleSchema = z.enum(["normal", "parent", "child"]);
StageRunCommonShape.fanOutRole = z.enum.default("normal");
StageRunCommonShape.subStages = z.array(OpaqueIdSchema).default([]);
StageRunCommonShape.parentStageRunId = OpaqueIdSchema.optional();
// outer .superRefine enforces parent/child invariants + nested-fan-out reject

// artifact.ts
AisepArtifactKindSchema 加 "patch_set"
AisepPatchSetManifestSchema (≥2 patches, name shell-safe regex)

// workspace.ts
AisepExecOptions.signal?: AbortSignal (Stage 3.1)
```

### Runtime additions

```typescript
// aisep-core/scheduler.ts (pure)
nextReady(parentStageRunId, runs, cap) → SchedulerResult

// aisep-core/runner.ts
StageExecutorArgs.subStageName? + signal?
runner.runFanOutParent({stage, predecessorId?, children, concurrencyCap?})
runner.executeStageRunBody(id, stage, phase, subName?, signal?)  // shared helper

// aisep-core/store.ts
createStageRun({...input, id?})  // pre-mint id support
listChildStageRuns(parentId)

// aisep-cli/parse-plan-parallel.ts (pure)
parsePlanParallel(planMd) → PlanParallelEntry[] | undefined | throw
```

### CLI

```bash
# Manual fan-out (Stage 2.cli-A)
aisep run --real --parallel --children backend,frontend,tests --concurrency 3

# Auto-detect from plan.md `parallel:` block (Stage 2.cli-C)
aisep run --real      # no flags — if plan.md has parallel: block, auto enables fan-out
```

## Pilot-09 Phase 9a 验证（commit `9b1de7c` retro 完整）

- workspace: `/tmp/aisep-pilot-09-fanout-happy`
- seed: 3 独立 docs (v1-guide / v3-guide / overview)
- `--parallel --children v1-guide,v3-guide,overview --concurrency 3`
- 结果: 10/10 stages succeeded (13 stage_runs total: 9 normal + 1 parent + 3 children)
- 3 distinct `implement-<subName>.md` 文件 (93/92/53 lines)
- patch_set manifest 正确聚合 + subStageName 流转 end-to-end ✓

## 不变量复核

- ✓ **R3**: vessel mainline `feat/eva-M2-loop7-ci-e2e` 无任何 edit
- ✓ **R4**: M0.5 staging 文件零变更
- ✓ **R5**: aisep-protocol 0.2→0.3 wire format 改动经 single-pass
  cross-review converge (13/13 accept, commit `748e4d8`)
- ✓ **R6**: scheduler.ts + m5-cap.ts + parse-plan-parallel.ts 全 pure;
  runner injected-only side-effects; dep-cruiser CI rule
  `aisep-pure-fns-no-side-effects` 自动化守护 future regression
- ✓ **R7**: fan-out 是 implement-stage 内部能力扩展, 不引入 self-host /
  AISEP-modifying-AISEP / runner auto-replan loop (plan.hbs §7
  `parallel:` block 是 schema-locked + plan-validator failure terminal
  user-re-run per arbitration A.F2)
- ✓ **R11**: memory retrieve tier-explicit; fan-out children 各自独立
  调 memoryProvider.retrieve, 不污染跨 child memory

## 测试 + dep-cruiser

| Metric | v0.2 baseline | v0.3 ship | Δ |
|--------|---------------|-----------|---|
| Total aisep tests | 109 | **183** | +74 |
| Total modules (dep-cruiser) | 170 | **181** | +11 |
| Total deps | 295 | **310** | +15 |
| dep-cruiser violations | 0 | **0** | 0 |
| aisep-protocol version | 0.2.0 | **0.3.0** | minor |

## Skill 价值实证（3 instance）

cursor-agent + Claude 双 reviewer parallel cross-review 流程在 v1 fan-out
+ v3 cycle + aisep-protocol v0.2 三次都 surface 了 single-Claude lens
错过的 schema-vs-code 事实层 issue（详见各 cross-review arbitration log）。
**reviewer-cross skill design rationale 完整三次实证**。

## v1 完成度评估

| 子项 | 状态 | 备注 |
|------|------|------|
| Schema (fanOutRole + patch_set + AisepPatchSetManifestSchema) | ✅ ship | aisep-protocol@0.3.0 |
| Scheduler pure function | ✅ ship | 11 unit tests |
| Runner runFanOutParent | ✅ ship | 5 integration tests |
| CLI --parallel/--children/--concurrency | ✅ ship | Stage 2.cli-A |
| Agents subStageName 流转 + hbs prompts | ✅ ship | Stage 2.cli-B |
| Auto-detect parallel: from plan.md | ✅ ship | Stage 2.cli-C, 11 parser tests |
| SIGTERM/SIGKILL cancel | ✅ ship | Stage 3.1, AbortController |
| Pilot-09 9a happy (real) | ✅ ship | retro `9b1de7c` |
| Pilot-09 9b boundary (mock) | ✅ ship | failOnSubStages test |
| Stage 3.1 cancel test | ✅ ship | failOnSubStages + serial dispatch case |

## Deferred to future (post-v0.3 milestone)

| 项 | 原因 | 预计触发 |
|---|---|---|
| **Real Pilot-09 9b** (`--real` + force child fail) | LLM stochastic; mock 9b + Stage 3.1 cancel test 已覆盖 cancel 逻辑; force-fail infra 复杂 | 当遇到 real 场景 false-positive 时再投入 |
| **Pilot-09 9c resource profile** (concurrency 1×4 = ~1 hr wall) | quality metric, 非 functional gate | v1.1 spiral / 用户实际遇到资源问题时 |
| **plan.hbs `affects:` non-overlap server-side validator** | parser-level check 已存在 (parse-plan-parallel.ts); verify-stage 自动校验是上一层 automation | Stage 2.cli-D / v1.1 |
| **`aisep verify --recheck` 调用 cycle scheduler** | v3 cycle 尚未实施 | v0.4 cycle milestone |
| **v3 cycle runner integration** (Phase 2.E #2) | v3 proposal v2 REVISED converged (`be75045`) but not impl; depends on v1 land first per arbitration B.OQ1 | next milestone (now eligible — v1=0.3.0 already tagged) |

## Tag command

```bash
git -C /Users/yongqian/Desktop/Vessel-aisep tag aisep-protocol@0.3.0
git -C /Users/yongqian/Desktop/Vessel-aisep tag --list | grep aisep
# 不 push: user 决定 remote push 时机
```

v1 milestone closed. 下次 session 入口: v3 cycle implementation
(aisep-protocol@0.3.0 → 0.4.0, per v3 cycle proposal v2 `be75045` migration plan).
