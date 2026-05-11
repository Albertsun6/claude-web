# Phase 1 Review — architecture-fit lens
> Reviewer: harness-architecture-review (Claude Opus 4.7, Agent subagent)
> Date: 2026-05-12
> Phase 1 (independent)
> Target: docs/proposals/aisep-protocol-v0.2-review-reverify-and-applies-to.md

## Summary verdict
ACCEPT-WITH-CHANGES

The bundling decision is sound, R3/R6/R11 compliance is genuine, and the two-change
scope is well-bounded. However the proposal has **one architecture-level gap that
must be addressed before merge** (M5 ping-pong cap is keyed on `revise_required`
and does not cover `request_reverify` — creates a documented infinite-loop hazard
the proposal itself acknowledges in §"Adversarial self-review #1" but does not
mechanically close), plus three smaller issues around schema-level enforcement
fidelity and consumer schema drift. The bundle should not ship as-is, but the
revisions are localized and don't require re-opening the architecture.

## Findings

### F1. M5 ping-pong cap leaks: `request_reverify` is not counted, no fence against `review→request_reverify→recheck→review→request_reverify…` cycle — [MAJOR]
**Where**: §Scope item 3 "Explicit non-scope: Auto-retry on reverify failure (escalate to human; v0.2 does NOT auto-loop)" + Change 4 integrate.hbs branch + missing edit to `docs/aisep/02_methodology-v0.1.md` L343

**Issue**: Methodology M5 red line (02_methodology-v0.1.md L343) reads:
> review stage `revise-required` 累计 2 次 → 必须 cut scope（不允许第 3 轮 ping-pong）| aisep-core 强制

This counter is keyed on `revise_required` only. Adding `request_reverify` as a
fourth verdict creates a structurally valid round-trip path that **bypasses M5**:
review emits `request_reverify` → maintainer runs `aisep verify --recheck` →
re-issues review → reviewer emits `request_reverify` again (different `checkId`,
or even the same `checkId` with a sharpened `reason`) → repeat. Per the proposal's
own §"non-scope" item 3, "v0.2 does NOT auto-loop" — but the *human-mediated* loop
is left unbounded. The fact that the human pulls the trigger doesn't change that
the methodology guarantees a 2-round ping-pong cap and the v0.2 schema as
proposed breaks that guarantee silently.

**Why it matters**: M5 is a methodology red line, listed at the same fence-level
as M3 (Phase A gate) and M4 (contract freeze). Allowing a new schema field to
silently widen an aisep-core-enforced cap is exactly the kind of "螺旋 silently
loosens 阶梯" anti-pattern that CLAUDE.md "Layered Spiral Delivery" prohibits
("螺旋不是绕过架构设计；螺旋只在已通过 anchor gate 的骨架内运行"). This is also
the strongest counter-argument in the proposal's own adversarial self-review §1
— the rebuttal there only addresses "reviewers might be lazy"; it does NOT
address "the loop can run forever".

**Suggested fix** (any one of these, in preference order):
1. Extend M5 in 02_methodology-v0.1.md L343 to read "review stage `revise_required`
   ∪ `request_reverify` 累计 2 次 → 必须 cut scope", and add a note in §Change 4
   integrate.hbs Hard limits that `request_reverify` increments the same counter
   as `revise_required`. Update RISK table with a new RISK-M5 row.
2. Add a schema-level field `reverifyAttempt: z.number().int().min(1).max(2)` to
   `requestReverify` discriminator so consumers can mechanically enforce the cap.
3. (Weakest) Add a Hard limit clause in review.hbs Hard limits: "If a previous
   verdict on the same `stageRunId` was already `request_reverify`, this verdict
   MUST be `pass | pass_with_comments | revise_required` — not a second
   `request_reverify`." Risk: prompt-level enforcement is unreliable.

Preference: (1) — costs one line of methodology + one line of integrate.hbs +
one ADR-lite update, mechanically enforceable in aisep-core (M5 enforcement
already exists per methodology L343 "aisep-core 强制"; the counter just needs
to widen its set).

---

### F2. `superRefine` is described in prose but not in code — schema enforcement gap — [MAJOR]
**Where**: §"Change 2" L96-98 "Refinement: at write time, `recordReviewVerdict`
(or wherever this schema is constructed) must assert `verdict === 'request_reverify'`
⟺ `requestReverify !== undefined`. Zod-level: superRefine."

