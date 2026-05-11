/**
 * ClaudeCodeDriver — CodingDriver adapter wrapping Eva cli-runner.ts.
 *
 * Per ADR-016 path C: cli-runner.ts internals stay; this module exposes the
 * Vessel CodingDriver contract on top.
 *
 * Behaviors added on top of cli-runner:
 *   - Workspace isolation: enforce spec.workspace under instance/workspace/<runId>/
 *     and verify (realpath) it doesn't escape via symlink.
 *   - Process group cancel: cli-runner spawned with `detached: true`; cancel()
 *     fires AbortController which cli-runner translates to `process.kill(-pgid, ...)`.
 *   - File capture: walk workspace before/after to compute artifact.files diff.
 *   - stdout capture: stream-json messages saved to <DATA_DIR>/traces/<trace_id>/<span_id>.stdout
 *     (mode 0600, oversized payloads spilled there per trace-redaction-spec §5).
 *
 * Out of scope (M0.5):
 *   - Soul prompt injection (M2-Soul will populate systemPromptPrefix)
 *   - MCP wiring (M1B)
 *   - Web/iOS routing (M1A / M2-iOS)
 *
 * @see ADR-016 Coding Driver Interface
 */

import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type {
  CodingDriver,
  CodingDriverArtifact,
  CodingDriverSpec,
} from './types.js';
import type { TraceContext } from '../observability/trace.js';
import { runSession } from '../cli-runner.js';
import { DATA_DIR } from '../data-dir.js';
import { redactPayload } from '../observability/trace-redactor.js';
import type { ModelId } from '@vessel/shared';

function mapModel(short: 'opus' | 'sonnet' | 'haiku'): ModelId {
  switch (short) {
    case 'opus':   return 'claude-opus-4-7';
    case 'sonnet': return 'claude-sonnet-4-6';
    case 'haiku':  return 'claude-haiku-4-5';
  }
}

interface InflightRun {
  abortCtl: AbortController;
}

export class ClaudeCodeDriver implements CodingDriver {
  private readonly inflight = new Map<string, InflightRun>();

  async health(): Promise<{ ok: boolean; reason?: string }> {
    const cli = process.env.CLAUDE_CLI ?? 'claude';
    if (!cli) return { ok: false, reason: 'CLAUDE_CLI not set' };
    return { ok: true };
  }

