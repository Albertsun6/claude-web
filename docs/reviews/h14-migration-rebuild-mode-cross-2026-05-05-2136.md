# Cross Review — H14 Migration Rebuild Mode Hot-Fix

**Reviewer**: reviewer-cross  
**Model**: GPT-5.5  
**Date**: 2026-05-05 21:36  
**Files reviewed**:
- `packages/backend/src/harness-store.ts`
- `packages/backend/src/migrations/0002_stage_status_dispatched.sql`
- `packages/backend/src/test-harness-schema.ts`

---

## Summary

- Blockers: 0
- Majors: 1
- Minors: 3
- 总体判断：建议先修 M1，再合并 / 打 v0.4.5。0002 的方向正确，且能覆盖 v0.4.4 prod 失败根因；但 `schema-rebuild` runner 当前把完整性检查放在提交之后，违反了“检查失败则迁移不应被标记成功”的迁移不变量。

对 KEY QUESTIONS 的直接回答：

- A：是，`PRAGMA foreign_keys = OFF` / `ON` 放在 transaction 外；`db.pragma("foreign_keys = OFF")` 在 `applyTx()` 前，`ON` 在 `finally`，符合 SQLite 语义。
- B：普通异常路径安全：`applyTx()` 或 `foreign_key_check` 抛错都会进入 `finally` 恢复 ON。但 `foreign_key_check` 在提交后才跑，检查失败时无法回滚已提交的 `schema_migrations` / `user_version`。
- C：`foreign_key_check` 是正确工具；它可以在 `foreign_keys` OFF 时检查现有数据完整性。但应在同一个迁移事务提交前执行，才能让失败回滚。
- D：进程 kill 不会持久留下 FK OFF，因为它是连接级设置；事务中 kill 会由 SQLite 回滚。但如果 kill 发生在 `applyTx()` 已提交、`foreign_key_check` 尚未完成之间，DB 可能已经被标记为迁移成功而未完成验证。
- E：Phase 3 确实覆盖 prod 失败形态：v100 DB + child table `decision.stage_id` 引用 `stage.id`，revert 成 default/defer 方案时会在 `DROP TABLE stage` 处失败。
- F：`MIGRATION_MODE` 已在 runner docstring 和 0002 SQL header 中解释；作为内部 migration header，不一定需要额外 README。但建议把 rollback/forward-only 语义补进同一处文档。
- G：v101 是事实上的 forward-only schema step。回滚到 v0.4.3 不会 down-migrate；若已有 `dispatched` 行，旧代码是否能正确处理取决于旧代码枚举逻辑，不应假设安全。

## Numeric Score

| Lens | Score (0..5) |
|---|---:|
| 正确性 | 3.6 |
| 跨端对齐 | 4.4 |
| 不可逆 | 3.8 |
| 安全 | 4.0 |
| 简化 | 4.5 |

**Overall score**: 4.0

## Findings

### M1 [MAJOR] `foreign_key_check` happens after the migration transaction has already committed

**Where**: `packages/backend/src/harness-store.ts:140-147`, `packages/backend/src/harness-store.ts:157-164`  
**Lens**: 正确性 / 不可逆  
**Issue**: `applyTx()` includes the SQL, `schema_migrations` insert, and `user_version` bump, then returns before `foreign_key_check` runs. In `better-sqlite3`, returning from `db.transaction()` means the transaction has committed. If `foreign_key_check` then finds violations and throws, the DB is already marked migrated.

```140:147:packages/backend/src/harness-store.ts
    const applyTx = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations(file, target_ver, applied_at) VALUES(?,?,?)",
      ).run(file, target, Date.now());
      // user_version 用 PRAGMA，无 bind param 接口，但已经在事务内
      db.pragma(`user_version = ${target}`);
    });
```

```157:164:packages/backend/src/harness-store.ts
      try {
        applyTx();
        const violations = db.pragma("foreign_key_check") as Array<unknown>;
        if (Array.isArray(violations) && violations.length > 0) {
          throw new Error(
            `[harness-store] migration ${file} schema-rebuild left FK violations: ${JSON.stringify(violations)}`,
          );
        }
```

**Why this is major**: The runner claims schema-rebuild mode validates FK integrity after rebuild, but the current order only detects a bad committed state. On the next backend start, `schema_migrations` already contains the file and `user_version` has advanced, so the broken migration can be skipped permanently.

**Suggested fix**: For `schema-rebuild`, use a transaction body that runs `db.exec(sql)`, then `PRAGMA foreign_key_check`, then inserts `schema_migrations` and advances `user_version`. If the check throws, the transaction rolls back and the migration remains pending. Keep `PRAGMA foreign_keys = OFF/ON` outside the transaction.

### m1 [MINOR] `foreign_key_check` result shape is assumed; non-array results would silently pass

**Where**: `packages/backend/src/harness-store.ts:159-160`  
**Lens**: 正确性  
**Issue**: The code only throws when `Array.isArray(violations) && violations.length > 0`. If the driver behavior changes, or a wrapper returns a non-array result, the check is treated as success.

