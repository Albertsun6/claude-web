# Proposal: AISEP v2 fan-in — multi-source aggregation + per-child failure recovery

> **Status: v0.2 — Phase 1+2 dual-review converged 2026-05-13** (pending v0.2 verification round + ADR-022 promote)
> Date: 2026-05-13
> Branch: `docs/aisep-v2-fan-in-proposal`
> Author: Claude Opus 4.7
> Mode: `contract` (per harness-review-workflow — schema + runner contract + ADR-lite + dogfood gate)
> Target ship: 2026-06-30 (per介绍-v6 §16 roadmap)
>
> **Review trail (Phase 1+2)**:
> - Phase 1 Architect: [aisep-v2-fan-in-arch-2026-05-13-1750.md](../reviews/aisep-v2-fan-in-arch-2026-05-13-1750.md)
> - Phase 1 Cross (cursor-agent gpt-5.5-medium): [aisep-v2-fan-in-cross-2026-05-13-1750.md](../reviews/aisep-v2-fan-in-cross-2026-05-13-1750.md)
> - Phase 2 React Architect: [aisep-v2-fan-in-react-arch-2026-05-13-1755.md](../reviews/aisep-v2-fan-in-react-arch-2026-05-13-1755.md)
> - Phase 2 React Cross: [aisep-v2-fan-in-react-cross-2026-05-13-1755.md](../reviews/aisep-v2-fan-in-react-cross-2026-05-13-1755.md)
> - Phase 3 Arbitration: [aisep-v2-fan-in-arbitration-2026-05-13.md](../reviews/aisep-v2-fan-in-arbitration-2026-05-13.md) — 4 BLOCKER + 8 MAJOR + 4 MINOR all accepted, 0 user-decision, 0 reject
>
> **v0.1 → v0.2 changes** (incorporating all 16 accepted findings):
> - F1: `ADR-0010` corrected to `ADR-0015` (top-level, has explicit MAJOR/MINOR/PATCH table) + `ADR-006` cited as supporting; Decision 5 adds v0.x stabilization supersede language
> - F2: §7-anchor "Compatibility" rewritten — v0.3 fan-out state needs migrate; non-fan-out v0.3 state loads cleanly
> - F3: §Q5 picks option C (id-stable + explicit state-machine amendment); state-machine invariant amendment documented
> - F4: new §Q1b — `FAN_OUT_ALLOWED_STAGES = {implement, verify, review}` (integrate excluded; integrate is fan-in terminal)
> - F5: §Q5 splits retry-child from F3 retry — independent code paths, no "consistent with F3" claim
> - F6: §Q3 末尾加 "Implicit revocation" of v1's `predecessorIds[]` plan
> - F7: §R1 mitigation tightened to "parent.status terminal"; new §R7 cross-process race (mechanism left as implementation, dogfood gate covers)
> - F8: §Dogfood gate adds 2 cross-version round-trip ship conditions
> - F9: §Q4 conflict detection picks declared `affects` overlap (NOT actual modified-files); patch_set manifest unchanged in v2
> - F10: §Scope #5 expanded — extend `AisepReportFanOutGroup` to `AisepReportParallelGroup` with `direction: "out" | "in"`
> - F11: `aisep migrate --to 0.4` reclassified from deferred to v2-blocking IF v0.3 fan-out state exists; deferred only for fresh workspaces
> - F12: §Scope #1 + §Q1b — `fan_in` is **derived behavior** from `fanOutRole === 'parent' && subStages.length > 0` on a downstream stage; no new enum value
> - m1/m4: 366 baseline (was 333); Open Issue #4 algebra corrected to ~255 cells
> - m2: `--force-conflict` decision — v2 ships without it; user edits plan.md
> - m3: Q1 air-quote folded into F1 fix (cites real ADR-0015 row #1 text)

## Context

### What v1 fan-out gave us

`runFanOutParent()` (commit `7bccd29` Stage 1 + `79a83fd` Stage 2.runner + `5641dbc` Stage 2.cli-A + `96085a8` Stage 2.cli-B + `28fb21f` Stage 3.1 cancel + `d92e50b` Stage 2.cli-C auto-detect, all shipped in PR #68 merged `b31e341` on 2026-05-13) lets the implement stage dispatch N parallel child stage_runs and aggregate their artifacts into a parent `patch_set` manifest. Pilot-09 dogfooded 3-child happy path; Pilot-10b shipped 10/10 single-implement chain.

The v1 `AisepFanOutRoleSchema` is `"normal" | "parent" | "child"` (3 values). `StageRunCommonShape.subStages: string[]` holds parent's child IDs; `parentStageRunId` on child rows points back. `superRefine` (stage.ts:146-152, 168-174) currently hardcodes `if (run.stage !== "implement")` to reject non-implement parents/children.

**Concrete v1 result**: implement-`backend` + implement-`frontend` + implement-`tests` produce 3 distinct `implement-<name>.md` files; parent emits `patch_set/implement.json` listing 3 patches + their content hashes. `AisepPatchSetManifestSchema` (artifact.ts:139) stores `{subStageId, subStageName, patchFile, contentHash, byteCount}` per child — no modified-files list (matters for §Q4 below).

### What v1 fan-out left undone

Three rough edges surfaced under Pilot-09 retrospective + the介绍-v6 §16 v2 row:

1. **Downstream stages are blind to the sub-structure.**
   verify / review / integrate treat the parent's `patch_set` as ONE blob. The reviewer template gets the full concatenated diff context across all N children; the verify stage runs all 17 `contract_grep` checks against the union — no per-child breakdown. SmartBear 400-LOC threshold (cited in v1 §"Plan-derived constraint") was the *original* motivation for fan-out; v1 only solved it for the implement side, then collapsed everything again post-merge. The report builder ([builder.ts:135](../../packages/aisep-cli/src/report/builder.ts#L135)) currently looks up `stage === "verify"` and reads `artifactContents["verify.md"]` — single-keyed, can't represent N children's verify outputs.

2. **One failed child kills the whole patch_set.**
   `runFanOutParent` settles parent as `succeeded` iff *every* child succeeded ([runner.ts:334](../../packages/aisep-core/src/runner.ts#L334)). If 1 of 3 children fails (timeout / model refusal / build error), the parent fails, and there's no machinery to retry just that 1 child. The user-visible recovery is: re-run the whole implement stage with `aisep run --real --stages implement` — losing the 2 already-good `implement-<name>.md` outputs. Pilot-09 9b "1-of-3 partial fail" boundary test confirmed this is by design in v1.

3. **No conflict detection when children touch the same file.**
   v1 plan-roadmap mandates children declare `affects:` regex in `plan.md` `parallel:` block, and the implement.hbs prompt warns the model "DO NOT touch files outside your `affects:` regex". But there's no machine check — if the model goes off-script and 2 children both modify `packages/foo/index.ts`, `patch_set` manifest happily lists both, and downstream apply (still manual in v1) breaks unpredictably.

### Why now

- v0 + v1 fan-out are stable (366 monorepo tests, 0 dep-cruiser violations as of PR #74 merged 2026-05-13).
- Pilot-10b retrospective explicitly tagged "v2 fan-in" as next-quarter target.
- M0.5 / M1B+ workstream pulled enterprise-admin vertical priorities forward — v2 unlocks "1-人企业级" multi-module patches (backend + ios + admin-UI parallel) which the vertical demands.

## Scope

**In:**

1. **Per-child downstream-stage dispatch (fan-in behavior).** When upstream parent's `subStages: [...]` is non-empty, the *successor* stage runs N times — one per child — and aggregates back to a single successor parent. Concretely: `implement (parent, 3 children) → verify (parent, 3 children) → review (parent, 3 children) → integrate (parent, 1 aggregation)`. This is the dual of fan-out: instead of one stage producing N artifacts, one upstream-N produces one downstream-N.

   **Schema sketch (F12)**: `fanOutRole` enum **unchanged** (`"normal" | "parent" | "child"`). Fan-in behavior is *derived*: a downstream stage_run with `fanOutRole === "parent"` AND `subStages.length > 0` is the fan-in aggregation point; its children mirror the upstream parent's children one-to-one. No new enum value, no new field. The downstream parent's `subStages` array contains downstream-side child IDs (not upstream's IDs); the cross-stage linkage flows via the existing `predecessorId` chain.

2. **Per-child retry without full re-run.** New `aisep run --retry-child <child-id> [--bump-timeout]` CLI subcommand. Runner re-spawns just the named child with optionally bumped timeout (composes with F3); parent's `patch_set` manifest is re-aggregated incidentally.

3. **`fanOutAffects` field + grep-time conflict detection.** Each child stage_run **created under v0.4** gets an `affects: string[]` field declaring file-path regex it claims. Existing v0.3 child rows do NOT have this field; loading them under v0.4 binary requires `aisep migrate --to 0.4` first (see §Migration path). Runner refuses fan-in dispatch if 2 children's `affects` patterns match the same file under a `manifest_check` pass — using **declared overlap detection** (NOT scanning actual on-disk modified files; per §Q4 below).

4. **Wire protocol `aisep-protocol@0.4.0`.** Schema additions are backwards-incompatible (new required `affects` field when `fanOutRole === "child"` AND `protocolVersion >= 0.4.0`), so we bump per the *spirit* of ADR-0015 row #1 (major: 删字段 / 改字段语义) with a v0.x stabilization caveat (see Decision 5 + supersede language in ADR-lite). v1 workspaces without fan-out state continue working; v1 workspaces with v0.3 fan-out state require `aisep migrate --to 0.4` (in-scope for v2; see F11).

5. **`report.html` per-child stage breakdown.** Option E (E.1+E.2, shipped in PR #68 commits `03df7ba`+`81d7056`) renders one timeline per stage. v2 extends to per-child sub-timelines under fan-out / fan-in parents, with per-child contract_grep tables.

   **Report schema extension (F10)**: `AisepReportFanOutGroup` ([types.ts:52](../../packages/aisep-cli/src/report/report/types.ts#L52)) generalizes to `AisepReportParallelGroup` with `direction: "out" | "in"` discriminator; report builder collects `contract_grep` checks from every verify stage_run (not just first), keyed by `(stageRunId, childName)`.

**Out (deferred to v3 cycle):**

- Nested fan-out (child of fan-out spawns its own fan-out). v1 explicitly rejected this via `superRefine`; v2 keeps the restriction (whitelisted stages still cannot nest).
- Cross-child memory sharing during execution (each child still calls `memoryProvider.retrieve` independently per R11).
- Automatic conflict *resolution* (auto-merge of overlapping diffs). v2 only *detects* declared overlaps and fails-terminal-user-decides.
- Dynamic re-planning (parent inserts a new child mid-run based on a failing sibling's output). That's v3 cycle territory.

## Open questions (recommendation pinned post-review)

### Q1 — Schema bump scope: 0.3.x → 0.4.0

Adding required `affects: string[]` to `fanOutRole === "child"` rows (when `protocolVersion >= 0.4.0`) + role-semantic extension on downstream stages = MAJOR-class change per ADR-0015 row #1 ("删字段 / 改字段语义 / 改 enum 已有值"). ADR-0015 grants a "1 minor 窗口" compat window for MAJOR bumps.

In v0.x stabilization (pre-1.0), ADR-006 §5 "breaking change 仅跨 major (v1.x → v2.0)" is **superseded** for AISEP per Decision 5 below: AISEP v0.x can take MAJOR-class wire changes with MINOR-level version label (0.3 → 0.4) provided a `aisep migrate` utility is shipped in the same release. Post-1.0 returns to ADR-006 §5 rule.

**Recommendation (post-review)**: 0.4.0 with `aisep migrate --to 0.4` shipped concurrently (no longer optional/deferred — see F11).

### Q1b (NEW from F4) — Fan-out / fan-in stage whitelist

The current `superRefine` (stage.ts:146-152, 168-174) hardcodes `if (run.stage !== "implement") report error`. v2 must widen this to a whitelist:

```ts
const FAN_OUT_ALLOWED_STAGES = new Set<AisepStage>(["implement", "verify", "review"]);

// superRefine (parent branch)
if (run.fanOutRole === "parent" && !FAN_OUT_ALLOWED_STAGES.has(run.stage)) {
  ctx.addIssue({
    code: "custom",
    path: ["fanOutRole"],
    message: `fanOutRole='parent' only allowed for stages in FAN_OUT_ALLOWED_STAGES (got '${run.stage}')`,
  });
}

// superRefine (child branch) — same check
if (run.fanOutRole === "child" && !FAN_OUT_ALLOWED_STAGES.has(run.stage)) {
  ctx.addIssue({ /* same message */ });
}
```

**`integrate` is excluded** — it's the fan-in terminal aggregation (per §Scope #1 "integrate (parent, 1 aggregation)"); making it a fan-out source would conflict with that semantic.

**Other stages** (intake / research / plan / architecture / contract / retrospect) stay non-fan-out — they have semantic reasons not to parallelize (single seed context, single planning decision, etc.).

### Q2 — Scheduler API: separate `nextReadyFanInDispatch` (Candidate B)

v1 `scheduler.nextReady(parentId, runs, cap)` returns the ready batch for fan-out's children. Fan-in adds a different question: "given that fan-out parent X has 3 children at status=succeeded, what downstream stage_runs should I dispatch?" — fundamentally different shape (a 1→N dispatch decision vs N→1 aggregation trigger).

**Recommendation**: Candidate B — new pure function `nextReadyFanInDispatch(parentRun, childRuns)` returning the downstream successor children to create. Pro: separate concerns, easier to test, preserves R6 boundary. Con: 2 entry points; cli layer chooses which to call based on context — acceptable; cli already has a stage_run dispatch routing layer.

### Q3 — Per-stage fan-in OR stage-pair fan-in only?

**Recommendation**: β stage-pair only for v2. fan-in is only triggered by an *upstream* fan-out parent. If implement was fan-out=3, verify gets fan-in=3 too. Otherwise stages stay normal. α-style decoupled fan-in dramatically increases the state-machine surface and is the v3 cycle question disguised.

**Implicit revocation (F6)**: v0 `stage.ts:120-121` comment notes ``"v2+ adds fan-in by lifting predecessorId to a separate predecessors[] field"``. v2 takes a different path — `subStages` mirroring on downstream parent. The `predecessorIds[]` plan is **revoked** from v0 / v1 expectations:

- v2 fan-in does NOT introduce a `predecessorIds[]` field
- Cross-stage linkage uses the existing single `predecessorId` chain (each downstream child predecessorId points to its corresponding upstream child's id)
- v2 implementation PR will update stage.ts:120-121 comment to: ``"v2 fan-in uses subStages mirroring on both sides; predecessorIds[] is not introduced (revoked from v0 plan, see docs/proposals/aisep-v2-fan-in.md §Q3 Implicit revocation)"``

### Q4 — Conflict detection: declared overlap (declared `affects` regex)

**Recommendation**: α with refinement — **declared overlap detection ONLY**.

Concretely: after all children's stage_runs are created (with their `affects: string[]` populated from `plan.md` parallel: block), runner runs an `assertNoAffectsOverlap()` pre-dispatch check. For each pair of children (Ci, Cj), if any regex in `Ci.affects` matches any regex in `Cj.affects` under a regex-intersect heuristic (e.g. share a common literal-substring anchor), runner refuses fan-in dispatch with a clear error pointing at the conflict.

Conflict detection is **NOT** based on actual modified files post-implement — that would require extending `AisepPatchSetManifestSchema` with `modifiedFiles: string[]`, which v2 explicitly does NOT do. The `patch_set` manifest schema is **unchanged in v2**. If a user's `affects` regex is too loose (e.g. `.*`), the plan validator rejects it (per R2 mitigation).

**Why declared-only, not actual**:
- Cheaper (regex-vs-regex precompute vs O(N children × M files) on-disk scan)
- Catches conflicts before dispatch (saves wasted compute)
- Honest about its limitations — the model still has to obey `affects:` declaration; v2 doesn't try to enforce on-disk behavior

### Q5 — Child retry semantics: id-stable with explicit state-machine amendment (option C)

**Recommendation**: option C — id-stable retry + explicit state-machine amendment. Both reviewers flagged that the current `state-machine.ts:9` + `store.ts:153` make `failed → running` transition impossible.

**v2 amendment**: extend `updateStageRunStatus()` to accept a special `--retry-child` caller marker; only when this marker is set, allow `failed → running` transition for the specific stage_run. All other callers continue to enforce terminal-status invariant.

**Retry semantics**:
- `aisep run --retry-child <id> [--bump-timeout]`:
  1. Verify parent.status ∈ {`failed`, `succeeded`} (terminal — see R1 mitigation)
  2. Verify target child.status === `failed`
  3. Acquire workspace lock (R7); refuse if held by another process
  4. Mark child status: `failed → running` (via amended `updateStageRunStatus()` with retry marker)
  5. Spawn executor (with `--bump-timeout` if requested — uses F3-style 1.5× multiplier)
  6. On completion, append **new attempt** (`attemptN + 1`) to child; status flips to `succeeded` or `failed`
  7. If child succeeds, re-aggregate parent's `patch_set` manifest (parent stays at original status until all children terminal again)
- **Decoupled from F3**: F3 timeout retry is *transparent* (within-single-attempt, no new attempt log entry); retry-child is *user-explicit forensic action* (always appends new attempt). Two independent code paths.

**State-machine documentation**: v2 amendment is captured in §7-anchor "Data model" and the ADR-022 ADR-lite Decision 4. Audit semantics: an attempt log entry distinguishes original failure from later retry success.

### Q6 — `report.html` fan-in visualization: stacked timeline (per-child sub-bars)

**Recommendation**: Stacked-timeline (per-child sub-bars under fan-out/fan-in parents). The Option E `report.html` already has the timeline visual; this is an extension. Per-stage tabs would force re-layout and bloat the single-file HTML budget.

Per F10, this requires extending `AisepReportFanOutGroup` → `AisepReportParallelGroup` (with `direction: "out" | "in"` discriminator) so the renderer can show the per-child sub-structure on both fan-out and fan-in stages without code duplication.

## 7-question anchor gate

Per CLAUDE.md §"Layered Spiral Delivery" — each milestone must clear 7 anchor questions before骨架 commits land:

1. **Data model** — `AisepStageRun.affects: string[]` added (required for `fanOutRole === "child"` when `protocolVersion >= 0.4.0`). `subStages` semantics extended on non-implement stages per Q1b whitelist. State-machine invariant amended to allow `failed → running` via `--retry-child` caller-marker. Schema-locked in `aisep-protocol@0.4.0` + ADR-022.
2. **Protocol** — wire bump 0.3.x → 0.4.0. MAJOR-class change per ADR-0015 row #1, but in v0.x stabilization window (Decision 5 supersede). Migrate utility `aisep migrate --to 0.4` shipped in same release (no longer deferred).
3. **Compatibility** — v0.3 workspaces with **only** `fanOutRole === "normal"` rows load cleanly under v0.4. v0.3 workspaces with v0.3-era fan-out state (parent + children rows) **require** `aisep migrate --to 0.4` to backfill `affects` field on children (using `[".*"]` default with a `migrated_from_v03: true` audit marker — never used for new fan-in dispatch, only for read-back). v0.4 state.json is unreadable by v0.3 binary (deliberate, surfaced via clear error per Dogfood gate condition 8).
4. **Irreversibility** — `affects` declaration in plan.md is human-readable + reviewable. State-machine amendment is additive (new caller-marker path, doesn't remove existing terminal-status enforcement for non-retry callers). Migration is one-way 0.3→0.4 (a future utility could reverse if needed; not v2-blocking). retry-child does not "unfail" original attempt records — new attempt appended, original failure trace preserved.
5. **Permissions** — no new permission surface (still uses `claude --print` per stage_run; no new tool grant; no new filesystem write outside `<workspace>/.aisep/`).
6. **Resource contention** — fan-in dispatches at most N successors concurrently where N = upstream's `subStages.length` (bounded by v1's `concurrencyCap` = 4 plan-roadmap hard ceiling). Cross-process retry race covered by R7 + workspace lock.
7. **Rollback** — single git-revert of the v2 schema PR + the `aisep migrate` utility. Workspaces migrated to v0.4 stay readable by v0.4 binary; rolling back means re-cloning v0.3 binary and applying a reverse migration (deferred utility tracked in BACKLOG; not v2-blocking).

## Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Child retry races with parent re-aggregation if user runs `--retry-child` while parent is still settling | HIGH | `--retry-child` requires `parent.status ∈ {failed, succeeded}` (terminal-only — refuses on `running` / `cancelling`). Refusal echoes current in-flight child ID list + suggests `aisep run --status` |
| R2 | `affects` regex too loose (e.g. `.*`) silently disables conflict detection | MEDIUM | Plan validator rejects child `affects: [".*"]` with a hard error pointing to user docs |
| R3 | Per-child verify multiplies contract_grep cost N× (3 children × 17 checks = 51 greps) | MEDIUM | `contract_grep` already a few-ms per check; cap N=4 keeps worst-case bounded. Document in USER_MANUAL |
| R4 | Schema bump 0.3→0.4 surprises users with on-disk state.json from v1 era | HIGH | v0.4 binary detects v0.3 state.json + suggests `aisep migrate --to 0.4`; clear error not crash. Dogfood gate ship condition 7/8 mechanize this |
| R5 | Fan-in introduces 2-axis concurrency × retry combinatorial state space; bugs hard to reproduce | HIGH | scheduler.ts logic stays pure (state transitions only); side effects flow through runner; unit-test the pure functions exhaustively (`nextReady` + `nextReadyFanInDispatch` + retry decision: ≥ 25 cases) before wiring runner |
| R6 | report.html per-child sub-timelines bloat the single-file budget beyond reasonable browser load | LOW | Worst-case estimate: 3 fan-out stages × 5 children × 17 contract_grep ≈ 255 cells (was inflated 850 in v0.1 by counting all 10 stages); R6 mitigation truncates timelines with >100 stage_runs |
| R7 (NEW from F7) | Cross-process retry race: a second `aisep run` instance attempts `--retry-child` on the same workspace while a first instance is mid-run | MEDIUM | Workspace lock at `<workspace>/.aisep/.lock` (mechanism = implementation decision, choose between flock / pid-file / SQLite advisory). Dogfood gate ship condition 9 covers cross-process fail-fast |

## Dependencies / blockers

- **PR #68 (v1 fan-out)**: ✅ merged 2026-05-13 (b31e341)
- **PR #74 (Phase 2.F cleanup)**: ✅ merged 2026-05-13 (ba60c20)
- **ADR-0015 schema migration policy**: ✅ shipped at M-1 (2026-05-03) — primary citation for Q1 / Decision 5
- **ADR-006 schema evolution**: ✅ shipped 2026-05-09 — supporting citation, superseded by Decision 5 in v0.x window only
- **harness-review-workflow + reviewer-cross**: ✅ available; Phase 1+2 converged 2026-05-13

## Migration path (for users)

1. `pnpm install` against v0.4.0 monorepo (just a bump, no API change for non-fan-in users).
2. `aisep run` on v0.3 workspace with **only** normal stage_runs: identical to v1 behavior.
3. First fan-in run on a **fresh** workspace: `aisep run --real --workspace <new>` — no flag needed (v0.4 is default).
4. Existing v0.3 workspace WITH v0.3-era fan-out state + want to invoke fan-in: explicitly run `aisep migrate --workspace <path> --to 0.4` first (backfills `affects: [".*"]` on existing children with `migrated_from_v03: true` audit marker; not usable for new fan-in dispatch). This utility is **v2-blocking** (not deferred — F11).
5. Existing v0.3 workspace WITH v0.3-era fan-out state but NOT planning to use fan-in: also requires migrate (v0.4 binary refuses to read v0.3 fan-out state without it). User can also stay on v0.3 binary if they don't need v2 features.

## ADR-lite (for promotion to docs/adr/vessel/ADR-022-aisep-v2-fan-in.md)

**Decision 1**: v2 fan-in is **β** (stage-pair only, upstream fan-out parent triggers downstream fan-in). Rationale: simpler state machine, preserves 1-to-1 traceability, doesn't preempt v3 cycle. (Q3)

**Decision 2**: `affects: string[]` is **required** on every newly-created v0.4 `fanOutRole === "child"` row. No defaulting to `[".*"]` for new rows. Migrated-from-v0.3 rows carry `[".*"]` with audit marker (cannot trigger fresh fan-in dispatch). Rationale: silent disabling of conflict detection defeats its purpose for new rows; preserves existing workspaces via marker.

**Decision 3**: `aisep-protocol@0.4.0` MAJOR-class wire bump (per ADR-0015 row #1: 改字段语义 + new required field) with MINOR version label (0.3 → 0.4). Rationale: v0.x stabilization window — see Decision 5.

**Decision 4**: `--retry-child <id>` flag, id-stable + explicit state-machine amendment (option C). Rationale: preserves audit trail on one row; F3 timeout retry remains transparent within-attempt. Two independent code paths.

**Decision 5 (NEW from F1)**: **AISEP protocol stabilization period supersede**. In the AISEP v0.x phase (pre-1.0), MAJOR-class wire changes per ADR-0015 row #1 (删字段 / 改字段语义 / 改 enum 已有值) MAY be packaged as MINOR-level version bumps (e.g. 0.3 → 0.4) provided a `aisep migrate --to X.Y` utility ships in the same release and a cross-version round-trip dogfood gate validates both directions (see Dogfood gate condition 7/8). Post-1.0, ADR-006 §5 "breaking change 仅跨 major" applies in full; ADR-0015 row #1 MAJOR bumps cross 1.0 → 2.0 etc. The v0.4 release is the first invocation of this supersede.

**Non-decisions** (out of scope for v2, captured for v3 sibling proposals):
- Cross-child memory sharing during execution.
- Auto-merge of overlapping diffs.
- Dynamic re-planning (parent inserts new child mid-run).
- `--force-conflict` bypass flag (m2: v2 ships without; user edits plan.md to resolve false positives. Logged force flag deferred to v3 if real-world false-positive rate justifies it).

**Promotion gate**:
- ADR-lite promotes to permanent `docs/adr/vessel/ADR-022-aisep-v2-fan-in.md` only after **v0.2 verification round** (one more lightweight cross-review pass on this v0.2) + cross-review converges + post-merge dogfood (Pilot-12+).

## Dogfood gate (revised post Phase 3)

v2 ships only after a Pilot-12 run that meets ALL of:

1. **3-child implement fan-out → 3-child verify fan-in → 1-child integrate aggregation** (full chain succeeds)
2. **1 of 3 children retried** via `aisep run --retry-child <id> --bump-timeout` and re-aggregated successfully (verifies Decision 4 + state-machine amendment)
3. **Conflict detector triggers** a terminal failure when injected with overlapping `affects` regex (verifies Q4 declared-overlap + R2 plan-validator)
4. **`report.html` renders** the per-child sub-timeline using the extended `AisepReportParallelGroup` (verifies F10 + Q6)
5. **`pnpm -r test` post-implementation ≥ 366 + new fan-in tests** (≥ baseline 366; target post-merge ≥ 400 per Test matrix)
6. **0 dep-cruiser violations** (R6 boundary preserved)
7. **(NEW from F8) Cross-version round-trip A**: v0.3 state.json fed to v0.4 binary, first `aisep run` exits with clear migrate-suggestion error (not crash, not silent re-write)
8. **(NEW from F8) Cross-version round-trip B**: v0.4 state.json fed to v0.3 binary, schema validation error (zod superRefine rejects new `affects` field), not silent drop
9. **(NEW from F7) Cross-process retry race**: two `aisep run` instances on same workspace — second instance's `--retry-child` either acquires-or-fails-cleanly (no torn writes to state.json)

## Test matrix (revised post Phase 3)

| Layer | New tests | Approach |
|---|---|---|
| aisep-protocol | ~16 | zod schema round-trip for `AisepStageRun.affects` + cross-version round-trip (0.3 ↔ 0.4) + Q1b whitelist (inside/outside/mismatch parent-child stage) + state-machine `failed → running` via retry-marker |
| aisep-core scheduler | ~12 | pure-function `nextReady` (existing, expand for fan-in parents) + new `nextReadyFanInDispatch()` cases (all-children-succeeded, partial-failure, retry-while-running, dispatch-after-retry-success) |
| aisep-core runner | ~12 | fan-in dispatch happy path + 1-child-failed-blocks-aggregation + retry-child id-stable + state-machine amendment + R1 parent.status terminal check + R7 cross-process workspace-lock acquire/release |
| aisep-cli | ~8 | argv parse for `--retry-child` / `--bump-timeout` + integration with mock executor end-to-end + `aisep migrate --to 0.4` smoke + plan validator rejecting `affects: [".*"]` |
| aisep-cli report | ~5 | `AisepReportParallelGroup` direction discriminator + per-child contract_grep table render |
| **Total** | **~53 new tests, target post-merge ≈ 419 (= 366 + 53)** |

## Open issues (post-Phase 1+2 review; for v0.2 verification pass to address)

1. **Conflict detection regex performance** — does declared-overlap regex-intersect heuristic scale for large N? Bench with synthetic 5-child case, each `affects: 10 regex`.
2. **`aisep migrate --to 0.4` implementation scope** — single-shot vs incremental migration? Per F11 it's now v2-blocking; need a dedicated implement-stage task in plan.md.
3. **Per-child `claude --print` token budget** — does the per-child review/verify context inherit parent's upstream budget cap, or get a fresh budget? Affects how big a fan-in can practically be.
4. **`report.html` size budget** — corrected estimate: 3 fan-out stages × 5 children × 17 contract_grep ≈ 255 cells + 7 non-fan-out stages × 1 row timeline. Does this still load in browser? (Was inflated 3× in v0.1 — 850 was wrong.)
5. **R7 workspace-lock mechanism** — flock / pid-file / SQLite advisory? Implementation decision; dogfood gate ship condition 9 enforces fail-fast regardless of mechanism. Decision deferred to implement stage but constraints (POSIX-compatible, NFS-safe-not-required for single-user-Mac) listed here.

## What this proposal is NOT

- Not a v3 cycle (review→revise loop) preview.
- Not a "fan-out v1 patch" — separate proposal.
- Not a self-host gate (AISEP modifying AISEP).
- Not a multi-user concurrency redesign — single-binary-single-user remains assumed.
- Not introducing a `predecessorIds[]` field (v0/v1 plan revoked — see §Q3 Implicit revocation).
- Not changing `AisepPatchSetManifestSchema` (Q4 picks declared-overlap; manifest stays).

---

**Next steps after v0.2 pushed**:
1. Run a lightweight v0.2 verification cross-review (Phase 1 round 2 — focus: are the 16 fixes correctly applied? Does v0.2 introduce any new BLOCKER?)
2. On v0.2 convergence: promote ADR-lite to `docs/adr/vessel/ADR-022-aisep-v2-fan-in.md` (sections 1-5 of ADR-lite become the ADR body); rename proposal to `docs/aisep/05_v2-fan-in.md` (alongside 01-04 vision series); update介绍 HTML deck with v2 status.
3. Open BACKLOG entry `aisep-v2-implement` (status=planned, depends_on=ADR-022; target ship 2026-06-30).
4. Implement stage tasks: schema PR (aisep-protocol@0.4.0 + migrate util) → scheduler PR → runner PR → cli PR → report PR → Pilot-12 dogfood → ship.
