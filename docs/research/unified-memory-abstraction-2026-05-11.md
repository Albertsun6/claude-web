# Research: Unified Memory Abstraction for Vessel + AISEP

> Date: 2026-05-11
> Method: /survey Deep + hetero + strict (Agent A Claude + Agent B Claude reverse-lens + cursor-agent gpt-5.5-medium)
> Question: Should vessel memory and AISEP memory share a unified abstraction (schema / API / retrieval semantics) but keep independent stores?
> Decision: **B (revised) — defer thin protocol to v0.2; trust boundary as permanent red line**

## Context

Two memory systems exist:

- **Vessel memory** (shipped on feat/eva-M2-loop7-ci-e2e):
  - `MemoryKind = note/fact/episode/preference` + `LessonKind = review_closeout/bug_lesson/decision/risk/spike`
  - SQLite + sqlite-vec + bge-small-zh-v1.5 (512-dim embedding) + KNN
  - Files: `packages/backend/src/memory/{embedder,lesson-store,memory-store,session-store,workflow-store}.ts`
  - HTTP API `/api/vessel/memory`
  - Serves: user dialogue with Eva
- **AISEP memory** (Phase 2 planned):
  - `AisepMemoryRecord = { stage, failurePattern, fix, source, appliesTo: {domain,stage,techStack}, shipCount, promoteCount }`
  - JSON files: `<workspace>/.aisep/evolution_log.json` + `~/.aisep/governance-log/evolution_log.json`
  - Serves: AISEP agent's stage-chain failure → fix experience

User question: unified abstraction (same schema/API/retrieval semantics) but separate stores — is this better?

## Three-way reviewer verdicts

### Agent A (Claude main-session lens) — **Plan B**

Industry framework survey: mem0 / LangChain / Letta / Zep / Continue / Cursor / Claude Memory.

Key finding: **mem0** (github.com/mem0ai/mem0) is industrial-grade reference for the "unified API + pluggable store" pattern. 24+ vector stores swappable, 4 orthogonal slots (vector / graph / history / embedder), schema decided by user metadata not framework.

Recommendation: Extract `MemoryStore<TMetadata>` generic interface + `add/search/get/update` + KNN top-K + metadata filter. Vessel/AISEP each parameterize their own business fields.

**Anti-pattern**: LangChain 1.0 cut BaseMemory — classic premature-abstraction failure case.

### Agent B (Claude reverse lens: cognitive arch + DDD) — **Plan A (status quo)**

**DDD bounded context**: vessel's "episode" ≠ AISEP's "episode" (same word, different entities — Evans Ch.14 split signal). Variance rhythm differs (vessel yearly, AISEP weekly/monthly) → shared kernel becomes hostage to slower side. Recommended pattern: **Separate Ways + Anti-Corruption Layer**.

