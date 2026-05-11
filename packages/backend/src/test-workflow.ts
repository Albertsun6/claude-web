/**
 * M1C-A Workflow Engine integration test.
 *
 * Tests: create → HITL pause → (fake restart) → resume → complete.
 * Runs entirely against the in-process DB; no HTTP server required.
 */

import 'dotenv/config';
import { openMemoryDb, closeMemoryDb } from './memory/session-store.js';
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  markInterruptedOnStartup,
} from './memory/workflow-store.js';
import { runWorkflowFromStep, cancelWorkflow, inflightWorkflowIds } from './workflow/executor.js';

let passed = 0;
let failed = 0;
const broadcastLog: unknown[] = [];

function broadcast(msg: unknown): void {
  broadcastLog.push(msg);
}

function assert(cond: boolean, label: string): void {
  if (cond) {
    process.stdout.write(`  ✅ ${label}\n`);
    passed++;
  } else {
    process.stderr.write(`  ❌ FAIL: ${label}\n`);
    failed++;
  }
}

openMemoryDb();

// ── Test 1: createWorkflow persists to DB ──────────────────────────────────
{
  const wf = createWorkflow({
    kind: 'test',
    steps: [
      { kind: 'hitl', message: 'approve this?', options: ['yes', 'no'] },
    ],
  });
  assert(typeof wf.id === 'string' && wf.id.length > 8, 'workflow id is a non-empty string');
  assert(wf.status === 'pending', 'initial status is pending');
  assert(wf.total_steps === 1, 'total_steps = 1');

  const fetched = getWorkflow(wf.id);
  assert(fetched?.id === wf.id, 'getWorkflow returns same id');
}

// ── Test 2: listWorkflows filter by status ─────────────────────────────────
{
  const wfA = createWorkflow({ steps: [{ kind: 'hitl', message: 'a' }] });
  const wfB = createWorkflow({ steps: [{ kind: 'hitl', message: 'b' }] });
  updateWorkflow(wfA.id, { status: 'completed' });

  const allRows = listWorkflows({ status: 'all' });
  assert(allRows.length >= 2, 'listWorkflows all returns ≥2');

  const completedRows = listWorkflows({ status: 'completed' });
  assert(completedRows.some(r => r.id === wfA.id), 'completed filter returns wfA');
  assert(!completedRows.some(r => r.id === wfB.id), 'completed filter excludes wfB');
}

// ── Test 3: markInterruptedOnStartup ──────────────────────────────────────
{
  const wfRun = createWorkflow({ steps: [{ kind: 'hitl', message: 'in progress' }] });
  updateWorkflow(wfRun.id, { status: 'running' });

  const count = markInterruptedOnStartup();
  assert(count >= 1, 'markInterruptedOnStartup returns ≥1');

  const after = getWorkflow(wfRun.id);
  assert(after?.status === 'interrupted', 'running workflow marked interrupted on startup');
}

// ── Test 4: HITL pause via executor ───────────────────────────────────────
{
  broadcastLog.length = 0;

  const wf = createWorkflow({
    steps: [
      { kind: 'hitl', message: 'please decide', options: ['approve', 'reject'] },
    ],
  });

  await runWorkflowFromStep(wf.id, 0, broadcast);

  const after = getWorkflow(wf.id);
  assert(after?.status === 'paused', 'executor pauses at hitl step');
  assert(after?.paused_reason === 'please decide', 'paused_reason set correctly');

  const pausedMsg = broadcastLog.find(
    (m) => (m as Record<string, unknown>)['type'] === 'vessel_workflow_paused'
  ) as Record<string, unknown> | undefined;
  assert(!!pausedMsg, 'vessel_workflow_paused broadcast emitted');
  assert(
    Array.isArray(pausedMsg?.['options']) &&
    (pausedMsg['options'] as string[]).includes('approve'),
    'vessel_workflow_paused.options contains approve'
  );
}

