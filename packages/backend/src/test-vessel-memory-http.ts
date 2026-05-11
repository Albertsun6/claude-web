/**
 * /api/vessel/memory HTTP API integration test.
 *
 * Spawns vessel-core backend with a temp DATA_DIR + VESSEL_DISABLE_MDNS,
 * exercises POST/GET/DELETE/search routes via fetch.
 *
 * Two modes:
 *   - default (smoke): no live model load — only test validation paths
 *     (400 / 413 / 404) which don't trigger embedder
 *   - VESSEL_MEMORY_E2E=1: full e2e with real bge-small-zh-v1.5 model
 *     (POST /memory triggers embedding; POST /memory/search runs KNN)
 */

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEST_PORT = 13041;
const e2e = process.env['VESSEL_MEMORY_E2E'] === '1';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    process.stdout.write(`  ✅ ${label}\n`);
    passed++;
  } else {
    process.stderr.write(`  ❌ FAIL: ${label}\n`);
    failed++;
  }
}

const tmpDataDir = mkdtempSync(join(tmpdir(), 'vessel-memory-http-'));

// Reuse the production HF model cache so we don't redownload 90MB per test
// run. memory.db is still isolated under tmpDataDir.
const sharedModelCache = join(process.env['HOME'] ?? tmpdir(), '.vessel', 'models');

