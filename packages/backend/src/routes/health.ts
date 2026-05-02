// GET /api/health/full
// Deep health check: probes every external dep and surface the result so the
// iOS app's "诊断" page can show a green/yellow/red row per item. Also used
// by the user when filing bug reports — one button copies the JSON.

import { Hono } from "hono";
import { spawn } from "node:child_process";
import { stat, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  getAllowedRoots,
  isAuthEnabled,
  isPathAllowlistEnabled,
} from "../auth.js";
import { snapshot as heartbeatSnapshot } from "../heartbeat.js";

const CLAUDE_BIN = process.env.CLAUDE_CLI ?? "claude";
const WHISPER_BIN = process.env.WHISPER_BIN ?? "whisper-cli";
const FFMPEG_BIN = process.env.FFMPEG_BIN ?? "ffmpeg";
const EDGE_TTS_BIN = process.env.EDGE_TTS_BIN ?? "edge-tts";

type Status = "ok" | "warn" | "error";

interface HealthItem {
  id: string;
  label: string;
  status: Status;
  detail?: string;
  hint?: string;
}

export const healthRouter = new Hono();

// Run a command with a short timeout, return stdout (trimmed) on success.
function probe(bin: string, args: string[], timeoutMs = 4000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let done = false;
    let child;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, out: "", err: e instanceof Error ? e.message : String(e) });
      return;
    }
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill("SIGKILL"); } catch {}
      resolve({ ok: false, out: out.trim(), err: "timeout" });
    }, timeoutMs);
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => {
      if (done) return; done = true; clearTimeout(t);
      resolve({ ok: false, out: out.trim(), err: e.message });
    });
    child.on("close", (code) => {
      if (done) return; done = true; clearTimeout(t);
      resolve({ ok: code === 0, out: out.trim(), err: err.trim() });
    });
  });
}

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function checkClaudeCli(): Promise<HealthItem> {
  const r = await probe(CLAUDE_BIN, ["--version"]);
  if (r.ok && r.out) {
    return { id: "claude_cli", label: "Claude CLI", status: "ok", detail: r.out };
  }
  return {
    id: "claude_cli",
    label: "Claude CLI",
    status: "error",
    detail: r.err || "not found",
    hint: `设置 CLAUDE_CLI 环境变量，或确认 \`${CLAUDE_BIN}\` 在 PATH 上。`,
  };
}

async function checkClaudeCredentials(): Promise<HealthItem> {
  // Newer Claude CLI keeps OAuth tokens in macOS Keychain under the service
  // "Claude Code-credentials"; older versions wrote ~/.claude/.credentials.json.
  // Either is fine — the CLI picks whichever it finds.
  const filePath = path.join(os.homedir(), ".claude", ".credentials.json");
  if (await fileExists(filePath)) {
    return { id: "claude_credentials", label: "Claude 订阅凭证", status: "ok", detail: "~/.claude/.credentials.json" };
  }
  if (process.platform === "darwin") {
    const r = await probe("security", ["find-generic-password", "-s", "Claude Code-credentials"]);
    if (r.ok) {
      return { id: "claude_credentials", label: "Claude 订阅凭证", status: "ok", detail: "Keychain (Claude Code-credentials)" };
    }
  }
  return {
    id: "claude_credentials",
    label: "Claude 订阅凭证",
    status: "error",
    detail: "未找到（Keychain 和 ~/.claude/.credentials.json 都没有）",
    hint: "在 Mac 上跑一次 `claude` 完成 OAuth 登录。",
  };
}

async function checkWhisper(): Promise<HealthItem> {
  // whisper-cli has no --version; --help exits 0 if installed.
  const r = await probe(WHISPER_BIN, ["--help"]);
  if (!r.ok) {
    return {
      id: "whisper_bin",
      label: "whisper-cli",
      status: "warn",
      detail: r.err || "not found",
      hint: "未装则语音识别不可用。`brew install whisper-cpp` 或自建。",
    };
  }
  return { id: "whisper_bin", label: "whisper-cli", status: "ok" };
}

async function checkWhisperModel(): Promise<HealthItem> {
  const dir = path.join(os.homedir(), ".whisper-models");
  const candidates = [
    "ggml-large-v3.bin",
    "ggml-large-v3-turbo.bin",
    "ggml-large-v3-turbo-q5_0.bin",
  ];
  const explicit = process.env.WHISPER_MODEL;
  if (explicit) {
    const ok = await fileExists(explicit);
    return ok
      ? { id: "whisper_model", label: "Whisper 模型", status: "ok", detail: explicit }
      : { id: "whisper_model", label: "Whisper 模型", status: "warn", detail: `WHISPER_MODEL 指向不存在: ${explicit}` };
  }
  for (const f of candidates) {
    const p = path.join(dir, f);
    if (await fileExists(p)) {
      return { id: "whisper_model", label: "Whisper 模型", status: "ok", detail: f };
    }
  }
  return {
    id: "whisper_model",
    label: "Whisper 模型",
    status: "warn",
    detail: `${dir} 下没找到 ggml-large-v3*`,
    hint: "下载到 ~/.whisper-models/，或 export WHISPER_MODEL=/path/to/model.bin。",
  };
}

