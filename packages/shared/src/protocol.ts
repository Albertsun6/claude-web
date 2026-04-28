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
    }
  | { type: "interrupt"; runId?: string };

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
    };
