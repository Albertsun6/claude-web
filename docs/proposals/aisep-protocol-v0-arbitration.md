# AISEP Protocol v0.1 — author arbitration verdict (Round 1 closing)

> Author: Claude opus-4-7 (main session)
> Arbitration date: 2026-05-11
> Proposal: `docs/proposals/aisep-protocol-v0.md`
> Round-1 reviewers' verdicts:
> - `docs/proposals/aisep-protocol-v0-verdict-vessel-architect.md` — **pass_with_comments** (1C / 3M / 5m)
> - `/tmp/aisep-protocol-v0-reviewer-cross-output.md` — **revise_required** (2C / 7M / 2m)
> Round-2 commit: see git log after this doc lands.

## Combined verdict: **revise_required** → addressed in Round-2 commit (no Round-3 per M4)

reviewer-cross's `revise_required` dominates per plan §"Acceptance criteria"
threshold (≥ 2 critical OR > 5 major → revise_required). Round-2 fix
addresses 100% of accepted comments. M4 ping-pong cap (≤ 2 rounds) means
no Round-3 cross-review; protocol ships as v0.1 with Round-2 commit.

## Arbitration matrix

| # | Comment source | Severity | Author verdict | Fix in Round-2 |
|---|----------------|----------|----------------|-----------------|
| C1 | vessel + cross (both critical) | critical | **accept** | `attempt.ts`: remove `.max(2)` from `attemptN`; runtime enforcement moves to `aisep-core` review-stage logic (Phase 2). |
| cross-C1 | cross | critical | **accept** | `artifact.ts`: `AisepArtifactSchema` is now `z.discriminatedUnion("storage", [...])` with `.strict()` on each variant; inline body capped at `AISEP_ARTIFACT_INLINE_MAX_BYTES = 65536`. |
| M1 / cross-M5 | vessel + cross (both major) | major | **accept** | `stage.ts`: `AisepStageRunSchema` is now `z.discriminatedUnion("phase", [...])` with `.strict()` — slice fields can only appear (and MUST appear) when `phase === "architecture-detail-slice"`. |
| M2 | vessel | major | **accept** (merged into cross-C1) | covered by inline `.max(65536)` |
| M3 | vessel | major | **accept** | `artifact.ts` JSDoc on `contentHash` documents file vs inline derivation explicitly. |
| cross-M3 | cross | major | **accept (partial)** | `attempt.ts`: `AisepAgentInvocation` split into provider-neutral envelope `{provider, model, argv, cwd, rawCmd?, promptHash}`. `provider` is a new enum (`claude-cli / cursor-agent / codex / gemini-cli / ollama / other`). `rawCmd` kept as forensic-audit-only string. |
| cross-M4 | cross | major | **accept (partial)** | `attempt.ts` JSDoc on `promptHash` specifies canonical computation (Handlebars render → context merge in documented order → UTF-8 bytes → sha256). The exact rendering algorithm is a Phase 2 reference impl deliverable in `aisep-agents/src/prompt-compiler.ts`. |
| cross-M5 | cross | major | **accept** | Proposal §3 Q6 wording downgraded: "Q6 anchor gate is NOT satisfied by aisep-protocol alone; Phase 2 must deliver the store invariant before architecture stage Phase A of any production workspace can ship." No `lockHolder` field added — single-writer remains store-layer invariant. |
| cross-M6 | cross | major | **accept** | `common.ts`: `TraceIdSchema` regex extended to `^(REQ\|ADR\|ZOD\|RISK\|FIX\|TEST\|G\|D\|C\|P\|S)-`. |
| cross-M7 | cross | major | **accept (partial)** | `agent.ts`: `AisepAgentProfile` enum value `ba` renamed to `planner` (industry-standard term). Other 4 profiles (`architect / coder / reviewer / tester`) kept — they already align with OpenHands / SWE-agent / Cursor / CrewAI conventions. |
| vessel-m1 | vessel | minor | **accept-with-followup** | `common.ts` JSDoc documents padding convention; no regex enforcement (preserves existing fixtures). |
| vessel-m2 | vessel | minor | **accept** | `workspace.ts` JSDoc on `AisepWorkspace.exec` mandates `timedOut=true` iff killed by `timeoutMs`. |
| vessel-m3 | vessel | minor | **accept** | `memory.ts` exports `AISEP_APPLIES_TO_WILDCARD = "*" as const` + JSDoc on semantics. |
| vessel-m4 | vessel | minor | **defer to v0.2** | `version.ts` JSDoc records this as a v0.2 followup. |
| vessel-m5 | vessel | minor | **drop** | Conventional TS naming (SCREAMING_SNAKE constants vs PascalCase types) — no action. |
| cross-minor-1 | cross | minor | **accept** | Proposal §4 #10 reworded: "zod 3.x dependency pinned for v0.1; v0.2 will reevaluate zod 4 for JSON Schema export / metadata registry / improved error format". |
| cross-minor-2 | cross | minor | **accept (partial)** | `review.ts`: `AisepReviewVerdict` now has optional `reviewerId: OpaqueIdSchema.optional()` + `model: z.string().optional()`. `AisepReviewerKind` enum kept (verdict-level branching) — adding new reviewers does NOT require enum bump anymore. |

