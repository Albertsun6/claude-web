# Phase 3 Arbitration — AISEP v1 fan-out proposal

> Author: Claude Opus 4.7 (harness-review-workflow orchestrator)
> Date: 2026-05-12
> Mode: contract
> Inputs:
> - `aisep-v1-fan-out-arch-2026-05-12-1930.md` (Reviewer A — Claude arch-fit, 8 findings)
> - `aisep-v1-fan-out-cross-2026-05-12-1930.md` (Reviewer B — cursor-agent cross-correctness, 6 findings; self-flagged independence-tainted advisory)
> - `aisep-v1-fan-out-react-arch-2026-05-12-1930.md` (A react B; +3 new findings A.F9/F10/F11)
> - `aisep-v1-fan-out-react-cross-2026-05-12-1930.md` (B react A; +3 new findings)

## Aggregate

| Source | Count |
|--------|-------|
| Phase 1 — Reviewer A | 8 findings (2 FALSE-POSITIVE confirmed clean) |
| Phase 1 — Reviewer B | 6 findings |
| Phase 2 — A new findings | 3 (F9 / F10 / F11) |
| Phase 2 — B new findings | 3 |
| **Cross-match collapse** | 4 pairs (A.F1↔B.F2, A.F3↔B.F4, A.F10↔B.F1, A-new validator↔B-new validator) |
| **Unique substantive** | 13 distinct findings |
| **Reject** | 0 |
| **User-escalate** | 0 |

## Finding-by-finding decisions

