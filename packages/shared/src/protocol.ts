export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan";

export type ModelId =
  | "claude-opus-4-7"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5";

export interface ImageAttachment {
  /** image MIME type, e.g. "image/png", "image/jpeg" */
  mediaType: string;
  /** raw base64 (no `data:` prefix) */
  dataBase64: string;
}

export type ClientMessage =
  | {
      type: "user_prompt";
      runId: string;
      prompt: string;
      cwd: string;
      model: ModelId;
      permissionMode: PermissionMode;
      resumeSessionId?: string;
      /** optional image attachments — sent alongside the text prompt */
      attachments?: ImageAttachment[];
    }
  | {
      type: "permission_reply";
      requestId: string;
      decision: "allow" | "deny";
      // Optional: if supplied, backend routes O(1) instead of scanning runs.
      runId?: string;
      // Optional: tool name for logging/audit
      toolName?: string;
    }
  | { type: "interrupt"; runId?: string }
  | { type: "fs_subscribe"; cwd: string }
  | { type: "fs_unsubscribe"; cwd: string }
  | {
      // Subscribe to incremental jsonl changes for a Claude Code session.
      // Backend tails ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl from
      // `fromByteOffset` (defaults to current EOF) and pushes one
      // `session_event` per new normalized entry. Used by Seaidea to mirror
      // a session that another Claude Code client is actively driving.
      type: "session_subscribe";
      cwd: string;
      sessionId: string;
      fromByteOffset?: number;
    }
  | { type: "session_unsubscribe"; cwd: string; sessionId: string };

export type ServerMessage =
  | { type: "sdk_message"; runId: string; message: unknown }
  | {
      type: "permission_request";
      runId: string;
      requestId: string;
      toolName: string;
      input: unknown;
    }
  | { type: "error"; runId?: string; error: string }
  | {
      // Sent when cli-runner restarts after a stale-session error so the
      // frontend can wipe any messages it already appended for this run.
      type: "clear_run_messages";
      runId: string;
    }
  | {
      type: "session_ended";
      runId: string;
      reason: "completed" | "interrupted" | "error";
    }
  | {
      type: "fs_changed";
      cwd: string;
      change: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
      relPath: string;
    }
  | {
      // One normalized jsonl entry from a subscribed session. `entry` is
      // already filtered through normalizeJsonlEntry — same shape as items
      // returned by /api/sessions/transcript. `byteOffset` is the file
      // position right after this line, so clients can reconnect with
      // `fromByteOffset = byteOffset` to resume without gaps.
      type: "session_event";
      cwd: string;
      sessionId: string;
      byteOffset: number;
      entry: unknown;
    }
  | {
      // Broadcast when server-driven config changes (fallback-config.json
      // edited + tsx watch restart). Clients should re-fetch /api/harness/config.
      type: "harness_event";
      kind: "config_changed" | "stage_changed" | "task_started" | "decision_requested" | "run_appended" | "review_complete";
      payload?: unknown;
    };
