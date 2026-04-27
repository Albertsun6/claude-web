import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelId, PermissionMode } from "@claude-web/shared";

export interface RunSessionParams {
  prompt: string;
  cwd: string;
  model: ModelId;
  permissionMode: PermissionMode;
  resumeSessionId?: string;
  permissionToken?: string;
  backendBase?: string;
  onMessage: (msg: unknown) => void;
  signal?: AbortSignal;
}

const CLI_BIN = process.env.CLAUDE_CLI ?? "claude";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_SCRIPT = path.resolve(__dirname, "../scripts/permission-hook.mjs");

function buildSettings(token: string, backendBase: string): string {
  const command = `node ${HOOK_SCRIPT} ${token} ${backendBase}`;
  return JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: ".*",
          hooks: [{ type: "command", command, timeout: 600 }],
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
    "--include-partial-messages",
    "--permission-mode", p.permissionMode,
    "--model", p.model,
  ];
  if (resume) args.push("--resume", resume);
  if (p.permissionToken && p.backendBase && p.permissionMode !== "bypassPermissions") {
    args.push("--settings", buildSettings(p.permissionToken, p.backendBase));
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

  const onAbort = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  p.signal?.addEventListener("abort", onAbort);

  child.stdin.write(JSON.stringify({
    type: "user",
    message: { role: "user", content: p.prompt },
  }) + "\n");
  child.stdin.end();

  let stdoutBuf = "";
  let sawValidOutput = false;
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
    let idx: number;
    while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        sawValidOutput = true;
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
      p.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code, signal) => {
      p.signal?.removeEventListener("abort", onAbort);
      const tail = stdoutBuf.trim();
      if (tail) {
        try { p.onMessage(JSON.parse(tail)); sawValidOutput = true; } catch { /* noop */ }
      }
      void sawValidOutput;
      resolve({
        code,
        signaled: signal === "SIGTERM" || !!p.signal?.aborted,
        stderr: stderrBuf,
      });
    });
  });
}

const STALE_SESSION_RE = /No conversation found with session ID/i;

export async function runSession(p: RunSessionParams): Promise<void> {
  let res = await runOnce(p, p.resumeSessionId);

  if (res.signaled) return;

  // Stale session — resume id from previous run no longer exists.
  // Notify client (so it clears its localStorage) and retry without --resume.
  if (res.code !== 0 && p.resumeSessionId && STALE_SESSION_RE.test(res.stderr)) {
    p.onMessage({
      type: "system",
      subtype: "stale_session_recovered",
      message: `previous session ${p.resumeSessionId} no longer exists; starting a fresh one`,
    });
    res = await runOnce(p, undefined);
    if (res.signaled) return;
  }

  if (res.code !== 0) {
    throw new Error(`claude CLI exited ${res.code}: ${res.stderr.slice(0, 500)}`);
  }
}
