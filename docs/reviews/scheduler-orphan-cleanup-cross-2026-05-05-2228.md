# Cross Review — Scheduler Orphan Stage Cleanup On Init

**Reviewer**: reviewer-cross
**Model**: GPT-5.5
**Date**: 2026-05-05 22:28
**Files reviewed**:
- `packages/backend/src/scheduler.ts`
- `packages/backend/src/test-scheduler-orphan-cleanup.ts`
- `packages/backend/package.json`

---

## Summary

- Blockers: 0
- Majors: 5
- Minors: 3
- 总体判断：建议小改后合并。F 作为“backend 重启后 active stage 不再永久卡住 scheduler”的窄修复是对的；但它只解决 M2 #1 的一个死锁入口，不能代表“任务流水线稳定”完成。

## Numeric Score

| Lens | Score (0..5) |
|---|---:|
| 正确性 | 3.5 |
| 跨端对齐 | 3.0 |
| 不可逆 | 3.5 |
| 安全 / 运维风险 | 4.0 |
| 简化 | 3.5 |

**Overall score**: 3.5

---

## Findings

### M1 [MAJOR] Cleanup writes are not atomic; one thrown update or broadcast can leave a half-cleaned active set

**Where**: `packages/backend/src/scheduler.ts:75`, `packages/backend/src/scheduler.ts:85`, `packages/backend/src/scheduler.ts:86`, `packages/backend/src/scheduler.ts:87`  
**Lens**: 正确性 / 运维风险  
**Issue**: `cleanupOrphanStages()` loops one stage at a time, writes `failed`, then immediately broadcasts. If `setStageStatus()` throws on the second row, or `broadcast()` throws after the first row, constructor exits with some stages failed and some still `pending` / `dispatched` / `running`.  
**Why this matters**: The exact bug F fixes is “active rows deadlock future ticks”. A partial cleanup can leave the same deadlock behind, while also making the startup path brittle because the side effect runs inside the constructor.  
**Suggested fix**: Wrap the DB updates in a `better-sqlite3` transaction, collect event payloads, commit all `failed` transitions, then broadcast outside the transaction in a `try/catch` that logs but does not abort scheduler construction. If the transaction fails, fail all-or-none instead of half-cleaning.

### M2 [MAJOR] Cleanup makes the pipeline diagnosable only in console logs, not in persisted harness state

**Where**: `packages/backend/src/scheduler.ts:86`, `packages/backend/src/scheduler.ts:87`, `packages/backend/src/scheduler.ts:93`, `packages/backend/src/scheduler.ts:124`  
**Lens**: 正确性 / M2 #1 pipeline stability  
**Issue**: Orphans are persisted only as `status = "failed"`. The reason “backend restart cleanup” exists in `console.warn`, but not in the stage row, event payload, task row, artifact, or an audit field.  
**Why this matters**: M2 #1 explicitly includes “失败可诊断”. After this change, the operator can see that a stage failed, but cannot distinguish restart cleanup from spawn setup failure, spec harvest failure, CLI failure, or an intentional rejection by reading stable harness state.  
**Suggested fix**: Add a persisted failure context before claiming M2 #1 done. Minimum viable version: stage failure reason/code/timestamp fields or a harness event/audit table entry with `{reason: "orphan_after_restart", previousStatus, detectedAt, cleanupRunId}`. Broadcast should include the same reason for live clients.

### M3 [MAJOR] The cleanup removes the active deadlock but still requires manual recovery before the pipeline can advance

**Where**: `packages/backend/src/scheduler.ts:86`, `packages/backend/src/scheduler.ts:196`, `packages/backend/src/scheduler.ts:200`, `packages/backend/src/scheduler.ts:124`, `packages/backend/src/scheduler.ts:129`  
**Lens**: 正确性 / M2 #1 pipeline stability  
**Issue**: Marking an orphan `failed` unblocks the `STAGE_ACTIVE_STATUSES` check, but `computeNextStage()` then returns `"blocked"` for any failed stage. The pipeline does not resume until an operator manually patches the stage to `skipped` or abandons the issue.  
**Why this matters**: This is acceptable for F, but it is not “任务流水线稳定” yet. F changes a silent deadlock into an explicit manual stop. That is progress, not automatic recovery.  
**Suggested fix**: Keep F conservative, but make the next loop implement a clear recovery policy: retry same stage, mark skipped with explicit operator action, or abandon issue. At minimum add a reproducible test for “orphan cleanup -> tick reports actionable blocked reason -> PATCH skipped -> next tick advances”.

