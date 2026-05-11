/**
 * M1A-α Vessel HTTP routes — `/api/vessel/*` namespace.
 *
 * Per [M1A-slicing-arbiter](../../../docs/reviews/M1A-slicing-arbiter-2026-05-10-0210.md)
 * A-MAJOR-2 fix: namespace-isolated from Eva's `/api/runs`, `/api/sessions` (different
 * semantics — Eva = cli-runner subprocess registry / jsonl history).
 *
 * Routes:
 *   POST /api/vessel/intent          → run an intent through orchestrator, return AgentResult
 *   GET  /api/vessel/sessions        → list recent sessions
 *   GET  /api/vessel/runs            → list recent skill_invocations
 *   GET  /api/vessel/traces/:id      → return span tree for trace_id
 *   GET  /api/vessel/health          → ok + counts
 *
 * Out of scope (M1A-α):
 *   - WS (M1A-β)
 *   - Eva App.tsx rewire (M1A-γ)
 *   - Auth / permissionScope enforce (M1B)
 */

import { Hono } from 'hono';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { runIntent } from '../orchestrator.js';
import { openMemoryDb } from '../memory/session-store.js';
import { getPublishedSpec } from '../mdns/publisher.js';
import { loadSoulOrNull, SoulParseError } from '../soul/parser.js';
import { addLesson, searchLessons, type LessonKind } from '../memory/lesson-store.js';
import { DATA_DIR } from '../data-dir.js';
import type { TraceEvent } from '../observability/trace.js';

// M1A-α 4-way review BLOCKER R-M1Aα-1: cap body + concurrency to prevent
// fork-bomb / OOM through tailscale-exposed `/api/vessel/intent`.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_CHARS = 32 * 1024;
const MAX_CONCURRENT_INTENTS = 5;
const inflightIntents = new Set<symbol>();

// M1A-α 4-way review MAJOR R-M1Aα-2: artifact_refs / files / stdoutPath leak
// absolute home paths (`/Users/<name>/.vessel/...`). Convert to DATA_DIR-relative
// for HTTP responses; clients re-join with DATA_DIR if they need real paths.
export function relativizePath(p: string): string {
  if (typeof p !== 'string') return p;
  if (p.startsWith(DATA_DIR + '/')) return '$VESSEL_DATA_DIR/' + p.slice(DATA_DIR.length + 1);
  return p;
}

export function redactAgentResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = result as { status?: string; artifact?: unknown };
  if (r.status !== 'success' || !r.artifact || typeof r.artifact !== 'object') return result;
  const a = r.artifact as Record<string, unknown>;
  const out: Record<string, unknown> = { ...a };
  if (Array.isArray(a.files)) out.files = (a.files as string[]).map(relativizePath);
  if (typeof a.stdoutPath === 'string') out.stdoutPath = relativizePath(a.stdoutPath);
  return { ...r, artifact: out };
}

function redactTraceEvent(e: TraceEvent): TraceEvent {
  const refs = e.artifact_refs;
  if (!refs) return e;
  return { ...e, artifact_refs: refs.map(relativizePath) };
}

export const vesselRouter = new Hono();

// GET /api/vessel/health — liveness + service identity for LAN discovery (M2-iOS-α)
// Combined endpoint: keeps M1A-α `ok` + DB counts for backward compat (existing
// readiness probes), adds service identity + bonjour + soul for iOS NWBrowser/
// manual-IP probes.
//
// Removed dataDir field (M2-iOS-α): leaked filesystem path. Operators that
// need DATA_DIR can read /api/health/full (auth-gated diagnostics).
//
// No auth: anyone on the LAN already learns instanceName via mDNS.
vesselRouter.get('/health', (c) => {
  const db = openMemoryDb();
  const sessions = (db.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n;
  const runs = (db.prepare('SELECT count(*) AS n FROM skill_invocations').get() as { n: number }).n;

  const bonjour = getPublishedSpec();

  let soulPresent = false;
  let soulName: string | undefined;
  let soulError: 'parse_error' | undefined;
  try {
    const s = loadSoulOrNull();
    if (s) { soulPresent = true; soulName = s.name; }
  } catch (err) {
    if (err instanceof SoulParseError) soulError = 'parse_error';
    else throw err;
  }

  return c.json({
    ok: true,
    service: 'vessel',
    version: '0.0.1',
    hostname: hostname(),
    uptimeSec: Math.round(process.uptime()),
    sessions,
    runs,
    bonjour: bonjour
      ? { published: true, instanceName: bonjour.instanceName, port: bonjour.port, type: '_vessel._tcp' }
      : { published: false },
    soul: soulError
      ? { present: false, error: soulError }
      : soulPresent
        ? { present: true, name: soulName }
        : { present: false },
  });
});

vesselRouter.post('/intent', async (c) => {
  // Body size cap (R-M1Aα-1): reject before reading entire body into memory.
  const lenHeader = c.req.header('content-length');
  if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) {
    return c.json({ error: `body > ${MAX_BODY_BYTES} bytes` }, 413);
  }
  let body: { text?: string; sessionId?: string; skill?: 'echo' | 'coding' };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  if (typeof body.text !== 'string' || body.text.trim() === '') {
    return c.json({ error: 'missing or empty `text`' }, 400);
  }
  if (body.text.length > MAX_TEXT_CHARS) {
    return c.json({ error: `text > ${MAX_TEXT_CHARS} chars` }, 413);
  }
  // Concurrency cap (R-M1Aα-1): each coding intent spawns a CC subprocess.
  if (inflightIntents.size >= MAX_CONCURRENT_INTENTS) {
    return c.json({ error: `too many concurrent intents (>= ${MAX_CONCURRENT_INTENTS})` }, 429);
  }
  const ticket = Symbol(`intent-${Date.now()}`);
  inflightIntents.add(ticket);
  try {
    const result = await runIntent({
      text: body.text,
      sessionId: body.sessionId,
      skill: body.skill,
    });
    return c.json(redactAgentResult(result));
  } finally {
    inflightIntents.delete(ticket);
  }
});

