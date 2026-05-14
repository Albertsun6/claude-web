# Round 2 Architecture Verification — AISEP v2 fan-in v0.2
> Reviewer: harness-architecture-review · Date: 2026-05-13 18:15
> Round: 2 (verification of v0.2 against round-1 arbitration's 16 fixes)
> Model: claude-opus-4-7[1m]
> Files verified:
> - `docs/proposals/aisep-v2-fan-in.md` (v0.2)
> - `docs/reviews/aisep-v2-fan-in-arbitration-2026-05-13.md` (16-fix spec)
> - `docs/adr/ADR-0015-schema-migration.md` (F1 primary citation target)
> - `docs/adr/vessel/ADR-006-schema-evolution.md` (F1 supporting citation + Decision 5 supersede target)
> - `packages/aisep-protocol/src/stage.ts` (F4 superRefine context)
> - `packages/aisep-core/src/state-machine.ts` (F3 state-machine amendment context)

## Fix verification

### F1 (ADR-0010 → ADR-0015 + ADR-006 supporting + Decision 5 supersede): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:75` — `bump per the *spirit* of ADR-0015 row #1 (major: 删字段 / 改字段语义)`
- `aisep-v2-fan-in.md:92` — `MAJOR-class change per ADR-0015 row #1 ("删字段 / 改字段语义 / 改 enum 已有值")`
- `aisep-v2-fan-in.md:94` — `ADR-006 §5 "breaking change 仅跨 major (v1.x → v2.0)" is **superseded** for AISEP per Decision 5`
- `aisep-v2-fan-in.md:206-207` — Dependencies block cites ADR-0015 as primary + ADR-006 as supporting
- `aisep-v2-fan-in.md:228` — Decision 5 (NEW from F1) defines the supersede explicitly
- Cross-check: `ADR-0015.md:35` row #1 verbatim quote `删字段 / 改字段语义 / 改外键关系 / 改 enum 已有值` matches the proposal's quoted "row #1 text" (proposal slightly truncates by omitting "改外键关系" — see Minor note below). `ADR-006.md:40` row #5 verbatim `breaking change 仅跨 major (v1.x → v2.0)` is the exact text Decision 5 supersedes — real supersede target, not vacuous.
- `grep -n "ADR-0010"` returns 0 hits — all references migrated.
**Minor**: proposal quotes ADR-0015 row #1 as `"删字段 / 改字段语义 / 改 enum 已有值"` (3 items); the actual ADR row contains 4 items (includes `改外键关系`). Not a BLOCKER — substantive content still correct; could tighten to either quote all 4 or use trailing ellipsis. Note only.

### F2 (Compatibility rewritten): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:184` (§7-anchor #3 Compatibility) — `v0.3 workspaces with **only** "fanOutRole === 'normal'" rows load cleanly under v0.4. v0.3 workspaces with v0.3-era fan-out state (parent + children rows) **require** "aisep migrate --to 0.4" to backfill "affects" field`
- Marker `migrated_from_v03: true` documented; default backfill `[".*"]` flagged as read-only (not usable for new fan-in dispatch).
- Aligns with arbitration §"v0.2 revision plan" item 2 verbatim intent.

### F3 (id-stable + explicit state-machine amendment, option C): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:154-170` — §Q5 picks option C with full state-machine amendment spec
- `aisep-v2-fan-in.md:157-158` — `extend "updateStageRunStatus()" to accept a special "--retry-child" caller marker; only when this marker is set, allow "failed → running" transition for the specific stage_run. All other callers continue to enforce terminal-status invariant.`
- `aisep-v2-fan-in.md:159-168` — 7-step retry semantics (parent terminal precondition, workspace lock, status flip, attemptN+1 append, re-aggregate)
- Cross-check: `state-machine.ts:9-16` `VALID_TRANSITIONS` defines `failed: []` (terminal). Amendment is specified at contract level — caller-marker pattern is implementable deterministically. The amended path adds one parameter and one conditional branch; pure-function `canTransition` can remain unchanged with a wrapper or sibling function. Detail level sufficient for downstream impl PR.

### F4 (Q1b stage whitelist `{implement, verify, review}`, integrate excluded): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:98-122` — new §Q1b "Fan-out / fan-in stage whitelist" added
- `aisep-v2-fan-in.md:103` — `const FAN_OUT_ALLOWED_STAGES = new Set<AisepStage>(["implement", "verify", "review"]);`
- `aisep-v2-fan-in.md:120` — integrate exclusion rationale: `it's the fan-in terminal aggregation (per §Scope #1 "integrate (parent, 1 aggregation)"); making it a fan-out source would conflict with that semantic.`
- `aisep-v2-fan-in.md:106-118` — TS sketch covers both parent and child branches
- Cross-check: `stage.ts:146-152` (parent branch) + `stage.ts:168-174` (child branch) currently hardcode `if (run.stage !== "implement")` — the v2 sketch is a drop-in replacement of those two blocks. Location citations correct.

### F5 (retry-child split from F3 — two independent code paths): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:168` — `**Decoupled from F3**: F3 timeout retry is *transparent* (within-single-attempt, no new attempt log entry); retry-child is *user-explicit forensic action* (always appends new attempt). Two independent code paths.`
- Changelog line 25 confirms intent. No residual "consistent with F3" wording found in v0.2.

### F6 (predecessorIds[] revocation): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:134-138` — §Q3 "Implicit revocation" subsection
- `aisep-v2-fan-in.md:136` — `v2 fan-in does NOT introduce a "predecessorIds[]" field`
- `aisep-v2-fan-in.md:138` — concrete comment-update plan for `stage.ts:120-121`
- `aisep-v2-fan-in.md:278` — `Not introducing a "predecessorIds[]" field (v0/v1 plan revoked — see §Q3 Implicit revocation)` in "What this proposal is NOT"
- Cross-check: `stage.ts:120-121` actually reads `v0: single predecessor / single successor (linear). v2+ adds fan-in by lifting predecessorId to a separate predecessors[] field.` — proposal's quoted text in §Q3 says `"v2+ adds fan-in by lifting predecessorId to a separate predecessors[] field"`. Quote is accurate (modulo line wrapping).

### F7 (R1 tightened + R7 NEW cross-process race): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:194` — R1 mitigation: `"--retry-child" requires "parent.status ∈ {failed, succeeded}" (terminal-only — refuses on "running" / "cancelling")`
- `aisep-v2-fan-in.md:200` — R7 added: `Cross-process retry race ... Workspace lock at "<workspace>/.aisep/.lock" (mechanism = implementation decision, choose between flock / pid-file / SQLite advisory). Dogfood gate ship condition 9 covers cross-process fail-fast`
- B's refinement honored: mechanism deliberately not locked in; dogfood gate condition 9 is the binding contract (line 251).

### F8 (cross-version round-trip dogfood gate conditions): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:249` — Dogfood gate condition 7: `Cross-version round-trip A: v0.3 state.json fed to v0.4 binary, first "aisep run" exits with clear migrate-suggestion error (not crash, not silent re-write)`
- `aisep-v2-fan-in.md:250` — Dogfood gate condition 8: `Cross-version round-trip B: v0.4 state.json fed to v0.3 binary, schema validation error (zod superRefine rejects new "affects" field), not silent drop`
- Both directions covered, distinguish error-vs-crash, mention superRefine rejection mechanism.

### F9 (declared-overlap, not actual modified-files; manifest unchanged): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:140-151` — §Q4 "Conflict detection: declared overlap"
- `aisep-v2-fan-in.md:146` — `Conflict detection is **NOT** based on actual modified files post-implement — that would require extending "AisepPatchSetManifestSchema" with "modifiedFiles: string[]", which v2 explicitly does NOT do. The "patch_set" manifest schema is **unchanged in v2**.`
- `aisep-v2-fan-in.md:279` — "What this proposal is NOT" confirms: `Not changing "AisepPatchSetManifestSchema" (Q4 picks declared-overlap; manifest stays).`

### F10 (AisepReportParallelGroup with direction discriminator): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:77-79` — §Scope #5: `"AisepReportFanOutGroup" ([types.ts:52](...)) generalizes to "AisepReportParallelGroup" with "direction: 'out' | 'in'" discriminator; report builder collects "contract_grep" checks from every verify stage_run (not just first), keyed by "(stageRunId, childName)"`
- `aisep-v2-fan-in.md:176` — §Q6 wiring: `extending "AisepReportFanOutGroup" → "AisepReportParallelGroup" (with "direction: 'out' | 'in'" discriminator)`
- `aisep-v2-fan-in.md:246` — Dogfood gate condition 4 names the new schema by exact identifier.
- `aisep-v2-fan-in.md:261` — Test matrix line includes `AisepReportParallelGroup direction discriminator + per-child contract_grep table render`.

### F11 (migrate v2-blocking IF v0.3 fan-out state exists): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:75` — `v1 workspaces with v0.3 fan-out state require "aisep migrate --to 0.4" (in-scope for v2; see F11).`
- `aisep-v2-fan-in.md:96` — Q1 recommendation: `0.4.0 with "aisep migrate --to 0.4" shipped concurrently (no longer optional/deferred — see F11)`
- `aisep-v2-fan-in.md:211-216` — Migration path 5 cases clearly distinguish fresh / v0.3-normal-only / v0.3-fan-out / v0.3-fan-out-not-using-fan-in / stay-on-v0.3
- `aisep-v2-fan-in.md:215` — `This utility is **v2-blocking** (not deferred — F11).`
- `aisep-v2-fan-in.md:183` — §7-anchor #2 Protocol echoes `Migrate utility ... shipped in same release (no longer deferred).`

### F12 (fan_in as derived behavior, no new enum value): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:69` — §Scope #1 schema sketch: `"fanOutRole" enum **unchanged** ("normal" | "parent" | "child"). Fan-in behavior is *derived*: a downstream stage_run with "fanOutRole === 'parent'" AND "subStages.length > 0" is the fan-in aggregation point`
- `aisep-v2-fan-in.md:29` (changelog) confirms intent.
- Cross-check: `stage.ts:72` current `AisepFanOutRoleSchema = z.enum(["normal", "parent", "child"])` — no new value needed; only the `stage !== "implement"` guard (lines 146-152, 168-174) widens to F4's whitelist.

### m1 (333 → 366 baseline): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:59` — `366 monorepo tests`
- `aisep-v2-fan-in.md:247` — Dogfood gate condition 5: `≥ baseline 366`
- `aisep-v2-fan-in.md:262` — Test matrix total `target post-merge ≈ 419 (= 366 + 53)`
- `grep -n "333"` returns 0 hits.

### m2 (--force-conflict deferred to v3): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:234` — ADR-lite Non-decisions: `"--force-conflict" bypass flag (m2: v2 ships without; user edits plan.md to resolve false positives. Logged force flag deferred to v3 if real-world false-positive rate justifies it).`
- `aisep-v2-fan-in.md:31` changelog line.
- Decision elevated from Open Issue #5 to explicit ADR-lite Non-decision per arbitration spec.

### m3 (Q1 air-quote folded into F1): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:92` cites verbatim `"删字段 / 改字段语义 / 改 enum 已有值"` — matches `ADR-0015.md:35` row #1 (subject to the truncation note in F1 above).
- No "any new required field is a MAJOR.MINOR bump" air-quote phrasing remains in v0.2.

### m4 (Open Issue #4 algebra corrected to ~255): **correct**
**Evidence**:
- `aisep-v2-fan-in.md:199` (R6 row) — `Worst-case estimate: 3 fan-out stages × 5 children × 17 contract_grep ≈ 255 cells (was inflated 850 in v0.1 by counting all 10 stages)`
- `aisep-v2-fan-in.md:269` — Open issue #4: `corrected estimate: 3 fan-out stages × 5 children × 17 contract_grep ≈ 255 cells + 7 non-fan-out stages × 1 row timeline. Does this still load in browser? (Was inflated 3× in v0.1 — 850 was wrong.)`
- 3 × 5 × 17 = 255 — algebra verified.

## New BLOCKERs introduced by v0.2

**None.**

Architectural-fit checks performed:

1. **Internal contradiction between fixes?** No. F2 (v0.3 fan-out → migrate required) + F11 (migrate v2-blocking IF v0.3 fan-out state) + Decision 5 (supersede needs migrate shipped same release) form a coherent triangle. F3 (state-machine amendment) + F5 (retry-child decoupled from F3 timeout retry) + Q5 7-step semantics + R7 (workspace lock) form a coherent retry contract. F9 (declared-only, manifest unchanged) + Q4 + Scope item §Scope #3 + "Not changing AisepPatchSetManifestSchema" all align.
2. **Does Decision 5 supersede something real?** Yes. `ADR-006.md:40` literally states `breaking change 仅跨 major (v1.x → v2.0) + 必须有 migration 脚本`. This is a real principle to supersede. Decision 5 is scoped (AISEP v0.x only, returns to ADR-006 §5 post-1.0), with conditions (migrate utility ships same release + cross-version round-trip dogfood gate validates). Not vacuous.
3. **State-machine amendment specification deterministic?** Yes. The caller-marker pattern at §Q5 lines 157-170 specifies: (a) which transition is allowed (`failed → running`); (b) which precondition gates it (caller passes `--retry-child` marker AND target.status === `failed`); (c) which invariants remain (all other callers enforce terminal-status); (d) what is appended (new attempt with `attemptN+1`, not mutation of original failure record). An implementer can write `updateStageRunStatus(id, newStatus, { retryChildMarker?: boolean })` and a clear branch — no ambiguity.
4. **F1 quotation tightness**: One small textual inaccuracy (proposal omits `改外键关系` when quoting ADR-0015 row #1) — flagged as a Minor under F1, not a new BLOCKER. Substantive technical claim is correct.
5. **F4 sketch + F12 enum-unchanged compatible?** Yes. F4 widens the *stage* guard; F12 keeps the *enum values* unchanged. Two orthogonal axes; no collision.
6. **F11 + Migration path 5 — every v0.3 user case mapped?** Verified all 5 cases in §Migration path enumerate distinct world-states and provide a deterministic action.
7. **Dogfood gate completeness for the 4 BLOCKER set?** F2 → conditions 7 + 8 (cross-version); F3 → condition 2 (retry); F4 → condition 1 (full chain implement+verify+review fan-out); F1 → conditions 7 + 8 (supersede contract validation). All 4 BLOCKERs have mechanized gate coverage.

## Ship-gate verdict

**CLEAR-TO-SHIP**

**Reasoning**: All 16 fixes (F1-F12 + m1-m4) are correctly applied with file-line evidence in v0.2. No new BLOCKER introduced; one minor textual tightening opportunity noted under F1 (proposal quotes 3 of 4 items in ADR-0015 row #1 instead of all 4, or an ellipsis) — this is cosmetic and does NOT block ADR-022 promotion or implement-stage kickoff. The supersede language in Decision 5 targets real ADR-006 §5 text and is properly scoped (AISEP v0.x only, conditional on migrate utility + dogfood gate). The state-machine amendment specification at §Q5 is detailed enough to implement deterministically (caller-marker pattern with explicit preconditions, postconditions, and invariant boundary). Internal fix-to-fix coherence verified across the F2/F11/Decision-5 migration triangle and the F3/F5/Q5/R7 retry contract. Recommend proceeding to ADR-lite promotion → BACKLOG entry `aisep-v2-implement` → implement-stage tasks per the proposal's "Next steps" §line 283-287.

## What I Did Not Look At
- Reviewer B's r2-cross verdict (per Independence §) — not read.
- Author's transcript / arbitration draft thinking flow — not read.
- Re-litigation of Phase 3 arbitrated choices (Q2 scheduler API, Q3 stage-pair-only, Q5 option C vs A/B, Q6 stacked timeline) — out of scope per task spec.
- Implementation-PR-level details (actual TS source diff for `updateStageRunStatus()` signature, actual `aisep migrate` script) — not yet written; v2 verification round is on the proposal contract, not on impl PRs.
- BACKLOG.md / Eva.json state — outside v0.2 verification scope.
