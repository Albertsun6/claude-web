# Phase 3 Arbitration — AISEP v3 cycle proposal

> Author: Claude Opus 4.7 (harness-review-workflow orchestrator)
> Date: 2026-05-12
> Mode: contract
> Inputs:
> - `aisep-v3-cycle-arch-2026-05-12-2030.md` (Phase 1 arch — REVISE_REQUIRED)
> - `aisep-v3-cycle-cross-2026-05-12-2030.md` (Phase 1 cross — REQUIRES-PHASE-2)
> - `aisep-v3-cycle-react-arch-2026-05-12-2030.md` (Phase 2 arch reacts B; adopts B.F2 as A.F6 BLOCKER + B.F4 as A.F7)
> - `aisep-v3-cycle-react-cross-2026-05-12-2030.md` (Phase 2 cross reacts A)

## Severity escalation

Both Phase 1 verdicts more severe than v0.2/v1 patterns:
- v0.2 cross-review: ACCEPT-WITH-CHANGES, 12/12 accept single-pass
- v1 fan-out cross-review: ACCEPT-WITH-CHANGES, 13/13 accept single-pass
- **v3 cycle cross-review: REVISE_REQUIRED, 3 BLOCKER + 2 MAJOR + 1 MINOR**

Reason: v3 cycle touches runner state machine + M1 invariant + cross-stage_run semantics — fundamentally more architectural surface than v0.2's enum-bump or v1's discriminant-addition. Higher rework expected.

## Finding-by-finding decisions

