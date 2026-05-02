// M-1 验收脚本：开 harness.db 跑迁移，验证 13 业务表 + FTS5 + 触发器全部建成功。
// 用 tmp 路径避免污染 ~/.claude-web/harness.db。
//
// 跑法：pnpm --filter @claude-web/backend test:harness-schema
//
// Round 1 评审修复：
// - cross M6: 修测试 setup 顺序，先 methodology 后 stage，避免 FK 错误掩盖 CHECK 测试
// - BLOCKER-2: 加重启回归用例（重新打开同一 db 不报错且不重跑 migration）

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openHarnessDb, HARNESS_SCHEMA_VERSION } from "./harness-store.js";

const EXPECTED_TABLES = [
  "schema_migrations",  // Round 1 BLOCKER-2 修复后新增
  "harness_project",
  "initiative",
  "issue",
  "idea_capture",
  "methodology",
  "stage",
  "context_bundle",
  "task",
  "run",
  "artifact",
  "review_verdict",
  "decision",
  "retrospective",
];

const EXPECTED_FTS_TABLES = ["issue_fts", "artifact_fts"];

const EXPECTED_TRIGGERS = [
  "issue_fts_ai", "issue_fts_ad", "issue_fts_au",
  "artifact_fts_ai", "artifact_fts_ad", "artifact_fts_au",
];

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const tmp = mkdtempSync(join(tmpdir(), "harness-schema-test-"));
const dbPath = join(tmp, "harness.db");

try {
  // === Phase 1: 首次 open + apply migration
  console.log("--- Phase 1: First open ---");
  const handle = openHarnessDb({ dbPath });

  assert(
    handle.schemaVersion === HARNESS_SCHEMA_VERSION,
    `PRAGMA user_version = ${handle.schemaVersion} (expected ${HARNESS_SCHEMA_VERSION})`,
  );

  const tables = handle.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r: any) => r.name as string);

  for (const t of EXPECTED_TABLES) {
    assert(tables.includes(t), `business table '${t}' exists`);
  }
  for (const t of EXPECTED_FTS_TABLES) {
    assert(tables.includes(t), `FTS5 table '${t}' exists`);
  }

  const triggers = handle.db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger'")
    .all()
    .map((r: any) => r.name as string);
  for (const tr of EXPECTED_TRIGGERS) {
    assert(triggers.includes(tr), `trigger '${tr}' exists`);
  }

  // === setup test data：先 methodology → 再 issue/stage（满足 FK）
  const now = Date.now();
  handle.db.prepare(
    "INSERT INTO methodology(id,stage_kind,version,applies_to,content_ref,approved_by,approved_at) VALUES(?,?,?,?,?,?,?)",
  ).run("m1", "spec", "1.0", "universal", "methodologies/01-spec.md", "user", now);

  handle.db.prepare(
    "INSERT INTO harness_project(id,cwd,name,worktree_root,created_at) VALUES(?,?,?,?,?)",
  ).run("p1", "/tmp/proj", "test", "/tmp/proj/.worktrees", now);

  handle.db.prepare(
    `INSERT INTO issue(id,project_id,source,title,body,labels_json,priority,status,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run("i1", "p1", "manual", "schema test", "validating fts5 external-content", "[]", "normal", "inbox", now, now);

  // FTS5 round-trip：插一条 issue → 查 issue_fts 能命中
  const fts = handle.db.prepare(
    "SELECT title FROM issue_fts WHERE issue_fts MATCH 'fts5'"
  ).all() as { title: string }[];
  assert(fts.length === 1 && fts[0].title === "schema test", "FTS5 match works on issue body");

  // 现在测 stage UNIQUE 约束（cross M2 修复）
  handle.db.prepare(
    `INSERT INTO stage(id,issue_id,kind,status,weight,gate_required,assigned_agent_profile,methodology_id,created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run("s1", "i1", "spec", "pending", "light", 1, "PM", "m1", now);

  let dupThrew = false;
  try {
    handle.db.prepare(
      `INSERT INTO stage(id,issue_id,kind,status,weight,gate_required,assigned_agent_profile,methodology_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run("s1b", "i1", "spec", "pending", "light", 1, "PM", "m1", now);
  } catch (e: any) {
    dupThrew = String(e.message || e).includes("UNIQUE");
  }
  assert(dupThrew, "stage UNIQUE(issue_id, kind) rejects duplicate kind");

  // 现在单独测 artifact CHECK 约束（cross M6 修复：先 stage 已存在）
  let checkThrew = false;
  let checkErrMsg = "";
  try {
    handle.db.prepare(
      `INSERT INTO artifact(id,stage_id,kind,hash,storage,size_bytes,created_at)
       VALUES(?,?,?,?,?,?,?)`,
    ).run("a-bad", "s1", "spec", "sha-x", "inline", 10, now);  // 缺 content_text
  } catch (e: any) {
    checkErrMsg = String(e.message || e);
    checkThrew = checkErrMsg.includes("CHECK constraint");
  }
  assert(checkThrew, `artifact CHECK rejects 'inline' without content_text (err: ${checkErrMsg.slice(0,60)})`);

  // bool CHECK 约束（cross m1 修复）
  let boolThrew = false;
  try {
    handle.db.prepare(
      "INSERT INTO harness_project(id,cwd,name,worktree_root,harness_enabled,created_at) VALUES(?,?,?,?,?,?)",
    ).run("p-bad", "/tmp/p2", "x", "/tmp/p2/.worktrees", 99, now);  // harness_enabled=99 应被拒
  } catch (e: any) {
    boolThrew = String(e.message || e).includes("CHECK");
  }
  assert(boolThrew, "bool CHECK rejects harness_enabled=99");

  // cwd UNIQUE（cross m2 修复）
  let cwdThrew = false;
  try {
    handle.db.prepare(
      "INSERT INTO harness_project(id,cwd,name,worktree_root,created_at) VALUES(?,?,?,?,?)",
    ).run("p-dup", "/tmp/proj", "dup", "/tmp/proj/.worktrees", now);
  } catch (e: any) {
    cwdThrew = String(e.message || e).includes("UNIQUE");
  }
  assert(cwdThrew, "harness_project.cwd UNIQUE rejects duplicate cwd");

  handle.close();

  // === Phase 2: 重启回归（BLOCKER-2 修复点）
  console.log("\n--- Phase 2: Reopen (regression: no migration re-exec) ---");
  const handle2 = openHarnessDb({ dbPath });
  assert(
    handle2.schemaVersion === HARNESS_SCHEMA_VERSION,
    `Reopened user_version still = ${HARNESS_SCHEMA_VERSION}`,
  );
  const applied = handle2.db
    .prepare("SELECT file FROM schema_migrations ORDER BY file")
    .all()
    .map((r: any) => r.file as string);
  assert(
    applied.length === 1 && applied[0] === "0001_initial.sql",
    `schema_migrations records exactly 1 row: ${JSON.stringify(applied)}`,
  );

  // 数据应该还在（FK / 数据完整性）
  const stillThere = handle2.db
    .prepare("SELECT id FROM issue WHERE id = ?")
    .get("i1") as { id: string } | undefined;
  assert(stillThere?.id === "i1", "data persisted across reopen");

  handle2.close();

  console.log("\nharness schema OK ✅");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
