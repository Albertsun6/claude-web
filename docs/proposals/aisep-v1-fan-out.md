# Proposal: AISEP v1 fan-out — static parallel sub-stages

> **Status: v2 CONVERGED** (post-Phase 1+2+3 cross-review, 2026-05-12)
> Date: 2026-05-12
> Branch: `feat/aisep-bootstrap`
> Author: Claude Opus 4.7
> Reviewers: harness-architecture-review (Claude), reviewer-cross (cursor-agent gpt-5.5-medium)
> Mode: `contract` (per harness-review-workflow — schema + runner contract)
>
> **Review trail**:
> - `docs/reviews/aisep-v1-fan-out-arch-2026-05-12-1930.md` (Phase 1 arch)
> - `docs/reviews/aisep-v1-fan-out-cross-2026-05-12-1930.md` (Phase 1 cross)
> - `docs/reviews/aisep-v1-fan-out-react-arch-2026-05-12-1930.md` (Phase 2 arch react B)
> - `docs/reviews/aisep-v1-fan-out-react-cross-2026-05-12-1930.md` (Phase 2 cross react A)
> - `docs/reviews/aisep-v1-fan-out-arbitration-2026-05-12.md` (Phase 3 arbitration: 13/13 accept)
>
> **v1 → v2 changes** (incorporating 13 accepted findings):
> - §Scope: added `patch_set` manifest as new item (closes A.F10/B.F1 BLOCKER)
> - §Candidate A: refined with `fanOutRole` discriminant + `superRefine` nested-fan-out rejection
> - §Q1: detailed zod schema diff (not just "add optional fields")
> - §Q2: version target corrected `0.2.0 → 0.3.0` (was `0.3.0 → 0.4.0`)
> - §Q3: rewrote R7 boundary analysis + new §"M5 composition under fan-out"
> - §Q6: in-process mutex only; cross-process fail-closed
> - §"Plan-derived constraint": honest SmartBear citation (400-LOC threshold ≠ "4 concurrent contexts")
> - §"Adversarial #3 rebuttal": plan validator failure = terminal user-re-run (R7 preserved)
> - §"Dogfood gate Phase 9c": SIGTERM/SIGKILL 10s + 5s timing
> - §ADR-lite: added Non-decisions subsection + promotion gate
> - §"Dependency on v3 cycle": v1=0.3.0, v3 cycle=0.4.0 (v1 first per arbitration B.OQ1)
>
> **Companion hotfix** (separate commit): `version.ts` `AISEP_PROTOCOL_VERSION` bumped 0.1.0 → 0.2.0 to close Phase 2.E #1 ship drift (A.F11/B.F3).

## Context

**Current limitation (v0 + v0.2)**: AISEP chain is **linear** — every
stage has exactly one predecessor and one successor. plan emits a single
task DAG (`mermaid graph TD`), but runner ignores the parallelism;
implement runs as ONE atomic stage producing ONE patch. For tasks that
naturally split (backend + frontend + tests / multiple modules /
independent feature slices), v0 serializes the work, losing parallelism
and producing larger-than-necessary patches that strain reviewer
attention (SmartBear 400-LOC threshold).

**Plan reference**: v1 milestone in roadmap explicitly assigns "静态
fan-out（一个 stage 派生 N 并行子任务，并发上限 4）" with deliverable
`.parallel([impl_backend, impl_frontend, impl_tests])` + ready-queue
scheduler. See [ai-vessel-vessel-bubbly-noodle.md](../../plans/ai-vessel-vessel-bubbly-noodle.md)
§"DAG 拓扑：分阶段实施路线图（v0 → v3）" row "v1".

**Why now**:
- v0 single-pass is proven (Pilots 04/05/06/07 all 10/10 stages succeed)
- v0.2 schema is stable + Phase 2.E #1 M5 cap baseline shipped
- Real tasks (e.g. a vessel iOS + backend feature) naturally fan out into
  3-5 independent slices; v0 serial implement burns ~12 min × N rounds vs
  v1 parallel implement burns ~12 min total

