// M2 Loop 5 — failure-path e2e pipeline test
//
// Loop 4 ship 了 happy-path e2e；Loop 5 补失败路径：scheduler.spawnAgent 三个 try/catch
// phase 中 Phase B (cli_failed) + Phase C (spec_harvest_failed) 真发抛错时，验证：
//   1. setStageFailed 把 canonical reason 真落 DB（来自 Loop 2 写入）
//   2. stage_failed broadcast 触发（带 issueId/stageId/error 字符串）
//   3. failed_reason / failed_at 持久化（Loop 1 schema 字段）
//   4. ended_at 自动设
//   5. 跨 Loop 集成：Loop 3 skip API（POST /skip）能 unblock failed stage
//
// **Phase A (spawn_setup_failed) 状态**（cross m1 应用）：
//   - 直接注入触发（mock buildContextBundle/createTask 抛错）属 Loop 6+ — 需要更多 mock 接缝
//   - 但 Scenario 1 verification 6 通过**跨 Loop 集成**意外覆盖了：skip strategy 后 implement
//     的 mustHave='spec' 找不到 → buildContextBundle 抛 → Phase A catch → spawn_setup_failed
//   - 这是 emergent integration coverage，不是 charter 违规（charter 排除"添加 Phase A 注入接缝"
//     而不是排除"通过其他 Loop 自然触发 Phase A"）
//
// 跑法：pnpm --filter @claude-web/backend test:e2e-failures

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunSessionFn } from "./scheduler.js";
import type { RunSessionParams } from "./cli-runner.js";

// === DATA_DIR isolation BEFORE any dynamic import (cross B1 from Loop 4 LEARNINGS.md #6)
const dataDirRoot = mkdtempSync(join(tmpdir(), "loop5-datadir-"));
process.env.CLAUDE_WEB_DATA_DIR = dataDirRoot;

const { openHarnessDb } = await import("./harness-store.js");
const { EvaScheduler } = await import("./scheduler.js");
const { skipFailedStage } = await import("./harness-queries.js");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

interface E2EFixture {
  tmpDir: string;
  dbPath: string;
  projectCwd: string;
  projectId: string;
  methodologyId: string;
  issueId: string;
}

function setupFixture(label: string): E2EFixture {
  const tmpDir = mkdtempSync(join(tmpdir(), `loop5-${label}-`));
  const dbPath = join(tmpDir, "harness.db");
  const projectCwd = join(tmpDir, "project-cwd");
  mkdirSync(projectCwd, { recursive: true });
  mkdirSync(join(projectCwd, "docs", "specs"), { recursive: true });
  return {
    tmpDir, dbPath, projectCwd,
    projectId: `proj-${label}`,
    methodologyId: `meth-${label}`,
    issueId: `issue-${label}`,
  };
}

