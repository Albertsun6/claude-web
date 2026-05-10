/**
 * Orchestrator — M0 / M0.5 Intent dispatcher (FRAMEWORK §2.1).
 *
 * Loop:
 *   1. bootSession(sessionId)
 *   2. trace.write(intent.received)
 *   3. memory.writeIntent
 *   4. resolveSkill(intent.text) → invoke(skill, ctx)
 *   5. trace.write(skill.completed)
 *   6. memory.writeSkillInvocation
 *   7. return AgentResult discriminated union
 *
 * Out of scope (M0/M0.5): MCP / Workflow / Soul / Voice (per ROADMAP).
 *
 * Skill registry (M0.5):
 *   - 'echo' (default for `echo <text>` prefix; M0 reference)
 *   - 'coding' (default for non-echo intents; ADR-016 path C → cli-runner adapter)
 *
 * @see FRAMEWORK §2.1 + interfaces/agent.ts (AgentResult)
 */

import { randomUUID } from 'node:crypto';
import type { AgentResult } from './interfaces/agent.js';
import type { Skill } from './interfaces/skill.js';
import type { TraceContext, TraceEvent } from './observability/trace.js';
import { makeTraceWriter, newRootContext } from './observability/trace-writer.js';
import {
  bootSession,
  writeIntent,
  writeSkillInvocation,
} from './memory/session-store.js';
import { EchoSkill } from './skills/echo.js';
import { makeCodingSkill } from './skills/coding.js';
import { ClaudeCodeDriver } from './drivers/cli-runner-driver.js';
import { workspaceFor } from './drivers/cli-runner-driver.js';
import type { CodingDriver } from './drivers/types.js';

export interface IntentInput {
  text: string;
  sessionId?: string;
  /** Explicit skill choice; default = coding (M0.5). */
  skill?: 'echo' | 'coding';
  /** Optional override (tests inject FakeCodingDriver) */
  codingDriver?: CodingDriver;
  /** External cancellation (e.g., from CLI SIGINT handler) */
  abortSignal?: AbortSignal;
  /**
   * M1A-β: streaming hooks. WS handler subscribes to push events live;
   * HTTP handler leaves them undefined (sync return preserved).
   * onTraceEvent fires AFTER FileTraceWriter.write — event is already redacted.
   * onSkillMessage fires for each CC stream-json line (already redacted by driver).
   */
  onTraceEvent?: (event: TraceEvent) => void;
  onSkillMessage?: (message: unknown) => void;
}

function resolveSkill(
  input: IntentInput,
  driver: CodingDriver,
): { id: 'echo' | 'coding'; skill: Skill } {
  // Explicit override wins (CLI --skill=echo|coding). Otherwise the default
  // coding skill handles every intent — echo is opt-in only, so plain prompts
  // like `echo this homework` go to the coder, not get short-circuited.
  if (input.skill === 'echo') return { id: 'echo', skill: EchoSkill };
  if (input.skill === 'coding') return { id: 'coding', skill: makeCodingSkill(driver) };
  return { id: 'coding', skill: makeCodingSkill(driver) };
}

function buildIntentForSkill(skillId: 'echo' | 'coding', input: IntentInput, runId: string): unknown {
  if (skillId === 'echo') return { text: input.text };
  return { text: input.text, runId };
}

