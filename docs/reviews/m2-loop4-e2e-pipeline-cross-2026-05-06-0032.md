# Cross Review — M2 Loop 4 E2E Reproducible Pipeline Test

**Reviewer**: reviewer-cross  
**Model**: GPT-5.5  
**Date**: 2026-05-06 00:32  
**Files reviewed**:
- `packages/backend/src/scheduler.ts`
- `packages/backend/src/test-e2e-pipeline.ts`
- `packages/backend/package.json`
- `packages/backend/src/routes/harness.ts`
- `packages/backend/src/harness-queries.ts`
- `packages/backend/src/harness-store.ts`
- `packages/backend/src/data-dir.ts`
- `packages/backend/src/migrations/0001_initial.sql`
- `packages/backend/src/migrations/0002_stage_status_dispatched.sql`
- `packages/backend/src/migrations/0003_stage_failed_reason.sql`
- `packages/shared/src/protocol.ts`

---

## Summary

- Blockers: 1
- Majors: 3
- Minors: 2
- 总体判断：必须先修。Loop 4 的生产注入点本身是保守的，`new EvaScheduler(db, broadcast)` 仍走默认真 `runSession`；但 e2e test 当前不满足“fixture-only / no prod data access / audit verified”的 charter。

## Numeric Score

| Lens | Score (0..5) |
|---|---:|
| 正确性 | 3.3 |
| 跨端对齐 | 4.6 |
| 不可逆 | 4.7 |
| 安全 | 2.8 |
| 简化 | 3.8 |

**Overall score**: 3.8（有 blocker，上限 3.9）

---

## Loop 4 Charter Compliance

**结论：部分合规，但有一个 charter blocker。**

- 合规：没有看到新 schema / migration / protocol / route。实际改动面是 `scheduler.ts` 的可选 runtime 注入、`test-e2e-pipeline.ts` 新测试、`package.json` 新脚本；migration 仍停在 v102，Loop 4 没新增 SQL。
- 合规：没有引入 retry policy / cancellation / runtime_state。`scheduler.ts` 中出现的 `retry` 只是旧的 operator 提示文案和 “M2 接 retry policy” 注释，不是新逻辑。
- 合规：mock injection 没破坏生产默认路径。构造函数第三参默认是 `runSession`，生产路由仍然只传两个参数。

```58:68:packages/backend/src/scheduler.ts
export class EvaScheduler {
  constructor(
    private db: Database.Database,
    private broadcast: (msg: unknown) => void,
    /**
     * M2 Loop 4: optional CLI runtime fn 注入。Default = 真 runSession（spawn claude CLI）。
     * e2e test 注入 mock fn，跳过真 spawn，验证 scheduler 状态机端到端不调真 CLI。
     * Production 用法不传第三参，行为与 v0.5.0 完全一致。
     */
    private runSessionFn: RunSessionFn = runSession,
```

```35:41:packages/backend/src/routes/harness.ts
export function buildHarnessRouter(
  db: Database.Database,
  broadcast: (msg: unknown) => void,
): Hono {
  const app = new Hono();
  const scheduler = new EvaScheduler(db, broadcast);
```

- 不合规：测试不是完全 fixture-only。它的 DB 和 cwd 是 `mkdtemp`，但 audit writer 仍使用模块级 `DATA_DIR`，默认落到 `~/.claude-web/harness-audit.jsonl`。这违反 “mock test runs in mkdtemp, no prod data access”。

---

## Findings

### B1 [BLOCKER] E2E test writes scheduler audit entries to the default user data directory

**Where**: `packages/backend/src/test-e2e-pipeline.ts:23`, `packages/backend/src/harness-queries.ts:15`, `packages/backend/src/data-dir.ts:9`  
**Lens**: 安全 / 正确性  
**Issue**: `test-e2e-pipeline.ts` uses a temp DB and temp cwd, but imports `scheduler.ts` / `harness-queries.ts` statically. `harness-queries.ts` computes `AUDIT_PATH` from module-level `DATA_DIR`, and `DATA_DIR` defaults to `~/.claude-web` when `CLAUDE_WEB_DATA_DIR` is unset. Therefore this e2e test can append test audit entries into the real user data directory.

```15:20:packages/backend/src/harness-queries.ts
const AUDIT_PATH = join(DATA_DIR, "harness-audit.jsonl");

function audit(db: Database.Database, action: string, entity: string, id: string, data: unknown): void {
  const entry = JSON.stringify({ ts: Date.now(), action, entity, id, data }) + "\n";
  // fire-and-forget; audit failures must never block business writes
  appendFile(AUDIT_PATH, entry).catch(() => {});
```

