# Phase 2 React — architecture-fit lens reacting to cross-correctness verdict
> Reviewer: harness-architecture-review (Claude Opus 4.7)
> Date: 2026-05-12
> Phase 2 (cross-pollinate)

## React to Reviewer B's findings

### B.F1 — agree (with severity boost: BLOCKER stands, and it falsifies a proposal claim)
**Reviewer B's original**: "Proposal says these paths are already zod-parse gated, but write paths construct records and save without parsing first. Empty-stage invalid records could still persist, then future load parse fails and may make log appear empty."

**My reaction**: agree.

**Reason**: B is straight-up correct on the code reality. My Phase 1 took the proposal's §Migration claim ("`recordGlobal` / `recordPending` already pass-through to zod parse; `.min(1)` enforced at parse time, no code change needed") at face value because my lens (arch-fit) was looking at whether the schema change *could* enforce R11 — not whether the store *currently* enforces parse on write. B's cross-correctness lens caught what I missed: the proposal's own §Migration bullet 2 is **factually wrong** about current behavior, which means the proposal's claim "no code change needed" is also wrong. Without a write-path parse, `.min(1)` on the schema does nothing for `recordPending` / `recordGlobal` / `promote` — they all bypass it.

This is worse than B framed it: not only would empty-stage records still persist, but `loadFile`'s catch block (store.ts L36-39) **swallows parse failures and returns `emptyLog()`**. So a single corrupt write would silently empty the log on next load — exactly the "log appears empty" failure mode B flagged, with a concrete code path.

**Fact-check** (for B.F1 specifically — verbatim from `/Users/yongqian/Desktop/Vessel-aisep/packages/aisep-memory/src/store.ts`):

- **`recordPending` (L89-104)**: builds `record`, calls `log.records.push(record)` (L101), then `saveFile(this.workspacePath, log)` (L102). **No `AisepMemoryRecordSchema.parse(record)` or `AisepEvolutionLogV1Schema.parse(log)` before write.**
- **`recordGlobal` (L118-142)**: builds `record`, calls `log.records.push(record)` (L139), then `saveFile(this.globalPath, log)` (L140). **No schema parse before write.**
- **`promote` (L155-197)**: builds `verified` record (L180-188), pushes to `globalLog.records` (L189), then `saveFile(this.globalPath, globalLog)` (L194). **No schema parse before write.**
- **`loadFile` (L30-40)** *does* call `AisepEvolutionLogV1Schema.parse(parsed)` on L35, but the surrounding `try`/`catch` at L33+L36-39 silently returns `emptyLog()` on any parse failure. Comment at L37 says "corrupt file falls back to empty (server is truth)" — but for a personal single-machine deploy with no server, the global log IS the truth, so this is a data-loss fail-open.

Net: B.F1's BLOCKER severity is justified and the proposal's §Migration claim needs correction.

---

### B.F2 — agree (overlaps my A.F2 in substance, but B's framing is sharper)
**Reviewer B's original**: "Current proposal wording makes the invariant sound write-time only. Invalid wire data like `request_reverify` without payload could parse unless schema enforces it. Put biconditional into `AisepReviewVerdictSchema` via `.superRefine()` or discriminated union."

**My reaction**: agree.

**Reason**: B.F2 and my A.F2 are the same finding — superRefine is described in prose but not codified in the schema block, so without it the discriminator-payload biconditional is unenforced. B's contribution beyond my A.F2 is the **alternative**: `z.discriminatedUnion("verdict", ...)`. That's actually a stronger TS-narrowing pattern than superRefine and I should adopt it in my updated suggestion. SuperRefine still works but it produces a single union type where `requestReverify` is always `Foo | undefined`; discriminated union produces a tagged union where TS narrows `requestReverify` to required iff `verdict === "request_reverify"`. For a wire-format-frozen v0.2 schema, discriminated union is the more durable choice.

**New suggestion** (refines my A.F2): swap superRefine for discriminated union as primary suggestion:

```typescript
const RequestReverifyVerdictSchema = z.object({
  verdict: z.literal("request_reverify"),
  requestReverify: z.object({
    checkId: z.string().regex(/^[A-Za-z0-9_.:-]+$/),  // tightened per B.F4
    reason: z.string().min(1),
  }),
  // ...common fields
});
const OtherVerdictSchema = z.object({
  verdict: z.enum(["pass", "pass_with_comments", "revise_required"]),
  // ...common fields, NO requestReverify
});
export const AisepReviewVerdictSchema = z.discriminatedUnion("verdict", [
  RequestReverifyVerdictSchema,
  OtherVerdictSchema,
]);
```

Keep superRefine as fallback if discriminated union conflicts with existing consumer typings (need to verify `aisep-core/runner.ts` typecheck still passes — same caveat I had in A.F2).

---

