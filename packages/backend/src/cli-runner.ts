import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageAttachment, ModelId, PermissionMode } from "@claude-web/shared";
import { verifyAllowedPath } from "./auth.js";

export interface RunSessionParams {
  prompt: string;
  cwd: string;
  model: ModelId;
  permissionMode: PermissionMode;
  resumeSessionId?: string;
  permissionToken?: string;
  backendBase?: string;
  /** When set, hook script will pass this as Bearer to /api/permission/ask. */
  authToken?: string;
  attachments?: ImageAttachment[];
  onMessage: (msg: unknown) => void;
  /** Called if we restart the run (e.g. stale session) so frontend can wipe state. */
  onClearRunMessages?: () => void;
  signal?: AbortSignal;
}

const CLI_BIN = process.env.CLAUDE_CLI ?? "claude";
const KILL_GRACE_MS = 5000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_SCRIPT = path.resolve(__dirname, "../scripts/permission-hook.mjs");

function buildSettings(token: string, backendBase: string, authToken?: string): string {
  // Hook script signature: <token> <backendBase> [authToken]
  const parts = ["node", HOOK_SCRIPT, token, backendBase];
  if (authToken) parts.push(authToken);
  return JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: ".*",
          hooks: [{ type: "command", command: parts.join(" "), timeout: 600 }],
        },
      ],
    },
  });
}

interface SpawnResult {
  code: number | null;
  signaled: boolean;
  stderr: string;
}

function buildArgs(p: RunSessionParams, resume?: string): string[] {
  const args = [
    "--print",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", p.permissionMode,
    "--model", p.model,
    // Move per-machine bits (cwd / env / git status) out of the system prompt
    // into the first user message. Keeps the system prefix stable so prompt
    // caching can hit across sessions and across users on shared infra.
    "--exclude-dynamic-system-prompt-sections",
  ];
  if (resume) args.push("--resume", resume);
  if (p.permissionToken && p.backendBase && p.permissionMode !== "bypassPermissions") {
    args.push("--settings", buildSettings(p.permissionToken, p.backendBase, p.authToken));
  }
  return args;
}

async function runOnce(p: RunSessionParams, resume: string | undefined): Promise<SpawnResult> {
  const args = buildArgs(p, resume);

  const child: ChildProcessWithoutNullStreams = spawn(CLI_BIN, args, {
    cwd: p.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let killTimer: NodeJS.Timeout | undefined;
  const onAbort = () => {
    if (child.killed || child.exitCode !== null) return;
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    // Escalate to SIGKILL if it doesn't exit promptly. Fixes hangs where
    // the CLI is blocked in a hook fetch and won't ack SIGTERM.
    killTimer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }
    }, KILL_GRACE_MS);
  };
  p.signal?.addEventListener("abort", onAbort);

  // Build content: plain string when no images (cheap), array when images present.
  const content: string | any[] =
    p.attachments && p.attachments.length > 0
      ? [
          { type: "text", text: p.prompt },
          ...p.attachments.map((a) => ({
            type: "image",
            source: { type: "base64", media_type: a.mediaType, data: a.dataBase64 },
          })),
        ]
      : p.prompt;

  child.stdin.write(JSON.stringify({
    type: "user",
    message: { role: "user", content },
  }) + "\n");
  child.stdin.end();

  let stdoutBuf = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
    let idx: number;
    while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        p.onMessage(msg);
      } catch {
        console.warn("[cli-runner] failed to parse line:", line.slice(0, 200));
      }
    }
  });

  let stderrBuf = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
  });

  return new Promise<SpawnResult>((resolve, reject) => {
    child.on("error", (err) => {
      if (killTimer) clearTimeout(killTimer);
      p.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      p.signal?.removeEventListener("abort", onAbort);
      const tail = stdoutBuf.trim();
      if (tail) {
        try { p.onMessage(JSON.parse(tail)); } catch { /* noop */ }
      }
      resolve({
        code,
        signaled: signal === "SIGTERM" || signal === "SIGKILL" || !!p.signal?.aborted,
        stderr: stderrBuf,
      });
    });
  });
}

const STALE_SESSION_RE = /No conversation found with session ID/i;
// CLI prints "Prompt is too long" to stderr when context window is exceeded.
// This happens most often when iOS / Web shares a sessionId with Claude Code
// running on the Mac — both append to the same jsonl until the model can't
// fit it all anymore. Recovery: spawn /compact in the same session, then retry.
const TOO_LONG_RE = /Prompt is too long/i;

export async function runSession(p: RunSessionParams): Promise<void> {
  // Defense in depth: cli-runner enforces the path allowlist too.
  const cwdErr = verifyAllowedPath(p.cwd);
  if (cwdErr) throw new Error(cwdErr);

  let res = await runOnce(p, p.resumeSessionId);

  if (res.signaled) return;

  // Stale session — resume id from previous run no longer exists.
  // Notify client to wipe the partial messages it already saw, then retry without --resume.
  if (res.code !== 0 && p.resumeSessionId && STALE_SESSION_RE.test(res.stderr)) {
    p.onClearRunMessages?.();
    p.onMessage({
      type: "system",
      subtype: "stale_session_recovered",
      message: `previous session ${p.resumeSessionId} no longer exists; starting a fresh one`,
    });
    res = await runOnce(p, undefined);
    if (res.signaled) return;
  }

  // Prompt too long — context window exceeded. Try /compact in same session,
  // then retry original prompt. If /compact also fails, fall back to a fresh
  // session (clearing UI), preserving the original prompt.
  if (res.code !== 0 && p.resumeSessionId && TOO_LONG_RE.test(res.stderr)) {
    p.onMessage({
      type: "system",
      subtype: "too_long_recovering",
      message: "上下文超限，正在自动 /compact 压缩历史…",
    });

    // Spawn /compact in the same session. Suppress sub-run sdk_message stream
    // (the user already sees a "compacting" status; the noisy output of
    // /compact would confuse them).
    const compactRes = await runOnce(
      { ...p, prompt: "/compact", attachments: undefined, onMessage: () => {} },
      p.resumeSessionId,
    );
    if (compactRes.signaled) return;

    if (compactRes.code === 0) {
      p.onMessage({
        type: "system",
        subtype: "too_long_recovered",
        message: "压缩完成，重发指令",
      });
      res = await runOnce(p, p.resumeSessionId);
      if (res.signaled) return;
    } else {
      // /compact failed — fall back to a brand-new session.
      p.onClearRunMessages?.();
      p.onMessage({
        type: "system",
        subtype: "too_long_fallback_new_session",
        message: "压缩失败，已开新会话重试（旧 transcript 保留在 jsonl 中）",
      });
      res = await runOnce(p, undefined);
      if (res.signaled) return;
    }
  }

  if (res.code !== 0) {
    throw new Error(`claude CLI exited ${res.code}: ${res.stderr.slice(0, 500)}`);
  }
}
