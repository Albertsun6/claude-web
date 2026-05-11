/**
 * Workflow executor — runs WorkflowStep[] in sequence.
 *
 * 'coding' steps call runIntent(); 'hitl' steps pause and await resume.
 * Broadcast is injected from index.ts (broadcastToAll) per cursor B-级 review M-2.
 *
 * Interrupted-on-restart semantics (cursor M-1): on resume after interrupt,
 * re-run current_step (conservative — coding task result not persisted, treat as not done).
 *
 * M1C-A+ (this revision):
 *   - Per-step `timeoutMs` (coding steps only): when set, executor races
 *     runIntent() against a setTimeout; on timeout the controller aborts and
 *     the workflow transitions to status='failed' with error_message describing
 *     the timeout.
 *   - HTTP /cancel now actually aborts the in-flight executor (not just DB
 *     update). cancelWorkflow(id) sets reason='user' and aborts; executor
 *     transitions to status='cancelled' (vs 'failed' for timeout).
 */

import { runIntent } from '../orchestrator.js';
import {
  getWorkflow,
  updateWorkflow,
  type WorkflowStep,
} from '../memory/workflow-store.js';

export type BroadcastFn = (msg: unknown) => void;

type CancelReason = 'user' | 'timeout';

/**
 * Module-level state for in-flight workflows. Single-process scope (Vessel
 * doesn't run multiple backend processes per individual instance per ADR-011).
 *
 * NOT persisted: on server restart, markInterruptedOnStartup() handles
 * recovery — the AbortController would have been GC'd anyway.
 */
const inflightControllers = new Map<string, AbortController>();
const inflightCancelReasons = new Map<string, CancelReason>();

/**
 * Cancel an in-flight workflow with reason='user'. Returns true if a workflow
 * was actually in-flight (so caller can decide whether to also UPDATE DB
 * for non-running statuses like 'paused' that can't be aborted).
 */
export function cancelWorkflow(workflowId: string): boolean {
  const ctl = inflightControllers.get(workflowId);
  if (!ctl) return false;
  inflightCancelReasons.set(workflowId, 'user');
  ctl.abort();
  return true;
}

/** Test/inspection — currently in-flight workflow ids. */
export function inflightWorkflowIds(): string[] {
  return [...inflightControllers.keys()];
}

