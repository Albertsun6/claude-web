export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan";

export type ModelId =
  | "claude-opus-4-7"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5";

export type ClientMessage =
  | {
      type: "user_prompt";
      prompt: string;
      cwd: string;
      model: ModelId;
      permissionMode: PermissionMode;
      resumeSessionId?: string;
    }
  | {
      type: "permission_reply";
      requestId: string;
      decision: "allow" | "deny";
    }
  | { type: "interrupt" };

export type ServerMessage =
  | { type: "sdk_message"; message: unknown }
  | {
      type: "permission_request";
      requestId: string;
      toolName: string;
      input: unknown;
    }
  | { type: "error"; error: string }
  | { type: "session_ended"; reason: "completed" | "interrupted" | "error" };
