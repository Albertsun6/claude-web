// M-1 验收脚本：开 harness.db 跑迁移，验证 13 业务表 + FTS5 + 触发器全部建成功。
// 用 tmp 路径避免污染 ~/.claude-web/harness.db。
//
// 跑法：pnpm --filter @claude-web/backend test:harness-schema
//
// Round 1 评审修复：
// - cross M6: 修测试 setup 顺序，先 methodology 后 stage，避免 FK 错误掩盖 CHECK 测试
// - BLOCKER-2: 加重启回归用例（重新打开同一 db 不报错且不重跑 migration）

import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { openHarnessDb, HARNESS_SCHEMA_VERSION } from "./harness-store.js";
import { setStageFailed } from "./harness-queries.js";

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
  // 每加 migration 时 expected 同步增长（assertion 与实际 migration 文件目录一一对应）
  const expected = [
    "0001_initial.sql",
    "0002_stage_status_dispatched.sql",
    "0003_stage_failed_reason.sql",
  ];
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

  // === Phase 4: 负面 — schema-rebuild 留 FK violations 时 metadata 不应推进
  //
  // H14 hot-fix retrospective M2 follow-up：cross-review m2 finding —— 验证 runner
  // 在 schema-rebuild migration 留下 FK 完整性问题时，schema_migrations 不写、
  // user_version 不动、下次启动重试。
  //
  // 流程：
  //   1. tmp migrationsDir 写入真实 0001 + 故意 broken 0002（rebuild 但只拷一半 stage rows）
  //   2. 用 migrationsDir option 打开 DB → 0001 应用 + 种 prod-shape 数据（5 stages + 5 decisions）
  //   3. 关 DB
  //   4. 重新打开同 DB 同 migrationsDir → runner 跑 0002 → foreign_key_check 检测到 violations
  //      → throw → transaction 回滚 → schema_migrations 不写 + user_version 仍 100
  //   5. 第三次打开（仅校验）→ 仍 v100，确认状态稳定，下次启动仍可重试
  console.log("\n--- Phase 4: negative — runner rolls back on FK violation (H follow-up) ---");

  const negPath = join(tmp, "neg-shape.db");
  const negMigrationsDir = join(tmp, "neg-migrations");
  const realMigrationsDir = MIGRATIONS_DIR; // 引用真实 0001
  // 创建 tmp migrations dir
  rmSync(negMigrationsDir, { recursive: true, force: true });
  mkdirSync(negMigrationsDir, { recursive: true });
  copyFileSync(join(realMigrationsDir, "0001_initial.sql"), join(negMigrationsDir, "0001_initial.sql"));

  // broken 0002：schema-rebuild + 仅拷 ROWID 奇数的 stage rows，造成偶数 ROWID 对应的
  // decision/task FK 引用悬空。foreign_key_check 必须报告 violations，runner throw + rollback。
  const brokenSql = `-- TARGET_VERSION = 102
-- MIGRATION_MODE = schema-rebuild
--
-- INTENTIONALLY BROKEN — used by Phase 4 negative test only.
-- Pattern: rebuild stage but copy ONLY half the rows (奇数 ROWID), 让 decision FK 悬空。

CREATE TABLE stage_new (
  id                       TEXT PRIMARY KEY,
  issue_id                 TEXT NOT NULL REFERENCES issue(id),
  kind                     TEXT NOT NULL,
  status                   TEXT NOT NULL,
  weight                   TEXT NOT NULL,
  gate_required            INTEGER NOT NULL DEFAULT 1,
  assigned_agent_profile   TEXT NOT NULL,
  methodology_id           TEXT NOT NULL REFERENCES methodology(id),
  input_artifact_ids_json  TEXT NOT NULL DEFAULT '[]',
  output_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  review_verdict_ids_json  TEXT NOT NULL DEFAULT '[]',
  started_at               INTEGER,
  ended_at                 INTEGER,
  created_at               INTEGER NOT NULL
);

INSERT INTO stage_new
  (id, issue_id, kind, status, weight, gate_required, assigned_agent_profile,
   methodology_id, input_artifact_ids_json, output_artifact_ids_json,
   review_verdict_ids_json, started_at, ended_at, created_at)
SELECT id, issue_id, kind, status, weight, gate_required, assigned_agent_profile,
       methodology_id, input_artifact_ids_json, output_artifact_ids_json,
       review_verdict_ids_json, started_at, ended_at, created_at
FROM stage
WHERE ROWID % 2 = 1;

DROP TABLE stage;
ALTER TABLE stage_new RENAME TO stage;

CREATE UNIQUE INDEX idx_stage_issue_kind ON stage(issue_id, kind);
CREATE INDEX idx_stage_running ON stage(status) WHERE status = 'running';
`;

  // 关键：先种 prod-shape 数据（这里走 0001 only），再写 broken 0002 到同 dir 重开
  // Step 1: 用 migrationsDir 打开 DB（仅 0001 在 dir 里）→ schema 全建好
  {
    const handle = openHarnessDb({ dbPath: negPath, migrationsDir: negMigrationsDir });
    assert(handle.schemaVersion === 100, `step 1: schemaVersion=100 (only 0001 applied)`);

    const now = Date.now();
    handle.db.prepare(
      "INSERT INTO methodology(id,stage_kind,version,applies_to,content_ref,approved_by,approved_at) VALUES(?,?,?,?,?,?,?)",
    ).run("m-neg", "spec", "1.0", "universal", "x", "user", now);
    handle.db.prepare(
      "INSERT INTO harness_project(id,cwd,name,worktree_root,created_at) VALUES(?,?,?,?,?)",
    ).run("p-neg", "/tmp/neg", "neg", "/tmp/neg/.worktrees", now);
    handle.db.prepare(
      `INSERT INTO issue(id,project_id,source,title,body,labels_json,priority,status,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run("i-neg", "p-neg", "manual", "neg issue", "body", "[]", "normal", "in_progress", now, now);

    const insertStage = handle.db.prepare(
      `INSERT INTO stage(id,issue_id,kind,status,weight,gate_required,assigned_agent_profile,methodology_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    );
    const stageKinds = ["strategy", "discovery", "spec", "compliance", "design"] as const;
    for (const kind of stageKinds) {
      insertStage.run(`s-neg-${kind}`, "i-neg", kind, "approved", "heavy", 1, "PM", "m-neg", now);
    }

    const insertDecision = handle.db.prepare(
      `INSERT INTO decision(id,stage_id,requested_by,options_json,created_at) VALUES(?,?,?,?,?)`,
    );
    for (const kind of stageKinds) {
      insertDecision.run(`d-neg-${kind}`, `s-neg-${kind}`, "user", "[]", now);
    }
    handle.close();
  }

  // Step 2: 把 broken 0002 写进同 migrationsDir
  writeFileSync(join(negMigrationsDir, "0002_bad_rebuild.sql"), brokenSql);

  // Step 3: 重新打开 DB → runner 跑 broken 0002 → 应该 throw
  let threw = false;
  let errMsg = "";
  try {
    const handle = openHarnessDb({ dbPath: negPath, migrationsDir: negMigrationsDir });
    handle.close(); // 不应该到这
  } catch (e: any) {
    threw = true;
    errMsg = String(e.message || e);
  }
  assert(threw, `broken 0002 throws on reopen (err: ${errMsg.slice(0, 80)})`);
  assert(
    /FK violations|foreign_key/i.test(errMsg),
    `error message mentions FK violation (got: ${errMsg.slice(0, 80)})`,
  );

  // Step 4: 第三次打开仅 inspect — user_version 必须仍 100，schema_migrations 仅 0001
  // 但每次 open 都会重新尝试 broken 0002 并 throw。要校验 metadata，得用 raw better-sqlite3
  // 直接 SELECT（不走 runner）。这恰好也证明了：broken 状态没有持久化，下次重启仍可重试。
  {
    const raw = new Database(negPath);
    raw.pragma("foreign_keys = ON");
    const userVersion = raw.pragma("user_version", { simple: true }) as number;
    assert(userVersion === 100, `step 3: user_version still 100 after broken migration (was ${userVersion})`);

    const applied = raw
      .prepare("SELECT file FROM schema_migrations ORDER BY file")
      .all()
      .map((r: any) => r.file as string);
    assert(
      applied.length === 1 && applied[0] === "0001_initial.sql",
      `step 3: schema_migrations only records 0001 (got: ${JSON.stringify(applied)})`,
    );

    // 验证 stage 数据完整（5 行未被 broken rebuild 偷走 — transaction 回滚正确）
    const stageCount = raw.prepare("SELECT count(*) as n FROM stage").get() as { n: number };
    assert(stageCount.n === 5, `step 3: stage rows preserved across rolled-back rebuild (got: ${stageCount.n})`);

    // 验证 FK 仍然完整：5 decisions 仍能 JOIN 到 5 stages
    const fkCount = raw.prepare(
      `SELECT count(*) as n FROM decision d JOIN stage s ON s.id = d.stage_id`,
    ).get() as { n: number };
    assert(fkCount.n === 5, `step 3: decision FK refs intact (got: ${fkCount.n})`);

    raw.close();
  }

  // === Phase 5: M2 Loop 1 — prod-shape v101 → v102 additive migration（cross M3 收紧）
  //
  // 验证 0003_stage_failed_reason.sql 是真 additive：
  //   - 父表 stage 既有数据保留（5 个 stage 覆盖代表性 status/kind，模拟 v0.4.5 prod 状态）
  //   - 子表 decision 既有 FK refs 保留
  //   - 既有 CHECK enum / index (idx_stage_issue_kind, idx_stage_running) 不动
  //   - migration mode = default（runner 不关 FK，不 rebuild table）
  //   - failed_reason / failed_at 列加进去后默认 NULL
  //   - foreign_key_check 仍为空
  //
  // **prod-shape fixture 最小集**（按 cross M3 verdict）：v101 DB + 多 stage 覆盖现有
  // status / kind + 子表 FK ref + 现有 index 可查询
  //
  // 加 charter compliance assertion（cross m1 应用）：机械 lock "0003 必须 default mode"
  // —— 防止后续误改成 schema-rebuild 仍通过 Phase 5 测试。
  console.log("\n--- Phase 5: prod-shape v101 → v102 additive (M2 Loop 1) ---");

  // Charter compliance lock — 静态读 0003 SQL 文件，assert 它是 minimal additive
  {
    const sql0003 = readFileSync(
      join(MIGRATIONS_DIR, "0003_stage_failed_reason.sql"),
      "utf-8",
    );
    const header = sql0003.split("\n").slice(0, 20).join("\n");
    assert(
      !/MIGRATION_MODE\s*=\s*schema-rebuild/.test(header),
      `Charter: 0003 must NOT declare MIGRATION_MODE = schema-rebuild`,
    );
    assert(
      !/DROP\s+TABLE\s+stage\b/i.test(sql0003),
      `Charter: 0003 must NOT DROP TABLE stage`,
    );
    assert(
      !/CREATE\s+TABLE\s+stage_new\b/i.test(sql0003),
      `Charter: 0003 must NOT CREATE TABLE stage_new (rebuild pattern)`,
    );
    assert(
      /ALTER\s+TABLE\s+stage\s+ADD\s+COLUMN\s+failed_reason/i.test(sql0003),
      `Charter: 0003 must add failed_reason via ALTER TABLE ADD COLUMN`,
    );
    assert(
      /ALTER\s+TABLE\s+stage\s+ADD\s+COLUMN\s+failed_at/i.test(sql0003),
      `Charter: 0003 must add failed_at via ALTER TABLE ADD COLUMN`,
    );
  }

  const loop1Path = join(tmp, "loop1-shape.db");
  // 用真实 0001 + 0002 跑到 v101，模拟 v0.4.5 prod 状态
  const loop1MigrationsDir = join(tmp, "loop1-migrations");
  rmSync(loop1MigrationsDir, { recursive: true, force: true });
  mkdirSync(loop1MigrationsDir, { recursive: true });
  copyFileSync(
    join(MIGRATIONS_DIR, "0001_initial.sql"),
    join(loop1MigrationsDir, "0001_initial.sql"),
  );
  copyFileSync(
    join(MIGRATIONS_DIR, "0002_stage_status_dispatched.sql"),
    join(loop1MigrationsDir, "0002_stage_status_dispatched.sql"),
  );

  // Step 1：开 DB → 跑 0001 + 0002 → 到 v101
  {
    const handle = openHarnessDb({
      dbPath: loop1Path,
      migrationsDir: loop1MigrationsDir,
    });
    assert(handle.schemaVersion === 101, `Step 1: at v101 (got ${handle.schemaVersion})`);

    // Seed prod-shape：1 project + methodology + 1 issue + 5 stages（覆盖现有 status/kind）
    // + 3 decisions FK ref → stage.id
    const now = Date.now();
    handle.db.prepare(
      "INSERT INTO methodology(id,stage_kind,version,applies_to,content_ref,approved_by,approved_at) VALUES(?,?,?,?,?,?,?)",
    ).run("m-l1", "spec", "1.0", "universal", "x", "user", now);
    handle.db.prepare(
      "INSERT INTO harness_project(id,cwd,name,worktree_root,created_at) VALUES(?,?,?,?,?)",
    ).run("p-l1", "/tmp/loop1", "loop1", "/tmp/loop1/.worktrees", now);
    handle.db.prepare(
      `INSERT INTO issue(id,project_id,source,title,body,labels_json,priority,status,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run("i-l1", "p-l1", "manual", "loop1 issue", "x", "[]", "normal", "in_progress", now, now);

    // 5 stages 覆盖现有所有 status（pending / dispatched / running / awaiting_review / approved）
    // 用不同 kind 避开 idx_stage_issue_kind UNIQUE 约束
    const stageMix = [
      ["s-l1-pend", "strategy",   "pending"],
      ["s-l1-disp", "discovery",  "dispatched"],
      ["s-l1-run",  "spec",       "running"],
      ["s-l1-rev",  "compliance", "awaiting_review"],
      ["s-l1-app",  "design",     "approved"],
    ] as const;
    const insertStage = handle.db.prepare(
      `INSERT INTO stage(id,issue_id,kind,status,weight,gate_required,assigned_agent_profile,methodology_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    );
    for (const [id, kind, status] of stageMix) {
      insertStage.run(id, "i-l1", kind, status, "heavy", 1, "PM", "m-l1", now);
    }
    const insertDecision = handle.db.prepare(
      `INSERT INTO decision(id,stage_id,requested_by,options_json,created_at) VALUES(?,?,?,?,?)`,
    );
    insertDecision.run("d-l1-1", "s-l1-pend", "user", "[]", now);
    insertDecision.run("d-l1-2", "s-l1-disp", "user", "[]", now);
    insertDecision.run("d-l1-3", "s-l1-app",  "user", "[]", now);
    handle.close();
  }

  // Step 2：把 0003 写进 migrationsDir，重开 → runner 应跑 0003 additive 成功
  copyFileSync(
    join(MIGRATIONS_DIR, "0003_stage_failed_reason.sql"),
    join(loop1MigrationsDir, "0003_stage_failed_reason.sql"),
  );

  const loop1Handle = openHarnessDb({
    dbPath: loop1Path,
    migrationsDir: loop1MigrationsDir,
  });
  assert(
    loop1Handle.schemaVersion === 102,
    `Step 2: prod-shape DB upgraded to v102 (got ${loop1Handle.schemaVersion})`,
  );

  // 验证 1：5 stages 全部保留（既有数据未触动）
  const loop1Stages = loop1Handle.db
    .prepare("SELECT id, kind, status FROM stage ORDER BY id")
    .all() as Array<{ id: string; kind: string; status: string }>;
  assert(
    loop1Stages.length === 5,
    `prod-shape stages preserved (${loop1Stages.length}/5)`,
  );

  // 验证 2：FK 完整性 — 3 decisions 仍能 JOIN 到 stage
  const loop1FkCount = loop1Handle.db.prepare(
    `SELECT count(*) as n FROM decision d JOIN stage s ON s.id = d.stage_id`,
  ).get() as { n: number };
  assert(loop1FkCount.n === 3, `decision FK refs intact (${loop1FkCount.n}/3)`);

  const loop1Violations = loop1Handle.db.pragma("foreign_key_check") as Array<unknown>;
  assert(
    Array.isArray(loop1Violations) && loop1Violations.length === 0,
    `foreign_key_check empty after additive migration`,
  );

  // 验证 3：新列存在且默认 NULL
  const cols = loop1Handle.db
    .prepare("SELECT name FROM pragma_table_info('stage')")
    .all()
    .map((r: any) => r.name as string);
  assert(cols.includes("failed_reason"), `stage.failed_reason column added`);
  assert(cols.includes("failed_at"), `stage.failed_at column added`);

  const oldStageReason = loop1Handle.db
    .prepare("SELECT failed_reason, failed_at FROM stage WHERE id = 's-l1-pend'")
    .get() as { failed_reason: string | null; failed_at: number | null };
  assert(
    oldStageReason.failed_reason === null && oldStageReason.failed_at === null,
    `existing stage rows have NULL failed_reason / failed_at`,
  );

  // 验证 4：现有 indexes 仍存在（idx_stage_issue_kind / idx_stage_running）
  const indexes = loop1Handle.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'stage'")
    .all()
    .map((r: any) => r.name as string);
  assert(
    indexes.includes("idx_stage_issue_kind"),
    `idx_stage_issue_kind preserved across additive migration`,
  );
  assert(
    indexes.includes("idx_stage_running"),
    `idx_stage_running preserved across additive migration`,
  );

  // 验证 5：现有 stage.status CHECK enum 仍 enforce（包含 H14 dispatched）
  let invalidStatusThrew = false;
  try {
    loop1Handle.db.prepare(
      `INSERT INTO stage(id,issue_id,kind,status,weight,gate_required,assigned_agent_profile,methodology_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run("s-l1-bad", "i-l1", "implement", "INVALID", "heavy", 1, "PM", "m-l1", Date.now());
  } catch (e: any) {
    invalidStatusThrew = String(e.message || e).includes("CHECK");
  }
  assert(invalidStatusThrew, `stage.status CHECK enum still enforced after additive migration`);

  // 验证 6：可写入 failed_reason / failed_at（虽然 Loop 1 不做写入路径，但 schema 必须可用）
  loop1Handle.db.prepare(
    `UPDATE stage SET failed_reason = ?, failed_at = ? WHERE id = ?`,
  ).run("orphan_after_restart", Date.now(), "s-l1-pend");
  const updatedReason = loop1Handle.db
    .prepare("SELECT failed_reason FROM stage WHERE id = 's-l1-pend'")
    .get() as { failed_reason: string };
  assert(
    updatedReason.failed_reason === "orphan_after_restart",
    `failed_reason column writable after migration`,
  );

  // 验证 7：二次 reopen — schema_migrations 含 0003，未重跑
  loop1Handle.close();
  const loop1Reopen = openHarnessDb({
    dbPath: loop1Path,
    migrationsDir: loop1MigrationsDir,
  });
  assert(
    loop1Reopen.schemaVersion === 102,
    `Step 7: reopen still at v102 (idempotent)`,
  );
  const reopenApplied = loop1Reopen.db
    .prepare("SELECT file FROM schema_migrations ORDER BY file")
    .all()
    .map((r: any) => r.file as string);
  assert(
    reopenApplied.length === 3 &&
      reopenApplied[2] === "0003_stage_failed_reason.sql",
    `schema_migrations contains 0003 (no re-exec)`,
  );
  loop1Reopen.close();

  // === Phase 6: M2 Loop 2 — setStageFailed helper invariants
  //
  // 验证 setStageFailed:
  //   1. 写入 status='failed' + failed_reason + failed_at
  //   2. 同时设置 ended_at（COALESCE 不覆盖既有 ended_at）
  //   3. **Idempotent guard**: 已有 failed_reason 时不覆盖（首次写赢）
  //   4. audit log 写入 set_failed 事件
  console.log("\n--- Phase 6: setStageFailed helper invariants (M2 Loop 2) ---");

  const phase6Path = join(tmp, "phase6.db");
  const phase6Handle = openHarnessDb({ dbPath: phase6Path });

  // Seed
  const ph6Now = Date.now();
  phase6Handle.db.prepare(
    "INSERT INTO methodology(id,stage_kind,version,applies_to,content_ref,approved_by,approved_at) VALUES(?,?,?,?,?,?,?)",
  ).run("m-p6", "spec", "1.0", "universal", "x", "user", ph6Now);
  phase6Handle.db.prepare(
    "INSERT INTO harness_project(id,cwd,name,worktree_root,created_at) VALUES(?,?,?,?,?)",
  ).run("p-p6", "/tmp/p6", "p6", "/tmp/p6/.worktrees", ph6Now);
  phase6Handle.db.prepare(
    `INSERT INTO issue(id,project_id,source,title,body,labels_json,priority,status,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run("i-p6", "p-p6", "manual", "p6", "x", "[]", "normal", "in_progress", ph6Now, ph6Now);

  const insertS = phase6Handle.db.prepare(
    `INSERT INTO stage(id,issue_id,kind,status,weight,gate_required,assigned_agent_profile,methodology_id,created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  );
  insertS.run("s-p6-a", "i-p6", "strategy", "running", "heavy", 1, "PM", "m-p6", ph6Now);
  insertS.run("s-p6-b", "i-p6", "implement", "dispatched", "heavy", 1, "PM", "m-p6", ph6Now);

  // 1. 第一次 setStageFailed 应写入完整 reason + failed_at
  const first = setStageFailed(phase6Handle.db, "s-p6-a", "cli_failed", ph6Now);
  assert(first === true, `first setStageFailed returns true (changes > 0)`);

  const row1 = phase6Handle.db
    .prepare("SELECT status, failed_reason, failed_at, ended_at FROM stage WHERE id = 's-p6-a'")
    .get() as { status: string; failed_reason: string; failed_at: number; ended_at: number };
  assert(row1.status === "failed", `setStageFailed sets status='failed'`);
  assert(row1.failed_reason === "cli_failed", `failed_reason persisted = 'cli_failed'`);
  assert(row1.failed_at === ph6Now, `failed_at persisted = ${ph6Now}`);
  assert(row1.ended_at === ph6Now, `ended_at also set when not previously set`);

  // 2. **Idempotent guard**: 第二次 setStageFailed 不覆盖首次 reason
  const second = setStageFailed(phase6Handle.db, "s-p6-a", "unknown_error", ph6Now + 1000);
  assert(second === false, `second setStageFailed (already has reason) returns false (no changes)`);

  const row1Again = phase6Handle.db
    .prepare("SELECT failed_reason, failed_at FROM stage WHERE id = 's-p6-a'")
    .get() as { failed_reason: string; failed_at: number };
  assert(
    row1Again.failed_reason === "cli_failed",
    `Idempotent: failed_reason still 'cli_failed' (not overwritten by 'unknown_error')`,
  );
  assert(
    row1Again.failed_at === ph6Now,
    `Idempotent: failed_at still original timestamp`,
  );

  // 3. 不同 stage 独立工作（覆盖不被串扰）
  setStageFailed(phase6Handle.db, "s-p6-b", "spawn_setup_failed", ph6Now + 2000);
  const row2 = phase6Handle.db
    .prepare("SELECT status, failed_reason, failed_at FROM stage WHERE id = 's-p6-b'")
    .get() as { status: string; failed_reason: string; failed_at: number };
  assert(
    row2.status === "failed" && row2.failed_reason === "spawn_setup_failed",
    `Independent stage gets its own failed_reason ('spawn_setup_failed')`,
  );

  phase6Handle.close();

  console.log("\nharness schema OK ✅");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
