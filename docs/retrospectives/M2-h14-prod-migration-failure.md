# M2 — H14 dispatched stage status — Prod Migration Failure & Hot-Fix

**Date**: 2026-05-05
**Phase**: M2 first wave hot-fix
**Round risk addressed**: SQLite schema migration with FK-referenced parent table on real prod data
**Exit**: ship (v0.4.5)
**Related PRs**: #20 (H14 v0.4.4, broken), v0.4.5 (this hot-fix)
**Related artifacts**:
- `packages/backend/src/migrations/0002_stage_status_dispatched.sql`
- `packages/backend/src/harness-store.ts`
- `packages/backend/src/test-harness-schema.ts`
- `docs/reviews/h14-stage-dispatched-cross-2026-05-05-2018.md` (original v0.4.4 review)
- `docs/reviews/h14-migration-rebuild-mode-cross-2026-05-05-2136.md` (hot-fix re-review)

---

## 一句话本圈风险

"修 H14 v0.4.4 的真实 prod 失败：在带 child rows 的 prod-shape DB 上跑 stage 表 rebuild migration，必须保证 schema-level FK 检查不阻塞 DROP TABLE，且 FK 完整性验证在 transaction 内、commit 前完成。"

## 事故时间线

| 时间 | 事件 |
|---|---|
| 2026-05-05 早 | PR #20 (H14 v1) 合并到 dev，CI 绿（test:harness-schema 38 assertions pass，cursor-agent review 0 BLOCKER） |
| 2026-05-05 中 | PR #21 (Layered Spiral Delivery §0.5) 合 dev |
| 2026-05-05 中 | PR #22 dev→main release v0.4.4 合并 + tag |
| 2026-05-05 晚 | `./scripts/promote.sh v0.4.4` 跑到 smoke `/api/harness/initiatives` 阶段 → 503 |
| 同时 | backend log: `[harness] DB init failed — SqliteError: FOREIGN KEY constraint failed`（migration 0002 阶段抛错） |
| 同时 | `./scripts/rollback.sh v0.4.3` ✅ 成功，prod 恢复 v100 + v0.4.3 代码 |
| 2026-05-05 晚 | hot-fix 开始（本 retrospective 对应的圈） |

## 根因（两层）

### 根因 1（SQL 层面）：`PRAGMA defer_foreign_keys` 误用

原 0002 头部：
```sql
PRAGMA defer_foreign_keys = ON;
```

期望：让 migration transaction 内的 DROP TABLE stage 通过，commit 时再统一检查 FK。

实际 SQLite 行为：`defer_foreign_keys` 只把 **row-level immediate FK 检查**推迟到 commit。`DROP TABLE` 触发的不是 row-level 检查，而是**schema-level "is some other table referencing the table being dropped"** 检查——这条规则**不受 `defer_foreign_keys` 影响**。

prod 真实数据：53 stages + 46 decisions（其中 `decision.stage_id` REFERENCES `stage(id)`）→ DROP TABLE stage 立即报错。

正确做法（SQLite 12-step ALTER TABLE recipe）：必须在 transaction **外**执行 `PRAGMA foreign_keys = OFF`，跑完 rebuild 再 `PRAGMA foreign_keys = ON`。

### 根因 2（流程层面）：fixture 太空 + anchor gate 漏过

- `test:harness-schema` Phase 1 在 fresh DB 上跑（0 stage rows），migration 通过 → 测试绿。
- 我手动 dogfood 用的 `~/.claude-web-dev/harness.db` 也是空的（dev backend 从未真 spawn 过 agent）→ migration 通过。
- cursor-agent v0.4.4 review 看了 SQL 逻辑但没在带 child rows 的 prod-shape DB 上验证。
- **§0.5 anchor gate 第 1 问"数据模型是否明确"被理解为"schema 有定义"，没强制要求"在 prod-shape 数据上跑过"**——这是双层原则上线后第一次骨架层 gate 漏过。

## 修复

### 1. Migration runner 加 `MIGRATION_MODE = schema-rebuild`

`packages/backend/src/harness-store.ts` 在 `runPendingMigrations` 里识别 SQL header `-- MIGRATION_MODE = schema-rebuild`，对这类 migration 包装成：

```
PRAGMA foreign_keys = OFF              ← outside transaction (SQLite requires)
db.transaction(() => {
  db.exec(sql)                         ← actual rebuild
  PRAGMA foreign_key_check             ← verify integrity; throw → tx rollback
  INSERT schema_migrations
  PRAGMA user_version = <target>
})
PRAGMA foreign_keys = ON               ← finally, restore even on throw
```

