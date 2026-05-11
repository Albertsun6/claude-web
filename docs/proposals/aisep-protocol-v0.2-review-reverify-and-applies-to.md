# Proposal: aisep-protocol v0.2 — review `request_reverify` + memory `appliesToStages` min-1

> **Proposal version: v3 — CONVERGED** (post-Phase 1+2+3 cross-review)
> Date: 2026-05-12
> Branch: `feat/aisep-bootstrap`
> Author: Claude Opus 4.7 (1M context)
> Reviewers: harness-architecture-review (Claude Agent), reviewer-cross
> (cursor-agent gpt-5.5-medium)
> Mode: `contract` (per harness-review-workflow skill — schema/契约
> review with ADR-lite + dogfood gate)
>
> Review trail:
> - `docs/reviews/aisep-protocol-v0.2-arch-2026-05-12-0246.md`
> - `docs/reviews/aisep-protocol-v0.2-cross-2026-05-12-0246.md`
> - `docs/reviews/aisep-protocol-v0.2-react-arch-2026-05-12-0246.md`
> - `docs/reviews/aisep-protocol-v0.2-react-cross-2026-05-12-0246.md`
> - `docs/reviews/aisep-protocol-v0.2-arbitration-2026-05-12.md`
>
> v2 → v3 changes: §Scope expanded 4 → 6 items (added write-path parse +
> loadFile bifurcation); §Change 2 switched superRefine →
> z.discriminatedUnion; §Change 4 switched denylist → allowlist; new
> §Change 5 (write-path parse) + §Change 6 (methodology updates); §Risks
> added RISK-M5 + RISK-Q4-c; §Dogfood gate 1 pilot two-phase acceptance.

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
2. `AisepReviewVerdictSchema` migrated to `z.discriminatedUnion("verdict", [...])`
   with required `requestReverify: {checkId, reason}` payload when verdict =
   `"request_reverify"`, forbidden otherwise *(v3: was superRefine in v2)*
3. `AisepAppliesToSchema.stage` add `.min(1)` constraint
4. `aisep-memory` write-path parse: `recordPending` / `recordGlobal` /
   `promote` call `AisepMemoryRecordSchema.parse(record)` before
   `log.records.push()` *(v3 new: A.F9 / B.F1 — proposal v2 wrongly
   claimed this was already done)*
5. `aisep-memory` `loadFile` bifurcation: inspector path keeps
   fail-open-to-empty; read-then-write path MUST throw on parse failure
   (prevents silent log erasure when `.min(1)` lands) *(v3 new: A.F8 +
   B.F1 compound BLOCKER)*
