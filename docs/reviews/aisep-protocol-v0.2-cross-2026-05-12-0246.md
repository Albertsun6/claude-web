这是按 `/tmp/aisep-v0.2-cross-prompt.md` 跑出的独立 verdict；没有修改文件。

```markdown
# Phase 1 Review — cross-correctness lens
> Reviewer: reviewer-cross (cursor-agent gpt-5.5-medium)
> Date: 2026-05-12
> Phase 1 (independent)
> Target: docs/proposals/aisep-protocol-v0.2-review-reverify-and-applies-to.md

## Summary verdict
ACCEPT-WITH-CHANGES

## Fact-check results

### Claim 1 (current enum is 3 values)
- Verified: yes
- Notes: `AisepReviewVerdictKindSchema` currently has exactly `pass`, `pass_with_comments`, and `revise_required`.

### Claim 2 (AppliesTo.stage has no .min())
- Verified: yes
- Notes: `stage` is currently `z.array(AisepStageSchema)` with no `.min(1)` constraint.

### Claim 3 (10/10 records non-empty)
- Verified: yes
- Notes: `evolution_log.json` contains 10 records; all 10 have non-empty `appliesTo.stage`.

### Claim 4 (optional fields pattern)
- Verified: yes
- Notes: `reviewerId` and `model` already use `.optional()`.

### Claim 5 (superRefine implementability)
- Verified: yes
- Notes: Enforceable via `.superRefine()` or stronger `z.discriminatedUnion("verdict", ...)`; should live in protocol schema, not only write-time helper.

## Findings

### F1. `recordGlobal` / `recordPending` write path is not currently parse-gated — BLOCKER
**Issue**: Proposal says these paths are already zod-parse gated, but write paths construct records and save without parsing first.

**Why it matters**: Empty-stage invalid records could still persist, then future load parse fails and may make log appear empty.

**Suggested fix**: Require write-time validation in both paths with `AisepMemoryRecordSchema.parse(candidate)` before append/save.

### F2. `requestReverify` invariant must be schema-level — MAJOR
**Issue**: Current proposal wording makes the invariant sound write-time only.

**Why it matters**: Invalid wire data like `request_reverify` without payload could parse unless schema enforces it.

**Suggested fix**: Put biconditional into `AisepReviewVerdictSchema` via `.superRefine()` or discriminated union.

### F3. `integrate.hbs` does not already naturally block unknown verdicts — MAJOR
**Issue**: Proposal overstates current behavior. Existing hard limit explicitly blocks `revise_required`, failed verify, or blockers, not every non-pass verdict.

**Suggested fix**: Make template update mandatory: proceed only for `pass` / `pass_with_comments`; explicitly block `request_reverify`.

### F4. `checkId` is too unconstrained — MINOR
**Issue**: `z.string().min(1)` is broad for a future command-facing field.

**Suggested fix**: Use a regex like `/^[A-Za-z0-9_.:-]+$/` and exact check-name matching, not substring.

### F5. Migration claim should be scoped — MINOR
**Issue**: 10/10 audit proves global verified log only, not workspace pending logs.

**Suggested fix**: Rephrase claim and add pending-log preflight or migration check.

## Strong points
- `request_reverify` is a real missing state and should be explicit.
- Bundling both small protocol changes into one minor bump is reasonable.
- The global log audit claim is factually correct.
- Proposal correctly identifies both `review.hbs` and `integrate.hbs` must change.

## Open questions for the user
- Should `request_reverify` use discriminated union for stronger TS narrowing?
- Should `requestReverify.reason` be treated as untrusted audit text rather than quoted verbatim?
- Is “global log only” compatibility enough, or should v0.2 scan workspace pending logs too?
```
