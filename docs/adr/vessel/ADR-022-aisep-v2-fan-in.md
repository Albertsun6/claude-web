# ADR-022: AISEP v2 fan-in — multi-source aggregation + per-child failure recovery

- **Status**: Accepted (2026-05-13, post Phase 1+2+3 cross-review converge + Round 2 verification CLEAR-TO-SHIP)
- **Date**: 2026-05-13
- **Deciders**: yongqian
- **Tags**: aisep, schema-evolution, wire-protocol, fan-in, retry-semantics
- **Resolves**: AISEP v0/v1 leaves 3 rough edges: downstream stages treat patch_set as blob, one failed child kills patch_set, no machine conflict detection for children touching same file
- **Depends on**: [ADR-0015 schema-migration](../ADR-0015-schema-migration.md) (primary supersede target via Decision 5), [ADR-006 schema-evolution](ADR-006-schema-evolution.md) (supporting supersede target), [ADR-018 aisep-vs-harness](ADR-018-aisep-vs-harness.md) (AISEP boundary)
- **Source proposal**: [docs/proposals/aisep-v2-fan-in.md](../../proposals/aisep-v2-fan-in.md) (v0.2 converged)
- **Review trail**:
  - Phase 1 Architect: [docs/reviews/aisep-v2-fan-in-arch-2026-05-13-1750.md](../../reviews/aisep-v2-fan-in-arch-2026-05-13-1750.md)
  - Phase 1 Cross (cursor-agent gpt-5.5-medium): [docs/reviews/aisep-v2-fan-in-cross-2026-05-13-1750.md](../../reviews/aisep-v2-fan-in-cross-2026-05-13-1750.md)
  - Phase 2 React Architect: [docs/reviews/aisep-v2-fan-in-react-arch-2026-05-13-1755.md](../../reviews/aisep-v2-fan-in-react-arch-2026-05-13-1755.md)
  - Phase 2 React Cross: [docs/reviews/aisep-v2-fan-in-react-cross-2026-05-13-1755.md](../../reviews/aisep-v2-fan-in-react-cross-2026-05-13-1755.md)
  - Phase 3 Arbitration: [docs/reviews/aisep-v2-fan-in-arbitration-2026-05-13.md](../../reviews/aisep-v2-fan-in-arbitration-2026-05-13.md) (4 BLOCKER + 8 MAJOR + 4 MINOR all accepted, 0 user-decision, 0 reject)
  - Round 2 Arch verification: [docs/reviews/aisep-v2-fan-in-r2-arch-2026-05-13-1815.md](../../reviews/aisep-v2-fan-in-r2-arch-2026-05-13-1815.md) (16/16 correct, 0 new BLOCKER, CLEAR-TO-SHIP)

## Context