6. `aisep-agents` `integrate.hbs` switches from denylist
   ("block if verdict ∈ {revise_required, ...}") to allowlist ("proceed iff
   verdict ∈ {pass, pass_with_comments}") — fail-closed for future enum
   growth *(v3 refined: B.F3 + A.F3)*
7. methodology `docs/aisep/02_methodology-v0.1.md` updates: L138 "固定三类"
   → "固定四类"; L138/L146 dash → underscore form; L343 M5 counter widens
   from `revise_required` to `revise_required ∪ request_reverify` *(v3
   new: A.F1 + A.F4)*

**Explicit non-scope**:
- ❌ Re-shaping `AisepCommentSeverity` or `AisepCommentAction` (drift risk)
- ❌ Reverify execution semantics (left to aisep-cli `verify --recheck`
  which already exists, Phase 2.D #12)
- ❌ Auto-retry on reverify failure (escalate to human; v0.2 does NOT
  auto-loop)
- ❌ New `recheckable: boolean` field on integrate output — instead encode
  hint in `blockers[0].id` prefix `recheckable:<checkId>` (A.F3 fix
  option 2)

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

### Change 2: AisepReviewVerdictSchema → z.discriminatedUnion

*(v3: switched from optional+superRefine to discriminatedUnion per
B.F2 — stronger TS narrowing, fail-closed at parse boundary.)*

```typescript
// packages/aisep-protocol/src/review.ts

// All non-reverify verdicts: NO requestReverify field allowed.
const NonReverifyVerdictSchema = z.object({
  id: OpaqueIdSchema,
  stageRunId: OpaqueIdSchema,
  reviewer: AisepReviewerKindSchema,
  reviewerId: OpaqueIdSchema.optional(),
  model: z.string().optional(),
  verdict: z.enum(["pass", "pass_with_comments", "revise_required"]),
  comments: z.array(AisepCommentSchema).default([]),
  suggestedPatches: z.array(AisepPatchSchema).default([]),
  reviewedAt: EpochMsSchema,
});

// request_reverify variant: MUST carry concrete checkId + reason.
// checkId regex per B.F4: alphanumeric / dot / dash / underscore / colon —
// avoids shell-metachar footgun when piped to `aisep verify --recheck
// --check-name <checkId>`. Exact-match by default (substring opt-in via
// future CLI flag).
const RequestReverifyVerdictSchema = z.object({
  id: OpaqueIdSchema,
  stageRunId: OpaqueIdSchema,
  reviewer: AisepReviewerKindSchema,
  reviewerId: OpaqueIdSchema.optional(),
  model: z.string().optional(),
  verdict: z.literal("request_reverify"),
  comments: z.array(AisepCommentSchema).default([]),
  suggestedPatches: z.array(AisepPatchSchema).default([]),
  reviewedAt: EpochMsSchema,
  requestReverify: z.object({
    /** Exact match against contract_grep.checks[].name. Constrained to
     * shell-safe chars (B.F4). */
    checkId: z.string().regex(/^[A-Za-z0-9_.:-]+$/),
    /** Audit text: ≤ 500 chars (B's OQ2 — prevents prompt-injection-via-
     * reason when integrate.md quotes verbatim). */
    reason: z.string().min(1).max(500),
  }),
});

export const AisepReviewVerdictSchema = z.discriminatedUnion("verdict", [
  NonReverifyVerdictSchema,
  RequestReverifyVerdictSchema,
]);
export type AisepReviewVerdict = z.infer<typeof AisepReviewVerdictSchema>;
```

**Why discriminated union over superRefine** (per B.F2 cross-pollinate):
- TS narrows `requestReverify` to required when `verdict === "request_reverify"`,
  forbidden otherwise — at type level, not just runtime
- Fail-closed at parse boundary: `{verdict:"pass", requestReverify:{...}}`
  is rejected (no implicit optional field bleed)
- No `.superRefine` indirection — schema IS the invariant
- Caveat: existing `aisep-core/runner.ts` consumers using `AisepReviewVerdict`
  via `z.infer` get a tagged union; must verify typecheck still passes
  before merging (`aisep-core/__tests__/*.test.ts` exercises the relevant
  paths)

### Change 3: AisepAppliesToSchema.stage min-1

```typescript
// packages/aisep-protocol/src/memory.ts
export const AisepAppliesToSchema = z.object({
  domain: z.array(z.string()).default(["*"]),
  stage: z.array(AisepStageSchema).min(1),   // ← was just z.array, no min
  techStack: z.array(z.string()).default(["*"]),
});
```

### Change 4: integrate.hbs allowlist form (v3 refined)

*(v3: switched from "block on `revise_required`" denylist to "proceed
iff verdict ∈ allowlist" per B.F3 + A.F3 — fail-closed for any future
verdict added to the enum without integrate.hbs ping-pong.)*

`packages/aisep-agents/templates/integrate.hbs` Hard limits replace any
existing per-verdict block rule with:

> **Allowlist gate** (fail-closed): proceed (`ready_to_integrate: true`)
> ONLY if review verdict ∈ {`pass`, `pass_with_comments`} AND verify
> reports zero `ok: false` checks AND no top-level blockers. Any other
> verdict (including new enum values added in future versions) blocks
> by default — emit `ready_to_integrate: false`.
>
> **If verdict is `request_reverify`**: integrate emits
> `ready_to_integrate: false` with `blockers[0]` having:
> - `id`: `"recheckable:<requestReverify.checkId>"` (prefix encodes
>   fast-path applicability — A.F3 fix option 2)
> - `description`: "Reviewer requested re-verify on check
>   `<checkId>`: <verbatim requestReverify.reason, truncated to 500
>   chars per schema cap>"
> The maintainer runs
> `aisep verify --recheck --check-name <checkId>` to flip the gate,
> then re-issues review.

**Why allowlist over denylist**: when v0.3 / v0.4 / etc. adds a new
verdict (hypothetical `defer`, `escalate`, etc.), an out-of-date
integrate.hbs **fails closed** rather than silently treating unknown
verdicts as pass. This is the same defense-in-depth principle as
verify's `outcome` field (Phase 2.D #5).

### Change 5: aisep-memory write-path parse + loadFile bifurcation (v3 new)

*(v3 new — A.F8/A.F9/B.F1 compound BLOCKER: proposal v2 wrongly claimed
"recordGlobal / recordPending already pass-through to zod parse; no code
change needed". Fact-check showed all three write paths bypass parse
[store.ts L101, L139, L189]. Adding `.min(1)` without write-path parse
is a no-op; combined with `loadFile`'s catch-to-empty fallback [store.ts
L36-39] it's a silent log-erasure vector.)*

#### 5a. Write-path parse

`packages/aisep-memory/src/store.ts` updates:

```typescript
// In recordPending (~L89):
recordPending(input: ...): AisepMemoryRecord {
  const record: AisepMemoryRecord = { ... };
  AisepMemoryRecordSchema.parse(record);   // ← NEW: throw on invalid before persisting
  const log = loadFile(this.workspacePath);
  log.records.push(record);
  saveFile(this.workspacePath, log);
  return record;
}

// Same pattern in recordGlobal (~L118) before push (~L139)
// Same pattern in promote (~L155) for each `verified` record before
// push (~L189)
```

#### 5b. loadFile bifurcation

Replace single `loadFile` with two entry points:

```typescript
/** Inspector path: fail-open-to-empty (for read-only stats / list).
 * Comment retained: "corrupt file falls back to empty (server is truth)". */
function loadFileSafe(path: string): AisepEvolutionLogV1 {
  if (!existsSync(path)) return emptyLog();
  const raw = readFileSync(path, "utf-8");
  try {
    return AisepEvolutionLogV1Schema.parse(JSON.parse(raw));
  } catch {
    return emptyLog();
  }
}

/** Read-then-write path: MUST throw on parse failure to prevent
 * silent erasure of unparseable records (A.F8). Used by recordPending /
 * recordGlobal / promote. */
function loadFileStrict(path: string): AisepEvolutionLogV1 {
  if (!existsSync(path)) return emptyLog();
  const raw = readFileSync(path, "utf-8");
  // Let parse errors propagate to caller; do NOT fall back to empty.
  return AisepEvolutionLogV1Schema.parse(JSON.parse(raw));
}
```

Inspectors (`listWorkspacePending` / `listGlobalVerified` / `stats` /
`retrieve`) keep `loadFileSafe`. Mutators (`recordPending` /
`recordGlobal` / `promote`) switch to `loadFileStrict`.

#### 5c. One-shot migration (v0.2.0 tag pre-flight)

Add a script `packages/aisep-memory/scripts/migrate-v0.2-min1.mjs`:

```typescript
// Pre-flight before tagging aisep-protocol@0.2.0:
// scan ALL evolution_log.json under known workspaces + global, find
// any record with `appliesTo.stage.length === 0`, abort with a list
// (forces user to clean before .min(1) tightening). Idempotent.
import { readFileSync } from "fs";
import { execSync } from "child_process";

const paths = execSync(`find /Users/yongqian/Desktop /Users/yongqian/.aisep -name evolution_log.json 2>/dev/null`)
  .toString().trim().split("\n").filter(Boolean);

const violations = paths.flatMap(p => {
  const log = JSON.parse(readFileSync(p, "utf-8"));
  return (log.records ?? [])
    .filter((r: any) => Array.isArray(r.appliesTo?.stage) && r.appliesTo.stage.length === 0)
    .map((r: any) => ({ path: p, id: r.id, failurePattern: r.failurePattern }));
});

if (violations.length > 0) {
  console.error("Cannot tag v0.2.0: empty-stage records exist:", violations);
  process.exit(1);
}
console.log("Pre-flight OK: zero empty-stage records across", paths.length, "files");
```

Run before tagging; abort tag if any record violates `.min(1)`.

### Change 6: methodology doc updates (v3 new)

*(v3 new — A.F1 + A.F4: 02_methodology-v0.1.md L138/L146/L343 must move
with the schema or doc-canon drifts.)*

```diff
--- a/docs/aisep/02_methodology-v0.1.md
+++ b/docs/aisep/02_methodology-v0.1.md
@@ -138,1 +138,1 @@
-- review 输出固定三类：`pass` / `pass-with-comments` / `revise-required`
+- review 输出固定四类：`pass` / `pass_with_comments` / `revise_required` / `request_reverify`
@@ -146,1 +146,1 @@
- (any L146 reference to the 3-value list — switch to 4-value + underscore)
+
@@ -343,1 +343,1 @@
-| M5 | review stage `revise-required` 累计 2 次 → 必须 cut scope（不允许第 3 轮 ping-pong） | aisep-core 强制 |
+| M5 | review stage `revise_required` ∪ `request_reverify` 累计 2 次 → 必须 cut scope（不允许第 3 轮 ping-pong；same `stageRunId` counter） | aisep-core 强制 |
```

aisep-core M5 enforcement logic (out-of-scope here but downstream of
this proposal): the runtime counter currently keyed off `verdict ===
"revise_required"` widens to `verdict === "revise_required" || verdict
=== "request_reverify"`, both counted per `stageRunId`.

## Adversarial self-review (3 strongest counter-arguments)

1. **"Adding a 4th verdict makes review prompt-template harder to write — LLM
   gets to lazy-pick `request_reverify` instead of committing, AND the loop
   `review → request_reverify → recheck → review → request_reverify → …`
   has no automatic fence."** Skeptical reviewer would say: (a) 4 options
   dilutes intent, "I'm not sure" reviewers will park there instead of
   doing the work to flip to `revise_required` or `pass`; (b) the proposal
   says "v0.2 does NOT auto-loop" but the *human-mediated* loop remains
   unbounded — methodology M5 only counts `revise_required`, so 2-round
   ping-pong cap silently breaks.
   **Rebuttal (a)**: the schema-level requirement (discriminated union)
   that `requestReverify` MUST carry a concrete `checkId + reason` makes
   `request_reverify` MORE expensive than `pass_with_comments`. The
   reviewer must name a specific failing check and justify why it's a
   suspected false positive. This barrier is exactly what Pilot-04 §4.2
   wanted: stop reviewers from emitting soft pass_with_comments when
   their actual concern is "verify might be wrong about check X".
   **Rebuttal (b) [v3 — A.F1 / B-react-cross]**: M5 widens in §Change 6 to
   count `revise_required ∪ request_reverify` within the same `stageRunId`.
   aisep-core enforcement (per methodology L343 "aisep-core 强制") simply
   widens its counter set — no schema payload bump needed (cap is a
   workflow invariant, not review data). Dogfood gate Pilot-N includes
   the M5 boundary acceptance test (see §Dogfood gate).

2. **"`appliesToStages.min(1)` breaks any existing record with empty
   array — AND audit only covered global, not pending tier."** Skeptical
   reviewer (B.F5 + A.F5): the v2 proposal cited 10/10 records in
   `~/.aisep/governance-log/evolution_log.json` non-empty, but did NOT
   audit `<workspace>/.aisep/evolution_log.json` files where untrusted
   pending writes accumulate before promote. Combined with B.F1
   (`recordPending` doesn't parse-gate writes), an empty-stage pending
   record could exist; with v0.2's strict-mode `loadFile` (Change 5b),
   loading that record throws — and the old fallback-to-empty (catch-to-
   empty) silently erased the entire log on next save.
   **Rebuttal (v3)**: §Change 5c adds a one-shot migration pre-flight
   (`packages/aisep-memory/scripts/migrate-v0.2-min1.mjs`) that scans
   ALL `evolution_log.json` files under known workspaces + global, finds
   any record with `appliesTo.stage.length === 0`, and ABORTS the tag
   if violations exist (forces user cleanup before strict-mode lands).
   This converts what was "implicit zero migration impact" into a
   verified zero — the script's exit code is the audit.

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
   above (allowlist form)
3. Update CLI `aisep verify --recheck` to advertise `--check-name`
   filter as the canonical re-run path for `request_reverify` (already
   exists, Phase 2.D #12 commit e40b944); ensure `--check-name`
   semantics are **exact-match** by default (per B.F4 — substring was a
   footgun)
4. Run `packages/aisep-memory/scripts/migrate-v0.2-min1.mjs` pre-flight
   (Change 5c); must exit 0 across all known evolution_log.json files
5. **Run one Pilot-07 with TWO acceptance phases** (per A.F6 + B
   refinement: 1 pilot, 2 acceptances — not 2 pilots):

   **Phase 5a (happy path)**: intentionally truncated verify hand-off
   forces a `contract_grep` false-positive. Verify chain produces
   `request_reverify` → maintainer runs `aisep verify --recheck
   --check-name <id>` → re-issue review → `pass` → integrate
   `ready_to_integrate: true`. End-to-end ~13 min.

   **Phase 5b (M5 boundary)**: second consecutive `request_reverify` on
   the same `stageRunId` must increment M5 counter; third blocking
   review MUST be refused / cut-scope by aisep-core. Verify the runtime
   enforcement triggers exactly when M5 counter reaches 2 (not 3, not
   1).

   **Phase 5c (schema enforcement)**: emit a malformed
   `{verdict:"request_reverify"}` with NO `requestReverify` payload;
   confirm `AisepReviewVerdictSchema.parse()` rejects (discriminated
   union returns a parse error, not a partial parse).

   Document in `docs/aisep/retrospectives/pilot-07-protocol-v0.2-2026-05-NN.md`.

**Acceptance**: all 5 items complete + Pilot-07 retro sealed before
tagging `aisep-protocol@0.2.0`. If any Phase 5a/5b/5c fails, v0.2 does
NOT merge — investigate + revise the proposal (back to phase 1 ping-pong
if needed; per skill rule "最多 3 轮").

## Migration

- **aisep-protocol**: bump version from `0.1.0` to `0.2.0` (minor —
  enum extension + tightening constraint + discriminated-union refactor;
  backward-compat verified by §Change 5c migration pre-flight)
- **aisep-memory** *(v3 corrected — A.F9: previous v2 wording was
  factually wrong)*:
  - **Write-path parse**: `recordGlobal` / `recordPending` / `promote`
    currently bypass zod-parse on write (only `loadFile` parses on
    read). Add `AisepMemoryRecordSchema.parse(record)` before each
    `log.records.push(...)` (§Change 5a).
  - **loadFile bifurcation**: split into `loadFileSafe` (inspector,
    fail-open-to-empty) and `loadFileStrict` (mutator, throws on parse
    failure). Without this, the tightening `.min(1)` becomes a silent
    log-erasure vector (§Change 5b — A.F8 + B.F1 compound BLOCKER).
  - **One-shot pre-flight migration**: run
    `packages/aisep-memory/scripts/migrate-v0.2-min1.mjs` before
    tagging v0.2.0. Aborts tag if any record across global + all
    workspace-pending logs has `appliesTo.stage.length === 0`
    (§Change 5c — covers A.F5 / B.F5 audit gap).
- **aisep-agents**: `review.hbs` + `integrate.hbs` updated per Dogfood
  Gate items 1-3 (allowlist form per Change 4)
- **methodology doc**: `docs/aisep/02_methodology-v0.1.md` L138 (固定三类
  → 四类), L146 (any 3-value list ref), L343 (M5 counter widening) per
  §Change 6. This is a doc-canon update, NOT a schema bump — but ships
  in the same git commit as the schema changes to prevent drift.
- **No vessel mainline change** (R3 holds)

## Risks

| ID | Risk | Mitigation |
|----|------|-----------|
| RISK-Q1 | Existing recorded reviews use 3-value enum; emitter that hard-codes the 3 will silently emit invalid data when 4th value should fire | Hard-code emitters in review.hbs Hard limits; no separate runtime emitter exists yet (v0 review only emits via .hbs) |
| RISK-Q4-a | Reviewers abuse `request_reverify` as a soft escape hatch | Schema requirement: `requestReverify.checkId + reason` BOTH required (discriminated union at parse boundary, not optional+superRefine); reviewer cannot emit without naming a specific failing check |
| RISK-Q4-b | `appliesToStages.min(1)` breaks existing records with empty array (v2 thought "zero impact"; v3 enforces by pre-flight script) | §Change 5c pre-flight migration script aborts tag if any record violates; turns implicit zero impact into verified zero |
| **RISK-Q4-c** *(v3 new — B's OQ2)* | `requestReverify.reason` quoted verbatim in integrate.md → prompt-injection-via-reason risk if reviewer LLM is itself untrusted | Schema cap `reason: z.string().min(1).max(500)`; integrate.hbs Hard limit treats `reason` as audit text only (not as instructions); future v0.3 can add content-sanity grep |
| **RISK-M5** *(v3 new — A.F1)* | Adding `request_reverify` widens the review state-machine; without M5 counter widening, the human-mediated review→recheck→review loop runs unbounded, silently breaking the 2-round ping-pong cap | §Change 6 widens M5 to count `revise_required ∪ request_reverify` within same `stageRunId`; aisep-core counter set widens (no schema payload change). Dogfood Phase 5b verifies enforcement |
| **RISK-LOAD** *(v3 new — A.F8 + B.F1)* | `loadFile`'s catch-to-empty fallback + missing write-path parse = silent log erasure when `.min(1)` lands | §Change 5a write-path parse + §Change 5b loadFile bifurcation: inspectors keep fail-open-empty; mutators throw on parse failure |
| RISK-Q7 | A consumer pinned to aisep-protocol@0.1.0 sees new `request_reverify` data and rejects | v0 ecosystem has 1 consumer (vessel-aisep itself); rollback = revert this commit |

## ADR-lite *(v3 restructured per A.F7)*

**Context**: Phase 2.D backlog (Pilot-04 retrospective, 2026-05-12) left
two items requiring zod schema changes under R5. Pilot-04 §4.2 surfaced
a "soft review verdict on top of hard verify gate" anti-pattern: reviewer
suspected verify false-positive but had no mechanism to force re-verify,
forcing `pass_with_comments` that stranded integrate. Separately, audit
of memory.ts found `appliesTo.stage` allowed `[]` — silent global-stage
pollution risk at retrieve time.

**Decision**: ship as ONE protocol minor bump (`aisep-protocol@0.1.0 →
0.2.0`) bundling six changes (4 schema/code + 2 doc — see §Scope). Run
harness-review-workflow `contract` mode (vessel-architect Claude +
reviewer-cross cursor-agent). Merge to `feat/aisep-bootstrap` only after
all Dogfood Gate phases pass (5a/5b/5c).

**Consequences**:

*Positive*:
- `request_reverify` verdict closes Pilot-04 §4.2 reviewer-can't-unblock
  anti-pattern; integrate fails closed by allowlist form
- `.min(1)` on `appliesToStages` removes silent global-pollution risk at
  retrieve time (reinforces R11 trust boundary)
- Discriminated union pattern + write-path parse + loadFile bifurcation
  combine to give v0.2 strict-mode-on-write semantics (closes A.F8 silent
  log erasure)
- Methodology doc-canon stays in sync with schema (no more "固定三类" vs
  4-value schema drift; also fixes pre-existing dash/underscore drift)

*Negative / Trade-offs*:
- 4-value verdict enum increases LLM template complexity (review.hbs gains
  one fail mode); mitigated by §Change 2 schema cost-of-emission
- M5 widening adds one row to the counter set; aisep-core enforcement
  must update simultaneously (gated by Dogfood Phase 5b)
- 6 changes is a wider blast radius than v2's 4; mitigated by single
  cross-review ceremony and single tag (per "Why bundled" below)

*Why bundled (single tag)*: same touch surface (protocol + adjacent
agents/memory), same R5 review overhead, same backward-compat profile
(verified by §Change 5c pre-flight). Splitting wastes cross-review
budget AND risks methodology-vs-schema drift between separate tags.

*Why minor not patch*: enum extension `+1` value + tightening constraint
+ discriminated-union refactor + new write-path parse are conceptually
schema/code growth, not a fix. Per semver convention for schema
extensions in a 0.x package, minor is appropriate.

**Review trail**:
- Phase 1: `docs/reviews/aisep-protocol-v0.2-{arch,cross}-2026-05-12-0246.md`
- Phase 2: `docs/reviews/aisep-protocol-v0.2-react-{arch,cross}-2026-05-12-0246.md`
- Phase 3 arbitration: `docs/reviews/aisep-protocol-v0.2-arbitration-2026-05-12.md`
- 12 findings raised, 12 accepted (0 partial / 0 reject / 0 user-escalate)
- Single-pass convergence (no round 2 needed)

## Next steps

✅ Cross-review converged v3 (this session, 2026-05-12). Implementation
allowed under R5.

Remaining:
1. Implement §Change 1-6 in the order:
   1.1 §Change 6 methodology doc updates first (the canon shift before
       schema lands)
   1.2 §Change 5c pre-flight script (idempotent)
   1.3 §Change 5a + 5b (write-path parse + loadFile bifurcation)
   1.4 §Change 1+2+3 protocol schema (discriminated union + .min(1))
   1.5 §Change 4 integrate.hbs allowlist form
   1.6 aisep-core M5 counter widening (downstream of §Change 6 — out of
       scope here but gated by Dogfood 5b)
2. Run Dogfood Gate items 1-5 (5a happy + 5b M5 + 5c schema)
3. Commit + tag `aisep-protocol@0.2.0` if Dogfood passes
4. Record `aisep-protocol-v0.2-arbitration` findings as memory candidates
   (per arbitration log's "candidate memory record for AlphaEvolve")