```9:20:packages/backend/src/data-dir.ts
function resolveDataDir(): string {
  const raw = process.env.CLAUDE_WEB_DATA_DIR;
  if (!raw || raw.trim() === "") {
    return path.join(os.homedir(), ".claude-web");
  }
  const expanded = raw.startsWith("~/") || raw === "~"
    ? path.join(os.homedir(), raw.slice(1))
    : raw;
  return path.resolve(expanded);
}

export const DATA_DIR = resolveDataDir();
```

**Why this is a blocker**: Loop 4 charter explicitly wants a reproducible fixture test with no real runtime side effects. Appending test audit rows into the real `~/.claude-web` state is production-data pollution even though the SQLite DB itself is temp.

**Suggested fix**: Make the test set `CLAUDE_WEB_DATA_DIR` before importing modules that read `DATA_DIR`. Because ESM static imports are evaluated before top-level code, this likely needs a small bootstrap test entry or dynamic imports after env setup. Then assert the temp audit file exists and contains expected scheduler write actions.

### M1 [MAJOR] Charter says audit is verified, but the test does not assert audit behavior

**Where**: `packages/backend/src/test-e2e-pipeline.ts:124`, `packages/backend/src/test-e2e-pipeline.ts:171`, `packages/backend/src/test-e2e-pipeline.ts:217`  
**Lens**: 正确性 / 测试保真度  
**Issue**: The test verifies issue status, stage status, artifact count, failed_reason rows, and selected broadcast counts. It does not read or assert `harness-audit.jsonl`, even though real scheduler writes go through `audit()` in `createStage`, `setStageStatus`, `createTask`, `createContextBundle`, and `createArtifact`.

```124:132:packages/backend/src/test-e2e-pipeline.ts
/** 跑一次完整 e2e：strategy → implement → done。返回最终 issue 状态。 */
async function runOnePipeline(label: string): Promise<{
  issueStatus: string;
  strategyStatus: string;
  implementStatus: string;
  specArtifactCount: number;
  failedReasonRows: number;
  broadcastCounts: Record<string, number>;
}> {
```

```217:242:packages/backend/src/test-e2e-pipeline.ts
  assert(r1.issueStatus === "done", `Run 1: issue.status='done' (got: ${r1.issueStatus})`);
  assert(r1.strategyStatus === "approved", `Run 1: strategy stage approved`);
  assert(r1.implementStatus === "approved", `Run 1: implement stage approved`);
  assert(r1.specArtifactCount === 1, `Run 1: 1 spec artifact harvested`);
  assert(r1.failedReasonRows === 0, `Run 1: no failed_reason rows (no failures)`);
  // 期望事件：每 stage 1 stage_started + 多次 stage_changed (dispatched/running/approved) + 1 stage_done
  assert(
    (r1.broadcastCounts["stage_started"] ?? 0) === 2,
    `Run 1: 2 stage_started events (got ${r1.broadcastCounts["stage_started"] ?? 0})`,
  );
```

**Why this matters**: MD3 was supposed to prove “state machine + audit + reproducibility”. As written, the audit part is both unisolated and unverified.

**Suggested fix**: After fixing `CLAUDE_WEB_DATA_DIR`, wait for the fire-and-forget audit appends to settle or expose a test hook, then assert a structural audit summary: expected actions for two stages and one artifact, no `set_failed`, all entries in the temp data dir.

### M2 [MAJOR] Temp DB/cwd cleanup is not in `finally`

**Where**: `packages/backend/src/test-e2e-pipeline.ts:133`, `packages/backend/src/test-e2e-pipeline.ts:197`, `packages/backend/src/test-e2e-pipeline.ts:263`  
**Lens**: 安全 / 运维风险  
**Issue**: `runOnePipeline()` only closes the DB and removes `fx.tmpDir` at the successful end. Any assertion, SQLite error, mock error, or scheduler throw before those lines leaves a temp DB/cwd behind. The top-level catch then exits the process.

```133:139:packages/backend/src/test-e2e-pipeline.ts
  const fx = setupFixture(label);
  const handle = openHarnessDb({ dbPath: fx.dbPath });
  seed(handle, fx);

  const broadcasts: Array<any> = [];
  const broadcast = (msg: any) => broadcasts.push(msg);
```

```197:198:packages/backend/src/test-e2e-pipeline.ts
  handle.close();
  rmSync(fx.tmpDir, { recursive: true, force: true });
```

```263:266:packages/backend/src/test-e2e-pipeline.ts
})().catch((err) => {
  console.error("e2e pipeline FAILED:", err);
  process.exit(1);
});
```

