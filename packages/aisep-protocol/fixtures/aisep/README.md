# AISEP protocol fixtures

JSON fixtures for `@vessel/aisep-protocol` round-trip + enum coverage tests.

## File naming

- `<schema-base>.json` — single instance per schema
- `<schema-base>-<variant>.json` — multi-instance schemas (e.g. enum coverage)

## Coverage matrix (v0.1)

| Schema | Files | Coverage notes |
|--------|-------|----------------|
| `AisepStageRun` | `stage-run-pending`, `stage-run-running-architecture-brief`, `stage-run-succeeded-architecture-detail-slice`, `stage-run-skipped`, `stage-run-failed`, `stage-run-cancelled` | All 6 `AisepStageStatus` values covered; `phase=architecture-brief` and `phase=architecture-detail-slice` both present; `sliceIndex/sliceTotal` populated in slice fixture |
| `AisepArtifact` | `artifact-file`, `artifact-inline` | Both `storage` values; `contentInline` optional field tested |
| `AisepAttempt` | `attempt-succeeded`, `attempt-failed-revise` | `attemptN=1` and `attemptN=2`; `reviewState=approved` and `reviewState=fact_checked`; `succeeded` + `failed` status |
| `AisepWorkspaceMeta` | `workspace-meta` | `status=active`; `adoptedPatterns` non-empty |
| `AisepRequirements` | `requirements` | All 6 element types covered; `successCriteria` optional field exercised |
| `AisepMemoryRecord` | `memory-record-workspace-pending`, `memory-record-global-verified` | Both `source` values; `verifiedBy=human` and `verifiedBy=auto`; wildcard `["*"]` and concrete `["erp"]` in appliesTo |
| `AisepAgentCall` | `agent-call-architect`, `agent-call-coder` | `profile=architect` and `profile=coder`; with and without memoryHits |
| `AisepContextBundle` | `context-bundle` | history populated; standalone usage |
| `AisepReviewVerdict` | `review-verdict-pass`, `review-verdict-pass-with-comments`, `review-verdict-revise-required` | All 3 `verdict` values; severities `critical/minor`; actions `revise/accept-with-followup`; reviewers `vessel-architect` + `reviewer-cross` |
| `AisepTraceFile` | `trace-chain` | 2 chains; empty `orphans` (Phase A passing state) |

## Missing enum values (NOT covered by current fixtures — to be added in Phase 1.4)

- `AisepReviewerKind`: `vessel-pragmatist`, `human` (only 2/4 covered)
- `AisepAttemptStatus`: `running`, `timeout`, `cancelled` (only 2/5 covered)
- `AisepAgentProfile`: `ba`, `reviewer`, `tester` (only 2/5 covered)
- `AisepArtifactKind`: missing 10+ kinds (only 3/15 covered)
- `AisepCommentSeverity`: `major` (only 2/3 covered)
- `AisepCommentAction`: `drop` (only 2/3 covered)
- `AisepWorkspaceStatus`: `archived` (only 1/2 covered)

The `enum-coverage.test.ts` test enumerates these and fails if any value
is missing — driver for Phase 1.4 fixture expansion.

## Round-trip invariant

```
JSON file → JSON.parse → zod schema.parse → JSON.stringify → re-parse == original
```

Tested by `src/__tests__/protocol-round-trip.test.ts`.
