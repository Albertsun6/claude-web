# Reviewer A (architecture-fit) — AISEP v3 cycle (review→implement loop)

> Reviewer: vessel-architect (Claude Opus 4.7, 1M context)
> Lens: architecture-fit + R3-R11 invariants + plan-roadmap consistency + composition with shipped v0.2 + v1 fan-out
> Target: `docs/proposals/aisep-v3-cycle-review-implement-loop.md` (DRAFT v1)
> Mode: `contract` (per harness-review-workflow)
> Independence: Phase 1 — did NOT read cross reviewer's verdict; did NOT read author chat / transcript.
> Date: 2026-05-12 20:30

---

## Verdict (1 paragraph)

**REVISE_REQUIRED — accept with three required fixes, two recommended fixes.** The proposal correctly diagnoses the v0.2 productivity gap (request_reverify + `verify --recheck` ship as automation hooks but have no consumer), correctly identifies cycle as the v3-row deliverable per plan, and correctly picks Candidate A on layering grounds (cycle is "aisep-core 强制" per methodology M5 L343 — CLI orchestration would violate R6). However, three substantive issues require text fixes before implementation: **(F1) version target collides with the just-converged v1 fan-out arbitration** — both proposals target 0.2.0 → 0.3.0, but v1 won that slot per arbitration B.OQ1, so v3 cycle MUST be 0.3.0 → 0.4.0 (this is the *exact* mistake v1 already made and corrected per its v2 §Q2 note); **(F2) `succeeded → running` state-machine relaxation is described loosely** — the proposal's "add `intent` param" mitigation is hand-wavy and the actual `assertTransition` signature in `state-machine.ts` (line 43) takes only `from` + `to`, no intent — needs concrete signature change + explicit `assertRetryTransition(prevAttemptN, newAttemptN)` API (the §Adversarial #2 rebuttal promises this but §Migration doesn't list it); **(F3) composition with v1 fan-out's `patch_set` + Case 3 single-review-verdict semantics is not analyzed** — v1 just converged on "post-parallel review = ONE verdict over merged patch_set" with sub-stage-targeted `request_reverify.checkId`, but v3 cycle §"non-scope" only says "parallel branches within retry — v1 fan-out's concern" without spelling out how v3 `recheck` action interacts with v1's per-child `checkId`-targeted recheck path. The R3/R6/R7/R11 claims in §Q3 hold, the dogfood gate (Pilot-08 three phases) is well-scoped, ADR-lite is structurally complete. Once F1-F3 are addressed in text, this is ready to implement.

---

## Findings

### F1. Version collision with just-converged v1 fan-out — [BLOCKER]

**Where**: Proposal §Q2 (line 131); §Migration first bullet (line 180); §Dogfood gate item 5 (line 261).

**Issue**: Proposal claims `aisep-protocol: 0.2.0 → 0.3.0`. But v1 fan-out converged at 0.2.0 → 0.3.0 in its v2 (Phase 3 arbitration outcome `aisep-v1-fan-out-arbitration-2026-05-12.md`, also explicit in v1 proposal line 350 `0.3.0 → 0.4.0` Migration heading after correction and line 503 "Tag `aisep-protocol@0.3.0` (v1 first per arbitration B.OQ1)"). The v1 v2 proposal's §"Dependency on v3 cycle" (lines 474-490) and §"Next steps" item 6 (line 507-508) both EXPLICITLY say "(Future) v3 cycle cross-review + impl — `aisep-protocol@0.3.0 → 0.4.0`". v3 cycle MUST renumber.