**Suggested fix**: Wrap each run in `try/finally`, close `handle` if opened, and always `rmSync(fx.tmpDir, { recursive: true, force: true })`. This becomes more important once `CLAUDE_WEB_DATA_DIR` is also pointed into the same temp tree.

### M3 [MAJOR] Mock stream emits messages, but the test never verifies `stage_message`

**Where**: `packages/backend/src/test-e2e-pipeline.ts:109`, `packages/backend/src/scheduler.ts:351`, `packages/backend/src/test-e2e-pipeline.ts:188`, `packages/backend/src/test-e2e-pipeline.ts:222`  
**Lens**: 测试保真度 / 正确性  
**Issue**: The mock emits two `onMessage` events per stage, and production scheduler wraps those into `harness_event` / `stage_message`. The count collector would count those events, but the assertions ignore them. A regression that stops forwarding `onMessage` to broadcasts would still pass.

```109:118:packages/backend/src/test-e2e-pipeline.ts
    // 模拟 stream events
    params.onMessage({
      type: "system",
      subtype: "init",
      session_id: `mock-session-${stageId}`,
    });
    params.onMessage({
      type: "result",
      session_id: `mock-session-${stageId}`,
    });
```

```351:357:packages/backend/src/scheduler.ts
        onMessage: (msg) => {
          this.broadcast({
            type: "harness_event",
            kind: "stage_message",
            payload: { issueId: issue.id, stageId: stage.id, taskId, msg },
          });
        },
```

**Suggested fix**: Assert `stage_message === 4` across the full run, and preferably assert the two message types per stage are `system/init` and `result`. This still avoids real Claude CLI while checking the scheduler's real message-forwarding behavior.

### m1 [MINOR] Reproducibility comparison is asymmetric

**Where**: `packages/backend/src/test-e2e-pipeline.ts:254`  
**Lens**: 正确性 / 简化  
**Issue**: The reproducibility loop checks every key present in Run #1 against Run #2, but it does not fail if Run #2 has extra broadcast kinds. For example, if a new event appears only in Run #2 due to a timing or ordering bug, this loop would not catch it.

```254:260:packages/backend/src/test-e2e-pipeline.ts
  // broadcast 计数应一致（reproducibility 核心）
  for (const k of Object.keys(r1.broadcastCounts)) {
    assert(
      r2.broadcastCounts[k] === r1.broadcastCounts[k],
      `Run 2: broadcast '${k}' count matches Run 1 (${r1.broadcastCounts[k]})`,
    );
  }
```

**Suggested fix**: Compare normalized objects exactly: sort keys from both runs, assert key sets equal, then assert counts equal.

### m2 [MINOR] Reproducibility is structural, not byte-identical; that is the right model, but the test should say it more explicitly

**Where**: `packages/backend/src/test-e2e-pipeline.ts:44`, `packages/backend/src/test-e2e-pipeline.ts:244`  
**Lens**: 正确性 / 简化  
**Issue**: Each run uses different temp dirs and different fixture IDs (`issue-run1`, `issue-run2`, etc.), while real stage/task/artifact IDs are random UUIDs. So byte equality would be the wrong assertion. The current check is correctly aiming for structural equivalence, but it only partially documents that boundary.

```44:58:packages/backend/src/test-e2e-pipeline.ts
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
```

**Suggested fix**: Keep structural equivalence, but encode it as a named summary type and avoid implying stable IDs should match. Do not compare stage IDs across runs.

---

## Test Fidelity Assessment

This test exercises real `EvaScheduler`, real `buildContextBundle`, real `createStage` / `setStageStatus` / `createTask`, real `harvestSpecArtifact`, real filesystem read of `docs/specs/<issueId>.md`, and real SQLite migrations through `openHarnessDb`. That is a meaningful e2e slice for the scheduler state machine.

The mock deliberately skips real `runSession` subprocess behavior, which is correct under OQ-D. But the test therefore does **not** prove real Claude CLI stream parsing, subprocess exit handling, tool permission behavior, token/session accounting, or real transcript persistence. That is acceptable for Loop 4 only if the test is described as “scheduler pipeline e2e with mocked runtime”, not “production runtime e2e”.

The `stage_done` synchronization is placed correctly: the promise is created before each `tick()`, and `tick()` fire-and-forgets `spawnAgent`. With the current async mock, `stage_done` is emitted after the `await this.runSessionFn(...)` continuation, so the test should not miss the signal.

```153:165:packages/backend/src/test-e2e-pipeline.ts
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
```