### B.F3 — refine (I disagree with the framing, agree with the fix)
**Reviewer B's original**: "Proposal overstates current behavior. Existing hard limit explicitly blocks `revise_required`, failed verify, or blockers, not every non-pass verdict. Make template update mandatory: proceed only for `pass` / `pass_with_comments`; explicitly block `request_reverify`."

**My reaction**: refine.

**Reason**: I partially disagree with B's premise that the proposal "overstates current behavior". §Change 4 explicitly mandates the template update — "Hard limits add: If review verdict is `request_reverify`: integrate MUST NOT proceed..." That's not overstatement; it's a prescribed delta. The proposal isn't claiming integrate *currently* blocks `request_reverify` — there's no `request_reverify` to block today.

However, B's underlying point survives the framing critique: if a future consumer or a partially-updated integrate.hbs encounters `request_reverify` and the template only has the existing "block on `revise_required` or blockers" rule, it silently treats `request_reverify` like `pass_with_comments` (since the enum isn't in the block list). That IS a real concern — defense-in-depth says the template should switch from a **denylist** ("block if verdict ∈ {revise_required}") to an **allowlist** ("proceed iff verdict ∈ {pass, pass_with_comments}"). That way, any future verdict added to the enum without updating integrate.hbs fails closed.

**New suggestion** (refines B.F3): Change 4 should update integrate.hbs's blocking logic to **allowlist form** ("proceed iff verdict ∈ {pass, pass_with_comments}") rather than just **adding** `request_reverify` to the denylist. This generalizes: future verdict additions (e.g., a hypothetical `defer` or `escalate`) fail closed without needing another integrate.hbs ping-pong. Also resolves my A.F3 concern about `recheckable: true` drift — with an allowlist, the integrate output for `request_reverify` blocks naturally, and the hint can ride on `blockers[0].id` per my A.F3 fix option (2).

---

### B.F4 — agree
**Reviewer B's original**: "`z.string().min(1)` is broad for a future command-facing field. Use a regex like `/^[A-Za-z0-9_.:-]+$/` and exact check-name matching, not substring."

**My reaction**: agree.

**Reason**: `checkId` flows into the shell command `aisep verify --recheck --check-name <checkId>`. `z.string().min(1)` allows whitespace, quotes, shell metacharacters — even though aisep-cli probably escapes args, defense-in-depth says constrain at the protocol layer. B's regex `/^[A-Za-z0-9_.:-]+$/` is reasonable; matches the character class of existing check names per `packages/aisep-protocol/src/contract.ts` contract_grep.checks[].name conventions (alphanumeric, dot, dash, underscore, colon for namespacing). The substring-vs-exact-match point is the second piece — B is right that "substring match" (current proposal phrasing at §Change 2 inline comment "matches contract_grep.checks[].name substring") is a footgun. A reviewer naming `lint` would re-run every check whose name *contains* `lint`. Exact match should be the default; substring should be opt-in via a separate flag if needed.

I missed this in Phase 1 because my arch-fit lens didn't trace `checkId` into the shell command — B's cross-correctness lens did. Solid catch.

---

### B.F5 — agree (overlaps my A.F5, B's framing is more actionable)
**Reviewer B's original**: "10/10 audit proves global verified log only, not workspace pending logs. Rephrase claim and add pending-log preflight or migration check."

**My reaction**: agree.

**Reason**: B.F5 and my A.F5 are the same finding. B adds one piece I missed: the suggestion to add a **preflight or migration check** as part of v0.2 ship gate, not just rephrase the claim. That's the right move — if `.min(1)` will reject any existing pending record on next write (when `loadFile` parses, returns empty per the catch block, and a subsequent record write essentially erases the file), v0.2 needs to actively scan all known pending logs before tagging. Combined with B.F1, this preflight becomes critical: a write-path parse without a preflight migration would silently empty any workspace pending log containing a pre-`.min(1)` empty-stage record.

I'd downgrade my A.F5 from MINOR to MAJOR after seeing B.F1 — the two findings compound (no write-path parse + breaking constraint + load-side fail-open-to-empty = data loss vector if any empty-stage record exists in pending logs).

---

## Self-revision of my Phase 1 verdict

- **A.F1 (M5 widening)**: **keep** at MAJOR. B's lens didn't address the M5 ping-pong cap issue at all — they were focused on schema-correctness, not methodology fence widening. My finding still stands and is orthogonal to B's findings. No change.

- **A.F2 (superRefine described not coded)**: **keep**, but **refine the suggested fix** per B.F2 — primary recommendation switches from superRefine to `z.discriminatedUnion("verdict", ...)`. SuperRefine becomes the fallback only if discriminated union breaks existing TS consumers.

- **A.F3 (`recheckable: true` drift)**: **keep** at MINOR, but **link to B.F3's allowlist fix** — if integrate.hbs switches to allowlist blocking, the `recheckable` hint naturally rides on `blockers[0].id` (my F3 fix option 2) without needing a new output-schema field. Two findings, one composed fix.

