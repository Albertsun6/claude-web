// Adapted from tiann/hapi@7d55bc14 (AGPL-3.0)
// Original: hub/src/serverchan/channel.ts
// Modifications: Session model replaced with NotificationContext; rewrote
//   event mapping for claude-web's conversation model (session-level only,
//   no per-message ready signal); kept the POST-to-sctapi.ftqq.com helper
//   essentially as-is.
// See third_party/NOTICES.md for full attribution.

import type {
  NotificationChannel,
  NotificationContext,
  SessionEndReason,
  TaskNotification,
} from "../types.js";

export interface ServerChanOptions {
  sendKey: string;
  /** Optional public URL to embed in notifications (e.g. Tailscale serve URL). */
  publicUrl?: string;
}

export class ServerChanChannel implements NotificationChannel {
  readonly id = "serverchan";
  private readonly sendKey: string;
  private readonly publicUrl?: string;

  constructor(opts: ServerChanOptions) {
    if (!opts.sendKey) throw new Error("ServerChanChannel: sendKey is required");
    this.sendKey = opts.sendKey;
    this.publicUrl = opts.publicUrl;
  }

  async sendSessionCompletion(ctx: NotificationContext, reason: SessionEndReason): Promise<void> {
    const title = reasonTitle(reason);
    const body = this.buildBody(ctx, this.completionLine(reason));
    await this.post(title, body);
  }

  async sendTaskNotification(ctx: NotificationContext, notification: TaskNotification): Promise<void> {
    const status = notification.status?.trim().toLowerCase();
    const isFailure =
      status === "failed" || status === "error" || status === "killed" || status === "aborted";
    const title = isFailure ? "Seaidea 任务失败" : "Seaidea 任务通知";
    const lines = [notification.summary, notification.status ? `状态: ${notification.status}` : null]
      .filter(Boolean)
      .join("\n");
    const body = this.buildBody(ctx, lines);
    await this.post(title, body);
  }

  async sendPermissionPending(ctx: NotificationContext, toolName: string): Promise<void> {
    const title = "Seaidea 等待审批";
    const body = this.buildBody(ctx, `Agent 想调用工具 \`${toolName}\`，请在 iOS / Web 审批。`);
    await this.post(title, body);
  }

  // -------- helpers --------

  private buildBody(ctx: NotificationContext, mainLine: string): string {
    const agent = ctx.agentName ?? "Claude";
    const title = ctx.title ?? ctx.conversationId ?? ctx.runId.slice(0, 8);
    const lines = [
      `**${agent}** · ${title}`,
      "",
      mainLine,
      "",
      ctx.promptPreview ? `> ${ctx.promptPreview}` : null,
      `\`cwd: ${ctx.cwd}\``,
      this.publicUrl ? `\n[打开 Seaidea](${this.publicUrl})` : null,
    ];
    return lines.filter((l) => l !== null).join("\n");
  }

  private completionLine(reason: SessionEndReason): string {
    switch (reason) {
      case "completed":
        return "✅ 任务完成";
      case "interrupted":
        return "⏹ 已被中断";
      case "error":
        return "❌ 出错了";
    }
  }

  private async post(title: string, desp: string): Promise<void> {
    const url = `https://sctapi.ftqq.com/${this.sendKey}.send`;
    const body = new URLSearchParams({ title, desp });
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Server酱发送失败: HTTP ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`,
      );
    }
  }
}

function reasonTitle(reason: SessionEndReason): string {
  switch (reason) {
    case "completed":
      return "Seaidea 任务完成";
    case "interrupted":
      return "Seaidea 任务中断";
    case "error":
      return "Seaidea 任务失败";
  }
}