AISEP v0/v1 (linear 10-stage chain + static fan-out + Option E HTML report) shipped 2026-05-08 → 2026-05-13 (PR #68 merge `b31e341` + Phase 2.F PR #74 merge `ba60c20`). 366 monorepo tests pass, 0 dep-cruiser violations, Pilot-10b (frontend) + Pilot-11 (backend) confirm `integrate` stage produces honest ship/no-ship verdicts across 2 domains.

Three v1 limitations require v2 schema work:
1. Downstream stages (verify/review/integrate) treat parent's `patch_set` as one blob. The report builder ([builder.ts:135](../../../packages/aisep-cli/src/report/builder.ts#L135)) and verify/review stages cannot represent N children's outputs without schema extension.
2. Failed child kills whole patch_set ([runner.ts:334](../../../packages/aisep-core/src/runner.ts#L334) — parent succeeds iff all children succeed). No per-child retry; user must re-run whole implement stage.
3. No machine check when 2 children both modify same file — model honor-system only via `affects:` prompt warning.

v2 fan-in target ship: 2026-06-30 per `aisep的介绍-v7.html` §16 roadmap.

## Decision

5 contract-level decisions binding v2 implementation:

### Decision 1 — Stage-pair fan-in only (β option, not α decoupled)

Fan-in is triggered ONLY by an upstream fan-out parent. If implement fans-out to 3 children, verify gets 3 fan-in children too (one-to-one mapping). Otherwise stages stay normal.

**Rationale**: α-style decoupled fan-in (per-stage independently fans-in) explodes state machine surface and preempts v3 cycle's dynamic-replan question. β preserves 1-to-1 child→child traceability and makes per-child retry trivial. Phase 1+2 reviewers + Phase 3 arbitration both pinned this choice.

### Decision 2 — `affects: string[]` required on all newly-created v0.4 fan-out child rows

Every `fanOutRole === "child"` row created under `protocolVersion >= 0.4.0` MUST carry an `affects: string[]` declaration. No defaulting to `[".*"]` for new rows (silent disabling of conflict detection defeats its purpose).

Existing v0.3-era child rows migrated via `aisep migrate --to 0.4` carry `[".*"]` with `migrated_from_v03: true` audit marker. Marker prevents migrated rows from triggering fresh fan-in dispatch (read-only forensic only).

**Rationale**: strict-by-default. Forces explicit conflict-detection contract; preserves existing workspaces via audit marker.

### Decision 3 — `aisep-protocol@0.4.0` MAJOR-class wire bump with MINOR version label

Adding required `affects` field on child rows when `protocolVersion >= 0.4.0` is a MAJOR-class change per ADR-0015 row #1 ("删字段 / 改字段语义 / 改外键关系 / 改 enum 已有值"). The version label remains `0.3 → 0.4` (MINOR-formatted) rather than `0.x → 1.0` (per ADR-006 §5) — see Decision 5 supersede.

**Rationale**: AISEP is in pre-1.0 stabilization; semantic-MAJOR changes with MINOR-label bump are conventional in the v0.x window provided migrate utility ships in the same release.

### Decision 4 — `--retry-child <id>` flag, id-stable retry with explicit state-machine amendment (option C)

`aisep run --retry-child <child-id> [--bump-timeout]` allows the user to retry a specific failed child without re-running its siblings. The state machine is amended to accept a `--retry-child` caller marker that permits `failed → running` transition for the named stage_run; all other callers retain the existing terminal-status invariant.

Retry semantics:
1. Verify parent.status ∈ {`failed`, `succeeded`} (terminal)
2. Verify target child.status === `failed`
3. Acquire workspace lock (per R7); refuse if held
4. Mark child status `failed → running` (amended `updateStageRunStatus()`)
5. Spawn executor (`--bump-timeout` uses F3-style 1.5× multiplier if set)
6. On completion, append new attempt (`attemptN + 1`); status flips `succeeded` or `failed`
7. If child succeeds, re-aggregate parent's `patch_set` manifest

**Decoupled from F3**: F3 timeout retry is transparent (within-single-attempt, no new attempt log). retry-child is user-explicit forensic action (always appends new attempt). Two independent code paths.

**Rationale**: id-stable preserves audit on one row + per-child attempt history. State-machine amendment is additive (caller-marker pattern); existing terminal-status invariant unchanged for non-retry callers.

### Decision 5 — AISEP protocol stabilization period supersede

In the AISEP v0.x phase (pre-1.0), MAJOR-class wire changes per ADR-0015 row #1 (删字段 / 改字段语义 / 改外键关系 / 改 enum 已有值) **MAY be packaged as MINOR-level version bumps** (e.g. `0.3 → 0.4`) **provided BOTH**:

1. A `aisep migrate --to X.Y` utility ships in the same release;
2. A cross-version round-trip dogfood gate validates BOTH directions (v0.X state.json → v0.(X+1) binary → clear migrate error; v0.(X+1) state.json → v0.X binary → schema validation error, not silent drop).

Post-1.0, ADR-006 §5 "breaking change 仅跨 major (v1.x → v2.0)" applies in full; ADR-0015 row #1 MAJOR bumps map to 1.0 → 2.0 etc.

**This v0.4 release is the first invocation of this supersede.** ADR-022 is the explicit ADR-lite that authorizes the supersede; future v0.x → v0.(x+1) bumps SHALL cite this ADR.

**Rationale**: ADR-0015 + ADR-006 were both written for in-product schemas (SQLite + Zod + Swift four-end alignment), not for pre-1.0 single-binary single-user protocols. AISEP v0.x is on a different stabilization timeline; locking it to "MAJOR = 1.x → 2.x" would force premature 1.0 declaration.

## Non-decisions (NOT in scope for v2, captured for v3)

- Cross-child memory sharing during execution (each child still calls `memoryProvider.retrieve` independently per R11).
- Auto-merge of overlapping diffs (v2 only DETECTS declared overlaps + fails-terminal-user-decides).
- Dynamic re-planning (parent inserts new child mid-run based on failing sibling's output) — v3 cycle territory.
- `--force-conflict` bypass flag (v2 ships without; user edits plan.md to resolve false positives. Logged force flag deferred to v3 if real-world false-positive rate justifies it).
- Nested fan-out (child of fan-out spawns its own fan-out). v1's `superRefine` rejection preserved.

## Consequences

**Pros**:
- ✅ Per-child verify/review surface produces SmartBear-friendly review chunks (400-LOC threshold applies per child, not per combined patch_set)
- ✅ Failed child can be retried without losing 2 already-good siblings
- ✅ Conflict detection at dispatch time (cheaper than apply-time)
- ✅ `report.html` per-child sub-timelines + per-child contract_grep tables (extended `AisepReportParallelGroup` with `direction: "out" | "in"`)
- ✅ State-machine amendment is additive (no regression for non-retry callers)
- ✅ Pure-function scheduler boundary preserved (`nextReadyFanInDispatch` as new pure function alongside existing `nextReady`)

**Cons**:
- ❌ Wire schema bump 0.3 → 0.4 requires `aisep migrate` utility (must ship in same release per Decision 5)
- ❌ State-machine amendment surface adds 1 new code path (caller-marker conditional) — must be tested exhaustively (R5: ≥ 25 pure-function cases)
- ❌ Cross-process retry race introduces R7 workspace lock requirement (mechanism left as implementation choice per Phase 2 react refinement; dogfood gate condition 9 covers fail-fast regardless)
- ❌ `aisep migrate --to 0.4` is v2-blocking (not deferred — F11 reclassification per arbitration)

**Rollback path**: Single git-revert of v2 schema PR + the `aisep migrate` utility PR. Workspaces migrated to v0.4 stay readable by v0.4 binary; rolling back means re-cloning v0.3 binary AND applying a reverse migration (deferred utility; not v2-blocking; tracked in BACKLOG as future task if real-world rollback is ever requested).

**Migration safety**: 5 user cases enumerated in [proposal §Migration path](../../proposals/aisep-v2-fan-in.md). Cross-version round-trip dogfood gate (conditions 7+8) mechanizes the safety claim.

## Promotion gate

ADR-022 promotes from this in-repo ADR-lite to **enforced** policy after:
1. Pilot-12 dogfood validates all 9 ship conditions (full chain + retry + conflict trigger + report viz + cross-version round-trip A/B + cross-process race)
2. Implement-stage PRs land: aisep-protocol@0.4.0 + scheduler + runner + cli + report + migrate util
3. ≥ 53 new tests post-merge (target 419 = 366 baseline + 53)
4. `pnpm exec dependency-cruiser packages/aisep-*/src` — 0 violations

If any of (1)-(4) fail during implement-stage, ADR-022 reverts to Proposed status; the failing item is escalated to user for re-arbitration.

## Open issues (carried forward to implement-stage planning)

1. Conflict detection regex-intersect heuristic performance under 5+ children × 10 `affects` each — bench during implement-stage.
2. `aisep migrate --to 0.4` impl scope: single-shot vs incremental migration? Resolve in migrate-util implement task.
3. Per-child `claude --print` token budget inheritance — does each child get parent's upstream budget cap or fresh?
4. `report.html` 255-cell load behavior in browser — actual bench during report-extension implement task.
5. R7 workspace-lock mechanism choice (flock / pid-file / SQLite advisory) — implementation decision; dogfood condition 9 binding.

---

> ADR-022 is the canonical contract for AISEP v2 fan-in. Implementation PRs MUST cite this ADR + Phase 1+2+3 review trail in their description. Changes to Decision 1-5 require a new ADR (ADR-023+) that supersedes this one — single-line amendments are not permitted.
