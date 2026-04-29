// Read past Claude CLI sessions from ~/.claude/projects/<encoded-cwd>/<sid>.jsonl

import { Hono } from "hono";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { verifyAllowedPath } from "../auth.js";

export const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

export function encodeCwd(cwd: string): string {
  // CLI replaces every "/" with "-" (also strips leading "/" → leading "-")
  return cwd.replace(/\//g, "-");
}

/** Absolute path to the jsonl transcript backing a Claude Code session. */
export function sessionFilePath(cwd: string, sessionId: string): string {
  return path.join(PROJECTS_DIR, encodeCwd(cwd), `${sessionId}.jsonl`);
}

export interface SessionMeta {
  sessionId: string;
  preview: string;
  mtime: number;
  size: number;
}

export const sessionsRouter = new Hono();

// Per-cwd cache of (mtime, preview) so we don't re-read every jsonl on every list.
interface CacheEntry { mtime: number; size: number; preview: string }
const cache = new Map<string, Map<string, CacheEntry>>(); // cwd → sessionId → entry

async function readPreview(fp: string): Promise<string> {
  let head: string;
  try { head = await readFile(fp, "utf-8"); } catch { return ""; }
  for (const line of head.slice(0, 60_000).split("\n")) {
    if (!line) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.isSidechain || obj.isMeta) continue;
    if (obj.type !== "user" || !obj.message?.content) continue;
    const cnt = obj.message.content;
    if (typeof cnt === "string") return cnt.slice(0, 120);
    if (Array.isArray(cnt)) {
      const text = cnt
        .map((b: any) => (typeof b?.text === "string" ? b.text : ""))
        .filter(Boolean)
        .join(" ");
      if (text) return text.slice(0, 120);
    }
  }
  return "";
}

sessionsRouter.get("/list", async (c) => {
  const cwd = c.req.query("cwd");
  if (!cwd || !path.isAbsolute(cwd)) {
    return c.json({ error: "cwd absolute path required" }, 400);
  }
  const allowErr = verifyAllowedPath(cwd);
  if (allowErr) return c.json({ error: allowErr }, 403);

  const dir = path.join(PROJECTS_DIR, encodeCwd(cwd));
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return c.json({ sessions: [] });
  }
  const files = entries.filter((e) => e.endsWith(".jsonl"));
  const cwdCache = cache.get(cwd) ?? new Map<string, CacheEntry>();
  const next = new Map<string, CacheEntry>();

  const items: SessionMeta[] = await Promise.all(
    files.map(async (f) => {
      const fp = path.join(dir, f);
      const sessionId = f.replace(/\.jsonl$/, "");
      let st;
      try { st = await stat(fp); } catch {
        return { sessionId, preview: "", mtime: 0, size: 0 };
      }
      const cached = cwdCache.get(sessionId);
      let preview: string;
      if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) {
        preview = cached.preview;
      } else {
        preview = await readPreview(fp);
      }
      const entry: CacheEntry = { mtime: st.mtimeMs, size: st.size, preview };
      next.set(sessionId, entry);
      return { sessionId, preview, mtime: st.mtimeMs, size: st.size };
    }),
  );
  cache.set(cwd, next);

  items.sort((a, b) => b.mtime - a.mtime);
  return c.json({ sessions: items.slice(0, 50) });
});

/**
 * Convert one CLI jsonl entry into a frontend-renderable message, or null
 * to skip. Pulled out for unit testing.
 */
export function normalizeJsonlEntry(obj: any): unknown | null {
  if (!obj || typeof obj !== "object") return null;
  if (obj.isSidechain) return null;        // subagent traces
  if (obj.isMeta) return null;             // CLI internal metadata
  if (obj.isCompactSummary) return null;
  const t = obj.type;
  if (t === "user" || t === "assistant") {
    const cnt = obj?.message?.content;
    if (typeof cnt === "string") {
      return {
        ...obj,
        message: { ...obj.message, content: [{ type: "text", text: cnt }] },
      };
    }
    if (Array.isArray(cnt)) return obj;
    return null;
  }
  if (t === "system" && (obj.subtype === "init" || obj.subtype === "compact_boundary")) {
    return obj;
  }
  if (t === "result") return obj;
  return null;
}

sessionsRouter.get("/transcript", async (c) => {
  const cwd = c.req.query("cwd");
  const sessionId = c.req.query("sessionId");
  if (!cwd || !path.isAbsolute(cwd)) {
    return c.json({ error: "cwd absolute path required" }, 400);
  }
  const allowErr = verifyAllowedPath(cwd);
  if (allowErr) return c.json({ error: allowErr }, 403);
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) {
    return c.json({ error: "valid sessionId required" }, 400);
  }
  const fp = sessionFilePath(cwd, sessionId);
  let raw: string;
  let fileSize = 0;
  try {
    raw = await readFile(fp, "utf-8");
    fileSize = Buffer.byteLength(raw, "utf-8");
  } catch {
    return c.json({ error: "session not found" }, 404);
  }

  const messages: unknown[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    const norm = normalizeJsonlEntry(obj);
    if (norm) messages.push(norm);
  }

  // fileSize lets the client wire up a `session_subscribe` immediately after
  // this transcript without dropping or duplicating any intervening lines.
  return c.json({ sessionId, messages, fileSize });
});
