/**
 * M1B: MCP + permission 边界 integration test.
 *
 * Verifies:
 *  1. /api/vessel/fs/file: allowed path → 200 + content
 *  2. /api/vessel/fs/file: denied path → 403 + permission.denied trace file written
 *  3. /api/vessel/fs/tree: allowed root → 200 + entries array
 *  4. /api/vessel/fs/tree: denied root → 403
 *  5. McpServerManager: spawn/running/shutdown lifecycle
 *
 * Run: pnpm --filter @vessel/backend test:m1b
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) { console.error(`✗ ${msg}`); failures++; }
  else { console.log(`✓ ${msg}`); }
}

async function waitForBackend(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${port}/api/vessel/health`);
      if (r.ok) return true;
    } catch { /* keep trying */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ── McpServerManager lifecycle test (no network, uses macOS sleep as fake server) ─
async function testMcpManagerLifecycle(): Promise<void> {
  console.log('\n## McpServerManager lifecycle');
  // Dynamic import to isolate from server env vars.
  const { McpServerManager, parseMcpSpecsFromEnv } = await import('./mcp/manager.js');
  const mgr = new McpServerManager();

  assert(mgr.running().length === 0, 'initially 0 servers running');

  // Spawn a long-lived no-op subprocess as stand-in for MCP server.
  const ok = await mgr.spawn({ name: 'fake-mcp', command: 'sleep', args: ['999'] });
  assert(ok, 'fake-mcp spawned successfully');
  assert(mgr.running().includes('fake-mcp'), 'fake-mcp in running()');
  assert(mgr.isRunning('fake-mcp'), 'isRunning("fake-mcp") true');

  // Duplicate spawn should warn, not crash.
  const ok2 = await mgr.spawn({ name: 'fake-mcp', command: 'sleep', args: ['999'] });
  assert(ok2, 'duplicate spawn returns true (existing)');
  assert(mgr.running().length === 1, 'still only 1 server after duplicate spawn');

  await mgr.shutdown(1000);
  assert(mgr.running().length === 0, 'running() empty after shutdown');
  assert(!mgr.isRunning('fake-mcp'), 'isRunning("fake-mcp") false after shutdown');
  console.log('McpServerManager lifecycle: passed');

  // parseMcpSpecsFromEnv: valid JSON array
  process.env.VESSEL_MCP_SERVERS = JSON.stringify([
    { name: 'test', command: 'echo', args: ['hello'] },
  ]);
  const specs = parseMcpSpecsFromEnv();
  assert(specs.length === 1 && specs[0].name === 'test', 'parseMcpSpecsFromEnv parses valid JSON');

  // parseMcpSpecsFromEnv: bad JSON → empty array (non-throwing)
  process.env.VESSEL_MCP_SERVERS = 'not-json';
  const bad = parseMcpSpecsFromEnv();
  assert(bad.length === 0, 'parseMcpSpecsFromEnv returns [] on bad JSON');
  delete process.env.VESSEL_MCP_SERVERS;
}

// ── Vessel FS HTTP endpoint test ────────────────────────────────────────────────
async function testVesselFs(): Promise<void> {
  console.log('\n## /api/vessel/fs/* permission enforcement');
  const dataDir = mkdtempSync(join(tmpdir(), 'vessel-m1b-test-'));
  const allowedDir = mkdtempSync(join(tmpdir(), 'vessel-m1b-allowed-'));
  const testFile = join(allowedDir, 'hello.txt');
  writeFileSync(testFile, 'hello from M1B test');

  const port = 3055;
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    VESSEL_DATA_DIR: dataDir,
    PORT: String(port),
    // Only allow the test dir — denies /etc/passwd, /tmp, etc.
    VESSEL_ALLOWED_ROOTS: allowedDir,
    // No token for localhost test
  };

  const backend: ChildProcess = spawn(
    'pnpm', ['exec', 'tsx', 'src/index.ts'],
    { cwd: join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'], env },
  );
  backend.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) process.stderr.write(`[backend] ${line}\n`);
  });

  const ready = await waitForBackend(port, 12_000);
  assert(ready, 'backend ready within 12s');
  if (!ready) {
    backend.kill();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(allowedDir, { recursive: true, force: true });
    return;
  }

  const base = `http://localhost:${port}/api/vessel`;

  // ── Test 1: allowed file → 200 + content ────────────────────────────
  const r1 = await fetch(`${base}/fs/file?path=${encodeURIComponent(testFile)}`);
  assert(r1.status === 200, `allowed file → 200 (got ${r1.status})`);
  if (r1.ok) {
    const body = await r1.json() as Record<string, unknown>;
    assert(body['content'] === 'hello from M1B test', `allowed file content correct (got "${body['content']}")`);
  }

  // ── Test 2: denied file → 403 + trace event written ─────────────────
  const deniedPath = '/etc/passwd';
  const r2 = await fetch(`${base}/fs/file?path=${encodeURIComponent(deniedPath)}`);
  assert(r2.status === 403, `denied file → 403 (got ${r2.status})`);
  if (r2.status === 403) {
    const body = await r2.json() as Record<string, unknown>;
    assert(body['error'] === 'path not allowed', `denied body has error field (got ${JSON.stringify(body)})`);
  }

  // Trace file should appear in dataDir/traces/
  await new Promise((r) => setTimeout(r, 300)); // let async trace write flush
  const tracesDir = join(dataDir, 'traces');
  let traceFound = false;
  if (existsSync(tracesDir)) {
    const traceIds = readdirSync(tracesDir);
    for (const tid of traceIds) {
      const spanFiles = readdirSync(join(tracesDir, tid));
      for (const sf of spanFiles) {
        if (sf.endsWith('.json')) {
          const content = JSON.parse(
            readFileSync(join(tracesDir, tid, sf), 'utf-8'),
          ) as Record<string, unknown>;
          if (content['event_type'] === 'permission.denied') {
            traceFound = true;
          }
        }
      }
    }
  }
  assert(traceFound, 'permission.denied trace event written to dataDir/traces/');

  // ── Test 3: allowed tree → 200 + entries ────────────────────────────
  const r3 = await fetch(`${base}/fs/tree?root=${encodeURIComponent(allowedDir)}`);
  assert(r3.status === 200, `allowed tree → 200 (got ${r3.status})`);
  if (r3.ok) {
    const body = await r3.json() as Record<string, unknown>;
    assert(Array.isArray(body['entries']), 'tree response has entries array');
    const names = (body['entries'] as Array<Record<string, unknown>>).map((e) => e['name']);
    assert(names.includes('hello.txt'), `entries includes hello.txt (got ${JSON.stringify(names)})`);
  }

  // ── Test 4: denied tree → 403 ────────────────────────────────────────
  const r4 = await fetch(`${base}/fs/tree?root=${encodeURIComponent('/etc')}`);
  assert(r4.status === 403, `denied tree → 403 (got ${r4.status})`);

  // ── Test 5: missing path param → 400 ────────────────────────────────
  const r5 = await fetch(`${base}/fs/file`);
  assert(r5.status === 400, `missing path → 400 (got ${r5.status})`);

  backend.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(allowedDir, { recursive: true, force: true });

  console.log('/api/vessel/fs/* tests: done');
}

async function main(): Promise<void> {
  await testMcpManagerLifecycle();
  await testVesselFs();

  console.log(`\n${ failures === 0 ? '✅' : '❌' } M1B: ${failures === 0 ? 'all assertions pass' : `${failures} failure(s)`}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
