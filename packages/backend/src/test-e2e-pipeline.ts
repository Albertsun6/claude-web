// M2 Loop 4 — e2e reproducible pipeline test
//
// 验证 issue → strategy stage → harvest spec.md → implement stage → done 完整流水线
// 可重复跑（每次 mkdtemp 全新 DB + cwd），不调真 Claude CLI（mock runSessionFn 注入）。
//
// 设计：
//   - **关键** (cross B1)：CLAUDE_WEB_DATA_DIR 在任何 DATA_DIR-touching dynamic import
//     之前设到 mkdtemp 目录 — 防止 audit log 写到真 ~/.claude-web。harness-queries.ts
//     的 `const AUDIT_PATH = join(DATA_DIR, "harness-audit.jsonl")` 在模块求值时定型，
//     必须用 dynamic import 让它在 env 之后加载。
//   - mkdtemp 临时 DB 跑 schema v102；mkdtemp 临时 cwd 模拟 project working directory
//   - mock runSessionFn 通过 closure 持有 db ref，反查 stage.kind 决定行为：
//     * strategy: writeFileSync(cwd/docs/specs/<issueId>.md, "# Mock spec...")
//                 让真实 harvestSpecArtifact 走完 fs read + createArtifact
//     * implement: noop（无 fs 写）
//     * 触发 onMessage(system init) + onMessage(result) 模拟 stream
//   - tick → 等 stage_done broadcast → assert state machine + DB + audit
//   - 跑两次完整 e2e 验证 reproducibility（结构等价，非 byte 等价；不同 issueId / stageId）
//
// 跑法：pnpm --filter @claude-web/backend test:e2e-pipeline

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// type-only imports are erased at compile time → no runtime DATA_DIR side effect.
import type { RunSessionFn } from "./scheduler.js";
import type { RunSessionParams } from "./cli-runner.js";

// === 关键：DATA_DIR isolation BEFORE any dynamic import that reads it (cross B1)
// 不能用 static value imports，因为 harness-queries.ts AUDIT_PATH 在模块求值时立即定型。
// type-only imports（上面 `import type`）安全，TypeScript 编译时擦除。
const dataDirRoot = mkdtempSync(join(tmpdir(), "loop4-datadir-"));
process.env.CLAUDE_WEB_DATA_DIR = dataDirRoot;

// 现在 dynamic import 业务模块（值），DATA_DIR 解析为 dataDirRoot
const { openHarnessDb } = await import("./harness-store.js");
const { EvaScheduler } = await import("./scheduler.js");

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
  const tmpDir = mkdtempSync(join(tmpdir(), `loop4-${label}-`));
  const dbPath = join(tmpDir, "harness.db");
  const projectCwd = join(tmpDir, "project-cwd");
  mkdirSync(projectCwd, { recursive: true });
  mkdirSync(join(projectCwd, "docs", "specs"), { recursive: true });

  return {
    tmpDir,
    dbPath,
    projectCwd,
    projectId: `proj-${label}`,
    methodologyId: `meth-${label}`,
    issueId: `issue-${label}`,
  };
}

function seed(handle: ReturnType<typeof openHarnessDb>, fx: E2EFixture): void {
  const now = Date.now();
  handle.db.prepare(
    "INSERT INTO methodology(id,stage_kind,version,applies_to,content_ref,approved_by,approved_at) VALUES(?,?,?,?,?,?,?)",
  ).run(fx.methodologyId, "spec", "1.0", "universal", "x", "user", now);
  handle.db.prepare(
    "INSERT INTO harness_project(id,cwd,name,worktree_root,created_at) VALUES(?,?,?,?,?)",
  ).run(fx.projectId, fx.projectCwd, `proj-${fx.projectId}`, `${fx.projectCwd}/.wt`, now);
  handle.db.prepare(
    `INSERT INTO issue(id,project_id,source,title,body,labels_json,priority,status,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(fx.issueId, fx.projectId, "manual", "e2e test issue", "build a thing", "[]", "normal", "triaged", now, now);
}

/**
 * 创建一个 mock runSessionFn：
 * - 通过 taskId='<issueId>/<stageId>' 反查 stage.kind
 * - strategy: writeFileSync spec.md 让 harvestSpecArtifact 真跑
 * - implement: noop
 * - 总是触发 onMessage(system init) + onMessage(result)
 */
function buildMockRunSession(
  handle: ReturnType<typeof openHarnessDb>,
): RunSessionFn {
  return (async (params: RunSessionParams): Promise<void> => {
    const parts = (params.taskId ?? "").split("/");
    const stageId = parts.length === 2 ? parts[1] : null;
    if (!stageId) throw new Error(`mock: invalid taskId='${params.taskId}'`);

    const stage = handle.db
      .prepare("SELECT id, kind, issue_id FROM stage WHERE id = ?")
      .get(stageId) as { id: string; kind: string; issue_id: string } | undefined;
    if (!stage) throw new Error(`mock: stage ${stageId} not found`);

    if (stage.kind === "strategy") {
      const specPath = join(params.cwd, "docs", "specs", `${stage.issue_id}.md`);
      writeFileSync(
        specPath,
        `# Mock spec for ${stage.issue_id}\n\n` +
        `## Problem\nBuild a thing.\n\n` +
        `## Approach\nMock implementation strategy.\n\n` +
        `## Tests\nUnit test the thing.\n`,
      );
    }

    params.onMessage({
      type: "system",
      subtype: "init",
      session_id: `mock-session-${stageId}`,
    });
    params.onMessage({
      type: "result",
      session_id: `mock-session-${stageId}`,
    });
  }) as RunSessionFn;
}

