# ADR-010: 文档目录组织（docs/ 顶层 + Diátaxis 引导）

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: docs, methodology
- **Tier**: 2
- **Implementation status**: 已生效（plan v5.2 起 + 0-meta-lite 起搬迁）

## Context

Vessel 文档量大（plan / ADR / spike report / review verdict / inbox / RISKS / EVA_INVENTORY / 等），需要清晰目录组织。

参考：
- Linux kernel `Documentation/` 子目录分类（admin-guide / dev-guide / process）
- [Diátaxis](https://diataxis.fr/) 4 象限（tutorial / how-to / reference / explanation）
- [ADR](https://adr.github.io/) 标准模板

## Decision

`docs/` 顶层目录与 `packages/` 工程代码完全分开：

```
docs/
├── architecture/                   # ARCHITECTURE.md（reference）+ CONCEPTS.md（explanation）
├── design/                         # REQUIREMENTS / FRAMEWORK / RISKS / spec
├── roadmap/                        # ROADMAP
├── adr/
│   ├── README.md                   # ADR 索引 + supersede 矩阵
│   ├── eva-legacy/                 # Eva 旧 ADR（不 renumber，保留作历史证据）
│   └── vessel/                     # Vessel 新 ADR（000-017+）
├── reviews/                        # debate-review verdict 历史
├── research/                       # spike report（Phase 0 调研产出）
├── notes/                          # 活文档（REFERENCES / IDEAS / EVA_INVENTORY）
├── legal/                          # THIRD_PARTY_LICENSE_LOG（v0-pre 加）
├── security/                       # SECRETS_AND_TEST_TOKENS_LOG（v0-pre 加）
├── demos/                          # e2e demo 录屏（asciinema）
└── how-to/                         # tutorial / how-to（后期补，Diátaxis 缺失象限）
```

## 关键规则

1. **plan 文件不在 docs/**：`/Users/yongqian/.claude/plans/playful-inventing-conway.md` 是 Claude harness 路径，不放仓库
2. **Eva 旧 ADR 不 renumber**（按 v5.1 评审）：保留原编号作历史证据；ADR README 加 supersede 矩阵
3. **Diátaxis 4 象限**：
   - reference → architecture/
   - explanation → architecture/CONCEPTS + design/
   - how-to → how-to/（缺，后期补）
   - tutorial → demos/ + how-to/（缺）
4. **活文档**（持续维护）放 notes/：REFERENCES / IDEAS / EVA_INVENTORY

## Consequences

- ✅ 跨 milestone 文档不爆炸（按类型分目录）
- ✅ owner 找文档有结构（不用 grep -r）
- ✅ ADR 共存策略清晰（eva-legacy/ vs vessel/）
- ⚠️ how-to/ + demos/ 目前空 → v0.1 release 前补（不阻塞 M0–M2）

## Prior Art

- Linux kernel Documentation/
- Rust mdBook
- Apache project 文档目录
