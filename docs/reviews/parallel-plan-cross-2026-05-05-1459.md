# Cross Review — parallel-plan-cross-prompt

**Reviewer**: reviewer-cross
**Model**: gpt-5.5
**Date**: 2026-05-05 14:59
**Files reviewed**:
- `/tmp/parallel-plan-cross-prompt.md`

---

## Summary

- Blockers: 0
- Majors: 5
- Minors: 3
- 总体判断：建议小改后合并

## Numeric Score（Round 1 contract #2 cross M3 修正：与 ReviewVerdict DTO 对齐）

| Lens | Score (0..5) |
|---|---|
| 正确性 | 3.5 |
| 跨端对齐 | 3.0 |
| 不可逆 | 3.2 |
| 安全 | 3.0 |
| 简化 | 3.0 |

**Overall score**：3.1

跨端对齐覆盖范围：本 artifact 不是代码/DTO/schema proposal，TS Zod ↔ Swift Codable ↔ SQLite 三端契约基本 N/A；但 Stage 0 引入 `/api/board` JSON + `board.html` 消费端，因此我低权重检查了 board endpoint 的前后端 contract 清晰度。

## Findings

### M1 [MAJOR] Stage 0 board may become permanent infrastructure without a disposal/versioning boundary

**Where**: `/tmp/parallel-plan-cross-prompt.md:400`, `/tmp/parallel-plan-cross-prompt.md:410`, `/tmp/parallel-plan-cross-prompt.md:435`, `/tmp/parallel-plan-cross-prompt.md:456`
**Lens**: 不可逆 / 简化
**Issue**: Plan says the experiment should not create a standing human-driven parallel workflow, but Stage 0 adds a backend route, public HTML page, git/PR/DB aggregation, and recommends putting it in the backend origin before the experiment starts.
**Why this is a major**: Even if `board.html` is disposable, `/api/board` creates an implementation-shaped contract that later M2 harness UI may inherit by accident. The plan itself worries about this in the author challenge (`/tmp/parallel-plan-cross-prompt.md:517`), but does not set a deprecation, versioning, or deletion rule. That makes a one-time measurement tool drift into product infrastructure.
**Suggested fix**: Mark `/api/board` as explicitly experimental, e.g. `/api/experiments/parallel-board` or gated behind a dev-only flag, and add an exit criterion after retrospective: keep with M2 contract redesign, or delete route/page in the cleanup PR. Also state that its JSON shape is not a stable harness UI contract.

### M2 [MAJOR] Success criteria are not falsifiable enough

**Where**: `/tmp/parallel-plan-cross-prompt.md:394`, `/tmp/parallel-plan-cross-prompt.md:396`, `/tmp/parallel-plan-cross-prompt.md:398`, `/tmp/parallel-plan-cross-prompt.md:519`
**Lens**: 正确性 / 不可逆
**Issue**: “Retrospective 写出来 + 至少 1 条 M2 必须自动化 X 强信号” can be satisfied almost regardless of outcome, while “撞墙反而是好事” makes both smooth and painful runs interpretable as useful.
**Why this is a major**: A methodology experiment needs a way to say “this failed / inconclusive”. Without that, the retrospective can justify either “go M2” or “try again” post hoc, which weakens the plan as decision input.
**Suggested fix**: Add explicit pass/fail/inconclusive thresholds before running. For example: pass = at least one observed coordination failure with timestamped evidence; inconclusive = both PRs independent and no shared-file/port/context conflict; fail = setup/board cost exceeds implementation time or blocks Track work. Require the retrospective to classify the run into one of those outcomes.

### M3 [MAJOR] Track independence risk is acknowledged but not converted into a control plan

**Where**: `/tmp/parallel-plan-cross-prompt.md:374`, `/tmp/parallel-plan-cross-prompt.md:375`, `/tmp/parallel-plan-cross-prompt.md:474`, `/tmp/parallel-plan-cross-prompt.md:475`, `/tmp/parallel-plan-cross-prompt.md:518`
**Lens**: 正确性 / 简化
**Issue**: Track 1 and Track 2 both touch `scheduler.ts`, and both appear coupled through prompt/profile config, but the execution plan only says to register locks and proceed.
**Why this is a major**: This can confound the experiment. If the tracks collide, it may prove only that this specific split was poorly chosen, not that human-driven parallelism has the listed systemic risks. If they avoid collision by informal coordination, the plan may under-measure the exact dependency drift it wants to study.
**Suggested fix**: Predeclare shared files and ownership rules before Stage 2: which track owns which functions/sections, what requires handoff, and what counts as “collision evidence”. Keep the collision observable, but avoid ambiguous “both changed scheduler” failures.

### M4 [MAJOR] Board endpoint exposes sensitive local operational metadata

