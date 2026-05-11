/**
 * M0 minimal TraceWriter implementation (FRAMEWORK §5).
 *
 * Writes JSON one-file-per-event under <DATA_DIR>/traces/<trace_id>/<span_id>.json (mode 0600).
 * No OTEL SDK; OTEL hex format trace_id (32 hex) / span_id (16 hex).
 *
 * **v0A.1 risk-officer M-R2 reminder**：当前实现 NOT yet do redaction. M0 acceptance
 * doesn't require redaction yet, but trace.ts comment marks this as M0+ TODO.
 *
 * @see interfaces ../observability/trace.ts (TraceWriter contract + ENV_KEYS)
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from '../data-dir.js';
import type { TraceContext, TraceEvent, TraceWriter } from './trace.js';
import { TraceEventSchema } from './trace.js';
import { redactPayload, payloadFitsInline, payloadSummary } from './trace-redactor.js';

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function newTraceId(): string { return hex(16); }   // 32 hex
export function newSpanId(): string  { return hex(8);  }   // 16 hex

export function newRootContext(args: { conversationId: string; runId: string }): TraceContext {
  return {
    trace_id: newTraceId(),
    span_id: newSpanId(),
    parent_span_id: null,
    trace_flags: 1,
    conversation_id: args.conversationId,
    run_id: args.runId,
  };
}

class FileTraceWriter implements TraceWriter {
  constructor(
    private readonly current: TraceContext,
    private readonly sink?: (event: TraceEvent) => void,
  ) {}

  async write(event: TraceEvent): Promise<void> {
    const dir = join(DATA_DIR, 'traces', event.trace_id);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

    // Redaction (trace-redaction-spec §3 §4) — applied at write entry, not by caller.
    let redactedPayload = redactPayload(event.payload) as TraceEvent['payload'];
    let artifactRefs = event.artifact_refs ? [...event.artifact_refs] : undefined;

    // 4 KiB spillover (§5): if redacted payload is too big, write full JSON to
    // <span_id>.stdout (mode 0600) and inline only a 200-char summary.
    if (!payloadFitsInline(redactedPayload)) {
      const spillFile = join(dir, `${event.span_id}.stdout`);
      writeFileSync(spillFile, JSON.stringify(redactedPayload), { mode: 0o600 });
      artifactRefs = [...(artifactRefs ?? []), spillFile];
      redactedPayload = { summary: payloadSummary(redactedPayload) };
    }

    // M1A-β review BLOCKER R-M1Aβ-2: relativize artifact_refs absolute paths so
    // every safeEvent — both the on-disk JSON and any sink consumers (WS) —
    // sees `$VESSEL_DATA_DIR/...` instead of `/Users/<name>/.vessel/...`. M1A-α
    // had the same fix in /api/vessel/traces/<id>; centralizing here closes the
    // WS bypass.
    if (artifactRefs) {
      artifactRefs = artifactRefs.map((p) =>
        typeof p === 'string' && p.startsWith(DATA_DIR + '/')
          ? '$VESSEL_DATA_DIR/' + p.slice(DATA_DIR.length + 1)
          : p,
      );
    }

    const safeEvent: TraceEvent = {
      ...event,
      payload: redactedPayload,
      artifact_refs: artifactRefs,
    };

    // Validate AFTER redaction — caller-supplied payload may exceed 4KB raw, but
    // the redacted/spilled form must conform to schema.
    TraceEventSchema.parse(safeEvent);

    const file = join(dir, `${event.span_id}.json`);
    writeFileSync(file, JSON.stringify(safeEvent, null, 2), { mode: 0o600 });

    // M1A-β: forward post-redaction event to optional sink (e.g. WS push). Same
    // safe form clients see via GET /api/vessel/traces/:id, so live stream and
    // replay are byte-identical.
    if (this.sink) {
      try { this.sink(safeEvent); } catch { /* sink errors must not fail trace write */ }
    }
  }

  childSpan(component: string): TraceContext {
    return {
      trace_id: this.current.trace_id,
      span_id: newSpanId(),
      parent_span_id: this.current.span_id,
      trace_flags: this.current.trace_flags,
      conversation_id: this.current.conversation_id,
      run_id: this.current.run_id,
    };
  }
}

export function makeTraceWriter(
  ctx: TraceContext,
  options?: { sink?: (event: TraceEvent) => void },
): TraceWriter {
  return new FileTraceWriter(ctx, options?.sink);
}
