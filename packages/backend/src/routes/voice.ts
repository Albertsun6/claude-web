// POST /api/voice/transcribe
//   body: raw audio bytes (audio/webm, audio/mp4, audio/wav...)
//   returns: { text: string, durationMs: number }
//
// Pipeline: incoming audio → ffmpeg → 16kHz mono WAV → whisper-cli → text.
// All processing local; no external API.

import { Hono } from "hono";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import os from "node:os";

const WHISPER_BIN = process.env.WHISPER_BIN ?? "whisper-cli";
const FFMPEG_BIN = process.env.FFMPEG_BIN ?? "ffmpeg";
const DEFAULT_LANG = process.env.WHISPER_LANG ?? "zh";

// Pick the best whisper model present, preferring accuracy over size.
// Order: full → turbo → quantized turbo. Override via WHISPER_MODEL env.
function resolveWhisperModel(): string {
  if (process.env.WHISPER_MODEL) return process.env.WHISPER_MODEL;
  const dir = path.join(os.homedir(), ".whisper-models");
  const candidates = [
    "ggml-large-v3.bin",
    "ggml-large-v3-turbo.bin",
    "ggml-large-v3-turbo-q5_0.bin",
  ];
  for (const f of candidates) {
    const p = path.join(dir, f);
    if (existsSync(p)) return p;
  }
  // fallback to the historical default even if missing — error surfaces at runtime
  return path.join(dir, "ggml-large-v3-turbo-q5_0.bin");
}

// Project / domain vocabulary fed into whisper as initial_prompt — biases the
// decoder toward correct spelling of frequently-mistranscribed proper nouns.
// Whisper truncates this to ~244 tokens; keep it tight and front-load the
// most-confused terms. Users can append via WHISPER_PROMPT_EXTRA env.
const PROJECT_VOCAB = [
  "Claude", "Claude Code", "Anthropic", "Sonnet", "Opus", "Haiku",
  "TypeScript", "JavaScript", "React", "Vite", "Hono", "Zustand", "Tailwind",
  "PWA", "WebSocket", "Tailscale", "launchd", "chokidar", "whisper", "ffmpeg",
  "pnpm", "monorepo", "frontend", "backend", "subprocess", "stream-json",
  "stdin", "stdout", "subscribe", "unsubscribe", "debounce", "throttle",
  "GitHub", "commit", "diff", "branch", "merge", "pull request", "TODO",
  "Edge TTS", "晓晓", "VAD", "STT", "OAuth", "Bearer", "localStorage",
  "AirPods", "蓝牙", "麦克风", "扬声器",
].join(", ");

