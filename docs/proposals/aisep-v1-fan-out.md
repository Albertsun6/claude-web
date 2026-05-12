# Proposal: AISEP v1 fan-out — static parallel sub-stages

> Status: **DRAFT v1** — pending cross-review per R5 (protocol changes need
> ADR-lite + cross-review). Marked v1 milestone in [plan §"DAG 拓扑"](../../plans/ai-vessel-vessel-bubbly-noodle.md).
> Date: 2026-05-12
> Branch: `feat/aisep-bootstrap`
> Author: Claude Opus 4.7
> Reviewers (pending): vessel-architect (Claude), reviewer-cross (cursor-agent)
> Mode: `contract` (per harness-review-workflow — schema + runner contract)

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

**Plan-derived constraint** (per Q10 user decision + reference-library
ontology):
- Concurrency upper bound = 4 (plan stated; matches Pilot-02 SmartBear
  research finding that reviewer attention degrades sharply past 4
  concurrent contexts)
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
| Q1 | **Data model — zod-expressible?** | (a) `AisepStageRun.subStages?: array<OpaqueId>` (parent ref to children); (b) `AisepStageRun.parentStageRunId?: OpaqueId` (child ref to parent); (c) plan output schema gains `parallel: [...]` group construct. All discriminator-friendly. |
| Q2 | **Protocol — wire format frozen?** | aisep-protocol 0.3.0 → 0.4.0 (minor; new optional fields). Backward-compat: v0.3 consumers see `subStages` absent on all parents (no fan-out) → ignore. |
| Q3 | **Compatibility — existing invariants hold?** | R3/R4 unaffected. R6 reinforced (scheduler.ts pure; runner gains state machine but injects all side effects). R11 unaffected. R7 unchanged. **M5 enforcement** (Phase 2.E #1): now applies per-sub-stage (each sub-stage tracks its own M5 counter via existing checkM5Cap); per-parent M5 NOT applied (no concept of "parent-level review" yet). |
| Q4 | **Irreversible decisions?** | (a) `concurrency = 4` is a hard ceiling per plan + SmartBear research — increasing breaks reviewer-cognition-load assumption; (b) static vs dynamic fan-out — v1 chooses static; v3 reserves dynamic; (c) parallel-implement → serial-verify boundary fixed (no parallel verify in v1). |
| Q5 | **Permissions** | Spawn count per implement stage grows from 1 → N (up to 4). claude CLI subprocesses run in parallel; each consumes its own context budget. Token consumption multiplies by N. Mitigation: `--concurrency` flag lets user dial back. |
| Q6 | **Resource contention** | Up to 4 claude subprocesses concurrent; CPU + IO contention on a single Mac mini. Each subprocess writes to its own `<stage>-<subId>.md` file (no shared file write race). state.json: scheduler must take a write lock for sub-stage state transitions (currently single-writer assumption). Add `withStateLock` async mutex. |
| Q7 | **Rollback** | `--parallel=off` flag returns to v0.2 single-pass (existing path remains). v1.0 schema is backward-compat (sub-stages optional). Per-sub-stage retry: revert that sub-stage's artifact + replay; parent retries are independent of sibling sub-stages (no cross-pollution). |

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
   **Rebuttal**: this is why v1 ships static fan-out **with a strict
   schema validator**, not "agent's free imagination". plan.hbs Hard
   limits gain rule: "every task in a `parallel` group MUST have
   non-overlapping `affects: <path-pattern>` regex, validated at parse
   time". Overlap = plan-stage refuse + force re-plan. v3 dynamic fan-out
   keeps the constraint validator from v1 (no regression). Failure mode
   reviewer cites is real, but caught at plan output, not at runtime —
   exactly the kind of static validation a typed schema is for.

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

**Review trail**: pending Phase 1 cross-review.

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
     parent must terminate failed; siblings must be cancelled (not
     left running). Verify NOT executed (no partial recovery in v1).
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

## Next steps (post cross-review)

1. Run `harness-review-workflow` `contract` mode on this proposal
2. Address Phase 1+2+3 findings (≤ 2 ping-pong rounds per M5)
3. Implement Candidate A per Migration plan
4. Pilot-09 + retrospective (3-phase)
5. Tag aisep-protocol@0.4.0 + memory record fan-out-specific findings
6. (Future) v3 cycle composition — verify v1 + v3 compose cleanly in
   a follow-up Pilot

Until cross-review converges, **DO NOT** implement (R5).
