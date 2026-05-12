# Proposal: AISEP v3 cycle — review→implement loop + multi-attempt stage_run

> Status: **DRAFT v1** — pending cross-review per R5 (protocol changes need
> ADR-lite + cross-review). Marked Phase 2.E #2 in backlog.
> Date: 2026-05-12
> Branch: `feat/aisep-bootstrap`
> Author: Claude Opus 4.7
> Reviewers (pending): vessel-architect (Claude), reviewer-cross (cursor-agent)
> Mode: `contract` (per harness-review-workflow — schema/runner contract)
> Triggers: closes Phase 2.E #1/#2 carve-out (M5 enforcement wire-up needs
> multi-attempt stage_run); enables v3 milestone in [plan §"DAG 拓扑：分阶段
> 实施路线图 (v0 → v3)"](../../plans/ai-vessel-vessel-bubbly-noodle.md).

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

1. **Multi-attempt stage_run** — runner.runStage gains `retryOnVerdict`
   option; when caller passes the same `stageRunId` back with retry intent,
   runner creates `attemptN+1` rather than refusing.
2. **Cycle scheduler** — new module `aisep-core/src/cycle.ts`. Given
   stage_run + review verdict + verify outcome, decides next action:
   - `pass` / `pass_with_comments` → exit chain (current behavior)
   - `revise_required` → retry implement on same stageRunId (increment
     attempt counter; pass review comments as memory hits)
   - `request_reverify` → re-run verify on same target (via existing
     `aisep verify --recheck` machinery + emit fresh verify_report
     artifact)
   - cap exceeded (`checkM5Cap` returns `capExceeded=true`) → refuse,
     emit `cut_scope` artifact, exit chain failed
3. **CLI driver** — `aisep run --cycle` (default off in v0; opt-in via
   flag until 1 dogfood pilot proves stability). When on, the run loop
   in `aisep-cli/src/commands/run.ts` calls cycle scheduler after each
   review stage.
4. **Wire `checkM5Cap` into runner** — review stage retry path calls
   `checkM5Cap(priorVerdicts)`; counter rejects 3rd round per
   methodology M5.
5. **Store API additions**:
   - `store.listReviewVerdictsByStageRun(stageRunId): AisepReviewVerdictKind[]` —
     parses review_verdict artifacts and returns ordered verdict list
   - `store.markStageRunRetrying(stageRunId)` — state-machine transition
     `succeeded` → `running` allowed iff retry intent (currently blocked
     by `assertTransition`)

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
| Q1 | **Data model — zod-expressible?** | (a) New `AisepCycleAction` discriminated union ({done | retry | recheck | cut_scope}); (b) New artifact kind `cycle_decision` (audit trail of each cycle step). Both fit existing AisepArtifactSchema discriminated union pattern. |
| Q2 | **Protocol — wire format frozen?** | aisep-protocol bumps from 0.2.0 → 0.3.0 (minor — new artifact kind enum value, new schema). Backward-compat: v0.2 consumers see no cycle artifacts (chain is single-pass), so they parse fine. |
| Q3 | **Compatibility — existing invariants hold?** | R3/R4 unaffected. R6 reinforced (cycle.ts is pure; runner.runStage gains state, but still injects all side effects via workspace). R11 unaffected. R7 (self-host gate): **reaffirmed** — cycle is single-`stageRunId` scoped, no self-modification. |
| Q4 | **Irreversible decisions?** | (a) state-machine `succeeded → running` allowed iff retry intent (relaxes M1 invariant per methodology L339 — current M1 wording forbids this). RISK-M1 needed. (b) `attemptN` semantics expand from "ad-hoc retry counter" to "load-bearing M5 counter source" — value 0..MAX_INT, used in cap check. (c) Cycle vs no-cycle modes — `--cycle` opt-in default off until 1 Pilot ships. |
| Q5 | **Permissions** | No new fs / net / exec surface. cycle.ts is pure. |
| Q6 | **Resource contention** | Single-stage_run cycle; no parallel attempt within one stageRunId (that's v1 fan-out's concern). state.json write contention same as v0 (atomic-rename). |
| Q7 | **Rollback** | Per-cycle: revert specific commit. Per-run: `--cycle=off` flag disables cycle entirely (existing v0 single-pass path remains). LKG snapshot: aisep-protocol@0.2.0 + Phase 2.E #1 ship is the LKG before v3. |

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

- **aisep-protocol**: 0.2.0 → 0.3.0 (minor — adds `cycle_decision`
  artifact kind + AisepCycleAction discriminated union)
- **aisep-core**:
  - `runner.runStage` accepts `{retryStageRunId?, attemptHint?: number}`
  - new file `aisep-core/src/cycle.ts` — pure function
    `nextAction(verdict, m5State): AisepCycleAction`
  - `store.listReviewVerdictsByStageRun()` + `markStageRunRetrying()` new
    methods
  - `state-machine.ts` `assertTransition` allows `succeeded → running`
    iff `intent === "retry"` (new param)
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
| RISK-CYCLE-INF | Cycle loops forever despite M5 (e.g. bug in counter) | `aisep run --cycle-cap N` hard limit + `cycle_decision` artifact on every iteration (full audit trail). Default N=2 per M5. Hard ceiling N=10 regardless of flag (defense-in-depth). |
| RISK-M1-RELAX | `succeeded → running` allowed for retry; consumer may interpret a `succeeded` row as "final" when retry is pending | New protocol field `retryPendingFor: stageRunId[]` on AisepStageRun makes pending retries explicit. Consumers checking "is this run final?" must check `retryPendingFor.length === 0`. |
| RISK-COUNTER | M5 counter under-counts (legitimate revise_required missed) or over-counts (implement retry mistakenly counted) | `checkM5Cap` already filters on verdict kind (Phase 2.E #1 unit-tested); add integration test in v3 dogfood pilot for both cases. |
| RISK-OPT-OUT | `--cycle` default off means feature ships dark; users may never enable | Pilot-08 ships with `--cycle` on AND a v0-equivalent control (Pilot-08-control runs `--cycle=off` same seed; verify cycle behavior is the ONLY diff). Default flip to on in v3.1. |
| RISK-Q4-a | `attemptN` semantic expansion makes old data ambiguous | `attemptN` in v0.2 data is always 1 (no multi-attempt was possible); semantic expansion is forward-only. v0.2 → v0.3 migration verified clean. |
| RISK-NESTED | Cycle within cycle (cycle action retries implement, which has its own retry mechanism for flaky tests) | Cycle is one-level: only review-stage verdicts trigger cycle. Sub-stage retry (flaky test rerun) stays internal to that stage's runner logic and does NOT increment the M5 cycle counter (only review verdicts do). |

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

**Review trail**: pending Phase 1 cross-review.

## Dogfood gate

Before merging v0.3 to `dev`:

1. Implement Candidate A end-to-end (≤ 400 LOC per implement.hbs cap)
2. Add `cycle.test.ts` unit tests for nextAction state machine (cover
   all 4 actions + edge cases)
3. **Pilot-08 (two-phase acceptance)**:
   - Phase 8a: same seed as Pilot-04/05/06/07, `--cycle` on, force one
     false-positive on verify (truncated hand-off). Cycle MUST emit
     `recheck` → flip `request_reverify` → re-issue review → `pass`.
     End-to-end ≤ 20 min (current 12 min + 1 cycle round).
   - Phase 8b: M5 boundary — force 3 consecutive `revise_required`.
     Cycle MUST emit `cut_scope` on the 3rd, store the
     `cycle_decision` artifact with `action: "cut_scope"`.
   - Phase 8c: control — same seed, `--cycle` off, confirm v0.2
     single-pass behavior unchanged (regression guard).
4. Record retrospective `docs/aisep/retrospectives/pilot-08-v3-cycle-2026-05-NN.md`
5. After Pilot-08 passes: tag `aisep-protocol@0.3.0`

## Next steps (post cross-review)

1. Run `harness-review-workflow` `contract` mode on this proposal
2. Address Phase 1+2+3 findings (≤ 2 ping-pong rounds per M5)
3. Implement Candidate A per Migration plan
4. Pilot-08 + retrospective
5. Tag + memory record cycle-related findings

Until cross-review converges, **DO NOT** implement (R5).
