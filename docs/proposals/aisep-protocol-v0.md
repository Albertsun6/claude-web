# Proposal: AISEP Protocol v0.1 (Phase 1 contract)

> Status: Draft for cross-review (2 reviewers)
> Mode: `contract` (per `harness-review-workflow` skill conventions)
> Branch / commit: `feat/aisep-bootstrap` @ `4e829be`
> Reviewers: vessel-architect (Claude main session) + reviewer-cross (cursor-agent gpt-5.5-medium)

## 1. Summary

This proposal asks reviewers to validate the AISEP v0.1 wire-format protocol
shipped in `packages/aisep-protocol/`. The protocol formalizes:

- 10-stage AISEP methodology DAG (intake → research → plan → architecture →
  contract → implement → verify → review → integrate → retrospect)
- architecture stage internal 2-phase + incremental slice design
- AlphaEvolve 2-tier memory model (workspace pending → global verified)
- ArchiMate Motivation Layer requirements.yaml schema
- TraceChain (REQ → ADR → ZOD → RISK) for machine-verifiable lineage
- Review verdict model with mandatory trace_id binding (anti-vague-vibes)

All schemas use zod 3.x with `Aisep*` namespace prefix to avoid collision with
`@claude-web/shared/harness-protocol.ts`.

## 2. Reviewer instructions

### 2.1 Reviewer roles

- **vessel-architect** (Claude main session) — overall architecture coherence,
  cross-end alignment, AISEP scope creep risk, naming consistency
- **reviewer-cross** (cursor-agent gpt-5.5-medium, plan mode) — heterogeneous
  lens: collective blindspot detection, non-Anthropic ecosystem alternatives,
  zod-specific footguns, post-training-cutoff developments

### 2.2 Ping-pong cap

≤ 2 rounds (M4 red line). Round 3 = cut scope, not third revise.

### 2.3 Logic-only focus (Anthropic Code Review 2026-03)

Reviewers do NOT comment on:
- style / grammar / typos in code comments
- documentation completeness (each section "could be more detailed")
- naming bikeshedding without correctness impact

Reviewers DO comment on:
- correctness of zod schema shapes
- whether 7-question anchor gate is satisfied
- whether trace_id chains are complete (no orphans)
- non-obvious counter-design options ignored

### 2.4 Comment format (R5 of the Phase 1 plan)

Every comment MUST bind to `(artifact, trace_id, severity, suggestedAction)`.
Vague feedback like "I feel the overall direction is off" will be rejected
without addressing.

## 3. 7-question anchor gate (Phase A LCA equivalent)

| # | Question | Answer |
|---|----------|--------|
| Q1 | **Data model** — core entities frozen? | YES. 11 zod schemas (Stage / Phase / Status / Run / Artifact / ArtifactKind / Attempt / WorkspaceMeta / Requirements / Memory / Review / Trace) defined with strict typing + tuple enums. Round-trip tested across 22 fixtures. |
| Q2 | **Protocol** — wire format frozen? | YES. JSON over file/stdio/SQLite. camelCase fields, epoch ms timestamps, opaque IDs, `sha256:<hex>` content hashes. `AISEP_PROTOCOL_VERSION = "0.1.0"` + `MIN_CLIENT_VERSION = "0.1.0"`. Bump rules documented in `version.ts`. |
| Q3 | **Compatibility** — vessel mainline invariants intact? | YES. R1/R2/R3/R4/R6 all enforced by `.dependency-cruiser.cjs`. Verified empirically: `pnpm test:protocol` (123/123 pass), `pnpm dep-cruiser:check` (138 modules, 0 violations), main vessel worktree has zero modified files. |
| Q4 | **Irreversible decisions** — listed with rollback plans? | YES, see §4 below. |
| Q5 | **Permissions** — fs / net / spawn boundary clear? | YES. `AisepWorkspace` interface is the ONLY surface for fs/exec; `aisep-core` MUST NOT import `aisep-workspace` (R6, enforced by dep-cruiser). `aisep-protocol` itself has zero side-effect surface (pure DTOs + interface declaration). |
| Q6 | **Resource contention** — concurrency / lockfile / SQLite covered? | **DEFERRED TO STORE LAYER (Phase 2)**. The protocol intentionally has no `lockHolder` / `leaseExpiresAt` / `writerId` fields — single-writer-per-stage_run is a store-layer invariant enforced by SQLite unique indices + advisory file locks in `aisep-core`. **This means Q6 anchor gate is NOT satisfied by aisep-protocol alone**; Phase 2 must deliver the store invariant before architecture stage Phase A of any production workspace can ship. |
| Q7 | **Rollback** — failure recovery path? | YES. (a) `AisepAttempt.attemptN ≤ 2` enforces ping-pong cap. (b) `AisepArtifact.contentHash` immutability enables LKG snapshot freshness check. (c) `AisepStageRun.status` includes `cancelled` for explicit user-aborted runs. (d) self-host fallback (golden snapshot via git tag + `aisep --bypass` flag) lives outside this protocol package (aisep-cli concern). |

## 4. Irreversible decisions (require ADR if revised)