### M4 [MAJOR] `awaiting_review` is correctly excluded from orphan cleanup, but stale review pauses need a separate queue/TTL policy

**Where**: `packages/backend/src/scheduler.ts:40`, `packages/backend/src/scheduler.ts:78`, `packages/backend/src/scheduler.ts:79`, `packages/backend/src/test-scheduler-orphan-cleanup.ts:73`  
**Lens**: 正确性 / M2 #1 pipeline stability  
**Issue**: `awaiting_review` is part of active stage semantics, but cleanup intentionally excludes it. That is the right choice for F because a human review pause is not equivalent to a lost process. However, a stage that sits in `awaiting_review` for days can still stop the pipeline.  
**Why this matters**: Treating stale `awaiting_review` as an orphan would be wrong and could erase legitimate review gates. Ignoring it forever is also not enough for M2 #1 because review results are part of the delivery chain.  
**Suggested fix**: Do not fold review TTL into startup orphan cleanup. Add a separate stale-review mechanism: surface age in queued/active stage views, notify after threshold, allow cancel/skip/reassign, and only auto-transition if an explicit policy exists.

### M5 [MAJOR] Send-once `stage_changed` on startup is not a reliable cross-end contract after backend restart

**Where**: `packages/backend/src/scheduler.ts:72`, `packages/backend/src/scheduler.ts:87`, `packages/backend/src/scheduler.ts:88`, `packages/backend/src/scheduler.ts:91`  
**Lens**: 跨端对齐  
**Issue**: The code comment already notes broadcasts may have no WS clients during constructor cleanup. iOS/web clients reconnecting after backend restart can miss every `stage_changed{failed}` event.  
**Why this matters**: The DB repair is durable, so correctness does not depend on the broadcast. But UX correctness does: clients must reconcile state from the persisted stage list on connect/resume, not rely on replaying startup events.  
**Suggested fix**: Treat broadcast as best-effort only. M2 #1 should require “client reconnect -> fetch current issue/stage state -> render failed orphan reason”. If no such polling/reconciliation exists, add it before claiming cross-end pipeline stability.

### m1 [MINOR] Constructor side effect is simple but hides an irreversible state mutation

**Where**: `packages/backend/src/scheduler.ts:50`, `packages/backend/src/scheduler.ts:55`, `packages/backend/src/scheduler.ts:66`  
**Lens**: 不可逆 / 简化  
**Issue**: Constructing `EvaScheduler` mutates the database by marking active stages failed. This guarantees the invariant if every runtime creates the scheduler normally, but it makes tests, scripts, and future multi-scheduler setups more surprising.  
**Suggested fix**: Prefer an explicit startup method such as `scheduler.initialize()` or `EvaScheduler.createStarted(...)` called from the backend boot path before routes accept ticks. If keeping constructor cleanup, document “constructing this class mutates stage state” at the class boundary and make it idempotent/transactional.

### m2 [MINOR] The test proves the narrow cleanup path but not the operational path after cleanup

**Where**: `packages/backend/src/test-scheduler-orphan-cleanup.ts:63`, `packages/backend/src/test-scheduler-orphan-cleanup.ts:89`, `packages/backend/src/test-scheduler-orphan-cleanup.ts:103`, `packages/backend/package.json:16`  
**Lens**: 正确性  
**Issue**: The test covers pending/dispatched/running -> failed, `awaiting_review` preservation, controls, broadcast count, and idempotency. It does not cover the next scheduler tick, the blocked reason, or the manual recovery path.  
**Suggested fix**: Add a second test slice for post-cleanup behavior: instantiate scheduler, call `tick()`, assert actionable failed-stage reason, patch failed stage to `skipped`, call `tick()` again, assert the next stage can dispatch.

### m3 [MINOR] Concurrent tick during cleanup is mostly safe in one instance, but not proven across multiple scheduler instances

**Where**: `packages/backend/src/scheduler.ts:55`, `packages/backend/src/scheduler.ts:75`, `packages/backend/src/scheduler.ts:104`, `packages/backend/src/scheduler.ts:137`  
**Lens**: 正确性 / 运维风险  
**Issue**: Inside one Node instance, constructor cleanup is synchronous, so a route cannot call `tick()` on that instance until construction returns. The race only appears if another `EvaScheduler` instance or another process can call `tick()` against the same DB while cleanup is mid-loop.  
**Suggested fix**: If Eva remains single-backend/single-scheduler in M2, document that assumption. If multiple scheduler instances are possible, protect startup cleanup and tick reservation with the same DB-level transaction/lock so tick never sees a half-cleaned stage table.

---

## M2 #1 Coverage Assessment

