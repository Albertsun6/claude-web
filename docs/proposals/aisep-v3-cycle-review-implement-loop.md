# Proposal: AISEP v3 cycle — review→implement loop + multi-attempt stage_run

> **Status: v2 — REVISE_REQUIRED → REVISED** (post-Phase 1+2+3 cross-review,
> 2026-05-12). Re-read with fresh eyes recommended before implementation.
> Date: 2026-05-12
> Branch: `feat/aisep-bootstrap`
> Author: Claude Opus 4.7
> Reviewers: harness-architecture-review (Claude), reviewer-cross (cursor-agent gpt-5.5-medium)
> Mode: `contract` (per harness-review-workflow — schema/runner contract)
> Triggers: closes Phase 2.E #1/#2 carve-out (M5 enforcement wire-up needs
> multi-attempt stage_run); enables v3 milestone in [plan §"DAG 拓扑：分阶段
> 实施路线图 (v0 → v3)"](../../plans/ai-vessel-vessel-bubbly-noodle.md).
>
> **Review trail**:
> - `docs/reviews/aisep-v3-cycle-arch-2026-05-12-2030.md` (Phase 1 arch: REVISE_REQUIRED, 5 findings)
> - `docs/reviews/aisep-v3-cycle-cross-2026-05-12-2030.md` (Phase 1 cross: REQUIRES-PHASE-2, 5 findings)
> - `docs/reviews/aisep-v3-cycle-react-arch-2026-05-12-2030.md` (Phase 2 arch reacts; adopts B.F2 as A.F6 BLOCKER + B.F4 as A.F7)
> - `docs/reviews/aisep-v3-cycle-react-cross-2026-05-12-2030.md` (Phase 2 cross reacts)
> - `docs/reviews/aisep-v3-cycle-arbitration-2026-05-12.md` (8/8 accept; 3 BLOCKER + 2 MAJOR + 3 MINOR)
>
> **v1 → v2 substantial revisions** (the proposal was REVISE_REQUIRED, not single-pass-converged like v0.2/v1):
> - Version target corrected `0.3.0 → 0.4.0` (was `0.2.0 → 0.3.0` — collided with v1 fan-out which converged at 0.3.0)
> - **`AisepCycleAction.retry` schema explicitly disambiguates source-verdict-stageRunId vs target-retry-stageRunId** (closes A.F6/B.F2 load-bearing BLOCKER)
> - Added §"Composition with v1 fan-out" for per-child-sub-stage cycle action targeting
> - Dropped `retryPendingFor` schema field — pending retry state derivable from latest `cycle_decision` artifact
> - `cut_scope` unified as `AisepCycleAction` value (NOT a separate artifact kind); ONE new artifact kind: `cycle_decision`
> - Added concrete zod schema diff for `AisepCycleAction` + `AisepCycleDecisionArtifact` in §Q1
> - `--cycle-cap N` clamped to `N ≤ M5_CAP_THRESHOLD` at CLI parse
> - Pilot-08a force-injection method specified (PromptCompiler MAX_BYTES test override)
> - New §"M1 retry transition" section spelling out `assertRetryTransition` API

## Context

**Current limitation (v0.2)**: AISEP chain is single-pass per stage_run.
Each `aisep run --real` creates 10 fresh stage_runs (one per stage),
runs each ONCE, then exits. There's no machinery for:

- review verdict `revise_required` or `request_reverify` triggering an
  implement re-attempt on the same content
- multi-attempt stage_run accumulating verdicts toward the M5 ping-pong
  cap (Phase 2.E #1 `checkM5Cap` exists as pure function but never
  fires because counter never accumulates)
- `aisep verify --recheck` flipping a single contract_grep and re-
  issuing review without re-running upstream stages

**What's missing**: a cycle scheduler that consumes review verdict +
verify outcome, decides "retry which stage?", and increments
`attemptN` on the existing stage_run rather than creating a new one.

**Why now**: Phase 2.D shipped 14 backlog items (incl. `request_reverify`
verdict + `aisep verify --recheck` CLI). Both expect a runner that can
loop back to implement/verify based on review feedback. Without v3 cycle,
those features are vestigial — they emit but no consumer reacts.

**Plan reference**: v0 → v3 DAG roadmap explicitly assigns "review→revise
cycle" to v3 ([ai-vessel-vessel-bubbly-noodle.md](../../plans/ai-vessel-vessel-bubbly-noodle.md)
§"DAG 拓扑"). This proposal is the v3 architecture brief equivalent.

