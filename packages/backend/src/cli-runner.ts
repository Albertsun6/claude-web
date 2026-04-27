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
  // Per-tool permission gating via PreToolUse hook. The hook posts to backend,
  // backend asks the browser via WS, browser click resolves the hook.
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

export async function runSession(p: RunSessionParams): Promise<void> {
  const args = [
    "--print",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode", p.permissionMode,
    "--model", p.model,
  ];
  if (p.resumeSessionId) args.push("--resume", p.resumeSessionId);

  // Wire per-tool permission hook only when not bypassing.
  if (
    p.permissionToken &&
    p.backendBase &&
    p.permissionMode !== "bypassPermissions"
  ) {
    args.push("--settings", buildSettings(p.permissionToken, p.backendBase));
  }

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
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
    let idx: number;
    while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        p.onMessage(JSON.parse(line));
      } catch {
        console.warn("[cli-runner] failed to parse line:", line.slice(0, 200));
      }
    }
  });

  let stderrBuf = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
  });

  await new Promise<void>((resolve, reject) => {
    child.on("error", (err) => {
      p.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code, signal) => {
      p.signal?.removeEventListener("abort", onAbort);
      const tail = stdoutBuf.trim();
      if (tail) {
        try { p.onMessage(JSON.parse(tail)); } catch { /* noop */ }
      }
      if (signal === "SIGTERM" || p.signal?.aborted) {
        resolve();
        return;
      }
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderrBuf.slice(0, 500)}`));
        return;
      }
      resolve();
    });
  });
}
