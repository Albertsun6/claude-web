# Cross Review — AISEP v2 fan-in

**Reviewer**: vessel-cross-reviewer  
**Model**: gpt-5.5-medium (via cursor-agent CLI)  
**Date**: 2026-05-13 17:51  
**Files reviewed**:
- `docs/proposals/aisep-v2-fan-in.md`
- `packages/aisep-core/src/runner.ts`
- `packages/aisep-core/src/scheduler.ts`
- `packages/aisep-core/src/store.ts`
- `packages/aisep-core/src/state-machine.ts`
- `packages/aisep-protocol/src/stage.ts`
- `packages/aisep-protocol/src/artifact.ts`
- `packages/aisep-cli/src/commands/run.ts`
- `packages/aisep-cli/src/report/builder.ts`
- `packages/aisep-cli/src/report/types.ts`
- `docs/adr/ADR-0010-sqlite-fts5.md`

---

## Summary

- Blockers: 3
- Majors: 4
- Minors: 2
- Lens 5 findings: 2
- 总体判断：必须先修；当前 DRAFT 不能提升为 contract/ADR-lite，因为 wire schema、迁移政策、retry 状态机三处核心契约不闭合。

## Numeric Score

| Lens | Score (0..5) |
|---|---|
| 正确性 | 2.0 |
| 跨端对齐 | 2.0 |
| Eva 改造 + Vessel 硬约束 | 3.5 |
| 安全 + 4 类硬触发 | 3.5 |
| 集体盲区检测 | 2.0 |

**Overall**：2.6（存在 BLOCKER，上限 3.9）

## Findings

### B1 [BLOCKER] Schema policy citation is confabulated, so the 0.4.0 bump rationale is not grounded

**Where**: `docs/proposals/aisep-v2-fan-in.md:56`, `docs/proposals/aisep-v2-fan-in.md:71`, `docs/proposals/aisep-v2-fan-in.md:148`, `docs/proposals/aisep-v2-fan-in.md:165`; actual file `docs/adr/ADR-0010-sqlite-fts5.md`  
**Lens**: 5  
**Issue**: The proposal repeatedly cites "ADR-0010 schema migration rules" and a "`MAJOR.MINOR` rule", but the actual `ADR-0010` is about SQLite + FTS5 persistence, not AISEP protocol/schema versioning. `docs/adr/vessel/*0010*` does not exist.  
**Why this is a blocker**: This is contract mode. The schema bump decision is one of the central contract decisions, and it currently rests on a non-existent policy. Shipping the proposal this way would make future implementers argue from a false authority instead of a real compatibility rule.  
**Suggested fix**: Replace all ADR-0010 schema-migration references with the real governing doc if it exists, or add a small ADR-lite section in this proposal that explicitly defines AISEP protocol versioning rules: what counts as patch/minor/breaking, how state.json is migrated, and what old binaries may read.

### B2 [BLOCKER] Required `affects` contradicts the stated v0.3 workspace compatibility

**Where**: `docs/proposals/aisep-v2-fan-in.md:54`, `docs/proposals/aisep-v2-fan-in.md:56`, `docs/proposals/aisep-v2-fan-in.md:71`, `docs/proposals/aisep-v2-fan-in.md:125`, `docs/proposals/aisep-v2-fan-in.md:127`, `packages/aisep-protocol/src/stage.ts:75`  
**Lens**: 1 / 2  
**Issue**: The proposal says every `fanOutRole === "child"` row gets required `affects: string[]`, while also saying existing v0.3 workspaces continue to load and fan-in is opt-in. Existing v0.3 fan-out child rows cannot have `affects`, because `StageRunCommonShape` currently has only `fanOutRole`, `subStages`, and `parentStageRunId`.  
**Why this is a blocker**: If `affects` is required on all child rows, old v0.3 fan-out state becomes invalid even when the user does not invoke fan-in. That directly violates the compatibility claim and the migration path.  
**Suggested fix**: Make the contract more precise. Either require a migration step before any v0.3 state with fan-out children can load under v0.4, or gate `affects` by protocol/state version and only require it for newly-created v0.4 fan-out children. Do not keep both "required on every child" and "v0.3 workspaces continue to load" as-is.

### B3 [BLOCKER] Id-stable retry cannot work with the current terminal state machine

**Where**: `docs/proposals/aisep-v2-fan-in.md:52`, `docs/proposals/aisep-v2-fan-in.md:105`, `docs/proposals/aisep-v2-fan-in.md:107`, `docs/proposals/aisep-v2-fan-in.md:167`, `packages/aisep-core/src/state-machine.ts:9`, `packages/aisep-core/src/store.ts:153`  
**Lens**: 1  
**Issue**: The proposal recommends id-stable retry by flipping `failed → running → succeeded`. The current state machine makes `failed`, `succeeded`, `cancelled`, and `skipped` terminal, and `store.updateStageRunStatus()` enforces that transition.  
**Why this is a blocker**: The proposed retry semantics are impossible under the current invariant unless v2 explicitly changes the state machine. This is not a small implementation detail; it affects audit semantics, report rendering, and any downstream code that assumes terminal really means terminal.  
**Suggested fix**: Pick one contract. Either use a new retry row with `predecessorId` / `retryOfStageRunId`, or formally extend the state model with an attempt-level lifecycle while keeping stage_run terminal status stable. If id-stable retry remains the choice, the proposal must explicitly amend the state-machine invariant and explain how report/audit distinguish original failure from later success.

### M1 [MAJOR] `fan_in` role is named but not specified in the actual enum model

