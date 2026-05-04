// Work registry: per-conversation worktree history.
// Path: ~/.claude-web/work.jsonl
//
// Pattern mirrors inbox-store.ts (post-Stage-Pre lock-aware) + projects-store.ts:
// promise-queue write lock + atomic temp+rename for full rewrites.
//
// Schema constraint (v0.5 §6.5 三 store 边界声明):
// - WE DO NOT STORE cwd. cwd is derivable from worktreePath
//   (worktreePath = <cwd>/.claude-worktrees/<id>) when needed,
//   and projects.json remains the canonical cwd registry.
//
// status="discarded" is preserved (not deleted) — user hint: keep废弃 history
// for later "abandoned tasks" review.

import fs from "node:fs";
import { mkdir, rename, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./data-dir.js";

export type WorkStatus =
  | "active"
  | "idle"
  | "merged"
  | "discarded"
  | "pushed-pending-pr";

export interface WorkRecord {
  id: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  status: WorkStatus;
  conversationTitle: string;
  lastActivityAt: number;
  createdAt: number;
}

const STORE_DIR = DATA_DIR;
const STORE_PATH = path.join(STORE_DIR, "work.jsonl");
const TMP_PATH = STORE_PATH + ".tmp";

let memoryCache: WorkRecord[] | null = null;

let writeQueue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => undefined);
  return next;
}

async function ensureDirAsync(): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
}

function loadAll(): WorkRecord[] {
  if (memoryCache !== null) return memoryCache;
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    memoryCache = lines
      .map((line) => {
        try {
          return JSON.parse(line) as WorkRecord;
        } catch {
          return null;
        }
      })
      .filter((x): x is WorkRecord => x !== null);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code !== "ENOENT") {
      console.warn(`[work] failed to read ${STORE_PATH}:`, e?.message ?? err);
    }
    memoryCache = [];
  }
  return memoryCache;
}

async function atomicRewrite(items: WorkRecord[]): Promise<void> {
  await ensureDirAsync();
  const body = items.length
    ? items.map((it) => JSON.stringify(it)).join("\n") + "\n"
    : "";
  await writeFile(TMP_PATH, body, "utf8");
  await rename(TMP_PATH, STORE_PATH);
}

export interface CreateWorkInput {
  /** Caller provides id (typically server-generated randomUUID earlier in flow). */
  id: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  conversationTitle: string;
}

export function createWork(input: CreateWorkInput): Promise<WorkRecord> {
  return withLock(async () => {
    await ensureDirAsync();
    const now = Date.now();
    const record: WorkRecord = {
      id: input.id,
      worktreePath: input.worktreePath,
      branch: input.branch,
      baseBranch: input.baseBranch,
      status: "active",
      conversationTitle: input.conversationTitle,
      lastActivityAt: now,
      createdAt: now,
    };
    await appendFile(STORE_PATH, JSON.stringify(record) + "\n", "utf8");
    if (memoryCache !== null) memoryCache.push(record);
    return record;
  });
}

export function setStatus(
  id: string,
  status: WorkStatus,
): Promise<WorkRecord | null> {
  return withLock(async () => {
    const all = loadAll();
    const idx = all.findIndex((it) => it.id === id);
    if (idx < 0) return null;
    const updated: WorkRecord = {
      ...all[idx],
      status,
      lastActivityAt: Date.now(),
    };
    all[idx] = updated;
    await atomicRewrite(all);
    return updated;
  });
}

export function findById(id: string): WorkRecord | null {
  return loadAll().find((it) => it.id === id) ?? null;
}

export interface ListByCwdOptions {
  /** Include status="discarded" / "merged". Default false. */
  includeFinished?: boolean;
}

/**
 * List records whose worktreePath is under the given cwd.
 * cwd matching is exact-prefix on the parent .claude-worktrees/ path.
 */
export function listByCwd(
  cwd: string,
  opts: ListByCwdOptions = {},
): WorkRecord[] {
  const all = loadAll();
  const expectedPrefix = path.resolve(path.join(cwd, ".claude-worktrees")) + path.sep;
  const filtered = all.filter((it) => {
    const wp = path.resolve(it.worktreePath);
    if (!wp.startsWith(expectedPrefix)) return false;
    if (!opts.includeFinished && (it.status === "discarded" || it.status === "merged"))
      return false;
    return true;
  });
  // Newest first
  return filtered.slice().sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/** For testing / staging — drops in-memory cache so next read hits disk. */
export function _resetCache(): void {
  memoryCache = null;
}