vesselRouter.get('/sessions', (c) => {
  const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const db = openMemoryDb();
  const rows = db.prepare(
    'SELECT id, created_at, last_seen_at FROM sessions ORDER BY last_seen_at DESC LIMIT ?',
  ).all(limit);
  return c.json({ sessions: rows });
});

vesselRouter.get('/runs', (c) => {
  const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const sessionId = c.req.query('session_id');
  const db = openMemoryDb();
  const sql = `
    SELECT si.id AS run_id, si.session_id, si.skill_id, si.status, si.trace_id, si.span_id,
           si.started_at, si.completed_at, i.text AS intent_text
    FROM skill_invocations si
    JOIN intents i ON i.id = si.intent_id
    ${sessionId ? 'WHERE si.session_id = ?' : ''}
    ORDER BY si.started_at DESC LIMIT ?
  `;
  const params = sessionId ? [sessionId, limit] : [limit];
  const rows = db.prepare(sql).all(...params);
  return c.json({ runs: rows });
});

// M1 L1-minimal: lessons read/write surface
const VALID_KINDS = new Set<LessonKind>(['review_closeout', 'bug_lesson', 'decision', 'risk', 'spike']);

vesselRouter.get('/lessons', (c) => {
  const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const q = c.req.query('q');
  const kind = c.req.query('kind') as LessonKind | undefined;
  const milestone = c.req.query('milestone');
  const tag = c.req.query('tag');
  if (kind && !VALID_KINDS.has(kind)) {
    return c.json({ error: `kind must be one of ${[...VALID_KINDS].join(',')}` }, 400);
  }
  const rows = searchLessons({ q, kind, milestone, tag, limit });
  return c.json({ lessons: rows });
});

vesselRouter.post('/lessons', async (c) => {
  const lenHeader = c.req.header('content-length');
  if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) {
    return c.json({ error: `body > ${MAX_BODY_BYTES} bytes` }, 413);
  }
  let body: { kind?: string; title?: string; body?: string; milestone?: string; tags?: string[]; refs?: string[]; importance?: number };
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body.kind || !VALID_KINDS.has(body.kind as LessonKind)) {
    return c.json({ error: `kind required, one of ${[...VALID_KINDS].join(',')}` }, 400);
  }
  // L1 closeout review BLOCKER (cursor + architect): `review_closeout` kind must
  // ONLY come through `vessel-core closeout finalize` CLI (single generation-layer
  // entry per arbiter B-级). HTTP POST is an alternate write path; reject this kind
  // here so CLI is the only producer.
  if (body.kind === 'review_closeout') {
    return c.json({ error: 'kind=review_closeout reserved for `vessel-core closeout finalize` CLI; HTTP POST cannot create this kind' }, 400);
  }
  if (typeof body.title !== 'string' || typeof body.body !== 'string' || body.title.trim() === '' || body.body.trim() === '') {
    return c.json({ error: 'title and body required (non-empty strings)' }, 400);
  }
  if (body.title.length > 1024 || body.body.length > MAX_TEXT_CHARS) {
    return c.json({ error: 'title > 1024 or body > 32K chars' }, 413);
  }
  // L1 closeout R-L1-2: cap tags/refs array length and per-element length to
  // prevent unbounded payload via JSON-encoded arrays bypassing 32K body cap.
  const cappedTags = Array.isArray(body.tags)
    ? body.tags.slice(0, 32).map((t) => typeof t === 'string' ? t.slice(0, 64) : '').filter(Boolean)
    : undefined;
  const cappedRefs = Array.isArray(body.refs)
    ? body.refs.slice(0, 32).map((r) => typeof r === 'string' ? r.slice(0, 256) : '').filter(Boolean)
    : undefined;
  // L1 closeout R-L1-4: clamp importance to 1-5 (CHECK constraint will throw 500 otherwise).
  const importance = typeof body.importance === 'number'
    ? Math.max(1, Math.min(5, Math.round(body.importance)))
    : undefined;
  try {
    const row = addLesson({
      kind: body.kind as LessonKind,
      title: body.title,
      body: body.body,
      milestone: typeof body.milestone === 'string' ? body.milestone.slice(0, 64) : undefined,
      tags: cappedTags,
      refs: cappedRefs,
      importance,
    });
    return c.json({ lesson: row }, 201);
  } catch (err) {
    return c.json({ error: 'internal error', detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown' }, 500);
  }
});

vesselRouter.get('/traces/:traceId', (c) => {
  const traceId = c.req.param('traceId');
  if (!/^[0-9a-f]{32}$/i.test(traceId)) {
    return c.json({ error: 'trace_id must be 32 hex chars (OTEL)' }, 400);
  }
  const dir = join(DATA_DIR, 'traces', traceId);
  if (!existsSync(dir)) {
    return c.json({ error: `no trace dir for ${traceId}` }, 404);
  }
  const events: TraceEvent[] = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TraceEvent)
    .map(redactTraceEvent)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return c.json({ trace_id: traceId, span_count: events.length, events });
});
