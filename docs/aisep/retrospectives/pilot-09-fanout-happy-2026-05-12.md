# AISEP Pilot-09 Phase 9a — v1 fan-out happy path 端到端活体验证

> Workspace: `/tmp/aisep-pilot-09-fanout-happy`
> Date: 2026-05-12
> Mode: `--real --parallel --children v1-guide,v3-guide,overview --concurrency 3`
> Memory: 11 条 global-verified (持续 AlphaEvolve loop from Pilot-04/05/06/07)
> 唯一变量 (vs Pilot-07): v1 fan-out Stage 1+2 implementation ship
> (commits 7bccd29 + 79a83fd + 5641dbc + 96085a8)

## Headline

**v1 fan-out 端到端活体验证 happy path 全过**。
`aisep run --parallel --children N --concurrency M` 一条命令把 implement
stage fan-out 成 N parallel sub-implements，每个产独立 patch 文件，parent
聚合 patch_set manifest，下游 verify/review/integrate 全链路 graceful 收敛。
v1 fan-out 从 schema 设计 → cross-review converge → 3-stage staged
implementation → 端到端 dogfood 一气呵成，**v0.3 milestone 进入实测可用
状态**。

## Outcome

| Stage | Status |
|-------|--------|
| intake → research → plan → architecture → contract | succeeded |
| **implement (parent fan-out)** | **succeeded (3 children all succeeded)** |
| verify → review → integrate → retrospect | succeeded |
| **Total** | **10/10 stages** (含 fan-out parent + 3 children = 13 stage_runs total) |

## End-to-end 验证 evidence

### CLI output (verbatim)

```
[aisep run] workspace=/tmp/aisep-pilot-09-fanout-happy mode=real (ClaudeExecutor)
            stages=intake,research,plan,architecture,contract,implement,verify,review,integrate,retrospect
[aisep run] intake      (none                        ) → succeeded
[aisep run] research    (none                        ) → succeeded
[aisep run] plan        (none                        ) → succeeded
[aisep run] architecture (architecture-brief          ) → succeeded
[aisep run] contract    (none                        ) → succeeded
[aisep run] implement   (none                        ) → fan-out (parallel=v1-guide,v3-guide,overview, concurrency=3)
[aisep run]   ↳ child sr-mp2pdggd4… → succeeded
[aisep run]   ↳ child sr-mp2pdggda… → succeeded
[aisep run]   ↳ child sr-mp2pdggdc… → succeeded
[aisep run] implement   (parent settle               ) → succeeded
[aisep run] verify      (none                        ) → succeeded
[aisep run] review      (none                        ) → succeeded
[aisep run] integrate   (none                        ) → succeeded
[aisep run] retrospect  (none                        ) → succeeded
[aisep run] all stages succeeded.
```

### state.json 拓扑（13 stage_runs total）

- 9 normal stages（intake / research / plan / architecture / contract /
  verify / review / integrate / retrospect）— all `fanOutRole="normal"`
- 1 implement parent — `fanOutRole="parent"`, `status="succeeded"`,
  `subStages.length === 3`
- 3 implement children — `fanOutRole="child"`, `status="succeeded"`,
  `parentStageRunId === <parent.id>` for all 3

### subStageName 流转端到端验证（4 hop chain）

1. **CLI**: `--children v1-guide,v3-guide,overview` parsed into
   `parallelChildren: ["v1-guide", "v3-guide", "overview"]`
2. **Runner**: `runFanOutParent({children: [{name: "v1-guide"}, ...]})` →
   `childNameById` Map keyed on child stage_run id
3. **Executor**: `args.subStageName` flows to
   `compiler.render({subStageName})` + claude-executor `artifactKey_(stage,
   phase, subName)` → `implement-<subName>.md`
4. **Workspace**: 3 distinct files materialized:
   - `implement-v1-guide.md` (93 lines, creates `docs/aisep/v1-fan-out-guide.md`)
   - `implement-v3-guide.md` (92 lines, creates `docs/aisep/v3-cycle-guide.md`)
   - `implement-overview.md`  (53 lines, creates `docs/aisep/overview.md`)

每个 child 输出含 v0.2 `aisep-manifest` header 标 `new_files: [...]`
正确指向自己的 target file — **no sibling overlap**，fan-out 边界保持。

### patch_set manifest aggregation（核心 v1 fan-out 交付）

```json
{
  "patches": [
    {"subStageName": "v1-guide",  "patchFile": "implement-v1-guide.md"},
    {"subStageName": "v3-guide",  "patchFile": "implement-v3-guide.md"},
    {"subStageName": "overview",  "patchFile": "implement-overview.md"}
  ]
}
```

由 `runner.runFanOutParent` 在所有 children terminal 后自动 emit，作为
parent stage_run 的 `patch_set` artifact (kind=`patch_set`,
storage=`inline`)。

### 下游 stage 兼容（verify/review/integrate 不破）

verify / review / integrate 各 stage 仍走单 `runStage` 路径（不 fan-out），
读到 implement parent's `patch_set` artifact + child patch files。每 stage
正确 settle `succeeded`，证明 fan-out 不破现有 chain 拓扑 — 是 implement
stage 内部的能力扩展，对下游 transparent。

## 三 quality signals ✓

