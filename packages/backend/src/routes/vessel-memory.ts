/**
 * /api/vessel/memory — HTTP API for long-term memory CRUD + KNN search.
 *
 * Mounted under /api/vessel by index.ts so Eva web / iOS clients can store and
 * search memory records in addition to the CLI path.
 *
 * Routes:
 *   POST   /memory          — add a memory record (kind/content/source) → returns full row
 *   GET    /memory          — list recent records (?kind=K&limit=N) → returns rows[]
 *   POST   /memory/search   — KNN search (body: {query, top}) → returns hits[]
 *   GET    /memory/:id      — fetch one record by id
 *   DELETE /memory/:id      — delete record + embedding
 *   GET    /memory/status   — embedder + count snapshot (no embedding required)
 *
 * Auth: same as other vessel routes — relies on existing token / allowlist
 * middleware mounted at the app level. No filesystem access here.
 *
 * Validation (mirrors vessel-workflow.ts conventions):
 *   - content/query length cap (8000 chars) to bound request body
 *   - kind enum check (note|fact|episode|preference)
 *   - top range [1, 50]
 */

import { Hono } from 'hono';
import {
  addMemory,
  listMemory,
  searchMemory,
  getMemoryById,
  deleteMemory,
  memoryCount,
  type MemoryKind,
} from '../memory/memory-store.js';
import { health as embedderHealth, getEmbedModel } from '../memory/embedder.js';

const MAX_CONTENT_CHARS = 8000;
const MAX_QUERY_CHARS = 1000;
const VALID_KINDS = new Set<MemoryKind>(['note', 'fact', 'episode', 'preference']);

export const vesselMemoryRouter = new Hono();

// ── POST /memory — add ────────────────────────────────────────────────────
vesselMemoryRouter.post('/memory', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  const b = (body ?? {}) as Record<string, unknown>;

  const kind = b['kind'];
  if (typeof kind !== 'string' || !VALID_KINDS.has(kind as MemoryKind)) {
    return c.json({ error: `kind required, one of ${[...VALID_KINDS].join('|')}` }, 400);
  }

  const content = b['content'];
  if (typeof content !== 'string' || !content.trim()) {
    return c.json({ error: 'content required (non-empty string)' }, 400);
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return c.json({ error: `content > ${MAX_CONTENT_CHARS} chars` }, 413);
  }

  const source = b['source'];
  if (source !== undefined && typeof source !== 'string') {
    return c.json({ error: 'source must be a string when present' }, 400);
  }
  if (typeof source === 'string' && source.length > 256) {
    return c.json({ error: 'source > 256 chars' }, 413);
  }

  try {
    const row = await addMemory({
      kind: kind as MemoryKind,
      content,
      ...(source ? { source } : {}),
    });
    return c.json({ memory: row }, 201);
  } catch (err) {
    return c.json({ error: 'internal error', detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown' }, 500);
  }
});

// ── GET /memory — list ────────────────────────────────────────────────────
vesselMemoryRouter.get('/memory', (c) => {
  const kindParam = c.req.query('kind');
  const limitParam = c.req.query('limit');
  const limit = (() => {
    if (!limitParam) return 50;
    const n = parseInt(limitParam, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50;
  })();

  if (kindParam !== undefined && !VALID_KINDS.has(kindParam as MemoryKind)) {
    return c.json({ error: `invalid kind '${kindParam}'; must be one of ${[...VALID_KINDS].join('|')}` }, 400);
  }

  const rows = listMemory({
    ...(kindParam ? { kind: kindParam as MemoryKind } : {}),
    limit,
  });
  return c.json({ memories: rows, count: rows.length });
});

// ── POST /memory/search — KNN ─────────────────────────────────────────────
// POST (not GET) because the query string can be long Chinese text + we
// want to encourage clients to send via JSON body.
vesselMemoryRouter.post('/memory/search', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  const b = (body ?? {}) as Record<string, unknown>;

  const query = b['query'];
  if (typeof query !== 'string' || !query.trim()) {
    return c.json({ error: 'query required (non-empty string)' }, 400);
  }
  if (query.length > MAX_QUERY_CHARS) {
    return c.json({ error: `query > ${MAX_QUERY_CHARS} chars` }, 413);
  }

  const topRaw = b['top'];
  let top = 5;
  if (topRaw !== undefined) {
    if (typeof topRaw !== 'number' || !Number.isFinite(topRaw) || topRaw <= 0) {
      return c.json({ error: 'top must be a positive number when present' }, 400);
    }
    top = Math.min(Math.floor(topRaw), 50);
  }

  try {
    const hits = await searchMemory(query, top);
    return c.json({ hits, count: hits.length });
  } catch (err) {
    return c.json({ error: 'internal error', detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown' }, 500);
  }
});

// ── GET /memory/status ────────────────────────────────────────────────────
// Status endpoint must come BEFORE /memory/:id route so 'status' isn't matched
// as an id. Hono routes the first match.
vesselMemoryRouter.get('/memory/status', (c) => {
  const h = embedderHealth();
  return c.json({
    embedder: { ...h, currentModelId: getEmbedModel() },
    records: memoryCount(),
  });
});

// ── GET /memory/:id ───────────────────────────────────────────────────────
vesselMemoryRouter.get('/memory/:id', (c) => {
  const idParam = c.req.param('id');
  const id = parseInt(idParam, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: 'id must be a positive integer' }, 400);
  }
  const row = getMemoryById(id);
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ memory: row });
});

// ── DELETE /memory/:id ────────────────────────────────────────────────────
vesselMemoryRouter.delete('/memory/:id', (c) => {
  const idParam = c.req.param('id');
  const id = parseInt(idParam, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: 'id must be a positive integer' }, 400);
  }
  // deleteMemory is idempotent — no 404 if missing; matches DELETE semantics.
  deleteMemory(id);
  return c.json({ deleted: id });
});
