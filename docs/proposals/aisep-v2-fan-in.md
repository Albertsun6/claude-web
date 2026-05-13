# Proposal: AISEP v2 fan-in — multi-source aggregation + per-child failure recovery

> **Status: v1 DRAFT** (pending cross-review)
> Date: 2026-05-13
> Branch: `docs/aisep-v2-fan-in-proposal`
> Author: Claude Opus 4.7
> Mode: `contract` (per harness-review-workflow — schema + runner contract + dogfood gate)
> Target ship: 2026-06-30 (per介绍-v6 §16 roadmap)
>
> **Precursor**: [aisep-v1-fan-out.md](aisep-v1-fan-out.md) (v2 CONVERGED 13/13 accept, 2026-05-12, shipped in PR #68 b31e341)
>
> **Builds on**:
> - v0 linear 10-stage chain (Pilot-01..07, 2026-05-08)
> - v1 static fan-out: `runFanOutParent()` + `patch_set` manifest aggregation (PR #68)
> - Phase 2.F F3/F4/F5: timeout retry + pacing hint + cli help smoke (PR #74)
>
> **Out of scope (deferred to v3 cycle)**: review→revise loop; AISEP-modifying-AISEP self-host track.

## Context

### What v1 fan-out gave us

`runFanOutParent()` (commit `7bccd29` Stage 1 + `79a83fd` Stage 2.runner + `5641dbc` Stage 2.cli-A + `96085a8` Stage 2.cli-B + `28fb21f` Stage 3.1 cancel + `d92e50b` Stage 2.cli-C auto-detect) lets the implement stage dispatch N parallel child stage_runs and aggregate their artifacts into a parent `patch_set` manifest. Pilot-09 dogfooded 3-child happy path; Pilot-10b shipped 10/10 single-implement chain.

**Concrete result**: implement-`backend` + implement-`frontend` + implement-`tests` produce 3 distinct `implement-<name>.md` files; parent emits `patch_set/implement.json` listing all 3 + their content hashes.

### What v1 fan-out left undone

Three rough edges surfaced under Pilot-09 retrospective + the介绍-v6 §16 v2 row:

1. **Downstream stages are blind to the sub-structure.**
   verify / review / integrate treat the parent's `patch_set` as ONE blob. The reviewer template gets the full concatenated diff context across all N children; the verify stage runs all 17 `contract_grep` checks against the union — no per-child breakdown. SmartBear 400-LOC threshold (cited in v1 §"Plan-derived constraint") was the *original* motivation for fan-out; v1 only solved it for the implement side, then collapsed everything again post-merge.

2. **One failed child kills the whole patch_set.**
   `runFanOutParent` settles parent as `succeeded` iff *every* child succeeded (runner.ts:334). If 1 of 3 children fails (timeout / model refusal / build error), the parent fails, and there's no machinery to retry just that 1 child. The user-visible recovery is: re-run the whole implement stage with `aisep run --real --stages implement` — losing the 2 already-good `implement-<name>.md` outputs. Pilot-09 9b "1-of-3 partial fail" boundary test confirmed this is by design in v1.

3. **No conflict detection when children touch the same file.**
   v1 plan-roadmap mandates children declare `affects:` regex in `plan.md` `parallel:` block, and the implement.hbs prompt warns the model "DO NOT touch files outside your `affects:` regex". But there's no machine check — if the model goes off-script and 2 children both modify `packages/foo/index.ts`, `patch_set` manifest happily lists both, and downstream apply (still manual in v1) breaks unpredictably.

### Why now

- v0 + v1 fan-out are stable (333 monorepo tests, 0 dep-cruiser violations as of PR #74).
- Pilot-10b retrospective explicitly tagged "v2 fan-in" as next-quarter target.
- M0.5 / M1B+ workstream pulled enterprise-admin vertical priorities forward — v2 unlocks "1-人企业级" multi-module patches (backend + ios + admin-UI parallel) which the vertical demands.

## Scope

**In:**

1. **`fan_in` stage_run role + downstream wiring.** When parent stage's `subStages: [...]` is non-empty, the *successor* stage runs N times — one per child — and aggregates back to a single successor parent. Concretely: `implement (parent, 3 children) → verify (parent, 3 children) → review (parent, 3 children) → integrate (parent, 1 aggregation)`. This is the dual of fan-out: instead of one stage producing N artifacts, one upstream-N produces one downstream-N.

2. **Per-child retry without full re-run.** New `aisep run --retry-child <child-id> [--bump-timeout]` CLI subcommand. Runner re-spawns just the named child with optionally bumped timeout (composes with F3); parent's `patch_set` manifest is re-aggregated incidentally.

3. **`fanOutAffects` schema + grep-time conflict detection.** Each child stage_run gets a `affects: string[]` field declaring file-path regex it claims. Runner refuses fan-in dispatch if 2 children's `affects` patterns match the same file under a `manifest_check` pass against the post-implement on-disk state.

4. **Wire protocol `aisep-protocol@0.4.0`.** Schema additions are backwards-incompatible (new required fields when `fanOutRole !== "normal"`), so we bump per ADR-0010 schema migration rules. v1 workspaces continue to work as long as no fan-in is invoked; first fan-in run requires `--accept-schema-bump`.

5. **`report.html` per-child stage breakdown.** Option E (E.1+E.2, shipped in PR #68 commits `03df7ba`+`81d7056`) renders one timeline per stage. v2 extends to per-child sub-timelines under fan-out / fan-in parents, with per-child contract_grep tables.

**Out (deferred to v3 cycle):**

- Nested fan-out (child of fan-out spawns its own fan-out). v1 explicitly rejected this via `superRefine`; v2 keeps the restriction.
- Cross-child memory sharing during execution (each child still calls `memoryProvider.retrieve` independently per R11).
- Automatic conflict *resolution* (auto-merge of overlapping diffs). v2 only *detects* overlaps and fails-terminal-user-decides.
- Dynamic re-planning (parent inserts a new child mid-run based on a failing sibling's output). That's v3 cycle territory.

## Open questions

### Q1 — Schema bump scope: 0.3.x → 0.4.0 OR 0.3.x → 0.3.y?

Adding required `affects: string[]` to `fanOutRole === "child"` rows + `subStages` field semantics on downstream parents changes the wire format. ADR-0010 says: "**any new required field is a MAJOR.MINOR bump**". So **0.4.0**. But if we make `affects` optional with a default of `[".*"]` (= "this child may touch anything"), the bump is just a MINOR (`0.3.1`).

**Recommendation**: 0.4.0. `affects: [".*"]` default would silently disable the conflict detection feature — defeats its purpose. Force users to declare; offer a `--accept-schema-bump` flag for one-time migration.

### Q2 — Scheduler API: extend `nextReady` or add `nextReadyWithFanIn`?

v1 `scheduler.nextReady(parentId, runs, cap)` returns the ready batch for fan-out's children. Fan-in adds a different question: "given that fan-out parent X has 3 children at status=succeeded, what downstream stage_runs should I dispatch?" — fundamentally different shape (a 1→N dispatch vs N→1 aggregation trigger).

**Candidate A**: Extend `nextReady` with an optional `mode: "fan-out" | "fan-in"` parameter. Pro: one entry point, pure function. Con: signature divergence makes call sites less typesafe.

**Candidate B**: New pure function `nextReadyFanInDispatch(parentRun, childRuns)` returning the downstream successor children to create. Pro: separate concerns, easier to test. Con: 2 entry points; the cli layer needs to know which to call when.

**Recommendation**: Candidate B. Aligns with the "pure function per concern" R6 boundary preserved in v1 scheduler.

### Q3 — Per-stage fan-in OR stage-pair fan-in only?

Option α (per-stage): every stage can be fan-in. e.g. verify alone could fan-in (3 contract checks run in parallel) even if implement was non-fan-out.

Option β (stage-pair only): fan-in is only triggered by an *upstream* fan-out parent. If implement was fan-out=3, then verify gets fan-in=3 too. Otherwise stages stay normal.

**Recommendation**: β for v2. α-style decoupled fan-in dramatically increases the state-machine surface and is the v3 cycle question disguised. β preserves the 1-to-1 child→child mapping which makes patch_set traceability + per-child retry trivial.

### Q4 — Conflict detection: machine check OR honor-system?

v1 honor-system (just a prompt warning) demonstrably fails when the model has no `affects:` declaration to anchor to. Options:

α. **Grep-time check** (proposed): after all children's `implement-<name>.md` are on disk, runner extracts the modified-file list from each child's manifest header, computes the union, refuses fan-in dispatch if any file appears in 2+ children. Strict but predictable.

β. **Apply-time check**: only fail when patch_set actually gets applied (= integrate stage). Lets the model self-correct via review. But integrate is currently a thin wrapper; deeper apply logic is v3 cycle work.

**Recommendation**: α. Aligns with v1 plan-roadmap "force terminal user decision on schema-validator failure" (per A.F2 arbitration on v1 proposal). User reruns implement with adjusted `affects:` regex in plan.md.

### Q5 — Child retry semantics: stage_run id-stable OR new id?

`aisep run --retry-child <id> --bump-timeout`. Two interpretations:

α. **id-stable**: existing stage_run row's `status` flips `failed → running → succeeded`, attempt log grows. Forensic trail preserved on one row. Closer to F3 timeout retry which doesn't create a new attempt.

β. **new id**: append a new stage_run row with `predecessorId: <retried-id>`. Cleaner audit trail; can show "Retry 1 / Retry 2" in report.html.

**Recommendation**: α with a new attempt entry (consistent with F3). β is overkill for v2; reconsider in v3 if cycle proposals need "true historical replay" semantics.

### Q6 — `report.html` fan-in visualization: stacked timeline OR per-stage tabs?

Stacked-timeline: parent stage shows as a single row with N inner-bars (one per child). User clicks to expand.

Per-stage tabs: top-level tabs for each stage; tab content shows N-column grid for fan-out / fan-in stages.

**Recommendation**: Stacked-timeline. The Option E `report.html` already has the timeline visual; this is an extension, not a rewrite. Per-stage tabs would force re-layout (and bloat the single-file HTML budget).

## 7-question anchor gate

Per CLAUDE.md §"Layered Spiral Delivery" — each milestone must clear 7 anchor questions before骨架 commits land:

1. **Data model** — `AisepStageRun.affects: string[]` added (Q1). `subStages` semantics extended on non-implement stages (was implement-only in v1). Schema-locked in `aisep-protocol@0.4.0`.
2. **Protocol** — wire bump 0.3.x → 0.4.0. Breaking change requires `--accept-schema-bump` on first fan-in run; downgrade path via `aisep migrate --to 0.3` (left as deferred utility; v2 ship doesn't require it).
3. **Compatibility** — existing v0.3 workspaces continue to load; fan-in path is opt-in (only triggered when an upstream parent has `subStages.length > 0`).
4. **Irreversibility** — `affects` declaration in plan.md is human-readable + reviewable; no runtime irreversibility introduced.
5. **Permissions** — no new permission surface (still uses `claude --print` per stage_run; no new tool grant; no new filesystem write outside `<workspace>/.aisep/`).
6. **Resource contention** — fan-in dispatches at most N successors concurrently where N = upstream's `subStages.length` (bounded by v1's `concurrencyCap` = 4 plan-roadmap hard ceiling). No new resource axis.
7. **Rollback** — single git-revert of the v2 schema PR + a deferred `aisep migrate --to 0.3` utility. Workspaces with v0.4.0 state files become unreadable by v0.3 binaries (acceptable per ADR-0010 MAJOR.MINOR rules).

## Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Child retry races with parent re-aggregation if user runs `--retry-child` while parent is still settling | HIGH | retry-child refuses to start if parent.status === "running"; lock via in-process mutex |
| R2 | `affects` regex too loose (e.g. `.*`) silently disables conflict detection | MEDIUM | plan validator rejects child `affects: [".*"]` with a hard error pointing to user docs |
| R3 | Per-child verify multiplies contract_grep cost N× (3 children × 17 checks = 51 greps) | MEDIUM | contract_grep already a few-ms per check; cap N=4 keeps worst-case bounded. Document in USER_MANUAL |
| R4 | Schema bump 0.3→0.4 surprises users with on-disk state.json from v1 era | HIGH | v0.4 binary refuses to read v0.3 state.json without `--accept-schema-bump` + clear migration message |
| R5 | Fan-in introduces a 2-axis concurrency × retry combinatorial state space; bugs hard to reproduce | HIGH | scheduler.ts logic stays pure (state transitions only); side effects flow through runner; unit-test the pure function exhaustively (≥ 25 cases) before wiring runner |
| R6 | report.html per-child sub-timelines bloat the single-file budget beyond reasonable browser load | LOW | report-builder pre-truncates sub-timelines that have > 100 stage_runs each |

## Dependencies / blockers

- **PR #68 (v1 fan-out)**: ✅ merged 2026-05-13
- **PR #74 (Phase 2.F cleanup)**: ✅ merged 2026-05-13
- **ADR-0010 schema migration** policy: ✅ shipped pre-v0 (referenced by v1, applicable here)
- **harness-review-workflow** for cross-review: ✅ available; this proposal will invoke it post-DRAFT
- **reviewer-cross** cursor-agent profile: ✅ available; required by harness-review-workflow proposal mode

## Migration path (for users)

1. `pnpm install` against v0.4.0 monorepo (just a bump, no API change for non-fan-in users).
2. `aisep run` with no fan-in: identical to v1 behavior. v0.3 workspaces continue working.
3. First fan-in run on a fresh workspace: `aisep run --real --workspace <new> --accept-schema-bump`.
4. Existing v0.3 workspace + fan-in: explicitly `aisep migrate --workspace <path> --to 0.4` (utility deferred to first user request; tracker entry in BACKLOG).

## ADR-lite

**Decision 1**: v2 fan-in is **β** (stage-pair only, upstream parent triggers downstream fan-in). Rationale: simpler state machine, preserves 1-to-1 traceability, doesn't preempt v3 cycle.

**Decision 2**: `affects: string[]` is **required** on every `fanOutRole === "child"` row. No defaulting to `[".*"]`. Rationale: silent disabling of conflict detection defeats its purpose; force explicit declaration.

**Decision 3**: `aisep-protocol@0.4.0` MAJOR-MINOR bump. Rationale: breaking schema change per ADR-0010; v0.3 ↔ v0.4 incompatibility is acceptable on a 1-binary-1-user system.

**Decision 4**: `--retry-child <id>` flag, attempt-appending semantics (not new-row). Rationale: consistent with F3 timeout retry; defer "true historical replay" to v3.

**Non-decisions** (out of scope for v2, captured for v3 sibling proposals):
- Cross-child memory sharing during execution.
- Auto-merge of overlapping diffs.
- Dynamic re-planning (parent inserts new child mid-run).

**Promotion gate**:
- ADR-lite promotes to permanent `docs/adr/vessel/ADR-022-aisep-v2-fan-in.md` only after cross-review converges + post-merge dogfood (Pilot-12+).

## Dogfood gate

v2 ships only after a Pilot-12 run that:
- 3-child implement fan-out → 3-child verify fan-in → 1-child integrate aggregation
- 1 of 3 children retried via `--retry-child` with `--bump-timeout` and re-aggregated successfully
- Conflict detector triggers a terminal failure when injected with overlapping `affects` regex
- `report.html` renders the per-child sub-timeline
- `pnpm -r test` post-implementation ≥ current baseline (366 tests) + new fan-in tests
- 0 dep-cruiser violations

## Test matrix (drafted; finalize post-review)

| Layer | New tests | Approach |
|---|---|---|
| aisep-protocol | ~12 | zod schema round-trip for `AisepStageRun.affects` + cross-version round-trip (0.3 ↔ 0.4) |
| aisep-core scheduler | ~10 | pure-function `nextReadyFanInDispatch()` cases (all-children-succeeded, partial-failure, retry-while-running) |
| aisep-core runner | ~8 | fan-in dispatch happy path + 1-child-failed-blocks-aggregation + retry-child id-stable behavior |
| aisep-cli | ~5 | argv parse for `--retry-child` + integration with mock executor end-to-end |
| Total | ~35 new tests, target post-merge ≈ 400 total |

## Open issues (post-DRAFT, for cross-review to address)

1. **Conflict detection regex performance** — does grep-time scan over O(N children × M files) blow up for large patches? Need to bench against a synthetic 100-file 5-child patch_set.
2. **Schema migration utility scope** — is `aisep migrate --to 0.4` v2-blocking or can we ship without it and ask early adopters to start fresh?
3. **Per-child `claude --print` token budget** — does the per-child review/verify context inherit parent's upstream budget cap, or get a fresh budget? Affects how big a fan-in can practically be.
4. **`report.html` size budget** — 5 children × 10 stages × 17 contract_grep checks = 850 cells; does it still load in browser?
5. **Bypass path for emergency** — if conflict detector falsely rejects a legitimate fan-in (regex too strict), what's the user override? `--force` flag, or plan.md edit required?

## What this proposal is NOT

- Not a v3 cycle (review→revise loop) preview.
- Not a "fan-out v1 patch" — separate proposal.
- Not a self-host gate (AISEP modifying AISEP).
- Not a multi-user concurrency redesign — single-binary-single-user remains assumed.

---

**Next steps after DRAFT pushed**:
1. Run `harness-review-workflow` in `contract` mode (2 reviewers heterogeneous: vessel-architect on Claude + reviewer-cross on cursor-agent gpt-5.5-medium).
2. Phase 1 independent reviews → Phase 2 cross-pollinate react → Phase 3 author arbitration. Iterate to converge.
3. On converge: rename to `docs/aisep/05_v2-fan-in.md`, ship as v2 final + ADR-022 promote.
4. Open BACKLOG entry `aisep-v2-implement` (status=planned, depends_on=this proposal).
