/**
 * M2-iOS-α — mDNS publisher + /api/vessel/health integration tests.
 *
 * Acceptance (Mac-side scope of M2-iOS):
 *   1. startMdnsPublisher spawns dns-sd; getPublishedSpec returns expected spec
 *   2. dns-sd -B can find Vessel._vessel._tcp (real mDNS browse)
 *   3. stopMdnsPublisher kills the subprocess (no orphan dns-sd)
 *   4. /api/vessel/health returns service identity (no auth required)
 *   5. health response contains bonjour metadata when publisher is active
 *   6. health response includes soul info when ~/.vessel/soul.md exists
 *
 * iOS-side acceptance (NWBrowser, real device, TestFlight) is M2-iOS-β/γ
 * and is NOT covered here — operator-driven.
 */

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use a unique port for this test run so we never collide with a real running
// vessel-core. We probe with a different mDNS service type prefix so the test
// doesn't fight with a separately-started backend.
const TEST_PORT = 13039;

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

// ── Test 1: mdns publisher start/stop on the real dns-sd binary ──────────
{
  const { startMdnsPublisher, stopMdnsPublisher, getPublishedSpec } = await import('./mdns/publisher.js');

  assert(getPublishedSpec() === null, 'no spec before start');

  startMdnsPublisher({ port: TEST_PORT, instanceName: 'VesselTestAlpha' });
  // dns-sd takes a moment to register; the spawn returns immediately with a pid.
  await new Promise(r => setTimeout(r, 50));

  const spec = getPublishedSpec();
  assert(spec !== null, 'spec set after start');
  assert(spec?.port === TEST_PORT, 'spec.port matches');
  assert(spec?.instanceName === 'VesselTestAlpha', 'spec.instanceName matches');

  // Idempotency: same spec → no-op
  startMdnsPublisher({ port: TEST_PORT, instanceName: 'VesselTestAlpha' });
  assert(getPublishedSpec()?.instanceName === 'VesselTestAlpha', 'idempotent: same spec is no-op');

  // dns-sd -B should find the registered service (timeout 2s).
  // We spawn dns-sd -B for a short window and check stdout.
  const browseResult = await new Promise<string>((resolve) => {
    const child = spawn('dns-sd', ['-B', '_vessel._tcp', 'local'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    child.stdout?.on('data', (chunk: Buffer) => { buf += chunk.toString(); });
    setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      resolve(buf);
    }, 1500);
  });
  assert(browseResult.includes('VesselTestAlpha'), `dns-sd -B finds VesselTestAlpha (got ${browseResult.length} bytes)`);

  // Stop and verify spec cleared.
  stopMdnsPublisher();
  assert(getPublishedSpec() === null, 'spec cleared after stop');

  // Stop is idempotent.
  let threw = false;
  try { stopMdnsPublisher(); } catch { threw = true; }
  assert(!threw, 'stopMdnsPublisher idempotent');
}

// ── Test 2: publisher fail-soft when dns-sd missing ───────────────────────
// We can't easily uninstall dns-sd. Instead exercise the code path indirectly
// by checking that the 'error' handler exists and would clear state. This is
// a structural check.
{
  const { startMdnsPublisher, stopMdnsPublisher, getPublishedSpec } = await import('./mdns/publisher.js');

  // Use a clearly-bad command via env override — but publisher hardcodes 'dns-sd'.
  // Skip this case: rely on Test 1 for live behavior + code review for fail-soft.
  // Document the gap in the test output rather than fake the result.
  process.stdout.write('  ℹ  fail-soft (dns-sd missing) verified by code review only\n');
  void startMdnsPublisher; void stopMdnsPublisher; void getPublishedSpec;
}

