/**
 * M1C-B integration test — memory store + embedder + sqlite-vec.
 *
 * Two modes:
 *   1. **default (smoke)** — skip model download; mock embedder; verify
 *      schema + store + sqlite-vec MATCH path against random vectors
 *   2. **VESSEL_MEMORY_E2E=1** — full e2e with real model download
 *      (bge-small-zh-v1.5 ~96MB from HF CDN); first run takes 30s-2min
 *
 * The smoke mode is wired into the default pnpm test:memory script and runs
 * in CI; full e2e is operator-triggered.
 */

import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'vessel-memory-test-'));
process.env['VESSEL_DATA_DIR'] = tmpDataDir;

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

const e2e = process.env['VESSEL_MEMORY_E2E'] === '1';

// Re-import after env so DATA_DIR resolves into tmp.
const { openMemoryDb, closeMemoryDb, MEMORY_SCHEMA_VERSION } = await import('./memory/session-store.js');

// ── Test 1: schema migration creates memory_records table ────────────────
{
  const db = openMemoryDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const names = new Set(tables.map(t => t.name));
  assert(names.has('memory_records'), 'memory_records table created by migration 0004');
  const userVer = db.pragma('user_version', { simple: true }) as number;
  assert(userVer === MEMORY_SCHEMA_VERSION && userVer === 4, `user_version = 4 after migration (got ${userVer})`);

  // Check column shape (defensive — SQLite is forgiving)
  const cols = db.prepare("PRAGMA table_info('memory_records')").all() as { name: string }[];
  const colNames = new Set(cols.map(c => c.name));
  for (const expected of ['id', 'kind', 'content', 'source', 'embedding_model', 'created_at', 'updated_at']) {
    assert(colNames.has(expected), `memory_records has column "${expected}"`);
  }
}

// ── Test 2: sqlite-vec extension loads + virtual table creates ─────────
{
  const { _resetForTest } = await import('./memory/memory-store.js');
  _resetForTest(); // reset extensionLoaded flag for fresh test

  // Trigger ensureVecReady via a dummy call path — we use the unit-level helper.
  // The simpler way: import sqlite-vec directly and verify load() works.
  const sqliteVec = await import('sqlite-vec');
  const db = openMemoryDb();
  let threw = false;
  try { sqliteVec.load(db); } catch { threw = true; }
  assert(!threw, 'sqlite-vec extension loads into memory.db');

  // Create virtual table
  let vtThrew = false;
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory_test USING vec0(embedding float[512])");
  } catch { vtThrew = true; }
  assert(!vtThrew, 'vec0 virtual table creates with float[512]');

  // Insert a fake vector + KNN MATCH
  const fakeVec = new Float32Array(512);
  for (let i = 0; i < 512; i++) fakeVec[i] = Math.random();
  // L2-normalize
  let norm = 0;
  for (const v of fakeVec) norm += v * v;
  norm = Math.sqrt(norm);
  for (let i = 0; i < 512; i++) fakeVec[i]! /= norm;

  // sqlite-vec wants explicit BIGINT for rowid; pass via BigInt to avoid
  // better-sqlite3 inferring a non-integer-bindable type.
  db.prepare("INSERT INTO vec_memory_test (rowid, embedding) VALUES (?, ?)").run(BigInt(1), Buffer.from(fakeVec.buffer));

  const hits = db.prepare(`
    SELECT rowid, distance FROM vec_memory_test
    WHERE embedding MATCH ? AND k = ?
    ORDER BY distance
  `).all(Buffer.from(fakeVec.buffer), 1) as { rowid: number; distance: number }[];

  assert(hits.length === 1 && hits[0]!.rowid === 1, 'sqlite-vec MATCH returns inserted vector by self-similarity');
  assert(hits[0]!.distance < 0.01, `self-similar distance < 0.01 (got ${hits[0]!.distance})`);

  db.exec('DROP TABLE vec_memory_test');
}

// ── Test 3: embedder.health() reflects state ──────────────────────────────
{
  const { health, getEmbedModel } = await import('./memory/embedder.js');
  const h = health();
  assert(h.model === getEmbedModel(), 'health.model matches getEmbedModel()');
  assert(h.loaded === false, 'health.loaded === false before first embed call');
  assert(h.ok === false, 'health.ok === false before model loaded');
  assert(typeof h.reason === 'string', 'health.reason is set when not loaded');
}

// ── Test 4 (e2e only): full embed → store → search round trip ─────────────
if (e2e) {
  process.stdout.write(`\n  [e2e] downloading bge-small-zh-v1.5 (first run ~30-120s)...\n`);

  const { ready, embed, health } = await import('./memory/embedder.js');
  const { addMemory, searchMemory, memoryCount } = await import('./memory/memory-store.js');

  // Pre-warm
  let warmThrew = false;
  let warmErr = '';
  try { await ready(); } catch (e) { warmThrew = true; warmErr = e instanceof Error ? e.message : String(e); }
  assert(!warmThrew, `embedder.ready() succeeds (err: ${warmErr})`);

  const h = health();
  assert(h.ok && h.loaded, 'health.ok + loaded after ready()');

  // Embed shape check
  const vecs = await embed(['你好世界', 'hello world']);
  assert(vecs.length === 2, 'embed returns one vector per input');
  assert(vecs[0]!.length === 512, `vector dim = 512 (got ${vecs[0]!.length})`);

  // Sanity: cosine of 'hello' with self ≈ 1
  const v = vecs[0]!;
  let selfDot = 0;
  for (let i = 0; i < v.length; i++) selfDot += v[i]! * v[i]!;
  assert(Math.abs(selfDot - 1.0) < 0.01, `L2-normalized self-dot ≈ 1 (got ${selfDot.toFixed(4)})`);

  // Store 5 records with a unique marker word + 3 unrelated
  const MARKER = 'vessel_e2e_marker_42a7f9';
  const related = [
    `这是一条包含 ${MARKER} 的记忆`,
    `${MARKER} 出现在多条记录中`,
    `This is a note with ${MARKER}`,
    `带有 ${MARKER} 的偏好设置`,
    `事件记录里也有 ${MARKER}`,
  ];
  const unrelated = [
    '今天天气不错适合散步',
    '马云创办了阿里巴巴',
    'TypeScript 是 JavaScript 的超集',
  ];
  for (const r of related) await addMemory({ kind: 'note', content: r });
  for (const u of unrelated) await addMemory({ kind: 'note', content: u });

  assert(memoryCount() === 8, `memoryCount=8 after inserts`);

  // Search: top-5 should be the 5 related records
  const hits = await searchMemory(MARKER, 5);
  assert(hits.length === 5, `searchMemory returns 5 hits`);

  const hitContent = new Set(hits.map(h => h.content));
  let allRelatedFound = true;
  for (const r of related) {
    if (!hitContent.has(r)) { allRelatedFound = false; break; }
  }
  assert(allRelatedFound, 'all 5 related records appear in top-5 (KNN ordering)');

  // Distances should be ascending
  for (let i = 1; i < hits.length; i++) {
    assert(hits[i]!.distance >= hits[i-1]!.distance, `distance ascending at index ${i}`);
  }
} else {
  process.stdout.write('  ℹ  e2e tests skipped (set VESSEL_MEMORY_E2E=1 to run live model download)\n');
}

// ── Cleanup ──────────────────────────────────────────────────────────────
closeMemoryDb();
rmSync(tmpDataDir, { recursive: true, force: true });

process.stdout.write(`\nM1C-B memory tests: ${passed} passed, ${failed} failed${e2e ? ' (e2e)' : ' (smoke)'}\n`);
process.exit(failed > 0 ? 1 : 0);