export async function runIntent(input: IntentInput): Promise<AgentResult> {
  const session = bootSession(input.sessionId);
  const runId = randomUUID();
  const rootCtx: TraceContext = newRootContext({ conversationId: session.id, runId });
  const trace = makeTraceWriter(rootCtx, {
    sink: input.onTraceEvent,
  });

  const nowIso = (): string => new Date().toISOString();

  // 1. intent.received
  const intentId = writeIntent({
    sessionId: session.id,
    traceId: rootCtx.trace_id,
    text: input.text,
  });
  await trace.write(makeEvent({
    ctx: rootCtx,
    event_type: 'intent.received',
    component: 'orchestrator',
    session_id: session.id,
    run_id: runId,
    status: 'success',
    payload: { intent_id: intentId, text_len: input.text.length },
    timestamp: nowIso(),
  }));

  // 2. dispatch — M0.5 echo or coding by prefix heuristic.
  // OTEL convention: one span = one finalized record (skill.completed carries duration).
  const driver = input.codingDriver ?? new ClaudeCodeDriver();
  const { id: skillId, skill } = resolveSkill(input, driver);
  const skillCtx = trace.childSpan(`skill:${skill.id}`);
  const workspaceDir = skillId === 'coding' ? workspaceFor(runId) : '';
  const abortSignal = input.abortSignal ?? new AbortController().signal;
  const t0 = Date.now();

  try {
    const artifact = await skill.invoke(
      buildIntentForSkill(skillId, input, runId),
      {
        traceCtx: skillCtx,
        tools: { get: () => null },          // M0.5 无 Tool（M1B+ 接 MCP）
        memory: {} as never,                 // M0.5 不接 Memory full surface（M1C+）
        workspaceDir,
        abortSignal,
        onProgress: input.onSkillMessage,    // M1A-β: WS push hook
      },
    );

    // Driver may report cancellation inside the artifact (CodingDriver:
    // metadata.cancelled === true, exitCode 130) — surface that as a distinct
    // status so traces and AgentResult reflect it.
    const cancelled = (artifact as { cancelled?: boolean })?.cancelled === true
      || abortSignal.aborted;
    const finalStatus: 'success' | 'cancelled' = cancelled ? 'cancelled' : 'success';

    await trace.write(makeEvent({
      ctx: skillCtx,
      event_type: 'skill.completed',
      component: `skill:${skill.id}`,
      session_id: session.id,
      run_id: runId,
      status: finalStatus,
      duration_ms: Date.now() - t0,
      payload: { artifact_kind: (artifact as { kind?: string })?.kind ?? 'unknown' },
      timestamp: nowIso(),
    }));

    writeSkillInvocation({
      runId,
      sessionId: session.id,
      intentId,
      traceId: skillCtx.trace_id,
      spanId: skillCtx.span_id,
      skillId: skill.id,
      status: finalStatus,
      artifact,
    });

    if (cancelled) {
      return { status: 'cancelled', reason: 'abort signal fired' };
    }
    return { status: 'success', artifact };
  } catch (err) {
    const error = {
      type: err instanceof Error ? err.constructor.name : 'UnknownError',
      message: err instanceof Error ? err.message : String(err),
    };

    await trace.write(makeEvent({
      ctx: skillCtx,
      event_type: 'skill.completed',
      component: `skill:${skill.id}`,
      session_id: session.id,
      run_id: runId,
      status: 'error',
      duration_ms: Date.now() - t0,
      error,
      timestamp: nowIso(),
    }));

    writeSkillInvocation({
      runId,
      sessionId: session.id,
      intentId,
      traceId: skillCtx.trace_id,
      spanId: skillCtx.span_id,
      skillId: skill.id,
      status: 'error',
      error,
    });

    return { status: 'failed', error };
  }
}

function makeEvent(args: {
  ctx: TraceContext;
  event_type: TraceEvent['event_type'];
  component: string;
  session_id: string;
  run_id: string;
  status: TraceEvent['status'];
  duration_ms?: number;
  payload?: Record<string, unknown>;
  error?: { type: string; message: string };
  timestamp: string;
}): TraceEvent {
  const evt: TraceEvent = {
    trace_id: args.ctx.trace_id,
    span_id: args.ctx.span_id,
    parent_span_id: args.ctx.parent_span_id,
    event_type: args.event_type,
    timestamp: args.timestamp,
    component: args.component,
    session_id: args.session_id,
    run_id: args.run_id,
    status: args.status,
    duration_ms: args.duration_ms ?? null,
    payload: args.payload,
    error: args.error ?? null,
  };
  return evt;
}