**Issue**: The Change 2 code block ends after the optional field declaration and
does NOT include the actual superRefine block. As written, a consumer that
parses `{ verdict: "request_reverify" }` with NO `requestReverify` field will
succeed at zod-level — silently producing an unactionable verdict. Similarly
`{ verdict: "pass", requestReverify: {...} }` will also pass. The proposal's
strongest defense against RISK-Q4-a ("reviewers abuse `request_reverify` as a
soft escape hatch") explicitly depends on this superRefine being present and
correct.

The Adversarial self-review §1 rebuttal ("the schema-level requirement that
`requestReverify` MUST carry a concrete `checkId + reason` makes
`request_reverify` MORE expensive than `pass_with_comments`") is technically
satisfied by `z.string().min(1)` on the two inner fields, BUT only IF the outer
`.optional()` is paired with the superRefine — otherwise the reviewer can emit
`verdict: "request_reverify"` with no payload at all and get past zod.

**Why it matters**: Proposal §RISK-Q4-a explicitly assigns this enforcement
"zod superRefine" as the mitigation. If the proposal merges without the
superRefine block actually written, RISK-Q4-a is unmitigated and the entire
"keep `request_reverify` expensive" argument collapses.

**Suggested fix**: Inline the actual superRefine code in §"Change 2":

```typescript
export const AisepReviewVerdictSchema = z.object({
  // ... fields ...
  verdict: AisepReviewVerdictKindSchema,
  requestReverify: z.object({
    checkId: z.string().min(1),
    reason: z.string().min(1),
  }).optional(),
  // ... rest ...
}).superRefine((data, ctx) => {
  const needsPayload = data.verdict === "request_reverify";
  const hasPayload = data.requestReverify !== undefined;
  if (needsPayload && !hasPayload) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requestReverify"],
      message: "verdict='request_reverify' requires non-empty requestReverify.{checkId, reason}",
    });
  }
  if (!needsPayload && hasPayload) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requestReverify"],
      message: "requestReverify field is only allowed when verdict='request_reverify'",
    });
  }
});
```

Note this changes the inferred TS type from `z.infer` slightly — verify the
existing `AisepReviewVerdict` consumers in `aisep-core/runner.ts` still typecheck.

---

### F3. integrate.hbs Change 4 mentions a `recheckable: true` flag that isn't in the output schema — [MINOR]
**Where**: §"Change 4: integrate consumer handles new verdict" L122

**Issue**: Proposal says
> Treat `request_reverify` identically to `revise_required` for blocking purposes,
> but with `recheckable: true` so the maintainer knows the fast path applies.

But the current integrate.hbs output schema (verified at
`packages/aisep-agents/templates/integrate.hbs` L40-58) has no `recheckable`
field. Either (a) the proposal silently adds a new field to the integrate
output JSON (which is itself a wire-format addition — should be in Scope §1, not
buried in Change 4 prose), or (b) the proposal means the information is encoded
via `blockers[].id === "B1-recheckable"` or some convention not stated, or (c)
this is just unimplemented hand-waving.

**Why it matters**: integrate output is consumed by retrospect + future automation
hooks. Adding a field implicitly via a Hard limits bullet is the same drift
pattern that motivated R5 ("protocol changes need ADR-lite + cross-review") —
ironically, this change might itself be a stealth schema addition that should
be in the explicit Scope list.

**Suggested fix**: Pick one:
1. Add a 5th explicit Scope item: "integrate output schema adds optional
   `recheckable: boolean` field (defaults absent; true only when blocking on
   `request_reverify`)" — this would also bump the JSON schema spec docs.
2. Drop the `recheckable: true` clause from Change 4 and instead say "blockers[0].id
   MUST be of the form `recheckable:<checkId>` so downstream parsers can detect
   the fast-path case via string prefix" (encodes hint in existing field).
3. Drop the hint entirely; rely on `requestReverify` propagation from review.

Preference: (2) — keeps integrate schema stable, encodes the hint in an existing
field, no extra wire-format surface.

---

### F4. Methodology drift: 02_methodology-v0.1.md L138 says verdicts are "固定三类" — proposal does not update it — [MINOR]
**Where**: methodology 02_methodology-v0.1.md L138 (existing text), proposal §Migration

**Issue**: methodology L138 currently states:
> **review 输出固定三类**：`pass` / `pass-with-comments` / `revise-required`。

The word `固定` (fixed) is load-bearing — it's a definitional commitment.
Adding `request_reverify` makes this four-way and the proposal does NOT list
"update 02_methodology-v0.1.md L138" in §Migration or §"Next steps". Future
readers will see methodology say 3, schema say 4, and not know which is canon.

Separately, methodology uses the dash form `pass-with-comments` / `revise-required`
while the zod schema has used the underscore form `pass_with_comments` /
`revise_required` since v0.1. This is pre-existing drift not introduced by this
proposal, but adding `request_reverify` (underscore) and not touching methodology
will widen the drift to 4 mismatched terms. While not fatal, it's a code-smell
that should be cleaned in the same bump.

**Why it matters**: methodology doc is the canonical methodology spec. If it says
`固定三类` and schema has 4, future cross-review will flag this as either
methodology violation OR schema-vs-doc drift. Better to settle now in the same
PR than have it surface as a Pilot-N finding.

**Suggested fix**: Add to §Migration:
1. Update 02_methodology-v0.1.md L138 to "review 输出四类: `pass` / `pass_with_comments` / `revise_required` / `request_reverify`" — and switch to underscore form throughout L138/L146/L343 to match schema.
2. Update §Migration to list this doc edit explicitly.
3. (Bonus) Update review.hbs L8 verdict list to include `request_reverify` so the prompt-template matches the schema. This is mentioned in Dogfood gate item 1 but the actual diff is not in the proposal — recommend adding to §Migration as the canonical record.

---

### F5. Q4(b) backward-compat claim is correct but evidence is thin — [MINOR]
**Where**: §"7-question anchor gate" Q4 row + §"Adversarial self-review" #2 + §"Risks" RISK-Q4-b

**Issue**: All three locations make the same claim: "on-disk audit shows 10/10
records have non-empty `stage` array". This is fine for the user's single-machine
deployment (CLAUDE.md "纯个人单机自用"), but:

(a) The audit was against `~/.aisep/governance-log/evolution_log.json` only. The
    proposal does NOT also audit `<workspace>/.aisep/evolution_log.json` files —
    those are the *pending* tier (workspace-pending in memory.ts L18-22), where
    untrusted writes accumulate before promote. R11 says pending tier is the
    untrusted side; if pending records have empty `stage`, the .min(1) constraint
    will start rejecting writes in `recordPending()` mid-flight.
(b) The 10 records is a small sample; even though the audit is exhaustive for
    one machine, the personal-single-machine context means the audit population
    IS the entire population — true. But the framing "10/10" undersells the
    fact that this is total coverage. Rewording to "all extant records (10/10
    globally, plus all pending in {list of workspaces})" makes the
    backward-compat claim load-bearing.

**Why it matters**: pilot-06 retrospective (L86, L90) defers #14 specifically
because it's "R5 zod schema 变更". The audit needs to cover BOTH tiers, not
just global, before the proposal can claim "migration impact = nil".

**Suggested fix**: Re-run the audit including all workspace-pending logs:

```bash
# add to proposal §"Adversarial self-review" #2 rebuttal:
find ~/Desktop -name "evolution_log.json" -path "*.aisep*" 2>/dev/null | \
  xargs -I{} jq '[.records[] | select(.appliesTo.stage | length == 0)] | length' {}
```

Then update Q4(b) + §Adversarial #2 + RISK-Q4-b to cite the full audit count
(e.g., "10/10 global + 0 empty across N workspace pending files").

---

### F6. Dogfood gate Pilot-N (item 4) lacks acceptance criteria — [MINOR]
**Where**: §"Dogfood gate" item 4

**Issue**:
> 4. Run a Pilot-N with intentionally truncated verify hand-off (force false-positive);
>    verify chain produces `request_reverify` → `aisep verify --recheck` → re-issue
>    review → `pass` → `ready_to_integrate: true`. End-to-end ~13 min.

This describes a happy-path scenario. It does NOT specify:
- What happens if the second review *also* emits `request_reverify` (the F1 loop case)
- How to detect the bug "reviewer emits `request_reverify` with no payload" if F2 isn't fixed
- Failure rollback if the pilot itself fails — does v0.2 not merge? Does the M5 widening still get committed?
- Where the pilot result is recorded (retrospect file under `docs/aisep/retrospectives/`?)

**Why it matters**: pilot-04 retrospective (which motivates this proposal) was
precisely the case where a happy-path dogfood wasn't enough — the actual finding
came from observing the false-positive condition. Adding `request_reverify`
without dogfooding the M5 boundary case is the exact same gap.

**Suggested fix**: Expand Dogfood gate item 4 to two pilots:
- Pilot-N1: happy path (current item 4 text)
- Pilot-N2: loop boundary — force two consecutive `request_reverify` verdicts;
  verify aisep-core enforces M5 cap (cut scope, no third round). Document
  in `docs/aisep/retrospectives/pilot-N2-request-reverify-loop-cap-2026-05-NN.md`.
- Acceptance: both pilots' retrospectives sealed before tagging
  aisep-protocol@0.2.0.

---

### F7. ADR-lite section is minimal — Context / Consequences missing — [MINOR]
**Where**: §"ADR-lite" L194-208

**Issue**: The section is labelled "ADR-lite" but contains only "Decision" +
"Why bundled" + "Why minor not patch". A standard ADR (even lite) requires
Context (the situation that forced the decision) and Consequences (what
becomes harder / easier after deciding this way). Both are absent.

The §"Context" at the top of the proposal IS the Context for the ADR, and the
§"Risks" table IS partially the Consequences, but they're not linked or labelled
as such. A future reader looking only at "ADR-lite" will miss the rationale.

**Why it matters**: R5 says "protocol changes need ADR-lite + cross-review". The
"ADR-lite" label sets a structural expectation. Sloppy ADR-lite now invites
sloppier ADR-lite in v0.3, v0.4 — the methodology slowly degrades.

**Suggested fix**: Restructure §"ADR-lite" as:
```markdown
## ADR-lite

**Context**: <2-3 lines extracted from §Context above — link forward>
**Decision**: <existing text>
**Consequences**:
- Positive: <2-3 from §Risks mitigations / §Q3>
- Negative / Trade-offs: <2-3, including F1 M5 widening cost>
**Review trail**: docs/reviews/aisep-protocol-v0.2-arch-2026-05-12-0246.md +
docs/reviews/aisep-protocol-v0.2-cross-* (pending)
```

Alternatively, write a separate `docs/adr/vessel/ADR-NNN-aisep-protocol-v0.2.md`
file and reference it from the proposal. Personal-single-machine context allows
the lighter inline form (preference: inline).

## Strong points

(things to preserve when revising)

1. **Bundling decision is correct.** Two protocol-touch changes in one R5
   ceremony is exactly right — the rationale in §"Why bundled" holds.
2. **`request_reverify` as a verdict value vs orthogonal field** is the right
   call. Adversarial self-review §3 rebuttal is sound and addresses a real
   integrate-side branching complexity. Discriminator-object pattern is good
   zod hygiene.
3. **R3/R6 compliance is genuinely clean.** Protocol-only change touches zero
   files in vessel mainline or aisep-core runtime; verified via `grep request_reverify`
   showing zero hits in `packages/` outside the proposal. R3 holds trivially.
4. **R11 reinforcement claim (Q3) is accurate.** `.min(1)` on `stage` prevents
   the silent-global-pollution case where an empty array would match every
   stage at retrieve time. Audited memory.ts L31-35: current schema allows `[]`,
   confirmed retrieval logic at store.ts would match anything. Good catch.
5. **`aisep verify --recheck --check-name` already exists** (verified at
   packages/aisep-cli/src/commands/verify.ts L48 + integration.test.ts L190).
   So Change 4's integrate Hard limit can actually be followed by a real command.
6. **Pilot-04 traceability is concrete** — proposal cites specific §4.2 finding
   and specific failure mode (reviewer suspected verify false-positive, no
   mechanism to force re-verify). This is the kind of empirically grounded
   protocol change R5 was designed to gate on, not vibes.

## Open questions for the user

1. **M5 widening — accept or split?** F1's recommended fix widens M5's counter
   from `revise_required` to `revise_required ∪ request_reverify`. This is a
   methodology edit (touches `docs/aisep/02_methodology-v0.1.md` L343). The
   user can either (a) accept this widening inside v0.2 bundle (one PR, one
   review ceremony — efficient), or (b) split into v0.2 (schema only, no
   methodology edit) + a separate v0.2.1 methodology PR. I recommend (a)
   because the methodology edit is necessary for v0.2 to ship safely.

2. **integrate `recheckable` field — wire format addition?** F3 asks whether
   the `recheckable: true` hint in Change 4 is a new field or an encoding in
   existing fields. The user should decide whether v0.2's wire surface includes
   this or whether the hint is encoded in `blockers[].id`. Both are workable.

3. **ADR-lite vs separate ADR file?** F7 offers two restructure options. Given
   single-user single-machine context (per CLAUDE.md §Target User), the inline
   ADR-lite form is lower ceremony and adequate — preference stated. But the
   user may prefer a separate `docs/adr/vessel/ADR-NNN-aisep-protocol-v0.2.md`
   for grep-ability against other ADRs. Worth a one-line clarification before
   revising.
