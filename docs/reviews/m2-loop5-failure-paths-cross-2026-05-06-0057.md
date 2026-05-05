# Cross Review — M2 Loop 5 Failure-Path E2E Pipeline Test

**Reviewer**: reviewer-cross
**Model**: GPT-5.5
**Date**: 2026-05-06 00:57
**Files reviewed**: packages/backend/src/test-e2e-pipeline-failures.ts, packages/backend/package.json

---

## Summary
- Blockers: 0
- Majors: 0
- Minors: 3
- Verdict: 建议合并

## Numeric Score
| Lens | Score (0..5) |
|---|---:|
| 正确性 | 4.7 |
| 跨端对齐 | 4.7 |
| 不可逆 | 4.8 |
| 安全 | 4.7 |
| 简化 | 4.5 |
**Overall score**: 4.68

## Loop 5 Charter Compliance
- ✅ 不应该改 production scheduler 行为：verified by only adding standalone e2e harness logic in packages/backend/src/test-e2e-pipeline-failures.ts:26 and invoking existing EvaScheduler rather than patching scheduler code.
- ✅ 不应该引入新的 runtime provider / SDK path：verified by using the existing RunSessionFn injection and RunSessionParams types in packages/backend/src/test-e2e-pipeline-failures.ts:19.
- ✅ 不应该覆盖 Phase A by forced fake seams beyond charter：verified by the file comment explicitly excluding direct Phase A mock injection in packages/backend/src/test-e2e-pipeline-failures.ts:11.
- ✅ 不应该 depend on user global harness DB：verified by per-test DATA_DIR isolation before dynamic imports in packages/backend/src/test-e2e-pipeline-failures.ts:22.
- ✅ 不应该 leave failed stages only unit-tested：verified by real scheduler ticks plus DB persistence and broadcast assertions for cli_failed / spec_harvest_failed in packages/backend/src/test-e2e-pipeline-failures.ts:119 and packages/backend/src/test-e2e-pipeline-failures.ts:221.

## Phase A Bonus Coverage Discussion
Phase A coverage is not a charter violation. The charter excluded directly mocking buildContextBundle / createTask failure seams because EvaScheduler does not expose clean injection points yet. This test does not punch a new seam into scheduler internals; it reaches spawn_setup_failed through a legitimate cross-loop path: a failed strategy stage is skipped, then the next implement stage naturally lacks the required spec artifact, so ContextManager fails during bundle construction.

That is emergent integration coverage, not scope creep. The important distinction is that the test still exercises public scheduler behavior and the real DB/broadcast path. The test should not claim full Phase A coverage, because it covers one natural spawn_setup_failed route, not all setup failures. But it does increase confidence that the Phase A catch path writes the canonical reason under real runtime flow.

## Findings
### m1 [MINOR] Top/bottom comments understate the emergent Phase A coverage
**Where**: packages/backend/src/test-e2e-pipeline-failures.ts:11  
**Lens**: 正确性 / 简化  
**Issue**: The header says Phase A is excluded, and the final summary still says spawn_setup_failed is left for Loop 6+. Later in the same file, Scenario 1 correctly explains that Phase A is incidentally covered through skip-without-harvest. This creates a small documentation contradiction inside the test artifact.  
**Suggested fix**: Keep the charter note, but clarify that direct Phase A seam injection is excluded while one emergent Phase A path is covered by the skip integration scenario.

### m2 [MINOR] Nullable DB fields are typed as definitely present before assertions
**Where**: packages/backend/src/test-e2e-pipeline-failures.ts:127  
**Lens**: 正确性  
**Issue**: Rows such as failed_reason / failed_at / ended_at are cast as non-null values before the test asserts they are set. Runtime assertions still catch the important failures, so this is not blocking, but the type shape hides the actual DB contract and makes future refactors less obvious.  
**Suggested fix**: Type these selected fields as `string | null` and `number | null`, then keep the existing assertions.

### m3 [MINOR] New focused script is not wired into a broader test entry point
**Where**: packages/backend/package.json:19  
**Lens**: 跨端对齐 / 不可逆  
**Issue**: `test:e2e-failures` is available as a direct script, which is good for Loop 5 review, but it is easy for future maintainers or CI to miss if they only run the older e2e scripts. This is acceptable for a milestone loop artifact, but it slightly lowers regression protection.  
**Suggested fix**: In a follow-up, add a documented aggregate harness/e2e command or CI step that includes `test:e2e-failures`.

## M2 #1 Coverage After Loop 5
My estimate remains 60-63%.

Reasoning: Loop 5 materially improves the failure-path pipeline story by proving cli_failed and spec_harvest_failed end-to-end through real scheduler ticks, DB writes, terminal broadcasts, and skip-after-failure integration. It also adds useful idempotence coverage for already-failed stages across scheduler reinstantiation. On top of that, the skip path gives legitimate emergent evidence for one spawn_setup_failed route.

The remaining gap is that Phase A is not broadly and intentionally covered through direct setup failure injection, and the new script is still a focused manual/targeted entry rather than clearly part of a full regression suite. So the coverage is meaningfully stronger than Loop 4, but not yet complete enough to call M2 #1 mostly closed.

## False-Positive Watch
- The Phase A bonus should not be counted as full Phase A coverage; it proves one natural route only.
- The skip integration behavior is valuable, but it also documents a known trade-off: skipped strategy means implement can fail because no spec exists.
- The idempotence scenario checks restart cleanup behavior for already-failed stages, not all retry or recovery policy.
- The broadcast barrier is suitable for this test, but it assumes one terminal event per scenario and does not attempt to model multiple concurrent projects.

## What I Did Not Look At
- I did not run the test command, per instruction not to use Bash.
- I did not inspect production scheduler / DB implementation files in this re-issue pass.
- I did not review frontend or iOS behavior.
- I did not verify CI wiring beyond the `package.json` script line.
