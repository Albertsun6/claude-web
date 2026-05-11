# Phase 3 Arbitration — aisep-protocol v0.2

> Author: Claude Opus 4.7 (1M context, harness-review-workflow orchestrator)
> Date: 2026-05-12
> Mode: contract
> Inputs:
> - `aisep-protocol-v0.2-arch-2026-05-12-0246.md` (Reviewer A — arch lens)
> - `aisep-protocol-v0.2-cross-2026-05-12-0246.md` (Reviewer B — cursor-agent cross lens)
> - `aisep-protocol-v0.2-react-arch-2026-05-12-0246.md` (A react to B)
> - `aisep-protocol-v0.2-react-cross-2026-05-12-0246.md` (B react to A)

## Finding-by-finding decisions

| # | Finding | Sev | Decision | Rationale |
|---|---------|-----|----------|-----------|
| A.F1 | M5 ping-pong cap leaks to `request_reverify` | MAJOR | ✅ **Accept** (B's refinement) | Methodology + aisep-core counter widening, not wire-field. Both reviewers agree fix is needed; B sharpened to "counter widening, not schema payload bump" which is correct (cap is workflow invariant, not review data). |
| A.F2/B.F2 | superRefine described in prose but not coded | MAJOR | ✅ **Accept** (B's refinement) | Switch to `z.discriminatedUnion("verdict", [...])` per B's recommendation — stronger TS narrowing than superRefine. Keep superRefine as fallback if `aisep-core/runner.ts` typecheck breaks. |
| A.F3 | `recheckable: true` field not in integrate output schema | MINOR | ✅ **Accept** (composed with B.F3) | Encode hint in `blockers[0].id` prefix `recheckable:<checkId>` per A's option (2) — no new output-schema field. |
| A.F4 | methodology L138 "固定三类" + underscore/dash drift | MINOR | ✅ **Accept** | Update methodology L138 to "四类" + switch dash→underscore form to match schema (also L146 + L343). Document the underscore/dash unification as a v0.2 bonus cleanup. |
| A.F5/B.F5 | Audit covers global tier only, not pending | **MAJOR** (upgraded from A's MINOR after compound with B.F1) | ✅ **Accept** | Add §Migration step: scan ALL `evolution_log.json` files under known workspaces; reject `.min(1)`-violating records OR auto-coerce; preflight before tagging v0.2.0. Compound with A.F8 fix. |
| A.F6 | Dogfood gate happy-path only | MINOR | ✅ **Accept** (B's refinement) | One Pilot-N with TWO acceptance phases — happy path + boundary (two consecutive `request_reverify` must trigger M5 cut-scope on 3rd round). |
| A.F7 | ADR-lite missing Context + Consequences | MINOR | ✅ **Accept** | Inline restructure: Context (2-3 lines from §Context) + Decision (existing) + Consequences (positive + trade-offs) + Review trail. No separate ADR file (per single-machine context). |
| A.F8 | `loadFile` catch + missing write-path parse = silent log erasure | **BLOCKER** | ✅ **Accept** (compound with B.F1) | Add §Scope item 5: write-path `AisepMemoryRecordSchema.parse()` in `recordPending` / `recordGlobal` / `promote`. Add §Scope item 6: bifurcate `loadFile` — inspector path keeps fail-open-empty, read-then-write path MUST throw. Add one-shot migration scan. |
| A.F9 | §Migration bullet 2 factually wrong | MAJOR | ✅ **Accept** | Rewrite §Migration bullet 2: store.ts currently does NOT parse on write; v0.2 must add it. Bump §Scope from 4 items to 6. |
| B.F1 | `recordGlobal` / `recordPending` not parse-gated | BLOCKER | ✅ **Accept** (compound with A.F8 fix) | Same fix as A.F8 — write-path parse + loadFile bifurcation + migration scan. |
| B.F3 | integrate.hbs doesn't naturally block unknown verdicts | MAJOR (B's) → composed with A.F3 | ✅ **Accept** (A's refinement) | integrate.hbs switches from **denylist** ("block if verdict ∈ {revise_required}") to **allowlist** ("proceed iff verdict ∈ {pass, pass_with_comments}"). Fail-closed for any future enum value. |
| B.F4 | `checkId` unconstrained + substring match footgun | MINOR | ✅ **Accept** | Tighten zod to `z.string().regex(/^[A-Za-z0-9_.:-]+$/)`. Switch `aisep verify --recheck --check-name` semantic from "substring" to "exact match" by default (substring opt-in via `--check-name-substring` future flag). Update CLI separately if needed. |

## Aggregate counts

- ✅ Accept: **12 / 12** (all findings accepted; many via refined / composed fixes)
- ⚠️ Partial: 0
- 🚫 Reject: 0
- 🟡 User-decision: 0 (skill says ≤ 3; we have zero — all author-resolvable per single-machine context)

## Why zero `🚫 reject`

Both reviewers' findings were factually grounded (fact-check passed for every claim) and methodologically aligned. No reviewer made vibes-based claims. B's cross-correctness lens caught a real schema-vs-code drift; A's arch-fit lens caught a real methodology widening risk. Both fixes are localized and don't re-open the architecture.

## Why zero `🟡 user-decision`

Reviewer A's "Open questions for the user" (3 items) and B's (3 items) all admit author-resolvable answers:

| Open Q from reviewer | Author resolution |
|----------------------|-------------------|
| A's OQ1: M5 widening accept or split? | **Accept inside v0.2 bundle** (A's recommendation; no architectural reason to split). |
| A's OQ2: integrate `recheckable` field — wire format addition? | **No new field** — encode in `blockers[0].id` per A's F3 option (2). |
| A's OQ3: ADR-lite vs separate ADR file? | **Inline ADR-lite** per single-machine context (A's recommendation). |
| B's OQ1: discriminated union? | **Yes** — adopt per B.F2 refined fix. |
| B's OQ2: requestReverify.reason as untrusted audit text? | **Document as audit text** in proposal §Risks (RISK-Q4-c new). Quoting verbatim in integrate.md is OK; cap to ≤500 chars to prevent prompt-injection-via-reason. |
| B's OQ3: global-only audit enough? | **No** — full pending-tier audit per A.F5/B.F5 acceptance. |

All 6 OQs resolved without escalation. The skill's anti-pattern check "🟡 ≤ 3" is satisfied.

## Convergence determination

**Phase 1 → 2 → 3 single pass converged.** No round 2 needed.

- Phase 1: both reviewers landed ACCEPT-WITH-CHANGES with no REJECT
- Phase 2: zero double-disagreement on any finding (every finding either double-agreed, or one side disagreed/refined with the other accepting the refinement)
- Phase 3: 12/12 accept, 0/0 user-escalations

Skill rule "最多 3 轮" — we're done at round 1.

## Implementation plan (Step 6 done; Step 7 deferred — see baseline-gap below)

✅ Step 6 done — proposal revised to v3 (538 lines, all 12 findings incorporated)

⏸ **Step 7 / implementation deferred** — post-arbitration discovery:

**Baseline gap (out-of-band finding 2026-05-12 post-arbitration)**: aisep-core
does NOT actually implement M5 ping-pong cap enforcement. attempt.ts JSDoc
claims "M5 red line ... enforced in aisep-core runtime by gate logic scoped
to stage === 'review'", but grep of `packages/aisep-core/src/` finds zero
M5 counter logic. store.ts L200 mentions "M4 ping-pong cap by aisep-agents"
(double-wrong: M4 is contract freeze per Phase 2.D #7 rename; agents not
core). This is a v0 aspirational-spec gap.

**Implication for proposal**: §Change 6 says "aisep-core M5 counter widens
from revise_required to revise_required ∪ request_reverify" — but the
counter doesn't exist. v0.2 ship requires building the M5 counter
**first** (baseline), then widening it (one additional line).

**Revised plan**:

| Phase | Work | Estimate | Gate |
|-------|------|----------|------|
| **Phase 2.E** (NEW) | aisep-core M5 baseline: implement `revise_required` counter per `stageRunId` in runner | 1-2 hr | Pilot-N1 cuts scope at 2 rounds |
| **v0.2 impl** | proposal §Change 1-6 in stated order; M5 widens by `\|\|` operator | 2-3 hr | Pilot-07 Phase 5a/5b/5c all pass |
| **v0.2 tag** | aisep-protocol@0.2.0 + retro | 30 min | Pre-flight migrate-v0.2-min1.mjs exits 0 |

Total implementation: 4-6 hr (was 2-3 hr in v3 proposal — baseline gap
adds 1-2 hr).

**Current session disposition**:
- ✅ Phase 1+2+3 cross-review converged (single round, 12/12 accept)
- ✅ Proposal v3 written + ADR-lite inline restructured
- ⏸ Implementation deferred — Phase 2.E baseline + v0.2 impl bundled
  into next session OR split based on user preference

## Risk noted for future cross-reviews

Methodology lesson surfaced by A.F9 (proposal §Migration bullet 2 was factually wrong):

> **When a proposal claims "existing code already does X, no change needed", cross-review MUST open the file and verify X. Phase 1 author-lens trust of proposal self-reporting is a class hazard.**

This should be added to reviewer-cross skill LEARNINGS.md OR encoded as a memory record (stage: review, pattern: "trust proposal claim about own code state without fact-check"). The "10/10 records" claim required the same fact-check — both reviewers did open the JSON file, but only B caught that the write path bypasses zod.

Candidate memory record for AlphaEvolve:

```yaml
stage: review
failurePattern: "Proposal §Migration claims 'existing code already does X, no change needed' but actual file path bypasses X. Author-lens reviewer trusts the claim; cross-correctness reviewer opens file and falsifies."
fix: "Cross-review must fact-check every 'existing code does X' claim by opening the cited file. Add 'fact-check checklist' to reviewer prompt requiring file:line citation for every 'already does X' claim before emitting verdict."
appliesTo: { stage: [review], domain: [*], techStack: [*] }
```

To be recorded after v0.2 ship.