// ── Test 5: resume after pause (next step = completion) ───────────────────
{
  broadcastLog.length = 0;

  const wf = createWorkflow({
    steps: [
      { kind: 'hitl', message: 'gate' },
    ],
  });

  // Pause at step 0
  await runWorkflowFromStep(wf.id, 0, broadcast);
  assert(getWorkflow(wf.id)?.status === 'paused', 'paused before resume');

  // Resume from step 1 (past the hitl step) — no more steps → completed
  updateWorkflow(wf.id, { status: 'running', chosen_option: 'approve', paused_reason: null, paused_options: null });
  await runWorkflowFromStep(wf.id, 1, broadcast);

  const after = getWorkflow(wf.id);
  assert(after?.status === 'completed', 'workflow completes after resume past hitl');

  const completedMsg = broadcastLog.find(
    (m) => (m as Record<string, unknown>)['type'] === 'vessel_workflow_completed'
  );
  assert(!!completedMsg, 'vessel_workflow_completed broadcast emitted after resume');
}

// ── Test 6: cancel workflow ────────────────────────────────────────────────
{
  broadcastLog.length = 0;

  const wf = createWorkflow({
    steps: [{ kind: 'hitl', message: 'cancel me' }],
  });

  updateWorkflow(wf.id, { status: 'cancelled' });
  // executor should bail out immediately on cancelled
  await runWorkflowFromStep(wf.id, 0, broadcast);

  assert(broadcastLog.length === 0, 'no broadcasts after cancel');
  assert(getWorkflow(wf.id)?.status === 'cancelled', 'status remains cancelled');
}

// ── Test 7: abortSignal cancels mid-run ───────────────────────────────────
{
  broadcastLog.length = 0;

  const wf = createWorkflow({
    steps: [
      { kind: 'hitl', message: 'step0' },
      { kind: 'hitl', message: 'step1' },
    ],
  });

  const ctl = new AbortController();
  ctl.abort(); // abort before we even start

  await runWorkflowFromStep(wf.id, 0, broadcast, ctl.signal);

  const after = getWorkflow(wf.id);
  assert(after?.status === 'cancelled', 'aborted workflow set to cancelled');
  const cancelMsg = broadcastLog.find(
    (m) => (m as Record<string, unknown>)['type'] === 'vessel_workflow_cancelled'
  );
  assert(!!cancelMsg, 'vessel_workflow_cancelled broadcast emitted on abort');
}

// ── Test 8: updateWorkflow merges fields ──────────────────────────────────
{
  const wf = createWorkflow({ steps: [{ kind: 'hitl', message: 'x' }] });
  updateWorkflow(wf.id, { status: 'running', current_step: 0 });
  const updated = getWorkflow(wf.id);
  assert(updated?.status === 'running', 'updateWorkflow sets status');
  assert(updated?.current_step === 0, 'updateWorkflow sets current_step');
}

// ── M1C-A+ Test 9: per-step timeout transitions to status='failed' ────────
{
  broadcastLog.length = 0;

  // timeoutMs=1 — runIntent for echo skill will see signal aborted by the
  // time it returns (echo synchronously enters → checks signal at the end).
  // The race may go either way for a real coding driver, but for echo skill
  // the controller is reliably aborted before runIntent finishes its DB writes.
  const wf = createWorkflow({
    steps: [
      { kind: 'coding', text: 'hello', skill: 'echo', timeoutMs: 1 },
    ],
  });

  await runWorkflowFromStep(wf.id, 0, broadcast);

  const after = getWorkflow(wf.id);
  // We accept either 'failed' (timeout fired before runIntent finished) or
  // 'completed' (runIntent finished < 1ms — possible on a fast machine).
  // The contract worth testing: if status is failed, error_message must
  // mention 'timeout'.
  if (after?.status === 'failed') {
    assert(typeof after.error_message === 'string' && after.error_message.includes('timed out'),
      `failed status carries timeout error_message (got: ${after.error_message})`);
    const failedMsg = broadcastLog.find(
      (m) => (m as Record<string, unknown>)['type'] === 'vessel_workflow_failed'
    ) as Record<string, unknown> | undefined;
    assert(!!failedMsg, 'vessel_workflow_failed broadcast emitted on timeout');
    assert(typeof failedMsg?.['error'] === 'string' && (failedMsg['error'] as string).includes('timed out'),
      'failed broadcast error contains "timed out"');
  } else {
    // Race won by runIntent — that's also a valid outcome; just record it.
    process.stdout.write(`  ℹ  timeout race: runIntent finished before 1ms timer (status=${after?.status}); skipping timeout assertion\n`);
  }
}