**Why it matters**: Two proposals claiming the same version target is the *exact same drift class* that v1 caught itself with (companion `version.ts` hotfix 0.1.0 → 0.2.0 closing Phase 2.E #1 ship-time-mismatch). If v3 ships with 0.2.0 → 0.3.0 wire-frozen now and v1 also takes that slot, one of the two becomes a renumbering hotfix immediately after merge — and AisepArtifactKindSchema enum value collisions are silently impossible to detect at protocol parse time (both add new enum values).

**Recommended fix**:
1. §Q2: change to `aisep-protocol bumps from **0.3.0 → 0.4.0** (minor — assumes v1 fan-out ships first per arbitration B.OQ1; if v3 cycle ships before v1, renegotiate target to 0.2.0 → 0.3.0)`.
2. §Migration first bullet: `aisep-protocol: 0.3.0 → 0.4.0`.
3. §Dogfood gate item 5: `tag aisep-protocol@0.4.0`.
4. Add a §"Dependency on v1 fan-out" subsection mirroring v1's §"Dependency on v3 cycle" — explicit ordering note (v1 first per B.OQ1) + composition behavior (see F3).

### F2. `succeeded → running` state-machine relaxation lacks concrete API — [MAJOR]

**Where**: Proposal §Q4(a) (line 133); §Scope item 5b (line 70-71); §Adversarial #2 rebuttal (line 161-164); §Migration `state-machine.ts` line (line 188-189); §Risks RISK-M1-RELAX (line 206).

**Issue**: §Q4 says "state-machine `succeeded → running` allowed iff retry intent (relaxes M1 invariant per methodology L339 — current M1 wording forbids this)". I verified against `packages/aisep-core/src/state-machine.ts`:

- Line 12 `VALID_TRANSITIONS.succeeded: []` — currently terminal (empty list).
- Line 43 `assertTransition(from, to): void` — current signature takes ONLY `from` + `to`, NO `intent` param.
- Methodology 02_methodology-v0.1.md L339 (M1 row) verbatim: `stage_run 表 status 流转必须遵守状态机（pending → running → succeeded|failed|cancelled）` — does not enumerate `succeeded → running`, i.e. forbids it by omission.

The proposal's §Scope item 5b says `markStageRunRetrying` "state-machine transition `succeeded` → `running` allowed iff retry intent (currently blocked by `assertTransition`)" — but it does NOT specify:
1. How `intent` reaches `assertTransition` (new param? new function? new path that bypasses it?).
2. Whether `markStageRunRetrying` is the ONLY caller permitted to take the relaxed path (i.e. is there a separate `assertRetryTransition` so other callers can't accidentally do it?).
3. How the §Adversarial #2 rebuttal's promised `assertRetryTransition(prevAttemptN, newAttemptN)` actually composes with the existing single-arg `assertTransition` — is one delegating to the other, are both exported, which one does runner.runStage call?

§Risks RISK-M1-RELAX mitigation cites `retryPendingFor: stageRunId[]` on `AisepStageRun` — but this is a NEW protocol field that's not in the §Migration list and not in §Q1 schema-additions (Q1 only mentions `AisepCycleAction` discriminated union + `cycle_decision` artifact kind).

**Why it matters**: M1 is the load-bearing red line in the state-machine layer. Relaxing it "iff retry intent" with hand-wavy semantics opens exactly the "succeeded result silently overwritten by retry" footgun that the rebuttal claims to close. A consumer checking "is this stage_run final?" reads `status === 'succeeded'` and acts on it — under v3 cycle, the same row may flip back to `running` later. The mitigation needs to be CONCRETE (a new field consumers MUST check + a new explicit function call site) for R3 — protocol contracts — to hold.

**Recommended fix**:
1. §Scope item 5b: spell out the API. Recommended concrete shape:
   - Keep `assertTransition(from, to): void` strict (don't add intent param — that's a footgun magnet for any future caller passing `intent: "retry"` by mistake).
   - Add NEW function `assertRetryTransition(from, to, prevAttemptN, newAttemptN): void` that enforces `from === "succeeded" && to === "running" && newAttemptN === prevAttemptN + 1`. ONLY `markStageRunRetrying` calls this.
   - `store.markStageRunRetrying(stageRunId)` is the ONLY public entry that flips a `succeeded → running`.
2. §Migration: list `retryPendingFor: OpaqueId[]` as a new field on `AisepStageRunSchema`. (Or drop it and document the protocol-level signal differently — e.g. via the `cycle_decision` artifact existing on the stage_run being the "is retry pending" hint.)
3. §Q1: extend schema diff to include the new field + the `assertRetryTransition` API in §Migration `aisep-core` section.
4. §Q4(a): tighten language — "M1 invariant *extended* (not *relaxed*) to admit retry-intent transition with explicit `assertRetryTransition` API and immutable `(attemptN=K, succeeded) → (attemptN=K+1, running)` semantics. Each `attemptN` row remains immutable per M2 (proposal §Adversarial #2)."

### F3. Composition with v1 fan-out's `patch_set` + Case 3 review semantics not analyzed — [MAJOR]

**Where**: Proposal §Scope non-scope (line 78-79); §Q3 (line 132); whole proposal has no §"Composition with v1 fan-out".

**Issue**: v1 fan-out converged 2026-05-12 with three explicitly-named M5 composition cases (v1 §"M5 composition under fan-out"):
- Case 1: sibling sub-stages have independent counters.
- Case 2: re-plan launders counter (carve-out from m5-cap.ts L16-19).
- Case 3 (post-arbitration B.OQ3): "review stage_run is **single**, consumes the parent implement's `patch_set` manifest, produces **ONE review_verdict** artifact covering all N child patches. M5 counter is keyed on this single review stage_run."

v1 Case 3 ALSO specifies: "If reviewer wants to flag one specific child's check as false-positive, they emit verdict `request_reverify` with `requestReverify.checkId` pointing INTO the patch_set (e.g. `checkId: 'patch-backend.cross-references-section'`). v3 cycle (when it ships) re-runs ONLY that check on the specified child patch via `aisep verify --recheck --check-name <child-check-id>`."

v3 cycle proposal mentions composition with v1 only in §Scope non-scope: `❌ Parallel branches within retry (one branch passes, one revises) — v1 fan-out concern; v3 cycle assumes serial retry`. This is INCOMPLETE — v1 has *already* delegated the per-child recheck case TO v3 cycle. v3 cycle is therefore the consumer that must:
1. Parse `requestReverify.checkId` and detect when it points INTO a patch_set entry (e.g. `patch-backend.<check-id>`).
2. When `recheck` action fires, pass `--check-name` AND the implicit child-patch scope to `aisep verify --recheck`.
3. After recheck flips the check, re-issue review on the SAME parent review stage_run (single verdict over merged patch_set, per Case 3) — NOT spawn a per-child review stage_run.

The §Q3 claim "R6 reinforced (cycle.ts is pure; runner.runStage gains state, but still injects all side effects via workspace)" is correct at the cycle.ts boundary but says nothing about how the cycle scheduler decides between "child-scoped recheck" vs "whole-stage recheck" — that decision logic is missing.

**Why it matters**: This is exactly the composition contract v1 explicitly DEFERRED to v3 cycle. v1 v2 §"Dependency on v3 cycle" (line 484-490) names this hand-off. Without a §"Composition with v1 fan-out" in v3 cycle, the hand-off has no receiving spec — and v3 cycle's `nextAction(verdict, m5State)` signature in §Migration line 184 doesn't include the parent-stage `patch_set` manifest as input, so the scheduler can't know which child the `checkId` points into.

**Recommended fix**:
1. Add §"Composition with v1 fan-out" subsection. Recommended content:
   - "v1 fan-out is shipping first per arbitration B.OQ1. v3 cycle composes on top with three concrete contracts:"
   - **C1**: When `nextAction()` receives `verdict.kind === 'request_reverify'` AND the upstream stage_run is the parent implement (i.e. has non-empty `subStages: OpaqueId[]`), the cycle action is `recheck` with `scope: { kind: 'child', childStageRunId: <derived from checkId prefix> }`. The runner passes this to `aisep verify --recheck --check-name <suffix>` while restricting to that child's patch only.
   - **C2**: After recheck flips, cycle re-issues review on the SAME parent review stage_run (Case 3 single-verdict over merged patch_set is preserved). M5 counter keying matches v1 Case 3 (one counter on the parent review stage_run, not per-child).
   - **C3**: When sub-stage-level `revise_required` is emitted (parent verdict says "implement-frontend needs revision"), cycle action is `retry` with `scope: { kind: 'child', childStageRunId: ... }`. The retry recreates `attemptN+1` on that child's stage_run ONLY; siblings unaffected. Parent stage stays `running` (or transitions back from `succeeded → running` via the M1 extension from F2) until all children terminal.
2. §Migration `aisep-core/src/cycle.ts`: extend signature to `nextAction(verdict, m5State, parentManifest?: PatchSetManifest): AisepCycleAction`.
3. §Q3 R7 paragraph: explicit one-liner — "v3 cycle within v1 fan-out preserves R7 because each cycle iteration is still externally-driven (CLI `aisep run --cycle`); sibling-affecting retry is forbidden (each cycle iteration touches at most ONE stage_run / one child)."
4. Update §Scope explicit non-scope first bullet: keep "Parallel branches within retry" as out-of-scope (v3 doesn't retry siblings concurrently — that's v2 fan-in's territory), but ADD a positive clause: "v3 DOES handle per-child sequential retry within a v1 patch_set — see §Composition with v1 fan-out."

### F4. Dogfood gate Phase 8a's "force one false-positive" mechanism is unspecified — [MINOR]

**Where**: §Dogfood gate Phase 8a (line 251-254).

**Issue**: Phase 8a says "force one false-positive on verify (truncated hand-off). Cycle MUST emit `recheck` → flip `request_reverify` → re-issue review → `pass`." But the mechanism to FORCE a false positive is not specified. v0.2 dogfood gate for `aisep verify --recheck` similarly had an injection mechanism (some kind of hand-coded check artifact corruption); the proposal should either cite that mechanism or define a fresh one.

Without a defined mechanism: Pilot-08 will be hand-orchestrated (maintainer manually edits verify-report.json), which is fine for an initial dogfood but should be documented so the next session can reproduce.

**Recommended fix**: Phase 8a sub-bullet — "Force mechanism: (TBD — either re-use Pilot-04 false-positive simulation by truncating `verify-report.json.contract_grep.checks[N].evidence`, OR inject a synthetic verdict via test harness fixture)". This can stay open as an OQ; what's not okay is silence.

### F5. `cycle_decision` artifact schema is asserted to fit existing pattern but no diff shown — [MINOR]

**Where**: §Q1 (line 130).

**Issue**: §Q1 says "Both fit existing AisepArtifactSchema discriminated union pattern". But unlike v1's v2 §Q1 (which spelled out the `fanOutRole` discriminant + `superRefine` for nested-rejection), v3 cycle says nothing about the SHAPE of `cycle_decision`. v1's review converged on requiring detailed schema diffs, not just "fits the pattern". This is the same finding class A.F10/B.F1 caught in v1.

**Recommended fix**: Add to §Q1 — concrete shape sketch:
```typescript
// AisepArtifactKindSchema enum gains: "cycle_decision"
// New schema: AisepCycleDecisionSchema = z.object({
//   action: AisepCycleActionSchema,  // discriminated union { done | retry | recheck | cut_scope }
//   verdictId: OpaqueId.optional(),  // verdict that triggered this decision
//   priorVerdictCount: z.number().int().nonneg(),  // M5 counter snapshot
//   reason: z.string().max(500),
//   decidedAt: z.number().int().nonneg(),  // epoch ms
// });
```

---

## Strong points

1. **Layering rationale for Candidate A is well-argued.** The §Recommendation paragraphs (line 113-124) correctly cite methodology L343's verbatim wording ("aisep-core 强制") to justify why CLI orchestration violates R6. This is the single most important architectural call in the proposal and it gets it right. Candidate B was tempting because CLI is "thinner", but it would force every future driver (dashboard, future API) to re-implement the cycle loop — which is exactly the kind of bug surface R6 prevents.

2. **Plan-roadmap alignment is honest and tight.** v3 row in `ai-vessel-vessel-bubbly-noodle.md` §"DAG 拓扑" (line 293) explicitly assigns "**cycle + dynamic subgraph + self-host 双轨**" to v3. The proposal correctly carves OUT dynamic subgraph (§Scope non-scope line 74-75) and self-host (line 76-77), shipping ONLY the cycle portion of v3. This is well-disciplined scope — does not overreach into v3.1 (dynamic) or v3.x (self-host), and does not fall short of v3's cycle deliverable. Mid-scope is the right slice.

3. **Adversarial self-review #1 ("v0 single-pass already works, why complexify?") nails the productivity argument.** The rebuttal (line 148-153) is the strongest paragraph in the proposal: it correctly identifies that v0.2 shipped `request_reverify` + `verify --recheck` as automation hooks designed for cycle from day 1, and that without cycle they are "vestigial" (proposal's word). Productivity gain ("30 sec automatic close vs 12 min human-in-loop") is concrete and falsifiable in Pilot-08.

4. **Phase 2.E #1 `checkM5Cap` correctly identified as future-ready hook.** Verified against `m5-cap.ts` L14-19 verbatim comment: "M5 enforcement is **future-ready** for the v3 review→implement cycle (Phase 2.E #2). Until then, `checkM5Cap` is exercised only via unit tests; runner.runStage does NOT call it." The proposal explicitly is the consumer that closes that carve-out. Clean hand-off.

5. **Adversarial rebuttal #3 (counter keyed on wrong thing) correctly defends the verdict-list filtering.** The `checkM5Cap(priorVerdicts)` API takes `AisepReviewVerdictKind[]` — verified against m5-cap.ts line 67 signature. Implement retries don't pollute because they don't produce review verdicts. The rebuttal is technically correct.

6. **Dogfood gate Phase 8b (M5 boundary) + Phase 8c (control regression) discipline is sound.** Three-phase acceptance (positive happy path + M5 cap boundary + v0.2 regression control) mirrors Pilot-09's three-phase pattern in v1, which converged 13/13 accept. Same pattern here.

7. **Integrate.hbs allowlist composition is correctly understood.** Verified against `packages/aisep-agents/templates/integrate.hbs` lines 63-72: `ready_to_integrate=true` ONLY when verdict ∈ {`pass`, `pass_with_comments`}. Proposal §Scope item 2 (`pass / pass_with_comments → exit chain`) matches this exactly — cycle correctly treats those two verdicts as terminal, defers to integrate's allowlist for the actual merge gate.

---

## Open questions (≤ 3)

### OQ1. Cycle interaction with `aisep run --resume` semantics (mid-cycle crash recovery)

If `aisep run --cycle` is mid-loop (iteration 2 of 3, `attemptN=2` on implement, waiting on review) and the process crashes, what is the recovery semantic on re-run? Options:
- (a) Treat state.json as truth: read `cycle_decision` artifacts, find latest `action != done`, resume from there.
- (b) Treat crash as terminal: stage_run state stuck at `running`, require manual `aisep cycle reset <stageRunId>` to abandon and restart fresh.
- (c) Treat the in-flight `attemptN` as `cancelled`, advance to `attemptN+1` on resume.

Proposal doesn't say. v0.2 single-pass had a simple answer (re-run = fresh stage_runs). v3 multi-attempt makes this load-bearing — leaving it implicit means Pilot-08 will dogfood one of these without naming it.

### OQ2. `--cycle-cap N` (line 192) vs `M5_CAP_THRESHOLD = 2` (m5-cap.ts L24) — semantic relation?

§Migration aisep-cli line 192: `aisep run --cycle [--cycle-cap N]` (default off, N=2 per M5). §Risks RISK-CYCLE-INF mentions "Hard ceiling N=10 regardless of flag (defense-in-depth)". But m5-cap.ts already exports `M5_CAP_THRESHOLD = 2` as the authoritative methodology cap. Two questions:
1. Is `--cycle-cap` a per-stage override (e.g. user can dial DOWN to 1 for stricter cap) or a global cycle ceiling?
2. The "Hard ceiling N=10" is separately documented in RISK-CYCLE-INF — is this a third number that operates on cycle iterations broadly (verdicts + rechecks + retries), distinct from M5's per-verdict-kind 2? If so, M5_CAP_THRESHOLD = 2 cap is the methodology rule; --cycle-cap is a user-tunable; "10" is the implementation-side defense-in-depth. Worth naming explicitly so a future reader doesn't conflate the three.

### OQ3. Does `cycle.ts` `nextAction()` need to be aware of `M4` contract-freeze (methodology L342)?

M4 invariant: "contract stage 冻结后 → implement stage 不允许改 contract 文件". v3 cycle's `retry` action re-runs implement on the same predecessor (contract.md is the upstream artifact). The retry MUST NOT re-write contract.md — but cycle.ts is pure and doesn't know about M4. Is M4 enforcement entirely on the implement.hbs side (Hard limits forbid contract write) + dependency-cruiser CI rule + pre-commit hook (per methodology L342), with cycle.ts simply trusting that retry is M4-safe? If yes, this should be stated explicitly in §Q3 — cycle's purity is preserved because M4 lives in agents/CI, not in the scheduler. Worth one sentence.

---

## File written confirmation

This review is at: `/Users/yongqian/Desktop/Vessel-aisep/docs/reviews/aisep-v3-cycle-arch-2026-05-12-2030.md`

## Independence confirmation

- Did NOT read `docs/reviews/aisep-v3-cycle-cross-*.md` (Reviewer B's verdict).
- Did NOT read author chat / transcript.
- Reviews referenced for context (already-converged v1 fan-out trail) are explicit dependencies via the proposal itself + composition analysis (F3) — not for cross-pollinating B's lens.
