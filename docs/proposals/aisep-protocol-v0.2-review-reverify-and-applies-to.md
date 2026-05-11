# Proposal: aisep-protocol v0.2 — review `request_reverify` + memory `appliesToStages` min-1

> Status: **DRAFT** — pending cross-review per R5 (protocol changes need
> ADR-lite + cross-review)
> Date: 2026-05-12
> Branch: `feat/aisep-bootstrap`
> Author: Claude Opus 4.7 (1M context)
> Reviewers (pending): vessel-architect, reviewer-cross (cursor-agent
> gpt-5.5-medium)
> Mode: `contract` (per harness-review-workflow skill — schema/契约
> review with ADR-lite + dogfood gate)

## Context

Phase 2.D backlog left 2 items requiring zod schema changes — under
R5 ("protocol changes need ADR-lite + cross-review") these cannot be
done batch-style. This proposal collects both into one v0.2 minor bump
so the cross-review touches the protocol surface once.

Both changes are driven by **Pilot-04 retrospective** (2026-05-12):

- **#10 review `request_reverify` verdict** — solves "soft review verdict
  on top of hard verify gate" anti-pattern (Pilot-04 §4.2): reviewer
  suspected verify false-positive but had no mechanism to force re-verify,
  forcing `pass_with_comments` that stranded integrate.
- **#14 `appliesToStages` min-1** — solves "memory entries with empty
  stage filter retrieved for any stage, polluting prompts": currently
  `AisepAppliesToSchema.stage` allows `[]` (zod default + empty array),
  meaning a malformed promote/recordGlobal could silently produce a
  global-applicable record that triggers on every stage.

## Scope

**In scope** (this proposal):
1. `AisepReviewVerdictKindSchema` add `"request_reverify"` enum value
2. `AisepReviewVerdictSchema` add optional `requestReverify` discriminator field
3. `AisepAppliesToSchema.stage` add `.min(1)` constraint
4. `AisepMemoryStore.recordGlobal` + `recordPending` runtime check (paranoid)

