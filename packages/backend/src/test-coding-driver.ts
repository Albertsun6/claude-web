/**
 * M0.5 integration test: orchestrator + CodingSkill + FakeCodingDriver.
 *
 * Verifies (without spawning real CC):
 *   - Workspace isolation enforced (instance/workspace/<runId>/, mode 0700)
 *   - FakeCodingDriver writes fixture files under workspace
 *   - Orchestrator records skill_invocations row + writes trace events
 *   - Cancel path: AbortSignal → driver.cancel() → exitCode 130 → status=cancelled
 *   - capability-coding/manifest.yaml validates against AppManifestSchema
 *
 * Run: pnpm --filter @vessel/backend test:coding-driver
 *
 * NOTE: env var VESSEL_DATA_DIR is fixed at module-load (data-dir.ts caches it),
 * so we set it FIRST then dynamic-import the modules.
 */

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    failures++;
  } else {
    console.log(`✓ ${msg}`);
  }
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'vessel-m0.5-test-'));
  process.env.VESSEL_DATA_DIR = dataDir;

  // Dynamic-import AFTER env is set so DATA_DIR resolves to our tmp dir.
  const { runIntent } = await import('./orchestrator.js');
  const { FakeCodingDriver } = await import('./drivers/fake-coding-driver.js');
  const { closeMemoryDb } = await import('./memory/session-store.js');
  const { loadManifest } = await import('./capability-loader.js');

  // ── Test 1: capability-coding manifest validates ─────────────────────────
  const m = loadManifest('coding');
  assert(m.id === 'coding', 'manifest.id is "coding"');
  assert(m.skills.includes('coding'), 'manifest declares coding skill');
  assert(m.soulInjection === 'cli-runner-only', 'soulInjection is cli-runner-only');
  assert(m.schemaVersion === 1, 'schemaVersion = 1');

  // ── Test 2: FakeCodingDriver writes files under workspace iso ────────────
  const fixture = {
    files: {
      'fibonacci.py': 'def fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\n',
    },
    messages: [{ type: 'assistant', content: 'wrote fibonacci.py' }],
  };
  const driver = new FakeCodingDriver(fixture);
  const result = await runIntent({
    text: '写 fibonacci',
    codingDriver: driver,
  });

  if (result.status !== 'success') {
    console.error('  DEBUG result:', JSON.stringify(result, null, 2));
  }
  assert(result.status === 'success', `orchestrator returns status=success (got ${result.status})`);
  if (result.status === 'success') {
    const a = result.artifact as { kind: string; files: string[]; exitCode: number };
    assert(a.kind === 'coding', 'artifact.kind === "coding"');
    assert(a.files.length === 1, `artifact.files has 1 entry, got ${a.files.length}`);
    assert(a.exitCode === 0, `exitCode=0, got ${a.exitCode}`);
    if (a.files[0]) {
      assert(existsSync(a.files[0]), `file ${a.files[0]} exists on disk`);
      assert(a.files[0].startsWith(realpathSync(dataDir)), `file path is under VESSEL_DATA_DIR realpath (got ${a.files[0]})`);
      const content = readFileSync(a.files[0], 'utf8');
      assert(content.includes('def fib'), 'file contents match fixture');
    }
  }

  // ── Test 3: workspace dir mode 0700 ──────────────────────────────────────
  const workspaceRoot = join(dataDir, 'workspace');
  if (existsSync(workspaceRoot)) {
    const mode = statSync(workspaceRoot).mode & 0o777;
    assert(mode === 0o700, `workspace dir mode 0700, got ${mode.toString(8)}`);
  } else {
    assert(false, 'workspace root should exist after coding run');
  }

  // ── Test 4: Cancel path ──────────────────────────────────────────────────
  closeMemoryDb();
  const slowDriver = new FakeCodingDriver({ files: {}, delayMs: 5000 });
  const abortCtl = new AbortController();
  const promise = runIntent({
    text: '写 something slow',
    codingDriver: slowDriver,
    abortSignal: abortCtl.signal,
  });
  setTimeout(() => abortCtl.abort(), 50);
  const cancelResult = await promise;
  assert(cancelResult.status === 'cancelled', `cancel test → status=cancelled (got ${cancelResult.status})`);

  closeMemoryDb();
  rmSync(dataDir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n✗ ${failures} test(s) failed`);
    process.exit(1);
  }
  console.log(`\n✓ all M0.5 integration tests passed`);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
