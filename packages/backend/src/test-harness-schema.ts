// M-1 验收脚本：开 harness.db 跑迁移，验证 13 业务表 + FTS5 + 触发器全部建成功。
// 用 tmp 路径避免污染 ~/.claude-web/harness.db。
//
// 跑法：pnpm --filter @claude-web/backend test:harness-schema
//
// Round 1 评审修复：
// - cross M6: 修测试 setup 顺序，先 methodology 后 stage，避免 FK 错误掩盖 CHECK 测试
// - BLOCKER-2: 加重启回归用例（重新打开同一 db 不报错且不重跑 migration）

import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { openHarnessDb, HARNESS_SCHEMA_VERSION } from "./harness-store.js";

// 复制 harness-store.ts 的 MIGRATIONS_DIR 解析（保持一致即可，避免再 export 一份内部常量）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, "migrations");

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
  // H14 v1：再加 migration 时 expected 同步增长（assertion 与实际 migration 文件目录一一对应）
  const expected = ["0001_initial.sql", "0002_stage_status_dispatched.sql"];
  assert(
    applied.length === expected.length && applied.every((f, i) => f === expected[i]),
    `schema_migrations records exactly ${expected.length} rows: ${JSON.stringify(applied)}`,
  );

  // 数据应该还在（FK / 数据完整性）
  const stillThere = handle2.db
    .prepare("SELECT id FROM issue WHERE id = ?")
    .get("i1") as { id: string } | undefined;
  assert(stillThere?.id === "i1", "data persisted across reopen");

  handle2.close();

  // === Phase 3: prod-shape migration v100 → v101（v0.4.5 hot-fix gate）
  //
  // v0.4.4 prod 失败的真实场景：harness.db 已在 v100，stage 表 53 行，decision 表 46 行
  // FK 引用 stage.id。runner 跑 0002 → DROP TABLE stage 触发 "FOREIGN KEY constraint failed"，
  // backend 启动失败。
  //
  // 本阶段在 prod-shape fixture 上重现 + 验证修复：
  //   1. 用 better-sqlite3 直开 raw db
  //   2. 手工 bootstrap：bootstrapMigrationsTable + 跑 0001 + 写 schema_migrations 行 + user_version=100
  //      （≡ v0.4.3 prod 状态）
  //   3. 种 prod-shape 数据：project + methodology + issue + 10 stages + 5 decisions(stage_id refs)
  //   4. close → reopen via openHarnessDb → runner 应该跑 0002 成功
  //   5. 验证：data 完整 + foreign_key_check 空 + dispatched 接受 + 非法 status 拒
  console.log("\n--- Phase 3: prod-shape migration v100 → v101 (v0.4.5 hot-fix gate) ---");

  const prodPath = join(tmp, "prod-shape.db");
  {
    const raw = new Database(prodPath);
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    raw.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        file        TEXT PRIMARY KEY,
        target_ver  INTEGER NOT NULL,
        applied_at  INTEGER NOT NULL
      )
    `);
    const sql0001 = readFileSync(join(MIGRATIONS_DIR, "0001_initial.sql"), "utf-8");
    const apply0001 = raw.transaction(() => {
      raw.exec(sql0001);
      raw.prepare(
        "INSERT INTO schema_migrations(file, target_ver, applied_at) VALUES(?,?,?)",
      ).run("0001_initial.sql", 100, Date.now());
      raw.pragma("user_version = 100");
    });
    apply0001();

    // Seed prod-shape：1 project + 1 methodology + 1 issue + 10 stages（10 个 kind 全部覆盖）
    // + 5 decisions（FK 引用前 5 个 stage.id，正是 prod 触发 schema-level FK 检查的形态）
    const now = Date.now();
    raw.prepare(
      "INSERT INTO methodology(id,stage_kind,version,applies_to,content_ref,approved_by,approved_at) VALUES(?,?,?,?,?,?,?)",
    ).run("m-prod", "spec", "1.0", "universal", "x", "user", now);
    raw.prepare(
      "INSERT INTO harness_project(id,cwd,name,worktree_root,created_at) VALUES(?,?,?,?,?)",
    ).run("p-prod", "/tmp/prod", "prod", "/tmp/prod/.worktrees", now);
    raw.prepare(
      `INSERT INTO issue(id,project_id,source,title,body,labels_json,priority,status,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run("i-prod", "p-prod", "manual", "prod issue", "body", "[]", "normal", "in_progress", now, now);

    const stageKinds = [
      "strategy", "discovery", "spec", "compliance", "design",
      "implement", "test", "review", "release", "observe",
    ] as const;
    const insertStage = raw.prepare(
      `INSERT INTO stage(id,issue_id,kind,status,weight,gate_required,assigned_agent_profile,methodology_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    );
    for (const kind of stageKinds) {
      insertStage.run(`s-${kind}`, "i-prod", kind, "approved", "heavy", 1, "PM", "m-prod", now);
    }

    const insertDecision = raw.prepare(
      `INSERT INTO decision(id,stage_id,requested_by,options_json,created_at) VALUES(?,?,?,?,?)`,
    );
    for (const kind of stageKinds.slice(0, 5)) {
      insertDecision.run(`d-${kind}`, `s-${kind}`, "user", "[]", now);
    }
    raw.close();
  }

  // 现在打开 prod-shape DB，runner 应该把 0002 跑成功
  const prodHandle = openHarnessDb({ dbPath: prodPath });
  assert(
    prodHandle.schemaVersion === HARNESS_SCHEMA_VERSION,
    `prod-shape DB upgraded to user_version=${HARNESS_SCHEMA_VERSION}`,
  );

  // 数据完整：10 stages 全部保留 + kind/status 一致
  const stagesAfter = prodHandle.db
    .prepare("SELECT id, kind, status FROM stage ORDER BY id")
    .all() as Array<{ id: string; kind: string; status: string }>;
  assert(
    stagesAfter.length === 10 && stagesAfter.every((s) => s.status === "approved"),
    `prod-shape stages preserved (${stagesAfter.length}/10 with status='approved')`,
  );

  // FK 完整性 — 决定性 gate（cursor-agent re-review 重点）
  const violations = prodHandle.db.pragma("foreign_key_check") as Array<unknown>;
  assert(
    Array.isArray(violations) && violations.length === 0,
    `foreign_key_check returns no violations after schema-rebuild`,
  );

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
    .get() as { n: number };
  assert(dispCount.n === 1, `stage status='dispatched' accepted by new CHECK`);

  // 非法 status 仍被拒
  let invalidThrew = false;
  try {
    prodHandle.db.prepare(
      `INSERT INTO stage(id,issue_id,kind,status,weight,gate_required,assigned_agent_profile,methodology_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run("s-bad", issueId2, "discovery", "INVALID", "heavy", 1, "PM", "m-prod", Date.now());
  } catch (e: any) {
    invalidThrew = String(e.message || e).includes("CHECK");
  }
  assert(invalidThrew, `invalid stage.status still rejected by CHECK`);

  // FK 完整性 again（dispatched 行 + 5 decisions 无变化）
  const violations2 = prodHandle.db.pragma("foreign_key_check") as Array<unknown>;
  assert(
    Array.isArray(violations2) && violations2.length === 0,
    `foreign_key_check empty after additional inserts`,
  );

  // 5 decisions FK 引用应仍然 valid（stage.id 名字保留）
  const decRefs = prodHandle.db
    .prepare(`SELECT d.id, s.kind FROM decision d JOIN stage s ON s.id = d.stage_id ORDER BY d.id`)
    .all() as Array<{ id: string; kind: string }>;
  assert(
    decRefs.length === 5,
    `decision.stage_id FK still resolves to stage rows (${decRefs.length}/5)`,
  );

  prodHandle.close();

  console.log("\nharness schema OK ✅");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
