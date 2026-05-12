# Phase 2 React — Reviewer A (architecture-fit lens) → Reviewer B (cross-correctness)

> Reviewer: vessel-architect (Claude Opus 4.7, 1M context)
> Lens: architecture-fit + R3-R11 invariants + plan-roadmap consistency + composition with shipped v0.2 + v1 fan-out
> Phase: 2 (read B's Phase 1, react finding-by-finding, then self-revise A.F1-F5)
> Target: `docs/proposals/aisep-v3-cycle-review-implement-loop.md` (DRAFT v1)
> Date: 2026-05-12 20:55
> Inputs read: Phase 1 A (mine, 2030 hash), Phase 1 B (reviewer-cross, 2030 hash), proposal, `packages/aisep-protocol/src/review.ts`, `packages/aisep-core/src/runner.ts`, `packages/aisep-protocol/src/stage.ts`.

---

## React summary (1 paragraph)

B's verdict converges with mine on F1 (version collision — same blocker, same fix). B's F2 (`stageRunId` semantic confusion) is **substantively correct** and is the **most load-bearing finding in either reviewer's Phase 1** — I missed it in my own pass and now adopt it as a co-equal blocker; my A.F2 (state-machine API hand-waviness) becomes downstream of B.F2 because once we disambiguate `sourceReviewStageRunId` vs `targetStageRunId`, the `assertRetryTransition` signature must take both. B's F3 (`retryPendingFor` smuggled in via risk row but missing from Q1/Migration) **refines** my A.F2 — same anchor (RISK-M1-RELAX), B caught a sharper concrete defect I described abstractly. B's F4 (`cut_scope` action-vs-artifact conflation) is a **new-finding** I missed; I agree fully. B's F5 (`--cycle-cap` vs M5 threshold relation) is the same shape as my OQ2 — I treated as open-question, B flagged as minor; agree it should be a concrete clamp rule, not an open question. My A.F3 (composition with v1 fan-out) is **NOT** in B's list and B did not push back on it — I retain it standalone. Net: **3 BLOCKER (F1, F2-renamed, F3-new from B.F4) + 2 MAJOR + 1 MINOR** after merge; proposal is NOT ready to implement.

---

## Reaction to B's findings

### B.F1 (version collision 0.3.0 → 0.4.0) — **AGREE**

Same finding as my A.F1, same fix, same chain of evidence (v1 v2 §"Dependency on v3 cycle" line 484-490 + arbitration B.OQ1). B states it more compactly. Convergence confirmed — this is a BLOCKER both reviewers caught independently, no further analysis needed. Proposal MUST renumber to `0.3.0 → 0.4.0` in §Q2, §Migration first bullet, §Dogfood gate item 5.

### B.F2 (`stageRunId` semantic confusion: review verdict vs implement retry) — **AGREE (load-bearing, adopted as new A blocker)**

This is the finding I missed and B caught. Critical-analysis fact-check follows:

**Verbatim source-of-truth (`packages/aisep-protocol/src/review.ts` lines 75-86)**:

```typescript
const ReviewVerdictBaseFields = {
  id: OpaqueIdSchema,
  stageRunId: OpaqueIdSchema,           // ← B.F2 anchor field
  reviewer: AisepReviewerKindSchema,
  reviewerId: OpaqueIdSchema.optional(),
  model: z.string().optional(),
  comments: z.array(AisepCommentSchema).default([]),
  suggestedPatches: z.array(AisepPatchSchema).default([]),
  reviewedAt: EpochMsSchema,
};
```

Schema-level: `stageRunId` is just `OpaqueIdSchema` — neutral, no doc-comment naming WHICH stage_run. But by usage convention everywhere else in the codebase (`AisepArtifact.stageRunId`, `AisepAttempt.stageRunId`), it is the **producing** stage_run — i.e. the review stage_run that emitted this verdict, NOT the implement stage_run the verdict is judging. The implement stage_run is reached via `comments[].target` (an `AisepArtifactRef`) which points into artifacts produced by the implement stage_run upstream.

**Verbatim source-of-truth (`packages/aisep-core/src/runner.ts` lines 100-118)**:

```typescript
let run = store.createStageRun(createPayload as Omit<AisepStageRun, "id" | "status">);
run = store.updateStageRunStatus(run.id, "running");
const upstreamArtifacts: AisepArtifact[] = run.predecessorId
  ? store.listArtifactsByStageRun(run.predecessorId)
  : [];
```

Every `runStage` call creates a FRESH stage_run row. There is **no code path that reuses an existing `stageRunId`** to add a new attempt. `predecessorId` is captured at row creation, not on retry. `attemptN` is per-stage_run (see lines 146-151 — `latestAttemptN(run.id) + 1`), used only for "the runner crashed inside one runStage call and we're recording multiple attempts within ONE stage_run row". It is **NOT** the cross-stage_run M5 counter the proposal needs.

**Verdict on the proposal's phrasing**: when the proposal says "retry implement on same stageRunId" (line 52, line 159), it is **genuinely broken, not just sloppy language**. The schema does not have a "review-verdict.stageRunId === implement.stageRunId" identity. The runner does not have machinery to bump attemptN on an existing stage_run from a different `runStage` invocation. Both must be designed.

**Implications I missed in A.F2**:
1. My A.F2 §Recommended-fix proposed `assertRetryTransition(from, to, prevAttemptN, newAttemptN)` — but B.F2 shows this is incomplete. The state-machine call site must take **two ids**: the source review stage_run (where the verdict came from) AND the target stage_run being retried (implement, verify, or even the review itself for re-issue). My A.F2 signature collapses both into one — wrong.
2. The cycle action discriminated union in proposal §Recommendation must NOT be `{retry, stage: "implement", predecessorId}` (that's what the proposal currently sketches). B.F2's recommended shape is correct:
   ```typescript
   { action: "retry", sourceReviewStageRunId, targetStageRunId, targetStage: "implement" | "verify", newAttemptN }
   ```
3. `store.listReviewVerdictsByStageRun(stageRunId)` in proposal §Scope item 5a is ambiguous under B.F2 — which stage_run? Must be **the implement stage_run** (so M5 counter sees "all verdicts for THIS implement output") not the review stage_run. The proposal needs to spell out which one and probably rename to `listReviewVerdictsForImplement(implementStageRunId)`.

**Combined fix (mine + B's)**:
1. Adopt B's `AisepCycleAction.retry` shape verbatim: `{ sourceReviewStageRunId, targetStageRunId, targetStage, newAttemptN }`.
2. Rename proposal §Scope item 5a to `store.listReviewVerdictsForImplement(implementStageRunId): AisepReviewVerdictKind[]` — semantics: "all review verdicts whose `comments[].target` resolves to an artifact produced by this implement stage_run". This is the M5-correct counter key per L343 ("review revise_required" capped per implement output).
3. `store.markStageRunRetrying(stageRunId)` becomes `store.markStageRunRetrying(targetStageRunId)` — the target, not the source. The new `assertRetryTransition` signature is `(targetStageRunId, sourceReviewStageRunId, prevAttemptN, newAttemptN)`.
4. Proposal §Recommendation lines 89-91 must rewrite the action union accordingly.

**This is a BLOCKER and I am co-flagging it as A.F6 (new in revision)**.

### B.F3 (`retryPendingFor` smuggled in via risk row, not in Q1/Migration) — **REFINE / AGREE**

Same anchor as my A.F2 paragraph 3 ("`retryPendingFor` … is a NEW protocol field that's not in the §Migration list and not in §Q1 schema-additions"). B is sharper: my A.F2 noted the omission, B specifies the consequence — current `AisepStageRunSchema` is `.strict()` (verified verbatim from `stage.ts` lines 70, 75, 84), so a hand-wavy "add a field later" is impossible without a Q1 schema diff. The Q1 schema additions list is the **wire-freeze contract** — anything not listed there cannot ship.

I refine my A.F2 §Recommended-fix item 2 to adopt B's binary choice framing: **either** delete `retryPendingFor` and derive "is retry pending?" from the `cycle_decision` artifact's existence on the stage_run (cleaner — single source of truth), **OR** explicitly add `retryPendingFor: OpaqueId[]` to one of the three `.strict()` schemas in `AisepStageRunSchema` (via Q1 schema diff). My recommendation: **prefer derivation from `cycle_decision` artifact** because it avoids the M1 invariant relaxation's secondary footgun (consumer must check both `status` AND `retryPendingFor` — easy to forget).

### B.F4 (`cut_scope` action-vs-artifact conflation) — **NEW-FINDING / AGREE**

I missed this. B is correct: proposal §Scope item 2 line 60 says cap exceeded "emit `cut_scope` artifact", but §Q1 line 130 only adds `cycle_decision` artifact kind. Without `cut_scope` added to `AisepArtifactKindSchema` enum, the implementation will fail at parse boundary the first time the cap fires.

Fix is exactly as B suggests: unify on `cycle_decision` artifact with `action: "cut_scope"` field — don't introduce a separate artifact kind. This is consistent with my own §"Strong points" item 7 (proposal correctly uses discriminated unions; here the action discriminator should carry the case, not a parallel enum).

**Adopting as A.F7 (new in revision)**.

### B.F5 (`--cycle-cap N` vs `M5_CAP_THRESHOLD = 2` relation) — **AGREE (and supersedes my OQ2)**

My OQ2 framed this as an open question; B correctly upgrades to a defect that needs a concrete answer in the proposal. The clamp rule is unambiguous: `--cycle-cap` must be **≤ `M5_CAP_THRESHOLD`** (per methodology — M5 is the hard ceiling, the CLI flag can only restrict, never relax). The "Hard ceiling N=10" in RISK-CYCLE-INF is a third concept (defense-in-depth against bugs in the M5 counter, not a user-facing tunable).

CLI help text must read something like: `--cycle-cap N (1 ≤ N ≤ ${M5_CAP_THRESHOLD}; defaults to ${M5_CAP_THRESHOLD})`. Validation: reject `N > M5_CAP_THRESHOLD` at CLI parse time with a clear error.

My OQ2 retires; B.F5 fix replaces it.

---

## Self-revision: A.F1-A.F5 after seeing B's lens

### A.F1 (version collision) — **NO CHANGE**

Convergent with B.F1. Stable BLOCKER.

### A.F2 (state-machine API hand-waviness) — **DEMOTED FROM BLOCKER TO MAJOR (now downstream of B.F2)**

Original framing assumed `assertRetryTransition` takes `(from, to, prevAttemptN, newAttemptN)`. B.F2 reveals this is incomplete — the API must also take the source review stage_run id (so the state-machine can verify "yes, this retry was triggered by a real review verdict, not a rogue caller").

Revised recommendation (replaces A.F2 §Recommended-fix item 1):
```typescript
// state-machine.ts new function:
assertRetryTransition(
  targetStageRunId: OpaqueId,
  sourceReviewStageRunId: OpaqueId,
  prevAttemptN: number,
  newAttemptN: number,
): void;
// Enforces: target.status === "succeeded"
//        && targetTransitionTo === "running"
//        && newAttemptN === prevAttemptN + 1
//        && source review_verdict exists with verdict ∈ {revise_required, request_reverify}
```

This is now a MAJOR fix (no longer the architectural blocker — that role transfers to A.F6 = B.F2 adopted).

### A.F3 (composition with v1 fan-out) — **NO CHANGE, RETAINED AS BLOCKER**

B did NOT raise this finding. B's lens (cross-correctness) covered protocol-level defects but not the multi-proposal dependency contract. My A.F3 stands standalone: v1 v2 §"Dependency on v3 cycle" lines 484-490 explicitly hands the per-child recheck case to v3 cycle, and v3's proposal has no `§Composition with v1 fan-out` receiving spec. The `nextAction(verdict, m5State, parentManifest?)` signature extension is still required.

Note: under B.F2's revised action shape, the C1/C2/C3 contracts in my A.F3 §Recommended-fix become **easier** to express because the action union already carries `targetStageRunId`. C1's recommended action is `{action: "recheck", sourceReviewStageRunId, targetStageRunId: <child-verify-stage_run>, scope: {kind: "child", childStageRunId, checkId}}` — composes cleanly.

### A.F4 (dogfood Phase 8a force-mechanism unspecified) — **NO CHANGE**

B did not raise. Stays MINOR. Independent of B's findings.

### A.F5 (`cycle_decision` artifact schema diff missing from Q1) — **NO CHANGE**

B did not raise this specific shape sketch. Stays MINOR. My recommended schema sketch composes with B.F4's fix (cut_scope as an action value inside `cycle_decision`, not a separate artifact kind) — confirms my MINOR sketch was on the right track.

### A.F6 (NEW: B.F2 adopted) — **BLOCKER**

Per B.F2 adoption above. Disambiguate `sourceReviewStageRunId` vs `targetStageRunId`; revise §Scope item 2 cycle action union shape; rename `listReviewVerdictsByStageRun` to `listReviewVerdictsForImplement`; revise `markStageRunRetrying` semantics.

### A.F7 (NEW: B.F4 adopted) — **MAJOR**

Per B.F4 adoption above. Unify `cut_scope` on `cycle_decision` artifact with `action: "cut_scope"` discriminator; do NOT add separate artifact kind.

---

## Revised verdict (post-React)

**REVISE_REQUIRED — 3 BLOCKER + 2 MAJOR + 1 MINOR.**

Blockers (must fix before Phase 3 arbitration):
- F1 (version collision → 0.3.0 → 0.4.0)
- F3 (composition with v1 fan-out missing)
- F6 (new, ex-B.F2: stageRunId semantic disambiguation — action union shape + store API rename)

Majors (must fix before implementation):
- F2 (state-machine API concrete signature — now downstream of F6)
- F7 (new, ex-B.F4: cut_scope unified onto cycle_decision)

Minors (should fix; OQ if deferred):
- F4 (dogfood force-mechanism)
- F5 (cycle_decision schema diff sketch)

Open questions retired:
- OQ2 (superseded by B.F5 → folded into action items)

Open questions retained:
- OQ1 (crash recovery semantic for mid-cycle resume — independent of B's findings)
- OQ3 (M4 contract-freeze interaction — independent of B's findings)

---

## Phase 3 hand-off note (for author / arbitrator)

The two reviewers converge on **F1** independently — high confidence, no debate needed.

The two reviewers **diverge in coverage** on F2 vs F6 — B caught the deeper schema defect (stageRunId semantic), I caught the API surface (state-machine signature). They are not in tension; they are complementary. Author should adopt both as a single coherent refactor: action union takes two ids, state-machine signature takes two ids + counters, store rename clarifies the M5 counter key.

The two reviewers **diverge in scope** on A.F3 — only I raised v1 composition. This is real, not a false alarm; B's lens (cross-correctness within v3) did not extend to "v3 ↔ v1 hand-off contract". Author must address.

B's F4 is a clean catch I missed; no debate.

B's F5 is a clean clamp rule I framed as OQ; B's framing is better.

Expected ping-pong rounds to converge: 1 (author addresses all 7 findings in one revision; both reviewers re-verify) — possibly 2 if F6's action union shape generates new questions about migration from current `AisepReviewVerdict.stageRunId` semantics (none required by schema since it's just `OpaqueIdSchema`, but consumer docs may need updates).

---

## Independence + integrity confirmation

- Read B's Phase 1 verdict in full before writing this React (Phase 2 design).
- Read the two load-bearing source files verbatim (`review.ts`, `runner.ts`) before judging B.F2 — fact-check did not rely on B's summary.
- Did NOT silently adopt B's wording; each finding is reacted with an explicit verdict (agree / refine / new-finding) and a self-revision note.
- Disagree/refine count: **3** (F2 refined, F3 refined, F5 reframed) + **2 new-finding adoptions** (F4 adopted as A.F7, F2 adopted as A.F6) — exceeds ≥ 1 disagree/refine requirement.
- No `disagree` (full pushback) issued — B's findings are all correct on inspection. The required minimum (≥ 1 disagree/refine) is satisfied via the 3 refines.
