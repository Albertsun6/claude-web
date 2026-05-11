/**
 * M1A-α Step 6: integration test for CLI + HTTP concurrent memory.db write.
 *
 * Verifies C-MAJOR-3 fix (busy_timeout = 5000): backend HTTP server and a
 * separate vessel-core CLI process can both write `memory.db` concurrently
 * without SQLITE_BUSY.
 *
 * Run: pnpm --filter @vessel/backend test:vessel-http
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

async function waitForBackend(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${port}/api/vessel/health`);
      if (r.ok) return true;
    } catch { /* keep trying */ }
    await new Promise((res) => setTimeout(res, 200));
  }
  return false;
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'vessel-m1a-test-'));
  const port = 3050;
  const env = { ...process.env, VESSEL_DATA_DIR: dataDir, PORT: String(port) };

  console.log(`# Starting backend on :${port}, data=${dataDir}`);
  const backend: ChildProcess = spawn(
    'pnpm', ['exec', 'tsx', 'src/index.ts'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const ready = await waitForBackend(port, 10_000);
  assert(ready, 'backend reachable on /api/vessel/health within 10s');
  if (!ready) {
    backend.kill();
    process.exit(1);
  }

  // Hammer: 5 parallel HTTP intents AND 5 sequential CLI intents (different process), interleaved.
  const httpPromise = Promise.all(Array.from({ length: 5 }, (_, i) =>
    fetch(`http://localhost:${port}/api/vessel/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `http-${i}`, skill: 'echo' }),
    }).then((r) => r.json() as Promise<{ status: string }>),
  ));

  const cliPromise = (async () => {
    const results: { code: number | null; stderr: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const proc = spawn(
          'pnpm', ['exec', 'tsx', 'src/cli/vessel-core.ts', '--skill=echo', `cli-${i}`],
          { env, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stderr = '';
        proc.stderr.on('data', (b) => { stderr += b.toString('utf-8'); });
        proc.on('close', (code) => resolve({ code, stderr }));
      });
      results.push(r);
    }
    return results;
  })();

  const [httpResults, cliResults] = await Promise.all([httpPromise, cliPromise]);

  const httpOk = httpResults.every((r) => r.status === 'success');
  assert(httpOk, `5 HTTP intents all status=success (got ${httpResults.map((r) => r.status).join(',')})`);

  const cliOk = cliResults.every((r) => r.code === 0);
  assert(cliOk, `5 CLI intents all exit 0 (got ${cliResults.map((r) => r.code).join(',')})`);

  const noSqliteBusy = !cliResults.some((r) => /SQLITE_BUSY/i.test(r.stderr));
  assert(noSqliteBusy, 'no SQLITE_BUSY in CLI stderr (busy_timeout=5000 working)');

  // Final state check
  const runsResp = await fetch(`http://localhost:${port}/api/vessel/runs?limit=20`);
  const runs = (await runsResp.json()) as { runs: Array<{ status: string }> };
  assert(runs.runs.length >= 10, `≥ 10 runs persisted across both writers (got ${runs.runs.length})`);

  // Cleanup
  backend.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n✗ ${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\n✓ all M1A-α concurrent-write tests passed');
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