```159:160:packages/backend/src/harness-store.ts
        const violations = db.pragma("foreign_key_check") as Array<unknown>;
        if (Array.isArray(violations) && violations.length > 0) {
```

**Suggested fix**: Treat a non-array result as an internal error: `if (!Array.isArray(violations)) throw ...; if (violations.length > 0) throw ...`.

### m2 [MINOR] Phase 3 covers the prod failure path, but not the rollback/metadata safety path

**Where**: `packages/backend/src/test-harness-schema.ts:261-327`  
**Lens**: 正确性 / 安全  
**Issue**: Phase 3 is a strong positive test for the real v0.4.4 failure: a v100 DB with `decision.stage_id` rows is reopened through `openHarnessDb()`. It would fail if 0002 reverted to default mode or `defer_foreign_keys`. But it does not test the important negative case from M1: if a schema-rebuild migration leaves FK violations, `schema_migrations` and `user_version` must not advance.

```261:266:packages/backend/src/test-harness-schema.ts
  // 现在打开 prod-shape DB，runner 应该把 0002 跑成功
  const prodHandle = openHarnessDb({ dbPath: prodPath });
  assert(
    prodHandle.schemaVersion === HARNESS_SCHEMA_VERSION,
    `prod-shape DB upgraded to user_version=${HARNESS_SCHEMA_VERSION}`,
  );
```

**Suggested fix**: Add a small negative migration test around the runner behavior, ideally by making the migration directory injectable in tests or by factoring the per-file apply function. The assertion should be: FK violation throws, `user_version` remains at the previous version, and no `schema_migrations` row is written.

### m3 [MINOR] Rollback semantics are not explicit in the artifact that introduces the forward-only schema state

**Where**: `packages/backend/src/migrations/0002_stage_status_dispatched.sql:16-34`, `packages/backend/src/test-harness-schema.ts:284-297`  
**Lens**: 不可逆 / 跨端对齐  
**Issue**: 0002 documents the v0.4.4 failure and the new rebuild strategy, and the test proves `dispatched` is accepted after v101. But the artifact does not state the operational rollback boundary: after v101, old v0.4.3 code may open a DB whose CHECK enum accepts and may already contain `dispatched`, while rollback does not down-migrate.

```284:297:packages/backend/src/test-harness-schema.ts
  // dispatched 现在被 CHECK 接受
  const issueId2 = "i-prod-2";
  prodHandle.db.prepare(
    `INSERT INTO issue(id,project_id,source,title,body,labels_json,priority,status,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(issueId2, "p-prod", "manual", "issue 2", "x", "[]", "normal", "in_progress", Date.now(), Date.now());
  prodHandle.db.prepare(
    `INSERT INTO stage(id,issue_id,kind,status,weight,gate_required,assigned_agent_profile,methodology_id,created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run("s-disp", issueId2, "strategy", "dispatched", "heavy", 1, "PM", "m-prod", Date.now());
  const dispCount = prodHandle.db
    .prepare("SELECT count(*) as n FROM stage WHERE status='dispatched'")
```

**Suggested fix**: Add one explicit note to the 0002 header or runner docstring: `v101 is forward-only; rollback to v0.4.3 after this migration does not restore the v100 CHECK enum and is only safe before any code writes status='dispatched'`.

## Lens Notes

### Lens 1 — Correctness

The fix addresses the original SQLite mistake. `PRAGMA foreign_keys = OFF` is outside the transaction, and the SQL no longer relies on `defer_foreign_keys`. `foreign_key_check` is the right verification primitive. The remaining correctness issue is atomicity of the verification step, not the FK-OFF placement.

### Lens 2 — Cross-End Contract Alignment

No cross-end blocker found in the reviewed artifacts. This migration only expands the DB enum from old statuses to include `dispatched`; the artifact set does not include TS/Swift enum consumers, so this review cannot prove every application-side status switch handles the new value.

### Lens 3 — Irreversibility

The schema version advance to 101 plus a new accepted status is forward-only in practice. The SQL and test explain why the migration exists, but they do not make the rollback boundary explicit.

### Lens 4 — Security & Operational Risk

No data exfiltration or injection issue found in these artifacts. Operationally, the main risk is the kill/check window after transaction commit and before FK verification, covered by M1.

### Lens 5 — Simplification

The `MIGRATION_MODE` header is a small, scoped abstraction. It is simpler than embedding fragile FK PRAGMAs inside SQL files, and the default path remains unchanged.

## False-Positive Watch

- F? M1 assumes `better-sqlite3` commits the transaction when `applyTx()` returns, which is the documented behavior of `db.transaction()`. If the implementation has an unusual outer transaction wrapper not visible in these artifacts, author can rebut; no such wrapper appears in the reviewed files.
- F? m3 depends on old v0.4.3 runtime behavior, which is outside the allowed artifact set. The finding is limited to documenting the rollback boundary, not claiming a proven old-code crash.

## What I Did Not Look At

- Did not run the migration or tests; this is a static artifact review only.
- Did not read `0001_initial.sql`, rollback scripts, release notes, production DB copy, or application-side TS/Swift status consumers.
- Did not inspect any previous reviewer verdicts, author transcripts, or docs beyond the three requested artifact files.