**Where**: `docs/proposals/aisep-v2-fan-in.md:50`, `packages/aisep-protocol/src/stage.ts:72`  
**Lens**: 1 / 2  
**Issue**: Scope says "`fan_in` stage_run role", but the actual role enum is `normal | parent | child`. The rest of the proposal mostly talks through `fanOutRole`, upstream parent `subStages`, and successor child dispatch, without saying whether `fan_in` is a new enum value, a new field, or just a derived behavior.  
**Suggested fix**: Add an explicit v0.4 schema sketch. For example: keep `fanOutRole` unchanged and add `fanInSourceParentId` / `fanInGroupId`, or rename to a neutral `parallelRole`, or define `fanInRole`. The contract should show the exact Zod shape and invariants.

### M2 [MAJOR] Conflict detection source of truth is inconsistent and the current manifest cannot support it

**Where**: `docs/proposals/aisep-v2-fan-in.md:54`, `docs/proposals/aisep-v2-fan-in.md:97`, `packages/aisep-protocol/src/artifact.ts:139`  
**Lens**: 1 / 2  
**Issue**: Scope says conflict detection matches `affects` regex against post-implement on-disk state; Q4 says runner extracts modified-file lists from each child's manifest header. The actual `AisepPatchSetManifestSchema` only stores `subStageId`, `subStageName`, `patchFile`, `contentHash`, and `byteCount`; it has no modified-file list.  
**Suggested fix**: Decide the source of truth. If machine detection is based on actual changed files, add `modifiedFiles: string[]` to child patch metadata or patch_set manifest. If it is based on declared `affects`, say that detection is declaration-overlap detection, not actual file conflict detection.

### M3 [MAJOR] Report contract under-specifies multiple verify children

**Where**: `docs/proposals/aisep-v2-fan-in.md:58`, `docs/proposals/aisep-v2-fan-in.md:180`, `docs/proposals/aisep-v2-fan-in.md:183`, `packages/aisep-cli/src/report/builder.ts:135`, `packages/aisep-cli/src/report/types.ts:52`  
**Lens**: 2  
**Issue**: The proposal wants per-child `verify` fan-in and per-child `contract_grep` tables, but current report builder finds only the first `stage === "verify"` run and reads only `artifactContents["verify.md"]`. That model cannot represent `verify-backend.md`, `verify-frontend.md`, `verify-tests.md` without schema changes.  
**Suggested fix**: Include a report projection change in the contract: collect contract_grep checks from every verify stage_run artifact, key them by `stageRunId` and child name, and update `AisepReportFanOutGroup` or add a fan-in group type.

### M4 [MAJOR] Migration CLI names are promised before the command surface exists

**Where**: `docs/proposals/aisep-v2-fan-in.md:126`, `docs/proposals/aisep-v2-fan-in.md:156`, `docs/proposals/aisep-v2-fan-in.md:157`, `packages/aisep-cli/src/commands/run.ts:226`, `packages/aisep-cli/src/cli.ts:77`  
**Lens**: 1 / 5  
**Issue**: The proposal uses `--accept-schema-bump` and `aisep migrate --to 0.4` in user migration steps, but the CLI currently has no `migrate` command and no schema-bump flag. A proposal can add new CLI, but here the migration utility is simultaneously "deferred" and required in the path for existing v0.3 workspace + fan-in.  
**Suggested fix**: Reclassify migration utility scope. If existing v0.3 + fan-in is supported in v2, `aisep migrate` is in scope. If not, state clearly that v2 only supports fresh v0.4 fan-in workspaces and old v0.3 fan-out workspaces are read-only/no-fan-in until a later migration PR.

### m1 [MINOR] Baseline test count is internally inconsistent

**Where**: `docs/proposals/aisep-v2-fan-in.md:42`, `docs/proposals/aisep-v2-fan-in.md:184`  
**Lens**: 1  
**Issue**: The proposal cites "333 monorepo tests" as current stability evidence, then later sets the dogfood gate at "current baseline (366 tests)".  
**Suggested fix**: Use one verified baseline, or phrase it as ">= baseline at implementation start" to avoid stale numeric gates.

### m2 [MINOR] Emergency bypass is listed as open but should be decided before implementation

**Where**: `docs/proposals/aisep-v2-fan-in.md:203`  
**Lens**: 4  
**Issue**: The conflict detector is terminal-fail-by-design, but the bypass path is deferred as an open issue. For a one-user local tool this is not a security concern, but it is an operability concern: false positives can block the whole fan-in chain.  
**Suggested fix**: Decide before coding: prefer plan.md edit over `--force` for v2, unless the proposal defines a logged `--force-conflict` with clear report.html evidence.

## False-Positive Watch

- F? ADR-0010 may exist in an untracked or not-yet-committed doc outside `docs/adr/`; I only found `docs/adr/ADR-0010-sqlite-fts5.md` and `docs/adr/eva-legacy/ADR-0010-sqlite-fts5.md`. If the author has a private schema ADR, the proposal still needs to cite the committed path.
- F? `affects` may already exist in plan.md parsing, but I did not inspect `parse-plan-parallel.ts` deeply. Even if plan parsing captures `affects`, the blocker remains because `AisepStageRun` and patch_set schema do not yet define how it persists.

## What I Did Not Look At

- Did not run tests or `pnpm audit`; this was a static contract review.
- Did not inspect PR #68 / PR #74 diffs directly; I fact-checked the current branch files instead.
- Did not review Swift/iOS because this proposal appears AISEP CLI/protocol/report scoped, with no Swift consumer today.
