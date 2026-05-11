/**
 * /api/vessel/workflows — Vessel Workflow Engine HTTP API.
 *
 * POST /api/vessel/workflows           — create + start workflow
 * GET  /api/vessel/workflows           — list (filter by status)
 * GET  /api/vessel/workflows/:id       — get single workflow
 * POST /api/vessel/workflows/:id/resume — resume paused/interrupted workflow
 * POST /api/vessel/workflows/:id/cancel — cancel workflow
 *
 * @see M1C-A B-级 review: docs/reviews/M1C-A-workflow-b-level-architect-2026-05-10-1830.md
 */

import { Hono } from 'hono';
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  MAX_STEP_TIMEOUT_MS,
  type WorkflowInput,
  type WorkflowStatus,
} from '../memory/workflow-store.js';
import { runWorkflowFromStep, cancelWorkflow, type BroadcastFn } from '../workflow/executor.js';

const MAX_STEPS = 20;
const MAX_TEXT_CHARS = 8000;

export function buildWorkflowRouter(broadcast: BroadcastFn): Hono {
  const router = new Hono();

  // Create + start workflow
  router.post('/workflows', async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }

    const { steps, kind } = body as Record<string, unknown>;
    if (!Array.isArray(steps) || steps.length === 0) {
      return c.json({ error: 'steps must be a non-empty array' }, 400);
    }
    if (steps.length > MAX_STEPS) {
      return c.json({ error: `steps exceed max ${MAX_STEPS}` }, 400);
    }

    // Validate each step
    for (const step of steps) {
      if (!step || typeof step !== 'object') return c.json({ error: 'each step must be an object' }, 400);
      const s = step as Record<string, unknown>;
      if (s['kind'] === 'coding') {
        if (typeof s['text'] !== 'string' || !s['text'].trim()) {
          return c.json({ error: 'coding step requires non-empty text' }, 400);
        }
        if ((s['text'] as string).length > MAX_TEXT_CHARS) {
          return c.json({ error: `coding step text exceeds ${MAX_TEXT_CHARS} chars` }, 400);
        }
        // M1C-A+: optional per-step timeout. Capped to MAX_STEP_TIMEOUT_MS.
        if (s['timeoutMs'] !== undefined) {
          const t = s['timeoutMs'];
          if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) {
            return c.json({ error: 'coding step timeoutMs must be a positive number (ms)' }, 400);
          }
          if (t > MAX_STEP_TIMEOUT_MS) {
            return c.json({ error: `coding step timeoutMs exceeds max ${MAX_STEP_TIMEOUT_MS}ms (30 min)` }, 400);
          }
        }
      } else if (s['kind'] === 'hitl') {
        if (typeof s['message'] !== 'string' || !s['message'].trim()) {
          return c.json({ error: 'hitl step requires non-empty message' }, 400);
        }
      } else {
        return c.json({ error: `unknown step kind: ${String(s['kind'])}` }, 400);
      }
    }

    const input: WorkflowInput = {
      kind: typeof kind === 'string' ? kind : undefined,
      steps: steps as WorkflowInput['steps'],
    };

    const wf = createWorkflow(input);

    // Fire and forget — start executor asynchronously.
    void runWorkflowFromStep(wf.id, 0, broadcast);

    return c.json(wf, 202);
  });

  // List workflows
  router.get('/workflows', (c) => {
    const statusParam = c.req.query('status') as WorkflowStatus | 'all' | undefined;
    const limitParam = parseInt(c.req.query('limit') ?? '50', 10);
    const limit = isNaN(limitParam) ? 50 : Math.max(1, Math.min(200, limitParam));
    const rows = listWorkflows({ status: statusParam, limit });
    return c.json({ workflows: rows, count: rows.length });
  });

  // Get single workflow
  router.get('/workflows/:id', (c) => {
    const id = c.req.param('id');
    const wf = getWorkflow(id);
    if (!wf) return c.json({ error: 'not found' }, 404);
    return c.json(wf);
  });

  // Resume paused or interrupted workflow
  router.post('/workflows/:id/resume', async (c) => {
    const id = c.req.param('id');
    const wf = getWorkflow(id);
    if (!wf) return c.json({ error: 'not found' }, 404);

    if (wf.status !== 'paused' && wf.status !== 'interrupted') {
      return c.json({ error: `workflow status is '${wf.status}', must be 'paused' or 'interrupted' to resume` }, 409);
    }

    let chosenOption: string | undefined;
    let skipCurrentStep = false;

    try {
      const body = await c.req.json() as Record<string, unknown>;
      chosenOption = typeof body['option'] === 'string' ? body['option'] : undefined;
      skipCurrentStep = body['skip'] === true;
    } catch { /* optional body */ }

    // For interrupted: default skip=false means re-run current_step.
    // cursor B-级 review M-1: re-run is conservative (coding output not persisted).
    const nextStep = (wf.status === 'paused' || skipCurrentStep)
      ? wf.current_step + 1
      : wf.current_step;

    updateWorkflow(id, {
      status: 'running',
      chosen_option: chosenOption ?? null,
      paused_reason: null,
      paused_options: null,
    });

    void runWorkflowFromStep(id, nextStep, broadcast);

    return c.json({ resumed: true, fromStep: nextStep });
  });

  // Cancel workflow
  // M1C-A+: if executor is in-flight for this workflow, abort the controller
  // (executor will transition state to 'cancelled' + broadcast). Otherwise
  // (paused / pending workflow with no executor running) update DB directly.
  router.post('/workflows/:id/cancel', (c) => {
    const id = c.req.param('id');
    const wf = getWorkflow(id);
    if (!wf) return c.json({ error: 'not found' }, 404);
    if (wf.status === 'completed' || wf.status === 'failed' || wf.status === 'cancelled') {
      return c.json({ error: `cannot cancel workflow in terminal status '${wf.status}'` }, 409);
    }
    const aborted = cancelWorkflow(id);
    if (!aborted) {
      // No in-flight executor (e.g. paused / pending without a runner) —
      // update DB + broadcast directly so the workflow is marked terminal.
      updateWorkflow(id, { status: 'cancelled' });
      broadcast({ type: 'vessel_workflow_cancelled', workflowId: id });
    }
    return c.json({ cancelled: true, aborted });
  });

  return router;
}
