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
  // Optional `prev` from convo mode — last segment's transcript. Appending it
  // to whisper's --prompt gives the decoder context across utterances, big
  // accuracy bump for long multi-segment turns.
  const prevHint = c.req.query("prev")?.slice(0, 200) ?? "";
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
    const promptArg = prevHint
      ? `${WHISPER_PROMPT}. Previously: ${prevHint}`
      : WHISPER_PROMPT;
    const w = await run(WHISPER_BIN, [
      "-m", model,
      "-l", lang,
      "-nt", "-np",
      "--prompt", promptArg,
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


const SUMMARIZE_SYSTEM_PROMPT = `把下面的内容改写成一两句适合朗读的口语，直接输出结果。`;

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
  let summary = "";
  try {
    const parsed = JSON.parse(r.stdout);
    if (typeof parsed.result === "string" && parsed.result.trim()) summary = parsed.result.trim();
  } catch {
    // stdout is not JSON — treat as failure so iOS falls back gracefully
  }
  if (!summary) {
    return c.json({ original: text, summary: text, fallback: true, error: "empty result" });
  }
  if (summary.length > text.length * 0.85) {
    return c.json({ original: text, summary: text, fallback: true, error: "no compression" });
  }
  return c.json({ original: text, summary, durationMs: Date.now() - started });
});

// POST /api/voice/notes-summary
//   body: { text: string }   accumulated meeting / brainstorm transcript
//   returns: { original, summary: string (markdown), durationMs }
//
// Different from /summarize: that one rewrites a single Claude reply into a
// short TTS-friendly blurb. This one structures a long messy monologue
// (requirements gathering, brainstorming) into headed sections.
const NOTES_SUMMARY_SYSTEM_PROMPT = `你是会议/需求/头脑风暴的整理助手。下面是用户口述、由 STT 转写出来的原始文字（多段拼接，可能有重复、口语化、错别字、岔题）。请整理成一份结构化的中文 Markdown 总结，要求：

输出格式（按需省略空小节，不要硬凑）：
## 核心需求 / 主题
- 用 1-3 句话概括用户最想表达的事

## 关键点
- 把分散在不同段落里的同一主题合并到一起，去掉重复
- 用简短的要点列出（每条 ≤ 30 字）

## 决策 / 结论
- 用户已经明确表态的选择、放弃的方案

## 待办 / 行动项
- 需要后续做的事，一条一行，能分配到具体行为

## 待澄清的问题
- 用户提到但没说清楚、或自相矛盾的地方

要求：
- 保持原意，不要发明用户没说的内容
- 去掉嗯/啊/那个/就是/这个就是 等填充词
- 修复明显的同音错字（联系上下文判断）
- 直接输出 Markdown，不要任何额外解释或前缀`;

voiceRouter.post("/notes-summary", async (c) => {
  let body: { text?: unknown };
  try { body = await c.req.json(); } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: "text required" }, 400);
  if (text.length > 60_000) return c.json({ error: "text too long" }, 413);

  const started = Date.now();
  const args = [
    "-p",
    "--model", "claude-sonnet-4-6",
    "--output-format", "json",
    "--permission-mode", "bypassPermissions",
    "--system-prompt", NOTES_SUMMARY_SYSTEM_PROMPT,
    "--setting-sources", "user",
    text,
  ];
  const r = await new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve, reject) => {
      const child = spawn(CLAUDE_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("claude notes-summary timed out"));
      }, 90_000);
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, code: code ?? 0 }); });
    },
  ).catch((err: Error) => ({ stdout: "", stderr: err.message ?? String(err), code: -1 }));

  if (r.code !== 0) {
    return c.json({ error: `notes-summary failed: ${r.stderr.slice(0, 200)}` }, 500);
  }
  let summary = "";
  try {
    const parsed = JSON.parse(r.stdout);
    if (typeof parsed.result === "string" && parsed.result.trim()) summary = parsed.result.trim();
  } catch {
    return c.json({ error: "unparseable result" }, 500);
  }
  if (!summary) {
    return c.json({ error: "empty result" }, 500);
  }
  return c.json({ original: text, summary, durationMs: Date.now() - started });
});

// POST /api/voice/summarize-stream
// Streams Haiku summary sentence by sentence as SSE so iOS can start TTS
// on the first sentence before Haiku finishes the rest.
// Each event: data: {"sentence":"..."}\n\n
// End event:  data: {"done":true}\n\n
voiceRouter.post("/summarize-stream", async (c) => {
  let body: { text?: unknown };
  try { body = await c.req.json(); } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: "text required" }, 400);
  if (text.length > 12_000) return c.json({ error: "text too long" }, 413);

  // Very short text — no summarization needed, return as a single sentence.
  if (text.length <= 30) {
    const single = `data: ${JSON.stringify({ sentence: text })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`;
    return new Response(single, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  }

  const args = [
    "-p",
    "--model", "claude-haiku-4-5",
    "--output-format", "stream-json",
    "--permission-mode", "bypassPermissions",
    "--system-prompt", SUMMARIZE_SYSTEM_PROMPT,
    "--setting-sources", "user",
    text,
  ];

  const TERMINATORS = new Set(["。", "！", "？", ".", "!", "?"]);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  const emit = async (obj: Record<string, unknown>) => {
    await writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
  };

  // Run async in background; response streams immediately.
  (async () => {
    const child = spawn(CLAUDE_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let sentBuf = "";   // text accumulated waiting for sentence boundary
    let prevLen = 0;    // length of previously-seen cumulative text

    const flushSentences = async (incoming: string) => {
      sentBuf += incoming;
      while (true) {
        let boundary = -1;
        for (let i = 0; i < sentBuf.length; i++) {
          if (TERMINATORS.has(sentBuf[i])) { boundary = i; break; }
        }
        if (boundary === -1) break;
        const sentence = sentBuf.slice(0, boundary + 1).trim();
        sentBuf = sentBuf.slice(boundary + 1).trimStart();
        if (sentence) await emit({ sentence });
      }
    };

    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    let lineBuf = "";

    child.stdout.on("data", async (chunk: Buffer) => {
      lineBuf += chunk.toString();
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line) as Record<string, unknown>;
          // stream-json: each "assistant" event carries cumulative text.
          const content = (evt.message as any)?.content;
          if (evt.type === "assistant" && Array.isArray(content)) {
            let fullText = "";
            for (const block of content) {
              if (block.type === "text") fullText += block.text;
            }
            const delta = fullText.slice(prevLen);
            prevLen = fullText.length;
            if (delta) await flushSentences(delta);
          }
        } catch { /* non-JSON line, skip */ }
      }
    });

    child.on("close", async () => {
      clearTimeout(timer);
      // Flush anything remaining in the buffer.
      if (sentBuf.trim()) await emit({ sentence: sentBuf.trim() });
      await emit({ done: true });
      await writer.close();
    });
    child.on("error", async (err) => {
      clearTimeout(timer);
      await emit({ done: true, error: err.message });
      await writer.close().catch(() => {});
    });
  })();

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
  });
});
