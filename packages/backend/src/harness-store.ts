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
export const HARNESS_SCHEMA_VERSION = 101;

// migrations 目录定位（Round 2 cross m3 边界注释）：
// - 当前 backend 用 `tsx watch src/index.ts` 直接跑源码，不打包，不复制 dist
//   所以 import.meta.url 解析到 packages/backend/src/，相对找 migrations/ 稳定
// - launchd plist 也是直接指 tsx，运行 cwd 不影响 __dirname
// - 如果未来引入打包（esbuild / rollup），必须把 migrations/*.sql 纳入 copy 清单
//   并改成显式 MIGRATIONS_DIR env var；现在不必
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

const TARGET_VERSION_RE = /--\s*TARGET_VERSION\s*=\s*(\d+)/;
// v0.4.5 hot-fix：MIGRATION_MODE 控制 runner 是否在 transaction 外关 FK。
// 默认 'default' = 包在 db.transaction() 里跑，FK 始终 ON（SQLite 推荐节奏）。
// 'schema-rebuild' = 必须 rebuild 表（如改 CHECK enum），父表被子表 FK 引用时 DROP TABLE
// 会被 schema-level FK 检查阻塞——`PRAGMA defer_foreign_keys=ON` 只推迟 row-level 检查不
// 救 DROP TABLE。SQLite 12-step ALTER TABLE recipe 要求在 transaction 外 PRAGMA foreign_keys=OFF；
// 本 runner 由此包装。0002 v0.4.4 prod 失败的根因即此。
const MIGRATION_MODE_RE = /--\s*MIGRATION_MODE\s*=\s*([\w-]+)/;
type MigrationMode = "default" | "schema-rebuild";

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
 * 可选 `-- MIGRATION_MODE = <default|schema-rebuild>`（默认 default）。
 *
 * Apply rules（mode=default）：
 * - schema_migrations 表记录已应用 file
 * - 每个 migration 在 db.transaction() 里执行（FK ON）
 * - 事务成功后 INSERT INTO schema_migrations + PRAGMA user_version = <target>
 * - 失败 → 整个事务回滚，user_version 不动，schema_migrations 不写
 *
 * Apply rules（mode=schema-rebuild，v0.4.5 引入）：
 * - PRAGMA foreign_keys = OFF（在 transaction 外，SQLite 要求）
 * - 跑 transaction（内）— 顺序：
 *     1) db.exec(sql) — 实际 rebuild
 *     2) PRAGMA foreign_key_check — 验证 FK 完整性，违反则 throw（transaction 回滚 →
 *        schema_migrations / user_version 都不写 → 下次启动重试，无 broken 落地）
 *     3) INSERT INTO schema_migrations
 *     4) PRAGMA user_version
 * - PRAGMA foreign_keys = ON（finally 保证恢复，即便 transaction 抛错）
 * 适用：rebuild 父表来改 CHECK enum / 字段类型等，父表被子表 FK 引用时 schema-level
 * 检查会阻塞 DROP TABLE（v0.4.4 prod 失败的根因）。
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
    const header = sql.split("\n").slice(0, 20).join("\n");

    const tv = TARGET_VERSION_RE.exec(header);
    if (!tv) {
      throw new Error(
        `migration ${file} missing required '-- TARGET_VERSION = <int>' header in first 20 lines`,
      );
    }
    const target = parseInt(tv[1], 10);

    const modeMatch = MIGRATION_MODE_RE.exec(header);
    const mode: MigrationMode =
      modeMatch == null
        ? "default"
        : modeMatch[1] === "schema-rebuild"
          ? "schema-rebuild"
          : (() => {
              throw new Error(`migration ${file} unknown MIGRATION_MODE='${modeMatch[1]}'`);
            })();

    const applyTx = db.transaction(() => {
      db.exec(sql);

      // schema-rebuild 模式：FK 完整性检查必须在 INSERT schema_migrations / 推进 user_version
      // 之前跑（cross M1 修），否则 violations throw 时 transaction 已经 commit，下次启动
      // 看到 schema_migrations 里有该 file 就跳过 → broken DB 永久落地。
      // foreign_key_check 不依赖 foreign_keys 状态（SQLite 文档），所以 FK=OFF 期间依然
      // 能正确扫描 child rows 的悬空引用。
      if (mode === "schema-rebuild") {
        const violations = db.pragma("foreign_key_check") as unknown;
        if (!Array.isArray(violations)) {
          throw new Error(
            `[harness-store] migration ${file} foreign_key_check returned non-array: ${JSON.stringify(violations)}`,
          );
        }
        if (violations.length > 0) {
          throw new Error(
            `[harness-store] migration ${file} schema-rebuild left FK violations: ${JSON.stringify(violations)}`,
          );
        }
      }

      db.prepare(
        "INSERT INTO schema_migrations(file, target_ver, applied_at) VALUES(?,?,?)",
      ).run(file, target, Date.now());
      // user_version 用 PRAGMA，无 bind param 接口，但已经在事务内
      db.pragma(`user_version = ${target}`);
    });

    if (mode === "schema-rebuild") {
      // SQLite 要求 PRAGMA foreign_keys 必须在 transaction 外切；transaction 内调
      // 不报错但无效。包装顺序：
      //   1) 关 FK（外）
      //   2) 跑 transaction（内）—— rebuild + foreign_key_check + INSERT schema_migrations + PRAGMA user_version
      //      check 失败 throw → transaction 回滚 → schema_migrations / user_version 都不动 → 下次启动重试
      //   3) 开 FK（外，finally 保护，异常路径也恢复 ON）
      db.pragma("foreign_keys = OFF");
      try {
        applyTx();
      } finally {
        db.pragma("foreign_keys = ON");
      }
    } else {
      applyTx();
    }
    console.log(
      `[harness-store] applied migration ${file} → user_version=${target} (mode=${mode})`,
    );
  }
}