关键 cross-review 修正（M1 in `h14-migration-rebuild-mode-cross-2026-05-05-2136.md`）：原版把 `foreign_key_check` 放在 transaction 外（commit 后），意味着 violations 时 `schema_migrations` 已经写好，下次启动会跳过这个 broken migration。修正：把 check 移进 transaction，紧跟 `db.exec(sql)` 之后、`INSERT schema_migrations` 之前，violations throw → transaction 回滚 → 元数据不动 → 下次启动重试。

### 2. `0002_stage_status_dispatched.sql` 改 mode header

- 加 `-- MIGRATION_MODE = schema-rebuild`
- 删 broken `PRAGMA defer_foreign_keys = ON`
- 加 rollback 边界注释（cross m3 应用）：v101 forward-only，rollback 不会 down-migrate；如已写 dispatched 行，老代码读到 enum 不接受会报错。

### 3. `test-harness-schema.ts` 加 Phase 3 prod-shape gate

新加 Phase 3：手工 bootstrap v100 prod-shape DB（1 project + 10 stages + 5 decisions FK refs，覆盖所有 10 个 stage kind），reopen 走 runner，验证：
- v100 → v101 升级成功
- 10 stages 全部保留
- `foreign_key_check` 返回空
- 5 decisions 仍能 JOIN 到对应 stage（FK refs 完整）
- dispatched 接受 / 非法 status 拒
- 二次写入后 FK 完整性仍 OK

**关键**：Phase 3 在 reverted-to-default-mode 的版本下会失败（验证测试覆盖根因）。

### 4. Real prod-shape dogfood

复制 `~/.claude-web/harness.db`（v100 + 53 stages + 46 decisions）到 `/tmp/`，用修复版 runner 跑 → 升级成功，46/46 decisions 仍指向有效 stage 行，`foreign_key_check` 0 violations。Live prod 不受影响（仍 v0.4.3 + v100）。

## §0.5 双层原则修订

应用 cross-review 教训，把 §0.5 anchor gate 第 1 问从：

> 本里程碑的数据模型（新增 / 修改的实体 + DDL + migration）是否明确？

加强成：

> 本里程碑的数据模型 ... 是否明确，**且 migration 在 prod-shape fixture 上验证过**？"prod-shape" 至少包含：父表有数据、子表有 FK 引用、已有 enum / CHECK / index、真实 user_version 从旧版本升级。

这条修正写进 `docs/HARNESS_ROADMAP.md` §0.5 anchor gate #1。

## 学到的（trans-context lessons）

### Lesson A — fixture shape 是 anchor gate 的载体

"schema 有 DDL"和"migration 在 prod-shape 上跑过"是两件事。任何改 CHECK enum / FK / index / unique 约束的 migration 都必须造 child rows fixture 测一遍。**空 fixture 通过 = false negative**。

### Lesson B — `PRAGMA defer_foreign_keys` 不救 DROP TABLE

记入 [reviewer-cross/LEARNINGS.md](../.claude/skills/reviewer-cross/LEARNINGS.md)（待补）：
> SQLite `defer_foreign_keys` 只推迟 row-level immediate 检查；DROP TABLE / RENAME 等 schema-level FK 检查不受其影响。改 CHECK enum 类 migration 必须在 transaction **外** `PRAGMA foreign_keys = OFF`，配合 12-step ALTER TABLE recipe。

### Lesson C — verification before metadata commit

任何"先做事，再验证"的 migration 都是不完整的，因为元数据（schema_migrations、user_version）会和实际状态脱节。验证必须在 transaction 内，元数据写入之前。否则 broken migration 永久落地。

### Lesson D — 双层原则的反馈循环

这次 §0.5 双层原则上线后第一次实际 anchor gate 漏过，**正好是双层原则自己要解决的盲点的一个新变体**："数据模型是否明确"被读成 schema-level 而非 data-shape-level。原则修订（anchor gate #1 加强）是双层原则反馈循环的第一次自我演进。

## Exit 决定

**ship**（v0.4.5）—— 修复 + 强化 anchor gate + 写进 retrospective + 写进 §0.5。

## Follow-up（不阻塞 v0.4.5）

- **m2 follow-up**: 加负面 runner 测试——构造一个 leaves-FK-violations 的 schema-rebuild migration，验证 `schema_migrations` / `user_version` 不会被推进。需要把 `MIGRATIONS_DIR` 抽成 `openHarnessDb` option（中等改动），优先级 P3，等下一次实际需要触发再做。
- **LEARNINGS.md 更新**: 把 Lesson B 写进 `.claude/skills/reviewer-cross/LEARNINGS.md`（下一次 review 工作流时合并）。
- **monorepo `pnpm rebuild` 流程**: 当前 promote.sh 里已经做了，但 dev 工作流的 better-sqlite3 binding 也容易 mismatch（NODE_MODULE_VERSION 137 vs 141）；可以加一个 `pnpm --filter @claude-web/backend rebuild:native` script 简化 dogfood。
