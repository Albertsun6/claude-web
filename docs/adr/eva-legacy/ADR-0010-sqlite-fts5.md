# ADR-0010 — SQLite + FTS5 作为 harness 持久层

**状态**：Accepted（2026-05-03，M-1 启动期敲定）

**Decider**：用户 + reviewer-cross + reviewer-architecture（M-1 验收 ritual）

**关联**：[HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md) · [HARNESS_ROADMAP.md §0 #11](../HARNESS_ROADMAP.md)

---

## Context

harness 引入 13 个核心实体（Project / Initiative / Issue / IdeaCapture / Stage / Methodology / Task / ContextBundle / Run / Artifact / ReviewVerdict / Decision / Retrospective），引用密集，且需要：

- 跨实体连表查询（Issue → Stage → Task → Run → Artifact → ReviewVerdict）
- Issue 标题 / 内容 + Artifact 内容的全文搜索
- audit log 与业务表分离，独立写入路径

现有 `~/.claude-web/projects.json` 是单文件 JSON，已经在多并发写时靠 [projects-store.ts](../../packages/backend/src/projects-store.ts) 的 promise queue 兜底。继续往里塞 13 实体不现实——索引、引用、搜索都得自己造轮子。

---

## Decision

用 **better-sqlite3 + FTS5** 在 `~/.claude-web/harness.db`：

- DB 文件：`~/.claude-web/harness.db`
- 内容溢出文件：`~/.claude-web/artifacts/<hash>.md`（Artifact > 8KB 时落盘，content-addressed）
- ContextBundle 副本：`~/.claude-web/bundles/<bundleId>.md`（可审计快照）
- 审计日志：`~/.claude-web/harness-audit.jsonl`（**独立 JSONL**，不进 DB）
- 现有 `~/.claude-web/projects.json` **保留兼容**——旧路径不动，harness 启用项目额外在 DB 建一行

**为什么不进 Postgres / DuckDB / 别的 DB**：
- 个人自用规模（< 100 Issue / < 1000 Run），SQLite 单文件足够
- 永不商业化、永不团队化（[HARNESS_ROADMAP.md §Context #13](../HARNESS_ROADMAP.md)）→ 永不需要分布式
- better-sqlite3 同步 API、零网络依赖，和 spawn `claude` CLI 的同步血缘一致
- FTS5 内置全文搜索，免装 Elasticsearch / Meilisearch

**为什么 audit log 不进 SQLite**：
- append-only 写入用 `fs.appendFile` 比 DB 事务快、无锁竞争
- 审计需求是 grep / jq / tail，jsonl 工具链更顺
- DB 损坏时审计日志可独立救活
- 与现有 [telemetry-store.ts](../../packages/backend/src/telemetry-store.ts) 同构（10MB rotate 一次）

---

## Consequences

**Pros**：
- ✅ 引用密集查询性能好（自带 B-tree 索引）
- ✅ FTS5 全文搜索内置（issue.title / body + artifact.content_text）
- ✅ 同步 API + 单文件，适合 Tailscale 单 Mac 部署
- ✅ 与 `~/.claude-web/projects.json` 共存，不破坏旧路径
- ✅ better-sqlite3 比 sqlite3（async）性能高 5-10×

**Cons**：
- ❌ 不支持高并发写——单写者锁。**个人自用足够**（永不团队化）
- ❌ FTS5 contentless 模式需要触发器手动同步（已写在 [HARNESS_DATA_MODEL.md §1.3 §1.10](../HARNESS_DATA_MODEL.md)）
- ❌ schema 迁移需要四端同步（见 [ADR-0015](ADR-0015-schema-migration.md)）

**永不需要做的事**：
- 迁移到 Postgres / MySQL（个人自用规模 SQLite 足够）
- 加缓存层（Redis 等）
- 分布式事务

---

## 替代方案及为何驳回

| 方案 | 驳回理由 |
|---|---|
| 继续用 `projects.json` 单文件 JSON | 13 实体引用密集；二级索引、连表查询、全文搜索都得自己造轮子 |
| Postgres + Drizzle | 引入 Postgres 服务依赖，违反 [§0 #11](../HARNESS_ROADMAP.md)（"不引入新基础组件"）；个人自用规模 over-kill |
| DuckDB | 列存适合分析，不适合事务密集的 harness 流水线 |
| LokiJS / Lowdb | 内存数据库，断电丢数据；引用密集查询性能差 |
| 直接用 jsonl 多文件 | audit log 用 jsonl OK，但 13 实体 jsonl 索引仍然得手动维护——不如直接 SQLite |

---

## Migration

M-1 完工时 [packages/backend/src/migrations/0001_initial.sql](../../packages/backend/src/migrations/0001_initial.sql) 创建所有表。后续 schema 变更走 [ADR-0015](ADR-0015-schema-migration.md)。

---

## Operational guarantees (Round 1 评审补充)

### Audit log fail-open

`~/.claude-web/harness-audit.jsonl` 写入失败时业务事务**不阻塞**，仅 `console.warn`。与 [`packages/backend/scripts/permission-hook.mjs`](../../packages/backend/scripts/permission-hook.mjs) 的 fail-open 语义一致。理由：

- audit 是事后查询用途，业务可用性优先
- 个人自用规模下不存在合规强一致审计需求
- 强一致变种（同事务写 audit）会牺牲 ADR-0010 §"为什么 audit log 不进 SQLite" 的"无锁竞争"优势

如果未来需要强一致审计（团队化 / 商业化），需要新 ADR 推翻本节。

### projects.json 读写约定

harness 启用项目同时存在两处：`~/.claude-web/projects.json`（旧）+ `harness.db.harness_project`（新）。**harness 只读 projects.json 的 cwd / id / name，不写入**。所有 harness 元数据（`worktree_root` / `harness_enabled` / `default_branch`）只在 DB 一侧。

旧 `projects.json` 仍由 [`packages/backend/src/projects-store.ts`](../../packages/backend/src/projects-store.ts) 维护其原有写路径，harness 不动。

### 环依赖外键写入序列

`context_bundle.task_id` ↔ `task.context_bundle_id` 互相引用（[HARNESS_DATA_MODEL.md §1.7 §1.8](../HARNESS_DATA_MODEL.md)）。SQLite 不支持 `DEFERRABLE INITIALLY DEFERRED`，所以由 **harness-store 写入序列保证**：

1. 先 `INSERT context_bundle (id=cb1, task_id=NULL or placeholder)`
2. 再 `INSERT task (id=t1, ..., context_bundle_id=cb1)`
3. 最后 `UPDATE context_bundle SET task_id=t1 WHERE id=cb1`

或两条都用 `INSERT ... ON CONFLICT DO UPDATE` 在事务内串行写。M1 写 CRUD 时按此序列执行，避免外键 dangling。

> 这是不成文契约，本节是显式承诺，避免 M1 实现者不知道。