- **A.F4 (methodology drift `固定三类`)**: **keep** at MINOR. B didn't touch this. Still load-bearing for doc-vs-schema canonicity.

- **A.F5 (Q4(b) audit thin)**: **upgrade from MINOR to MAJOR** after B.F1 lands. Rationale: A.F5 in isolation was "evidence is thin"; combined with B.F1's discovery that there's no write-path parse + `loadFile` silently empties on parse failure, an un-audited pending log with an empty-stage record becomes a data-loss landmine. Severity needs to reflect that compound risk.

- **A.F6 (Dogfood gate acceptance criteria)**: **keep** at MINOR.

- **A.F7 (ADR-lite Context/Consequences missing)**: **keep** at MINOR. Stylistic / methodology hygiene issue, B's lens correctly didn't touch it.

## New findings (after seeing B's lens)

### A.F8 (new) — `loadFile` catch block + missing write-path parse = silent log erasure on schema tightening — [BLOCKER, compound with B.F1 + A.F5]
**Where**: store.ts L33-39 (`loadFile` try/catch) intersects with §Change 3 (`appliesToStages.min(1)`)

**Issue**: This is the failure mode B.F1 implies but doesn't fully articulate. Sequence:
1. v0.2 ships with `.min(1)` on `stage` but no write-path parse added to `recordPending` / `recordGlobal` / `promote`.
2. A pre-existing workspace log has a single record with `stage: []` (we audited 10/10 global non-empty, but we did NOT audit pending — A.F5/B.F5).
3. Next time `aisep memory promote` or any other code path loads that workspace log, `loadFile` calls `AisepEvolutionLogV1Schema.parse(parsed)` (L35), which throws because of `.min(1)` rejection.
4. The catch block at L36-39 silently returns `emptyLog()`.
5. The next `saveFile` call (e.g. from `recordPending`) writes the now-empty log to disk, **erasing the previously persisted records**.

This is data destruction, not just data corruption. The fix isn't just "add write-path parse" (B.F1); it's also "either make `loadFile` fail loudly on parse failure for v0.2+ writers, or add a one-time migration pass that strips/fixes empty-stage records before bumping the parser to strict mode." Personal-single-machine context doesn't soften this — the user's one machine IS the only copy.

**Suggested fix**: Either of:
1. Add a v0.2 migration step in §Migration: scan all `evolution_log.json` files (global + every workspace pending found under known workspaces), reject empty-stage records OR auto-coerce to a sentinel stage, then save. Migration is one-shot and idempotent.
2. Change `loadFile` to bifurcate by intent: a read-only inspector path keeps fail-open-to-empty; the read-then-write path (used by `recordPending` / `recordGlobal` / `promote`) MUST throw on parse failure rather than fall back to empty. This prevents silent erasure.
3. Both (1) + (2) — preferred for v0.2 because `.min(1)` is the first tightening constraint to ever ship and sets a precedent.

Pre-existing risk that this proposal does NOT introduce but DOES amplify: even without `.min(1)`, the silent-fallback-on-corrupt-log pattern is a footgun. v0.2 is the right time to retire it.

### A.F9 (new) — proposal §Migration bullet 2 is factually wrong about current code — [MAJOR]
**Where**: §Migration L181 "aisep-memory: `recordGlobal` / `recordPending` already pass-through to zod parse; `.min(1)` enforced at parse time, no code change needed"

**Issue**: B.F1's fact-check (and my independent re-verification above) shows this claim is false. `recordPending` and `recordGlobal` do NOT pass-through to zod parse on the write path; only the read path (`loadFile`) parses. The proposal's confidence in "no code change needed" is therefore unfounded, and the §Migration text needs correction OR the §Scope must add a fourth in-scope item: "add write-path `AisepMemoryRecordSchema.parse()` in `recordPending` / `recordGlobal` / `promote`."

**Why it matters**: a factually wrong §Migration claim that the user might rely on to skip implementation work would land v0.2 with a broken invariant. R5 cross-review exists specifically to catch this kind of "I assumed the existing code did X" drift. My Phase 1 didn't catch it because my lens trusted the proposal's self-reported code state. B's lens didn't trust it. The methodology lesson: when a proposal says "existing code already does X, no change needed," cross-review MUST verify X by opening the file. (This is itself a candidate for a methodology memory entry.)

**Suggested fix**: rewrite §Migration bullet 2 to:

> **aisep-memory**: `recordGlobal` / `recordPending` / `promote` currently bypass zod-parse on write (only `loadFile` parses on read). Add `AisepMemoryRecordSchema.parse(record)` immediately before each `log.records.push(...)` in store.ts. Without this, `.min(1)` is enforced only on next load — and `loadFile`'s catch-to-empty fallback (L36-39) means a tightening constraint becomes a silent log-erasure vector. Add to §Scope as item 5; this is a code change, not a no-op.

Also bump §Scope to 5 items and update §Migration impact + RISK-Q4-b accordingly.
