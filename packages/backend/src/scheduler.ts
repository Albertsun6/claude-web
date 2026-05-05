// SEvacheduler — L3 Orchestration 骨架 (M1 minimum slice)
//
// 职责：从 harness.db 读待处理 Issue → 推进 Stage 状态机 → spawn claude CLI agent
//
// M1 scope：
//   - computeNextStage：strategy → implement 两段，完成后 issue 置 done
//   - ContextBundle：最简化，只把 issue title+body 作为 prompt 前缀
//   - 权限模式：M1 用 bypassPermissions（scheduler 无交互 UI）；M2 接 permission hub
//
// M2 交付：ContextManager 真实编排、Review-Orchestrator、worktree 自动创建、permission hub 接入

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ModelHint, modelIdForHint } from "@claude-web/shared";
import { runSession, type RunSessionParams } from "./cli-runner.js";

/**
 * M2 Loop 4: spawnAgent 通过此函数类型调用 CLI runtime；e2e test 注入 mock 版本，
 * 跳过真 Claude CLI subprocess（避免烧 token + 不可重复）。默认值 = 真实 runSession。
 *
 * 必须保持与 cli-runner.ts `runSession` 同签名 — 否则注入会 type-narrow 失败。
 */
export type RunSessionFn = (p: RunSessionParams) => Promise<void>;
import { getHarnessConfig } from "./harness-config.js";
import { buildContextBundle } from "./context-manager.js";
import {
  createArtifact,
  listIssues, listStages, createStage, createTask, setStageStatus, setStageFailed, updateIssueStatus,
  type IssueRow, type StageRow,
} from "./harness-queries.js";

/** Cap spec.md content size when harvesting (M2 v1 3.2-A')。
 *  Char-level (cross m1 修：实际 .length 是 JS chars 不是 UTF-8 bytes — rename for clarity)。
 *  > 16384 chars 的 spec 不正常，先削，记到 audit metadata。M3 上 token-aware budget 时去掉。 */
const SPEC_HARVEST_MAX_CHARS = 16384;

// Stage kind → agentProfile.stage 映射（M1 只走两段）
const STAGE_SEQUENCE: StageKind[] = ["strategy", "implement"];
type StageKind = "strategy" | "implement" | "done";

// Issue 状态枚举（与 migrations/0001_initial.sql CHECK 约束一致）
type IssueStatus = "inbox" | "triaged" | "planned" | "in_progress" | "blocked" | "done" | "wont_fix";
// Stage 完成状态（无 "done"；M1 用 "approved" 表示完成，跳过 review gate）
const STAGE_COMPLETE_STATUSES = new Set(["approved", "rejected", "skipped"]);
// H14: dispatched 也是 active（防止并发 tick 在 dispatched 窗口内重复 spawn）
const STAGE_ACTIVE_STATUSES = new Set(["pending", "dispatched", "running", "awaiting_review"]);

