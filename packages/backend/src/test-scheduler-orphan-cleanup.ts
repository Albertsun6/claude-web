// F (M2 螺旋圈): scheduler orphan stage cleanup verification.
//
// 场景：backend 在 scheduler.spawnAgent fire-and-forget 中途崩溃，留下
// pending/dispatched/running 的 stage 行。下次 backend 重启时 EvaScheduler
// 实例化必须把这些标 failed + 广播 stage_changed。awaiting_review 不动。
//
// 跑法：pnpm --filter @claude-web/backend test:scheduler-cleanup

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openHarnessDb } from "./harness-store.js";
import { EvaScheduler } from "./scheduler.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const tmp = mkdtempSync(join(tmpdir(), "scheduler-cleanup-test-"));
const dbPath = join(tmp, "harness.db");

try {
  // Bootstrap：跑 0001 + 0002 → 完整 schema
  const handle = openHarnessDb({ dbPath });

  const now = Date.now();
  handle.db.prepare(
    "INSERT INTO methodology(id,stage_kind,version,applies_to,content_ref,approved_by,approved_at) VALUES(?,?,?,?,?,?,?)",
  ).run("m1", "spec", "1.0", "universal", "x", "user", now);
  handle.db.prepare(
    "INSERT INTO harness_project(id,cwd,name,worktree_root,created_at) VALUES(?,?,?,?,?)",
  ).run("p1", "/tmp/p1", "p1", "/tmp/p1/.worktrees", now);
  handle.db.prepare(
    `INSERT INTO issue(id,project_id,source,title,body,labels_json,priority,status,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run("i1", "p1", "manual", "test", "x", "[]", "normal", "in_progress", now, now);

  // Seed: 4 active orphan stages (pending / dispatched / running / awaiting_review)
  // + 2 完成态（approved / rejected）作为 control（不应该被改）
  const insertStage = handle.db.prepare(
    `INSERT INTO stage(id,issue_id,kind,status,weight,gate_required,assigned_agent_profile,methodology_id,created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  );
  insertStage.run("s-pend", "i1", "strategy",   "pending",         "heavy", 1, "PM", "m1", now);
  insertStage.run("s-disp", "i1", "discovery",  "dispatched",      "heavy", 1, "PM", "m1", now);
  insertStage.run("s-run",  "i1", "spec",       "running",         "heavy", 1, "PM", "m1", now);
  insertStage.run("s-rev",  "i1", "compliance", "awaiting_review", "heavy", 1, "PM", "m1", now);
  insertStage.run("s-app",  "i1", "design",     "approved",        "heavy", 1, "PM", "m1", now);
  insertStage.run("s-rej",  "i1", "implement",  "rejected",        "heavy", 1, "PM", "m1", now);

  // 模拟 backend 重启：实例化 EvaScheduler → constructor 应触发 cleanup
  const broadcastCalls: Array<unknown> = [];
  const broadcast = (msg: unknown) => broadcastCalls.push(msg);

  console.log("--- Instantiating EvaScheduler (triggers cleanup) ---");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _scheduler = new EvaScheduler(handle.db, broadcast);

  // 校验 1: pending / dispatched / running 全部转 failed（3 行）
  const failed = handle.db
    .prepare("SELECT id, kind FROM stage WHERE status = 'failed' ORDER BY id")
    .all()
    .map((r: any) => r.id as string);
  assert(
    failed.length === 3 && failed.includes("s-pend") && failed.includes("s-disp") && failed.includes("s-run"),
    `pending/dispatched/running 3 stages → failed (got: ${JSON.stringify(failed)})`,
  );

  // 校验 1b (M2 Loop 2): orphan cleanup 写入 failed_reason='orphan_after_restart' + failed_at
  const orphanRows = handle.db
    .prepare(
      `SELECT id, failed_reason, failed_at FROM stage
       WHERE id IN ('s-pend','s-disp','s-run')
       ORDER BY id`,
    )
    .all() as Array<{ id: string; failed_reason: string | null; failed_at: number | null }>;
  assert(
    orphanRows.every((r) => r.failed_reason === "orphan_after_restart"),
    `Loop 2: all 3 orphans have failed_reason='orphan_after_restart' (got: ${JSON.stringify(orphanRows.map((r) => r.failed_reason))})`,
  );
  assert(
    orphanRows.every((r) => r.failed_at != null && r.failed_at > 0),
    `Loop 2: all 3 orphans have failed_at timestamp set`,
  );

  // 校验 2: awaiting_review **不动**（合法人审暂停）
  const stillReview = handle.db
    .prepare("SELECT status FROM stage WHERE id = 's-rev'")
    .get() as { status: string };
  assert(stillReview.status === "awaiting_review", `awaiting_review preserved (got: ${stillReview.status})`);

  // 校验 3: approved / rejected 不动
  const stillApproved = handle.db
    .prepare("SELECT status FROM stage WHERE id = 's-app'")
    .get() as { status: string };
  assert(stillApproved.status === "approved", `approved preserved`);
  const stillRejected = handle.db
    .prepare("SELECT status FROM stage WHERE id = 's-rej'")
    .get() as { status: string };
  assert(stillRejected.status === "rejected", `rejected preserved`);

  // 校验 4: 广播了 3 个 stage_changed 事件，每个对应一个 orphan
  const stageChangedEvents = broadcastCalls.filter(
    (m: any) => m && m.type === "harness_event" && m.kind === "stage_changed" && m.status === "failed",
  );
  assert(
    stageChangedEvents.length === 3,
    `broadcast 3 stage_changed{status:failed} events (got ${stageChangedEvents.length})`,
  );
  const broadcastedIds = new Set(stageChangedEvents.map((m: any) => m.stageId));
  assert(
    broadcastedIds.has("s-pend") && broadcastedIds.has("s-disp") && broadcastedIds.has("s-run"),
    `broadcast covers exactly the 3 orphan stage ids`,
  );

  // 校验 5: 第二次实例化 scheduler — 已无 orphan，应该 0 broadcast
  const broadcastCalls2: Array<unknown> = [];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _scheduler2 = new EvaScheduler(handle.db, (m) => broadcastCalls2.push(m));
  assert(
    broadcastCalls2.length === 0,
    `idempotent: re-instantiate scheduler with no orphans → 0 broadcasts (got ${broadcastCalls2.length})`,
  );

  handle.close();

  console.log("\nscheduler orphan cleanup OK ✅");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