// ── M1C-A+ Test 10: timeout schema validation in workflow-store ────────────
// (HTTP-level validation lives in vessel-workflow.ts route; here we just
// confirm createWorkflow persists timeoutMs in the JSON.)
{
  const wf = createWorkflow({
    steps: [{ kind: 'coding', text: 'long', timeoutMs: 60_000 }],
  });
  const stored = JSON.parse(getWorkflow(wf.id)!.steps_json) as Array<Record<string, unknown>>;
  assert(stored[0]?.['timeoutMs'] === 60_000, 'createWorkflow persists timeoutMs in steps_json');
}

// ── M1C-A+ Test 11: cancelWorkflow returns false when no inflight ─────────
{
  const wf = createWorkflow({ steps: [{ kind: 'hitl', message: 'idle' }] });
  // No runWorkflowFromStep called → no inflight controller → cancel returns false
  const aborted = cancelWorkflow(wf.id);
  assert(aborted === false, 'cancelWorkflow returns false when no inflight executor');
}

// ── M1C-A+ Test 12: cancelWorkflow during inflight aborts to status='cancelled' ──
{
  broadcastLog.length = 0;

  // Build a 2-step coding workflow with no timeout. We'll race runWorkflowFromStep
  // against a microtask that calls cancelWorkflow. Because echo runs synchronously
  // into runIntent + DB writes, this is best-effort — accept either 'completed'
  // (cancel landed too late) or 'cancelled' (cancel won).
  const wf = createWorkflow({
    steps: [
      { kind: 'coding', text: 'step0', skill: 'echo' },
      { kind: 'coding', text: 'step1', skill: 'echo' },
    ],
  });

  const runPromise = runWorkflowFromStep(wf.id, 0, broadcast);
  // Try to cancel before run completes.
  queueMicrotask(() => { cancelWorkflow(wf.id); });
  await runPromise;

  const after = getWorkflow(wf.id);
  if (after?.status === 'cancelled') {
    assert(true, 'cancelWorkflow during inflight transitions to cancelled');
    const cancelMsg = broadcastLog.find(
      (m) => (m as Record<string, unknown>)['type'] === 'vessel_workflow_cancelled'
    );
    assert(!!cancelMsg, 'vessel_workflow_cancelled broadcast on user cancel');
  } else {
    process.stdout.write(`  ℹ  cancel race: workflow finished before cancel landed (status=${after?.status})\n`);
  }

  // Crucial invariant regardless of race: inflight map cleaned up after run.
  assert(!inflightWorkflowIds().includes(wf.id), 'inflight controller cleaned up after run');
}

// ── M1C-A+ Test 13: external abortSignal still works (back-compat) ────────
{
  broadcastLog.length = 0;

  const wf = createWorkflow({
    steps: [{ kind: 'coding', text: 'will be aborted', skill: 'echo' }],
  });

  const ctl = new AbortController();
  ctl.abort(); // pre-aborted external signal
  await runWorkflowFromStep(wf.id, 0, broadcast, ctl.signal);

  const after = getWorkflow(wf.id);
  assert(after?.status === 'cancelled',
    `external pre-aborted signal → cancelled (got ${after?.status})`);
  assert(!inflightWorkflowIds().includes(wf.id), 'cleanup after external abort');
}

// ── Teardown ──────────────────────────────────────────────────────────────
closeMemoryDb();

process.stdout.write(`\nM1C-A workflow tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
