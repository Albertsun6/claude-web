# AISEP Protocol v0.1 — vessel-architect verdict

> Reviewer: vessel-architect (Claude main session, opus-4-7)
> Reviewed at: 2026-05-11
> Proposal: `docs/proposals/aisep-protocol-v0.md`
> Scope: `packages/aisep-protocol/src/*.ts` + `fixtures/aisep/*.json` + `README.md`

## Verdict: **pass_with_comments**

1 critical + 3 major + 5 minor — author can address in ≤ 1 round (M4 ping-pong cap respected).

## Rationale

The 10-stage DAG schema, AlphaEvolve memory model, and trace_id namespace
hold up. Cross-end alignment is solid for v0 (TS-only). Dep-cruiser
correctly enforces R1/R2/R3/R6. Test coverage (39 tests) is adequate.

**However**, 1 critical schema constraint is over-strict (blocks legitimate
retry in non-review stages), and 3 majors are correctness gaps that will
bite once `aisep-core` is implemented. The minors are nits but worth
batching with the critical fix.

## Comments

### Critical (1)

#### C1 — `AisepAttempt.attemptN.max(2)` over-applies M4 red line

- file: `packages/aisep-protocol/src/attempt.ts:52`
- trace_id: ADR-018 (M4 red line)
- severity: **critical**
- comment:
  Per `docs/aisep/02_methodology-v0.1.md §9 (M4)`, the 2-attempt cap
  applies ONLY to `review` stage `revise-required` ping-pong. The current
  schema applies `.max(2)` to ALL attempts across ALL stages — so an
  `implement` stage that legitimately retries 3 times (e.g. flaky test
  rerun, transient network failure) will fail `AisepAttemptSchema.parse()`.
  This is over-strict and contradicts the methodology spec.
- suggested_action: **revise**
  Change line 52 from `z.number().int().min(1).max(2)` to
  `z.number().int().min(1)`. Move the `.max(2)` enforcement to
  `aisep-core` runtime logic, scoped to `stage === "review"`.

### Major (3)

#### M1 — `sliceIndex` / `sliceTotal` lack cross-field validation with `phase`

- file: `packages/aisep-protocol/src/stage.ts:67-69`
- trace_id: ADR-018 (architecture stage 2-phase)
- severity: **major**
- comment:
  Schema allows `phase: "none"` + `sliceIndex: 5` to parse successfully,
  violating the documented invariant that slice fields populate only
  when `phase === "architecture-detail-slice"`. A consumer reading a
  malformed StageRun cannot tell whether it's a bug or a valid edge case.
- suggested_action: **revise**
  Add a `.refine()` post-check: `if phase !== "architecture-detail-slice"
  then sliceIndex && sliceTotal both undefined`. Or upgrade to
  `z.discriminatedUnion("phase", [...])` for stricter typing.

#### M2 — `AisepArtifact.contentInline` has no size cap

- file: `packages/aisep-protocol/src/artifact.ts:67`
- trace_id: ZOD-Artifact
- severity: **major**
- comment:
  README + JSDoc say "≤ 64 KB inline" but the schema allows arbitrary
  strings. A malicious or buggy producer can inline a 10 MB blob and
  pass schema validation, then crash SQLite blob storage or balloon
  prompt context. Size cap belongs in the schema, not just docs.
- suggested_action: **revise**
  Change to `z.string().max(65536).optional()` (64 KiB).

#### M3 — `contentHash` derivation method undefined for inline vs file storage

- file: `packages/aisep-protocol/src/artifact.ts:58`
- trace_id: ZOD-Artifact, M2 invariant
- severity: **major**
- comment:
  Schema requires `contentHash: ContentHashSchema` but doesn't define
  what bytes are hashed: `storage="file"` → sha256(file body)?
  `storage="inline"` → sha256(contentInline) UTF-8 bytes?
  sha256(contentInline) base64? Two implementations may compute different
  hashes for semantically equal content, breaking artifact freshness
  invalidation across runs.
- suggested_action: **revise**
  Add to JSDoc on line 50:
  ```
  contentHash MUST be computed as:
  - storage="file": sha256(file body bytes, UTF-8 if text)
  - storage="inline": sha256(contentInline UTF-8 bytes)
  ```
  Or extract this as a documented helper in `common.ts` (`computeContentHash(...)`).

### Minor (5)

#### m1 — TraceId numeric padding inconsistent

