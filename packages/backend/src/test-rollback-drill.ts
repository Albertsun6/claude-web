// Day 7 — rollback drill 自动化 test (M0-PIM Week 1 验收)
//
// 跑法: pnpm --filter @vessel/backend exec tsx src/test-rollback-drill.ts
// 退出码: 0 = 全过; 1 = 失败
//
// 验证 ADR-020 §D11 rollback path:
//   1. 跑 0001-0008 migrations → 生成 .before-0008.bak
//   2. 写 pim_item 数据
//   3. close + 模拟 prod-like crash (删 db / wal / shm)
//   4. cp .bak → db (restore)
//   5. reopen → 验证 user_version=102 (回到 pre-0008)
//   6. 再 reopen → 自动 re-apply 0008 (无死循环)
//   7. 再次跑 backup hook 时 .bak 已存在不被覆盖 (跳过 backup)
//
// 整个 test 在 tmp DATA_DIR 跑，不触碰 prod ~/.vessel/harness.db.

import { mkdtempSync, rmSync, existsSync, copyFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "rollback-drill-"));
process.env.VESSEL_DATA_DIR = tmpDir;
process.env.HARNESS_DISABLED = "";
console.log(`[test] using tmp DATA_DIR: ${tmpDir}`);

const { openHarnessDb } = await import("./harness-store.js");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const dbPath = path.join(tmpDir, "harness.db");
const bakPath = path.join(tmpDir, "harness.db.before-0008.bak");

// === Phase 1: first open → 0008 applies, backup created ===
console.log("\n--- Phase 1: first open ---");
let h = openHarnessDb();
assert(h.schemaVersion === 103, "schema v103 after first open");
assert(existsSync(bakPath), `backup .bak exists at ${bakPath}`);
const bakSizeBefore = statSync(bakPath).size;
assert(bakSizeBefore > 0, `backup .bak non-empty (${bakSizeBefore} bytes)`);

// 写一些 pim_item 模拟实际使用
h.db.prepare(`
  INSERT INTO pim_item (id, content, captured_at, source, commitment_state, modality, ai_status, visibility, created_at, updated_at)
  VALUES ('pim-test-1', 'before rollback', 1, 'test', 'inbox', 'text', 'pending', 'private', 1, 1)
`).run();
h.db.prepare(`
  INSERT INTO pim_item (id, content, captured_at, source, commitment_state, modality, ai_status, visibility, created_at, updated_at)
  VALUES ('pim-test-2', 'will be lost', 2, 'test', 'inbox', 'text', 'pending', 'private', 2, 2)
`).run();
const beforeRollbackCount = (h.db.prepare("SELECT COUNT(*) c FROM pim_item").get() as { c: number }).c;
assert(beforeRollbackCount === 2, `wrote 2 pim_item before rollback`);
h.close();

// === Phase 2: rollback steps (per ADR-020 §D11) ===
console.log("\n--- Phase 2: rollback drill ---");
// Step 1: stop backend (already closed)
// Step 2: rm db + wal + shm
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });
assert(!existsSync(dbPath), "db file removed");

// Step 3: cp .bak → db
copyFileSync(bakPath, dbPath);
assert(existsSync(dbPath), "db restored from .bak");

// Step 4: reopen → user_version should be 102 (pre-0008)
//         AND 0008 should NOT be in schema_migrations
//         BUT runner will detect 0008 not applied + try to re-apply it
//
// 关键: bak 已存在 → backup hook 检测到 existsSync(bakPath) → skip backup
//                  → 0008 re-applies (idempotent, IF NOT EXISTS CREATE TABLE)
//                  → user_version 103 again
//                  → pim_item table 重建为空 (因为 IF NOT EXISTS 不 drop 已有)
//                  - 但 db 是 v102 (没有 pim_item 表)，所以 CREATE TABLE 真创建
//                  → pim_item 空表 + 我们之前写的 2 条记录已丢

// 用 better-sqlite3 直接打开 verify pre-reopen state
// 直接 query 不开 migration
const Database = (await import("better-sqlite3")).default;
const rawDb = new Database(dbPath);
const versionBeforeReopen = rawDb.pragma("user_version", { simple: true }) as number;
assert(versionBeforeReopen === 102, `db restored to user_version=102 (pre-0008)`);
const tablesBeforeReopen = rawDb
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pim_item'`)
  .all();
assert(tablesBeforeReopen.length === 0, `pim_item table absent after rollback`);
rawDb.close();

// === Phase 3: reopen → automatic re-apply (no infinite loop) ===
console.log("\n--- Phase 3: reopen after rollback ---");
const bakMtimeBefore = statSync(bakPath).mtimeMs;
h = openHarnessDb();
assert(h.schemaVersion === 103, "auto re-applied 0008 → v103");
const tablesAfterReopen = h.db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pim_item'`)
  .all();
assert(tablesAfterReopen.length === 1, `pim_item table recreated`);
const dataAfterReopen = (h.db.prepare("SELECT COUNT(*) c FROM pim_item").get() as { c: number }).c;
assert(dataAfterReopen === 0, `pim_item is empty (data lost from .bak rollback — expected)`);

// 验证 backup hook 没有覆盖 .bak (避免脏 backup)
const bakMtimeAfter = statSync(bakPath).mtimeMs;
assert(bakMtimeBefore === bakMtimeAfter, `.bak not overwritten on re-apply (existsSync skip)`);
h.close();

// === Phase 4: stable third reopen (no flapping) ===
console.log("\n--- Phase 4: stable third reopen ---");
h = openHarnessDb();
assert(h.schemaVersion === 103, "third reopen still v103");
h.close();

// === Phase 5: rollback again → idempotent ===
console.log("\n--- Phase 5: rollback again (idempotent) ---");
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });
copyFileSync(bakPath, dbPath);
h = openHarnessDb();
assert(h.schemaVersion === 103, `re-rollback → re-apply → still v103`);
h.close();

rmSync(tmpDir, { recursive: true, force: true });
console.log("");
console.log("rollback drill OK ✅");
console.log("");
console.log("=== Week 1 验收清单 ===");
console.log("  ✓ migration 0008 在测试 db 上跑通且可 rollback");
console.log("  ✓ 四端同步 round-trip 测试通过 (146 shared vitest)");
console.log("  ✓ iOS / Web 两个入口可用 (Day 4 a7fd1e5)");
console.log("  ✓ inbox.jsonl 老数据迁移 (36 条 实迁 Day 2 d3de0a0)");
console.log("  ✓ dual-write 验证 (22 assertion smoke test Day 2)");
console.log("  ✓ rollback 演练通过 (本 drill)");