**Explicit non-scope**:
- ❌ Re-shaping `AisepCommentSeverity` or `AisepCommentAction` (drift risk)
- ❌ Reverify execution semantics (left to aisep-cli `verify --recheck`
  which already exists, Phase 2.D #12)
- ❌ Auto-retry on reverify failure (escalate to human; v0.2 does NOT
  auto-loop)

## 7-question anchor gate

| # | Question | Answer |
|---|----------|--------|
| Q1 | **Data model — zod-expressible?** | Yes. (1) `AisepReviewVerdictKindSchema` enum +1; (2) optional discriminator field `requestReverify?: { checkId: string, reason: string }` on `AisepReviewVerdictSchema`; (3) `AisepAppliesToSchema.stage` adds `.min(1)`. |
| Q2 | **Protocol — wire format frozen?** | Yes; this IS the wire format change. Backward-compat: new enum values + new optional field = minor bump (consumers parse old data fine; new data fails on old parsers). |
| Q3 | **Compatibility — existing invariants hold?** | R3/R4 unaffected (no vessel mainline edit). R6 unaffected (no runtime side-effects added). R11 reinforced (`.min(1)` prevents accidental global-tier records that match every stage retrieval). |
| Q4 | **Irreversible decisions?** | (a) `request_reverify` as a verdict value (vs as a separate top-level field) — chosen because integrate's branching is already keyed off `verdict`, adding another field forces every consumer to check both. ADR-lite below. (b) `appliesToStages.min(1)` breaks any existing record with empty stage array — **on-disk audit shows 10/10 records have non-empty stage** (per `~/.aisep/governance-log/evolution_log.json`), so backward-compat OK in practice. |
| Q5 | **Permissions** | No new fs/net/exec surface. |
| Q6 | **Resource contention** | None (read-only schema changes). |
| Q7 | **Rollback** | If v0.2 ships and a consumer breaks: revert protocol package to v0.1.0 commit; existing data parses fine (only new emits fail, no schema-coercion damage). |

## Proposed schema changes

### Change 1: AisepReviewVerdictKindSchema + 1 enum

```typescript
// packages/aisep-protocol/src/review.ts
export const AisepReviewVerdictKindSchema = z.enum([
  "pass",
  "pass_with_comments",
  "revise_required",
  "request_reverify",   // ← NEW (v0.2)
]);
```

### Change 2: AisepReviewVerdictSchema discriminator field

```typescript
export const AisepReviewVerdictSchema = z.object({
  // ... existing fields ...
  verdict: AisepReviewVerdictKindSchema,
  /**
   * REQUIRED when verdict === "request_reverify".
   * Points integrate at a specific verify check to re-run (via
   * `aisep verify --recheck --check-name <id>`). The `reason` is
   * load-bearing audit trail — must explain why the reviewer
   * suspects a false positive.
   */
  requestReverify: z
    .object({
      checkId: z.string().min(1),   // matches contract_grep.checks[].name substring
      reason: z.string().min(1),
    })
    .optional(),
  // ... rest ...
});
```

**Refinement**: at write time, `recordReviewVerdict` (or wherever this
schema is constructed) must assert `verdict === "request_reverify"` ⟺
`requestReverify !== undefined`. Zod-level: superRefine.

### Change 3: AisepAppliesToSchema.stage min-1

```typescript
// packages/aisep-protocol/src/memory.ts
export const AisepAppliesToSchema = z.object({
  domain: z.array(z.string()).default(["*"]),
  stage: z.array(AisepStageSchema).min(1),   // ← was just z.array, no min
  techStack: z.array(z.string()).default(["*"]),
});
```

### Change 4: integrate consumer handles new verdict

`packages/aisep-agents/templates/integrate.hbs` Hard limits add:

> If review verdict is `request_reverify`: integrate MUST NOT proceed.
> Emit `ready_to_integrate: false` with a single blocker pointing at
> `requestReverify.checkId` and quoting `requestReverify.reason`
> verbatim. The maintainer is expected to run
> `aisep verify --recheck --check-name <checkId>`, then re-issue
> review. Treat `request_reverify` identically to `revise_required` for
> blocking purposes, but with `recheckable: true` so the maintainer
> knows the fast path applies.

## Adversarial self-review (3 strongest counter-arguments)

1. **"Adding a 4th verdict makes review prompt-template harder to write — LLM
   gets to lazy-pick `request_reverify` instead of committing."** Skeptical
   reviewer would say: 4 options dilutes intent, "I'm not sure" reviewers
   will park there instead of doing the work to flip to `revise_required`
   or `pass`. **Rebuttal**: the schema-level requirement that
   `requestReverify` MUST carry a concrete `checkId + reason` makes
   `request_reverify` MORE expensive than `pass_with_comments`. The
   reviewer must name a specific failing check and justify why it's a
   suspected false positive. This barrier is exactly what Pilot-04 §4.2
   wanted: stop reviewers from emitting soft pass_with_comments when
   their actual concern is "verify might be wrong about check X".

2. **"`appliesToStages.min(1)` breaks any existing record with empty
   array."** **Rebuttal**: on-disk audit shows 10/10 records in
   `~/.aisep/governance-log/evolution_log.json` have `stage` non-empty
   (every record entered via `aisep memory record` CLI defaults
   `--applies-to-stages` to `[<--stage>]` per Phase 2.D #1
   implementation). Empty array was theoretically allowed but never
   exercised. Migration impact = zero.

3. **"`request_reverify` should be a top-level orthogonal field, not a
   verdict value — separation of concerns."** Skeptical reviewer: "verdict
   = ship/no-ship; reverify = orthogonal request to redo upstream." **Rebuttal**:
   integrate's current branching is `verdict === "pass" || verdict ===
   "pass_with_comments"` → proceed; else block. Adding a parallel
   `reviewer.suggestsReverify: boolean` field means every integrate
   consumer must check BOTH `verdict` AND `suggestsReverify`. With
   `request_reverify` as a verdict value, the existing `verdict !==
   "pass"` branching naturally handles it. The "discriminator object"
   pattern (`requestReverify?: {checkId, reason}`) ties the metadata
   to the verdict cleanly.

## Dogfood gate

Before merging v0.2 protocol to `dev`:

1. Update `packages/aisep-agents/templates/review.hbs` to emit
   `request_reverify` when a reviewer suspects a verify false-positive
   (gated on Pilot-04 §4.2 conditions)
2. Update `packages/aisep-agents/templates/integrate.hbs` per Change 4
   above
3. Update CLI `aisep verify --recheck` to advertise `--check-name`
   filter as the canonical re-run path for `request_reverify` (already
   exists, Phase 2.D #12 commit e40b944)
4. Run a Pilot-N with intentionally truncated verify hand-off (force
   false-positive); verify chain produces `request_reverify` →
   `aisep verify --recheck` → re-issue review → `pass` →
   `ready_to_integrate: true`. End-to-end ~13 min.

## Migration

- **aisep-protocol**: bump version from `0.1.0` to `0.2.0` (minor, additive +
  one tightening constraint with zero on-disk breakage)
- **aisep-memory**: `recordGlobal` / `recordPending` already pass-through
  to zod parse; `.min(1)` enforced at parse time, no code change needed
- **aisep-agents**: `review.hbs` + `integrate.hbs` updated per Dogfood
  Gate items 1-3
- **No vessel mainline change** (R3 holds)

## Risks

| ID | Risk | Mitigation |
|----|------|-----------|
| RISK-Q1 | Existing recorded reviews use 3-value enum; emitter that hard-codes the 3 will silently emit invalid data when 4th value should fire | Hard-code emitters in review.hbs Hard limits; no separate runtime emitter exists yet (v0 review only emits via .hbs) |
| RISK-Q4-a | Reviewers abuse `request_reverify` as a soft escape hatch | Schema requirement: `requestReverify.checkId + reason` BOTH required (zod superRefine); reviewer cannot emit without naming a specific failing check |
| RISK-Q4-b | `appliesToStages.min(1)` is technically a breaking change to the wire schema | On-disk audit confirms 0 existing records with empty array; bump aisep-protocol minor; migration impact = nil |
| RISK-Q7 | A consumer pinned to aisep-protocol@0.1.0 sees new `request_reverify` data and rejects | v0 ecosystem has 1 consumer (vessel-aisep itself); rollback = revert this commit |

## ADR-lite

**Decision**: ship as ONE protocol minor bump (v0.1.0 → v0.2.0) bundling
both changes; cross-review with vessel-architect + reviewer-cross
(harness-review-workflow `contract` mode); merge to `feat/aisep-bootstrap`
after verdict ≥ `pass_with_comments`.

**Why bundled**: same touch surface (protocol package), same R5 review
overhead, same backward-compat profile. Splitting wastes cross-review
budget.

**Why minor not patch**: enum extension `+1` value is conceptually a
schema growth, not a fix. Per semver convention for schema extensions
in a 0.x package, minor is appropriate.

## Next steps (not in this session)

1. Run harness-review-workflow `contract` mode with this proposal as
   input
2. Apply review comments (≤ 2 ping-pong rounds per M5 red line —
   docs/aisep/02_methodology-v0.1.md L343)
3. Implement the 4 changes + Dogfood gate Pilot-N
4. Commit + tag aisep-protocol@0.2.0

Until cross-review is run, **DO NOT** implement (R5).
