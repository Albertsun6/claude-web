/**
 * /api/vessel/fs — Vessel-native filesystem endpoint with:
 *   - VESSEL_ALLOWED_ROOTS enforcement (same policy as /api/fs)
 *   - permission.denied trace events on access denial (M1B new capability)
 *
 * GET /api/vessel/fs/file?path=<absolute>  → file content or 403
 * GET /api/vessel/fs/tree?root=<absolute>  → directory listing or 403
 *
 * @see M1B B-级 review: docs/reviews/M1B-mcp-b-level-architect-2026-05-10-1000.md
 */

import { Hono } from 'hono';
import path from 'node:path';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { verifyAllowedPath, getAllowedRoots } from '../auth.js';
import { makeTraceWriter, newTraceId, newSpanId } from '../observability/trace-writer.js';
import type { TraceContext } from '../observability/trace.js';
import { redactFreeformText } from '../observability/redact-helpers.js';

// Synthetic session_id used for HTTP-level fs access traces (no conversation context).
const FS_SESSION_ID = 'vessel-fs-api';
const MAX_FILE_BYTES = 512 * 1024; // 512 KB cap for inline file response

/** Emit a permission.denied trace event. Non-throwing. */
async function emitDenied(absPath: string, reason: string): Promise<void> {
  try {
    const ctx: TraceContext = {
      trace_id: newTraceId(),
      span_id: newSpanId(),
      parent_span_id: null,
      trace_flags: 1,
      conversation_id: FS_SESSION_ID,
      run_id: randomUUID(),
    };
    const tw = makeTraceWriter(ctx);
    await tw.write({
      trace_id: ctx.trace_id,
      span_id: ctx.span_id,
      parent_span_id: null,
      event_type: 'permission.denied',
      timestamp: new Date().toISOString(),
      component: 'vessel-fs-api',
      session_id: FS_SESSION_ID,
      run_id: ctx.run_id,
      status: 'error',
      payload: {
        // Redact path before persisting; only store sanitized form.
        denied_path: redactFreeformText(absPath).slice(0, 200),
        reason,
      },
    });
  } catch {
    /* trace write must not fail HTTP response */
  }
}

export const vesselFsRouter = new Hono();

vesselFsRouter.get('/fs/file', async (c) => {
  const rawPath = c.req.query('path');
  if (!rawPath) return c.json({ error: 'path query param required' }, 400);
  // Null bytes cause undefined OS behavior and can corrupt trace logs.
  if (rawPath.includes('\0')) return c.json({ error: 'invalid path' }, 400);

  // Expand ~ to home dir for convenience.
  const absPath = rawPath.startsWith('~')
    ? path.join(process.env.HOME ?? '/', rawPath.slice(1))
    : rawPath;

  if (!path.isAbsolute(absPath)) {
    return c.json({ error: 'path must be absolute' }, 400);
  }

  const resolved = path.resolve(absPath);
  const err = verifyAllowedPath(resolved);
  if (err) {
    await emitDenied(resolved, err);
    return c.json({ error: 'path not allowed', reason: err, allowed_count: getAllowedRoots().length }, 403);
  }

  if (!existsSync(resolved)) {
    return c.json({ error: 'not found' }, 404);
  }

  let stat: ReturnType<typeof statSync>;
  try { stat = statSync(resolved); } catch (e) {
    return c.json({ error: 'stat failed', detail: String(e) }, 500);
  }

  if (!stat.isFile()) {
    return c.json({ error: 'not a file' }, 400);
  }

  if (stat.size > MAX_FILE_BYTES) {
    return c.json({ error: 'file too large', size: stat.size, limit: MAX_FILE_BYTES }, 413);
  }

  try {
    const content = readFileSync(resolved, 'utf-8');
    return c.json({ content, size: stat.size, encoding: 'utf-8' });
  } catch (e) {
    return c.json({ error: 'read failed', detail: String(e) }, 500);
  }
});

vesselFsRouter.get('/fs/tree', async (c) => {
  const rawRoot = c.req.query('root');
  if (!rawRoot) return c.json({ error: 'root query param required' }, 400);
  if (rawRoot.includes('\0')) return c.json({ error: 'invalid path' }, 400);

  const absRoot = rawRoot.startsWith('~')
    ? path.join(process.env.HOME ?? '/', rawRoot.slice(1))
    : rawRoot;

  if (!path.isAbsolute(absRoot)) {
    return c.json({ error: 'root must be absolute' }, 400);
  }

  const resolved = path.resolve(absRoot);
  const err = verifyAllowedPath(resolved);
  if (err) {
    await emitDenied(resolved, err);
    return c.json({ error: 'path not allowed', reason: err, allowed_count: getAllowedRoots().length }, 403);
  }

  if (!existsSync(resolved)) {
    return c.json({ error: 'not found' }, 404);
  }

  let entries: { name: string; type: 'dir' | 'file'; size?: number }[];
  try {
    entries = readdirSync(resolved).map((name) => {
      const full = path.join(resolved, name);
      try {
        const s = statSync(full);
        return { name, type: s.isDirectory() ? ('dir' as const) : ('file' as const), size: s.isFile() ? s.size : undefined };
      } catch {
        return { name, type: 'file' as const };
      }
    });
  } catch (e) {
    return c.json({ error: 'readdir failed', detail: String(e) }, 500);
  }

  return c.json({ entries, root: resolved });
});