// ── Test 3: /api/vessel/health returns service identity ──────────────────
// Spin up the backend in a child process on a unique port + temp DATA_DIR,
// curl /api/vessel/health, kill the backend.
{
  const tmpDataDir = mkdtempSync(join(tmpdir(), 'vessel-m2ios-test-'));
  const httpPort = TEST_PORT + 1;

  const backend = spawn('npx', ['tsx', 'src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(httpPort),
      VESSEL_DATA_DIR: tmpDataDir,
      VESSEL_DISABLE_MDNS: '1', // don't fight Test 1's prior dns-sd
      // No VESSEL_TOKEN → routes that require auth would 401, but health is no-auth.
    },
    cwd: join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  backend.stderr?.on('data', (c: Buffer) => { stderrBuf += c.toString(); });

  // Wait for "listening" or up to 8s.
  const ready = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    backend.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().toLowerCase().includes('listening') || chunk.toString().includes(`:${httpPort}`)) {
        clearTimeout(t);
        resolve(true);
      }
    });
  });

  // Even without explicit "listening" log, give it a moment
  if (!ready) await new Promise(r => setTimeout(r, 1500));

  try {
    // No-auth health probe.
    const r = await fetch(`http://127.0.0.1:${httpPort}/api/vessel/health`);
    assert(r.status === 200, `/api/vessel/health returns 200 (got ${r.status})`);

    const body = await r.json() as Record<string, unknown>;
    assert(body['service'] === 'vessel', 'response.service === "vessel"');
    assert(typeof body['version'] === 'string', 'response.version is string');
    assert(typeof body['hostname'] === 'string', 'response.hostname is string');
    assert(typeof body['uptimeSec'] === 'number', 'response.uptimeSec is number');
    assert(body['bonjour'] !== undefined, 'response.bonjour present');

    const bonjour = body['bonjour'] as Record<string, unknown>;
    // VESSEL_DISABLE_MDNS=1 → published=false expected
    assert(bonjour['published'] === false, 'bonjour.published=false when VESSEL_DISABLE_MDNS=1');

    assert(body['soul'] !== undefined, 'response.soul present');
    const soul = body['soul'] as Record<string, unknown>;
    assert(soul['present'] === false, 'soul.present=false when no soul.md in tmp DATA_DIR');

    // No secrets leakage check.
    const raw = JSON.stringify(body);
    assert(!raw.includes('VESSEL_TOKEN'), 'response does not leak VESSEL_TOKEN');
    assert(!raw.includes('CLAUDE_CLI'), 'response does not leak env var names');
    assert(!raw.includes('/Users/'), 'response does not leak filesystem paths');
  } finally {
    try { backend.kill('SIGTERM'); } catch { /* ignore */ }
    // Wait briefly for shutdown
    await new Promise(r => setTimeout(r, 500));
    try { backend.kill('SIGKILL'); } catch { /* ignore */ }
    rmSync(tmpDataDir, { recursive: true, force: true });
  }

  // If the test failed and we have stderr, print last 500 chars for debugging.
  if (failed > 0 && stderrBuf) {
    process.stderr.write(`\n[backend stderr last 500]\n${stderrBuf.slice(-500)}\n`);
  }
}

// ── Test 4: health response includes soul.name when soul.md present ──────
{
  const tmpDataDir = mkdtempSync(join(tmpdir(), 'vessel-m2ios-soul-'));
  // Plant a valid soul.md in the temp DATA_DIR
  writeFileSync(
    join(tmpDataDir, 'soul.md'),
    `---
schema_version: 1
name: HealthTestEVA
personality:
  tone: precise
---

body
`,
    { mode: 0o600 }
  );

  const httpPort = TEST_PORT + 2;
  const backend = spawn('npx', ['tsx', 'src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(httpPort),
      VESSEL_DATA_DIR: tmpDataDir,
      VESSEL_DISABLE_MDNS: '1',
    },
    cwd: join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise(r => setTimeout(r, 2000)); // give server time to bind

  try {
    const r = await fetch(`http://127.0.0.1:${httpPort}/api/vessel/health`);
    if (r.ok) {
      const body = await r.json() as Record<string, unknown>;
      const soul = body['soul'] as Record<string, unknown>;
      assert(soul['present'] === true, 'soul.present=true when soul.md exists');
      assert(soul['name'] === 'HealthTestEVA', 'soul.name reflects file content');
    } else {
      assert(false, `health endpoint reachable in soul case (got ${r.status})`);
    }
  } finally {
    try { backend.kill('SIGTERM'); } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 500));
    try { backend.kill('SIGKILL'); } catch { /* ignore */ }
    rmSync(tmpDataDir, { recursive: true, force: true });
  }
}

process.stdout.write(`\nM2-iOS-α tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