export interface SchedulerTickResult {
  issued: boolean;
  issueId?: string;
  stageKind?: string;
  taskId?: string;
  reason?: string;
}

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
  ) {
    this.cleanupOrphanStages();
  }

  /**
   * F (M2 螺旋圈): backend 启动时清理 orphan active stages。
   *
   * 场景：scheduler.spawnAgent 是 fire-and-forget（tick 立即返回，spawn 后台跑）。
   * backend 在 spawn 中途崩溃（OOM / SIGKILL / launchd kickstart）→ stage 留在
   * pending / dispatched / running，但已无进程会推进它。下次 tick 时这些行被
   * STAGE_ACTIVE_STATUSES 检查阻塞 → 死锁。
   *
   * 修：实例化 EvaScheduler（每次 backend 启动一次）时扫描 active stages，
   * 标 failed + 广播 stage_changed。awaiting_review 不动（合法人审暂停，不是 orphan）。
   *
   * H14 dispatched 状态特别相关：dispatched 是 ContextBundle 写盘 / createTask 阶段，
   * spawn 真起来前如果 backend 崩了就会留下 dispatched orphan。
   *
   * 原子性（cross M1 应用）：所有 DB 更新包在 db.transaction()，整体 all-or-none。
   * broadcast 在 commit 后跑，单条失败 try/catch 吞掉（broadcast 是 UX 通知，不影响
   * DB 已修复的真相；客户端重连时应靠轮询 stage 列表 reconcile —— 见 cross M5 列入
   * M2 master plan）。
   *
   * Boot ordering: 本类在 routes/harness.ts createHarnessRoutes 内实例化，routes 注册
   * 完成才接受 HTTP tick；构造函数同步跑完 cleanup 才返回，单 backend 单 scheduler 假设
   * 下不会发生 cleanup 中途有外部 tick 调用 → 不需要额外锁。多实例场景见 M2 master plan。
   *
   * 注：本方法 mutates DB —— 不是 pure construction。每次 new EvaScheduler 都跑一次。
   * cross m1 列入 M2 master plan：以后改成 explicit init() 由 boot 序列调用。
   */
  private cleanupOrphanStages(): void {
    const orphans = this.db
      .prepare(
        `SELECT id, kind, status FROM stage
         WHERE status IN ('pending', 'dispatched', 'running')`,
      )
      .all() as Array<{ id: string; kind: string; status: string }>;

    if (orphans.length === 0) return;

    // 1. DB 更新走 transaction（all-or-none）—— cross M1 应用
    // M2 Loop 2：写入 failed_reason='orphan_after_restart' 让失败可从 DB 区分
    const cleanupAt = Date.now();
    const applyAll = this.db.transaction(() => {
      for (const stage of orphans) {
        setStageFailed(this.db, stage.id, "orphan_after_restart", cleanupAt);
      }
    });
    applyAll();

    // 2. 广播在 commit 后；单条失败吞掉，不影响其他事件 + 不回滚 DB
    for (const stage of orphans) {
      try {
        this.broadcast({
          type: "harness_event",
          kind: "stage_changed",
          stageId: stage.id,
          status: "failed",
        });
      } catch (e) {
        console.warn(
          `[EvaScheduler] cleanup broadcast failed for ${stage.id}: ${e}`,
        );
      }
    }

    // 3. 日志在最后（transaction 已 commit + broadcast 已尝试 → 状态稳定再 log）
    for (const stage of orphans) {
      console.warn(
        `[EvaScheduler] orphan stage ${stage.id} (${stage.kind}, was ${stage.status}) → failed (backend restart cleanup)`,
      );
    }
    console.log(
      `[EvaScheduler] cleaned up ${orphans.length} orphan active stage(s) on init`,
    );
  }

  // POST /api/harness/scheduler/tick — 手动触发一次推进
  async tick(projectId?: string): Promise<SchedulerTickResult> {
    // 1. 取待处理 Issue（triaged/planned/in_progress，最旧的先跑）
    const ELIGIBLE: IssueStatus[] = ["triaged", "planned", "in_progress"];
    const issues = listIssues(this.db, { projectId }).filter(
      (i) => ELIGIBLE.includes(i.status as IssueStatus),
    );
    if (!issues.length) {
      return { issued: false, reason: "no eligible issues (triaged/planned/in_progress)" };
    }

    const issue = issues[0];

    // 2. 计算下一个 Stage（跳过已完成和进行中的）
    const stages = listStages(this.db, issue.id);
    const nextKind = this.computeNextStage(stages);
    if (nextKind === "blocked") {
      // cross B2: 不主动改 issue status 到 "blocked"。`ELIGIBLE` 不含 blocked，
      // 一旦 set blocked，operator 即使按 reason 操作也会被 ELIGIBLE 过滤掉，
      // 落入死循环。保持 issue 状态可调度，operator 用现有 PATCH 端点 resolve
      // failed stage（status → skipped），下次 tick 自动 advance。
      const failed = stages
        .filter((s) => s.status === "failed")
        .map((s) => `${s.kind}@${s.id.slice(0, 8)}`);
      return {
        issued: false,
        reason: `issue ${issue.id} has failed stage(s) [${failed.join(", ")}]. To retry: PATCH /api/harness/stages/<id> {status: "skipped"} for each failed stage, then re-tick. To abandon: PATCH /api/harness/issues/<id> {status: "wont_fix"}. Issue status kept eligible (no auto-block) so re-tick after stage resolve advances normally.`,
      };
    }
    if (nextKind === "done") {
      updateIssueStatus(this.db, issue.id, "done");
      return { issued: false, reason: `issue ${issue.id} all stages complete → marked done` };
    }

    // 3. 防止并发：已有 active stage 则拒绝
    const hasActive = stages.some(
      (s) => s.kind === nextKind && STAGE_ACTIVE_STATUSES.has(s.status),
    );
    if (hasActive) {
      return { issued: false, reason: `stage ${nextKind} already active for issue ${issue.id}` };
    }

    // 4. 取对应 AgentProfile
    const profile = this.resolveProfile(nextKind);
    if (!profile) {
      return { issued: false, reason: `no enabled profile for stage: ${nextKind}` };
    }

    // 5. 查 project cwd（agent 必须在 project 目录跑）
    const projectCwd = this.getProjectCwd(issue.project_id);
    if (!projectCwd) {
      return { issued: false, reason: `no cwd found for project ${issue.project_id}` };
    }

    // 6. 创建 Stage 记录置 dispatched（H14 v1：scheduler 已 reserve，但 spawn 还没起来）
    //    dispatched → running 在 spawnAgent 调 runSession 前刚好切换。这窗口内
    //    bundle/task setup 阶段失败，stage 直接失败 → 排错语义清晰。
    const stage = createStage(this.db, {
      issueId: issue.id,
      kind: nextKind,
      agentProfileId: profile.id,
    });
    setStageStatus(this.db, stage.id, "dispatched");
    this.broadcast({ type: "harness_event", kind: "stage_changed", stageId: stage.id, status: "dispatched" });
    updateIssueStatus(this.db, issue.id, "in_progress");

    const taskId = `${issue.id}/${stage.id}`;

    // 7. 广播 stage_started（符合 ServerMessage protocol）
    // 注：H14 v1 修：pre-spawn 阶段问题排查应 key on stageId 而非 taskId（taskId 此时
    // 是 synthetic `${issue.id}/${stage.id}`，真 task UUID 在 spawnAgent createTask 时才
    // 写入 DB）。setup 期失败的 stage_failed 广播只能用 stageId 关联到落库的 stage 行。
    this.broadcast({
      type: "harness_event",
      kind: "stage_started",
      payload: { issueId: issue.id, stageId: stage.id, stageKind: nextKind, taskId },
    });

    // 8. 异步 spawn agent（fire-and-forget；tick 立即返回）
    this.spawnAgent(issue, stage, taskId, projectCwd).catch((err) => {
      console.error(`[EvaScheduler] agent error for ${taskId}:`, err);
      // M2 Loop 2: spawnAgent 内层三 try/catch 已经写了 setStageFailed(reason)；
      // 外层 catch 用 idempotent setStageFailed 兜底（如果内层 setStageFailed 自己抛错，
      // 内层 reason 没写进 DB → 兜底用 'unknown_error'；如果内层已写，guard 让它无副作用）。
      setStageFailed(this.db, stage.id, "unknown_error");
      this.broadcast({ type: "harness_event", kind: "stage_changed", stageId: stage.id, status: "failed" });
      this.broadcast({
        type: "harness_event",
        kind: "stage_failed",
        payload: { issueId: issue.id, stageId: stage.id, taskId, error: String(err) },
      });
    });

    return { issued: true, issueId: issue.id, stageKind: nextKind, taskId };
  }

  private computeNextStage(existingStages: StageRow[]): StageKind | "blocked" {
    // dogfood v1 暴露：失败 stage 既不在 COMPLETE 也不在 ACTIVE 集合，导致下次 tick
    // 想再 spawn 同 kind → INSERT 撞 UNIQUE(issue_id, kind)。M1 选保守路线：失败
    // 直接 block，手动 resolve（删 stage 行重跑 OR 标 issue wont_fix）。M2 接 retry policy。
    const hasFailed = existingStages.some((s) => s.status === "failed");
    if (hasFailed) return "blocked";

    const completedKinds = new Set(
      existingStages
        .filter((s) => STAGE_COMPLETE_STATUSES.has(s.status))
        .map((s) => s.kind as StageKind),
    );
    for (const kind of STAGE_SEQUENCE) {
      if (!completedKinds.has(kind)) return kind;
    }
    return "done";
  }

  private resolveProfile(stageKind: string) {
    const config = getHarnessConfig();
    const matched = config.agentProfiles.find((p) => p.stage === stageKind && p.enabled);
    if (matched) return matched;
    // Fallback: 任意 enabled profile（M1 宽松）
    const fallback = config.agentProfiles.find((p) => p.enabled) ?? null;
    if (fallback) {
      console.warn(
        `[EvaScheduler] no enabled profile for stage "${stageKind}", falling back to "${fallback.id}"`,
      );
    }
    return fallback;
  }

  private getProjectCwd(projectId: string): string | null {
    const row = this.db
      .prepare("SELECT cwd FROM harness_project WHERE id = ?")
      .get(projectId) as { cwd: string } | undefined;
    return row?.cwd ?? null;
  }

  private async spawnAgent(
    issue: IssueRow,
    stage: StageRow,
    taskId: string,
    cwd: string,
  ): Promise<void> {
    const config = getHarnessConfig();
    const profile = config.agentProfiles.find((p) => p.id === stage.assigned_agent_profile);

    const rawHint = profile?.modelHint ?? "sonnet";
    const model: ModelHint =
      rawHint === "opus" ? "opus" : rawHint === "haiku" ? "haiku" : "sonnet";

    // Cross M1 修：context_bundle.task_id 必须指向真 task 行（schema 注释明文 "外键
    // 回指 Task"），过去 M1 #3.1 用 synthetic `<issueId>/<stageId>` 留下 orphan 行。
    // 改：先 reserve taskUuid → buildContextBundle 写 context_bundle 行 task_id=taskUuid
    // → createTask 写真 task 行 id=taskUuid 闭环引用。
    // 注：synthetic taskId 仍用作 WS broadcast routing key（人类可读），与 task.id UUID
    // 是两个不同概念，scheduler 内部双 ID。
    const taskUuid = randomUUID();

    // M2 Loop 2：spawnAgent 拆三个 phase + 各自 catch 写 failed_reason，外层 tick catch 仅
    // 兜底通知（失败 reason 已在内层写好；外层 catch 再调 setStageFailed 时 idempotent guard
    // 让首次 reason 不被覆盖）。
    //
    // Phase A — dispatched 窗口：bundle / createTask setup
    let bundle: ReturnType<typeof buildContextBundle>;
    try {
      bundle = buildContextBundle(this.db, {
        issue,
        stage,
        taskId: taskUuid,
        agentProfileId: profile?.id ?? stage.assigned_agent_profile,
      });

      createTask(this.db, {
        id: taskUuid,
        stageId: stage.id,
        agentProfileId: profile?.id ?? stage.assigned_agent_profile,
        model,
        cwd,
        prompt: bundle.prompt,
        permissionMode: "bypassPermissions",
        contextBundleId: bundle.bundleId,
      });
    } catch (err) {
      setStageFailed(this.db, stage.id, "spawn_setup_failed");
      throw err;
    }

    // modelHint → CLI --model 字符串映射的 single source 在 [model-registry.ts]
    // (../../shared/src/model-registry.ts)。下次模型升级只改 registry + 同步 fallback-config.json。
    const modelClaudeId = modelIdForHint(model);

    // H14 v1: 真正 spawn CLI 之前再翻 dispatched → running
    // 在此之前 bundle 写盘 / createTask INSERT 失败 → stage 留 dispatched，外层 catch 标 failed。
    // 这样 setup 阶段失败 与 CLI 执行阶段失败 在 audit 上可区分（status trail 不同）。
    setStageStatus(this.db, stage.id, "running");
    this.broadcast({ type: "harness_event", kind: "stage_changed", stageId: stage.id, status: "running" });

    // Phase B — CLI 执行：runSession spawn claude CLI subprocess
    // M1: bypassPermissions — scheduler 无交互 UI，无法走 permission hub。
    // M2 改造点：注册 scheduler permission channel，广播 decision_requested 事件。
    // M2 Loop 4: 通过 this.runSessionFn 间接调用，e2e test 可注入 mock 版本（默认真）。
    try {
      await this.runSessionFn({
        prompt: bundle.prompt,
        cwd,
        model: modelClaudeId as any,
        permissionMode: "bypassPermissions",
        taskId,
        onMessage: (msg) => {
          this.broadcast({
            type: "harness_event",
            kind: "stage_message",
            payload: { issueId: issue.id, stageId: stage.id, taskId, msg },
          });
        },
      });
    } catch (err) {
      setStageFailed(this.db, stage.id, "cli_failed");
      throw err;
    }

    // Phase C — harvest（仅 strategy stage）
    // M2 v1 (3.2-A')：strategy stage 必须产出 spec artifact 才能 approved（cross M1 修）
    // 之前是 best-effort + 只 warn — 但 strategy 的 declared output 就是 spec，
    // 缺 spec 还 approved 会让 implement 的 mustHave 才 fail，制造"过 gate 但流水线不可执行"。
    // 现在改 fail-loud：harvest 失败 → throw → spawnAgent catch 把 stage 标 failed。
    if (stage.kind === "strategy") {
      try {
        this.harvestSpecArtifact(issue, stage, cwd);
      } catch (err) {
        setStageFailed(this.db, stage.id, "spec_harvest_failed");
        throw err;
      }
    }

    setStageStatus(this.db, stage.id, "approved");
    this.broadcast({ type: "harness_event", kind: "stage_changed", stageId: stage.id, status: "approved" });

    this.broadcast({
      type: "harness_event",
      kind: "stage_done",
      payload: { issueId: issue.id, stageId: stage.id, taskId },
    });
  }

  /** Harvest strategy stage's spec.md output to harness_artifact (M2 v1 3.2-A', cross M1 修)。
   *  **Fail-loud**：spec 缺失或 createArtifact 抛错 → throw，让 spawnAgent catch 把 stage 标 failed。
   *  这跟 implement mustHave=['spec'] 配对：strategy approved ⟹ spec exists ⟹ implement 不会 build-time fail。 */
  private harvestSpecArtifact(issue: IssueRow, stage: StageRow, cwd: string): void {
    const specPath = join(cwd, "docs", "specs", `${issue.id}.md`);
    if (!existsSync(specPath)) {
      throw new Error(
        `strategy stage ${stage.id.slice(0, 8)} produced no spec at ${specPath}. ` +
          "Re-tick after agent writes the file, or mark issue wont_fix.",
      );
    }
    const raw = readFileSync(specPath, "utf-8");
    // Cap content (cross m1 修：char-level cap — 与 ContextManager TOTAL_CHAR_BUDGET 用同语义)
    const content = raw.length > SPEC_HARVEST_MAX_CHARS
      ? raw.slice(0, SPEC_HARVEST_MAX_CHARS) + `\n…[truncated, original ${raw.length} chars]`
      : raw;
    const artifact = createArtifact(this.db, {
      stageId: stage.id,
      kind: "spec",
      ref: `docs/specs/${issue.id}.md`,
      contentText: content,
      metadata: { harvested_from: specPath, original_chars: raw.length },
    });
    console.log(
      `[EvaScheduler] strategy ${stage.id} → spec artifact ${artifact.id.slice(0, 8)} (${content.length} chars, ref=${artifact.ref})`,
    );
  }
}