async function checkFfmpeg(): Promise<HealthItem> {
  const r = await probe(FFMPEG_BIN, ["-version"]);
  if (!r.ok) {
    return {
      id: "ffmpeg",
      label: "ffmpeg",
      status: "warn",
      detail: r.err || "not found",
      hint: "语音识别需要 ffmpeg 转码。`brew install ffmpeg`。",
    };
  }
  // First line: ffmpeg version 6.1 ...
  const firstLine = r.out.split("\n")[0]?.trim() ?? "";
  return { id: "ffmpeg", label: "ffmpeg", status: "ok", detail: firstLine };
}

async function checkEdgeTts(): Promise<HealthItem> {
  const r = await probe(EDGE_TTS_BIN, ["--help"]);
  if (!r.ok) {
    return {
      id: "edge_tts",
      label: "edge-tts",
      status: "warn",
      detail: r.err || "not found",
      hint: "TTS 朗读需要 edge-tts。`pipx install edge-tts` 或 `pip install edge-tts`。",
    };
  }
  return { id: "edge_tts", label: "edge-tts", status: "ok" };
}

async function checkProjectsStore(): Promise<HealthItem> {
  const dir = path.join(os.homedir(), ".claude-web");
  const filePath = path.join(dir, "projects.json");
  // Test write access: directory must be writable so atomic-rename + .bak
  // can succeed. If the file doesn't exist yet, that's fine — first write
  // will create it.
  try {
    await access(dir, fsConstants.W_OK);
  } catch {
    // Dir might not exist yet; that's OK if homedir is writable.
    try {
      await access(os.homedir(), fsConstants.W_OK);
      return {
        id: "projects_store",
        label: "项目注册表",
        status: "ok",
        detail: `${filePath}（待创建）`,
      };
    } catch (e) {
      return {
        id: "projects_store",
        label: "项目注册表",
        status: "error",
        detail: `home 不可写: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  const exists = await fileExists(filePath);
  return {
    id: "projects_store",
    label: "项目注册表",
    status: "ok",
    detail: exists ? filePath : `${filePath}（待创建）`,
  };
}

function checkAuth(): HealthItem {
  if (isAuthEnabled()) {
    return { id: "auth", label: "Token 鉴权", status: "ok", detail: "CLAUDE_WEB_TOKEN 已配置" };
  }
  return {
    id: "auth",
    label: "Token 鉴权",
    status: "warn",
    detail: "未配置",
    hint: "本机 / Tailscale 内网无所谓；公开暴露务必设 CLAUDE_WEB_TOKEN。",
  };
}

function checkAllowedRoots(): HealthItem {
  if (!isPathAllowlistEnabled()) {
    return {
      id: "allowed_roots",
      label: "路径白名单",
      status: "warn",
      detail: "未配置（任何路径都可访问）",
      hint: "公开暴露时请设 CLAUDE_WEB_ALLOWED_ROOTS。",
    };
  }
  const roots = getAllowedRoots();
  return {
    id: "allowed_roots",
    label: "路径白名单",
    status: "ok",
    detail: roots.join(", "),
  };
}

// GET /api/health/heartbeat
// Lightweight: no external probes. Designed for iOS settings-page polling
// every few seconds to render "Mac is alive" badge. Returns in <5ms.
healthRouter.get("/heartbeat", (c) => {
  return c.json(heartbeatSnapshot());
});

healthRouter.get("/full", async (c) => {
  const started = Date.now();
  const items = await Promise.all([
    checkClaudeCli(),
    checkClaudeCredentials(),
    checkWhisper(),
    checkWhisperModel(),
    checkFfmpeg(),
    checkEdgeTts(),
    checkProjectsStore(),
  ]);
  items.push(checkAuth(), checkAllowedRoots());

  const summary: Record<Status, number> = { ok: 0, warn: 0, error: 0 };
  for (const it of items) summary[it.status]++;
  const overall: Status = summary.error > 0 ? "error" : summary.warn > 0 ? "warn" : "ok";

  return c.json({
    overall,
    summary,
    items,
    backend: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
    },
    heartbeat: heartbeatSnapshot(),
    durationMs: Date.now() - started,
  });
});