// Start backend in subprocess.
const backend = spawn('npx', ['tsx', 'src/index.ts'], {
  env: {
    ...process.env,
    PORT: String(TEST_PORT),
    VESSEL_DATA_DIR: tmpDataDir,
    VESSEL_HF_CACHE_DIR: sharedModelCache,
    VESSEL_DISABLE_MDNS: '1',
    // Disable memory augmentation in spawned cli-runner so test stays focused
    // on the HTTP API; memory-aware-coding is tested elsewhere.
    VESSEL_MEMORY_AUGMENT: '0',
  },
  cwd: join(__dirname, '..'),
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderrBuf = '';
backend.stderr?.on('data', (c: Buffer) => { stderrBuf += c.toString(); });

// Wait for server ready (look for ":<port>" in stdout, or 2s timeout).
await new Promise<void>((resolve) => {
  const t = setTimeout(() => resolve(), 2500);
  backend.stdout?.on('data', (chunk: Buffer) => {
    if (chunk.toString().includes(`:${TEST_PORT}`) || chunk.toString().toLowerCase().includes('listening')) {
      clearTimeout(t);
      resolve();
    }
  });
});

const BASE = `http://127.0.0.1:${TEST_PORT}/api/vessel`;

function jget(path: string): Promise<{ status: number; body: unknown }> {
  return fetch(`${BASE}${path}`).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
}
function jpost(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
}
function jdel(path: string): Promise<{ status: number; body: unknown }> {
  return fetch(`${BASE}${path}`, { method: 'DELETE' })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
}

try {
  // ── Validation tests (no embedder needed) ─────────────────────────────
  {
    // POST /memory missing kind
    const r1 = await jpost('/memory', { content: 'x' });
    assert(r1.status === 400, `POST without kind → 400 (got ${r1.status})`);
    assert(typeof (r1.body as Record<string, unknown>)?.error === 'string', 'error string returned');

    // Invalid kind
    const r2 = await jpost('/memory', { kind: 'banana', content: 'x' });
    assert(r2.status === 400, `POST kind=banana → 400 (got ${r2.status})`);

    // Missing content
    const r3 = await jpost('/memory', { kind: 'note' });
    assert(r3.status === 400, `POST without content → 400 (got ${r3.status})`);

    // content too long
    const r4 = await jpost('/memory', { kind: 'note', content: 'x'.repeat(8001) });
    assert(r4.status === 413, `POST content >8000 → 413 (got ${r4.status})`);

    // GET /memory/status (no embedder load needed)
    const r5 = await jget('/memory/status');
    assert(r5.status === 200, `GET /memory/status → 200 (got ${r5.status})`);
    const status = r5.body as Record<string, unknown>;
    assert(typeof (status?.['embedder'] as Record<string, unknown>)?.['model'] === 'string', 'status.embedder.model is string');
    assert(status?.['records'] === 0, 'fresh DB has 0 records');

    // GET /memory empty list
    const r6 = await jget('/memory');
    assert(r6.status === 200, `GET /memory → 200 (got ${r6.status})`);
    const list = r6.body as { memories: unknown[]; count: number };
    assert(Array.isArray(list.memories) && list.memories.length === 0, 'fresh list is empty');

    // GET /memory/:id non-existent
    const r7 = await jget('/memory/999');
    assert(r7.status === 404, `GET /memory/999 → 404 (got ${r7.status})`);

    // DELETE /memory/:id non-existent — idempotent, returns deleted: id
    const r8 = await jdel('/memory/999');
    assert(r8.status === 200, `DELETE /memory/999 idempotent → 200 (got ${r8.status})`);

    // POST /memory/search empty query
    const r9 = await jpost('/memory/search', { query: '' });
    assert(r9.status === 400, `POST /memory/search '' → 400 (got ${r9.status})`);

    // POST /memory/search query too long
    const r10 = await jpost('/memory/search', { query: 'x'.repeat(1001) });
    assert(r10.status === 413, `query >1000 → 413 (got ${r10.status})`);

    // POST /memory/search top out of range
    const r11 = await jpost('/memory/search', { query: 'ok', top: -1 });
    assert(r11.status === 400, `top=-1 → 400 (got ${r11.status})`);
  }

  // ── E2E (live model) ──────────────────────────────────────────────────
  if (e2e) {
    process.stdout.write(`\n  [e2e] live POST → embedder load + KNN search...\n`);

    // POST /memory (triggers model load + embed; first call cold)
    const MARKER = 'http_api_e2e_marker_42a7f9';
    const r1 = await jpost('/memory', { kind: 'note', content: `note with ${MARKER}` });
    assert(r1.status === 201, `POST /memory → 201 (got ${r1.status})`);
    const stored = (r1.body as { memory: { id: number; kind: string; content: string } }).memory;
    assert(typeof stored.id === 'number' && stored.id > 0, 'returned memory has positive id');
    assert(stored.kind === 'note', 'kind preserved');

    // POST another with different kind
    const r2 = await jpost('/memory', { kind: 'fact', content: `fact: ${MARKER} project name is Vessel` });
    assert(r2.status === 201, `second POST → 201 (got ${r2.status})`);

    // GET /memory list shows both
    const r3 = await jget('/memory');
    const list = (r3.body as { memories: { id: number }[]; count: number });
    assert(list.count === 2, `list has 2 records (got ${list.count})`);

    // GET /memory?kind=note shows only the note
    const r4 = await jget('/memory?kind=note');
    const noteList = (r4.body as { memories: { kind: string }[] });
    assert(noteList.memories.length === 1 && noteList.memories[0]!.kind === 'note', 'kind filter works');

    // POST /memory/search returns ranked hits
    const r5 = await jpost('/memory/search', { query: MARKER, top: 5 });
    const hits = (r5.body as { hits: { content: string; distance: number }[] }).hits;
    assert(hits.length === 2, `search returns 2 hits (got ${hits.length})`);
    assert(hits[0]!.content.includes(MARKER), 'top hit contains marker');
    assert(hits[1]!.distance >= hits[0]!.distance, 'distances sorted ascending');

    // GET /memory/:id one of them
    const targetId = stored.id;
    const r6 = await jget(`/memory/${targetId}`);
    assert(r6.status === 200, `GET /memory/${targetId} → 200`);

    // DELETE one
    const r7 = await jdel(`/memory/${targetId}`);
    assert(r7.status === 200, `DELETE → 200`);
    const r8 = await jget(`/memory/${targetId}`);
    assert(r8.status === 404, `GET after DELETE → 404`);

    // /memory/status reflects updated count + loaded embedder
    const r9 = await jget('/memory/status');
    const status = r9.body as { embedder: { loaded: boolean; ok: boolean }; records: number };
    assert(status.embedder.loaded === true, 'embedder.loaded=true after live use');
    assert(status.records === 1, `records=1 after delete (got ${status.records})`);
  } else {
    process.stdout.write('  ℹ  e2e skipped (set VESSEL_MEMORY_E2E=1)\n');
  }
} finally {
  // Cleanup: kill backend, remove tmp dir.
  try { backend.kill('SIGTERM'); } catch { /* ignore */ }
  await new Promise(r => setTimeout(r, 400));
  try { backend.kill('SIGKILL'); } catch { /* ignore */ }
  rmSync(tmpDataDir, { recursive: true, force: true });
}

if (failed > 0 && stderrBuf) {
  process.stderr.write(`\n[backend stderr last 500]\n${stderrBuf.slice(-500)}\n`);
}

process.stdout.write(`\nvessel-memory HTTP tests: ${passed} passed, ${failed} failed${e2e ? ' (e2e)' : ' (smoke)'}\n`);
process.exit(failed > 0 ? 1 : 0);