function seed(handle: ReturnType<typeof openHarnessDb>, fx: E2EFixture, stageKindForFirstTick: "strategy" | "implement" = "strategy"): void {
  const now = Date.now();
  handle.db.prepare(
    "INSERT INTO methodology(id,stage_kind,version,applies_to,content_ref,approved_by,approved_at) VALUES(?,?,?,?,?,?,?)",
  ).run(fx.methodologyId, stageKindForFirstTick, "1.0", "universal", "x", "user", now);
  handle.db.prepare(
    "INSERT INTO harness_project(id,cwd,name,worktree_root,created_at) VALUES(?,?,?,?,?)",
  ).run(fx.projectId, fx.projectCwd, `proj-${fx.projectId}`, `${fx.projectCwd}/.wt`, now);
  handle.db.prepare(
    `INSERT INTO issue(id,project_id,source,title,body,labels_json,priority,status,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(fx.issueId, fx.projectId, "manual", "e2e failure test", "x", "[]", "normal", "triaged", now, now);
}

/** Wait for either stage_done OR stage_failed broadcast. Returns which one fired. */
function buildBroadcastBarrier(broadcasts: Array<any>) {
  let resolveBarrier: ((kind: "done" | "failed") => void) | null = null;
  let promise = new Promise<"done" | "failed">((r) => { resolveBarrier = r; });
  const wrappedBroadcast = (msg: any) => {
    broadcasts.push(msg);
    if (msg.type === "harness_event" && msg.kind === "stage_done") {
      resolveBarrier?.("done");
    } else if (msg.type === "harness_event" && msg.kind === "stage_failed") {
      resolveBarrier?.("failed");
    }
  };
  const reset = () => {
    promise = new Promise<"done" | "failed">((r) => { resolveBarrier = r; });
  };
  return {
    broadcast: wrappedBroadcast,
    waitForTerminal: () => promise,
    reset,
  };
}

// =============================================================================
// Scenario 1: Phase B (cli_failed) — runSessionFn throws
// =============================================================================
async function scenarioCliFailed(): Promise<void> {
  console.log("\n=== Scenario 1: cli_failed (Phase B — runSession throws) ===");
  const fx = setupFixture("cli-failed");
  let handle: ReturnType<typeof openHarnessDb> | null = null;
  try {
    handle = openHarnessDb({ dbPath: fx.dbPath });
    seed(handle, fx);

    const broadcasts: Array<any> = [];
    const barrier = buildBroadcastBarrier(broadcasts);

    const mockThrowingRunSession: RunSessionFn = (async (_params: RunSessionParams) => {
      // 模拟 CLI 启动正常但中途抛错（runtime failure）
      throw new Error("simulated CLI subprocess failure");
    }) as RunSessionFn;

    const scheduler = new EvaScheduler(handle.db, barrier.broadcast, mockThrowingRunSession);
    scheduler.initialize();  // Loop 6: explicit boot step

    barrier.reset();
    const tick = await scheduler.tick(fx.projectId);
    assert(tick.issued === true, `tick issued strategy stage`);
    const terminal = await barrier.waitForTerminal();
    assert(terminal === "failed", `barrier terminated with stage_failed (not stage_done)`);

    // 验证 1: failed_reason='cli_failed' 落库
    // cross m2 应用：DB schema 允许 NULL，类型反映这点；assertion 显式 not-null check
    const stageRow = handle.db
      .prepare("SELECT id, status, failed_reason, failed_at, ended_at FROM stage WHERE issue_id = ? AND kind = 'strategy'")
      .get(fx.issueId) as {
        id: string;
        status: string;
        failed_reason: string | null;
        failed_at: number | null;
        ended_at: number | null;
      };
    assert(stageRow.status === "failed", `stage.status='failed' (got ${stageRow.status})`);
    assert(
      stageRow.failed_reason === "cli_failed",
      `stage.failed_reason='cli_failed' (got '${stageRow.failed_reason}')`,
    );
    assert(stageRow.failed_at != null && stageRow.failed_at > 0, `failed_at timestamp set`);
    assert(stageRow.ended_at != null && stageRow.ended_at > 0, `ended_at timestamp set`);

    // 验证 2: stage_failed broadcast event 被发出（Loop 2 wired）
    const failedEvents = broadcasts.filter(
      (m) => m.type === "harness_event" && m.kind === "stage_failed",
    );
    assert(failedEvents.length === 1, `1 stage_failed broadcast emitted (got ${failedEvents.length})`);
    assert(
      typeof failedEvents[0].payload?.error === "string" &&
      failedEvents[0].payload.error.includes("simulated CLI"),
      `stage_failed broadcast carries error string`,
    );

    // 验证 3: stage_changed:failed broadcast 也被发出（H14 wired）
    const failedChanged = broadcasts.filter(
      (m) => m.type === "harness_event" && m.kind === "stage_changed" && m.status === "failed",
    );
    assert(failedChanged.length === 1, `1 stage_changed:failed broadcast`);

    // 验证 4: cross-Loop integration — Loop 3 skip API 真能 unblock
    const skipResult = skipFailedStage(handle.db, stageRow.id);
    assert(skipResult.ok === true, `Loop 3 skipFailedStage returns ok on cli_failed stage`);
    const afterSkip = handle.db
      .prepare("SELECT status, failed_reason FROM stage WHERE id = ?")
      .get(stageRow.id) as { status: string; failed_reason: string };
    assert(afterSkip.status === "skipped", `after skip: status='skipped'`);
    assert(
      afterSkip.failed_reason === "cli_failed",
      `failed_reason preserved across skip (diagnostic value retained — Loop 3 design promise)`,
    );

    // 验证 5: re-tick after skip → next stage (implement) issued
    barrier.reset();
    const tick2 = await scheduler.tick(fx.projectId);
    assert(tick2.issued === true, `re-tick issues next stage after skip (got: ${tick2.stageKind})`);
    assert(tick2.stageKind === "implement", `next stage is implement`);
    await barrier.waitForTerminal();

    // 验证 6: BONUS — implement 失败 reason 是 'spawn_setup_failed'（不是 cli_failed）。
    // 因为 strategy 被 skip 而非 approved，没产生 spec artifact，ContextManager mustHave='spec'
    // 检查找不到 → buildContextBundle 抛 ContextBundleMissingMustInclude → Phase A catch
    // → setStageFailed('spawn_setup_failed')。
    //
    // 这意外覆盖了 Loop 5 charter 排除的 Phase A 失败路径（plan v2 OQ-G 留给 Loop 6+，
    // 但这条跨 Loop 集成天然触发，证明 Phase A 写入路径在真 runtime 下工作）。
    // 也验证了 Loop 3 skip API 的设计副作用：skip strategy 后续 stage 会因 mustHave 失败。
    // 这是 plan v2 §3 #1.3 提到 "完整 retry policy" 留 Loop 4+ 时承认的 trade-off。
    const implementRow = handle.db
      .prepare("SELECT status, failed_reason FROM stage WHERE issue_id = ? AND kind = 'implement'")
      .get(fx.issueId) as { status: string; failed_reason: string };
    assert(
      implementRow.status === "failed",
      `implement stage status='failed' after skip-without-harvest`,
    );
    assert(
      implementRow.failed_reason === "spawn_setup_failed",
      `BONUS: implement → spawn_setup_failed (Phase A bundle resolution caught skip 'd strategy missing spec — got '${implementRow.failed_reason}')`,
    );

    console.log("  ✅ Scenario 1 PASS");
  } finally {
    if (handle) handle.close();
    rmSync(fx.tmpDir, { recursive: true, force: true });
  }
}

