import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ModelId, PermissionMode } from "@claude-web/shared";

export interface RunSessionParams {
  prompt: string;
  cwd: string;
  model: ModelId;
  permissionMode: PermissionMode;
  resumeSessionId?: string;
  onMessage: (msg: unknown) => void;
  signal?: AbortSignal;
}

const CLI_BIN = process.env.CLAUDE_CLI ?? "claude";

// permissionMode → CLI flag value. CLI accepts: default, acceptEdits, bypassPermissions, plan, auto, dontAsk
function mapPermissionMode(m: PermissionMode): string {
  return m;
}

export async function runSession(p: RunSessionParams): Promise<void> {
  const args = [
    "--print",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode", mapPermissionMode(p.permissionMode),
    "--model", p.model,
  ];
  if (p.resumeSessionId) args.push("--resume", p.resumeSessionId);

  const child: ChildProcessWithoutNullStreams = spawn(CLI_BIN, args, {
    cwd: p.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  const onAbort = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  p.signal?.addEventListener("abort", onAbort);

  // feed the user prompt as a single stream-json message, then close stdin
  const userMsg = {
    type: "user",
    message: { role: "user", content: p.prompt },
  };
  child.stdin.write(JSON.stringify(userMsg) + "\n");
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
      } catch (e) {
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
      // flush any trailing partial line
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
