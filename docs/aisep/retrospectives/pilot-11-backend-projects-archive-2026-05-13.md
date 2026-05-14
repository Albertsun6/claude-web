# Pilot-11 — Real-business dogfood (backend `PATCH /api/projects/:id/archive`) — 2026-05-13

## Goal

Second real-business dogfood after Pilot-10b (which validated AISEP on a frontend bug). Pilot-11 expands evidence to a **backend** task — `PATCH /api/projects/:id/archive` soft-delete with `withProjectsLock` discipline — to verify AISEP is not only a frontend-only tool. Targeted at:

1. Validating cross-layer skill (backend route + zod schema + lock-protected store mutation)
2. Exercising F3 timeout retry path (Phase 2.F new feature) if implement times out
3. Confirming `integrate` stage produces honest ship/no-ship verdicts (not theater)

## Setup

- **Workspace**: `/tmp/aisep-pilot-11-projects-archive-2026-05-13/`
- **Mode**: `--real` (ClaudeExecutor + claude --print subprocess)
- **No `--parallel`** (single-file task, fan-out not natural — same shape as Pilot-10b)
- **Default timeout** 10 min (F1 default, post-Pilot-10 fix); F3 single 1.5× retry available if hit
- **Seed**: 4 acceptance criteria + 4 out-of-scope + 2 reference files + 1 hard constraint (CLAUDE.md #9 `withProjectsLock`). 2.5 KB total.

## Outcome — 10/10 stages succeeded, end-to-end ~15 min wall

| Stage | Status | Wall | Output size |
|---|---|---|---|
| intake | succeeded | ~30s | 107 lines |
| research | succeeded | ~50s | 114 lines |
| plan | succeeded | ~45s | 121 lines |
| architecture (brief) | succeeded | ~3min | 1 ADR-style brief |
| contract | succeeded | ~75s | 168 lines |
| **implement** | **succeeded** | **~3min** | **280 lines** (manifest + 5-file diff fence) |
| verify | succeeded | ~3min | 142 lines (contract_grep, ~10 checks) |
| review | succeeded | ~60s | 26 lines |
| integrate | succeeded | ~15s | 33 lines (integration-log.json) |
| retrospect | succeeded | ~60s | 106 lines |

**Total wall time**: ~15 min (vs Pilot-10b 17 min; similar order)
**Total stages succeeded**: 10/10

## What worked (real value, not theater)

1. **intake.md correctly captured the seed's hard constraint** — the `withProjectsLock` invariant from CLAUDE.md #9 made it into intake §risks and propagated through contract.md as a grep-anchor.

2. **plan.md emits 4 tasks (T1-T4) with explicit acceptance criteria per task** — each task carries its own AC list. Plan validator would now have grep-anchors for each AC, suitable for verify.

3. **architecture/brief.md is real ADR-style** — references ADR-001 (forced-opts), ADR-003 (single-lock), proposes a string-literal-union for `?includeArchived=true|false` instead of `z.coerce.boolean()` (a real safety improvement; coerce.boolean() accepts truthy strings unexpectedly).

4. **contract.md has grep-anchors** — `ProjectSchema.archived` boolean required, `withProjectsLock` reference, error type name `ProjectNotFoundError`. Each is a one-line regex anchor that verify can run deterministically.

5. **implement.md is a real multi-file patch** — 5 files (projects-store / route handler / type def / store unit test / a pre-v2 normalization migration). 280 lines including manifest + diff fence. Passed self-manifest check (5/5 file declarations match diff). Patched `package.json` is included for new runtime imports (correctly catching the Pilot-03 retro #1 lesson).

6. **`integrate` stage caught real ship blockers — this is the dogfood headline**:
   - `ready_to_integrate: false` (NOT a rubber stamp)
   - `blockers` array contains:
     - **B1** — "verify-report.json shows integration check ok:false — `packages/backend/test/routes-projects.test.ts` is absent, violating plan T4 AC #4 (route-level supertest assertions for includeArchived omitted / =true / =1 → 400)"
     - **B2** — "review-verdict.json verdict is `pass_with_comments` with 1 `critical` comment (TEST-001) flagged suggested_action: revise; critical-severity revise must land before integrate"
   - `rollback_path: git revert HEAD --no-edit`
   - `migration_safe: true`, `migration_notes: null`
   - `deferred_followups`: 1 entry pointing to maintainer for supertest bundling

   This is the **forensic value** AISEP is supposed to deliver: it produced an honest "this patch is good enough for review but not for merge" verdict, with specific blockers + rollback + followup ownership. Not a theater "all green ship it".

7. **review.md called out missing integration test as `critical`** — independent of integrate's blocker logic, the review stage produced a `pass_with_comments` with one `critical` revise-required comment (TEST-001). This means the chain has 2 independent gates catching the same gap (review + integrate), which is what defense-in-depth looks like.

## What didn't trigger (and why that's data, not failure)

- **F3 timeout retry did NOT trigger** — implement stage finished at ~3 min, well under the 10-min F1 default. F3's 1.5× retry path is for borderline tasks (Pilot-10b finished at 4.6 min with low headroom); Pilot-11's task was smaller. **Data point**: F3 still untested in production-ish conditions; needs a Pilot-12+ with a deliberately heavier implement scope to actually exercise the retry path.

- **F4 incremental-render hint** is template-side; would be visible only if the model needed to pace itself. 280-line patch was well under the ~50KB threshold mentioned in F4. Inactive on this run.

- **F5 cli --help smoke test** is CI-side; doesn't run during `aisep run`. Already validated separately in unit tests.

- **No burst-limit retries (F6)** — only one `claude --print` session at a time on this serial run; F6's 3-4-concurrent throttle path stays untested in solo mode.

## Quantitative

- Pre-Pilot-11 baseline (post PR #68 + #74 + #73): 366 monorepo tests, 0 dep-cruiser violations
- Pilot-11 cost: ~15 min wall + ~600 lines of artifact output across 10 stage files
- F3 / F6 retry paths: 0 invocations (task too small to stress)
- Memory growth: 0 new global-tier records (chain stopped before retrospect promote — no promote logic in current AISEP)

## Honest assessment vs Pilot-10b

| Dimension | Pilot-10b (frontend, 2026-05-13 AM) | Pilot-11 (backend, 2026-05-13 PM) |
|---|---|---|
| Stages succeeded | 10/10 | 10/10 |
| Wall time | ~17 min | ~15 min |
| Patch file count | 1 (single-file frontend fix) | 5 (multi-file backend feature) |
| Patch LOC | ~80 LOC | ~280 LOC (well over SmartBear 400 threshold awareness) |
| `integrate` verdict | `ready_to_integrate: true` + 2 deferred followups (gradient lookup, text overlap — both `pass_with_comments`) | `ready_to_integrate: false` + 2 ship blockers (missing route test, review critical revise) |
| F3 retry exercised? | No (4.6 min implement, edge of old 5-min wall) | No (3-min implement, well under 10-min default) |
| Real bug surfaced? | Yes — `var(--tool)` lookup mismatch caught by review-cross | Yes — missing route-level integration test caught by review + integrate |

## Dogfood verdict (vs the v1 ship gate)

**AISEP produces real value on backend tasks too**, not just frontend.  The chain's **integrate-stage refusal to rubber-stamp** is the load-bearing finding: a v0/v1 deliverable that honestly tells you "your patch is good but incomplete for merge" is much more useful than a chain that always says "ship it". Pilot-10b and Pilot-11 now form a 2-domain (frontend + backend) evidence corpus showing the integrate gate has real teeth.

## What this Pilot does NOT validate

- F3 retry path under real timeout conditions (need a Pilot-12+ with a deliberately heavier implement scope)
- F4 pacing hint effect on 50KB+ patches
- F6 burst-limit retry under concurrent fan-out
- v2 fan-in behavior (the v2 proposal is still under cross-review at the time of this retro)
- Multi-worktree concurrent `aisep run` (R7 from v2 proposal — would need 2 simultaneous workspaces)

## Next actions

1. **Optional**: open a focused Pilot-12 with a larger implement scope to actually exercise F3 retry path. Candidate task: a 5+ file refactor that crosses backend → shared → frontend boundary.
2. **Patch is NOT applied to Vessel mainline** — this is Pilot evidence only; following pilot convention, the produced patch stays in `/tmp/aisep-pilot-11-*` for inspection but does not land.
3. v2 fan-in proposal (currently DRAFT in PR #75) doesn't depend on Pilot-11 evidence; this retro is an independent verification that v0/v1 is solid base for v2 work.

## Files

- Workspace: `/tmp/aisep-pilot-11-projects-archive-2026-05-13/`
- State snapshot: `/tmp/aisep-pilot-11-projects-archive-2026-05-13/.aisep/state.json`
- Run log: `/tmp/aisep-pilot-11-projects-archive-2026-05-13/.run-log.txt`
- 10 stage artifacts: `intake.md` / `research.md` / `plan.md` / `architecture/brief.md` / `contract.md` / `implement.md` / `verify.md` / `review.md` / `integrate.md` / `retrospect.md`
- Seed: `/tmp/aisep-pilot-11-projects-archive-2026-05-13/seed.txt`