**Verdict**: F covers about **20%** of M2 #1 “任务流水线稳定”.

Reasoning: M2 #1 breaks down as “Issue created -> Scheduler 识别 -> stage 推进 -> ContextBundle 自动 -> agent -> 失败可诊断 -> 结果可 review”. F only addresses one failure mode inside “stage 推进”: after backend restart, `pending` / `dispatched` / `running` rows no longer remain active forever. It turns a silent scheduler deadlock into a visible failed stage. That is a necessary stability slice, but it does not make the full pipeline stable.

Remaining MUST-do, in priority order:

1. **Persist failure reason and recovery metadata**. Add durable failure context for all scheduler failures, including `orphan_after_restart`, spawn setup failure, CLI failure, spec harvest failure, and operator cancellation. Without this, “失败可诊断” is not met.

2. **Define retry/resume/skip policy for failed stages**. Today F leaves the issue manually blocked through `computeNextStage()`. M2 #1 needs a supported operator path and preferably a one-click retry/skip/abandon flow, with tests proving the pipeline can continue after each choice.

3. **Add an end-to-end reproducible pipeline test**. Required path: create issue -> scheduler picks it -> creates stage/context/task -> agent path is simulated or bounded -> failure/success is persisted -> result is reviewable. A single dogfood run is useful evidence, but not enough to claim the milestone.

4. **Implement cross-end reconciliation on reconnect**. Startup broadcasts are best-effort and usually missed after restart. Web/iOS must fetch current stage/issue state on connect or screen open so failed orphan stages are visible without relying on live WS replay.

5. **Surface backlog and active queue state**. The user/operator needs to see queued issues, active stages, blocked failed stages, and stale review gates. Otherwise pipeline “stability” failures remain hidden until manual tick/debug.

6. **Handle stale `awaiting_review` separately**. Do not auto-fail it as an orphan. Add age surfacing, reminders, reassignment, skip/approve/reject/cancel controls, and a policy for what happens when review never arrives.

7. **Add cancellation for in-flight stages**. M2 stability needs an operator-safe way to stop a running stage and persist a clear terminal state. Without cancellation, OOM/SIGKILL cleanup is only the crash recovery side, not normal operational control.

8. **Make startup cleanup atomic and explicit**. This can be a small hardening loop before or alongside the above: transaction for DB updates, broadcast after commit, and explicit boot ordering before routes accept ticks.

What F can honestly claim now:

- “Backend restart cleanup prevents `pending` / `dispatched` / `running` orphan stages from staying active forever.”
- “`awaiting_review` is intentionally preserved.”
- “Cleanup is idempotent in the tested single-process path.”

What F cannot claim:

- “The scheduler pipeline automatically recovers after restart.”
- “Failures are diagnosable from persisted harness state.”
- “Clients reliably observe cleanup events after reconnect.”
- “M2 #1 pipeline stability is done.”

---

## Constructor Side-Effect Trade-off

Constructor cleanup is defensible for the narrow F slice because it guarantees every normal scheduler instance repairs active orphan rows before use. It is also small and hard to forget.

The cost is that `new EvaScheduler(...)` is no longer a pure object construction; it mutates stage state and can fail startup. For M2, an explicit init method called from backend boot is cleaner because boot ordering becomes visible: open DB -> run migrations -> construct scheduler -> cleanup orphans transactionally -> register routes / accept ticks. If the constructor approach stays, the cleanup should be transaction-safe and documented as a startup mutation.

---

## False-Positive Watch

- F? Concurrent tick during cleanup may be a false positive if the backend has exactly one scheduler instance and routes are registered only after constructor completion. I did not read `index.ts`, per the artifact limit, so I cannot confirm the boot ordering.
- F? Cross-end reconnect may already poll stage lists elsewhere. I did not read iOS/web clients or harness routes, so the finding is scoped to the fact that this change's startup broadcast is not sufficient by itself.

---

## What I Did Not Look At

- Did not read migrations or schema SQL; this review relies only on the provided scheduler/test/package artifacts.
- Did not read `harness-queries.ts`, so I did not verify whether `setStageStatus()` records timestamps or audit side effects.
- Did not read backend boot code such as `index.ts`, so I did not verify route registration order or whether `tick()` can be called during scheduler construction.
- Did not read iOS/web client code, so cross-end comments are about required contract behavior, not an assertion that clients currently lack polling.
- Did not run tests or execute `pnpm --filter @claude-web/backend test:scheduler-cleanup`; this is a static artifact review only.
- Did not review unrelated scheduler behavior beyond how it affects orphan cleanup, failed-stage blocking, and M2 #1 scoping.