| # | Decision | Migration cost if revised |
|---|----------|---------------------------|
| 1 | Package namespace `@claude-web/aisep-protocol` (matches dev branch convention) | Renaming impacts N import paths but mechanical |
| 2 | `Aisep*` type prefix to avoid collision with `@claude-web/shared/harness-protocol` | Mechanical rename |
| 3 | 10-stage enum frozen at v0.1 (`intake / research / plan / architecture / contract / implement / verify / review / integrate / retrospect`) | Adding stages = MINOR bump; removing/renaming = MAJOR bump |
| 4 | architecture stage 2-phase + incremental slice (in `AisepStagePhase` enum) | Phase A/B split is in wire enum — refactoring to V-Model 2-stage would require schema migration |
| 5 | camelCase wire format (vs harness-protocol's existing convention) | Locked for v0.1; cross-end (Swift) round-trip will need to keep this |
| 6 | `AisepAttempt.attemptN ≤ 2` hard cap | Lifting this requires reasoning about anti-sycophancy regression risk |
| 7 | TraceId namespace `^(REQ|ADR|ZOD|RISK|G|D|C|P|S)-` regex | Adding namespace = MINOR; changing existing = MAJOR |
| 8 | `AisepArtifactKind` 15-value enum | Adding kinds = MINOR; renaming = MAJOR |
| 9 | `AisepWorkspace` is a TS interface (NOT a wire DTO) | Promoting to wire DTO would mean implementing serialization for `exec()` results, which is complex; keep as runtime interface |
| 10 | zod 3.x dependency pinned for v0.1; v0.2 will reevaluate zod 4 for JSON Schema export / metadata registry / improved error format | Major zod version bumps may require fixture regeneration |

## 5. Cross-end compatibility matrix (v0.1)

| Direction | Status | Notes |
|-----------|--------|-------|
| TS → JSON → TS round-trip | ✅ Verified (22 fixtures) | `protocol-round-trip.test.ts` |
| TS → JSON → Swift round-trip | ⏳ N/A in v0 (no Swift consumer) | Reserved for v2 (iOS AISEP UI) |
| TS → JSON → Python round-trip | ⏳ N/A | newaisep-borrowed code lives in `~/.aisep/reference-library/`, not in the protocol path |
| Schema → JSON Schema export | ⏳ Phase 2 deliverable | Will use zod-to-json-schema |

## 6. Heterogeneous review focus (reviewer-cross specifically)

reviewer-cross should explicitly probe for the four Claude blindspots:

1. **Post-training-cutoff developments**: Are there zod 4.x patterns or
   alternative validation libraries (valibot, arktype, etc.) that would
   substantially improve the schema authoring experience? If yes, is it worth
   migrating from zod 3?
2. **Non-Anthropic ecosystem alternatives**: Are there established AI agent
   orchestration protocols (e.g. AG-UI, MCP server schemas, OpenAI Agents
   SDK message formats) that AISEP should align with for interop?
3. **Mainstream-definition drift**: Has the "standard" AI coding harness
   architecture shifted in 2025-2026 in a way that makes the 10-stage DAG
   look dated?
4. **Niche-mature designs**: Are there academic SDLC papers (ICSE / FSE /
   TSE 2024-2026) describing wire formats that anticipate problems AISEP
   v0.1 hasn't addressed?

## 7. Out-of-scope (NOT for review in this round)

- `aisep-core` / `aisep-workspace` / `aisep-agents` / `aisep-memory` /
  `aisep-context` / `aisep-cli` (Phase 2)
- SQLite DDL (Phase 2; spec drafted in `docs/aisep/02_methodology-v0.1.md §5`)
- Pilot bug-fix workflow (Phase 3)
- newaisep Odoo pattern migration to `~/.aisep/reference-library/`
  (separate Phase, tracked in `docs/aisep/borrowed/newaisep-extraction-plan.md`)
- ADR-018 itself (already committed in Phase 0; not in this proposal)

## 8. Acceptance criteria

Reviewers should issue a verdict from `pass / pass_with_comments /
revise_required`:

- **pass**: zero critical+major comments, ≤ 5 minor comments → merge as-is
- **pass_with_comments**: ≤ 1 critical OR ≤ 5 major comments AND author can
  address in ≤ 1 round → merge after author updates
- **revise_required**: ≥ 2 critical OR > 5 major OR fundamental design flaw
  identified → author revises and re-submits (second round = last per M4)

Author (Claude in main session) will record arbitration verdicts in
`docs/proposals/aisep-protocol-v0-arbitration.md` using `accept / partial /
reject` matrix.

## 9. Pointer for reviewers

- Code: `packages/aisep-protocol/src/`
- Fixtures: `packages/aisep-protocol/fixtures/aisep/` (21 files)
- Tests: `packages/aisep-protocol/src/__tests__/` (39 tests, all passing)
- README: `packages/aisep-protocol/README.md`
- Plan (source of truth): `~/.claude/plans/ai-vessel-vessel-bubbly-noodle.md`
  §"Phase 1: 协议骨架 + cross-review"
- ADR-018: `docs/adr/vessel/ADR-018-aisep-vs-harness.md`
- Methodology: `docs/aisep/02_methodology-v0.1.md`
- Architecture stage spec: `docs/aisep/03_architecture-stage-spec.md`
- Memory ontology: `docs/aisep/04_global-memory-ontology.md`
- newaisep extraction: `docs/aisep/borrowed/newaisep-extraction-plan.md`
