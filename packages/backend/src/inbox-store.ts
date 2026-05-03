// Inbox store: append-only JSONL of "碎想" captured from iOS / Web.
// Path: ~/.claude-web/inbox.jsonl
// Reads buffered into a small in-memory cache for /list endpoint.
//
// NOTE on write throughput: setTriage / markProcessed do an O(N) full-file
// rewrite (line 90+ markProcessed pattern). Fine at current scale; expect
// noticeable lag past ~10k items — switch to sqlite or per-id index then.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

export type InboxStatus = "open" | "archived";
export type TriageDestination = "ideas" | "archive";

export interface InboxTriage {
  destination: TriageDestination;
  note?: string;
  triagedAt: number;
}

export interface InboxItem {
  id: string;
  body: string;
  source: "voice" | "text" | "web" | "ios" | "unknown";
  capturedAt: number;
  /** When set, this item was already converted into a real Issue/conversation. */
  processedIntoConversationId?: string;
  /**
   * Lifecycle: "open" (default, includes both fresh + triaged-to-ideas)
   * or "archived". Absent on legacy records — readers MUST treat undefined
   * as "open" for backward compat.
   */
  status?: InboxStatus;
  /** Triage decision metadata. Set by setTriage; never written by clients. */
  triage?: InboxTriage;
  /** Free-form metadata (audio path, transcript confidence, location, etc). */
  meta?: Record<string, unknown>;
}

const STORE_DIR = path.join(os.homedir(), ".claude-web");
const STORE_PATH = path.join(STORE_DIR, "inbox.jsonl");

let memoryCache: InboxItem[] | null = null;

function ensureDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function loadAll(): InboxItem[] {
  if (memoryCache !== null) return memoryCache;
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    memoryCache = lines.map((line) => {
      try {
        return JSON.parse(line) as InboxItem;
      } catch {
        return null;
      }
    }).filter((x): x is InboxItem => x !== null);
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn(`[inbox] failed to read ${STORE_PATH}:`, err?.message ?? err);
    }
    memoryCache = [];
  }
  return memoryCache;
}

export interface AppendInput {
  body: string;
  source?: InboxItem["source"];
  meta?: Record<string, unknown>;
}

export function appendInbox(input: AppendInput): InboxItem {
  ensureDir();
  const item: InboxItem = {
    id: randomUUID(),
    body: input.body.trim(),
    source: input.source ?? "unknown",
    capturedAt: Date.now(),
    meta: input.meta,
  };
  fs.appendFileSync(STORE_PATH, JSON.stringify(item) + "\n", "utf8");
  if (memoryCache !== null) memoryCache.push(item);
  return item;
}

export interface ListOptions {
  /** Only items whose processedIntoConversationId is null. Default false. */
  unprocessedOnly?: boolean;
  /** Include archived items. Default false (archived hidden by default). */
  includeArchived?: boolean;
  /** Max items to return; latest first. Default 50. */
  limit?: number;
}

export function listInbox(opts: ListOptions = {}): InboxItem[] {
  const all = loadAll();
  let filtered = all;
  if (!opts.includeArchived) {
    filtered = filtered.filter((it) => it.status !== "archived");
  }
  if (opts.unprocessedOnly) {
    filtered = filtered.filter((it) => !it.processedIntoConversationId);
  }
  // newest first
  return filtered.slice().reverse().slice(0, opts.limit ?? 50);
}

export function markProcessed(id: string, conversationId: string): InboxItem | null {
  const all = loadAll();
  const idx = all.findIndex((it) => it.id === id);
  if (idx < 0) return null;
  const updated = { ...all[idx], processedIntoConversationId: conversationId };
  all[idx] = updated;
  // rewrite the file (~ once per triage; not hot path)
  ensureDir();
  fs.writeFileSync(
    STORE_PATH,
    all.map((it) => JSON.stringify(it)).join("\n") + "\n",
    "utf8",
  );
  return updated;
}

export interface SetTriageInput {
  destination: TriageDestination;
  note?: string;
}

/**
 * Apply a triage decision to an inbox item. Backend is the only writer of
 * `status` / `triage` — clients never supply these on POST /api/inbox.
 *   destination=archive → status="archived" + triage block
 *   destination=ideas   → status stays "open" (item still surfaces); triage
 *                         block records the routing intent. UI copies body
 *                         to clipboard so the user manually pastes into
 *                         docs/IDEAS.md or docs/HARNESS_ROADMAP §17.
 *                         Backend never writes those docs (§16.3 #1).
 */
export function setTriage(id: string, input: SetTriageInput): InboxItem | null {
  const all = loadAll();
  const idx = all.findIndex((it) => it.id === id);
  if (idx < 0) return null;
  const triage: InboxTriage = {
    destination: input.destination,
    note: input.note,
    triagedAt: Date.now(),
  };
  const updated: InboxItem = {
    ...all[idx],
    status: input.destination === "archive" ? "archived" : "open",
    triage,
  };
  all[idx] = updated;
  ensureDir();
  fs.writeFileSync(
    STORE_PATH,
    all.map((it) => JSON.stringify(it)).join("\n") + "\n",
    "utf8",
  );
  return updated;
}

export function inboxStats(): { total: number; unprocessed: number } {
  const all = loadAll();
  let unprocessed = 0;
  for (const it of all) if (!it.processedIntoConversationId) unprocessed++;
  return { total: all.length, unprocessed };
}