const WHISPER_PROMPT = (() => {
  const extra = process.env.WHISPER_PROMPT_EXTRA?.trim();
  return extra ? `${PROJECT_VOCAB}, ${extra}` : PROJECT_VOCAB;
})();

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function run(cmd: string, args: string[], timeoutMs = 30_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

export const voiceRouter = new Hono();

voiceRouter.post("/transcribe", async (c) => {
  const started = Date.now();
  const ct = c.req.header("content-type") ?? "application/octet-stream";

  let audioBytes: Buffer;
  try {
    const ab = await c.req.arrayBuffer();
    audioBytes = Buffer.from(ab);
  } catch (err) {
    return c.json({ error: "failed to read body" }, 400);
  }
  if (audioBytes.length === 0) {
    return c.json({ error: "empty body" }, 400);
  }
  if (audioBytes.length > 50 * 1024 * 1024) {
    return c.json({ error: "audio too large (>50MB)" }, 413);
  }

  // pick extension based on content-type for ffmpeg's auto-detection
  const ext = ct.includes("mp4") || ct.includes("m4a") ? "m4a"
    : ct.includes("webm") ? "webm"
    : ct.includes("ogg") ? "ogg"
    : ct.includes("wav") ? "wav"
    : "bin";

  const lang = c.req.query("lang") ?? DEFAULT_LANG;
  const dir = await mkdtemp(path.join(tmpdir(), "voice-"));
  const inputPath = path.join(dir, `in.${ext}`);
  const wavPath = path.join(dir, "out.wav");

  try {
    await writeFile(inputPath, audioBytes);

    // transcode to 16kHz mono PCM WAV (whisper's native input).
    // Audio filter chain:
    //   highpass=f=80   — cut sub-80Hz rumble (HVAC, footsteps, mic handling)
    //   afftdn=nf=-20   — adaptive denoise; -20dB noise floor is gentle, won't eat words
    //   dynaudnorm      — equalize loudness across the clip; helps quiet talkers
    const ff = await run(FFMPEG_BIN, [
      "-y", "-loglevel", "error",
      "-i", inputPath,
      "-af", "highpass=f=80,afftdn=nf=-20,dynaudnorm",
      "-ar", "16000", "-ac", "1",
      "-c:a", "pcm_s16le",
      wavPath,
    ], 15_000);
    if (ff.code !== 0) {
      return c.json({ error: `ffmpeg failed: ${ff.stderr.slice(0, 300)}` }, 500);
    }

    // whisper-cli: -nt (no timestamps), -np (no progress), --prompt for vocab bias
    const model = resolveWhisperModel();
    const outPrefix = path.join(dir, "transcript");
    const w = await run(WHISPER_BIN, [
      "-m", model,
      "-l", lang,
      "-nt", "-np",
      "--prompt", WHISPER_PROMPT,
      "-otxt",
      "-of", outPrefix,
      wavPath,
    ], 60_000);
    if (w.code !== 0) {
      return c.json({ error: `whisper failed: ${w.stderr.slice(0, 300)}` }, 500);
    }

    let text: string;
    try {
      text = (await readFile(`${outPrefix}.txt`, "utf-8")).trim();
    } catch {
      // fallback: parse stdout (whisper-cli also prints transcript)
      text = w.stdout
        .split("\n")
        .filter((l) => l && !l.startsWith("[") && !l.startsWith("ggml_") && !l.startsWith("load_"))
        .join("\n")
        .trim();
    }

    return c.json({ text, durationMs: Date.now() - started });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

voiceRouter.get("/info", (c) =>
  c.json({
    model: resolveWhisperModel(),
    lang: DEFAULT_LANG,
    promptVocabSize: WHISPER_PROMPT.length,
    available: true,
  }),
);

const CLEANUP_SYSTEM_PROMPT = `你是一个语音输入整理助手。用户通过麦克风口述了一段中文（可能夹英文术语），下面是 STT 转写后的原始文字（可能有口语化、错字、重复、嗯啊等填充词，以及把英文专有名词写成同音中文的情况）。请把它整理成一段清晰、通顺、无口语填充词的请求或描述。

要求：
- 保持原意，不要添加用户没说的内容
- 去掉嗯/啊/那个/就是 等填充词
- 修复明显的同音错字（联系上下文判断）
- **谐音纠错**：如果听起来像下面词表里的某个词，就替换成词表里的拼写（中文转英文、错别字 → 正字）
- 合并被语音识别打散的短句
- 不要回答用户的请求，只整理文字
- 直接输出整理后的文字，不要任何解释、引号或前缀

项目专有名词词表（优先匹配）：${PROJECT_VOCAB}`;

const CLAUDE_BIN = process.env.CLAUDE_CLI ?? "claude";

const EDGE_TTS_BIN = process.env.EDGE_TTS_BIN ?? "edge-tts";
const EDGE_TTS_VOICE = process.env.EDGE_TTS_VOICE ?? "zh-CN-XiaoxiaoNeural";

voiceRouter.post("/tts", async (c) => {
  let body: { text?: unknown; voice?: unknown; rate?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: "text required" }, 400);
  if (text.length > 2000) return c.json({ error: "text too long" }, 413);
  const voice = typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : EDGE_TTS_VOICE;
  // optional rate adjustment, e.g. "-15%" for slow, "+20%" for fast.
  // Validate strictly to avoid arg injection.
  const rate = typeof body.rate === "string" && /^[+-]?\d{1,3}%$/.test(body.rate) ? body.rate : null;

  const args = ["--voice", voice, "--text", text];
  if (rate) args.push("--rate", rate);

  const audio = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(EDGE_TTS_BIN, args);
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("edge-tts timed out"));
    }, 30_000);
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`edge-tts exited ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  }).catch((err: Error) => {
    console.warn("[voice] tts failed:", err.message);
    return { error: err.message };
  });

  if (audio && "error" in audio) {
    return c.json({ error: `tts failed: ${audio.error}` }, 500);
  }
  if (!audio || audio.length === 0) {
    return c.json({ error: "tts failed: empty output" }, 500);
  }

  return new Response(audio as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "content-length": String(audio.length),
      "cache-control": "no-store",
    },
  });
});

voiceRouter.post("/cleanup", async (c) => {
  let body: { text?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: "text required" }, 400);
  if (text.length > 4000) return c.json({ error: "text too long" }, 413);

  const args = [
    "-p",
    "--model", "claude-haiku-4-5",
    "--output-format", "json",
    "--permission-mode", "bypassPermissions",
    "--system-prompt", CLEANUP_SYSTEM_PROMPT,
    "--setting-sources", "user", // skip project/local hooks for speed
    text,
  ];

  const started = Date.now();
  const r = await new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve, reject) => {
      const child = spawn(CLAUDE_BIN, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("claude cleanup timed out"));
      }, 20_000);
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? 0 });
      });
    },
  ).catch((err) => ({ stdout: "", stderr: err.message ?? String(err), code: -1 }));

  if (r.code !== 0) {
    return c.json({ original: text, cleaned: text, fallback: true, error: r.stderr.slice(0, 200) });
  }

  let cleaned = text;
  try {
    const parsed = JSON.parse(r.stdout);
    if (typeof parsed.result === "string" && parsed.result.trim()) {
      cleaned = parsed.result.trim();
    }
  } catch {
    // fall back to raw stdout if JSON parse fails
    const trimmed = r.stdout.trim();
    if (trimmed) cleaned = trimmed;
  }

  return c.json({
    original: text,
    cleaned,
    durationMs: Date.now() - started,
  });
});

const SUMMARIZE_SYSTEM_PROMPT = `你是一个口播改写助手。下面是 Claude 的完整书面回答，里面有 markdown、表格、代码、列表等不适合朗读的内容。请改写成一段**短的、口语化的、能直接读出来的总结**，让听者立刻知道结果和下一步。

铁律：
- **绝对不要**输出任何 markdown 字符：星号、井号、反引号、方括号、竖线、连字符开头的列表都禁止
- 不要引号、不要前缀（如"总结："）
- 1 到 4 句话，最长 80 个汉字
- 不照搬原文，只挑重点：发生了什么 / 修复了什么 / 接下来该做什么
- 跳过代码、命令、文件路径、表格、长列表
- 不说"以下"、"如下"、"请参考屏幕"——直接说要点
- 用陈述句，自然停顿，避免书面词如"此外"、"综上"`;

voiceRouter.post("/summarize", async (c) => {
  let body: { text?: unknown };
  try { body = await c.req.json(); } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: "text required" }, 400);
  if (text.length > 12_000) return c.json({ error: "text too long" }, 413);

  // Trivially short responses skip the LLM round-trip.
  if (text.length <= 30) {
    return c.json({ original: text, summary: text, skipped: true, durationMs: 0 });
  }

  const started = Date.now();
  const args = [
    "-p",
    "--model", "claude-haiku-4-5",
    "--output-format", "json",
    "--permission-mode", "bypassPermissions",
    "--system-prompt", SUMMARIZE_SYSTEM_PROMPT,
    "--setting-sources", "user",
    text,
  ];
  const r = await new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve, reject) => {
      const child = spawn(CLAUDE_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("claude summarize timed out"));
      }, 20_000);
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, code: code ?? 0 }); });
    },
  ).catch((err: Error) => ({ stdout: "", stderr: err.message ?? String(err), code: -1 }));

  if (r.code !== 0) {
    return c.json({ original: text, summary: text, fallback: true, error: r.stderr.slice(0, 200) });
  }
  let summary = text;
  try {
    const parsed = JSON.parse(r.stdout);
    if (typeof parsed.result === "string" && parsed.result.trim()) summary = parsed.result.trim();
  } catch {
    const trimmed = r.stdout.trim();
    if (trimmed) summary = trimmed;
  }
  return c.json({ original: text, summary, durationMs: Date.now() - started });
});