/** Execute workflow steps starting from `fromStep`. Fire-and-forget from HTTP /resume. */
export async function runWorkflowFromStep(
  workflowId: string,
  fromStep: number,
  broadcast: BroadcastFn,
  externalAbort?: AbortSignal,
): Promise<void> {
  const wf = getWorkflow(workflowId);
  if (!wf) { console.warn(`[workflow] ${workflowId} not found`); return; }
  if (wf.status === 'cancelled') return;

  const steps: WorkflowStep[] = JSON.parse(wf.steps_json);

  // Dedicated controller for this run; lives only while inflight.
  const controller = new AbortController();
  inflightControllers.set(workflowId, controller);

  // If caller supplied an external signal (e.g. from a test harness), link it.
  // Forward abort from external → controller; reason='user' if not already set.
  let externalListener: (() => void) | undefined;
  if (externalAbort) {
    if (externalAbort.aborted) {
      if (!inflightCancelReasons.has(workflowId)) inflightCancelReasons.set(workflowId, 'user');
      controller.abort();
    } else {
      externalListener = () => {
        if (!inflightCancelReasons.has(workflowId)) inflightCancelReasons.set(workflowId, 'user');
        controller.abort();
      };
      externalAbort.addEventListener('abort', externalListener);
    }
  }

  const cleanup = (): void => {
    inflightControllers.delete(workflowId);
    inflightCancelReasons.delete(workflowId);
    if (externalAbort && externalListener) externalAbort.removeEventListener('abort', externalListener);
  };

  try {
    updateWorkflow(workflowId, { status: 'running', current_step: fromStep });

    for (let i = fromStep; i < steps.length; i++) {
      if (controller.signal.aborted) {
        applyAbortOutcome(workflowId, broadcast, i);
        return;
      }

      const step = steps[i];
      updateWorkflow(workflowId, { current_step: i });

      broadcast({ type: 'vessel_workflow_step', workflowId, step: i, totalSteps: steps.length, stepKind: step.kind });

      if (step.kind === 'coding') {
        // Per-step timeout: schedule abort after timeoutMs (capped). Cleared
        // whether the step succeeds, fails, or the workflow is cancelled mid-step.
        let timeoutHandle: NodeJS.Timeout | undefined;
        if (typeof step.timeoutMs === 'number' && step.timeoutMs > 0) {
          timeoutHandle = setTimeout(() => {
            if (!controller.signal.aborted) {
              inflightCancelReasons.set(workflowId, 'timeout');
              controller.abort();
            }
          }, step.timeoutMs);
          // Don't keep event loop alive solely for this timer.
          timeoutHandle.unref?.();
        }

        try {
          const skill = (step.skill === 'echo' || step.skill === 'coding') ? step.skill : undefined;
          const result = await runIntent({
            text: step.text,
            skill,
            abortSignal: controller.signal,
          });

          // Accumulate step result in context_json.
          const prevCtx: Record<string, unknown> = wf.context_json ? JSON.parse(wf.context_json) : {};
          prevCtx[`step_${i}`] = { kind: 'coding', status: result.status, summary: summarizeResult(result) };
          updateWorkflow(workflowId, { context_json: JSON.stringify(prevCtx) });

          if (result.status === 'cancelled' || controller.signal.aborted) {
            applyAbortOutcome(workflowId, broadcast, i, step.timeoutMs);
            return;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          updateWorkflow(workflowId, { status: 'failed', error_message: msg });
          broadcast({ type: 'vessel_workflow_failed', workflowId, error: msg });
          return;
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }

      } else if (step.kind === 'hitl') {
        // Pause — broadcast event, persist state; HTTP /resume will call us again.
        updateWorkflow(workflowId, {
          status: 'paused',
          current_step: i,
          paused_reason: step.message,
          paused_options: step.options ? JSON.stringify(step.options) : null,
        });
        broadcast({
          type: 'vessel_workflow_paused',
          workflowId,
          step: i,
          message: step.message,
          options: step.options ?? ['approve', 'reject'],
        });
        return; // Stop here; /resume will call runWorkflowFromStep(id, i+1)
      }
    }

    // All steps completed.
    updateWorkflow(workflowId, { status: 'completed' });
    broadcast({ type: 'vessel_workflow_completed', workflowId });
  } finally {
    cleanup();
  }
}

/**
 * Apply DB + broadcast outcome when a workflow's controller has aborted.
 * timeout → status='failed' with descriptive error_message; user-cancel →
 * status='cancelled'.
 */
function applyAbortOutcome(
  workflowId: string,
  broadcast: BroadcastFn,
  stepIndex: number,
  timeoutMs?: number,
): void {
  const reason = inflightCancelReasons.get(workflowId);
  if (reason === 'timeout') {
    const msg = `step ${stepIndex} timed out after ${timeoutMs ?? '?'}ms`;
    updateWorkflow(workflowId, { status: 'failed', error_message: msg });
    broadcast({ type: 'vessel_workflow_failed', workflowId, error: msg });
  } else {
    // 'user' (explicit cancelWorkflow / external abort) — or unset, in which
    // case treat as user-cancel by default (less destructive than 'failed').
    updateWorkflow(workflowId, { status: 'cancelled' });
    broadcast({ type: 'vessel_workflow_cancelled', workflowId });
  }
}

function summarizeResult(result: Awaited<ReturnType<typeof runIntent>>): string {
  if (result.status === 'cancelled') return 'cancelled';
  if (result.status === 'success') {
    const art = result.artifact as Record<string, unknown> | null | undefined;
    if (Array.isArray(art?.['files']) && (art!['files'] as unknown[]).length > 0) {
      return `${(art!['files'] as unknown[]).length} file(s) written`;
    }
    if (art?.['stdoutPath']) return 'output written';
  }
  return result.status;
}
