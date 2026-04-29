import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ClientMessage, ServerMessage } from "../protocol";

function loadFixture<T>(name: string): T {
  const p = path.resolve(__dirname, "../../fixtures/protocol", name);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

describe("protocol fixtures — ClientMessage", () => {
  it("client-user-prompt — minimal", () => {
    const msg = loadFixture<ClientMessage>("client-user-prompt.json");
    expect(msg.type).toBe("user_prompt");
    if (msg.type === "user_prompt") {
      expect(msg.runId).toBe("run-abc123");
      expect(msg.prompt).toBe("帮我写一个 hello world");
      expect(msg.cwd).toBe("/Users/test/project");
      expect(msg.model).toBe("claude-haiku-4-5");
      expect(msg.permissionMode).toBe("default");
      expect(msg.resumeSessionId).toBeUndefined();
      expect(msg.attachments).toBeUndefined();
    }
  });

  it("client-user-prompt-with-attachment — attachment + resume", () => {
    const msg = loadFixture<ClientMessage>(
      "client-user-prompt-with-attachment.json",
    );
    expect(msg.type).toBe("user_prompt");
    if (msg.type === "user_prompt") {
      expect(msg.runId).toBe("run-def456");
      expect(msg.resumeSessionId).toBe("session-xyz789");
      expect(msg.permissionMode).toBe("acceptEdits");
      expect(msg.attachments).toBeDefined();
      expect(msg.attachments?.[0].mediaType).toBe("image/png");
      expect(msg.attachments?.[0].dataBase64).toBeTruthy();
    }
  });

  it("client-permission-reply — allow", () => {
    const msg = loadFixture<ClientMessage>("client-permission-reply.json");
    expect(msg.type).toBe("permission_reply");
    if (msg.type === "permission_reply") {
      expect(msg.requestId).toBe("req-perm-001");
      expect(msg.decision).toBe("allow");
      expect(msg.runId).toBe("run-abc123");
      expect(msg.toolName).toBe("Bash");
    }
  });

  it("client-interrupt — with runId", () => {
    const msg = loadFixture<ClientMessage>("client-interrupt.json");
    expect(msg.type).toBe("interrupt");
    if (msg.type === "interrupt") {
      expect(msg.runId).toBe("run-abc123");
    }
  });

  it("client-session-subscribe — with offset", () => {
    const msg = loadFixture<ClientMessage>("client-session-subscribe.json");
    expect(msg.type).toBe("session_subscribe");
    if (msg.type === "session_subscribe") {
      expect(msg.cwd).toBe("/Users/test/project");
      expect(msg.sessionId).toBe("session-xyz789");
      expect(msg.fromByteOffset).toBe(1024);
    }
  });

  it("client-session-unsubscribe", () => {
    const msg = loadFixture<ClientMessage>("client-session-unsubscribe.json");
    expect(msg.type).toBe("session_unsubscribe");
    if (msg.type === "session_unsubscribe") {
      expect(msg.cwd).toBe("/Users/test/project");
      expect(msg.sessionId).toBe("session-xyz789");
    }
  });
});

describe("protocol fixtures — ServerMessage", () => {
  it("server-sdk-message-system-init", () => {
    const msg = loadFixture<ServerMessage>("server-sdk-message-system-init.json");
    expect(msg.type).toBe("sdk_message");
    if (msg.type === "sdk_message") {
      expect(msg.runId).toBe("run-abc123");
      expect(msg.message).toBeDefined();
      const inner = msg.message as Record<string, unknown>;
      expect(inner.type).toBe("system");
      expect(inner.subtype).toBe("init");
      expect(inner.session_id).toBe("session-xyz789");
      expect(inner.model).toBe("claude-haiku-4-5");
    }
  });

  it("server-sdk-message-assistant-text", () => {
    const msg = loadFixture<ServerMessage>(
      "server-sdk-message-assistant-text.json",
    );
    expect(msg.type).toBe("sdk_message");
    if (msg.type === "sdk_message") {
      expect(msg.runId).toBe("run-abc123");
      const inner = msg.message as Record<string, unknown>;
      expect(inner.type).toBe("assistant");
      const message = inner.message as Record<string, unknown>;
      const content = message.content as Array<Record<string, unknown>>;
      expect(content[0].type).toBe("text");
      expect(content[0].text).toBe("你好！有什么我可以帮助你的？");
    }
  });

  it("server-sdk-message-thinking-and-text", () => {
    const msg = loadFixture<ServerMessage>(
      "server-sdk-message-thinking-and-text.json",
    );
    expect(msg.type).toBe("sdk_message");
    if (msg.type === "sdk_message") {
      const inner = msg.message as Record<string, unknown>;
      const message = inner.message as Record<string, unknown>;
      const content = message.content as Array<Record<string, unknown>>;
      expect(content[0].type).toBe("thinking");
      expect(content[0].thinking).toBe("用户想要帮助，我应该友好回应。");
      expect(content[1].type).toBe("text");
      expect(content[1].text).toBe("当然可以！");
    }
  });

  it("server-sdk-message-tool-use", () => {
    const msg = loadFixture<ServerMessage>("server-sdk-message-tool-use.json");
    expect(msg.type).toBe("sdk_message");
    if (msg.type === "sdk_message") {
      const inner = msg.message as Record<string, unknown>;
      const message = inner.message as Record<string, unknown>;
      const content = message.content as Array<Record<string, unknown>>;
      expect(content[0].type).toBe("tool_use");
      expect(content[0].id).toBe("tool-1");
      expect(content[0].name).toBe("Bash");
    }
  });

  it("server-sdk-message-tool-result", () => {
    const msg = loadFixture<ServerMessage>(
      "server-sdk-message-tool-result.json",
    );
    expect(msg.type).toBe("sdk_message");
    if (msg.type === "sdk_message") {
      const inner = msg.message as Record<string, unknown>;
      const message = inner.message as Record<string, unknown>;
      const content = message.content as Array<Record<string, unknown>>;
      expect(content[0].type).toBe("tool_result");
      expect(content[0].is_error).toBe(false);
    }
  });

  it("server-sdk-message-result", () => {
    const msg = loadFixture<ServerMessage>("server-sdk-message-result.json");
    expect(msg.type).toBe("sdk_message");
    if (msg.type === "sdk_message") {
      const inner = msg.message as Record<string, unknown>;
      expect(inner.type).toBe("result");
      expect(inner.total_cost_usd).toBe(0.0012);
    }
  });

  it("server-permission-request", () => {
    const msg = loadFixture<ServerMessage>("server-permission-request.json");
    expect(msg.type).toBe("permission_request");
    if (msg.type === "permission_request") {
      expect(msg.runId).toBe("run-abc123");
      expect(msg.requestId).toBe("req-perm-001");
      expect(msg.toolName).toBe("Bash");
      expect(msg.input).toBeDefined();
    }
  });

  it("server-error — with runId", () => {
    const msg = loadFixture<ServerMessage>("server-error.json");
    expect(msg.type).toBe("error");
    if (msg.type === "error") {
      expect(msg.runId).toBe("run-abc123");
      expect(msg.error).toBe("cwd not in allowed roots");
    }
  });

  it("server-error-global — no runId", () => {
    const msg = loadFixture<ServerMessage>("server-error-global.json");
    expect(msg.type).toBe("error");
    if (msg.type === "error") {
      expect(msg.runId).toBeUndefined();
      expect(msg.error).toBe("invalid token");
    }
  });

  it("server-clear-run-messages", () => {
    const msg = loadFixture<ServerMessage>("server-clear-run-messages.json");
    expect(msg.type).toBe("clear_run_messages");
    if (msg.type === "clear_run_messages") {
      expect(msg.runId).toBe("run-abc123");
    }
  });

  it("server-session-ended-completed", () => {
    const msg = loadFixture<ServerMessage>(
      "server-session-ended-completed.json",
    );
    expect(msg.type).toBe("session_ended");
    if (msg.type === "session_ended") {
      expect(msg.runId).toBe("run-abc123");
      expect(msg.reason).toBe("completed");
    }
  });

  it("server-session-ended-interrupted", () => {
    const msg = loadFixture<ServerMessage>(
      "server-session-ended-interrupted.json",
    );
    expect(msg.type).toBe("session_ended");
    if (msg.type === "session_ended") {
      expect(msg.runId).toBe("run-abc123");
      expect(msg.reason).toBe("interrupted");
    }
  });

  it("server-session-event", () => {
    const msg = loadFixture<ServerMessage>("server-session-event.json");
    expect(msg.type).toBe("session_event");
    if (msg.type === "session_event") {
      expect(msg.cwd).toBe("/Users/test/project");
      expect(msg.sessionId).toBe("session-xyz789");
      expect(msg.byteOffset).toBe(2048);
      expect(msg.entry).toBeDefined();
    }
  });
});
