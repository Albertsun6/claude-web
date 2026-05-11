/**
 * M1A-β integration test: WS multi-conversation parallel.
 *
 * Sub-acceptance per [M1A-slicing-arbiter](../docs/reviews/M1A-slicing-arbiter-2026-05-10-0210.md):
 *   3 different vesselSessionId 经 WS 并发跑 echo intents,
 *   trace 时间线 ≥ 3 路独立 stream，不串路由 (each runId only receives events for its own session_id).
 *
 * Run: pnpm --filter @vessel/backend test:vessel-ws
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

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
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 200));
  }
  return false;
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'vessel-m1a-beta-test-'));
  const port = 3051;
  const env = { ...process.env, VESSEL_DATA_DIR: dataDir, PORT: String(port) };

  console.log(`# Starting backend on :${port}`);
  const backend: ChildProcess = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  // suppress noisy backend logs but keep last lines for failure diagnostics
  let lastLogs = '';
  backend.stderr?.on('data', (b) => { lastLogs += b.toString('utf-8'); });
  backend.stdout?.on('data', (b) => { lastLogs += b.toString('utf-8'); });

  const ready = await waitForBackend(port, 10_000);
  if (!ready) { console.error('backend log:', lastLogs); backend.kill(); process.exit(1); }
  assert(ready, 'backend reachable on /api/vessel/health within 10s');

  // Open 3 separate WS connections, each with a different vesselSessionId.
  type Received = {
    runId: string;
    vesselSessionId: string;
    msgs: Array<{ type: string; runId?: string; vesselSessionId?: string }>;
    completed: boolean;
  };
  const conns: Received[] = [];

  const openOne = (): Promise<Received> => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const runId = randomUUID();
    const vesselSessionId = randomUUID();
    const r: Received = { runId, vesselSessionId, msgs: [], completed: false };
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'vessel_intent',
        runId,
        text: `echo from ${vesselSessionId.slice(0, 8)}`,
        vesselSessionId,
        skill: 'echo',
      }));
    });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as { type: string; runId?: string; vesselSessionId?: string };
      r.msgs.push(m);
      if (m.type === 'vessel_completed' || m.type === 'vessel_error') {
        r.completed = true;
        ws.close();
      }
    });
    ws.on('close', () => resolve(r));
    ws.on('error', reject);
  });

  console.log('# 3 concurrent WS connections, distinct vesselSessionId');
  const results = await Promise.all([openOne(), openOne(), openOne()]);
  conns.push(...results);

  for (const r of results) {
    assert(r.completed, `run ${r.runId.slice(0, 8)} reached completion`);
    // No cross-routing: every routed message MUST carry this conn's runId.
    const wrongRoute = r.msgs.filter((m) =>
      (m.type === 'vessel_trace' || m.type === 'vessel_progress' || m.type === 'vessel_completed' || m.type === 'vessel_error')
      && m.runId !== r.runId,
    );
    assert(wrongRoute.length === 0, `run ${r.runId.slice(0, 8)} got ${wrongRoute.length} cross-routed events (expected 0)`);

    const traceEvents = r.msgs.filter((m) => m.type === 'vessel_trace');
    assert(traceEvents.length >= 1, `run ${r.runId.slice(0, 8)} got ≥ 1 vessel_trace event (got ${traceEvents.length})`);

    const completed = r.msgs.find((m) => m.type === 'vessel_completed');
    assert(!!completed, `run ${r.runId.slice(0, 8)} got vessel_completed`);
    if (completed) {
      assert((completed as { vesselSessionId?: string }).vesselSessionId === r.vesselSessionId,
        `vessel_completed carries correct vesselSessionId`);
    }
  }

  // Verify all 3 sessions persisted in memory.db.
  const runsResp = await fetch(`http://localhost:${port}/api/vessel/runs?limit=10`);
  const runsData = (await runsResp.json()) as { runs: Array<{ session_id: string; status: string }> };
  const sessionIds = new Set(runsData.runs.map((r) => r.session_id));
  for (const r of results) {
    assert(sessionIds.has(r.vesselSessionId), `session ${r.vesselSessionId.slice(0, 8)} persisted in memory.db`);
  }

  backend.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n✗ ${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\n✓ all M1A-β WS multi-conversation tests passed');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
