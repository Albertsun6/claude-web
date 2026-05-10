/**
 * Vessel routes auth boundary test.
 *
 * Verifies the M1C-B+ closeout MINOR-arch-1 fix landed:
 *   - /api/vessel/health is no-auth (NWBrowser discovery flow)
 *   - All other /api/vessel/* routes require Bearer token when VESSEL_TOKEN set
 *   - Token set + correct token → 200/2xx
 *   - Token set + wrong token → 401
 *   - Token set + missing token → 401
 *   - Token unset (dev mode) → all routes pass with warning
 */

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const TEST_TOKEN = 'test-token-abc123-vessel-auth';

async function spawnBackend(port: number, opts: { token?: string }): Promise<{ kill: () => void; stderr: () => string }> {
  const tmpDataDir = mkdtempSync(join(tmpdir(), 'vessel-auth-test-'));
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(port),
    VESSEL_DATA_DIR: tmpDataDir,
    VESSEL_DISABLE_MDNS: '1',
    VESSEL_MEMORY_AUGMENT: '0',
  };
  if (opts.token) env['VESSEL_TOKEN'] = opts.token;
  else delete env['VESSEL_TOKEN'];

  const backend = spawn('npx', ['tsx', 'src/index.ts'], {
    env,
    cwd: join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  backend.stderr?.on('data', (c: Buffer) => { stderrBuf += c.toString(); });

  await new Promise<void>((resolve) => {
    const t = setTimeout(() => resolve(), 3000);
    backend.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes(`:${port}`) || chunk.toString().toLowerCase().includes('listening')) {
        clearTimeout(t);
        resolve();
      }
    });
  });

  return {
    kill: () => {
      try { backend.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { backend.kill('SIGKILL'); } catch { /* ignore */ } }, 400);
      try { rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
    stderr: () => stderrBuf,
  };
}

async function fetchAt(port: number, path: string, init?: RequestInit): Promise<{ status: number }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  // Drain body so backend can move on.
  await res.text().catch(() => '');
  return { status: res.status };
}

// ── Scenario 1: token set, no token in request ──────────────────────────
{
  const port = 13050;
  const b = await spawnBackend(port, { token: TEST_TOKEN });
  try {
    // Health bypasses auth
    const r1 = await fetchAt(port, '/api/vessel/health');
    assert(r1.status === 200, `[token-set] /api/vessel/health no-token → 200 (got ${r1.status})`);

    // Other vessel routes require token
    const r2 = await fetchAt(port, '/api/vessel/sessions');
    assert(r2.status === 401, `[token-set] /api/vessel/sessions no-token → 401 (got ${r2.status})`);

    const r3 = await fetchAt(port, '/api/vessel/memory');
    assert(r3.status === 401, `[token-set] GET /api/vessel/memory no-token → 401 (got ${r3.status})`);

    const r4 = await fetchAt(port, '/api/vessel/workflows');
    assert(r4.status === 401, `[token-set] GET /api/vessel/workflows no-token → 401 (got ${r4.status})`);

    // POST endpoints also require auth
    const r5 = await fetchAt(port, '/api/vessel/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    });
    assert(r5.status === 401, `[token-set] POST /api/vessel/intent no-token → 401 (got ${r5.status})`);
  } finally { b.kill(); }
}

// ── Scenario 2: token set, correct token in request ─────────────────────
{
  const port = 13051;
  const b = await spawnBackend(port, { token: TEST_TOKEN });
  try {
    const auth = { headers: { Authorization: `Bearer ${TEST_TOKEN}` } };

    const r1 = await fetchAt(port, '/api/vessel/health', auth);
    assert(r1.status === 200, `[token-set+ok] /api/vessel/health → 200 (got ${r1.status})`);

    const r2 = await fetchAt(port, '/api/vessel/sessions', auth);
    assert(r2.status === 200, `[token-set+ok] /api/vessel/sessions → 200 (got ${r2.status})`);

    const r3 = await fetchAt(port, '/api/vessel/memory', auth);
    assert(r3.status === 200, `[token-set+ok] GET /api/vessel/memory → 200 (got ${r3.status})`);

    const r4 = await fetchAt(port, '/api/vessel/workflows', auth);
    assert(r4.status === 200, `[token-set+ok] GET /api/vessel/workflows → 200 (got ${r4.status})`);
  } finally { b.kill(); }
}

// ── Scenario 3: token set, wrong token in request ───────────────────────
{
  const port = 13052;
  const b = await spawnBackend(port, { token: TEST_TOKEN });
  try {
    const wrongAuth = { headers: { Authorization: 'Bearer wrong-token-xyz' } };

    // Health bypasses → 200 even with wrong token
    const r1 = await fetchAt(port, '/api/vessel/health', wrongAuth);
    assert(r1.status === 200, `[token-set+wrong] /api/vessel/health → 200 (got ${r1.status})`);

    const r2 = await fetchAt(port, '/api/vessel/sessions', wrongAuth);
    assert(r2.status === 401, `[token-set+wrong] /api/vessel/sessions → 401 (got ${r2.status})`);

    const r3 = await fetchAt(port, '/api/vessel/memory', wrongAuth);
    assert(r3.status === 401, `[token-set+wrong] /api/vessel/memory → 401 (got ${r3.status})`);
  } finally { b.kill(); }
}

// ── Scenario 4: token UNSET (dev mode) — all routes pass with warning ──
{
  const port = 13053;
  const b = await spawnBackend(port, {});
  try {
    const r1 = await fetchAt(port, '/api/vessel/health');
    assert(r1.status === 200, `[no-token] /api/vessel/health → 200 (got ${r1.status})`);

    const r2 = await fetchAt(port, '/api/vessel/sessions');
    assert(r2.status === 200, `[no-token] /api/vessel/sessions → 200 (got ${r2.status})`);

    const r3 = await fetchAt(port, '/api/vessel/memory');
    assert(r3.status === 200, `[no-token] /api/vessel/memory → 200 (got ${r3.status})`);

    // Stderr should contain the dev-mode warning at least once
    assert(
      b.stderr().includes('VESSEL_TOKEN is empty'),
      'dev-mode warning logged'
    );
  } finally { b.kill(); }
}

process.stdout.write(`\nVessel auth boundary tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
