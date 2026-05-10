/**
 * workflow-store — CRUD for workflow_state table in memory.db.
 *
 * @see migrations-memory/0003_m1c_workflows.sql
 * @see docs/reviews/M1C-A-workflow-b-level-architect-2026-05-10-1830.md
 */

import { randomUUID } from 'node:crypto';
import { openMemoryDb } from './session-store.js';

export type WorkflowStatus =
  | 'pending' | 'running' | 'paused' | 'interrupted'
  | 'completed' | 'failed' | 'cancelled';

export type WorkflowStep =
  | { kind: 'coding'; text: string; skill?: string; timeoutMs?: number }
  | { kind: 'hitl'; message: string; options?: string[] };

/** Per-step timeout cap — 30 minutes. Steps that need longer should be split. */
export const MAX_STEP_TIMEOUT_MS = 30 * 60 * 1000;

export interface WorkflowInput {
  kind?: string;
  steps: WorkflowStep[];
}

export interface WorkflowRow {
  id: string;
  kind: string;
  status: WorkflowStatus;
  current_step: number;
  total_steps: number;
  steps_json: string;
  context_json: string | null;
  paused_reason: string | null;
  paused_options: string | null;
  chosen_option: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function createWorkflow(input: WorkflowInput): WorkflowRow {
  const db = openMemoryDb();
  const id = randomUUID();
  const stepsJson = JSON.stringify(input.steps);
  db.prepare(`
    INSERT INTO workflow_state (id, kind, status, current_step, total_steps, steps_json)
    VALUES (@id, @kind, 'pending', 0, @total, @steps)
  `).run({ id, kind: input.kind ?? 'multi_step', total: input.steps.length, steps: stepsJson });
  return getWorkflow(id)!;
}

export function getWorkflow(id: string): WorkflowRow | undefined {
  const db = openMemoryDb();
  return db.prepare('SELECT * FROM workflow_state WHERE id = ?').get(id) as WorkflowRow | undefined;
}

export function listWorkflows(filter?: { status?: WorkflowStatus | 'all'; limit?: number }): WorkflowRow[] {
  const db = openMemoryDb();
  const limit = Math.min(filter?.limit ?? 50, 200);
  const status = filter?.status;
  if (!status || status === 'all') {
    return db.prepare('SELECT * FROM workflow_state ORDER BY created_at DESC LIMIT ?').all(limit) as WorkflowRow[];
  }
  return db.prepare('SELECT * FROM workflow_state WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit) as WorkflowRow[];
}

export function updateWorkflow(id: string, updates: {
  status?: WorkflowStatus;
  current_step?: number;
  context_json?: string | null;
  paused_reason?: string | null;
  paused_options?: string | null;
  chosen_option?: string | null;
  error_message?: string | null;
}): WorkflowRow | undefined {
  const db = openMemoryDb();
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const params: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) { sets.push(`${k} = @${k}`); params[k] = v; }
  }
  db.prepare(`UPDATE workflow_state SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getWorkflow(id);
}

/** Mark running workflows as interrupted on server restart. */
export function markInterruptedOnStartup(): number {
  const db = openMemoryDb();
  const result = db.prepare(
    "UPDATE workflow_state SET status = 'interrupted', updated_at = datetime('now') WHERE status = 'running'"
  ).run();
  return result.changes;
}
