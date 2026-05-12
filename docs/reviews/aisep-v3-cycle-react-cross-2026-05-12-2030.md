Backlog: 0 in_progress · 5 planned · 4 blocked

# Phase 2 React — cross-correctness lens

> Reviewer: reviewer-cross  
> Phase: 2 cross-pollinate  
> Independence: did NOT read author chat / transcript. Reacting only to the proposal text, Reviewer A Phase 1, and my own Phase 1 included in `/tmp/aisep-v3-react-cross-full.md`.

## Updated Verdict

**REVISE_REQUIRED.**

A's review mostly matches my Phase 1. The proposal is directionally right, but still has three required contract fixes before implementation: protocol version ordering, explicit cycle identity semantics, and v1 fan-out composition. I now think my original B.F2 should be broadened: the core bug is not only "`stageRunId` is ambiguous", but "`cycle action` lacks a complete source/target/scope contract."

## Reaction To A Findings

### A.F1 — agree

A is correct. This is the same as my B.F1.

v3 cycle cannot claim `aisep-protocol 0.2.0 -> 0.3.0` if v1 fan-out already converged on that slot. Required fix:

- v3 cycle becomes `0.3.0 -> 0.4.0`
- proposal states dependency on v1 fan-out shipping first
- if v3 ships first, version ordering must be renegotiated explicitly, not silently reused

Keep as **BLOCKER**.

### A.F2 — refine

I agree with A's direction, but refine the preferred fix.

A says the proposal's `intent` param is too loose and recommends `assertRetryTransition(prevAttemptN, newAttemptN)`. I agree. This also overlaps with my B.F3 about `retryPendingFor`, but they are not the same issue.

- A.F2 is about **who is allowed to perform `succeeded -> running`**
- B.F3 is about **how that pending retry is represented in protocol/schema**

My refinement: do **not** add a broad `intent` param to `assertTransition`. Keep `assertTransition(from, to)` strict. Add a separate API:

```ts
assertRetryTransition(from, to, prevAttemptN, newAttemptN)
```

Only `store.markStageRunRetrying()` may call it.

For `retryPendingFor`, I now prefer **removing it** unless the proposal can prove consumers need it. A `cycle_decision` artifact plus explicit stage status/history is cleaner than adding a new top-level array field to `AisepStageRunSchema`.

Keep as **MAJOR**, possibly **BLOCKER** if the proposal continues to say "same stageRunId" without schema/API detail.

### A.F3 — refine

A.F3 and my B.F2 are related but not identical.

They are the same root problem at different levels:

- My B.F2: base v3 cycle confuses **source review stage_run** with **target implement/verify stage_run**
- A.F3: v1 fan-out adds another layer: target may be a **child stage_run inside a parent patch_set**, while review remains one parent review verdict

So A.F3 is not redundant. It exposes the composition case my B.F2 only implied.

Required fix should be one unified action contract, not two separate patches. `AisepCycleAction` needs fields like:

```ts
sourceReviewStageRunId
targetStageRunId
targetStage: "implement" | "verify"
scope: { kind: "stage" } | { kind: "child", childStageRunId, checkName }
```

For `request_reverify` under v1 fan-out, cycle must preserve v1 Case 3:

- one parent review stage_run
- one review verdict over merged `patch_set`
- child-scoped `verify --recheck`
- then re-review on the same parent review stage_run
- M5 counter remains keyed on the parent review stage_run

Keep as **MAJOR**, and it becomes **BLOCKER** if v1 fan-out is already treated as prerequisite.

### A.F4 — agree

A is correct. Pilot-08 needs a reproducible false-positive injection method.

This is minor but useful because dogfood gates become weak when the forced failure is hand-waved. The proposal should name the fixture or manual corruption mechanism.

Keep as **MINOR**.

### A.F5 — agree, with one addition

A is correct that `cycle_decision` needs a concrete schema diff.

This also reinforces my B.F4: do not describe `cut_scope` as both an artifact kind and an action. Prefer:

- artifact kind: `cycle_decision`
- action inside artifact: `cut_scope`

Keep as **MINOR**, but B.F4 remains **MAJOR** because enum confusion can become an implementation bug.

## Self-Revised B Findings

### B.F1 — unchanged, BLOCKER

Version conflict remains a blocker. Change all v3 protocol references to `0.3.0 -> 0.4.0`, assuming v1 fan-out ships first.

### B.F2 — broadened, BLOCKER

Original finding was too narrow. Revised finding:

**Cycle action identity contract is underspecified.**

The action must distinguish:

- `sourceReviewStageRunId`: where the verdict and M5 counter live
- `targetStageRunId`: what stage is retried or rechecked
- `targetStage`: implement or verify
- `scope`: whole stage vs v1 fan-out child patch/check
- `newAttemptN`: created attempt number

Without this, implementation can easily reset M5 counting or retry the wrong stage.

### B.F3 — revised, MAJOR

`retryPendingFor` should either be fully added to schema/migration/Q1 or removed.

My revised recommendation: remove it for v0.4 unless a consumer requirement is shown. Use `cycle_decision` artifacts and explicit retry transition records instead.

### B.F4 — unchanged, MAJOR

Unify `cut_scope` as an `AisepCycleAction`, not a standalone artifact kind, unless the artifact enum explicitly adds it. Preferred design: one `cycle_decision` artifact with `action: "cut_scope"`.

### B.F5 — refined, MINOR

`--cycle-cap N` must not weaken M5.

Clarify three numbers:

- `M5_CAP_THRESHOLD = 2`: methodology hard cap for revise-required verdicts
- `--cycle-cap`: optional user ceiling, must be `<= M5_CAP_THRESHOLD` if it controls M5 retries
- hard ceiling `10`: implementation safety guard for total loop iterations, not a methodology override

## Final Required Fixes Before Implementation

1. Rename v3 protocol target to `0.3.0 -> 0.4.0`.
2. Replace "retry on same stageRunId" language with explicit source/target/scope action schema.
3. Add v1 fan-out composition section covering child-scoped recheck/retry while preserving one parent review verdict.
4. Replace loose `intent` transition with `assertRetryTransition`.
5. Decide whether `retryPendingFor` exists; preferably remove it and rely on `cycle_decision`.
6. Define `cycle_decision` schema and make `cut_scope` an action, not a separate artifact kind.
7. Specify Pilot-08 false-positive injection mechanism.
