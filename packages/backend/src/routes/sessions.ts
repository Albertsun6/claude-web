// Read past Claude CLI sessions from ~/.claude/projects/<encoded-cwd>/<sid>.jsonl

import { Hono } from "hono";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

function encodeCwd(cwd: string): string {
  // CLI replaces every "/" with "-" (also strips leading "/" → leading "-")
  return cwd.replace(/\//g, "-");
}

interface SessionMeta {
  sessionId: string;
  preview: string;
  mtime: number;
  size: number;
}

export const sessionsRouter = new Hono();

sessionsRouter.get("/list", async (c) => {
  const cwd = c.req.query("cwd");
  if (!cwd || !path.isAbsolute(cwd)) {
    return c.json({ error: "cwd absolute path required" }, 400);
  }
  const dir = path.join(PROJECTS_DIR, encodeCwd(cwd));
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return c.json({ sessions: [] });
  }
  const files = entries.filter((e) => e.endsWith(".jsonl"));

  const items: SessionMeta[] = await Promise.all(
    files.map(async (f) => {
      const fp = path.join(dir, f);
      const sessionId = f.replace(/\.jsonl$/, "");
      let mtime = 0, size = 0, preview = "";
      try {
        const st = await stat(fp);
        mtime = st.mtimeMs;
        size = st.size;
        const head = await readFile(fp, "utf-8");
        for (const line of head.slice(0, 60_000).split("\n")) {
          if (!line) continue;
          let obj: any;
          try { obj = JSON.parse(line); } catch { continue; }
          if (obj.type !== "user" || !obj.message?.content) continue;
          const cnt = obj.message.content;
          if (typeof cnt === "string") {
            preview = cnt;
          } else if (Array.isArray(cnt)) {
            preview = cnt
              .map((b: any) => (typeof b?.text === "string" ? b.text : ""))
              .filter(Boolean)
              .join(" ");
          }
          if (preview) break;
        }
      } catch { /* ignore */ }
      return { sessionId, preview: preview.slice(0, 120), mtime, size };
    }),
  );

  items.sort((a, b) => b.mtime - a.mtime);
  return c.json({ sessions: items.slice(0, 50) });
});

sessionsRouter.get("/transcript", async (c) => {
  const cwd = c.req.query("cwd");
  const sessionId = c.req.query("sessionId");
  if (!cwd || !path.isAbsolute(cwd)) {
    return c.json({ error: "cwd absolute path required" }, 400);
  }
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) {
    return c.json({ error: "valid sessionId required" }, 400);
  }
  const fp = path.join(PROJECTS_DIR, encodeCwd(cwd), `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(fp, "utf-8");
  } catch {
    return c.json({ error: "session not found" }, 404);
  }

  // Convert CLI jsonl entries → frontend-renderable messages.
  // Frontend MessageItem already handles raw messages of the SDK shape.
  const messages: unknown[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    // skip queue-operation, summary, etc; keep user/assistant/system:init/result
    const t = obj.type;
    if (t === "user" || t === "assistant") {
      messages.push(obj);
    } else if (t === "system" && (obj.subtype === "init" || obj.subtype === "compact_boundary")) {
      messages.push(obj);
    } else if (t === "result") {
      messages.push(obj);
    }
  }

  return c.json({ sessionId, messages });
});
