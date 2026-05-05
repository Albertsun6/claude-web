// EvaScheduler — L3 Orchestration 骨架 (M1 minimum slice)
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
import { runSession } from "./cli-runner.js";
import { getHarnessConfig } from "./harness-config.js";
import { buildContextBundle } from "./context-manager.js";
import {
  listIssues, listStages, createStage, createTask, setStageStatus, updateIssueStatus,
  type IssueRow, type StageRow,
} from "./harness-queries.js";

// Stage kind → agentProfile.stage 映射（M1 只走两段）
const STAGE_SEQUENCE: StageKind[] = ["strategy", "implement"];
type StageKind = "strategy" | "implement" | "done";

// Issue 状态枚举（与 migrations/0001_initial.sql CHECK 约束一致）
type IssueStatus = "inbox" | "triaged" | "planned" | "in_progress" | "blocked" | "done" | "wont_fix";
// Stage 完成状态（无 "done"；M1 用 "approved" 表示完成，跳过 review gate）
const STAGE_COMPLETE_STATUSES = new Set(["approved", "rejected", "skipped"]);
const STAGE_ACTIVE_STATUSES = new Set(["pending", "running", "awaiting_review"]);

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
  ) {}

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

    // 6. 创建 Stage 记录并置 running
    const stage = createStage(this.db, {
      issueId: issue.id,
      kind: nextKind,
      agentProfileId: profile.id,
    });
    setStageStatus(this.db, stage.id, "running");
    updateIssueStatus(this.db, issue.id, "in_progress");

    const taskId = `${issue.id}/${stage.id}`;

    // 7. 广播 stage_started（符合 ServerMessage protocol）
    this.broadcast({
      type: "harness_event",
      kind: "stage_started",
      payload: { issueId: issue.id, stageId: stage.id, stageKind: nextKind, taskId },
    });

    // 8. 异步 spawn agent（fire-and-forget；tick 立即返回）
    this.spawnAgent(issue, stage, taskId, projectCwd).catch((err) => {
      console.error(`[EvaScheduler] agent error for ${taskId}:`, err);
      setStageStatus(this.db, stage.id, "failed");
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

    const modelHint = profile?.modelHint ?? "sonnet";
    const model: "opus" | "sonnet" | "haiku" =
      modelHint === "opus" ? "opus" : modelHint === "haiku" ? "haiku" : "sonnet";

    // Cross M1 修：context_bundle.task_id 必须指向真 task 行（schema 注释明文 "外键
    // 回指 Task"），过去 M1 #3.1 用 synthetic `<issueId>/<stageId>` 留下 orphan 行。
    // 改：先 reserve taskUuid → buildContextBundle 写 context_bundle 行 task_id=taskUuid
    // → createTask 写真 task 行 id=taskUuid 闭环引用。
    // 注：synthetic taskId 仍用作 WS broadcast routing key（人类可读），与 task.id UUID
    // 是两个不同概念，scheduler 内部双 ID。
    const taskUuid = randomUUID();

    const bundle = buildContextBundle(this.db, {
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

    const modelClaudeId =
      model === "opus" ? "claude-opus-4-5" : model === "haiku" ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6";

    // M1: bypassPermissions — scheduler 无交互 UI，无法走 permission hub。
    // M2 改造点：注册 scheduler permission channel，广播 decision_requested 事件。
    await runSession({
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

    // Stage 完成：用 "approved" 表示 M1 无 review gate 的完成状态
    setStageStatus(this.db, stage.id, "approved");

    this.broadcast({
      type: "harness_event",
      kind: "stage_done",
      payload: { issueId: issue.id, stageId: stage.id, taskId },
    });
  }
}
