// Telegram Bot channel.
// Standalone implementation (~80 lines), not a port of hapi/hub/src/telegram/*
// because hapi's version pulls in grammy + sessionView + callbacks (~600 lines)
// for a much richer interactive bot. claude-web's needs are pure send-only:
// task complete / failed / interrupt notifications. So we hit the Bot API
// directly via fetch — zero new npm dependencies.
//
// Setup steps for the user (one-time):
//   1. In Telegram, find @BotFather → /newbot → save the BOT_TOKEN
//   2. Send any message to the new bot (e.g. "hi") — this opens a chat
//   3. curl https://api.telegram.org/bot<TOKEN>/getUpdates → find chat.id
//   4. Put both into ~/.claude-web/notify.json under "telegram"
//
// Reference: https://core.telegram.org/bots/api#sendmessage

import type {
  NotificationChannel,
  NotificationContext,
  SessionEndReason,
  TaskNotification,
} from "../types.js";

export interface TelegramOptions {
  botToken: string;
  /** Numeric chat id (negative for groups, positive for private chats). */
  chatId: string | number;
  /** Optional public URL to embed (e.g. Tailscale serve URL). */
  publicUrl?: string;
  /** Default parse_mode. "Markdown" works for the messages we send below. */
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
}

export class TelegramChannel implements NotificationChannel {
  readonly id = "telegram";
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly publicUrl?: string;
  private readonly parseMode: NonNullable<TelegramOptions["parseMode"]>;

  constructor(opts: TelegramOptions) {
    if (!opts.botToken) throw new Error("TelegramChannel: botToken is required");
    if (opts.chatId === undefined || opts.chatId === null || opts.chatId === "") {
      throw new Error("TelegramChannel: chatId is required");
    }
    this.botToken = opts.botToken;
    this.chatId = String(opts.chatId);
    this.publicUrl = opts.publicUrl;
    this.parseMode = opts.parseMode ?? "Markdown";
  }

  async sendSessionCompletion(ctx: NotificationContext, reason: SessionEndReason): Promise<void> {
    const emoji = reason === "completed" ? "✅" : reason === "interrupted" ? "⏹" : "❌";
    const verb = reason === "completed" ? "完成" : reason === "interrupted" ? "已中断" : "失败";
    const text = this.buildMessage(ctx, `${emoji} 任务${verb}`);
    await this.send(text);
  }

  async sendTaskNotification(ctx: NotificationContext, notification: TaskNotification): Promise<void> {
    const status = notification.status?.trim().toLowerCase();
    const isFailure =
      status === "failed" || status === "error" || status === "killed" || status === "aborted";
    const head = isFailure ? "❌ 任务失败" : "🔔 任务通知";
    const body = [
      notification.summary,
      notification.status ? `_状态_: ${notification.status}` : null,
    ].filter(Boolean).join("\n");
    await this.send(this.buildMessage(ctx, `${head}\n\n${body}`));
  }

  async sendPermissionPending(ctx: NotificationContext, toolName: string): Promise<void> {
    await this.send(this.buildMessage(ctx, `⏳ 等待审批工具 \`${toolName}\``));
  }

  // -------- helpers --------

  private buildMessage(ctx: NotificationContext, lead: string): string {
    const agent = ctx.agentName ?? "Claude";
    const title = ctx.title ?? ctx.conversationId ?? ctx.runId.slice(0, 8);
    const prompt = ctx.promptPreview
      ? `\n_${escapeMarkdown(truncate(ctx.promptPreview, 80))}_`
      : "";
    const cwdLine = `\n\`cwd: ${escapeMarkdown(ctx.cwd)}\``;
    const link = this.publicUrl ? `\n[打开 Seaidea](${this.publicUrl})` : "";
    return `*Seaidea* — ${escapeMarkdown(agent)} · ${escapeMarkdown(title)}\n\n${lead}${prompt}${cwdLine}${link}`;
  }

  private async send(text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const body = {
      chat_id: this.chatId,
      text,
      parse_mode: this.parseMode,
      disable_web_page_preview: true,
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Telegram sendMessage failed: HTTP ${resp.status} ${resp.statusText}${errText ? ` — ${errText}` : ""}`);
    }
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Escape characters that have meaning in classic Markdown parse_mode. */
function escapeMarkdown(s: string): string {
  return s.replace(/([_*`\[\]])/g, "\\$1");
}