  async submit(
    spec: CodingDriverSpec,
    ctx: { traceCtx: TraceContext; abortSignal: AbortSignal; onMessage?: (m: unknown) => void },
  ): Promise<CodingDriverArtifact> {
    // Workspace isolation: realpath check against instance/workspace/<runId>/
    const workspaceRoot = resolveWorkspaceRoot();
    if (!existsSync(workspaceRoot)) mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });

    const expected = join(workspaceRoot, spec.runId);
    if (!existsSync(expected)) mkdirSync(expected, { recursive: true, mode: 0o700 });

    const wsReal = realpathSync(expected);
    const rootReal = realpathSync(workspaceRoot);
    if (!wsReal.startsWith(rootReal + sep) && wsReal !== rootReal) {
      throw new Error(`workspace escape: ${wsReal} not under ${rootReal}`);
    }
    // Reject if caller passed a workspace path whose realpath disagrees with the
    // expected runId-pinned location. realpath-vs-realpath comparison handles
    // macOS /var ↔ /private/var symlinks correctly.
    if (realpathSync(spec.workspace) !== wsReal) {
      throw new Error(
        `spec.workspace realpath must equal ${wsReal} (got ${spec.workspace}); CodingDriver enforces isolation`,
      );
    }

    // Snapshot pre-existing files so we can diff for artifact list.
    const filesBefore = walk(wsReal);

    // Wire cancel → AbortController → cli-runner detached process group kill.
    const abortCtl = new AbortController();
    const onParentAbort = (): void => abortCtl.abort();
    if (ctx.abortSignal.aborted) abortCtl.abort();
    else ctx.abortSignal.addEventListener('abort', onParentAbort);
    this.inflight.set(spec.runId, { abortCtl });

    // stdout capture target (per trace-redaction-spec §5: file mode 0600).
    const traceDir = join(DATA_DIR, 'traces', ctx.traceCtx.trace_id);
    if (!existsSync(traceDir)) mkdirSync(traceDir, { recursive: true, mode: 0o700 });
    const stdoutPath = join(traceDir, `${ctx.traceCtx.span_id}.stdout`);
    const stdoutLines: string[] = [];

    let exitCode = 0;
    let runError: Error | null = null;
    try {
      const prompt = spec.systemPromptPrefix
        ? `${spec.systemPromptPrefix}\n\n${spec.prompt}`
        : spec.prompt;

      await runSession({
        prompt,
        cwd: wsReal,
        model: mapModel(spec.model ?? 'sonnet'),
        // M0.5: bypassPermissions so the CLI doesn't try to call a permission router
        // that hasn't been wired into the standalone vessel-core CLI (M1B will replace).
        permissionMode: spec.permissionMode ?? 'bypassPermissions',
        signal: abortCtl.signal,
        detached: true,
        onMessage: (msg: unknown) => {
          stdoutLines.push(JSON.stringify(msg));
          // M1A-β: forward redacted CC stream-json line to caller (WS sink etc.).
          // Use same per-line redaction as on-disk stdout so live and replay match.
          if (ctx.onMessage) {
            try { ctx.onMessage(redactPayload(msg)); } catch { /* sink errors must not fail run */ }
          }
        },
      });
    } catch (err) {
      runError = err instanceof Error ? err : new Error(String(err));
      exitCode = 1;
    } finally {
      ctx.abortSignal.removeEventListener('abort', onParentAbort);
      this.inflight.delete(spec.runId);
    }

    // Persist stdout (mode 0600). Even on error: capture for debugging.
    // **Crucial**: stream-json from CC contains user prompt / cwd / tool args, all
    // of which must pass through trace-redactor before landing on disk
    // (trace-redaction-spec §3 §4 — same rules as inline payload).
    if (stdoutLines.length > 0) {
      const redacted = stdoutLines.map((line) => {
        try {
          return JSON.stringify(redactPayload(JSON.parse(line)));
        } catch {
          return JSON.stringify({ unparseable_line_redacted: true });
        }
      });
      writeFileSync(stdoutPath, redacted.join('\n') + '\n', { mode: 0o600 });
    }

    if (abortCtl.signal.aborted && exitCode === 0) {
      exitCode = 130;
    }

    if (runError && !abortCtl.signal.aborted) {
      // Non-cancellation error: re-throw so Skill records driver.exited status=error.
      throw runError;
    }

    const filesAfter = walk(wsReal);
    const changedFiles: string[] = [];
    for (const [path, stamp] of filesAfter) {
      if (filesBefore.get(path) !== stamp) changedFiles.push(path);
    }

    return {
      files: changedFiles,
      exitCode,
      stdoutPath: stdoutLines.length > 0 ? stdoutPath : undefined,
      metadata: {
        cancelled: abortCtl.signal.aborted,
        message_count: stdoutLines.length,
      },
    };
  }

  async cancel(runId: string): Promise<void> {
    const r = this.inflight.get(runId);
    if (!r) return;
    r.abortCtl.abort();
  }
}

function resolveWorkspaceRoot(): string {
  return join(DATA_DIR, 'workspace');
}

function walk(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const p = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (entry.isFile()) {
        try {
          const st = statSync(p);
          out.set(p, `${st.size}:${st.mtimeMs}`);
        } catch { /* ignore */ }
      }
    }
  }
  return out;
}

export function workspaceFor(runId: string): string {
  return join(resolveWorkspaceRoot(), runId);
}