## Scope

**In scope**:

1. **Multi-attempt stage_run** *(v2 — clarified per A.F6/B.F2)* —
   `runner.runStage` gains `targetStageRunId?: OpaqueId` option. When
   present, runner DOES NOT create a new stage_run; it dispatches a new
   `attemptN+1` against the existing stage_run referenced by
   `targetStageRunId`. State-machine transition `succeeded → running`
   gated on new `assertRetryTransition(prevStatus, prevAttemptN,
   newAttemptN)` function (v2 — closes A.F2/B.F3 MAJOR; no `intent`
   param hand-wave, no `retryPendingFor` schema field).
2. **Cycle scheduler** *(v2 — explicit dual-stageRunId per A.F6/B.F2)* —
   new module `aisep-core/src/cycle.ts`. Given a **review verdict**
   (which has its own `sourceReviewStageRunId`) + verify outcome +
   parent manifest (if v1 fan-out), decides next action via
   `nextAction(verdict, m5State, parentManifest?): AisepCycleAction`:
   - `{action: "done"}` — verdict ∈ {pass, pass_with_comments}; exit chain
   - `{action: "retry", sourceReviewStageRunId, targetStageRunId,
      targetStage: "implement" | "verify", newAttemptN}` — verdict ===
     `revise_required`; targetStageRunId is the implement stage_run that
     produced the patch under review (NOT the review's own stageRunId)
   - `{action: "recheck", sourceReviewStageRunId, targetVerifyStageRunId,
      checkId}` — verdict === `request_reverify`; recheck the verify
     stage_run's specific contract_grep check via `aisep verify
     --recheck --check-name <checkId>`
   - `{action: "cut_scope", sourceReviewStageRunId, reason}` —
     `checkM5Cap(priorVerdicts).capExceeded === true`; emit
     `cycle_decision` artifact, parent stage_run terminal `failed`
3. **CLI driver** — `aisep run --cycle [--cycle-cap N]` (default off; N
   defaults to M5_CAP_THRESHOLD=2). Validated at CLI parse:
   `N ≤ M5_CAP_THRESHOLD` per B.F5 (cycle-cap NEVER exceeds the
   methodology red line; user can ratchet DOWN, never UP). Run loop in
   `aisep-cli/src/commands/run.ts` calls cycle scheduler after each
   review stage when `--cycle` on.
4. **Wire `checkM5Cap` into runner** — review stage retry path calls
   `checkM5Cap(priorVerdicts)`; counter keyed on
   `sourceReviewStageRunId` (NOT target retry stage_run). Counter
   rejects 3rd blocking verdict per methodology M5.
5. **Store API additions**:
   - `store.listReviewVerdictsByStageRun(stageRunId): AisepReviewVerdictKind[]` —
     reads review_verdict artifacts (parses content) and returns
     verdict list ordered by attempt sequence
   - `store.dispatchRetryAttempt(targetStageRunId, executor): Promise<AisepAttempt>` —
     creates new attempt (attemptN = latestAttemptN+1) on EXISTING
     stage_run; does NOT create new stage_run row. Internally calls
     `assertRetryTransition` for state machine guard.
6. **`AisepCycleDecisionArtifact` (NEW artifact kind, single one)** —
   `cycle_decision` added to `AisepArtifactKindSchema` enum. Content
   shape per §Q1 schema diff below. ONE new artifact kind only
   (NOT `cut_scope` as separate kind — that's a value of `action`).

**Explicit non-scope**:

- ❌ Dynamic subgraph (LangGraph-style agent-emitted graph patches) —
  defer to v3.1 / future research
- ❌ Self-host loop (AISEP modifying AISEP) — defer per Q5 user decision
  + R7 red line invariants
- ❌ Parallel branches within retry (one branch passes, one revises) —
  v1 fan-out concern; v3 cycle assumes serial retry
- ❌ Cross-`stageRunId` cycle (e.g. retry whole 10-stage chain) — explicit
  out-of-scope. Per methodology M5 L343, cap is per `stageRunId`.

## Candidate designs

### Candidate A: Push-driven runner state machine (recommended)

Runner owns the cycle state. After review.runStage emits a verdict, runner
calls `cycle.next(verdict, store)` which returns one of:
- `{action: "done"}`
- `{action: "retry", stage: "implement", contextHints: {memoryHits: [...]}, predecessorId}`
- `{action: "recheck", stage: "verify", checkId: "..."}`
- `{action: "cut_scope", reason: "..."}`

Runner loop applies the action. Each iteration increments `attemptN` on
the referenced stage_run.

**Pros**: state machine is centralized in runner; CLI is thin.
**Cons**: runner gains complexity (currently very simple per-stage
executor).

### Candidate B: Event-driven CLI orchestrator

Cycle scheduler lives in `aisep-cli/src/commands/run.ts`; runner stays
single-stage. CLI parses review verdict + verify outcome, decides next
stage to run, calls `runner.runStage(stage, {retryStageRunId})`.

**Pros**: runner stays simple; cycle logic stays at the orchestration
layer.
**Cons**: cycle logic is CLI-coupled — future non-CLI drivers
(e.g. a future dashboard) re-implement the same loop.

### Recommendation: **Candidate A** (Push-driven runner state machine)

Reasons:
1. Cycle is core methodology behavior (M5 enforcement is "aisep-core 强制"
   per L343 verbatim — not CLI's job).
2. CLI as orchestrator violates the layered design — orchestration
   logic should live with the entity that knows about stage_run state.
3. Cycle.ts module is pure (Phase 2.E #1 already proved this pattern
   works for checkM5Cap); it composes well with runner.

Alternative comparison: Candidate B was viable in v0 (when there was no
cycle), but adding cycle to CLI now would re-create the layering
violation that R6 explicitly avoids.

## 7-question anchor gate

| # | Question | Answer |
|---|----------|--------|
| Q1 | **Data model — zod-expressible?** *(v2 detailed schema diff)* | See §"Schema diff (zod)" below — concrete `AisepCycleAction` discriminated union with 4 variants (done / retry / recheck / cut_scope), each with explicit `sourceReviewStageRunId` / `targetStageRunId` / `checkId` / `reason` fields. ONE new artifact kind `cycle_decision` whose content carries an `AisepCycleAction`. `cut_scope` is an action value, NOT a separate artifact kind (closes A.F7/B.F4). |
| Q2 | **Protocol — wire format frozen?** *(v2 corrected per A.F1/B.F1)* | aisep-protocol bumps from **0.3.0 → 0.4.0** (v1 fan-out converged at 0.3.0 first; v3 cycle comes next). Minor bump: new enum value + new schema; backward-compat: v0.3 consumers see no cycle artifacts (chain may be single-pass if `--cycle` off), parse fine. |
| Q3 | **Compatibility — existing invariants hold?** | R3/R4 unaffected. R6 reinforced (cycle.ts pure; runner.runStage gains state but still injects all side effects via injected executor + store; new `dispatchRetryAttempt` is on store API, runner stays R6). R11 unaffected. R7 (self-host gate): **reaffirmed** — cycle scoped to single `targetStageRunId`, never modifies AISEP itself; cycle_decision artifacts are audit-only outputs, not graph patches. M1 invariant **relaxed** specifically for retry transitions (`succeeded → running` allowed via `assertRetryTransition` only) — see §"M1 retry transition" below. **Composition with v1 fan-out**: see §"Composition with v1 fan-out" below. |
| Q4 | **Irreversible decisions?** *(v2 sharpened)* | (a) State-machine `succeeded → running` allowed iff caller uses `assertRetryTransition` AND `newAttemptN === prevAttemptN + 1` (NOT a bare `intent` flag; the function-level signature carries the safety guarantee). RISK-M1-RELAX still applies but explicit assertion closes the silent-overwrite footgun. (b) `attemptN` semantics: was "ad-hoc retry counter", now "load-bearing M5 counter source"; per-attempt-N is immutable per existing M2 invariant. (c) Cycle vs no-cycle: `--cycle` opt-in default off until Pilot-08 ships. |
| Q5 | **Permissions** | No new fs / net / exec surface. cycle.ts is pure. |
| Q6 | **Resource contention** | Single-stage_run cycle; no parallel attempt within one stageRunId (that's v1 fan-out's concern). state.json write contention same as v0 (atomic-rename). |
| Q7 | **Rollback** | Per-cycle: revert specific commit. Per-run: `--cycle=off` flag disables cycle entirely (existing v0 single-pass path remains). LKG snapshot: aisep-protocol@0.2.0 + Phase 2.E #1 ship is the LKG before v3. |

## Schema diff (zod) *(v2 new — per A.F5/B.F4)*

```typescript
// packages/aisep-protocol/src/cycle.ts (NEW FILE in v0.4)

import { z } from "zod";
import { OpaqueIdSchema } from "./common.js";
import { AisepStageSchema } from "./stage.js";

const CycleActionDoneSchema = z.object({
  action: z.literal("done"),
});

const CycleActionRetrySchema = z.object({
  action: z.literal("retry"),
  /** Where the verdict came from (M5 counter keyed here). */
  sourceReviewStageRunId: OpaqueIdSchema,
  /** Where retry executes (typically implement; can be verify too). */
  targetStageRunId: OpaqueIdSchema,
  targetStage: z.enum(["implement", "verify"]),
  newAttemptN: z.number().int().min(2),
  /** Optional comment chain to feed retry as memoryHits. */
  memoryHints: z.array(z.string()).default([]),
});

const CycleActionRecheckSchema = z.object({
  action: z.literal("recheck"),
  sourceReviewStageRunId: OpaqueIdSchema,
  targetVerifyStageRunId: OpaqueIdSchema,
  /** Same regex as AisepReviewVerdict.requestReverify.checkId */
  checkId: z.string().regex(/^[A-Za-z0-9_.:-]+$/),
});

const CycleActionCutScopeSchema = z.object({
  action: z.literal("cut_scope"),
  sourceReviewStageRunId: OpaqueIdSchema,
  /** Why cap exceeded — quote latest blocking-verdict comment. */
  reason: z.string().min(1).max(500),
});

export const AisepCycleActionSchema = z.discriminatedUnion("action", [
  CycleActionDoneSchema,
  CycleActionRetrySchema,
  CycleActionRecheckSchema,
  CycleActionCutScopeSchema,
]);
export type AisepCycleAction = z.infer<typeof AisepCycleActionSchema>;
```

`AisepArtifactKindSchema` enum (in `artifact.ts`) gains one value:
`"cycle_decision"`. The artifact content stores an `AisepCycleAction`
(serialized to JSON in `contentInline` for inline-storage variant; or
as a file with same JSON content for file-storage variant).

## M1 retry transition *(v2 new — per A.F2/B.F3)*

Current `state-machine.ts` `assertTransition(from, to)` allows
`pending → running → {succeeded, failed, cancelled, skipped}` but
**rejects** `succeeded → running`. v3 cycle needs to bump `attemptN`
on a stage_run whose previous attempt status was `succeeded` (case 1)
or `failed` (case 2, retry after fix).

New function:

```typescript
// packages/aisep-core/src/state-machine.ts

/**
 * Asserts that bumping attemptN on a stage_run from previousStatus to
 * "running" is safe under M5 + M1 invariants. Caller MUST hold a
 * cycle_decision artifact indicating the retry intent (audit trail).
 *
 * Allowed: previousStatus ∈ {"succeeded", "failed"} AND
 *          newAttemptN === prevAttemptN + 1
 * Rejected: any other transition (silent overwrite of intermediate states,
 *           skipping attempt counter, etc.)
 */
export function assertRetryTransition(
  previousStatus: AisepStageStatus,
  prevAttemptN: number,
  newAttemptN: number,
): void {
  if (previousStatus !== "succeeded" && previousStatus !== "failed") {
    throw new Error(`M1: cannot retry from status=${previousStatus}; only succeeded or failed permits retry`);
  }
  if (newAttemptN !== prevAttemptN + 1) {
    throw new Error(`M1: retry must bump attemptN by exactly 1; got ${prevAttemptN}→${newAttemptN}`);
  }
}
```

Existing `assertTransition` keeps the original strictness (no `succeeded
→ running`). The retry path uses `assertRetryTransition` instead.

This is **NOT** an `intent` param hand-wave: the function name itself
documents the assertion's scope, the parameters force the caller to
provide the attempt counters, and the failure modes are explicit. M1
relaxation is bounded to "retry path with explicit attemptN bump".

## Composition with v1 fan-out *(v2 new — per A.F3)*

v1 fan-out (converged at 0.3.0) introduces `fanOutRole: "normal" |
"parent" | "child"` on `AisepStageRunSchema`. When v3 cycle composes
with v1 fan-out:

**Case 1 — Parent fan-out implement, single review verdict over patch_set, request_reverify**:

If review verdict is `request_reverify` with `checkId` pointing into a
specific child patch (e.g. `checkId: "patch-backend.cross-references-section"`),
cycle action is:

```typescript
{
  action: "recheck",
  sourceReviewStageRunId: <review-id>,
  targetVerifyStageRunId: <verify-id>,
  checkId: "patch-backend.cross-references-section",
}
```

`aisep verify --recheck --check-name <checkId>` re-runs ONLY that
specific check (the existing v0.2 CLI is already check-name scoped). No
sibling child's stage_run touched.

**Case 2 — Parent fan-out implement, verdict revise_required, retry one child**:

If review verdict cites a specific child's patch in `comments[].target`,
cycle action targets THAT child's stage_run:

```typescript
{
  action: "retry",
  sourceReviewStageRunId: <review-id>,
  targetStageRunId: <child-implement-id>,    // child, not parent
  targetStage: "implement",
  newAttemptN: <child.attemptN + 1>,
}
```

When the child completes the new attempt, the parent
`fanOutRole: "parent"` stage_run's manifest is regenerated to point at
the new child attempt's patch, then verify re-runs on the updated
manifest. The parent stage_run itself does NOT change `attemptN` — only
the targeted child does.

**Case 3 — Parent fan-out implement, multiple children flagged in one review**:

If review wants multiple children retried, that's `revise_required` at
the parent level — cycle action retries the PARENT
`fanOutRole: "parent"` stage_run, which the scheduler then re-fans-out
to all children. This is the "logical task changed" case (per v1 §"M5
composition Case 2" carve-out — re-plan resets counter).

**M5 counter**: ALWAYS keyed on `sourceReviewStageRunId` per Case 1/2/3,
not on `targetStageRunId`. Why: the M5 cap is about "how many times has
the reviewer disagreed", which is review-side. Per-child retry doesn't
reset the review's M5 counter unless re-plan happens.

## Adversarial self-review (3 strongest counter-arguments)

1. **"v0 single-pass already 'works' (Pilot-04/05/06/07 all shipped) —
   why introduce cycle complexity now?"** Skeptical reviewer: cycle adds
   state machine + new schemas + risk of infinite loops; benefit is
   theoretical (request_reverify already works via CLI re-run flow).
   **Rebuttal**: request_reverify currently requires *human* re-run
   (proposal v0.2 §"Dogfood gate" item 4 explicitly says "maintainer
   runs `aisep verify --recheck`"). Cycle automates that step, which
   is the difference between "tool that requires a human in the loop
   per cycle" and "tool that can iterate while user is AFK". Pilots
   1-7 took 12-15 min each; with cycle, Pilot-N could automatically
   close a known false-positive in 30 sec without human input. That
   is the meaningful productivity gain — not "we ship something v0
   couldn't". `request_reverify` was always designed as an automation
   hook, not a manual-only path.

2. **"M1 state-machine invariant relaxation is dangerous."** Skeptical
   reviewer: `succeeded → running` is currently forbidden (state.json
   `assertTransition` raises). Allowing it for retry intent opens
   "succeeded result silently overwritten by retry" footgun.
   **Rebuttal**: retry creates `attemptN+1`, NOT mutates `attemptN`'s
   record. Each attempt is immutable per existing M2 invariant. The
   state transition is `(succeeded, attemptN=K) → (running, attemptN=K+1)`,
   not `(succeeded, attemptN=K) → (running, attemptN=K)`. Add explicit
   `assertRetryTransition(prevAttemptN, newAttemptN)` to catch the
   footgun at the schema layer. RISK-M1 row mitigates this.

3. **"Cycle counter (`attemptN >= 3` triggers M5) is keyed on the wrong
   thing — what if implement retries 3 times for legitimate flaky reason
   but review only had 1 revise_required?"** Skeptical reviewer:
   methodology L343 caps "review revise_required" specifically; v3's
   cycle counter may incorrectly count implement retries.
   **Rebuttal**: `checkM5Cap(priorVerdicts)` already exists (Phase 2.E #1)
   and filters specifically on verdict kind, not attemptN. Cycle uses
   `priorVerdicts = store.listReviewVerdictsByStageRun(stageRunId)` —
   only review verdicts counted, implement retries don't pollute the
   counter. This was explicitly designed in Phase 2.E #1 to avoid the
   exact failure mode you describe.

## Migration

- **aisep-protocol** *(v2 — corrected version)*: **0.3.0 → 0.4.0**
  (minor; new artifact kind `cycle_decision` + `AisepCycleAction`
  discriminated union; one schema file added: `cycle.ts`)
- **aisep-core**:
  - `runner.runStage` accepts new optional `targetStageRunId?: OpaqueId`
    parameter. When present, dispatches retry on existing stage_run
    via `store.dispatchRetryAttempt` (NOT `createStageRun`).
  - new file `aisep-core/src/cycle.ts` — pure function
    `nextAction(verdict: AisepReviewVerdict, m5State: M5CheckResult,
    parentManifest?: PatchSetManifest): AisepCycleAction`
  - `store.listReviewVerdictsByStageRun()` — new method, parses
    review_verdict artifacts via `AisepReviewVerdictSchema`, returns
    verdict-kind list in attempt order
  - `store.dispatchRetryAttempt(targetStageRunId, executor)` — new
    method, creates new attempt (attemptN+1) on existing stage_run,
    transitions stage_run from `succeeded` or `failed` back to
    `running` via `assertRetryTransition`
  - `state-machine.ts` gains `assertRetryTransition(previousStatus,
    prevAttemptN, newAttemptN)` — see §"M1 retry transition" above
- **aisep-cli**:
  - `aisep run --cycle [--cycle-cap N]` (default off, N=2 per M5)
  - run loop calls runner.runStage in a `while (cycleAction !== "done")`
    loop when `--cycle` is on
- **aisep-agents**: no template change (review.hbs / verify.hbs / etc.
  already emit the right artifacts; cycle consumes them)
- **methodology doc**: 02_methodology-v0.1.md §"2.8 review" → §"2.9
  integrate" gain a "Cycle behavior" subsection documenting cycle
  semantics
- **No vessel mainline change** (R3 holds)

## Risks

| ID | Risk | Mitigation |
|----|------|-----------|
| RISK-CYCLE-INF | Cycle loops forever despite M5 (e.g. bug in counter) | `--cycle-cap N` hard limit clamped to `N ≤ M5_CAP_THRESHOLD=2` at CLI parse (per B.F5). `cycle_decision` artifact emitted every iteration (full audit trail). |
| RISK-M1-RELAX *(v2 sharpened)* | `succeeded → running` allowed via `assertRetryTransition`; consumers may misread a `succeeded` row as "final" when retry is pending | **Derive pending-retry state from latest `cycle_decision` artifact** (per arbitration: drop `retryPendingFor` schema field). Consumer asks: "is there a `cycle_decision` artifact on this stage_run with `action: "retry"` AND attemptN matches the targeted bump that hasn't happened yet?" If yes, retry is pending. Audit trail in artifact. |
| RISK-COUNTER | M5 counter under-counts (legitimate revise_required missed) or over-counts (implement retry mistakenly counted) | `checkM5Cap` already filters on verdict kind (Phase 2.E #1 unit-tested); `nextAction` keys M5 on `sourceReviewStageRunId` ONLY (not on targetStageRunId); per-child retry doesn't pollute review's M5 counter (per §"Composition with v1 fan-out"). Add integration test in Pilot-08 boundary phase. |
| RISK-OPT-OUT | `--cycle` default off means feature ships dark | Pilot-08 ships with `--cycle` on AND control (Pilot-08-control runs `--cycle=off` same seed; verify cycle is ONLY diff). Default flip to on in v0.4.1. |
| RISK-Q4-a | `attemptN` semantic expansion makes old data ambiguous | `attemptN` in v0.2 data is always 1 (no multi-attempt was possible); semantic expansion is forward-only. v0.3 → v0.4 migration verified clean by pre-flight script. |
| RISK-NESTED | Cycle within cycle (cycle action retries implement, which has its own retry mechanism for flaky tests) | Cycle is one-level: only review-stage verdicts trigger cycle. Sub-stage retry (flaky test rerun) stays internal to that stage's runner logic and does NOT increment the M5 cycle counter (only review verdicts do). |
| **RISK-FANOUT-COMPOSITION** *(v2 new — per A.F3)* | v1 fan-out parent reviewed by single review verdict; cycle action must correctly identify whether to retry parent OR a specific child | nextAction signature takes `parentManifest?: PatchSetManifest` argument; if reviewer's `requestReverify.checkId` matches a child patch's prefix (e.g. `patch-backend.*`), cycle targets that child's stage_run. Otherwise targets parent. See §"Composition with v1 fan-out" Case 1/2/3 worked examples. |
| **RISK-CROSS-STAGE-RUN** *(v2 new — per A.F6/B.F2)* | Cycle action targets a stage_run different from the one that produced the verdict; runner machinery did not support cross-stage_run dispatch in v0.x | NEW machinery in v0.4: `store.dispatchRetryAttempt(targetStageRunId, executor)` adds an attempt to an existing stage_run. `runner.runStage` gains `targetStageRunId?` parameter to dispatch via this method. Without this v3 cycle CANNOT ship — it's the central new runner capability. |

## ADR-lite

**Context**: AISEP v0.2 shipped `request_reverify` verdict + `aisep verify
--recheck` CLI + Phase 2.E #1 M5 cap pure function. None of these can fire
automatically — they all wait for a human to drive the next action.
Closing the loop (cycle scheduler) was explicitly deferred to v3 in the
plan roadmap and the v0.2 cross-review post-arbitration discovery.

**Decision**: Implement Candidate A (push-driven runner state machine).
Cycle scheduler lives in `aisep-core/src/cycle.ts` as a pure function;
runner gains a retry loop; CLI exposes opt-in `--cycle` flag.

**Consequences**:

*Positive*:
- request_reverify + verify --recheck become **fully automatable** (no
  human in the loop required per cycle step)
- M5 enforcement (Phase 2.E #1 pure function) gains a runtime caller
- AISEP can iterate while user is AFK — productivity step-change

*Negative / Trade-offs*:
- M1 state-machine invariant relaxed (succeeded → running for retry);
  mitigated by RISK-M1-RELAX explicit `retryPendingFor` field
- Cycle adds complexity (new artifact kind + schema + state). Worth it
  per "rebuttal #1" — `request_reverify` was designed for cycle from
  day 1.
- Default-off opt-in means feature ships dark — RISK-OPT-OUT mitigated
  by Pilot-08 control comparison.

**Non-decisions** *(v2 new — per arbitration "Non-decisions" pattern)*:
- v3 cycle does NOT decide dynamic subgraph (agent-emitted graph patches
  at runtime) — explicit non-scope; defer to v3.1+
- v3 cycle does NOT decide self-host loop (AISEP modifying AISEP) —
  defer per Q5 user decision + R7 red line invariants
- v3 cycle does NOT decide parallel-branch-within-retry (one branch
  passes, one revises) — that's v1 fan-out's concern via the
  `fanOutRole` discriminant
- v3 cycle does NOT decide cross-`stageRunId` cycle (retry whole
  10-stage chain) — explicit non-scope per methodology M5

**Promotion gate**: this ADR moves from "Decision: candidate A" to
"Decision: implemented" only when:
1. Phase 1+2+3 cross-review converged ✓ (this revision — single-pass
   revised, 8/8 accept)
2. Pilot-08 a/b/c three-phase acceptance passed (future session)
3. v1 fan-out implementation landed first (per arbitration B.OQ1
   version coordination)
4. dependency-cruiser CI rule extended to scan cycle.ts for fs/spawn/net

**Review trail**:
- Phase 1 verdicts: `docs/reviews/aisep-v3-cycle-{arch,cross}-2026-05-12-2030.md`
- Phase 2 reacts: `docs/reviews/aisep-v3-cycle-react-{arch,cross}-2026-05-12-2030.md`
- Phase 3 arbitration: `docs/reviews/aisep-v3-cycle-arbitration-2026-05-12.md`
  (8/8 ✅ accept after substantive v1 → v2 revision)

## Dogfood gate

Before merging v0.3 to `dev`:

1. Implement Candidate A end-to-end (≤ 400 LOC per implement.hbs cap)
2. Add `cycle.test.ts` unit tests for nextAction state machine (cover
   all 4 actions + edge cases)
3. **Pilot-08 (three-phase acceptance)** *(v2 — per A.F4: force-mechanism specified)*:
   - Phase 8a: same seed as Pilot-04/05/06/07, `--cycle` on, force one
     false-positive on verify by **lowering PromptCompiler MAX_BYTES
     via test override** so verify receives truncated hand-off; verify
     emits `ok: false` on a `contract_grep` that would pass against the
     on-disk file. Reviewer emits `request_reverify` with the specific
     `checkId`. Cycle MUST emit `recheck` → re-run `aisep verify
     --recheck --check-name <checkId>` → flip `request_reverify` →
     re-issue review → `pass` → integrate `ready_to_integrate: true`.
     End-to-end ≤ 20 min (current 12 min + 1 cycle round).
   - Phase 8b: M5 boundary — force 3 consecutive `revise_required`.
     Cycle MUST emit `cut_scope` on the 3rd, store the
     `cycle_decision` artifact with `action: "cut_scope"`.
   - Phase 8c: control — same seed, `--cycle` off, confirm v0.2
     single-pass behavior unchanged (regression guard).
4. Record retrospective `docs/aisep/retrospectives/pilot-08-v3-cycle-2026-05-NN.md`
5. After Pilot-08 passes: tag `aisep-protocol@0.3.0`

## Next steps (post cross-review — single-pass-revised converged)

✅ Phase 1+2+3 cross-review converged after substantive v1 → v2 revision
(this session, 2026-05-12). Implementation permitted under R5 once v1
fan-out has landed (version coordination).

Remaining:
1. **v1 fan-out implementation lands first** (per arbitration B.OQ1
   version coordination) — `aisep-protocol@0.3.0` tag must exist before
   v3 cycle implementation begins
2. Implement Candidate A per §Migration (~600-800 LOC: cycle.ts +
   runner extension + state-machine.assertRetryTransition +
   store.dispatchRetryAttempt + store.listReviewVerdictsByStageRun)
3. Pilot-08 three-phase acceptance (future session, ~25 min wall clock)
4. Tag `aisep-protocol@0.4.0` after Pilot-08 retro sealed
5. Memory record session-derived findings via `aisep memory record`
   CLI, including:
   - "Proposal involving multi-stage retry uses 'same stageRunId'
     without disambiguating source vs target" (per arbitration risk
     note)
   - "Multi-proposal version coordination drift" (already noted in v1
     arbitration; carries forward)
