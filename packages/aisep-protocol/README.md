# @vessel/aisep-protocol

AISEP v0.1 protocol contracts — wire-format DTOs shared across `aisep-core` /
`aisep-workspace` / `aisep-agents` / `aisep-memory` / `aisep-context` /
`aisep-cli` packages.

> 本文是 wire-format（process ↔ file ↔ network 共享 DTO）的唯一权威。
> Stage / Artifact / Attempt 等内部存储用 snake_case；wire 用 camelCase；转换由
> store 层负责，**不在本包**。

## 命名约定

- 字段 **camelCase**（`createdAt`, `workspaceId`）
- 时间戳 **epoch ms 非负整数**（< 2^53 兼容 JS Number）
- ID **opaque stable string**（推荐 `<type>-<ULID>` 前缀；不强制 UUIDv4）
- 枚举 **小写下划线**（`in_progress`, `pass_with_comments`）
- 可选字段在 wire 上 **完全省略**（不发 `null`）→ Zod `.optional()`
- nullable 字段用显式 `null` → Zod `.nullable()`
- AISEP 专属类型名加 `Aisep` 前缀（如 `AisepRun` / `AisepArtifact`）避免与
  `@vessel/shared` 的 `harness-protocol.ts` 命名冲突

## 跨端 round-trip 不变量

```
TS encode → JSON → TS decode == 原始对象（v0 只验 TS round-trip；
v1+ 加 Swift / Python round-trip 时再扩展）
```

每个 schema 至少 1 个 fixture（`fixtures/aisep/*.json`）覆盖：
- happy path
- 每个枚举值至少出现 1 次（`enum-coverage.test.ts`）
- nullable / optional 字段各覆盖正负 1 例

## 与 `@vessel/shared` 的关系

AISEP 协议**独立**于 `@vessel/shared/harness-protocol`：
- 不复用 `EpochMsSchema` / `ContentHashSchema` 等 helper（v0 阶段红线 R1）
- 不复用枚举（即使有重叠语义，AISEP 用 `Aisep*` 前缀独立定义）
- Phase 2 评估是否抽出共享 base，**v0 接受重复**

## 文件组织

```
src/
├── index.ts          # barrel export
├── version.ts        # AISEP_PROTOCOL_VERSION + MIN_CLIENT_VERSION
├── common.ts         # helper schemas (EpochMs, ContentHash, OpaqueId)
├── stage.ts          # 10 stage enum + StageRun + StageStatus + StagePhase
├── artifact.ts       # AisepArtifact + ArtifactRef + ArtifactKind
├── attempt.ts        # Attempt + AgentInvocation
├── workspace.ts      # WorkspaceMeta schema + Workspace interface
├── requirements.ts   # Requirements (ArchiMate Motivation Layer)
├── memory.ts         # MemoryRecord + AppliesToFilter + EvolutionLogV1
├── review.ts         # ReviewVerdict + Comment + Patch
├── agent.ts          # AgentProfile + AgentCall + ContextBundle
└── trace.ts          # TraceChain + TraceId (REQ→ADR→ZOD→RISK)

fixtures/aisep/       # JSON 示例（≥ 15 个 + README.md）
src/__tests__/        # vitest round-trip + enum coverage + trace orphan
```

## 不变量

详见 [docs/aisep/02_methodology-v0.1.md](../../docs/aisep/02_methodology-v0.1.md)
+ [docs/aisep/03_architecture-stage-spec.md](../../docs/aisep/03_architecture-stage-spec.md)。
本包内核心不变量：

- **M1**: `AisepStageRun.status` 状态机：`pending → running → (succeeded | failed | cancelled)`
- **M2**: `AisepArtifact.contentHash` 一旦写入不可变（artifact freshness 基础）
- **M3**: architecture stage `phaseA` 未通过 → `phaseB` slice 不允许启动
- **M4**: review stage `revise-required` 累计 2 次 → 必须 cut scope
- **M5**: protocol 改动（本包任何 `.ts`）需 ADR + cross-review

## 同源文档

- [ADR-018-aisep-vs-harness](../../docs/adr/vessel/ADR-018-aisep-vs-harness.md)
- [02_methodology-v0.1.md](../../docs/aisep/02_methodology-v0.1.md) — stage 定义
- [03_architecture-stage-spec.md](../../docs/aisep/03_architecture-stage-spec.md) — architecture stage 2-phase
- [04_global-memory-ontology.md](../../docs/aisep/04_global-memory-ontology.md) — MemoryRecord 来源
- [borrowed/newaisep-extraction-plan.md](../../docs/aisep/borrowed/newaisep-extraction-plan.md) — 借鉴清单