The seeded `triaged` issue is valid and is picked by the scheduler. This matches the actual migration enum and the scheduler `ELIGIBLE` set.

```50:60:packages/backend/src/migrations/0001_initial.sql
CREATE TABLE IF NOT EXISTS issue (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES harness_project(id),
  initiative_id     TEXT REFERENCES initiative(id),
  source            TEXT NOT NULL CHECK (source IN ('ideas_md','user_feedback','git_log','telemetry','inbox','manual')),
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  labels_json       TEXT NOT NULL,
  priority          TEXT NOT NULL CHECK (priority IN ('low','normal','high','critical')),
  status            TEXT NOT NULL CHECK (status IN ('inbox','triaged','planned','in_progress','blocked','done','wont_fix')),
```

```147:153:packages/backend/src/scheduler.ts
    // 1. 取待处理 Issue（triaged/planned/in_progress，最旧的先跑）
    const ELIGIBLE: IssueStatus[] = ["triaged", "planned", "in_progress"];
    const issues = listIssues(this.db, { projectId }).filter(
      (i) => ELIGIBLE.includes(i.status as IssueStatus),
    );
    if (!issues.length) {
      return { issued: false, reason: "no eligible issues (triaged/planned/in_progress)" };
```

---

## M2 #1 Pipeline Stability Coverage After Loop 4

Loop 3 estimate was ~40-45%. With Loop 4 as currently written, I would move M2 #1 coverage to **~48-52%**, not higher.

Why it does move up:
- MD3 now has a real scheduler happy-path slice: issue → strategy → real spec harvest → implement → done.
- It covers actual DB migrations, stage status transitions, artifact creation, and selected scheduler broadcasts.
- It checks structural reproducibility over two independent fixture runs.

Why it does not reach much higher:
- Audit is not isolated and not asserted, so one charter component is missing.
- Only happy path is covered. Loop 2 failure reasons (`spawn_setup_failed`, `cli_failed`, `spec_harvest_failed`, `orphan_after_restart`) are not exercised here.
- Runtime fidelity stops at the injected `runSessionFn`; real CLI parsing, process exit, stream shape drift, permission hook behavior, and cancellation/retry exclusions remain outside this test.
- Reproducibility is structural count equivalence, not deterministic artifact/event snapshots. That is acceptable for this layer, but it is not deep reproducibility.

If B1/M1/M3 are fixed, I would count Loop 4 as a solid MD3 implementation and raise M2 #1 to **~52-56%**. Going above ~60% would need at least one failure-path e2e and a tighter runtime-stream fixture, still without invoking the real Claude CLI.

---

## Other Lens Notes

**跨端对齐**: backend-only test infra; no protocol bump. Existing `harness_event` kinds include `stage_started`, `stage_message`, `stage_done`, and `stage_failed`; no `.strict()` leak found in this Loop 4 surface.

```98:110:packages/shared/src/protocol.ts
      type: "harness_event";
      kind:
        | "config_changed"
        | "stage_changed"
        | "task_started"
        | "decision_requested"
        | "task_finished"
        | "review_complete"
        // Scheduler events (M1+)
        | "stage_started"
        | "stage_message"
        | "stage_done"
        | "stage_failed";
```

**不可逆**: low risk. The new constructor param is optional and defaults to the real runtime. No schema, migration, route, or protocol commitment added.

**安全**: current blocker is local data pollution through audit path, not external exposure. The mock itself does not call the real Claude CLI.

**简化**: ~250 lines is acceptable for a hand-written e2e fixture. It can be smaller only after extracting a tiny reusable `runPipelineFixture()` helper; I would not do that before fixing isolation and assertions.

---

## False-Positive Watch

- F? `stage_done` synchronization: I do not think this is a bug because the promise is created before `tick()`, and the current async mock causes the `stage_done` broadcast after the `await runSessionFn` continuation. If the mock is later changed to schedule work out-of-band, this should be revisited.
- F? Direct SQL seeding bypasses the REST issue creation route. I am not marking it because the Loop 4 charter is scheduler pipeline, not route e2e, and new routes were explicitly out of scope.

## What I Did Not Look At

- Did not run `pnpm --filter @claude-web/backend test:e2e-pipeline`; this was a static cross-review.
- Did not inspect prior author transcripts or implementation discussion.
- Did not review frontend or iOS runtime behavior; Loop 4 is backend-only test infra.
- Did not verify real Claude CLI stream output shape; the charter explicitly says to mock `runSession`.
- Did not inspect every historical review file beyond reviewer-cross rules and directly relevant source/migration/protocol files.
