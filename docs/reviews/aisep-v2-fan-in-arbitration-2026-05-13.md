# Phase 3 Author Arbitration — AISEP v2 fan-in proposal
> Author: Claude Opus 4.7 (1M ctx) · Date: 2026-05-13 18:00 · Phase 3 (arbitration)
> Reviews consumed:
> - `docs/reviews/aisep-v2-fan-in-arch-2026-05-13-1750.md` (Reviewer A Phase 1, harness-architecture-review)
> - `docs/reviews/aisep-v2-fan-in-cross-2026-05-13-1750.md` (Reviewer B Phase 1, vessel-cross-reviewer / cursor-agent gpt-5.5-medium)
> - `docs/reviews/aisep-v2-fan-in-react-arch-2026-05-13-1755.md` (Reviewer A Phase 2 react)
> - `docs/reviews/aisep-v2-fan-in-react-cross-2026-05-13-1755.md` (Reviewer B Phase 2 react)

## Convergence summary

- Reviewer A→B reaction: 8 agree + 1 refine + 0 disagree (out of 9 B findings)
- Reviewer B→A reaction: 7 agree + 2 refine + 0 disagree (out of 9 A findings)
- **Genuine disagreement**: 0
- **Cross-discovered new findings**: 2 (A: predecessorIds revocation; B: fan-out whitelist excludes integrate)
- **Self-corrections**: A upgraded MAJOR-1 → BLOCKER absorbed into B.B3; A upgraded minor-1 → MAJOR via B.M2; A refined BLOCKER-1 (ADR-006 → ADR-0015 as better target)

## Consolidated finding matrix (post Phase 1+2)

