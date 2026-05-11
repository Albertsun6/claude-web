/**
 * M0 minimal session/intent/skill_invocation persistence (memory.db).
 *
 * Scope:
 *  - bootSession(): new or reuse session by id
 *  - writeIntent(): persist intent on receipt
 *  - writeSkillInvocation(): persist run + artifact / error
 *  - close(): flush WAL + close handle (SIGINT path)
 *
 * Migration runner: minimal (single-file 0004); harness-store.ts handles Eva harness.db
 * separately. This is a NEW DB at <DATA_DIR>/memory.db.
 *
 * @see FRAMEWORK §2 Session/Intent/Artifact
 * @see migrations/0004_m0_sessions.sql
 */

import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from '../data-dir.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// memory.db 用独立 migrations-memory/ 目录，避免与 harness-store glob (`/^\d{4}_.*\.sql$/`)
// 互相吞食对方 migration（v0A.1 M0 4-way review BLOCKER unanimous fix）。
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations-memory');

// memory.db 独立版本序列：M0=1; M1=2 (lessons); M1C-A=3 (workflow_state); M1C-B=4 (memory_records); v5=intent_v2
export const MEMORY_SCHEMA_VERSION = 5;
const MIGRATIONS = [
  { version: 1, file: '0001_m0_sessions.sql' },
  { version: 2, file: '0002_m1_lessons.sql' },
  { version: 3, file: '0003_m1c_workflows.sql' },
  { version: 4, file: '0004_m1c_memory.sql' },
  { version: 5, file: '0005_intent_v2.sql' },
];

let dbInstance: Database.Database | null = null;

export function openMemoryDb(): Database.Database {
  if (dbInstance) return dbInstance;

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

  const dbPath = join(DATA_DIR, 'memory.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // M1A-α C-MAJOR-3: CLI + HTTP backend 跨进程并发写 memory.db。
  // WAL 仍是 single writer；没 busy_timeout 直接 SQLITE_BUSY。
  // 5000ms 给冲突 writer 让出窗口，不死锁。
  db.pragma('busy_timeout = 5000');

  const current = db.pragma('user_version', { simple: true }) as number;
  if (current < MEMORY_SCHEMA_VERSION) {
    db.transaction(() => {
      // Apply each pending migration in order; idempotent CREATE IF NOT EXISTS
      // means re-running on partial state is safe.
      for (const m of MIGRATIONS) {
        if (current < m.version) {
          const sql = readFileSync(join(MIGRATIONS_DIR, m.file), 'utf-8');
          db.exec(sql);
        }
      }
      db.pragma(`user_version = ${MEMORY_SCHEMA_VERSION}`);
    })();
  }

  // BLOCKER risk-officer B-R4: intents.text holds user prompts (potentially private);
  // ensure DB / WAL / shm files are 0600 against multi-user shared mac mini.
  for (const f of ['memory.db', 'memory.db-wal', 'memory.db-shm']) {
    const p = join(DATA_DIR, f);
    if (existsSync(p)) {
      try { chmodSync(p, 0o600); } catch { /* best effort */ }
    }
  }

  dbInstance = db;
  return db;
}

export interface SessionRow {
  id: string;
  created_at: string;
  last_seen_at: string;
}

export function bootSession(sessionId?: string): SessionRow {
  const db = openMemoryDb();
  const id = sessionId ?? randomUUID();

  const existing = db.prepare('SELECT id, created_at, last_seen_at FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (existing) {
    db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?").run(id);
    return { ...existing, last_seen_at: new Date().toISOString() };
  }

  db.prepare('INSERT INTO sessions (id) VALUES (?)').run(id);
  return db.prepare('SELECT id, created_at, last_seen_at FROM sessions WHERE id = ?').get(id) as SessionRow;
}

export function writeIntent(args: {
  sessionId: string;
  traceId: string;
  text: string;
  executionDepth?: string;
  domain?: string;
  confidence?: number;
  classifierMethod?: string;
}): string {
  const db = openMemoryDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO intents
      (id, session_id, trace_id, text, execution_depth, domain, confidence, classifier_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, args.sessionId, args.traceId, args.text,
    args.executionDepth ?? null,
    args.domain ?? null,
    args.confidence ?? null,
    args.classifierMethod ?? null,
  );
  return id;
}

export function writeSkillInvocation(args: {
  runId: string;
  sessionId: string;
  intentId: string;
  traceId: string;
  spanId: string;
  skillId: string;
  status: 'success' | 'error' | 'paused' | 'cancelled';
  artifact?: unknown;
  error?: { type: string; message: string };
}): void {
  const db = openMemoryDb();
  db.prepare(`
    INSERT INTO skill_invocations
      (id, session_id, intent_id, trace_id, span_id, skill_id, status, artifact_json, error_json, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    args.runId, args.sessionId, args.intentId, args.traceId, args.spanId, args.skillId, args.status,
    args.artifact !== undefined ? JSON.stringify(args.artifact) : null,
    args.error ? JSON.stringify(args.error) : null,
  );
}

export function closeMemoryDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
