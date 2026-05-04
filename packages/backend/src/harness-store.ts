// harness 持久层入口（M-1 v1.0 — Round 1 评审后 BLOCKER-2 修复）
//
// 当前 scope (M-1)：负责打开 DB + 跑 migrations + 验证 DDL 能跑。
// 业务封装（CRUD / audit append / Artifact storage 路由）留给 M1。
//
// Round 1 评审 BLOCKER-2 修复要点：
// 1. 用 schema_migrations 表记录已应用文件，避免下次启动 re-exec
// 2. 每个 migration 在 db.transaction() 里执行，失败原子回滚
// 3. PRAGMA user_version 由 runner 在事务结束时推进，而不是 SQL 文件里写死
// 4. 每个 migration SQL 顶部用注释 `-- TARGET_VERSION = N` 声明目标版本
//
// 同源：
// - DDL: docs/HARNESS_DATA_MODEL.md §1
// - migration files: src/migrations/0001_initial.sql
// - ADR: docs/adr/ADR-0010-sqlite-fts5.md, ADR-0015-schema-migration.md

import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./data-dir.js";

const HARNESS_DIR = DATA_DIR;
const DB_PATH = join(HARNESS_DIR, "harness.db");

// PRAGMA user_version 编码：major*100 + minor，patch 不计
// 1.0 → 100, 1.2 → 102, 2.0 → 200
export const HARNESS_SCHEMA_VERSION = 100;

// migrations 目录定位（Round 2 cross m3 边界注释）：
// - 当前 backend 用 `tsx watch src/index.ts` 直接跑源码，不打包，不复制 dist
//   所以 import.meta.url 解析到 packages/backend/src/，相对找 migrations/ 稳定
// - launchd plist 也是直接指 tsx，运行 cwd 不影响 __dirname
// - 如果未来引入打包（esbuild / rollup），必须把 migrations/*.sql 纳入 copy 清单
//   并改成显式 MIGRATIONS_DIR env var；现在不必
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

const TARGET_VERSION_RE = /--\s*TARGET_VERSION\s*=\s*(\d+)/;

export interface HarnessDb {
  db: Database.Database;
  schemaVersion: number;
  close: () => void;
}

/**
 * Open ~/.claude-web/harness.db. Idempotent — safe to call multiple times.
 *
 * Migration filenames: `NNNN_<desc>.sql`. Each file MUST contain
 * `-- TARGET_VERSION = <int>` (e.g. `100`) somewhere in its first 20 lines.
 *
 * Apply rules:
 * - schema_migrations 表记录已应用 file
 * - 每个 migration 在 db.transaction() 里执行
 * - 事务成功后 INSERT INTO schema_migrations + PRAGMA user_version = <target>
 * - 失败 → 整个事务回滚，user_version 不动，schema_migrations 不写
 */
export function openHarnessDb(opts: { dbPath?: string } = {}): HarnessDb {
  const path = opts.dbPath ?? DB_PATH;
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  bootstrapMigrationsTable(db);
  runPendingMigrations(db);

  const schemaVersion = db.pragma("user_version", { simple: true }) as number;

  return {
    db,
    schemaVersion,
    close: () => db.close(),
  };
}

function bootstrapMigrationsTable(db: Database.Database): void {
  // 自身幂等；不进 migration 文件以免 chicken-and-egg
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      file        TEXT PRIMARY KEY,
      target_ver  INTEGER NOT NULL,
      applied_at  INTEGER NOT NULL
    )
  `);
}

function runPendingMigrations(db: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();

  const applied = new Set(
    db.prepare("SELECT file FROM schema_migrations").all().map((r: any) => r.file as string),
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    const m = TARGET_VERSION_RE.exec(sql.split("\n").slice(0, 20).join("\n"));
    if (!m) {
      throw new Error(
        `migration ${file} missing required '-- TARGET_VERSION = <int>' header in first 20 lines`,
      );
    }
    const target = parseInt(m[1], 10);

    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations(file, target_ver, applied_at) VALUES(?,?,?)",
      ).run(file, target, Date.now());
      // user_version 用 PRAGMA，无 bind param 接口，但已经在事务内
      db.pragma(`user_version = ${target}`);
    });

    apply();
    console.log(`[harness-store] applied migration ${file} → user_version=${target}`);
  }
}
