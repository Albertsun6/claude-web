import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";
import type { ServerMessage } from "@claude-web/shared";

type Send = (msg: ServerMessage) => void;
type ChangeKind = "add" | "change" | "unlink" | "addDir" | "unlinkDir";

interface Entry {
  watcher: FSWatcher;
  subscribers: Set<Send>;
  // debounce: most recent emit per (kind|relPath) so bursts coalesce
  pending: Map<string, { kind: ChangeKind; relPath: string; timer: NodeJS.Timeout }>;
}

const entries = new Map<string, Entry>();

const IGNORED = [
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])\.next([\\/]|$)/,
  /(^|[\\/])dist([\\/]|$)/,
  /(^|[\\/])\.cache([\\/]|$)/,
  /(^|[\\/])\.DS_Store$/,
  /(^|[\\/])\.idea([\\/]|$)/,
  /(^|[\\/])\.vscode([\\/]|$)/,
];

const DEBOUNCE_MS = 200;

function emitDebounced(entry: Entry, cwd: string, kind: ChangeKind, absPath: string) {
  const relPath = path.relative(cwd, absPath);
  if (!relPath || relPath.startsWith("..")) return;
  const key = `${kind}|${relPath}`;
  const prev = entry.pending.get(key);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    entry.pending.delete(key);
    const msg: ServerMessage = { type: "fs_changed", cwd, change: kind, relPath };
    for (const send of entry.subscribers) {
      try { send(msg); } catch { /* ignore broken socket */ }
    }
  }, DEBOUNCE_MS);
  entry.pending.set(key, { kind, relPath, timer });
}

/**
 * Subscribe `send` to fs change events under `cwd`. Returns an unsubscribe.
 * Multiple subscribers share one underlying chokidar watcher per cwd.
 */
export function subscribeFs(cwd: string, send: Send): () => void {
  let entry = entries.get(cwd);
  if (!entry) {
    const watcher = chokidar.watch(cwd, {
      ignored: IGNORED,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      // depth: undefined → no limit; we rely on IGNORED to keep this manageable
    });
    entry = {
      watcher,
      subscribers: new Set(),
      pending: new Map(),
    };
    entries.set(cwd, entry);
    const e = entry;
    watcher.on("add", (p) => emitDebounced(e, cwd, "add", p));
    watcher.on("change", (p) => emitDebounced(e, cwd, "change", p));
    watcher.on("unlink", (p) => emitDebounced(e, cwd, "unlink", p));
    watcher.on("addDir", (p) => emitDebounced(e, cwd, "addDir", p));
    watcher.on("unlinkDir", (p) => emitDebounced(e, cwd, "unlinkDir", p));
    watcher.on("error", (err) => console.warn("[fs-watcher]", cwd, err));
  }
  entry.subscribers.add(send);
  return () => {
    const e = entries.get(cwd);
    if (!e) return;
    e.subscribers.delete(send);
    if (e.subscribers.size === 0) {
      for (const p of e.pending.values()) clearTimeout(p.timer);
      e.pending.clear();
      void e.watcher.close();
      entries.delete(cwd);
    }
  };
}