**Cognitive architecture**: 60-year consensus that multi-store models (Atkinson-Shiffrin / Tulving episodic vs semantic / Soar / ACT-R) hold up. Clinical double-dissociation evidence (Clive Wearing, Alzheimer's) shows physical independence. Memory is not just "rows in a table" — it's "how they're read/written" — different semantics shouldn't share storage abstraction.

**AI safety硬 constraint**: [MINJA 2025 arXiv:2503.03704](https://arxiv.org/abs/2503.03704) + Palo Alto Unit 42 indirect prompt injection memory-poisoning: 98.2% success rate when different trust levels coexist in same memory store. Vessel memory source = user (high trust); AISEP memory source = stage run trace (includes tool output, potentially poisoned) → **trust boundary must be physically isolated**.

**Sandi Metz "Wrong Abstraction" (2016)**: Vessel/AISEP both in fast-schema-change phase. Unifying now = imposing coupling in two uncertain directions. "Fastest way forward is back" — let duplication live longer; let the right abstraction emerge.

### cursor-agent (heterogeneous lens, gpt-5.5-medium) — **Plan B (4.4/5), but adopts all Agent B warnings**

Tiebreaker. Validates mem0 trend but adopts the Agent B concerns:

> "Industry trend is NOT 'one memory table for everything', but 'unified minimum interface, multiple stores behind it'. mem0's core value is `add/search/update/delete/history` — packing extraction/embedding/vector store/graph store. But it does **not** require business memories to share schema."

Three-step path: (1) extract `memory-protocol` (TS types + fixtures only, no backend/aisep deps); (2) vessel adapter wraps existing `/api/vessel/memory` without migrating tables; (3) AISEP Phase 2 ships JSON store adapter; reevaluate adding embedding once `shipCount/promoteCount` data accumulates.

## Scoring matrix

| 方案 | 解耦 | 数据隔离 | 演化弹性 | 心智复杂度 | 迁移成本 | AI safety | 总分 |
|------|----:|--------:|--------:|----------:|--------:|---------:|----:|
| A 完全独立 (status quo) | 5 | 5 | 5 | 3 | 5 | 5 | **28** |
| **B thin protocol + 独立 store** ✅ | 4 | 5 | 4 | 4 | 4 | 5 | **26** |
| C 共享 store + namespace | 2 | 3 | 2 | 2 | 2 | 1 | 12 |
| D 完全统一 | 1 | 2 | 1 | 2 | 1 | 1 | 8 |

A scores higher on raw points but B is recommended for **future-value** when vessel↔AISEP cross-store queries become real (v1+). B has the abstraction base ready; A would build it from scratch.

## Final decision: **B (revised)**

### Phase 2 (unchanged, ships as planned)

- AISEP memory v0 ships as planned: `<workspace>/.aisep/evolution_log.json` + `~/.aisep/governance-log/evolution_log.json`
- Vessel memory remains untouched (SQLite + sqlite-vec + bge-small-zh-v1.5)
- Both run as fully independent stores for ≥ 6 months, letting schemas stabilize naturally
- **NO `memory-protocol` package extracted in Phase 2** — defer to v0.2

### v0.2 evaluation (~6 months out)

Trigger conditions (all 3 should hold before extracting):
- AISEP `shipCount` / `promoteCount` data ≥ 50 records — signal AISEP schema has stabilized
- ≥ 1 real use case where vessel needs to query AISEP memory or vice versa
- Both vessel and AISEP have had ≥ 2 schema-stable releases (no breaking change for 1+ month)

If all 3 hold: extract `packages/memory-protocol/` (separate package, **NOT** inside `@claude-web/shared`):

```typescript
// packages/memory-protocol/src/index.ts (sketch for v0.2 only)

export interface MemoryQuery {
  text?: string;
  filter?: Record<string, unknown>;
  topK?: number;
}

export interface MemoryHit<TRecord> {
  record: TRecord;
  score?: number;
  source: 'vessel' | 'aisep' | string;   // trust boundary marker
}

export interface MemoryStore<TRecord, TQuery extends MemoryQuery = MemoryQuery> {
  retrieve(q: TQuery): Promise<MemoryHit<TRecord>[]>;
  append(record: TRecord): Promise<void>;
}
```

NOT in v0.2 interface:
- ❌ Business schema (`MemoryKind`, `LessonKind`, `AisepMemoryRecord`)
- ❌ Embedding fields (vessel uses bge-512, AISEP may not)
- ❌ `update` / `delete` (yagni)
- ❌ Retrieval algorithm assumptions (KNN vs text-match)

## Permanent red line (R11): trust boundary

Even if v0.2 extracts `memory-protocol`, the following are PERMANENT red lines (no version can lift them):

1. **No shared SQLite file**: vessel store lives in backend process; AISEP store lives in `~/.aisep/` and workspace local
2. **No shared retrieval index**: vessel retrieve queries vessel store only; AISEP retrieve queries AISEP store only
3. **No implicit cross-store union**: if cross-store data is needed, write explicit dual-call + explicit join logic (visible in code)
4. **`MemoryHit.source` is mandatory** for any future protocol — every memory hit must carry its provenance for downstream trust evaluation
5. **No mixing user-authored and agent-observed content** in any single retrieval result set

Rationale: [MINJA 2025 arXiv:2503.03704](https://arxiv.org/abs/2503.03704) demonstrates 98.2% memory poisoning success rate when trust levels coexist. Palo Alto Unit 42: persistent agent memory must be physically isolated by trust boundary.

## Sources (8)

- [mem0](https://github.com/mem0ai/mem0) + [docs.mem0.ai](https://docs.mem0.ai) — industrial pluggable store reference
- [LangChain Memory Migration](https://python.langchain.com/docs/versions/migrating_memory/) — BaseMemory removed in v1.0, premature abstraction warning
- [Letta docs](https://docs.letta.com) — multi-tier memory (core/recall/archival), independent APIs per tier
- [Zep / Graphiti](https://github.com/getzep/graphiti) — opinionated temporal graph (rejected for AISEP)
- [Sandi Metz "The Wrong Abstraction" 2016](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction)
- [MINJA Memory Injection arXiv:2503.03704](https://arxiv.org/abs/2503.03704) — 98.2% memory poisoning success rate
- [Palo Alto Unit 42 indirect prompt injection memory poisoning](https://unit42.paloaltonetworks.com/indirect-prompt-injection-poisons-ai-longterm-memory/)
- [Tulving 1972 episodic vs semantic memory](https://psycnet.apa.org/record/1972-28209-001)
- [Soar Cognitive Architecture — Laird 2022 arXiv:2205.03854](https://arxiv.org/abs/2205.03854)
- [DDD Bounded Context Mapping](https://contextmapper.org/docs/shared-kernel/) — Separate Ways + Anti-Corruption Layer
