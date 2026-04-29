// Tail a Claude Code session's jsonl in real time and push each new
// normalized entry to subscribed ws clients. Sibling of `fs-watcher.ts`
// but scoped to a single jsonl file (not a directory tree).
//
// Subscription model:
//   - One `Entry` per (cwd, sessionId), shared by all subscribers.
//   - `committedOffset` is the byte position right after the last
//     complete \n we've already emitted. Reads always start there.
//   - `pumpFile` debounces overlapping change events through `reading`
//     and self-reschedules if the file grew while we were reading.
//
// Why byte offset and not "lines emitted":
//   The CLI append-writes whole entries, but a single chokidar `change`
//   event may surface a half-written line (writer hasn't flushed the
//   trailing \n yet). Tracking the last-newline offset lets us hand back
//   complete entries only and resume cleanly on the next tick.

import chokidar, { type FSWatcher } from "chokidar";
import { statSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import type { ServerMessage } from "@claude-web/shared";
import { normalizeJsonlEntry, sessionFilePath } from "./routes/sessions.js";

type Send = (msg: ServerMessage) => void;

interface Entry {
  cwd: string;
  sessionId: string;
  filePath: string;
  watcher: FSWatcher;
  subscribers: Set<Send>;
  /** Bytes [0, committedOffset) have been emitted to subscribers already. */
  committedOffset: number;
  /** Coalesce overlapping change events. */
  reading: boolean;
}

const entries = new Map<string, Entry>();

function key(cwd: string, sessionId: string): string {
  return `${cwd}::${sessionId}`;
}

async function pumpFile(entry: Entry): Promise<void> {
  if (entry.reading) return;
  entry.reading = true;
  try {
    let st;
    try { st = await stat(entry.filePath); }
    catch { return; }
    if (st.size <= entry.committedOffset) {
      // File rotated / truncated: realign without emitting; the user is
      // expected to reload via /api/sessions/transcript in this case.
      if (st.size < entry.committedOffset) entry.committedOffset = st.size;
      return;
    }
    const fh = await open(entry.filePath, "r");
    let text: string;
    try {
      const buf = Buffer.alloc(st.size - entry.committedOffset);
      await fh.read(buf, 0, buf.length, entry.committedOffset);
      text = buf.toString("utf-8");
    } finally {
      await fh.close();
    }
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return; // no complete line yet, wait for next change
    const completeText = text.slice(0, lastNl);
    const newOffset = entry.committedOffset + Buffer.byteLength(completeText, "utf-8") + 1;

    let emittedOffset = entry.committedOffset;
    for (const line of completeText.split("\n")) {
      emittedOffset += Buffer.byteLength(line, "utf-8") + 1;
      if (!line) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }
      const norm = normalizeJsonlEntry(obj);
      if (!norm) continue;
      const msg: ServerMessage = {
        type: "session_event",
        cwd: entry.cwd,
        sessionId: entry.sessionId,
        byteOffset: emittedOffset,
        entry: norm,
      };
      for (const send of entry.subscribers) {
        try { send(msg); } catch { /* dead socket */ }
      }
    }
    entry.committedOffset = newOffset;
  } finally {
    entry.reading = false;
  }
  // Self-reschedule if the file grew while we were reading.
  try {
    const st = await stat(entry.filePath);
    if (st.size > entry.committedOffset) void pumpFile(entry);
  } catch { /* file vanished */ }
}

/**
 * Subscribe `send` to incremental jsonl entries from a session.
 * `fromByteOffset` is honored only for the first subscriber that creates
 * the entry; later subscribers join wherever the shared watcher has
 * already advanced. Returns an unsubscribe fn.
 */
export function subscribeSession(
  cwd: string,
  sessionId: string,
  fromByteOffset: number | undefined,
  send: Send,
): () => void {
  const k = key(cwd, sessionId);
  let entry = entries.get(k);
  if (!entry) {
    const fp = sessionFilePath(cwd, sessionId);
    let initialOffset = fromByteOffset;
    if (initialOffset == null) {
      try { initialOffset = statSync(fp).size; }
      catch { initialOffset = 0; }
    }
    const watcher = chokidar.watch(fp, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    entry = {
      cwd, sessionId, filePath: fp, watcher,
      subscribers: new Set(),
      committedOffset: initialOffset,
      reading: false,
    };
    entries.set(k, entry);
    const e = entry;
    watcher.on("add", () => void pumpFile(e));
    watcher.on("change", () => void pumpFile(e));
    watcher.on("error", (err) => console.warn("[session-watcher]", k, err));
  }
  entry.subscribers.add(send);
  // Important for reconnect: if the file grew while the client was offline,
  // there may be unread bytes already present and no future change event.
  void pumpFile(entry);
  return () => {
    const e = entries.get(k);
    if (!e) return;
    e.subscribers.delete(send);
    if (e.subscribers.size === 0) {
      void e.watcher.close();
      entries.delete(k);
    }
  };
}

/** Unsubscribe by (cwd, sessionId, send). Idempotent — no-op if not subscribed. */
export function unsubscribeSession(cwd: string, sessionId: string, send: Send): void {
  const k = key(cwd, sessionId);
  const e = entries.get(k);
  if (!e) return;
  e.subscribers.delete(send);
  if (e.subscribers.size === 0) {
    void e.watcher.close();
    entries.delete(k);
  }
}
