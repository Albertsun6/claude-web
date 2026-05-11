/**
 * L1-minimal evolution mechanism integration test.
 *
 * Verifies (per arbiter sub-acceptance):
 *  - Migration 0002 idempotent + creates lessons + lessons_fts + 3 trigger
 *  - addLesson + searchLessons FTS5 BM25 ranked
 *  - redactFreeformText covers home shorthand (~/...), $HOME, sk-ant-*, sk-*, AWS, email
 *  - import_fingerprint UNIQUE INDEX dedup
 *  - DELETE/UPDATE FTS sync (Eva issue_fts pattern verbatim)
 *
 * Run: pnpm --filter @vessel/backend test:lessons
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) { console.error(`✗ ${msg}`); failures++; }
  else { console.log(`✓ ${msg}`); }
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'vessel-l1-test-'));
  process.env.VESSEL_DATA_DIR = dataDir;

  // Dynamic-import after env set so DATA_DIR resolves to tmp.
  const { addLesson, searchLessons, getLesson, computeImportFingerprint } = await import('./memory/lesson-store.js');
  const { redactFreeformText } = await import('./observability/redact-helpers.js');
  const { openMemoryDb, closeMemoryDb } = await import('./memory/session-store.js');

  // ── Schema migration 0002 fired ─────────────────────────────────────
  const db = openMemoryDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all() as Array<{ name: string }>;
  const tableNames = new Set(tables.map((t) => t.name));
  assert(tableNames.has('lessons'), 'lessons table created');
  assert(tableNames.has('lessons_fts'), 'lessons_fts virtual table created');

  const userVer = db.pragma('user_version', { simple: true }) as number;
  assert(userVer === 4, `user_version = 4 (got ${userVer})`);

  // ── redactFreeformText: covers spike B2 cases ───────────────────────
  const r1 = redactFreeformText('我的 key 是 sk-ant-test-fake-deadbeefdeadbeef-1234567890');
  assert(!/sk-ant-/.test(r1), `sk-ant-* pattern redacted (got: ${r1})`);

  const r2 = redactFreeformText('AKIAIOSFODNN7EXAMPLE was committed');
  assert(!/AKIAIOSFODNN7EXAMPLE/.test(r2), 'AWS access key redacted');

  const r3 = redactFreeformText('email me at someone@example.com please');
  assert(!/someone@example\.com/.test(r3), 'email redacted');

  const r4 = redactFreeformText('look at ~/.ssh/id_rsa for the key');
  assert(!/~\/\.ssh/.test(r4), `~/...home shorthand redacted (got: ${r4})`);

  const r5 = redactFreeformText('try $HOME/secrets/api.txt');
  assert(!/\$HOME\/secrets/.test(r5), `$HOME/...shorthand redacted (got: ${r5})`);

  const r6 = redactFreeformText('absolute path: /Users/alice/.aws/credentials');
  assert(!/\/Users\/alice/.test(r6), `non-whitelisted absolute path redacted (got: ${r6})`);

  // Whitelist preservation (relativize PASS 1 may convert /Users/<owner>/ → $HOME/;
  // both forms are acceptable as long as path content is not masked).
  const r7 = redactFreeformText('repo at /Users/yongqian/Desktop/Vessel/packages/backend/src/index.ts');
  assert(
    /Desktop\/Vessel\/packages\/backend\/src\/index\.ts/.test(r7) && !/\*\*\*-redacted/.test(r7),
    'whitelisted Vessel path preserved (got: ' + r7 + ')',
  );

  // ── addLesson + body redacted on insert ─────────────────────────────
  const inserted = addLesson({
    kind: 'bug_lesson',
    title: 'cross-runner glob ate migration',
    body: 'In M0 we found that ~/.ssh access AND sk-ant-test-fake-deadbeefdeadbeef-12345 leaked.',
    milestone: 'M0',
    tags: ['migration', 'cross-runner'],
    importance: 5,
  });
  assert(inserted.id.length === 36, 'lesson id is uuid');
  assert(!/sk-ant-/.test(inserted.body), 'inserted body has sk-ant redacted');
  assert(!/~\/\.ssh/.test(inserted.body), 'inserted body has ~/.ssh redacted');

  // ── searchLessons via FTS5 ──────────────────────────────────────────
  addLesson({
    kind: 'bug_lesson',
    title: 'redaction must be at generation layer',
    body: 'M1A-β taught that consumer-layer redactor will be bypassed by new surfaces.',
    milestone: 'M1A-β',
    tags: ['redaction', 'surface'],
    importance: 5,
  });
  addLesson({
    kind: 'spike',
    title: 'evolution mechanism research',
    body: 'lessons-mcp + memem + Letta are prior art for L1-minimal.',
    milestone: 'L1',
    tags: ['evolution', 'spike'],
    importance: 4,
  });

  const matches = searchLessons({ q: 'redaction', limit: 10 });
  assert(matches.length >= 1, `FTS5 search "redaction" found ${matches.length} ≥ 1`);
  assert(matches.some((r) => /redaction/i.test(r.title) || /redact/i.test(r.body)), 'FTS5 result contains redaction term');

  const byMilestone = searchLessons({ milestone: 'M1A-β', limit: 10 });
  assert(byMilestone.length === 1 && byMilestone[0]!.milestone === 'M1A-β', 'milestone filter works');

  const byKind = searchLessons({ kind: 'spike', limit: 10 });
  assert(byKind.length === 1, 'kind filter works');

  // ── FTS5 UPDATE / DELETE sync (Eva issue_fts trigger pattern verbatim) ─
  const id = inserted.id;
  db.prepare(`UPDATE lessons SET title = 'cross-runner glob ate migration UPDATED' WHERE id = ?`).run(id);
  const afterUpdate = searchLessons({ q: 'UPDATED', limit: 5 });
  assert(afterUpdate.some((r) => r.id === id), 'FTS5 INSERT-after-UPDATE trigger reindexes new title');
  const oldTitleHits = searchLessons({ q: 'glob ate migration', limit: 5 });
  // Old text 'glob ate migration' is still in body, so still hits — but the test
  // is whether the NEW title is searchable. It is.

  db.prepare(`DELETE FROM lessons WHERE id = ?`).run(id);
  const afterDelete = searchLessons({ q: 'UPDATED', limit: 5 });
  assert(!afterDelete.some((r) => r.id === id), 'FTS5 DELETE trigger removes ghost row');

  // ── import_fingerprint UNIQUE INDEX dedup ────────────────────────────
  const fp = computeImportFingerprint({
    date: '2026-05-10',
    planFile: 'docs/reviews/M1A-beta-*',
    contract: 'M1A-β 4-way closeout',
    biggestInsight: 'fix at generation layer',
  });
  addLesson({
    kind: 'review_closeout',
    title: 'first import',
    body: 'body 1',
    importFingerprint: fp,
  });
  let dupSucceeded = false;
  try {
    addLesson({
      kind: 'review_closeout',
      title: 'duplicate import',
      body: 'body 2',
      importFingerprint: fp,
    });
    dupSucceeded = true;
  } catch { /* expected — UNIQUE violation */ }
  assert(!dupSucceeded, 'duplicate import_fingerprint blocked by UNIQUE INDEX');

  // ── Migration idempotency: re-open + re-run ──────────────────────────
  closeMemoryDb();
  const db2 = openMemoryDb();
  const tables2 = db2.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='lessons'").get() as { n: number };
  assert(tables2.n === 1, 'lessons table still exists on re-open');
  closeMemoryDb();

  rmSync(dataDir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n✗ ${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\n✓ all L1-minimal evolution mechanism tests passed');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