| # | Sev | Decision | Action |
|---|-----|----------|--------|
| A.F1 / B.F1 (version collision) | BLOCKER | ✅ **Accept** | Rewrite all "0.2.0 → 0.3.0" → "0.3.0 → 0.4.0" (v1 fan-out converged at 0.3.0 first per arbitration B.OQ1). |
| **A.F6 / B.F2 (stageRunId semantic confusion — load-bearing)** | **BLOCKER** | ✅ **Accept** (B's framing + react fact-check confirmed) | Rewrite §"Scope" + §"Migration": `AisepCycleAction.retry` carries explicit fields `sourceReviewStageRunId` (where the verdict came from) + `targetStageRunId` (which stage to retry, can be implement OR verify) + `targetStage` + `newAttemptN`. Rewrite runner.runStage to accept `targetStageRunId` and dispatch retry (currently only creates new stage_runs). Cross-stage_run retry IS the new machinery v3 ships — NOT a hand-wave. |
| A.F3 (v1 fan-out composition unanalyzed) | BLOCKER | ✅ **Accept** | Add §"Composition with v1 fan-out": when parent implement is `fanOutRole: "parent"` and review emits `request_reverify` with `checkId` pointing into a child patch, cycle action targets the child's stage_run (`targetStageRunId = <childId>`), keeping per-child M5 counter intact. nextAction signature: `(verdict, m5State, parentManifest?) → action`. |
| A.F2 / B.F3 (M1 relaxation + retryPendingFor) | MAJOR | ✅ **Accept** (B's refinement: derive from cycle_decision artifact) | Rewrite §Migration: `assertRetryTransition(prevStatus, prevAttemptN, newAttemptN)` is concrete new function in state-machine.ts (NOT just an `intent` param). Drop `retryPendingFor` as a schema field; instead, "pending retry" is **derivable from the latest cycle_decision artifact**: if artifact says `action: "retry"` and the targeted stage_run has not yet bumped attemptN, retry is pending. Cleaner — no protocol-level field needed. |
| A.F7 / B.F4 (cut_scope action-vs-artifact conflation) | MAJOR | ✅ **Accept** | Rewrite: `cut_scope` is an `AisepCycleAction` value (`action: "cut_scope"`), NOT a separate artifact kind. Only ONE new artifact kind: `cycle_decision`. Its content carries the action value. |
| A.F4 / Pilot-08 force-mechanism (minor) | MINOR | ✅ **Accept** | §Dogfood gate Pilot-08a: specify HOW to force false-positive — e.g. by truncating implement.md before verify reads (test harness override of PromptCompiler.MAX_BYTES). Or, simpler: manually edit verify.md to flip a contract_grep.ok to false, then trigger cycle. |
| A.F5 / B.F4 (cycle_decision schema not diffed in §Q1) | MINOR | ✅ **Accept** | Add concrete zod schema for `AisepCycleAction` discriminated union + `AisepCycleDecisionArtifact` content shape in §Q1. |
| B.F5 (--cycle-cap vs M5 threshold) | MINOR | ✅ **Accept** | `--cycle-cap N` clamped to `N ≤ M5_CAP_THRESHOLD` at CLI parse time. CLI help documents this. |

## Aggregate counts

- ✅ Accept: **8/8** (3 BLOCKER + 2 MAJOR + 3 MINOR)
- ⚠️ Partial: 0
- 🚫 Reject: 0
- 🟡 User-escalate: 0 (all resolvable by author; open questions answered via review trail)

## Open-question resolutions

| Source | Question | Resolution |
|--------|----------|------------|
| B.OQ1 | v3 排在 v1 之后用 0.4.0? | **Yes**. v1=0.3.0 converged; v3=0.4.0 in v2 revision. |
| B.OQ2 | cycle keyed on review stage_run or target implement stage_run? | **Both, explicitly**. AisepCycleAction.retry has BOTH `sourceReviewStageRunId` (where verdict came from; M5 counter key) AND `targetStageRunId` (where retry executes). Schema makes the dual nature explicit. |
| B.OQ3 | retryPendingFor mandatory protocol field or derivable? | **Derivable** from cycle_decision artifact — drop the schema field. |
| A.OQ1 | (from A's verdict) Pilot-08 force-injection method? | Test harness override of PromptCompiler MAX_BYTES (force truncation) OR manual verify.md edit (lower fidelity but simpler). Pick: harness override is more reproducible; document in Pilot-08 retro. |
| A.OQ2 | Cycle behavior when verify ok=false but review pass? | Allowlist gate (v0.2 §Change 4) already blocks integrate. Cycle adds: if review verdict was pass BUT verify ok=false, treat as "review missed a real failure" — cycle action is `cut_scope` (review must be re-issued, but that's the reviewer's bug not a recheckable one). |

## Convergence determination

**Single-pass-revised**. Phase 1+2 surfaced 3 BLOCKER + 2 MAJOR + 3 MINOR; all author-resolvable via concrete text fixes. No round-2 phase 1 needed because:

- All findings are about proposal-text precision, not about choosing between candidates (Candidate A vs B was confirmed correct)
- The revisions are mechanical: rename version, rewrite cycle action schema, add composition section, drop retryPendingFor, unify cut_scope handling
- No new BLOCKER expected from revision (skill rule "若修订引入新 BLOCKER → 回 round 2"); revisions tighten the proposal, don't expand surface

If after v2 revision a re-read still surfaces BLOCKER, then round 2 cross-review is mandatory per skill rule.

## Risk noted

This v3 cycle pattern surfaces a **new methodology lesson** for proposals
that touch runner state machine + cross-stage_run semantics:

> When a proposal claims "retry on same stageRunId", the cross-review
> MUST resolve which stage_run id the proposal means at every use
> site, because review verdict's stageRunId and the stage being retried
> are typically DIFFERENT stage_runs. Hand-wave language passes Claude
> arch lens but fails cross-correctness fact-check.

Candidate memory record (post-ship; via Phase 2.D #1 CLI):

```yaml
stage: review
failurePattern: "Proposal involving multi-stage retry uses 'same stageRunId' phrasing without disambiguating between source-verdict stageRunId and target-retry stageRunId. Schema does not declare which stage_run an id points to; convention is producing-stage but cross-stage_run retry violates the convention."
fix: "When a proposal touches cross-stage_run retry or cycle semantics, the cross-review checklist MUST include: open AisepReviewVerdictSchema + AisepArtifactSchema + AisepAttemptSchema, confirm each stageRunId field's semantic (producing vs target); every proposal use of 'stageRunId' must specify which one."
appliesTo: { stage: [review], domain: [*], techStack: [*] }
```

## Implementation plan (Step 6 + 7 this session)

1. **Revise proposal to v2** (this session): incorporate all 8 accepted findings.
2. **NOT implement** (skill rule: revisions must land before implementation). 
3. **Memory record candidate** above to be recorded next session via `aisep memory record`.
4. Implementation (Pilot-08 + ship aisep-protocol@0.4.0) deferred — too much work for current session capacity; v3 cycle is a 4-week milestone per plan, single-session implementation was never realistic.