**Total**: 14 accepted (full or partial) / 1 followup / 1 deferred / 1 dropped. Zero rejected.

## Round-2 change surface (verified)

### Schema files modified (8)
- `packages/aisep-protocol/src/attempt.ts` — provider-neutral invocation, attemptN cap removed, promptHash JSDoc
- `packages/aisep-protocol/src/artifact.ts` — discriminated union on storage, inline cap, contentHash derivation doc
- `packages/aisep-protocol/src/stage.ts` — discriminated union on phase, slice fields strict to slice variant
- `packages/aisep-protocol/src/agent.ts` — `ba` → `planner`
- `packages/aisep-protocol/src/review.ts` — added optional `reviewerId` + `model`
- `packages/aisep-protocol/src/common.ts` — TraceId namespace +FIX +TEST, padding convention JSDoc
- `packages/aisep-protocol/src/memory.ts` — exported `AISEP_APPLIES_TO_WILDCARD`
- `packages/aisep-protocol/src/workspace.ts` — `timedOut` implementation contract JSDoc
- `packages/aisep-protocol/src/version.ts` — v0.2 followup note

### Fixtures modified (2)
- `attempt-succeeded.json` — invocation provider-neutral envelope
- `attempt-failed-revise.json` — invocation provider-neutral envelope (cursor-agent)

### Tests added (1 file, 20 negative-case tests)
- `src/__tests__/round-2-fixes.test.ts`

### Proposal modified
- `docs/proposals/aisep-protocol-v0.md` §3 Q6 (single-writer downgrade) + §4 #10 (zod 4 wording)

## Verification (Round-2 closing)

| Gate | Result |
|------|--------|
| `pnpm --filter @claude-web/aisep-protocol exec tsc --noEmit` | ✅ Clean compile |
| `pnpm --filter @claude-web/aisep-protocol test` | ✅ **59 tests pass** (22 round-trip + 13 enum-coverage + 4 trace-chain + 20 round-2-fixes) |
| `pnpm dep-cruiser:check` | ✅ **0 violations** (139 modules, 234 deps) |
| `pnpm test:protocol` (vessel `@claude-web/shared`) | ✅ **123/123 pass** — R3 invariant preserved |
| vessel mainline `/Users/yongqian/Desktop/Vessel` working tree | ✅ Unchanged (only Finder copy noise, no modified files) |

## Open followups (Phase 2+ or v0.2)

1. **vessel-m4 (deprecation field)** — v0.2.
2. **vessel-m1 (TraceId padding regex enforcement)** — v0.2 if a tightening migration is judged worth it.
3. **Reference implementation of canonical `promptHash` rendering** — `aisep-agents/src/prompt-compiler.ts` in Phase 2.
4. **Store-layer single-writer invariant for stage_run** — `aisep-core` Phase 2 (SQLite unique index + advisory file lock).
5. **Negative-case fixtures for the remaining enum values flagged by `enum-coverage.test.ts`** (`vessel-pragmatist`, `archived`, `major` severity, `drop` action, `planner / reviewer / tester` profiles, `timeout` attempt status, `trace / patch / review_verdict / integration_log / retrospect` artifact kinds) — v0.2 will tighten enum-coverage threshold from "≥ 1 covered" to "100% covered".

Round-1 cross-review closes here. Next milestone: Phase 2 core skeleton implementation.
