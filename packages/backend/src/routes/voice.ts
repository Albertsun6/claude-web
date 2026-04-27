// POST /api/voice/transcribe
//   body: raw audio bytes (audio/webm, audio/mp4, audio/wav...)
//   returns: { text: string, durationMs: number }
//
// Pipeline: incoming audio → ffmpeg → 16kHz mono WAV → whisper-cli → text.
// All processing local; no external API.

import { Hono } from "hono";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import os from "node:os";

const WHISPER_BIN = process.env.WHISPER_BIN ?? "whisper-cli";
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ??
  path.join(os.homedir(), ".whisper-models", "ggml-large-v3-turbo-q5_0.bin");
const FFMPEG_BIN = process.env.FFMPEG_BIN ?? "ffmpeg";
const DEFAULT_LANG = process.env.WHISPER_LANG ?? "zh";

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

    // transcode to 16kHz mono PCM WAV (whisper's native input)
    const ff = await run(FFMPEG_BIN, [
      "-y", "-loglevel", "error",
      "-i", inputPath,
      "-ar", "16000", "-ac", "1",
      "-c:a", "pcm_s16le",
      wavPath,
    ], 15_000);
    if (ff.code !== 0) {
      return c.json({ error: `ffmpeg failed: ${ff.stderr.slice(0, 300)}` }, 500);
    }

    // whisper-cli with -nt (no timestamps), -np (no progress), -of for output prefix
    const outPrefix = path.join(dir, "transcript");
    const w = await run(WHISPER_BIN, [
      "-m", WHISPER_MODEL,
      "-l", lang,
      "-nt", "-np",
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
    model: WHISPER_MODEL,
    lang: DEFAULT_LANG,
    available: true,
  }),
);