**Plan-derived constraint** *(v2 corrected per A.F9/B.F5)*:
- Concurrency upper bound = 4 (plan-roadmap stated value; **dogfood-pending
  default**, user-tunable via `--concurrency N`). The "4 cap" is NOT
  supported by SmartBear research as previously claimed in v1 — SmartBear's
  cited finding is on **patch size** (400 LOC threshold; documented in
  Pilot-02), NOT on "N concurrent reviewer contexts". `concurrency=4` is
  Pilot-09 to validate empirically per resource class.
- Static fan-out only — agent does NOT emit graph patches dynamically
  (dynamic subgraph deferred to v3 per [§Reasons we don't ship that
  yet](../../plans/ai-vessel-vessel-bubbly-noodle.md): LangGraph #2581/
  #4026 reverify "nested fan-out 不稳")

## Scope

**In scope**:

1. **Sub-stage protocol** — `AisepStageRun` gains optional `subStages:
   AisepSubStageRef[]` field. Each sub-stage has its own `stageRunId`,
   `attemptN`, `status` lifecycle. Parent stage is "done" iff all
   sub-stages reach terminal status.
2. **plan stage emits parallel groups** — task DAG output gains explicit
   `parallel` markers (Mastra-inspired DSL). Example:
   ```yaml
   tasks:
     - id: T1
       stage: implement
       parallel:
         - id: T1a
           name: impl_backend
         - id: T1b
           name: impl_frontend
         - id: T1c
           name: impl_tests
   ```
3. **Ready-queue scheduler** — new module `aisep-core/src/scheduler.ts`.
   Maintains a queue of "ready" sub-stages (all predecessors succeeded).
   Concurrency-cap-aware (≤ 4 running at any time). Pure function over
   stage_run state; runner calls scheduler to pick next sub-stage(s) to
   run.
4. **Per-sub-stage artifact namespacing** — each parallel implement
   sub-stage produces its own patch artifact (e.g. `patch-backend.diff`,
   `patch-frontend.diff`); verify consumes all of them; integrate merges
   into one commit OR per-sub-stage commits (configurable).
5. **CLI driver** — `aisep run --parallel [--concurrency N]` (default
   off in v1; opt-in until 1 dogfood pilot proves stability). Default
   N=4 per plan.
6. **`patch_set` aggregate manifest** *(v2 new — closes A.F10/B.F1
   BLOCKER)*: when all parallel sub-implements succeed, parent implement
   stage_run emits a new artifact kind `patch_set` (added to
   `AisepArtifactKindSchema` enum). The manifest is a single JSON
   summarizing the N child patches:
   ```json
   {
     "patches": [
       { "subStageId": "sr-...", "subStageName": "backend",
         "patchFile": "patch-backend.diff", "contentHash": "sha256:...",
         "byteCount": 1234 },
       { "subStageId": "sr-...", "subStageName": "frontend", ... },
       { "subStageId": "sr-...", "subStageName": "tests", ... }
     ]
   }
   ```
   verify stage takes parent implement stage_run as its **single
   `predecessorId`** (preserves current runner contract — no
   `predecessorIds[]` in v1), reads the manifest, then loads each child
   patch file from disk. This **deliberately avoids fan-in semantics**
   (which is v2 scope) — verify doesn't reconcile or merge patches; it
   just runs its checks across all of them in one stage_run.

**Explicit non-scope**:

- ❌ Dynamic fan-out (agent emits graph patches at runtime) — defer to
  v3 (cycle milestone) per plan
- ❌ Fan-in with partial recovery (one sub-stage fails, others retry) —
  defer to v2 per plan ("fan-in + partial recovery")
- ❌ Cross-stage parallelism (architect runs in parallel with research) —
  out of scope; v1 fan-out is sub-stage-scoped (one parent stage's children)
- ❌ Distributed execution (sub-stages on different machines) — single
  Mac mini per [plan §"v0 不引入 Redis / NATS / Postgres"](../../plans/ai-vessel-vessel-bubbly-noodle.md)
- ❌ Streaming partial sub-stage results (full output per sub-stage; no
  incremental) — v0.2 ClaudeExecutor is batch already

## Candidate designs

### Candidate A: Sub-stage as first-class StageRun (recommended)

Each parallel branch IS a stage_run (same schema, same lifecycle).
Parent stage has `subStages: stageRunId[]` field. Parent's status is
derived: `running` iff any sub running; `succeeded` iff all sub
succeeded; `failed` iff any failed.

**Pros**: reuses existing AisepStageRun machinery; sub-stages get full
state-machine + artifact + attempt infrastructure for free; state.json
remains flat.
**Cons**: AisepStageRun gains a discriminated case (parent vs leaf);
runner.runStage needs to know it has subs and dispatch to scheduler.

### Candidate B: New AisepSubStage type

Sub-stages get their own schema (`AisepSubStage`), not full StageRun.
Lighter — only the fields needed for parallel branch (id, name, status,
artifact refs).

**Pros**: lighter schema; parent StageRun stays unchanged.
**Cons**: sub-stages can't reuse the runner machinery; need duplicate
state-machine + attempt-counter + artifact-binding logic.

### Candidate C: Parallel by separate stage_runs (no parent-child link)

plan emits N independent stage_runs at the implement stage; runner
schedules them by predecessor links (every sub points to the same
contract predecessor). No new schema.

**Pros**: zero protocol change.
**Cons**: no concept of "the implement stage" as a logical unit; verify
input becomes ambiguous (N predecessors for one verify stage_run);
violates current linear-DAG mental model harshly.

### Recommendation: **Candidate A** (sub-stage as first-class StageRun)

Reasons:
1. Reuses existing infrastructure (Phase 2.E #1's M5 cap function works
   per-sub-stage with zero change; checkM5Cap takes a verdict list, doesn't
   care if it's parent or child).
2. **Minimal new schema surface** — only adds `subStages` field on
   StageRun (compared to Candidate B's whole new type, or Candidate C's
   semantic ambiguity).
3. Sub-stage retro / cycle integration trivially extends from v0.3 cycle:
   each sub-stage can independently `request_reverify`; cycle scheduler
   handles per-sub-stage retry.

Why not B: lighter-schema illusion — sub-stage will inevitably need
attempts (M5 cap), artifacts (per-branch patch), state machine
(pending → running → done). End up reimplementing 80% of StageRun.

Why not C: violates "stage as logical unit" — verify currently takes
"patch from implement"; with C, verify takes "patches from impl_backend
+ impl_frontend + impl_tests" with no grouping. Methodology stays cleaner
if implement is one logical stage with N parallel sub-runs.

## 7-question anchor gate

| # | Question | Answer |
|---|----------|--------|
| Q1 | **Data model — zod-expressible?** *(v2 detailed)* | **`fanOutRole` discriminant** on `AisepStageRunSchema`. Three variants in widened discriminated union: (a) `fanOutRole: "normal"` — current behavior (no fan-out); (b) `fanOutRole: "parent"` — requires `subStages: OpaqueId[]` non-empty + forbids `parentStageRunId`; (c) `fanOutRole: "child"` — requires `parentStageRunId` + forbids `subStages`. `superRefine` enforces (parent only allowed for `stage === "implement"` in v1) + (no nested fan-out: child cannot have its own subStages). New artifact kind `patch_set` in `AisepArtifactKindSchema` enum (manifest of N child patches). Plan output schema gains `parallel: [...]` group construct with `affects: <regex>` non-overlap validator. |
| Q2 | **Protocol — wire format frozen?** *(v2 corrected per B.F3)* | aisep-protocol **0.2.0 → 0.3.0** (v1 ships first per arbitration B.OQ1; v3 cycle proposal will become 0.3.0 → 0.4.0 afterwards). Minor bump: backward-compat held — `fanOutRole` defaults to `"normal"` on existing data, `patch_set` artifact kind opt-in. **Companion hotfix** *(separate commit; A.F11/B.F3 ship bug)*: `version.ts` `AISEP_PROTOCOL_VERSION` bumped 0.1.0 → 0.2.0 to align with package.json. |
| Q3 | **Compatibility — existing invariants hold?** *(v2 rewrote R7 paragraph + new §M5 composition)* | R3/R4 unaffected. R6 reinforced (scheduler.ts pure; runner gains state machine but injects all side effects via executor). R11 unaffected (each sub-stage independently retrieves memory, tier-explicit; pilot-04/05/07 verified pattern). **R7 boundary analysis** (new): plan-stage `parallel:` block is read-only-by-agent + schema-locked (decomposing within methodology, NOT graph-patching); plan-validator failure = **terminal user-re-run** of `aisep run` (NO runner auto-replan loop) — preserves R7 "AISEP invoked externally". See §"R7 boundary analysis" below. **M5 enforcement** (Phase 2.E #1): see new §"M5 composition under fan-out" below for worked example. |
| Q4 | **Irreversible decisions?** | (a) `concurrency = 4` is a hard ceiling per plan + SmartBear research — increasing breaks reviewer-cognition-load assumption; (b) static vs dynamic fan-out — v1 chooses static; v3 reserves dynamic; (c) parallel-implement → serial-verify boundary fixed (no parallel verify in v1). |
| Q5 | **Permissions** | Spawn count per implement stage grows from 1 → N (up to 4). claude CLI subprocesses run in parallel; each consumes its own context budget. Token consumption multiplies by N. Mitigation: `--concurrency` flag lets user dial back. |
| Q6 | **Resource contention** | Up to 4 claude subprocesses concurrent; CPU + IO contention on a single Mac mini. Each subprocess writes to its own `<stage>-<subId>.md` file (no shared file write race). state.json: scheduler must take a write lock for sub-stage state transitions (currently single-writer assumption). Add `withStateLock` async mutex. |
| Q7 | **Rollback** | `--parallel=off` flag returns to v0.2 single-pass (existing path remains). v1.0 schema is backward-compat (sub-stages optional). Per-sub-stage retry: revert that sub-stage's artifact + replay; parent retries are independent of sibling sub-stages (no cross-pollution). |

## R7 boundary analysis *(v2 new — per A.F2)*

R7 red line: "AISEP invoked externally (CLI / external scripts); backend
cannot self-start AISEP; self-host gated". v1 elevates two things that
touch R7's edge:

1. **`parallel:` block becomes machine-consumed (not just human-read)**.
   Plan stage today emits a mermaid graph for human comprehension; v1
   has the runner CONSUME the `parallel:` block to schedule sub-stages.
   This is **NOT** "agent emits graph patches at runtime" (which IS
   the v3 dynamic-fan-out hazard). The decisive boundary:
   - Agent's authority in v1: **choose a decomposition** within a fixed
     schema (`parallel: [{id, name, affects, ...}]` with `superRefine`
     validation).
   - Forbidden: agent modifying the methodology, the schema itself, the
     stage order, or the cap (concurrency=4). Those are
     out-of-band-config locked.
   - The `parallel:` block is schema-locked → parsing failure terminates
     the stage; runner does NOT attempt to "fix" plan's output.

2. **Plan-validator failure = terminal user-re-run**. When plan emits
   a `parallel:` block that fails the overlap validator (e.g. two
   sub-tasks with overlapping `affects:` regex):
   - CLI prints validator error + cited plan section
   - `aisep run` exits non-zero
   - User reads error, edits intake / seed, re-runs `aisep run` from
     scratch (new stage_runs, fresh counters)
   - **NO runner auto-loop**: runner does NOT re-spawn plan with the
     validator error as feedback. That would be a primitive cycle —
     and cycle is v3 scope, not v1.

This preserves R7 cleanly: every user-perceived AISEP invocation comes
from external `aisep run` CLI; no AISEP self-modification; no agent
emitting graph patches at runtime.

## M5 composition under fan-out *(v2 new — per A.F3/B.F4)*

`checkM5Cap` (Phase 2.E #1) is keyed on a single `stageRunId` and counts
`revise_required ∪ request_reverify` verdicts. v1 fan-out interaction
across three composition cases:

### Case 1 — Sibling sub-stages, independent counters

T1a, T1b, T1c (parallel implements). Each has own `stageRunId`. M5
counter is per-stageRunId (m5-cap.ts current behavior — zero code change).
T1a gets 1 `revise_required`; T1b unaffected.

Acceptance test (in scheduler.test.ts): "T1a accumulates 2 revise_required
→ checkM5Cap.capExceeded; T1b at same time has 0 verdicts → not
exceeded".

### Case 2 — Re-plan after partial failure resets counter

If any child fails → parent fails → user re-plans (validator OR user
adjustment) → new parent stage_run with new id → new children with new
ids → fresh M5 counters.

**This is the v0 carve-out from m5-cap.ts L16-19** ("aisep run is
currently single-pass per stage_run — the counter never accumulates
in normal CLI usage"). v1 explicitly accepts this carve-out: re-plan
launders the counter. Rationale:
- Re-plan is a different logical attempt at the task (user changed
  intake / scope)
- v3 cycle (when it ships) will track per-LOGICAL-task counter via
  cycle scheduler state, not via raw stageRunId. v1 doesn't promise
  cross-re-plan continuity.

### Case 3 — Post-parallel review = ONE verdict over merged patch_set

Per arbitration B.OQ3: review stage_run is **single**, consumes the
parent implement's `patch_set` manifest, produces **ONE
review_verdict** artifact covering all N child patches. M5 counter is
keyed on this single review stage_run.

If reviewer wants to flag one specific child's check as false-positive,
they emit verdict `request_reverify` with
`requestReverify.checkId` pointing INTO the patch_set
(e.g. `checkId: "patch-backend.cross-references-section"`). v3 cycle
(when it ships) re-runs ONLY that check on the specified child patch
via `aisep verify --recheck --check-name <child-check-id>`.

This preserves methodology §2.8 "review = one logical decision" framing
+ keeps M5 keying simple (one counter per review stage_run, same as v0.2).

## Adversarial self-review (3 strongest counter-arguments)

1. **"4 parallel claude subprocesses on one Mac mini will thrash memory
   / context / network — user's setup is personal-single-machine per
   CLAUDE.md '纯个人单机自用'."** Skeptical reviewer: real claude CLI
   subprocess each ~500 MB-1 GB memory; 4 of them is 2-4 GB just on
   spawned children, plus the orchestrator + backend. M0.5 launchd
   backend uses ~300 MB. Default Mac mini is 8-16 GB. We'd burn 30-50%
   of system RAM on AISEP alone before counting any vessel processes
   running concurrently.
   **Rebuttal**: this is exactly why `--parallel` is **default off** with
   `--concurrency` user-tunable. Plan explicitly states "并发上限 4";
   user with 8 GB constrained machine sets `--concurrency 2` or stays at
   default off. Pilot-09 dogfood includes resource profiling (memory
   ceiling + time-to-completion vs concurrency 1/2/4) so user can pick
   the sweet spot for their hardware. Per
   [CLAUDE.md "Layered Spiral Delivery"](../../../CLAUDE.md#layered-spiral-delivery),
   capability (concurrency tuning) is spiral-driven, not skeleton — so
   default 4 is "skeleton allows up to 4", user spirals down for their
   setup.

2. **"Parallel implement makes contract anchor non-determinism (Phase 2.D
   #15 documented-as-acceptable) MUCH worse — 4 sub-implements each
   choose different anchor subsets, verify can't reconcile."** Skeptical
   reviewer: Pilot-04/05/06 already showed contract anchor list drifts
   across runs. Multiply by 4 parallel sub-implements: backend chooses
   anchor set A, frontend chooses B, tests chooses C, no overlap. verify
   has to validate all of them, and review can't reason about coherence.
   **Rebuttal**: in v1 design, contract stage runs ONCE (parent) and
   freezes anchors BEFORE fan-out. Implement sub-stages all consume the
   SAME contract.md, so their anchor reference set is identical. The
   non-determinism risk you raise applies if contract is per-sub-stage,
   which is explicitly NOT v1 — contract is one parent stage, implement
   is the fan-out boundary. Update §"Scope §2 plan output schema" to
   make this explicit: parallel construct sits at implement level only
   in v1 (contract level fan-out is v2+).

3. **"Static fan-out is a footgun — plan stage's LLM doesn't reliably
   produce a good parallel decomposition; sub-stages will overlap or
   leave gaps."** Skeptical reviewer: agent decomposition into N parallel
   tasks is an unsolved planning problem. v0 plan emits a mermaid graph
   with arrows — humans interpret. v1 expects machine-readable
   `parallel: [...]` blocks. plan's LLM will produce incoherent
   decompositions (e.g. backend includes parts of frontend's work).
   **Rebuttal *(v2 refined per A.F2)***: v1 ships static fan-out **with a
   strict schema validator**, not "agent's free imagination". plan.hbs
   Hard limits gain rule: "every task in a `parallel` group MUST have
   non-overlapping `affects: <path-pattern>` regex, validated at parse
   time". Overlap = plan-stage refuse + **terminal CLI error** (user
   re-runs `aisep run` with corrected intake; runner does NOT auto-loop
   plan stage — that would be a primitive cycle, deferred to v3 per R7
   boundary analysis above). v3 dynamic fan-out keeps the constraint
   validator from v1 (no regression). Failure mode reviewer cites is
   real, but caught at plan output, not at runtime — exactly the kind
   of static validation a typed schema is for.

## Migration

- **aisep-protocol**: 0.3.0 → 0.4.0 (minor)
  - `AisepStageRun` gains `subStages?: OpaqueId[]` + `parentStageRunId?: OpaqueId`
  - new `AisepPlanParallelGroup` schema for plan stage output validation
- **aisep-core**:
  - new file `aisep-core/src/scheduler.ts` — pure function
    `nextReady(stageRuns, concurrencyCap): stageRunId[]`
  - `runner.runStage` learns about subStages: if parent, dispatch to
    scheduler in a loop until all subs terminal, then mark parent done
  - `store` API: `withStateLock(fn)` async mutex for state.json writes;
    `setSubStageParent(childId, parentId)` linker
- **aisep-agents**:
  - `plan.hbs` Hard limits add `parallel: [...]` block syntax + overlap
    validator
  - `implement.hbs` accepts `--sub-name <name>` argv passthrough (e.g.
    `--sub-name backend`); writes patch to `<stage>-<subName>.md` instead
    of `<stage>.md`
- **aisep-cli**:
  - `aisep run --parallel [--concurrency N]` (default off, N=4)
  - validate plan output for `parallel` groups; reject if overlap regex fails
- **methodology doc**: 02_methodology-v0.1.md §"2.6 implement" gains
  "Parallel sub-stage" subsection
- **No vessel mainline change** (R3 holds)

## Risks

| ID | Risk | Mitigation |
|----|------|-----------|
| RISK-RAM | 4 concurrent claude subprocesses thrash memory on 8 GB Mac | `--concurrency N` tunable; default 4 only for Mac mini-class hardware; Pilot-09 includes resource profiling table; per-process memory cap via `--max-old-space-size` (Node side; claude CLI has its own caps) |
| RISK-PLAN-OVERLAP | plan emits parallel sub-tasks with overlapping `affects:` regex → race in writes | plan.hbs Hard limits + parse-time schema validator (overlap = re-plan); scheduler refuses to dispatch overlapping sub-stages |
| RISK-FAN-IN | verify needs ALL parallel patches; one sub fails / partially succeeds → verify state ambiguous | v1 scope says fan-in defer to v2; v1 v1 behavior: if any sub fails, parent fails (no partial recovery); verify NOT run; user re-plans |
| RISK-LOCK | state.json write contention from 4 concurrent runner threads | `withStateLock` async mutex; in-process serialization (not OS lock — single-machine assumption); each write batches sub-stage transitions |
| RISK-COST | Token consumption multiplies by N (up to 4× per implement stage) | Documented in --parallel help; user opts in knowingly. Future v1.1 could add cross-sub-stage prompt caching but explicitly defer. |
| RISK-OBSERVABILITY | 4 parallel subprocesses interleave stdout; debugging hard | Per-sub-stage `<stage>-<subName>.md` files (already in scope); console output uses thread-prefix `[backend]` / `[frontend]` / etc.; aisep run --parallel writes a top-level scheduler log |
| RISK-Q4-a | concurrency=4 cap based on SmartBear research; may not hold in v0 personal-single-machine | `--concurrency` tunable lower (1/2/3); telemetry-of-self if usage shows users keep at N=2, default flips to 2 in v1.1 |
| RISK-NESTED | Nested fan-out (sub-stage itself has subs) — semantically valid but combinatorial blow-up | v1 schema EXPLICITLY forbids: AisepStageRun zod schema add `subStages` allowed only if `parentStageRunId === null` (one-level fan-out). v3 dynamic-subgraph may relax. |

## ADR-lite

**Context**: AISEP v0 + v0.2 ships a working linear chain. Real software
engineering tasks (backend + frontend + tests / multiple modules)
naturally fan out into 3-5 independent slices. Plan stage already emits
task DAGs (mermaid), but runner ignores parallelism. This wastes the
inherent parallelism in software work and produces single oversized
patches that exceed SmartBear's 400-LOC reviewer-cognition threshold.

**Decision**: Implement Candidate A (sub-stage as first-class StageRun)
in v1. Static fan-out only (no dynamic graph patches). Concurrency cap
= 4 (default), tunable. parallel construct lives at implement-stage
boundary in v1; contract stays single (fan-out boundary explicitly NOT
at contract).

**Consequences**:

*Positive*:
- Real tasks (vessel iOS + backend + tests) achieve 3-4× wall-clock
  speedup at implement stage
- Per-sub-stage patches stay under SmartBear 400-LOC; reviewer attention
  preserved
- Sub-stage retry composes with v0.3 cycle (Phase 2.E #2 / Pilot-08
  prerequisite): one sub's request_reverify doesn't re-spawn siblings

*Negative / Trade-offs*:
- Token cost multiplies by N (up to 4×). User opts in via `--parallel`
- 4 concurrent claude CLI subprocesses + their context windows + state
  pressure 8 GB Mac mini; user tunes `--concurrency`
- AisepStageRun discriminates parent vs leaf — small schema complexity
  growth (one optional field per side)

**Non-decisions** *(v2 new — per A.F8/B-new-3)*:
- v1 does NOT decide retry semantics (deferred to v3 cycle — see
  `docs/proposals/aisep-v3-cycle-review-implement-loop.md`)
- v1 does NOT decide cross-machine distribution (deferred per plan
  "v0 不引入 Redis / NATS")
- v1 does NOT decide parent-level review verdict variant — review stays
  single verdict over merged patch_set (per §"M5 composition Case 3")
- v1 does NOT decide auto-replan on validator failure (deferred to v3
  cycle; v1 = terminal user-re-run per §"R7 boundary analysis")
- v1 does NOT decide cross-process workspace locking (cross-process =
  fail-closed per §Q6)

**Promotion gate**: this ADR moves from "Decision: candidate A" to
"Decision: implemented" only when:
1. Phase 1+2+3 cross-review converged ✓ (this revision)
2. Pilot-09 a/b/c three-phase acceptance passed (future session)
3. `version.ts` drift hotfix landed (companion commit this session)
4. dependency-cruiser CI rule extended to scan scheduler.ts for
   fs/spawn/net imports

**Review trail**:
- Phase 1 verdicts: `docs/reviews/aisep-v1-fan-out-{arch,cross}-2026-05-12-1930.md`
- Phase 2 reacts: `docs/reviews/aisep-v1-fan-out-react-{arch,cross}-2026-05-12-1930.md`
- Phase 3 arbitration: `docs/reviews/aisep-v1-fan-out-arbitration-2026-05-12.md`
  (13/13 ✅ accept; single-pass converged)

## Dogfood gate

Before merging v0.4 to `dev`:

1. Implement Candidate A end-to-end (≤ 400 LOC for scheduler.ts;
   runner.runStage changes ≤ 200 LOC; total v1 implement ~ 600 LOC)
2. Add scheduler.test.ts unit tests (ready-queue ordering, concurrency
   cap, sub-stage state propagation, parallel-overlap rejection)
3. **Pilot-09 (three-phase acceptance)**:
   - Phase 9a: real task split into 3 parallel sub-implements
     (Vessel-side trivial bug fix from docs/IMPROVEMENTS.md split into
     backend / frontend / tests); `--parallel --concurrency 3`. All 3
     sub-stages succeed; verify consumes all 3 patches; integrate emits
     one merge commit. Wall clock ≤ 6 min (vs ~15-18 min serial).
   - Phase 9b: resource profile — same task with `--concurrency 1 / 2 /
     4`. Record peak memory + wall clock + token consumption per
     concurrency level. Document the sweet spot in retrospective.
   - Phase 9c: failure mode — force one sub-stage to fail mid-implement;
     parent must terminate failed; **within 10s of parent's failed
     transition, in-flight sub-stage claude subprocesses receive SIGTERM;
     if still alive after 5s, SIGKILL** (per arch reviewer A.F7 timing).
     State recorded as `cancelled` (not `failed`) for siblings that
     were running at the moment parent failed. Cancel intent emitted by
     scheduler (aisep-core); SIGTERM/SIGKILL honored by injected
     executor (aisep-agents) — keeps R6 clean. Verify NOT executed (no
     partial recovery in v1).
4. Record retrospective + memory candidates per [Phase 2.D #1
   `aisep memory record` CLI](#)
5. After Pilot-09 passes: tag `aisep-protocol@0.4.0`

## Dependency on v3 cycle

This proposal does NOT depend on v3 cycle landing first. v1 fan-out can
ship before or in parallel with v3 cycle. They compose cleanly:

- v1 fan-out + no cycle (v0.2-baseline cycle): parallel implement runs;
  any sub failure ends parent; no per-sub-stage retry
- v1 fan-out + v3 cycle: per-sub-stage `request_reverify` triggers per-
  sub-stage recheck; siblings unaffected

If both ship: v1 first is fine (smaller scope; cycle just composes
on top). v3 first is also fine (cycle is single-stage retry; fan-out
just splits implement into N pieces and cycle handles each).

Recommend: **v1 first** because v1 ships an immediate user-visible
productivity win (3× wall clock); v3 ships invisible automation that
only matters when verify-flakiness or cycle-resolvable cases appear.

## Next steps (post cross-review converged)

✅ Phase 1+2+3 cross-review converged (this session, 2026-05-12).
Implementation permitted under R5.

Remaining:
1. **`version.ts` hotfix** *(this session, separate commit)* — bump
   `AISEP_PROTOCOL_VERSION` 0.1.0 → 0.2.0 to close Phase 2.E #1 ship
   drift (A.F11/B.F3)
2. Implement Candidate A per Migration plan (~600 LOC; future session)
3. Pilot-09 three-phase acceptance (future session, ~30 min wall clock)
4. Tag `aisep-protocol@0.3.0` (v1 first per arbitration B.OQ1)
5. Memory-record session-derived findings via `aisep memory record`
   (Phase 2.D #1 CLI), incl. arbitration "multi-proposal version-
   coordination drift" candidate
6. (Future) v3 cycle cross-review + impl — `aisep-protocol@0.3.0 →
   0.4.0`
