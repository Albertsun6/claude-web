# Phase 1 Review — architecture-fit lens
> Reviewer: harness-architecture-review (Claude Opus 4.7)
> Date: 2026-05-12
> Phase 1 (independent — did NOT read Reviewer B's verdict)
> Target: `docs/proposals/aisep-v1-fan-out.md`

## Summary verdict

**ACCEPT-WITH-CHANGES**

The proposal is well-structured, honors the v0 → v3 ladder, and correctly chooses Candidate A on architecture-fit grounds. Three substantive issues need fixing before implementation: (1) a **concrete schema collision** between the proposed `subStages?: OpaqueId[]` field and the existing `AisepStageRunSchema` discriminated union — the new fields can't just be glued onto `StageRunCommonShape`; (2) **R7 "self-host-gated" claim is asserted but not analyzed** — the proposal says "R7 unchanged" without showing why parallel-implement plus the plan-stage validator does not edge AISEP closer to AISEP-modifying-AISEP semantics; (3) the **M5 cap interaction with retries-vs-siblings** is genuinely under-specified — calling `checkM5Cap` "per-sub-stage with zero change" papers over the question of how a parent's failure-then-replan path accumulates verdicts across sibling generations. None of these blockers; all fixable with text + a clarified §"M5 composition" + a tightened §Q3.

Plan-roadmap consistency is strong (v1 row honored, no v2/v3 overreach). ADR-lite is complete. Dogfood gate is adequate but the failure-mode phase needs sharper criteria for "cancelled" vs "still-running" sibling detection.

## Findings

### F1. Schema collision: `subStages?` field collides with existing discriminated-union shape — [MAJOR]

**Where**: Proposal §Q1 (line 155) and §Migration (line 219); current schema in `packages/aisep-protocol/src/stage.ts:67-99`.

**Issue**: The proposal says (line 155):
> (a) `AisepStageRun.subStages?: array<OpaqueId>` (parent ref to children); (b) `AisepStageRun.parentStageRunId?: OpaqueId` (child ref to parent)

But `AisepStageRunSchema` is **not a flat object** — it's a `z.discriminatedUnion("phase", […])` over three `.strict()` schemas (`stage.ts:95-99`). `.strict()` rejects extras, so adding `subStages?` / `parentStageRunId?` requires either:
- Adding the fields to `StageRunCommonShape` (`stage.ts:53-65`) — then every existing variant (`AisepStageRunNoneSchema`, `AisepStageRunBriefSchema`, `AisepStageRunSliceSchema`) gains them, which is what the proposal probably means but never states; or
- Adding *another* discriminator dimension on "parent vs leaf", expanding the union from 3 to 6 variants (none-leaf, none-parent, brief-leaf, brief-parent, slice-leaf, slice-parent) which is what Candidate A "discriminates parent vs leaf" (line 105) implies — but the wire format change in §Q2 still says "minor; new optional fields", which is inconsistent with adding a discriminator.

The architecture-detail-slice path (`stage.ts:77-84`) is the precedent: sliceIndex/sliceTotal were lifted into a dedicated variant in Round-2 specifically to avoid optional-field semantics. Doing the same correctly for sub-stages doubles the union size or requires Round-2 to be revisited.

**Why it matters**: this is the v0.4 wire format. Getting it wrong now is expensive — Phase 2.E #1 just shipped a v0.2 schema; a third revisit in 2 weeks erodes the "schema stable" claim that Phase 2.E #1's ship rests on. Reviewers approving "minor bump" without seeing the actual zod diff is the kind of false-cheap that Round-2 of the protocol review caught.

**Suggested fix**:
1. Add §"Schema diff (zod)" to the proposal showing the exact post-v0.4 shape of `AisepStageRunSchema` — explicitly either (a) lift sub-stage fields into `StageRunCommonShape` and accept that all three existing variants inherit them, OR (b) widen the union with parent/leaf as a second discriminator. Pick one.
2. Update §Q2 wire format claim to match: option (a) is genuinely "minor (new optional fields on every variant)"; option (b) is "minor in semver but doubles variant count" — be honest in the consequences table.
3. Add a unit-test name to §Dogfood gate step 2: `stage.test.ts` round-trip — parent stage_run with subStages, child stage_run with parentStageRunId, both for each of the existing three phases (none / brief / slice), plus a "negative case: parent + slice phase is rejected because architecture-brief itself doesn't fan-out in v1 (only implement does)".

### F2. R7 self-host invariant claim is asserted, not analyzed — [MAJOR]

**Where**: Proposal §Q3 (line 157): "R7 unchanged".

**Issue**: R7 says "AISEP invoked externally; self-host gated". The proposal mentions self-host nowhere except this single "unchanged" claim. But v1 introduces TWO things that touch R7's edge:

1. **plan stage now emits a machine-readable `parallel:` block that the runner consumes** (lines 60-71). Today plan emits a mermaid graph that *humans* interpret. v1 elevates plan's output from documentation to executable schema. That is — in spirit — closer to "agent emits graph patches" (the v3 dynamic-fan-out hazard that the proposal correctly defers, line 304 in plan). The proposal needs to argue this is NOT a step toward self-modifying AISEP — e.g. by noting that `parallel:` blocks are validated against a fixed schema (line 211: "plan.hbs Hard limits gain rule"), so the agent's authority is bounded to "choose a decomposition", not "rewrite the methodology".

2. **The "force re-plan" mitigation in adversarial counter-argument #3** (line 213) introduces a runtime loop where plan stage's output gates its own dispatch. If plan fails the schema validator, "plan-stage refuse + force re-plan". That's a single-stage cycle, which the proposal doesn't acknowledge as a cycle. v3 cycle proposal exists separately; v1 must not accidentally ship a primitive cycle through the back door.

**Why it matters**: R7 is the load-bearing red line that keeps AISEP from drifting into "AI modifies AI"; the related v3 proposal explicitly puts cycle behind R7's gate. v1 needs to show its `parallel:` schema is **definitely** in the static-decomposition lane and **definitely** doesn't slip a cycle in via plan-validator-loop.

**Suggested fix**:
1. Add §"R7 boundary analysis" with two paragraphs:
   - One on `parallel:` block being read-only-by-agent / schema-locked, distinguishing "decomposing within a fixed methodology" (v1) from "emitting graph patches at runtime" (v3).
   - One on plan-validator failure mode: clarify that "force re-plan" means **the user re-runs plan** (with feedback), NOT that runner auto-loops plan-stage on validator fail. If it's runner-driven re-plan, that IS a primitive cycle and must be defended as such.
2. Update §Q3 to "R7 unchanged — see §R7 boundary analysis" rather than asserting it.

### F3. M5 cap composition under retries-vs-siblings is under-specified — [MAJOR]

**Where**: Proposal §Q3 (line 157): "**M5 enforcement** (Phase 2.E #1): now applies per-sub-stage (each sub-stage tracks its own M5 counter via existing checkM5Cap)"; §Risks RISK-FAN-IN (line 247).

**Issue**: `checkM5Cap` (`m5-cap.ts:67-74`) is keyed on a single `stageRunId` and counts blocking verdicts (`revise_required` ∪ `request_reverify`) for that one id. The proposal claims this works per-sub-stage. Three composition cases are not analyzed:

1. **Sibling failures**: sub-stage T1a gets `revise_required` once. T1b unaffected. Per current m5-cap.ts semantics (`isM5BlockingVerdict` line 30; threshold = 2 verdicts on **same** stageRunId), this is correct — siblings have separate counters. But the proposal asserts this without showing it; reviewers should not be expected to re-derive.

2. **Same-sub-stage retry**: T1a gets `revise_required` → re-runs as same stage_run with new attempt → second verdict counted. After 2 blocking verdicts on T1a's stageRunId, checkM5Cap.capExceeded = true. **But**: does "force re-plan" on RISK-FAN-IN (line 247: "if any sub fails, parent fails; ... user re-plans") create a NEW T1a' under a NEW parent — fresh stage_run, fresh M5 counter? If yes, M5 enforcement has a back-door: any sub-stage at the M5 limit can be "laundered" by re-planning. This needs to be either (a) acknowledged as acceptable (consistent with v0 caveat in m5-cap.ts:18-19 that "each stage gets a fresh stageRunId"), or (b) closed by tracking M5 across re-plans of the same logical sub-task.

3. **Parent-level review**: the proposal explicitly says "per-parent M5 NOT applied (no concept of 'parent-level review' yet)" (line 157). That's a defensible choice, but it interacts with adversarial argument #2's "contract runs ONCE (parent) and freezes anchors BEFORE fan-out" (line 195). If contract is a parent-of-implements and contract itself gets `revise_required`, M5 applies on contract normally (one stage_run). Fine. But what about review stage *after* a parallel implement, when verify runs on N patches? Does review get one verdict per sub-stage's patch (then per-sub-stage M5), or one combined verdict (then one stage_run id, one counter)? Methodology §2.8 (line 134) says review produces "verdict" as a single artifact — proposal needs to nail down which.

**Why it matters**: M5 is the methodology red line that prevents infinite ping-pong. Phase 2.E #1's whole point was to land the counter primitive cleanly. Letting v1 muddy the keying rule re-introduces the risk that pilot-04/05/06 had to prove away.

**Suggested fix**:
1. Add §"M5 composition under fan-out" with a worked example:
   - T1a, T1b, T1c each independent counters under their own stageRunId ✓ (current m5-cap.ts behavior, no code change)
   - Re-plan after partial failure: new sub-stage_run with new id resets counter — **acknowledge** this as the v1 carve-out, matching `m5-cap.ts:16-19` v0 caveat
   - Review stage post-parallel-implement: ONE review stage_run consumes ALL sub-stage patches, produces ONE verdict, ONE M5 counter (or alternative: N reviews; pick one and justify)
2. Add scheduler.test.ts assertion: "T1a accumulates 2 revise_required → checkM5Cap.capExceeded; T1b unaffected" — concretizes the per-sub-stage claim.

### F4. Plan-roadmap consistency holds — [FALSE-POSITIVE-CANDIDATE]

**Where**: §Context (line 22-26); plan `ai-vessel-vessel-bubbly-noodle.md:291`.

**Issue**: Concern that proposal might overreach into v2 (fan-in) or v3 (dynamic).

**Why it matters**: scope creep into v3 would smuggle dynamic subgraph past the cycle gate.

Verification: plan v1 row says "静态 fan-out（一个 stage 派生 N 并行子任务，并发上限 4）" with deliverable "`.parallel([impl_backend, impl_frontend, impl_tests])`；ready queue 调度". Proposal §Scope:
- ✓ `.parallel([…])` DSL (line 60-66) — matches deliverable exactly
- ✓ ready-queue scheduler (line 67-71) — matches deliverable
- ✓ concurrency cap 4 default (line 38, 76-78) — matches scope
- ✓ Static fan-out only (line 41-43, line 81-83) — defers dynamic to v3 per plan §"v0/v1 dynamic subgraph 留到 v3"
- ✓ Fan-in defer to v2 explicit (line 84-85) — matches plan v2 row "fan-in + partial recovery"
- ✓ Cross-stage parallelism out of scope (line 86-87) — correct (v1 is sub-stage-scoped per plan)
- ✓ Single-machine assumption (line 88-89) — matches plan "v0 不引入 Redis / NATS / Postgres"

No overreach detected. (Tag FALSE-POSITIVE-CANDIDATE because this is the concern I checked, not an issue.)

### F5. R6 boundary holds — scheduler.ts and runner change can both stay R6-clean — [MINOR]

**Where**: §Migration (line 220-226); current runner at `packages/aisep-core/src/runner.ts:1-5` ("R6 boundary: runner has NO fs / spawn / network").

**Issue**: Proposal adds `scheduler.ts` (pure function — fine), but **`runner.runStage` learning "parent vs leaf" logic** (line 223-224) needs explicit R6 affirmation. Currently runStage takes `args.stage / phase / predecessorId` and dispatches to `executor.execute` (`runner.ts:128`). Adding a "if parent, loop until subs terminal" branch means runStage now schedules child runs, which means it calls store.createStageRun N times and awaits N executor.execute() calls in parallel.

That's still R6-clean (`Promise.all` + injected `executor` + injected `store`; no fs/spawn/net). But it changes runner's role from "one stage_run at a time" to "potentially N parallel stage_runs". The current `runner.ts` JSDoc (line 78-81) says "Run a single stage". v1 needs that doc updated to "Run a stage which may fan out into N parallel sub-stages, all dispatched via injected executor".

**Why it matters**: R6 is fine here; what's at risk is the **implicit contract** that runStage is single-stage. Future evolutions that read the JSDoc and assume single-stage semantics (e.g. v3 cycle, batch CLI helpers) will be wrong.

**Suggested fix**:
1. Update runner.ts top-level comment + runStage JSDoc as part of §Migration deliverables.
2. Add to §Q6 (resource contention) explicit note: "scheduler.ts caps parallelism; runner.runStage relies on the cap and does NOT add its own throttling — single point of concurrency truth lives in scheduler.ts".
3. Confirm no fs/spawn/net imports in scheduler.ts via dependency-cruiser CI rule (extend existing aisep-* dep rule).

### F6. R11 memory trust boundary unaffected — [FALSE-POSITIVE-CANDIDATE]

**Where**: Proposal §Q3 (line 157): "R11 unaffected".

**Issue**: Concern that parallel sub-stages might each call `memoryProvider.retrieve` and somehow cross trust tiers.

Verification: `runner.ts:63-65` documents R11 — retrieve is tier-explicit and defaults to `global-verified`. With Candidate A, each parallel sub-stage_run gets its own runStage call, each independently calls `memoryProvider.retrieve(stage, phase)` (runner.ts:122-124). Each retrieval is independently scoped; no cross-tier mixing introduced by parallelism. Pilot-04 / Pilot-05 / Pilot-07 already verified the tier-explicit pattern (retrospectives R11 lines).

No issue.

### F7. Dogfood gate has a sharp-edge in Phase 9c (cancelled-vs-orphaned siblings) — [MINOR]

**Where**: §Dogfood gate Phase 9c (line 305-307).

**Issue**: Phase 9c says "force one sub-stage to fail mid-implement; parent must terminate failed; **siblings must be cancelled (not left running)**". But the acceptance criterion is binary (cancelled vs not), and the proposal doesn't say *how* siblings learn they should stop. Three plausible mechanisms:
1. Scheduler polls and SIGTERM the running claude subprocesses;
2. Scheduler stops dispatching but waits for in-flight subs to finish (so cancelled = "not new spawns", not "in-flight stops");
3. Sub-stage status flips to "cancelled" only at next poll, and current spawn writes its result to a now-cancelled stage_run.

Pilot-09 reviewer (the user) needs to know which is "pass". Methodology M1 invariant (`02_methodology-v0.1.md:340`) lists `cancelled` as terminal but doesn't define the transition trigger.

**Why it matters**: vessel cli-runner.ts has documented behavior — "SIGTERM → SIGKILL after 5s" (`packages/backend/src/cli-runner.ts`, per CLAUDE.md). If aisep-core inherits that, fine — but it must be stated. Otherwise Pilot-09's failure-mode test passes with mechanism #2 (in-flight finishes happily, parent fails, but tokens already burned) and the user thinks they got "cancellation" when really they got "no more starts".

**Suggested fix**:
1. Phase 9c gain explicit acceptance: "Within 10s of parent's failure transition, in-flight sub-stage claude subprocesses receive SIGTERM; if still alive after 5s, SIGKILL. State recorded as `cancelled` (not `failed`)."
2. Note R6 implication: SIGTERM/SIGKILL happens via the injected workspace/executor (aisep-agents layer), NOT in aisep-core scheduler. Scheduler emits a "cancel" intent; executor honors it. Keeps R6 clean.

### F8. ADR-lite completeness — [MINOR]

**Where**: §ADR-lite (line 254-286).

**Issue**: Context / Decision / Consequences / Review trail all present. Two gaps relative to recent ADR-0016 (scheduler M1 skeleton) precedent:
- No explicit list of **what this ADR does NOT decide** (a "Non-decisions" subsection). E.g. "this ADR does not decide retry semantics (deferred to v3 cycle); does not decide cross-machine distribution (deferred per plan); does not decide parent-level review verdict (deferred to v2 fan-in)".
- "Review trail: pending Phase 1 cross-review" is fine for the proposal but the ADR-lite should also state **the gate condition for moving from "Decision: candidate A" to "Decision: implemented"**. ADR-0016 used "Phase 1 + Phase 2 + arbitration converged + dogfood pilot passed".

**Why it matters**: ADR-lites are the persistent record. Future Claude reading this in 6 weeks needs the "non-decisions" list to know what v1 doesn't promise.

**Suggested fix**: Add §"Non-decisions" subsection to ADR-lite. Add "promotion gate" line to §"Review trail".

## Strong points

1. **Candidate A is the right pick on architecture-fit grounds.** Reuse of existing `AisepStageRun` machinery — even with the F1 schema-detail caveat — beats inventing a parallel type (Candidate B) or breaking the "stage as logical unit" framing (Candidate C). The reasoning in §Recommendation (line 130-140) is exactly the kind of comparison that earlier proposals (parallel-work-orchestrator) struggled with.

2. **Adversarial self-review section is genuine.** Three counter-arguments + rebuttals (lines 165-214) cover the real failure modes (RAM thrash on Mac mini, contract-anchor drift across N implements, plan-stage decomposition incoherence). The "default off, opt-in via --parallel" mitigation for #1 is correctly framed as a spiral-layer concern under CLAUDE.md "Layered Spiral Delivery", which is precisely the right place for it.

3. **Plan-roadmap consistency is tight.** §Scope honors the v1 row line-by-line; non-scope explicitly defers v2 fan-in and v3 dynamic / cycle. No scope creep. The §"Dependency on v3 cycle" analysis (line 312-328) correctly identifies the v1-first preference based on user-visible value, while keeping the composition-with-v3 path open.

4. **R6 discipline is honored at the design level.** scheduler.ts as a pure function (line 70) is exactly the pattern that pilot-07 / pilot-05 retrospectives proved out for m5-cap.ts. The R6 boundary doesn't get bent to accommodate fan-out.

5. **§Risks table is comprehensive.** 8 risks with explicit mitigations, including RISK-NESTED (one-level fan-out only, schema-enforced) and RISK-Q4-a (concurrency = 4 is a guess that may need spiral correction) which are the kinds of risks earlier proposals omitted.

6. **Migration section names exact files.** aisep-protocol bump + new scheduler.ts + runner.runStage extension + plan.hbs / implement.hbs / aisep-cli changes + methodology doc update. No "TBD" gaps in the implementation surface area.

## Open questions for the user (≤ 3)

1. **Schema variant strategy (F1)** — for v0.4, do you prefer (a) lift sub-stage fields into `StageRunCommonShape` and accept all three existing phase variants gain them (simpler diff, but adds two optional fields to every variant including ones that can't actually fan out, e.g. `architecture-brief`), or (b) expand the discriminated union to add a parent/leaf dimension (cleaner type-level guarantee that only leaf-implement can have parentStageRunId set; doubles variant count and is a bigger semver-minor)?

2. **Plan-stage re-plan loop (F2)** — when plan emits a `parallel:` block that fails the overlap validator, is "force re-plan" (a) user runs `aisep run` again with corrected plan input (no auto-loop; aligns with R7's "external invocation" framing), or (b) runner auto-re-spawns plan stage with the validator error as feedback (which IS a primitive cycle, must be defended as such relative to R7 and the v3 cycle proposal)?

3. **Post-parallel review verdict shape (F3)** — when parallel sub-implements each produce their own patch, does the subsequent **review stage**: (a) emit ONE verdict over the merged set (so M5 counter lives on the review stage_run), or (b) emit N verdicts one per sub-stage patch (so M5 counter lives per sub-stage, matching the proposal's "per-sub-stage M5" claim more naturally)? Option (b) composes more naturally with v3 cycle per-sub-stage `request_reverify`, but option (a) preserves the "review = one logical decision" framing of methodology §2.8.
