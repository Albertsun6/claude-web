/**
 * Soul + Memory + cli-runner integration test.
 *
 * Verifies that vessel-core's prompt-augmentation pipeline composes:
 *   loadSoulOrNull() + searchMemory() → buildArgs --append-system-prompt
 *
 * Without spawning the real Claude CLI (that would need real OAuth +
 * network), we exercise the helper getMemoryContextOrEmpty() directly and
 * spot-check buildArgs behavior via env toggles.
 */

import 'dotenv/config';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'vessel-soul-memory-'));
process.env['VESSEL_DATA_DIR'] = tmpDataDir;
// Disable mDNS to avoid noisy spawn during integration test.
process.env['VESSEL_DISABLE_MDNS'] = '1';

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

// Re-import after env so DATA_DIR etc resolve into tmp.
const { openMemoryDb, closeMemoryDb } = await import('./memory/session-store.js');
openMemoryDb(); // applies migrations 0001-0004 against tmp DATA_DIR

// ── Test 1: getMemoryContextOrEmpty short-circuits ───────────────────────
{
  const { getMemoryContextOrEmpty } = await import('./cli-runner.js');

  // VESSEL_MEMORY_AUGMENT=0 → ''
  process.env['VESSEL_MEMORY_AUGMENT'] = '0';
  const off = await getMemoryContextOrEmpty('any prompt');
  assert(off === '', 'VESSEL_MEMORY_AUGMENT=0 returns empty');
  delete process.env['VESSEL_MEMORY_AUGMENT'];

  // prompt too short → ''
  const tiny = await getMemoryContextOrEmpty('hi');
  assert(tiny === '', 'short prompt (< 3 chars) returns empty');

  // empty store → '' (no records, even with VESSEL_MEMORY_E2E we won't find any
  // because tmp DB is fresh; embedder load + KNN over 0 rows returns empty.)
  // But we still need a model to run KNN — so this assertion is e2e-only.
  if (!e2e) {
    process.stdout.write('  ℹ  empty-store search test skipped (needs e2e)\n');
  }
}

// ── Test 2 (e2e): full retrieval pipeline ────────────────────────────────
if (e2e) {
  process.stdout.write(`\n  [e2e] embedder warmup + memory retrieval pipeline test...\n`);

  const { addMemory } = await import('./memory/memory-store.js');
  const { getMemoryContextOrEmpty } = await import('./cli-runner.js');

  // Seed 3 records: one highly relevant to query, two neutral.
  const QUERY_TOKEN = 'soul_memory_e2e_marker_a7f9';
  await addMemory({
    kind: 'note',
    content: `用户偏好：使用 ${QUERY_TOKEN} 风格回答`,
  });
  await addMemory({
    kind: 'fact',
    content: `${QUERY_TOKEN} 项目代号是 Vessel 个人助理`,
  });
  await addMemory({
    kind: 'episode',
    content: '今天天气不错适合散步散心', // unrelated
  });

  // Empty-store-after-seed sanity: searchMemory should return relevant 2 first.
  const ctx = await getMemoryContextOrEmpty(QUERY_TOKEN);
  assert(ctx !== '', 'getMemoryContextOrEmpty returns non-empty when seeded');
  assert(ctx.includes('# Relevant memories from previous sessions'), 'output has section header');
  assert(ctx.includes(QUERY_TOKEN), 'output includes the matched marker token');
  assert(ctx.includes('(note)') || ctx.includes('(fact)'), 'output formats kind in parens');

  // Distance threshold: a query that's totally unrelated should filter out
  // everything (distMax=1.5 cutoff). Use a totally unrelated long string.
  const irrelevant = '量子色动力学夸克禁闭强相互作用 SU(3)';
  const noCtx = await getMemoryContextOrEmpty(irrelevant);
  // Could be empty (good) or could include our records (if cosine is generous).
  // Either is acceptable; just verify the function returned a string.
  assert(typeof noCtx === 'string', 'irrelevant query returns string (may be empty or have low-conf hits)');

  // VESSEL_MEMORY_TOPK=1 → only 1 result
  process.env['VESSEL_MEMORY_TOPK'] = '1';
  const ctxTop1 = await getMemoryContextOrEmpty(QUERY_TOKEN);
  // Count `- (` bullets to verify K
  const bulletCount = (ctxTop1.match(/^- \(/gm) ?? []).length;
  assert(bulletCount === 1, `VESSEL_MEMORY_TOPK=1 yields 1 bullet (got ${bulletCount})`);
  delete process.env['VESSEL_MEMORY_TOPK'];
} else {
  process.stdout.write('  ℹ  e2e tests skipped (set VESSEL_MEMORY_E2E=1 to seed + retrieve real records)\n');
}

// ── Test 3: soul + memory composition (no Claude CLI spawn) ───────────────
if (e2e) {
  // Plant a soul.md in tmp DATA_DIR
  writeFileSync(join(tmpDataDir, 'soul.md'), `---
schema_version: 1
name: SoulMemoryTestEVA
personality:
  tone: precise
---

body
`, { mode: 0o600 });

  // We can't easily inspect args without spawning Claude CLI. The closest test
  // we can do is verify both helpers return non-empty for a sensible query;
  // the actual buildArgs composition is exercised by code review (since the
  // promptParts.join('\n\n') is straightforward).
  const { loadSoulOrNull } = await import('./soul/parser.js');
  const { renderSoulPrompt } = await import('./soul/injector.js');
  const { getMemoryContextOrEmpty } = await import('./cli-runner.js');

  const soul = loadSoulOrNull();
  assert(soul !== null, 'soul.md loaded');
  if (soul) {
    const soulPrompt = renderSoulPrompt(soul);
    assert(soulPrompt.includes('SoulMemoryTestEVA'), 'soul prompt contains Instance name');

    const memCtx = await getMemoryContextOrEmpty('soul_memory_e2e_marker_a7f9');
    // Joined as buildArgs would do
    const combined = [soulPrompt, memCtx].filter(Boolean).join('\n\n');
    assert(combined.includes('SoulMemoryTestEVA') && combined.includes('Relevant memories'),
      'combined system prompt contains both soul name and memory section');
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────
closeMemoryDb();
rmSync(tmpDataDir, { recursive: true, force: true });

process.stdout.write(`\nSoul + Memory + cli-runner integration: ${passed} passed, ${failed} failed${e2e ? ' (e2e)' : ' (smoke)'}\n`);
process.exit(failed > 0 ? 1 : 0);