// =============================================================================
// Scenario 2: Phase C (spec_harvest_failed) — strategy succeeds in CLI but doesn't write spec.md
// =============================================================================
async function scenarioSpecHarvestFailed(): Promise<void> {
  console.log("\n=== Scenario 2: spec_harvest_failed (Phase C — strategy resolves but no spec.md) ===");
  const fx = setupFixture("spec-harvest");
  let handle: ReturnType<typeof openHarnessDb> | null = null;
  try {
    handle = openHarnessDb({ dbPath: fx.dbPath });
    seed(handle, fx);

    const broadcasts: Array<any> = [];
    const barrier = buildBroadcastBarrier(broadcasts);

    // mock runSession 不写 spec.md → strategy stage harvest 找不到文件抛错 → spec_harvest_failed
    const mockRunSessionNoSpec: RunSessionFn = (async (params: RunSessionParams) => {
      // 啥也不做（不写文件），让 harvestSpecArtifact 抛错
      params.onMessage({ type: "system", subtype: "init", session_id: "mock" });
      params.onMessage({ type: "result", session_id: "mock" });
    }) as RunSessionFn;

    const scheduler = new EvaScheduler(handle.db, barrier.broadcast, mockRunSessionNoSpec);
    scheduler.initialize();  // Loop 6: explicit boot step

    barrier.reset();
    const tick = await scheduler.tick(fx.projectId);
    assert(tick.issued === true, `tick issued strategy stage`);
    const terminal = await barrier.waitForTerminal();
    assert(terminal === "failed", `strategy stage terminated with stage_failed (no spec.md → harvest fails)`);

    // 验证 1: failed_reason='spec_harvest_failed' 落库（cross m2 应用：nullable 类型 + 显式 check）
    const stageRow = handle.db
      .prepare("SELECT status, failed_reason, failed_at FROM stage WHERE issue_id = ? AND kind = 'strategy'")
      .get(fx.issueId) as { status: string; failed_reason: string | null; failed_at: number | null };
    assert(stageRow.status === "failed", `strategy stage status='failed'`);
    assert(
      stageRow.failed_reason === "spec_harvest_failed",
      `failed_reason='spec_harvest_failed' (got '${stageRow.failed_reason}')`,
    );
    assert(stageRow.failed_at != null, `failed_at set`);

    // 验证 2: stage_failed broadcast carries informative error
    const failedEvents = broadcasts.filter(
      (m) => m.type === "harness_event" && m.kind === "stage_failed",
    );
    assert(failedEvents.length === 1, `1 stage_failed broadcast emitted`);
    assert(
      typeof failedEvents[0].payload?.error === "string",
      `stage_failed broadcast carries error string`,
    );

    // 验证 3: 没有 artifact 被创建（strategy 失败前）
    const artifactCount = (handle.db
      .prepare("SELECT count(*) as n FROM artifact WHERE kind = 'spec'")
      .get() as { n: number }).n;
    assert(artifactCount === 0, `no spec artifact created on harvest failure`);

    // 验证 4: stage_message events 仍发出（runSession 触发了 onMessage）
    // 这证明 Phase B 走完，Phase C 才抛错
    const messageEvents = broadcasts.filter(
      (m) => m.type === "harness_event" && m.kind === "stage_message",
    );
    assert(
      messageEvents.length === 2,
      `2 stage_message events fired before harvest failure (Phase B completed before Phase C threw)`,
    );

    console.log("  ✅ Scenario 2 PASS");
  } finally {
    if (handle) handle.close();
    rmSync(fx.tmpDir, { recursive: true, force: true });
  }
}

