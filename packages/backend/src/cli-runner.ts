import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageAttachment, ModelId, PermissionMode } from "@vessel/shared";
import { verifyAllowedPath } from "./auth.js";
import { getMcpConfigPath } from "./mcp/cli-config.js";
import { loadSoulOrNull, SoulParseError } from "./soul/parser.js";
import { renderSoulPrompt } from "./soul/injector.js";
import { searchMemory } from "./memory/memory-store.js";

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
  /** Scheduler task identifier for WS broadcast routing (e.g. "<issueId>/<stageId>"). */
  taskId?: string;
  /**
   * v0A.1 M0.5 (Vessel CodingDriver): when true, spawn child in its own process group
   * so the adapter can `process.kill(-pgid, ...)` to take down the whole subtree
   * (claude CLI + any tool subprocesses). Eva web/iOS path keeps default false.
   * @see ADR-016 path C
   */
  detached?: boolean;
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

/**
 * M1C-B integration: retrieve top-K memory records relevant to the user's
 * prompt and format as a markdown system-prompt block to append to soul prompt.
 *
 * Failure modes — all fail-soft, returns '':
 *   - VESSEL_MEMORY_AUGMENT=0 → skip retrieval entirely
 *   - embedder model not loaded yet (cold start) → skip
 *   - search throws (sqlite-vec error / DB lock) → warn + skip
 *   - empty result set → return ''
 *
 * Top-K default 3 — small enough to keep prompt cache stable, big enough
 * to bring useful context. Tunable via VESSEL_MEMORY_TOPK.
 *
 * Distance threshold: cosine distance > 1.5 (very loose match) is filtered
 * out so we don't pollute the prompt with unrelated records.
 */
export async function getMemoryContextOrEmpty(prompt: string): Promise<string> {
  if (process.env.VESSEL_MEMORY_AUGMENT === '0') return '';
  if (!prompt || prompt.trim().length < 3) return ''; // too short to be useful

  const k = (() => {
    const env = process.env.VESSEL_MEMORY_TOPK;
    if (!env) return 3;
    const n = parseInt(env, 10);
    return Number.isFinite(n) && n > 0 && n <= 20 ? n : 3;
  })();
  const distMax = 1.5;

  try {
    const hits = await searchMemory(prompt, k);
    const relevant = hits.filter(h => h.distance <= distMax);
    if (relevant.length === 0) return '';

    const lines: string[] = [
      '# Relevant memories from previous sessions',
      '',
      'These records were retrieved by similarity to the current request. Use only',
      'when material to the answer; do not narrate retrieval.',
      '',
    ];
    for (const h of relevant) {
      // Trim each record to keep prompt size bounded; full record id available
      // via `vessel-core memory list` if needed.
      const snippet = h.content.replace(/\s+/g, ' ').slice(0, 240);
      lines.push(`- (${h.kind}) ${snippet}`);
    }
    return lines.join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[cli-runner] skipping memory augmentation: ${msg}`);
    return '';
  }
}

function buildArgs(p: RunSessionParams, resume?: string, memoryContext: string = ''): string[] {
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
  // M1B+: when VESSEL_MCP_SERVERS is set, mirror it to a temp .mcp.json and
  // pass --mcp-config so Claude CLI children can call MCP tools. Stdio MCP is
  // 1:1 with its spawning process — CLI must launch its own copies (not share
  // McpServerManager's vessel-core-side instances).
  const mcpConfigPath = getMcpConfigPath();
  if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);
  // M2-Soul + M1C-B integration: render persona + relevant memory into a
  // single --append-system-prompt block. Soul comes first (defines who Claude
  // is), memory comes second (gives context for the current request).
  // Both are independent fail-soft — soul missing or memory empty just omits
  // that segment; CLI still spawns with default system prompt.
  const promptParts: string[] = [];
  try {
    const soul = loadSoulOrNull();
    if (soul) promptParts.push(renderSoulPrompt(soul));
  } catch (err) {
    if (err instanceof SoulParseError) {
      console.warn(`[cli-runner] skipping soul injection: ${err.message}`);
    } else { throw err; }
  }
  if (memoryContext) promptParts.push(memoryContext);
  if (promptParts.length > 0) {
    args.push("--append-system-prompt", promptParts.join('\n\n'));
  }
  return args;
}

async function runOnce(p: RunSessionParams, resume: string | undefined): Promise<SpawnResult> {
  // M1C-B integration: retrieve relevant memory once per spawn (not per buildArgs
  // call — buildArgs is invoked again on stale-session retry, but the same memory
  // context applies). Fails to '' on any error so spawn proceeds with soul-only.
  const memoryContext = await getMemoryContextOrEmpty(p.prompt);
  const args = buildArgs(p, resume, memoryContext);

  const child: ChildProcessWithoutNullStreams = spawn(CLI_BIN, args, {
    cwd: p.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
    detached: p.detached === true,
  });

  let killTimer: NodeJS.Timeout | undefined;
  const onAbort = () => {
    if (child.killed || child.exitCode !== null) return;
    try {
      // v0A.1 M0.5: detached mode → child.pid is its own pgid → negative pid kills group
      if (p.detached === true && typeof child.pid === "number") {
        process.kill(-child.pid, "SIGTERM");
      } else {
        child.kill("SIGTERM");
      }
    } catch { /* ignore */ }
    // Escalate to SIGKILL if it doesn't exit promptly. Fixes hangs where
    // the CLI is blocked in a hook fetch and won't ack SIGTERM.
    killTimer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        try {
          if (p.detached === true && typeof child.pid === "number") {
            process.kill(-child.pid, "SIGKILL");
          } else {
            child.kill("SIGKILL");
          }
        } catch { /* ignore */ }
      }
    }, KILL_GRACE_MS);
  };
  p.signal?.addEventListener("abort", onAbort);
  // Handle the case where the signal was already aborted before spawn finished
  // wiring the listener (M0.5 risk-officer R-M0.5-2). Without this, an early
  // cancel would never propagate to the child.
  if (p.signal?.aborted) onAbort();

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