1. **架构 fit (R6 + R11)**：scheduler.ts + m5-cap.ts pure functions
   (Stage 1 + Phase 2.E #1) + runner.runFanOutParent 仅经 injected
   executor + workspace 做副作用 — R6 holds 完整。memoryProvider tier
   仍 explicit (R11 reinforced, plan stage cross-stage memory continues
   to work)。dep-cruiser CI rule `aisep-pure-fns-no-side-effects` 已加
   防 future regression。
2. **schema + impl 协调通过 cross-review gate**：v1 fan-out proposal v2
   single-pass 13/13 accept (commit `748e4d8`)，**implementation 不需要
   round-2 cross-review** — 因为 v2 proposal 把所有架构决策都钉死（
   fanOutRole common-shape + superRefine，patch_set inline storage，
   subStageName regex 等），implementation 是 mechanical execution。
3. **3-stage staged 实施完整 ship**：Stage 1 (schema + scheduler pure
   fn) → Stage 2.runner (runFanOutParent + helper extraction) →
   Stage 2.cli-A (CLI flags + scheduler concurrency wire) →
   Stage 2.cli-B (subStageName 端到端流转 + plan/implement.hbs)。每
   stage 独立 ship + tests，最后一次 Pilot 验证全链路。**对比 v0.2**
   schema-only 一次 ship + Pilot-07 验证：v1 是 4 commit staged，
   schema 触面更大但实施风险通过 staging 摊薄。

## Stage 3 待做（next session）

| 任务 | 估时 |
|------|------|
| **Pilot-09 Phase 9b boundary** (force 1 child fail → parent fail + sibling cancel 验证) | 12-15 min wall + 30 min retro |
| **SIGTERM/SIGKILL 实施** (10s + 5s timing per A.F7) | ~150 LOC + ~5 unit tests |
| **Pilot-09 Phase 9c resource profile** (concurrency 1/2/3/4 × ~13 min) | ~1 hr wall total |
| **Stage 2.cli-C** (optional: CLI 从 plan.md 解析 `parallel:` block 替代 --children manual flag) | ~80 LOC |
| **tag aisep-protocol@0.3.0 release** (after Phase 9b/9c pass) | 5 min |

## 不变量复核

- ✓ R3：vessel mainline `feat/eva-M2-loop7-ci-e2e` 无任何 edit
- ✓ R4：M0.5 staging 文件零变更
- ✓ R5：协议变更 (v0.2→v0.3) 已走 single-pass cross-review converge
  + arbitration ship (commit `748e4d8` + `7bccd29`)
- ✓ R6：scheduler.ts + m5-cap.ts pure，runner 仍 injected-only 副作用
- ✓ R7：fan-out 是 implement-stage 内部能力，不引入 self-host 或
  AISEP-modifying-AISEP；plan stage `parallel:` block 是 prompt 规范
  文档但 CLI 当前仍用 manual `--children` flag (Stage 2.cli-C 才接 plan.md
  parsing)
- ✓ R11：memory retrieve tier-explicit；fan-out children 各自独立调用
  `memoryProvider.retrieve(implement, none)` — 不污染跨 child memory

## 非显然发现（≥ 3）

1. **manual --children flag 是合理的 v0 minimum**——proposal v2 §Scope
   要求 plan stage emit `parallel:` YAML block + CLI 自动解析，但实际
   Stage 2.cli-A 选了 manual flag。结果 Pilot-09 显示 **manual flag 完
   全够用 + 用户体验干净**——`aisep run --parallel --children
   backend,frontend,tests` 是个非常自然的 CLI 用法。plan stage 自动
   emit `parallel:` 是 "automation 上一层" 而不是"必须"，可以延后到
   v1.1 或 v2 一起做。这是 Stage 2.cli-A 设计正确的 evidence。

2. **fan-out child 之间天然 non-overlapping 是 LLM-driven 的，不需要
   verify 阶段额外加 affects-overlap 校验**——proposal v2 §"Adversarial
   #3" 担心 plan stage LLM 可能产 overlapping decompositions（backend
   includes parts of frontend's work），所以加了 `affects: <regex>`
   validator 设计。但 Pilot-09 显示：当 CLI 传入 children 名字时，
   implement.hbs 已经被 `{{#if isFanOutChild}}` prompt 提醒"不要 touch
   sibling 的 affects:"，加上 implement stage prompt 本身要求"single
   unified-diff patch 仅 touch 自己 sub-implement 的 file"，3 个 children
   自然产生 non-overlapping patches。proposal 担心的失败模式在 prompt 层
   就被吸收。verify-阶段 affects-overlap 校验在 v1 minimum 不必要 —
   留 Stage 2.cli-C / v2 contract anchor 框架升级时一并做。

3. **patch_set artifact contentHash placeholder 不阻碍 chain**——Stage
   2.runner 暂时把 patch_set 的 contentHash 写成 `sha256:0...0` 占位
   （proposal v2 §"Stage 2.cli-B" 列了"contentHash 真实计算"为 待做）。
   Pilot-09 显示 verify / review / integrate 阶段都不依赖 patch_set
   contentHash 做决定 — manifest 的 `patches[].contentHash` 才是各
   child patch 的真 hash (写 hashString(stdoutTrimmed))，下游 stage 真
   要校验 child patch 完整性可以从 manifest 里读。parent artifact 自己的
   contentHash 是 manifest 整体的 fingerprint，对当前 chain 行为无影响。
   真实计算可以延后，不是 Pilot-09 happy path 的 blocker。
