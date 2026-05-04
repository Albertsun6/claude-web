// Persistent registry of "projects" (named cwd entries). One JSON file at
// ~/.claude-web/projects.json. Read-modify-write goes through a promise queue
// so concurrent POSTs can't lose each other's edits. Atomic rename on disk.
// A .bak copy is kept so a corrupt file doesn't lose the registry.

import { mkdir, readFile, rename, writeFile, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "./data-dir.js";

const STORE_DIR = DATA_DIR;
const STORE_PATH = path.join(STORE_DIR, "projects.json");
const BACKUP_PATH = STORE_PATH + ".bak";
const TMP_PATH = STORE_PATH + ".tmp";

const CURRENT_VERSION = 1;

export interface Project {
  id: string;
  name: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  sticky?: boolean;
}

export const SCRATCH_CWD = path.join(STORE_DIR, "scratch");
const SCRATCH_DEFAULT_NAME = "💬 随手问";

interface Store {
  version: number;
  projects: Project[];
}

function emptyStore(): Store {
  return { version: CURRENT_VERSION, projects: [] };
}

async function ensureDir(): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
}

async function loadFromDisk(): Promise<Store> {
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Store;
    if (typeof parsed?.version !== "number" || !Array.isArray(parsed.projects)) {
      throw new Error("malformed store");
    }
    return parsed;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") return emptyStore();
    // Try .bak before giving up — corrupted main file shouldn't wipe data.
    console.warn(
      `[projects-store] failed to read ${STORE_PATH}: ${e?.message ?? err}. Trying .bak.`,
    );
    try {
      const raw = await readFile(BACKUP_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Store;
      console.warn(`[projects-store] recovered from ${BACKUP_PATH}`);
      return parsed;
    } catch {
      console.error(
        `[projects-store] both ${STORE_PATH} and ${BACKUP_PATH} unreadable — starting empty.`,
      );
      return emptyStore();
    }
  }
}

async function saveToDisk(store: Store): Promise<void> {
  await ensureDir();
  // Backup current file (if any) before overwrite, so a write that crashes
  // mid-rename can still be recovered from .bak.
  try {
    await stat(STORE_PATH);
    await copyFile(STORE_PATH, BACKUP_PATH);
  } catch {
    // No existing file — nothing to back up.
  }
  const body = JSON.stringify(store, null, 2);
  await writeFile(TMP_PATH, body, "utf-8");
  await rename(TMP_PATH, STORE_PATH);
}

// Promise-based write lock. Node.js is single-threaded, but read-modify-write
// across awaits is not atomic — two concurrent POSTs would each load, mutate,
// and write, and the second would clobber the first's change (lost update).
// Serializing all mutations through this queue prevents that.
let writeQueue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  // Don't propagate this caller's failure to subsequent waiters.
  writeQueue = next.catch(() => undefined);
  return next;
}

export async function listProjects(): Promise<Project[]> {
  const store = await loadFromDisk();
  return store.projects.slice();
}

export async function findByCwd(cwd: string): Promise<Project | null> {
  const projects = await listProjects();
  const norm = path.resolve(cwd);
  return projects.find((p) => path.resolve(p.cwd) === norm) ?? null;
}

/**
 * Register a new project. If a project with this cwd already exists,
 * returns the existing one (idempotent — POSTs that race for the same
 * cwd should converge to one entry).
 */
export async function createProject(name: string, cwd: string): Promise<Project> {
  const trimmedName = name.trim();
  const normCwd = path.resolve(cwd);
  return withLock(async () => {
    const store = await loadFromDisk();
    const existing = store.projects.find((p) => path.resolve(p.cwd) === normCwd);
    if (existing) return existing;
    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      name: trimmedName.length > 0 ? trimmedName : path.basename(normCwd) || normCwd,
      cwd: normCwd,
      createdAt: now,
      updatedAt: now,
    };
    store.projects.push(project);
    await saveToDisk(store);
    return project;
  });
}

export async function renameProject(
  id: string,
  name: string,
): Promise<Project | null> {
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  return withLock(async () => {
    const store = await loadFromDisk();
    const idx = store.projects.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    store.projects[idx] = {
      ...store.projects[idx],
      name: trimmedName,
      updatedAt: new Date().toISOString(),
    };
    await saveToDisk(store);
    return store.projects[idx];
  });
}

/**
 * Remove a project from the registry. Does NOT touch the underlying jsonl
 * session files at ~/.claude/projects/<encoded-cwd>/ — those persist so
 * users can recover history if they re-register the same cwd.
 */
export async function forgetProject(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await loadFromDisk();
    const before = store.projects.length;
    store.projects = store.projects.filter((p) => p.id !== id);
    if (store.projects.length === before) return false;
    await saveToDisk(store);
    return true;
  });
}

/**
 * Check each project's cwd. Returns the ones whose directory no longer
 * exists (moved, deleted, external drive unmounted). Caller decides whether
 * to forget them — we never auto-forget.
 */
/**
 * Idempotent boot-time setup for the always-available scratch project.
 * Creates the directory + a sticky-pinned project entry so the user always has
 * a "no-cwd" chat target. If a non-sticky entry for the same cwd already
 * exists (e.g. user previously registered it manually), we mark it sticky
 * but leave the user-chosen name alone.
 */
export async function ensureScratchProject(): Promise<Project> {
  await mkdir(SCRATCH_CWD, { recursive: true });
  return withLock(async () => {
    const store = await loadFromDisk();
    const existing = store.projects.find((p) => path.resolve(p.cwd) === SCRATCH_CWD);
    if (existing) {
      if (existing.sticky === true) return existing;
      const idx = store.projects.indexOf(existing);
      store.projects[idx] = { ...existing, sticky: true, updatedAt: new Date().toISOString() };
      await saveToDisk(store);
      return store.projects[idx];
    }
    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      name: SCRATCH_DEFAULT_NAME,
      cwd: SCRATCH_CWD,
      createdAt: now,
      updatedAt: now,
      sticky: true,
    };
    store.projects.push(project);
    await saveToDisk(store);
    return project;
  });
}

export async function findMissingProjects(): Promise<Project[]> {
  const projects = await listProjects();
  const checks = await Promise.all(
    projects.map(async (p) => {
      try {
        const st = await stat(p.cwd);
        return st.isDirectory() ? null : p; // file at that path counts as missing
      } catch {
        return p;
      }
    }),
  );
  return checks.filter((p): p is Project => p !== null);
}