| # | Title | Severity | Source | Verdict | Why |
|---|---|---|---|---|---|
| F1 | ADR-0010 citation confabulated → use ADR-0015 + ADR-006 supporting | BLOCKER | A.B1 + B.B1 (consensus) | ✅ Accept | Both reviewers caught; A refined replacement to ADR-0015 |
| F2 | `affects` required on `child` breaks v0.3 backwards-compat | BLOCKER | B.B2 (A missed) | ✅ Accept | Concrete schema/compat hole; gate by protocol version OR mandate migration |
| F3 | Id-stable retry impossible under current terminal state machine | BLOCKER | B.B3 (A's MAJOR-1 upgrades) | ✅ Accept | Real invariant blocker; pick contract: new-row OR amend state-machine |
| F4 | `superRefine` "implement-only" must be torn out + whitelist set | BLOCKER | A.B-2 + B refined excludes integrate | ✅ Accept | Both reviewers agree; B refined whitelist to `{implement, verify, review}` (NOT integrate) |
| F5 | Q5 retry-child "consistent with F3" 论据反了 → split into 2 independent retry paths | MAJOR | A.M-1 (B.B3 strengthens) | ✅ Accept | F3 is transparent retry; retry-child is user-explicit attempt-append |
| F6 | v1 `predecessorIds[]` plan must be explicitly revoked | MAJOR | A.M-2 (B missed; arch-only) | ✅ Accept | Stage.ts:120-121 comment promises predecessorIds[]; v2 uses subStages mirroring instead |
| F7 | R1 mitigation too weak; need cross-process retry race coverage | MAJOR | A.M-3 (B refined to dogfood gate) | ⚠️ Partial Accept | B's refinement is sharper: don't lock in `.aisep/.lock` mechanism, just require dogfood gate covers cross-process fail-fast |
| F8 | Cross-version (v0.3 ↔ v0.4) round-trip dogfood gate missing | MAJOR | A.M-4 (B.B2 strengthens) | ✅ Accept | Without this, F2 backwards-compat would surface in user dogfood not CI |
| F9 | Conflict detection source-of-truth inconsistent; manifest may need `modifiedFiles: []` | MAJOR | B.M-2 (A upgraded minor-1 here) | ✅ Accept | Pick: declared `affects` vs actual on-disk modified-files; if latter, patch_set manifest grows |
| F10 | Report data model can't represent N verify-children | MAJOR | B.M-3 (A NEW-2) | ✅ Accept | Current report builder hardcoded single-stage-per-name; need fan-in group type |
| F11 | Migration CLI scope contradiction (`aisep migrate` both deferred and required) | MAJOR | B.M-4 (A's milestone gap → upgrade) | ✅ Accept | Reclassify: either v2 includes migrate utility OR v2 only supports fresh v0.4 workspaces |
| F12 | `fan_in` role name has no enum value | MAJOR | B.M-1 (A NEW-1) | ✅ Accept | Pick: new `fanInRole` field / extend `fanOutRole` / derived from `parent + subStages` on downstream |
| m1 | 333 vs 366 baseline test count inconsistency | MINOR | B.m1 | ✅ Accept | Cosmetic; use single number |
| m2 | Emergency bypass should be decided pre-implementation | MINOR | B.m2 (A's Open Q4 strong opinion) | ✅ Accept | Decide: prefer plan.md edit; defer `--force-conflict` to a follow-up |
| m3 | Q1 "any new required field is a MAJOR.MINOR bump" air quote | MINOR | A.minor-2 | ✅ Accept | Fold into F1 fix (cite real ADR text) |
| m4 | Open issues #4 "850 cells" virtually inflated 3× | MINOR | A.minor-3 | ✅ Accept | Cosmetic; correct algebra |

**Totals**: 4 BLOCKER + 8 MAJOR + 4 MINOR · **0 user-decision** (well within ≤3 cap) · **0 reject**

## Why 0 user-decision

All findings are technical / factual / contract-shape questions with clear technically-correct answers. No vertical-positioning, milestone trade-off, or irreversibility-preference questions arose. The 1 close-call:

- **F1 ADR target**: ADR-0015 (top-level, has explicit major/minor/patch table) or ADR-006 (vessel namespace, "5 条原则"). Author decision: **ADR-0015 as primary citation + ADR-006 as supporting**, plus the new ADR-022 (v2 fan-in's own ADR-lite) carries explicit "v0.x stabilization period allowed MINOR-level wire incompatibility" supersede language. Not escalated to user — technical choice with clear best answer.

## v0.2 revision plan

The proposal `docs/proposals/aisep-v2-fan-in.md` will be revised to v0.2 applying:

1. **F1**: replace all `ADR-0010` references with `ADR-0015`; add ADR-lite Decision 5 explicitly defining "v0.x stabilization period allows MINOR-level wire incompatibility per ADR-022; ADR-006 §5 'breaking change 仅跨 major' applies after 1.0"
2. **F2**: §7-anchor "Compatibility" rewritten — "v0.3 workspaces with fan-out state require `aisep migrate --to 0.4` before v0.4 binary can read; v0.3 workspaces WITHOUT fan-out state (`fanOutRole === 'normal'` everywhere) load cleanly"
3. **F3**: §Q5 rewritten — pick option C (id-stable + explicit state-machine amendment): allow `failed → running` transition only when triggered by `aisep run --retry-child`. Append new attempt with `attemptN+1`. Document state-machine invariant amendment in §7-anchor "Data model"
4. **F4**: add §Q1b "Fan-out / fan-in stage whitelist" — `FAN_OUT_ALLOWED_STAGES = {implement, verify, review}` (integrate excluded; it's the fan-in terminal aggregation, not a fan-out source). Zod superRefine sketch included
5. **F5**: §Q5 recommendation rewritten — "retry-child is user-explicit attempt-append; F3 is transparent within-single-attempt. Two independent code paths."
6. **F6**: §Q3 末尾加 "Implicit revocation" subsection
7. **F7**: §Risk R1 mitigation → "parent.status ∈ {failed, succeeded} terminal-only" + add R7 "cross-process retry race" (mechanism = implementation decision; dogfood gate must cover)
8. **F8**: §Dogfood gate add 2 cross-version round-trip ship conditions (v0.3→v0.4 with/without flag, v0.4→v0.3 graceful refuse)
9. **F9**: §Q4 expanded — "conflict detection uses declared `affects` regex (declared-overlap detection, NOT actual file conflict); `patch_set` manifest UNCHANGED in v2"
10. **F10**: §Scope #5 expanded — extend `AisepReportFanOutGroup` (or add `AisepReportFanInGroup`); key contract_grep checks by `stageRunId + childName`
11. **F11**: §Migration path clarified — "v2 includes `aisep migrate --to 0.4` IF user has v0.3 fan-out state; users with only normal state load cleanly. Migrate utility is v2-blocking, not deferred."
12. **F12**: §Scope #1 expanded with Zod sketch — `fanOutRole` enum unchanged; `fan_in behavior` is derived from `fanOutRole === 'parent' && subStages.length > 0` on a downstream stage. (Option c per B.M1.)
13. **m1**: replace "333" with "366" everywhere (or "≥ baseline at implementation start" phrasing)
14. **m2**: §"Open issues" #5 promoted to a Decision in ADR-lite: "v2 ships without `--force-conflict`; user edits plan.md to resolve false positives. Logged force flag deferred to v3."
15. **m3**: fold into F1 fix (no separate edit needed)
16. **m4**: §"Open issues" #4 corrected algebra: "5 children × 3 fan-out stages × 17 checks ≈ 255 cells + 7 non-fan-out stages × 1 row"

## Phase 3 verdict

✅ **Proposal v0.1 DRAFT → v0.2 revision via 16 fixes (4 BLOCKER + 8 MAJOR + 4 MINOR)**.

**Convergence check after v0.2**: No remaining BLOCKER level unresolved (all 4 mapped to concrete edits). 0 user-decision items needed. 0 rejected findings. v0.2 should be ship-ready for ADR-lite promotion + dogfood gate phase, but **one more cross-review pass on v0.2 recommended** since this is contract mode and a 4-BLOCKER revision is non-trivial scope.

**Decision**: Apply all 16 fixes to v0.2 → push amended proposal → trigger Phase 1 round 2 reviewers on v0.2 (lightweight, focused on whether the 16 fixes are correctly applied + whether the v0.2 surface introduces new issues).
