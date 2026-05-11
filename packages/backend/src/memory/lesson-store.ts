/**
 * Lesson store — L1 evolution mechanism CRUD (memory.db `lessons` table + FTS5).
 *
 * Reads/writes go through `openMemoryDb()` from session-store.ts (single connection).
 * Body is redacted via `redactFreeformText` BEFORE INSERT — generation-layer
 * pattern (M1A-β arbiter教训：fix 必须放生成层，不放消费层).
 *
 * @see migrations-memory/0002_m1_lessons.sql
 * @see docs/reviews/L1-retrospectives-arbiter-2026-05-10-0420.md
 */

import { randomUUID, createHash } from 'node:crypto';
import { openMemoryDb } from './session-store.js';
import { redactFreeformText } from '../observability/redact-helpers.js';

export type LessonKind = 'review_closeout' | 'bug_lesson' | 'decision' | 'risk' | 'spike';
export type LessonStatus = 'active' | 'deprecated' | 'contradicted';

export interface LessonInput {
  kind: LessonKind;
  title: string;
  body: string;                       // redacted on insert
  milestone?: string;
  tags?: string[];
  refs?: string[];
  status?: LessonStatus;               // default 'active'
  importance?: number;                 // 1-5; default 3
  contradictsId?: string;
  importFingerprint?: string;          // for one-shot importer dedup
}

export interface LessonRow {
  id: string;
  kind: LessonKind;
  milestone: string | null;
  title: string;
  body: string;
  tags: string | null;
  refs_json: string | null;
  status: LessonStatus;
  importance: number;
  contradicts_id: string | null;
  import_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

export interface LessonSearchOpts {
  q?: string;                          // FTS5 query
  kind?: LessonKind;
  milestone?: string;
  status?: LessonStatus;
  tag?: string;                        // matches anywhere in tags column
  limit?: number;                      // default 20, max 100
}

export function addLesson(input: LessonInput): LessonRow {
  const db = openMemoryDb();
  const id = randomUUID();
  const tags = input.tags && input.tags.length > 0 ? input.tags.join(',') : null;
  const refs = input.refs && input.refs.length > 0 ? JSON.stringify(input.refs) : null;
  // Redact body at write — single source of truth, not the caller's responsibility.
  const safeBody = redactFreeformText(input.body);
  const safeTitle = redactFreeformText(input.title);

  db.prepare(`
    INSERT INTO lessons
      (id, kind, milestone, title, body, tags, refs_json, status, importance, contradicts_id, import_fingerprint)
    VALUES
      (@id, @kind, @milestone, @title, @body, @tags, @refs, @status, @importance, @contradicts, @fp)
  `).run({
    id,
    kind: input.kind,
    milestone: input.milestone ?? null,
    title: safeTitle,
    body: safeBody,
    tags,
    refs,
    status: input.status ?? 'active',
    importance: input.importance ?? 3,
    contradicts: input.contradictsId ?? null,
    fp: input.importFingerprint ?? null,
  });

  return getLesson(id)!;
}

export function getLesson(id: string): LessonRow | undefined {
  const db = openMemoryDb();
  return db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as LessonRow | undefined;
}

export function searchLessons(opts: LessonSearchOpts = {}): LessonRow[] {
  const db = openMemoryDb();
  const limit = Math.max(1, Math.min(100, opts.limit ?? 20));

  // FTS5 path: when `q` provided, JOIN lessons_fts → lessons, optional WHERE filters.
  if (opts.q && opts.q.trim() !== '') {
    const where: string[] = ['lessons.rowid = lessons_fts.rowid', 'lessons_fts MATCH @q'];
    const params: Record<string, unknown> = { q: opts.q, limit };
    if (opts.kind)       { where.push('lessons.kind = @kind');             params.kind = opts.kind; }
    if (opts.milestone)  { where.push('lessons.milestone = @milestone');   params.milestone = opts.milestone; }
    if (opts.status)     { where.push('lessons.status = @status');         params.status = opts.status; }
    if (opts.tag)        { where.push("lessons.tags LIKE '%' || @tag || '%'"); params.tag = opts.tag; }
    return db.prepare(`
      SELECT lessons.* FROM lessons, lessons_fts
      WHERE ${where.join(' AND ')}
      ORDER BY rank
      LIMIT @limit
    `).all(params) as LessonRow[];
  }

  // Non-FTS path: filter without query, ordered by created_at desc.
  const where: string[] = [];
  const params: Record<string, unknown> = { limit };
  if (opts.kind)       { where.push('kind = @kind');             params.kind = opts.kind; }
  if (opts.milestone)  { where.push('milestone = @milestone');   params.milestone = opts.milestone; }
  if (opts.status)     { where.push('status = @status');         params.status = opts.status; }
  if (opts.tag)        { where.push("tags LIKE '%' || @tag || '%'"); params.tag = opts.tag; }
  const sql = `SELECT * FROM lessons ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT @limit`;
  return db.prepare(sql).all(params) as LessonRow[];
}

/**
 * Compute fingerprint for one-shot import dedup.
 * Per L1 arbiter (architect m-3 + cursor M3): sha256(date+planFile+contract+biggestInsight).slice(0, 16)
 */
export function computeImportFingerprint(parts: {
  date: string;
  planFile?: string;
  contract?: string;
  biggestInsight?: string;
}): string {
  const input = [parts.date, parts.planFile ?? '', parts.contract ?? '', parts.biggestInsight ?? ''].join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * L1 closeout review MAJOR (architect M-2 + cursor M2): use direct UNIQUE-INDEX
 * lookup instead of `searchLessons({tag: fingerprint})` LIKE substring — fingerprints
 * are exact 16-hex strings, LIKE is both wrong and slow.
 */
export function findByFingerprint(fp: string): LessonRow | undefined {
  const db = openMemoryDb();
  return db.prepare('SELECT * FROM lessons WHERE import_fingerprint = ?').get(fp) as LessonRow | undefined;
}
