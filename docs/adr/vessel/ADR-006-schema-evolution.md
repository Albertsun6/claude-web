# ADR-006: Schema 演进策略

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: schema, migration, sqlite
- **Tier**: 2

## Context

Vessel 多个文件 / 数据库 schema 会演进：
- `soul.md` YAML frontmatter（M2-Soul 起）
- `App Manifest` YAML（M0.5 起）
- SQLite tables（沿用 Eva v102 + 加 0004/0005/0006/0007 migration）
- `~/.vessel/config.toml`（按 ADR-008）

跨 milestone 演进需要保 backward compat（owner 在不同机器跑不同 milestone）+ 防破坏（4 类硬触发 #8）。

## Decision

### 5 条原则

1. **每个 schema 顶部加 `schemaVersion`**（int 或 semver）
   - YAML 文件顶部 frontmatter
   - SQLite：`PRAGMA user_version` + `schema_migrations` 表
   - TS 接口：`schemaVersion` 字段

2. **migrations/ 目录顺序文件**（沿用 Eva pattern）
   - `packages/backend/src/migrations/<NNNN>_<name>.sql`
   - 启动时检测 user_version → 跑后续 migration → 升 user_version

3. **每个 migration 一个 milestone**（v0-pre cursor M2 finding）
   - `0004_workflow_state.sql`（v103）M1C-A
   - `0005_embedding.sql`（v104）M1C-B
   - `0006_soul_history.sql`（v105）M2-Soul
   - `0007_capability.sql`（v106）M2+
   - **不**重复填同一 user_version

4. **deprecated 字段保留 ≥ 1 个 minor 版本**（按 semver）+ deprecation warning log
5. **breaking change 仅跨 major**（v1.x → v2.0）+ 必须有 migration 脚本

### 禁止操作（4 类硬触发 #8）

- ❌ DROP COLUMN（Eva v0.4.5 教训：FK off rebuild 复杂 + 数据丢失风险）
- ❌ DROP TABLE
- ❌ DROP INDEX（除非 useless 且 ADR 显式说明）

如必须 drop → owner 显式 escalation + 手动 review schema diff（ADR-014 §「硬触发 #8」）。

### Eva → Vessel 一次性迁移

按 EVA_TO_VESSEL_MAPPING §2：复制 ~/.claude-web/ → ~/.vessel/（不删源）。仅一次性，不算 ongoing schema migration。

## Consequences

- ✅ 跨机器 / 跨 milestone owner 数据安全
- ✅ Eva v102 schema 沿用（不重写）
- ✅ migration dry-run 模式必须支持（按 0B-6 acceptance）
- ⚠️ 增订字段必须 nullable（否则 ADD COLUMN 失败）
- ⚠️ enum CHECK 扩展是兼容的（加值不破现有行）；enum CHECK 收窄需 schema-rebuild（避免）

## Prior Art

- Rails ActiveRecord migrations
- Flyway / Liquibase patterns
- Eva 自家 v0.4.5 教训（FK off rebuild）
