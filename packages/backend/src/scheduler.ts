// EvaScheduler — L3 Orchestration 骨架 (M1 minimum slice)
//
// 职责：从 harness.db 读 pending Issue → 推进 Stage 状态机 → spawn claude CLI agent
//
// M1 scope：
//   - computeNextStage：只实现 strategy → implement → done 三段
//   - ContextBundle：最简化，只把 issue title+body 作为 prompt 前缀
//   - 调用现有 runSession()，新增 taskId 字段
//
// M2 交付：ContextManager 真实编排、Review-Orchestrator、worktree 自动创建

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { runSession } from "./cli-runner.js";
import { getHarnessConfig } from "./harness-config.js";
import {
  listIssues, listStages, createStage, setStageStatus, updateIssueStatus,
  type IssueRow, type StageRow,
} from "./harness-queries.js";

// Stage kind → agentProfile.stage 映射（M1 只走两段）
const STAGE_SEQUENCE: StageKind[] = ["strategy", "implement"];
type StageKind = "strategy" | "implement" | "done";

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
    // 1. 取 pending Issue（最旧的先跑）
    const issues = listIssues(this.db, { projectId }).filter(
      (i) => i.status === "pending" || i.status === "open",
    );
    if (!issues.length) {
      return { issued: false, reason: "no pending issues" };
    }

    const issue = issues[0];

    // 2. 计算下一个 Stage
    const stages = listStages(this.db, issue.id);
    const nextKind = this.computeNextStage(stages);
    if (nextKind === "done") {
      updateIssueStatus(this.db, issue.id, "done");
      return { issued: false, reason: `issue ${issue.id} already done` };
    }

    // 3. 取对应 AgentProfile
    const profile = this.resolveProfile(nextKind);
    if (!profile) {
      return { issued: false, reason: `no enabled profile for stage: ${nextKind}` };
    }

    // 4. 创建 Stage 记录
    const stage = createStage(this.db, {
      issueId: issue.id,
      kind: nextKind,
      agentProfileId: profile.id,
    });
    setStageStatus(this.db, stage.id, "running");

    const taskId = `${issue.id}/${stage.id}`;

    // 5. 广播 stage_started
    this.broadcast({
      type: "harness_event",
      event: "stage_started",
      issueId: issue.id,
      stageId: stage.id,
      stageKind: nextKind,
      taskId,
    });

    // 6. 异步 spawn agent（不 await，让 tick 立即返回）
    this.spawnAgent(issue, stage, taskId).catch((err) => {
      console.error(`[EvaScheduler] agent error for ${taskId}:`, err);
      setStageStatus(this.db, stage.id, "failed");
      this.broadcast({
        type: "harness_event",
        event: "stage_failed",
        issueId: issue.id,
        stageId: stage.id,
        taskId,
        error: String(err),
      });
    });

    return { issued: true, issueId: issue.id, stageKind: nextKind, taskId };
  }

  private computeNextStage(existingStages: StageRow[]): StageKind {
    const doneKinds = new Set(
      existingStages
        .filter((s) => s.status === "done")
        .map((s) => s.kind as StageKind),
    );
    for (const kind of STAGE_SEQUENCE) {
      if (!doneKinds.has(kind)) return kind;
    }
    return "done";
  }

  private resolveProfile(stageKind: string) {
    const config = getHarnessConfig();
    // 找第一个 enabled + stage 匹配的 profile
    return (
      config.agentProfiles.find(
        (p) => p.stage === stageKind && p.enabled,
      ) ??
      // 找任意 enabled profile 作为 fallback（M1 宽松）
      config.agentProfiles.find((p) => p.enabled) ??
      null
    );
  }

  private async spawnAgent(
    issue: IssueRow,
    stage: StageRow,
    taskId: string,
  ): Promise<void> {
    const config = getHarnessConfig();
    const profile = config.agentProfiles.find((p) => p.id === stage.assigned_agent_profile);

    // M1 最简 ContextBundle：issue title + body 作为 prompt 前缀
    const prompt = [
      `# Eva Scheduler — Stage: ${stage.kind}`,
      `## Issue: ${issue.title}`,
      issue.body ? `\n${issue.body}` : "",
      `\n请根据以上 Issue 完成 ${stage.kind} 阶段的任务。`,
    ]
      .filter(Boolean)
      .join("\n");

    const modelHint = profile?.modelHint ?? "sonnet";
    const model =
      modelHint === "opus"
        ? "claude-opus-4-5"
        : modelHint === "haiku"
          ? "claude-haiku-4-5-20251001"
          : "claude-sonnet-4-6";

    const messages: unknown[] = [];

    await runSession({
      prompt,
      cwd: process.cwd(),
      model: model as any,
      permissionMode: "default",
      taskId,
      onMessage: (msg) => {
        messages.push(msg);
        this.broadcast({
          type: "harness_event",
          event: "stage_message",
          issueId: issue.id,
          stageId: stage.id,
          taskId,
          msg,
        });
      },
    });

    setStageStatus(this.db, stage.id, "done");
    updateIssueStatus(this.db, issue.id, "in_progress");

    this.broadcast({
      type: "harness_event",
      event: "stage_done",
      issueId: issue.id,
      stageId: stage.id,
      taskId,
    });
  }
}