- file: `packages/aisep-protocol/src/common.ts:25` + fixtures
- trace_id: ZOD-TraceId
- severity: **minor**
- comment:
  Fixtures mix `G-1` (1-digit, requirements.json) with `ADR-002` (3-digit,
  trace-chain.json). The `@claude-web/shared/harness-protocol.ts` uses
  4-digit (`ADR-0001`). Inconsistency is mostly cosmetic but complicates
  alphabetic sorting (`ADR-1` < `ADR-10` < `ADR-2`).
- suggested_action: **accept-with-followup**
  Document a convention in `common.ts` JSDoc: "≥ 4-digit zero-padded for
  ADR/REQ/ZOD/RISK; ≥ 1-digit ok for G/D/C/P/S where order matters less".
  Don't add regex enforcement yet (would break existing fixtures).

#### m2 — `AisepWorkspace.exec()` timedOut contract is implicit

- file: `packages/aisep-protocol/src/workspace.ts:43-48`
- trace_id: ADR-018 (R6 boundary)
- severity: **minor**
- comment:
  Interface defines `timeoutMs?: number` and `AisepExecResult.timedOut: boolean`
  but doesn't state the implementation contract: timeout-hit MUST set
  `timedOut=true`. Without this, consumers can't distinguish "command
  ran to completion with exitCode=124" from "killed by timeout".
- suggested_action: **accept-with-followup**
  Add JSDoc on `AisepWorkspace.exec`: "Implementation MUST set
  `timedOut=true` when the kill was triggered by `timeoutMs`; the
  command's natural exit must always have `timedOut=false`."

#### m3 — `AisepAppliesTo.domain "*"` wildcard semantics undefined

- file: `packages/aisep-protocol/src/memory.ts:21`
- trace_id: ZOD-MemoryRecord
- severity: **minor**
- comment:
  Schema accepts `domain: ["*"]` as a normal string, but the wildcard
  semantics ("match any domain") live only in the implementation. A
  future implementer may treat `"*"` as a literal domain name.
- suggested_action: **accept-with-followup**
  Export `export const AISEP_APPLIES_TO_WILDCARD = "*" as const;` from
  `memory.ts` and document the semantics in JSDoc.

#### m4 — No `deprecated`/`deprecatedSince` field on any schema

- file: across `packages/aisep-protocol/src/`
- trace_id: ADR-018 (version bump rules)
- severity: **minor**
- comment:
  Version bump rules in `version.ts` say MINOR is backward-compatible
  additions, MAJOR is breaking. Protocol evolution will eventually
  require deprecating fields (enum values, optional fields). v0 has
  no mechanism to mark them.
- suggested_action: **accept-with-followup**
  Defer to v0.2. Add to "Open questions" / followup list in proposal.

#### m5 — `AISEP_PROTOCOL_VERSION` vs `Aisep*` casing inconsistency

- file: `packages/aisep-protocol/src/version.ts:8` vs `packages/aisep-protocol/src/stage.ts:8`
- trace_id: convention nit
- severity: **minor**
- comment:
  Mixed `AISEP_*` (SCREAMING_SNAKE for constants) and `Aisep*` (PascalCase
  for types) is fine; just flagging for the convention review.
- suggested_action: **drop**
  This is conventional TS naming. No action.

## Heterogeneous lens findings

vessel-architect runs on Claude opus-4-7 — same family as the author.
The following are within-family blindspots and should be probed by
**reviewer-cross** (cursor-agent gpt-5.5-medium):

1. **Post-training-cutoff developments** — Is zod 3.23.8 still the right
   choice in 2026-05? zod 4 / valibot / arktype tradeoffs?
2. **Non-Anthropic ecosystem alignment** — Should `AisepAttempt.invocation.cmd`
   support non-Claude invocations (codex, gemini-cli, ollama-coder) by
   protocol design, or is the current string-based approach already
   neutral enough?
3. **MCP / AG-UI compatibility** — Are there existing protocols AISEP
   v0.1 should interop with?
4. **10-stage "mainstream"** — Is 10-stage the current consensus, or has
   industry moved on (e.g. spec → plan → execute 3-stage simplification)?

These are NOT critiqued here — left for reviewer-cross.

## Counter-design suggestions (not blocking)

- **Workspace interface might want a `glob()` method** in v0.1 if pattern
  matching is needed often. Not blocking — can add in v0.2 without
  breaking changes.
- **TraceId enum might benefit from `FIX-xxx` namespace** to reference
  AlphaEvolve memory records. Currently memory records use OpaqueId.
  Defer to Phase 2 where memory retrieval flows are exercised.