// =============================================================================
// Scenario 3: idempotent failure — re-instantiate scheduler after a failure shouldn't re-fail
// =============================================================================
async function scenarioFailureIdempotent(): Promise<void> {
  console.log("\n=== Scenario 3: failure idempotent — restart scheduler shouldn't change reason ===");
  const fx = setupFixture("idempotent");
  let handle: ReturnType<typeof openHarnessDb> | null = null;
  try {
    handle = openHarnessDb({ dbPath: fx.dbPath });
    seed(handle, fx);

    const broadcasts: Array<any> = [];
    const barrier = buildBroadcastBarrier(broadcasts);

    const mockThrowingRunSession: RunSessionFn = (async (_p: RunSessionParams) => {
      throw new Error("first failure");
    }) as RunSessionFn;

    const scheduler = new EvaScheduler(handle.db, barrier.broadcast, mockThrowingRunSession);
    scheduler.initialize();  // Loop 6: explicit boot step
    barrier.reset();
    await scheduler.tick(fx.projectId);
    await barrier.waitForTerminal();

    // 验证 first run 落 cli_failed（cross m2 应用：nullable 类型 + 显式 not-null）
    const before = handle.db
      .prepare("SELECT failed_reason, failed_at FROM stage WHERE issue_id = ? AND kind = 'strategy'")
      .get(fx.issueId) as { failed_reason: string | null; failed_at: number | null };
    assert(before.failed_reason === "cli_failed", `first run: cli_failed`);
    assert(before.failed_at != null, `first run: failed_at set`);
    const firstFailedAt = before.failed_at!;

    // 重新实例化 scheduler + initialize — 模拟 backend 重启 (Loop 6)
    // 但当前 stage 是 'failed'，cleanupOrphanStages 只清 active 状态（pending/dispatched/running），
    // 所以不应该被改动。verify failed_reason 不变 + failed_at 不变。
    await new Promise((r) => setTimeout(r, 5)); // 时间往前移
    const scheduler2 = new EvaScheduler(handle.db, () => {}, mockThrowingRunSession);
    scheduler2.initialize();  // Loop 6: explicit boot step

    const after = handle.db
      .prepare("SELECT failed_reason, failed_at FROM stage WHERE issue_id = ? AND kind = 'strategy'")
      .get(fx.issueId) as { failed_reason: string | null; failed_at: number | null };
    assert(
      after.failed_reason === "cli_failed" && after.failed_at === firstFailedAt,
      `restart: failed_reason and failed_at unchanged (cleanup ignores already-failed stages)`,
    );

    console.log("  ✅ Scenario 3 PASS");
  } finally {
    if (handle) handle.close();
    rmSync(fx.tmpDir, { recursive: true, force: true });
  }
}

// === Main driver ===
try {
  console.log("=== Loop 5: failure-path e2e pipeline test ===");
  console.log(`(DATA_DIR isolation: ${dataDirRoot})`);

  await scenarioCliFailed();
  await scenarioSpecHarvestFailed();
  await scenarioFailureIdempotent();

  // 跨 Loop 验证总结：4 canonical reasons (Loop 2) 全部覆盖（cross m1 修正后）：
  //   - cli_failed (Phase B) — Scenario 1 直接注入抛错触发
  //   - spec_harvest_failed (Phase C) — Scenario 2 不写 spec.md 触发
  //   - spawn_setup_failed (Phase A) — Scenario 1 verification 6 跨 Loop 集成意外覆盖
  //     （skip strategy → implement mustHave 找不到 → Phase A 抛 → setStageFailed）
  //   - orphan_after_restart — 已在 test-scheduler-orphan-cleanup 覆盖
  // 直接注入 Phase A 失败（mock buildContextBundle/createTask 抛错）仍留 Loop 6+。
  console.log("\n=== Loop 5 summary ===");
  console.log("✓ cli_failed (Phase B) — verified end-to-end with stage_failed broadcast + skip API integration");
  console.log("✓ spec_harvest_failed (Phase C) — verified end-to-end on strategy stage");
  console.log("✓ failure idempotent across scheduler restart (cleanup respects already-failed stages)");
  console.log("✓ Loop 3 skip API integration: failed → skipped → next-stage advance");
  console.log("✓ failed_reason / failed_at persistence consistent across all scenarios");

  console.log("\nLoop 5 failure-path e2e OK ✅");
} finally {
  rmSync(dataDirRoot, { recursive: true, force: true });
}
