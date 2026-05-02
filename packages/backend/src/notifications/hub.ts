// Adapted from tiann/hapi@7d55bc14 (AGPL-3.0)
// Original: hub/src/notifications/notificationHub.ts
// Modifications: removed SyncEngine subscription model; replaced with explicit
//   publish() methods called from cli-runner / permission registry. Removed
//   permissionDebounce + lastKnownRequests state (claude-web's PreToolUse hook
//   is synchronous so no debounce needed). Kept fan-out + per-channel error
//   isolation + ready cooldown (renamed completionCooldown).
// See third_party/NOTICES.md for full attribution.

import type {
  NotificationChannel,
  NotificationContext,
  NotificationHubOptions,
  SessionEndReason,
  TaskNotification,
} from "./types.js";

export class NotificationHub {
  private readonly channels: NotificationChannel[];
  private readonly completionCooldownMs: number;
  private readonly permissionCooldownMs: number;
  private readonly lastCompletionAt: Map<string, number> = new Map();
  private readonly lastPermissionAt: Map<string, number> = new Map();

  constructor(channels: NotificationChannel[], options?: NotificationHubOptions) {
    this.channels = channels;
    this.completionCooldownMs = options?.readyCooldownMs ?? 3000;
    // Per-run cooldown for permission notifications. Rationale: a single task
    // can fire 5+ PreToolUse hooks in a row; without this we'd spam the user.
    // 60s is conservative — if you don't approve in 60s, a second nag is fine.
    this.permissionCooldownMs = 60_000;
  }

  /** Number of registered channels. */
  get channelCount(): number {
    return this.channels.length;
  }

  /** Publish a session completion event. Cooldown applied per-runId. */
  async publishSessionCompletion(ctx: NotificationContext, reason: SessionEndReason): Promise<void> {
    const now = Date.now();
    const last = this.lastCompletionAt.get(ctx.runId) ?? 0;
    if (now - last < this.completionCooldownMs) return;
    this.lastCompletionAt.set(ctx.runId, now);

    await this.fanOut("sessionCompletion", (ch) =>
      ch.sendSessionCompletion(ctx, reason),
    );
  }

  /** Publish an explicit task notification (e.g. agent says "task X done"). */
  async publishTaskNotification(ctx: NotificationContext, notification: TaskNotification): Promise<void> {
    await this.fanOut("taskNotification", (ch) =>
      ch.sendTaskNotification?.(ctx, notification),
    );
  }

  /** Publish "claude is paused waiting for tool approval". Cooldown applied per-runId. */
  async publishPermissionPending(ctx: NotificationContext, toolName: string): Promise<void> {
    const now = Date.now();
    const last = this.lastPermissionAt.get(ctx.runId) ?? 0;
    if (now - last < this.permissionCooldownMs) return;
    this.lastPermissionAt.set(ctx.runId, now);

    await this.fanOut("permissionPending", (ch) =>
      ch.sendPermissionPending?.(ctx, toolName),
    );
  }

  /** Cleanup state for a run that has ended (call on sessionEnded of any reason). */
  forgetRun(runId: string): void {
    this.lastCompletionAt.delete(runId);
    this.lastPermissionAt.delete(runId);
  }

  private async fanOut(
    label: string,
    invoke: (ch: NotificationChannel) => Promise<void> | undefined,
  ): Promise<void> {
    for (const ch of this.channels) {
      try {
        await invoke(ch);
      } catch (err) {
        console.error(`[NotificationHub] channel ${ch.id} failed on ${label}:`, err);
      }
    }
  }
}

/** No-op hub used when no channels are configured. */
export const NoOpHub: Pick<NotificationHub, "publishSessionCompletion" | "publishTaskNotification" | "publishPermissionPending" | "forgetRun" | "channelCount"> = {
  channelCount: 0,
  async publishSessionCompletion() {},
  async publishTaskNotification() {},
  async publishPermissionPending() {},
  forgetRun() {},
};
