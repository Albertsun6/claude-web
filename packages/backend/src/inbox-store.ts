// Inbox store: append-only JSONL of "碎想" captured from iOS / Web.
// Path: ~/.vessel/inbox.jsonl
// Reads buffered into a small in-memory cache for /list endpoint.
//
// Concurrency: all mutations go through `withLock` (promise-queue) so two
// concurrent POST /api/inbox / triage / processed requests can't lose each
// other's edit. Full rewrites use atomic temp+rename; appends use appendFile.
// Pattern mirrors projects-store.ts.
//
// NOTE on write throughput: setTriage / markProcessed do an O(N) full-file
// rewrite. Fine at current scale; expect noticeable lag past ~10k items —
// switch to sqlite or per-id index then.

import fs from "node:fs";
import { rename, writeFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "./data-dir.js";
import type { HarnessDb } from "./harness-store.js";

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
  /** Working directory this idea belongs to. Optional — omitted means global. */
  cwd?: string;
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

const STORE_DIR = DATA_DIR;
const STORE_PATH = path.join(STORE_DIR, "inbox.jsonl");
const TMP_PATH = STORE_PATH + ".tmp";

let memoryCache: InboxItem[] | null = null;

// ============================================================================
// PIM dual-write (ADR-020 D3) — 2-week buffer period
// ============================================================================
//
// POST /api/inbox 同时写 jsonl + pim_item. pim_item INSERT 失败 → log warn 不阻塞.
// 由 index.ts 启动时 setPimDbForInbox(_harnessDb) 注入 DB instance.
// 设计选择 (vs factory pattern): inbox-store 接受外部注入避免 router 签名变化.
// 旧 client 仍 POST 老的 inbox.jsonl 字段, pim_item 字段映射见
// scripts/migrate-inbox-to-pim.ts mapInboxToPim().
let _pimDb: HarnessDb | null = null;

/** Called from index.ts after openHarnessDb succeeds. */
export function setPimDbForInbox(db: HarnessDb | null): void {
  _pimDb = db;
}

/** Best-effort dual-write to pim_item. Logs but doesn't throw. */
function dualWriteToPim(item: InboxItem): void {
  if (_pimDb == null) return; // No PIM DB yet (e.g. test env, HARNESS_DISABLED=1)
  try {
    const archived = item.status === "archived" || item.triage?.destination === "archive";
    _pimDb.db
      .prepare(
        `INSERT OR IGNORE INTO pim_item
           (id, content, captured_at, source, commitment_state, modality, ai_status, visibility, created_at, updated_at)
         VALUES
           (@id, @content, @capturedAt, @source, @commitmentState, 'text', 'pending', 'private', @capturedAt, @capturedAt)`,
      )
      .run({
        id: item.id,
        content: item.body,
        capturedAt: item.capturedAt,
        source: item.source,
        commitmentState: archived ? "archived" : "inbox",
      });
  } catch (err) {
    console.warn(`[inbox] dual-write to pim_item failed for ${item.id}: ${(err as Error).message}`);
  }
}

// Promise-based write lock (mirrors projects-store.ts). Node.js is
// single-threaded, but read-modify-write across awaits is not atomic — two
// concurrent triage/processed requests would each load, mutate, and rewrite,
// and the second would clobber the first's change. Serializing all mutations
// through this queue prevents that.
let writeQueue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  // Don't propagate this caller's failure to subsequent waiters.
  writeQueue = next.catch(() => undefined);
  return next;
}

async function ensureDirAsync(): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
}

function ensureDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

/** Atomic full-file rewrite: write to TMP, then rename. Caller must hold the lock. */
async function atomicRewrite(items: InboxItem[]): Promise<void> {
  await ensureDirAsync();
  const body = items.length
    ? items.map((it) => JSON.stringify(it)).join("\n") + "\n"
    : "";
  await writeFile(TMP_PATH, body, "utf8");
  await rename(TMP_PATH, STORE_PATH);
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
  cwd?: string;
  meta?: Record<string, unknown>;
}

export function appendInbox(input: AppendInput): Promise<InboxItem> {
  return withLock(async () => {
    await ensureDirAsync();
    const item: InboxItem = {
      id: randomUUID(),
      body: input.body.trim(),
      source: input.source ?? "unknown",
      capturedAt: Date.now(),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      meta: input.meta,
    };
    await appendFile(STORE_PATH, JSON.stringify(item) + "\n", "utf8");
    if (memoryCache !== null) memoryCache.push(item);
    dualWriteToPim(item); // ADR-020 D3 dual-write 2-week buffer; best-effort, never throws
    return item;
  });
}

export interface ListOptions {
  /** Only items whose processedIntoConversationId is null. Default false. */
  unprocessedOnly?: boolean;
  /** Include archived items. Default false (archived hidden by default). */
  includeArchived?: boolean;
  /** Max items to return; latest first. Default 50. */
  limit?: number;
  /** Filter by cwd. If omitted, returns all items regardless of cwd. */
  cwd?: string;
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
  if (opts.cwd) {
    filtered = filtered.filter((it) => it.cwd === opts.cwd);
  }
  // newest first
  return filtered.slice().reverse().slice(0, opts.limit ?? 50);
}

export function markProcessed(
  id: string,
  conversationId: string,
): Promise<InboxItem | null> {
  return withLock(async () => {
    const all = loadAll();
    const idx = all.findIndex((it) => it.id === id);
    if (idx < 0) return null;
    const updated = { ...all[idx], processedIntoConversationId: conversationId };
    all[idx] = updated;
    await atomicRewrite(all);
    return updated;
  });
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
export function setTriage(
  id: string,
  input: SetTriageInput,
): Promise<InboxItem | null> {
  return withLock(async () => {
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
    await atomicRewrite(all);
    return updated;
  });
}

export function inboxStats(): { total: number; unprocessed: number } {
  const all = loadAll();
  let unprocessed = 0;
  for (const it of all) if (!it.processedIntoConversationId) unprocessed++;
  return { total: all.length, unprocessed };
}