**Where**: `/tmp/parallel-plan-cross-prompt.md:408`, `/tmp/parallel-plan-cross-prompt.md:411`, `/tmp/parallel-plan-cross-prompt.md:414`, `/tmp/parallel-plan-cross-prompt.md:415`, `/tmp/parallel-plan-cross-prompt.md:416`, `/tmp/parallel-plan-cross-prompt.md:417`, `/tmp/parallel-plan-cross-prompt.md:447`
**Lens**: 安全
**Issue**: `/api/board` aggregates worktree paths, branches, dirty status, PR/CI data, lock entries, recent commits, and DB stats. The plan only says the board is read-only; it does not define access control, redaction, or dev-only exposure.
**Why this is a major**: Read-only is still sensitive. Worktree paths, branch names, commit subjects, PR metadata, and DB counts can leak project structure and active work. Since the route is placed on the existing backend, it inherits whatever exposure that backend currently has.
**Suggested fix**: Require the same auth as other protected backend APIs, add a dev/experiment feature flag, redact absolute paths where possible, and avoid returning commit messages unless needed for the experiment.

### M5 [MAJOR] Cleanup step risks deleting the evidence needed for the retrospective

**Where**: `/tmp/parallel-plan-cross-prompt.md:379`, `/tmp/parallel-plan-cross-prompt.md:384`, `/tmp/parallel-plan-cross-prompt.md:501`, `/tmp/parallel-plan-cross-prompt.md:507`
**Lens**: 不可逆 / 安全
**Issue**: The plan says the most important output is the retrospective and mentions backend/DATA_DIR records, but final cleanup removes the temporary worktree and DATA_DIR. It does not require archiving logs, board snapshots, DB stats, terminal command history, or lock history first.
**Why this is a major**: The experiment’s value is evidence. Deleting `~/.claude-web-track2/` before extracting artifacts can turn the retrospective into memory-based notes, exactly the failure mode this plan is trying to avoid.
**Suggested fix**: Insert an evidence-freeze step before cleanup: export board snapshots, copy relevant logs/DB stats, record exact branch/PR/commit IDs, and only then remove the worktree/DATA_DIR. Make cleanup conditional on retrospective completion.

### m1 [MINOR] Port allocation is inconsistent around `3031`

**Where**: `/tmp/parallel-plan-cross-prompt.md:323`, `/tmp/parallel-plan-cross-prompt.md:481`, `/tmp/parallel-plan-cross-prompt.md:487`, `/tmp/parallel-plan-cross-prompt.md:495`
**Lens**: 正确性
**Issue**: The plan says ports `3030/3031/3032` are filled and verification requires all three alive, but the execution path explicitly assigns `3032` to Track 2 and leaves `3031` unexplained.
**Suggested fix**: Define what owns `3031`, or change verification to only the ports actually used by this experiment.

### m2 [MINOR] `/api/board` JSON contract is underspecified for its own consumer

**Where**: `/tmp/parallel-plan-cross-prompt.md:411`, `/tmp/parallel-plan-cross-prompt.md:420`, `/tmp/parallel-plan-cross-prompt.md:422`, `/tmp/parallel-plan-cross-prompt.md:423`
**Lens**: 跨端对齐
**Issue**: Although full cross-end DTO review is mostly N/A, this plan creates a backend JSON endpoint and a frontend HTML consumer. The fields are listed conceptually, but status enums, error shape, timestamps, and partial-failure behavior are not defined.
**Suggested fix**: Add a minimal response contract: top-level `generatedAt`, per-section `status: ok|warn|error|unknown`, `items`, and `errorMessage`. This keeps the vanilla page simple while preventing ad hoc shape drift.

### m3 [MINOR] “Do not extend to 3 tracks” conflicts slightly with board scope probing three backend ports

**Where**: `/tmp/parallel-plan-cross-prompt.md:390`, `/tmp/parallel-plan-cross-prompt.md:413`, `/tmp/parallel-plan-cross-prompt.md:481`
**Lens**: 简化
**Issue**: The experiment caps at 2 tracks, but the board probes three ports and verification requires three ports alive. That may pull the implementation toward a generalized multi-track cockpit rather than a two-track experiment aid.
**Suggested fix**: Either explain that `3031` is an existing baseline service, or reduce Stage 0 to the exact experiment topology: main backend plus Track 2 backend.

## False-Positive Watch

- F? M4 security severity may be lower if all backend routes are already strongly authenticated and only reachable over a trusted private network; author should confirm the intended exposure model for `/api/board`.
- F? M1 may be acceptable if the team already treats all Stage 0 code as disposable experiment code, but that disposal rule is not stated in the artifact.
- F? M3 may be intentionally designed to force a collision; if so, the plan should label it as an intentional stressor and define how to record it.

## What I Did Not Look At

- Did not read author transcript, sibling verdict, author counter, or prior tool history.
- Did not inspect repository files, migrations, implementation code, branch state, or existing auth behavior.
- Did not validate whether `packages/backend/public/board.html` is currently served by the backend.
- Did not check actual `WORKTREE_LOCK.md`, scheduler code, fallback config schema, or ContextManager plan beyond what is quoted in `/tmp/parallel-plan-cross-prompt.md`.
- Did not run commands or modify files.
