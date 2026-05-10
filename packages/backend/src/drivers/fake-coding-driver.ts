/**
 * FakeCodingDriver — record/replay test fixture (no real CC subprocess).
 *
 * Used by integration tests + any unit test that wants to assert orchestrator
 * + CodingSkill + workspace iso behavior without paying the cost of spawning
 * a real `claude` CLI.
 *
 * Behavior:
 *   - submit() writes the prompt + a fixture artifact (1+ files) into spec.workspace
 *   - cancel() flips an inflight flag; if submit hasn't returned, it returns exitCode 130
 *   - health() always ok
 *
 * @see CodingDriver contract in ./types.ts
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import type { CodingDriver, CodingDriverSpec, CodingDriverArtifact } from './types.js';
import type { TraceContext } from '../observability/trace.js';

export interface FakeFixture {
  /** files to write under spec.workspace; relative path → content */
  files: Record<string, string>;
  /** simulated cli "messages" recorded for trace.stdout */
  messages?: unknown[];
  /** ms to delay before resolving (default 0) — useful for cancel tests */
  delayMs?: number;
}

export class FakeCodingDriver implements CodingDriver {
  private readonly inflight = new Map<string, AbortController>();
  constructor(private readonly fixture: FakeFixture = { files: {} }) {}

  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async submit(
    spec: CodingDriverSpec,
    ctx: { traceCtx: TraceContext; abortSignal: AbortSignal; onMessage?: (m: unknown) => void },
  ): Promise<CodingDriverArtifact> {
    // M1A-β: replay fixture messages (if any) through onMessage so tests can
    // assert WS/skill streaming behavior without a real CC subprocess.
    if (ctx.onMessage && this.fixture.messages) {
      for (const m of this.fixture.messages) {
        try { ctx.onMessage(m); } catch { /* ignore */ }
      }
    }
    // Workspace iso check (mirror real driver). We just realpath spec.workspace
    // to handle macOS /var ↔ /private/var; no further verification because
    // FakeCodingDriver is test-only — orchestrator already enforces the path.
    if (!existsSync(spec.workspace)) {
      mkdirSync(spec.workspace, { recursive: true, mode: 0o700 });
    }
    const wsReal = realpathSync(spec.workspace);

    const abortCtl = new AbortController();
    if (ctx.abortSignal.aborted) abortCtl.abort();
    const onAbort = (): void => abortCtl.abort();
    ctx.abortSignal.addEventListener('abort', onAbort);
    this.inflight.set(spec.runId, abortCtl);

    try {
      if (this.fixture.delayMs && this.fixture.delayMs > 0) {
        await new Promise<void>((res, rej) => {
          const t = setTimeout(res, this.fixture.delayMs);
          abortCtl.signal.addEventListener('abort', () => {
            clearTimeout(t);
            rej(new Error('cancelled'));
          });
        }).catch(() => { /* swallow — we'll report exitCode=130 below */ });
      }

      if (abortCtl.signal.aborted) {
        return { files: [], exitCode: 130, metadata: { cancelled: true, fake: true } };
      }

      const written: string[] = [];
      for (const [rel, content] of Object.entries(this.fixture.files)) {
        const p = join(wsReal, rel);
        const dir = p.substring(0, p.lastIndexOf(sep));
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(p, content);
        written.push(p);
      }

      return {
        files: written,
        exitCode: 0,
        metadata: {
          cancelled: false,
          fake: true,
          message_count: this.fixture.messages?.length ?? 0,
        },
      };
    } finally {
      ctx.abortSignal.removeEventListener('abort', onAbort);
      this.inflight.delete(spec.runId);
    }
  }

  async cancel(runId: string): Promise<void> {
    this.inflight.get(runId)?.abort();
  }
}
