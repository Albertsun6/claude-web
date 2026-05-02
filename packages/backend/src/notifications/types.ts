// Adapted from tiann/hapi@7d55bc14 (AGPL-3.0)
// Original: hub/src/notifications/notificationTypes.ts
// Modifications: trimmed Session type to claude-web's per-conversation model;
//                added optional kind field on TaskNotification.
// See third_party/NOTICES.md for full attribution.

/**
 * Snapshot of a conversation/run that a notification needs to describe.
 * Replaces hapi's `Session` type. Fields are intentionally minimal —
 * channels render this into human-readable messages.
 */
export interface NotificationContext {
  /** runId from claude-web's WS protocol */
  runId: string;
  /** conversationId on the iOS / Web client side */
  conversationId?: string;
  /** sessionId from Claude CLI (set after systemInit) */
  sessionId?: string;
  /** absolute cwd the run was spawned in */
  cwd: string;
  /** human-readable conversation title (auto-named or user-set) */
  title?: string;
  /** first ~80 chars of the user's prompt for context */
  promptPreview?: string;
  /** display name of the agent profile, default "Claude" */
  agentName?: string;
}

export type SessionEndReason = "completed" | "interrupted" | "error";

export interface TaskNotification {
  summary: string;
  status?: string;
}

/**
 * A notification channel. Implementations dispatch to a specific transport
 * (Server酱 / Telegram / APNs / etc). All methods are best-effort: failures
 * are logged by the hub but never thrown back to the caller.
 */
export interface NotificationChannel {
  /** Stable identifier for logging / debugging. */
  readonly id: string;
  /** Sent when a run completes / fails / is interrupted. */
  sendSessionCompletion(ctx: NotificationContext, reason: SessionEndReason): Promise<void>;
  /** Sent when an agent emits an explicit task notification. Optional. */
  sendTaskNotification?(ctx: NotificationContext, notification: TaskNotification): Promise<void>;
  /** Sent when a permission gate has been waiting longer than expected. Optional. */
  sendPermissionPending?(ctx: NotificationContext, toolName: string): Promise<void>;
}

export interface NotificationHubOptions {
  /** Minimum interval between consecutive completion notifications for the same runId. Default 3s. */
  readyCooldownMs?: number;
}