interface PipelineRunResult {
  issueStatus: string;
  strategyStatus: string;
  implementStatus: string;
  specArtifactCount: number;
  failedReasonRows: number;
  broadcastCounts: Record<string, number>;
}

async function runOnePipeline(label: string): Promise<PipelineRunResult> {
  const fx = setupFixture(label);
  let handle: ReturnType<typeof openHarnessDb> | null = null;
  try {
    handle = openHarnessDb({ dbPath: fx.dbPath });
    seed(handle, fx);

    const broadcasts: Array<any> = [];
    let resolveDone: (() => void) | null = null;
    let donePromise = new Promise<void>((r) => { resolveDone = r; });
    const wrappedBroadcast = (msg: any) => {
      broadcasts.push(msg);
      if (msg.type === "harness_event" && msg.kind === "stage_done") {
        resolveDone?.();
      }
    };

    const mockRunSession = buildMockRunSession(handle);
    const scheduler = new EvaScheduler(handle.db, wrappedBroadcast, mockRunSession);

    // === Tick 1: strategy ===
    donePromise = new Promise<void>((r) => { resolveDone = r; });
    const tick1 = await scheduler.tick(fx.projectId);
    if (!tick1.issued) throw new Error(`tick 1 did not issue: ${tick1.reason}`);
    if (tick1.stageKind !== "strategy") throw new Error(`tick 1 expected strategy, got ${tick1.stageKind}`);
    await donePromise;

    // === Tick 2: implement ===
    donePromise = new Promise<void>((r) => { resolveDone = r; });
    const tick2 = await scheduler.tick(fx.projectId);
    if (!tick2.issued) throw new Error(`tick 2 did not issue: ${tick2.reason}`);
    if (tick2.stageKind !== "implement") throw new Error(`tick 2 expected implement, got ${tick2.stageKind}`);
    await donePromise;

    // === Tick 3: should mark issue done ===
    const tick3 = await scheduler.tick(fx.projectId);
    if (tick3.issued) throw new Error(`tick 3 unexpectedly issued ${tick3.stageKind}`);

    const issueRow = handle.db
      .prepare("SELECT status FROM issue WHERE id = ?")
      .get(fx.issueId) as { status: string };
    const strategyRow = handle.db
      .prepare("SELECT status FROM stage WHERE issue_id = ? AND kind = 'strategy'")
      .get(fx.issueId) as { status: string };
    const implementRow = handle.db
      .prepare("SELECT status FROM stage WHERE issue_id = ? AND kind = 'implement'")
      .get(fx.issueId) as { status: string };
    const specCount = (handle.db
      .prepare("SELECT count(*) as n FROM artifact WHERE kind = 'spec'")
      .get() as { n: number }).n;
    const failedRows = (handle.db
      .prepare("SELECT count(*) as n FROM stage WHERE failed_reason IS NOT NULL")
      .get() as { n: number }).n;

    const counts: Record<string, number> = {};
    for (const m of broadcasts) {
      if (m.type === "harness_event") {
        const k = `${m.kind}${m.status ? `:${m.status}` : ""}`;
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }

    return {
      issueStatus: issueRow.status,
      strategyStatus: strategyRow.status,
      implementStatus: implementRow.status,
      specArtifactCount: specCount,
      failedReasonRows: failedRows,
      broadcastCounts: counts,
    };
  } finally {
    // cross M2: cleanup ALWAYS runs, even on assertion failure / mock error / SQL error
    if (handle) handle.close();
    rmSync(fx.tmpDir, { recursive: true, force: true });
  }
}

// === 主 driver ===
try {
  console.log("=== Loop 4: e2e reproducible pipeline test ===\n");
  console.log(`(Test DATA_DIR isolation: ${dataDirRoot})\n`);

  console.log("--- Run #1 ---");
  const r1 = await runOnePipeline("run1");
  console.log(JSON.stringify(r1, null, 2), "\n");

  // === Run 1 状态机 + 业务结果断言 ===
  assert(r1.issueStatus === "done", `Run 1: issue.status='done' (got: ${r1.issueStatus})`);
  assert(r1.strategyStatus === "approved", `Run 1: strategy stage approved`);
  assert(r1.implementStatus === "approved", `Run 1: implement stage approved`);
  assert(r1.specArtifactCount === 1, `Run 1: 1 spec artifact harvested`);
  assert(r1.failedReasonRows === 0, `Run 1: no failed_reason rows (no failures)`);

  // === Run 1 broadcast counts（cross M3 应用：含 stage_message 验证）===
  // 期望：每 stage 1 stage_started + 多次 stage_changed (dispatched/running/approved) + 1 stage_done
  // + mock 触发 2 onMessage → broadcast 转发为 2 stage_message → 两 stage 共 4
  assert(
    (r1.broadcastCounts["stage_started"] ?? 0) === 2,
    `Run 1: 2 stage_started events`,
  );
  assert(
    (r1.broadcastCounts["stage_done"] ?? 0) === 2,
    `Run 1: 2 stage_done events`,
  );
  assert(
    (r1.broadcastCounts["stage_changed:dispatched"] ?? 0) === 2,
    `Run 1: 2 stage_changed dispatched events`,
  );
  assert(
    (r1.broadcastCounts["stage_changed:running"] ?? 0) === 2,
    `Run 1: 2 stage_changed running events`,
  );
  assert(
    (r1.broadcastCounts["stage_changed:approved"] ?? 0) === 2,
    `Run 1: 2 stage_changed approved events`,
  );
  assert(
    (r1.broadcastCounts["stage_message"] ?? 0) === 4,
    `Run 1: 4 stage_message events (2 stages × 2 onMessage each — cross M3)`,
  );

  // === Reproducibility: Run 2 ===
  console.log("\n--- Run #2 (reproducibility check) ---");
  const r2 = await runOnePipeline("run2");
  console.log(JSON.stringify(r2, null, 2), "\n");

  assert(r2.issueStatus === r1.issueStatus, `Run 2: issue.status matches Run 1`);
  assert(r2.strategyStatus === r1.strategyStatus, `Run 2: strategy status matches`);
  assert(r2.implementStatus === r1.implementStatus, `Run 2: implement status matches`);
  assert(r2.specArtifactCount === r1.specArtifactCount, `Run 2: spec count matches`);
  assert(r2.failedReasonRows === r1.failedReasonRows, `Run 2: failed_reason count matches`);

  // === Bidirectional broadcast count 等价（cross m1 应用）：
  // 不只检查 r1 keys 在 r2 中匹配；也检查 r2 没有 r1 没有的 keys（防新事件 silent regression）。
  const k1 = new Set(Object.keys(r1.broadcastCounts));
  const k2 = new Set(Object.keys(r2.broadcastCounts));
  assert(
    k1.size === k2.size && [...k1].every((k) => k2.has(k)),
    `Run 2: broadcast key set matches Run 1 (${[...k1].sort().join(",")})`,
  );
  for (const k of k1) {
    assert(
      r2.broadcastCounts[k] === r1.broadcastCounts[k],
      `Run 2: broadcast '${k}' count matches Run 1 (${r1.broadcastCounts[k]})`,
    );
  }

  // === cross M1 应用：audit 行为断言（DATA_DIR 已 isolated 到 dataDirRoot）===
  // 跨两 runs 累积写到同 DATA_DIR/harness-audit.jsonl
  const auditPath = join(dataDirRoot, "harness-audit.jsonl");
  // 等 fire-and-forget audit appends 落地（每 audit() 调 appendFile + .catch()）
  await new Promise((r) => setTimeout(r, 50));
  assert(existsSync(auditPath), `audit log written to isolated DATA_DIR (NOT to ~/.claude-web)`);

  const auditLines = readFileSync(auditPath, "utf-8").split("\n").filter(Boolean);
  const auditByAction: Record<string, number> = {};
  for (const line of auditLines) {
    try {
      const entry = JSON.parse(line) as { action: string };
      auditByAction[entry.action] = (auditByAction[entry.action] ?? 0) + 1;
    } catch {
      // ignore parse errors
    }
  }
  console.log("Audit action distribution:", JSON.stringify(auditByAction));

  // 每 run 4 stages 状态变迁（dispatched/running/approved 各 stage 至少 3 次 set_status，
  // 但 stage 表 audit 的是 createStage(create) + setStageStatus(set_status)；
  // strategy harvest 写 1 artifact create；createTask = create task；createContextBundle = create.
  // 跨 2 runs 至少应该有：
  //   - create stage: ≥4（2 stages × 2 runs）
  //   - set_status: ≥10（每 stage 3 transitions × 2 stages × 2 runs ≈ 12）
  //   - create artifact: ≥2（spec × 2 runs）
  //   - set_failed: 0（happy path 无失败）
  assert(
    (auditByAction["create"] ?? 0) >= 4,
    `audit: ≥4 create entries across 2 runs (got ${auditByAction["create"] ?? 0})`,
  );
  assert(
    (auditByAction["set_status"] ?? 0) >= 10,
    `audit: ≥10 set_status entries across 2 runs (got ${auditByAction["set_status"] ?? 0})`,
  );
  assert(
    (auditByAction["set_failed"] ?? 0) === 0,
    `audit: 0 set_failed entries on happy path (got ${auditByAction["set_failed"] ?? 0})`,
  );

  console.log("\nLoop 4 e2e pipeline OK ✅");
} finally {
  // 清理隔离的 DATA_DIR（含 audit log）
  rmSync(dataDirRoot, { recursive: true, force: true });
}