| # | Sev | Decision | Action |
|---|-----|----------|--------|
| A.F1 / B.F2 (schema collision) | MAJOR | ✅ **Accept** (B's `fanOutRole` discriminant refinement) | Schema: `fanOutRole: "normal" \| "parent" \| "child"` as new discriminant on top of phase. parent requires `subStages.length >= 1` + forbids `parentStageRunId`; child opposite. Use `superRefine` for nested-fan-out rejection. |
| A.F2 (R7 self-host edge) | MAJOR | ✅ **Accept** | Add §"R7 boundary analysis": (a) `parallel:` block is read-only-by-agent / schema-locked (decomposing within methodology, not graph-patching); (b) plan-validator failure is **terminal** — user re-runs `aisep run` with corrected plan, NO runner auto-replan loop (closes R7 hazard explicitly). |
| A.F3 / B.F4 (M5 composition) | MAJOR | ✅ **Accept** | Add §"M5 composition under fan-out" with worked example: (1) T1a/T1b/T1c siblings have independent counters (current checkM5Cap behavior, zero change); (2) re-plan-after-failure resets counter (accepted v0 carve-out per m5-cap.ts:16-19); (3) post-parallel review = ONE review stage_run consuming ALL sub-stage patches → one verdict → one M5 counter (preserves §2.8 "review = one logical decision" framing). |
| A.F4 (plan-roadmap consistency) | FALSE-POSITIVE | ✅ Confirmed clean | No change. |
| A.F5 / A.F6 (R6 + R11 unaffected) | MINOR | ✅ **Accept** | Update runner.ts JSDoc from "single stage" → "stage which may fan out". Extend dep-cruiser CI rule to scan scheduler.ts for fs/spawn/net imports. R11 confirmed unaffected — no change needed. |
| A.F7 (Pilot-9c SIGTERM timing) | MINOR | ✅ **Accept** | Phase 9c acceptance: "Within 10s of parent failure, in-flight claude subprocesses receive SIGTERM; if alive after 5s, SIGKILL. State recorded as `cancelled` (not `failed`)". Cancel intent emitted by scheduler; honored by executor (R6 clean). |
| A.F8 / B-new-3 (ADR Non-decisions) | MINOR | ✅ **Accept** | Add §"Non-decisions" subsection to ADR-lite: retry semantics (→v3 cycle), cross-machine distribution, parent-level review (→v2). Add promotion gate line: "Phase 1+2+3 converged + Pilot-09 a/b/c passed + version.ts drift fixed". |
| A.F9 (SmartBear citation honesty) / B.F5 | MINOR | ✅ **Accept** | Rewrite §"Plan-derived constraint" — SmartBear only supports 400-LOC threshold direction; "4 concurrent contexts" is plan-roadmap + dogfood-pending evidence. Drop the false implication. |
| **A.F10 / B.F1 (verify fan-in scope conflict)** | **BLOCKER** | ✅ **Accept** (refined: patch_set manifest) | parent implement emits `patch_set` aggregate manifest artifact AFTER all children succeed; verify depends on PARENT (single predecessor), reads manifest, locates per-sub patch files. NOT introducing `predecessorIds[]` (that's v2 fan-in). Manifest schema: `{ patches: [{ subStageId, file, contentHash, byteCount }] }`. Add to §Scope. |
| **A.F11 / B.F3 (version drift)** | **MAJOR (ship bug)** | ✅ **Accept** (separate hotfix commit) | Real ship bug from Phase 2.E #1 commit `c89db55`: bumped package.json 0.0.1→0.2.0 but forgot version.ts. Fix as **separate hotfix commit** (NOT bundled into v1). Then v1 proposal version target = 0.2.0 → 0.3.0 (v1 first, v3 cycle becomes 0.3.0 → 0.4.0). |
| B.F6 (withStateLock boundary) | MINOR | ✅ **Accept** | Tighten §Q6: "single runner process owns all child scheduling; cross-process concurrency = explicit fail-closed (workspace lockfile, deferred to v2+)". in-process async mutex only. |
| B-new-1 (validator terminal) | MAJOR | ✅ **Accept** (same as A.F2) | Plan-stage validator failure = terminal user-re-run (no auto-loop). |
| B-new-2 (patch_set manifest named) | BLOCKER fix | ✅ **Accept** (same as A.F10 / B.F1) | `patch_set` becomes a named v1 artifact kind. |

## Aggregate counts

- ✅ Accept: **13/13** (all substantive findings; many via refined / composed fixes)
- FALSE-POSITIVE confirmed clean: 2 (A.F4 / A.F6)
- ⚠️ Partial: 0
- 🚫 Reject: 0
- 🟡 User-escalate: 0 (all open questions author-resolvable)

## Open-question resolutions

| Source | Question | Resolution |
|--------|----------|------------|
| A.OQ1 | Schema variant strategy: lift to common shape vs widen union? | **Widen union via `fanOutRole` discriminant** (B's refinement). Cleaner type-level guarantee. |
| A.OQ2 | Plan-stage re-plan: user-driven or runner-auto? | **User-driven** (preserves R7). Validator failure = terminal CLI error. |
| A.OQ3 | Post-parallel review verdict: 1 over merged set vs N per sub-stage? | **ONE verdict over merged set** (preserves §2.8 framing + simpler M5 keying). Per-sub-stage retry handled by v3 cycle via `request_reverify.checkId` pointing into the merged patch_set. |
| B.OQ1 | v1 first or v3 first? | **v1 first** per proposal §"Dependency on v3 cycle". Version targets: v1 = 0.2.0→0.3.0, v3 cycle = 0.3.0→0.4.0. |
| B.OQ2 | verify input: parent patch_set or `predecessorIds[]`? | **parent patch_set** (manifest indirection). `predecessorIds[]` would prematurely ship v2 fan-in machinery. |
| B.OQ3 | concurrency=4 hard / default / temp? | **Default cap, user-tunable via `--concurrency N`**. Hard ceiling 4 only because plan stated so + Pilot-09 will verify per-resource-class. RISK-Q4-a flags this for spiral correction in v1.1. |

## Convergence

**Single-pass converged** (Phase 1 + 2 + 3 round 1). Both reviewers
ACCEPT-WITH-CHANGES; cross-match findings rather than conflict;
unique findings address real gaps (verify fan-in semantics, version drift,
SmartBear citation, R7 self-host edge). 13/13 accept matches the
aisep-protocol v0.2 cross-review pattern (12/12 accept) — confirms the
proposal-quality bar is consistent.

## Implementation plan (this session: Step 6 + 7 partial)

1. **Hotfix commit (independent)**: bump `version.ts` `AISEP_PROTOCOL_VERSION` to `0.2.0` (close A.F11/B.F3 ship bug from Phase 2.E #1)
2. **Revise proposal to v2** (this session): incorporate all 13 findings:
   - §Scope: add patch_set manifest as 7th item (A.F10/B.F1 fix)
   - §Candidate A refinement: `fanOutRole` discriminant
   - §Q1: detailed schema diff (zod) with fanOutRole + superRefine
   - §Q2: version target 0.2.0 → 0.3.0 (not 0.3.0 → 0.4.0)
   - §Q3: rewrite R7 paragraph (boundary analysis) + M5 composition section
   - §Q6: in-process mutex only; cross-process fail-closed
   - §"Plan-derived constraint": honest SmartBear citation
   - Adversarial #3 rebuttal: "force re-plan" = user-driven terminal
   - §Dogfood gate Phase 9c: SIGTERM/SIGKILL timing
   - §ADR-lite: Non-decisions subsection + promotion gate
   - §"Dependency on v3 cycle": v1=0.3.0, v3=0.4.0
3. **Implementation defer**: per scope, code lands future session under fresh Pilot-09 dogfood. v1 fan-out is ~600 LOC + 3-phase Pilot; not single-session work.

## Risk noted for future cross-reviews

Like aisep-protocol v0.2 arbitration log noted ("trust proposal claim about own code state without fact-check"), this v1 cross-review surfaced a different class: **multi-proposal version-coordination drift**. Two proposals were written in same session (v3 cycle + v1 fan-out) each assuming the other's version increment. v3 said 0.2→0.3; v1 said 0.3→0.4. Author (me) didn't notice the implicit ordering claim because two proposals were drafted in parallel. cursor-agent B fact-checked + Claude A confirmed.

Candidate memory record (post-ship):

```yaml
stage: review
failurePattern: "Multi-proposal cross-review session has implicit version ordering between proposals; author drafts in parallel without locking sequence, both proposals claim 'next' version slot, real version vs assumed-baseline drifts."
fix: "When drafting multiple protocol-bumping proposals in one session, write an explicit §'Version coordination' table listing assumed baseline + assumed-prior-proposal version + this-proposal target. Cross-review fact-checks the assumed baseline against package.json + version.ts."
appliesTo: { stage: [review, plan], domain: [*], techStack: [*] }
```

Will record after v1 lands (via `aisep memory record` CLI — Phase 2.D #1).
