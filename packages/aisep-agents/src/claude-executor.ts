// ClaudeExecutor — real StageExecutor that spawns `claude --print`.
//
// CLAUDE.md hard constraints:
// - NEVER use @anthropic-ai/claude-agent-sdk (bills the API key)
// - NEVER use `claude --bare` (forces API key auth)
// - Always go through `claude --print` (uses user's subscription via OAuth)
//
// The executor passes the rendered prompt via stdin (avoids argv-escaping
// of special characters). stdout is captured as the agent reply and
// becomes an inline artifact.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import { hashString } from "@vessel/aisep-core";
import type {
  StageExecutor,
  StageExecutorArgs,
  StageExecutorResult,
} from "@vessel/aisep-core";
import type {
  AisepArtifact,
  AisepArtifactKind,
  AisepStage,
} from "@vessel/aisep-protocol";

import type {
  PromptCompiler,
  UpstreamArtifactWithContent,
} from "./prompt-compiler.js";

const DEFAULT_PER_ARTIFACT_BUDGET_BYTES = 4 * 1024;
const DEFAULT_TOTAL_ARTIFACTS_BUDGET_BYTES = 16 * 1024;

const STAGE_TO_ARTIFACT_KIND: Record<AisepStage, AisepArtifactKind> = {
  intake: "intake",
  research: "research",
  plan: "plan",
  architecture: "adr",
  contract: "contract_frozen",
  implement: "patch",
  verify: "verify_report",
  review: "review_verdict",
  integrate: "integration_log",
  retrospect: "retrospect",
};

export interface ClaudeExecutorOptions {
  /** Override CLI binary; default `process.env.CLAUDE_CLI ?? "claude"`. */
  claudeBin?: string;
  /** Process timeout per attempt. */
  timeoutMs?: number;
  /** Model alias passed to `claude --model`. Default Sonnet 4.6. */
  model?: string;
  /** Extra argv after `--print`. Default empty. */
  extraArgv?: string[];
  /**
   * Tools allowed via `claude --tools <list>`. Default: "Read" — claude can
   * read upstream artifacts from cwd but cannot Write / Edit / Bash, which
   * prevents the Pilot-01 Issue #1 duplicate-artifact problem (claude
   * writing its own .md alongside our stdout redirect).
   *
   * Use `"default"` to enable all tools, `""` to disable all tools.
   */
  toolsAllowed?: string;
}

const DEFAULT_TOOLS_ALLOWED = "Read";

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

// Per-attempt timeout for `claude --print` subprocess. Bumped from 5min to
// 10min in v0.3 (Pilot-10 finding 2026-05-13): real-business implement
// stage with multi-artifact upstream + full patch.diff render hits 5min
// hard wall before the model finishes. CLI exposes `--claude-timeout-ms`
// to ratchet up further per-run.
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 5_000;

// F6 (2026-05-13): Anthropic backend has an undocumented per-account burst
// limiter that throttles ~3-4 concurrent `claude --print` sessions started
// in quick succession (anthropics/claude-code#53922). When tripped, the
// CLI exits non-zero with stderr containing patterns below. AISEP detects
// these and retries with 30s / 60s / 120s backoff (max 3 retries, total
// max wait 3.5 min) before giving up.
//
// Patterns are matched against stderr (case-insensitive). Add new patterns
// here as Anthropic's wording evolves.
const BURST_LIMIT_PATTERNS: readonly RegExp[] = [
  /Server is temporarily limiting requests/i,
  /\bRate limited\b/i,
  /\b429\b/,
];

const BURST_RETRY_DELAYS_MS: readonly number[] = [30_000, 60_000, 120_000];

export function isBurstLimitError(stderr: string): boolean {
  return BURST_LIMIT_PATTERNS.some((re) => re.test(stderr));
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted during burst-limit backoff"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("aborted during burst-limit backoff"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class ClaudeExecutor implements StageExecutor {
  constructor(
    private readonly compiler: PromptCompiler,
    private readonly opts: ClaudeExecutorOptions = {},
  ) {}

  async execute(args: StageExecutorArgs): Promise<StageExecutorResult> {
    // Phase 2.C-3: pre-read upstream artifact content (with budget caps)
    // so the prompt is self-contained — does not rely on claude's Read tool.
    const upstreamArtifactsWithContent = await collectUpstreamContent(
      args.upstreamArtifacts,
      DEFAULT_PER_ARTIFACT_BUDGET_BYTES,
      DEFAULT_TOTAL_ARTIFACTS_BUDGET_BYTES,
    );

    const { promptText, promptHash, profile } = await this.compiler.render({
      stage: args.stage,
      phase: args.phase,
      upstreamArtifacts: args.upstreamArtifacts.map((a) => a.ref),
      upstreamArtifactsWithContent,
      memoryHits: args.memoryHits as never[],   // protocol type, opaque to core
      // v0.3 (v1 fan-out Stage 2.cli-B): flow subStageName to template
      // for fan-out children. Templates that reference {{subStageName}}
      // / {{isFanOutChild}} render appropriately.
      ...(args.subStageName !== undefined ? { subStageName: args.subStageName } : {}),
    });

    // Persist rendered prompt for forensic replay (per .aisep/ convention).
    // v0.3 (v1 fan-out Stage 2.cli-B): include subStageName in the temp
    // file name so concurrent fan-out children don't race on the same
    // file (timestamps alone aren't enough at ms resolution).
    const subNameTag = args.subStageName ? `-${args.subStageName}` : "";
    const taskPath = `.aisep/tmp/task-${args.stage}${subNameTag}-${Date.now()}.md`;
    await args.workspace.writeFile(taskPath, promptText);

    const bin = this.opts.claudeBin ?? process.env.CLAUDE_CLI ?? "claude";
    const toolsAllowed = this.opts.toolsAllowed ?? DEFAULT_TOOLS_ALLOWED;
    const argv = [
      "--print",
      "--tools",
      toolsAllowed,
      ...(this.opts.model ? ["--model", this.opts.model] : []),
      ...(this.opts.extraArgv ?? []),
    ];
    const startedAt = Date.now();

    // F6 (2026-05-13): wrap spawnClaude in burst-limit retry loop.
    // Anthropic backend throttles ~3-4 concurrent sessions
    // (anthropics/claude-code#53922). Retry transparently on detected
    // burst-limit errors; surface real failures (non-burst stderr or
    // timeouts) immediately.
    let spawnResult: SpawnResult;
    let burstRetries = 0;
    while (true) {
      spawnResult = await spawnClaude({
        bin,
        argv,
        cwd: args.workspace.cwd,
        promptText,
        timeoutMs: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        // v0.3 Stage 3.1: propagate sibling-failure cancel via AbortSignal
        // (passed by runner.runFanOutParent). Non-fan-out paths omit it.
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
      });
      // Success or hard timeout → don't retry. Timeouts are a different
      // failure mode and should be visible to the runner / user.
      if (spawnResult.exitCode === 0 || spawnResult.timedOut) break;
      // Non-burst failure → surface immediately (compile error / model
      // refusal / etc.).
      if (!isBurstLimitError(spawnResult.stderr)) break;
      // Out of retries → give up.
      if (burstRetries >= BURST_RETRY_DELAYS_MS.length) break;
      const delayMs = BURST_RETRY_DELAYS_MS[burstRetries]!;
      console.warn(
        `[aisep claude-executor] burst limit detected on stage="${args.stage}"` +
          (args.subStageName ? ` subStage="${args.subStageName}"` : "") +
          `; retry ${burstRetries + 1}/${BURST_RETRY_DELAYS_MS.length} after ${delayMs}ms backoff`,
      );
      try {
        await sleepAbortable(delayMs, args.signal);
      } catch {
        // Aborted mid-backoff (parent fan-out abort) — stop retrying;
        // the last spawnResult stays as our final result, runner sees it
        // as "failed" and routes accordingly.
        break;
      }
      burstRetries += 1;
    }

    const endedAt = Date.now();
    const ok = spawnResult.exitCode === 0 && !spawnResult.timedOut;

    if (!ok) {
      return {
        producedArtifacts: [],
        attempt: {
          invocation: {
            provider: "claude-cli",
            model: this.opts.model ?? "default",
            argv,
            cwd: args.workspace.cwd,
            rawCmd: `${bin} ${argv.join(" ")}`,
            promptHash,
          },
          reviewState: "draft",
          outputArtifactIds: [],
          status: spawnResult.timedOut ? "timeout" : "failed",
          exitCode: spawnResult.exitCode,
          error: spawnResult.timedOut
            ? `claude --print timed out after ${this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`
            : (burstRetries > 0
                ? `[burst-limited, ${burstRetries} retries exhausted] `
                : "") + spawnResult.stderr.slice(0, 500),
          startedAt,
          endedAt,
        },
        ok: false,
      };
    }

    // Stage output is captured as an inline artifact. Future iterations
    // (Phase 2.5+) will parse stage-specific structures (e.g. extract
    // diff fences from coder output → write to workspace/patch/).
    const stdoutTrimmed = spawnResult.stdout.trim();
    const artifactKind = STAGE_TO_ARTIFACT_KIND[args.stage];
    const artifactKey = artifactKey_(args.stage, args.phase, args.subStageName);

    // Persist to workspace as a file too (so downstream stages can read it).
    await args.workspace.writeFile(artifactKey, stdoutTrimmed);

    const producedArtifact = {
      workspaceId: args.workspace.meta.id,
      stageRunId: "",
      ref: { kind: artifactKind, key: artifactKey },
      contentHash: hashString(stdoutTrimmed),
      storage: "file",
      contentUri: `file://${args.workspace.cwd}/${artifactKey}`,
      sizeBytes: Buffer.byteLength(stdoutTrimmed, "utf-8"),
    } as Omit<AisepArtifact, "id" | "producedAt">;

    return {
      producedArtifacts: [producedArtifact],
      attempt: {
        invocation: {
          provider: "claude-cli",
          model: this.opts.model ?? "default",
          argv,
          cwd: args.workspace.cwd,
          rawCmd: `${bin} ${argv.join(" ")}`,
          promptHash,
        },
        reviewState: "draft",
        outputArtifactIds: [],
        status: "succeeded",
        exitCode: 0,
        startedAt,
        endedAt,
      },
      ok: true,
    };

    function artifactKey_(stage: AisepStage, phase: string, subName?: string): string {
      if (stage === "architecture") {
        if (phase === "architecture-brief") return "architecture/brief.md";
        if (phase === "architecture-detail-slice") return "architecture/detail-slice.md";
        return "architecture/index.md";
      }
      // v0.3 (v1 fan-out Stage 2.cli-B): fan-out child writes to
      // `<stage>-<subName>.md` so siblings don't clobber each other +
      // the parent's patch_set manifest can reference each child by name.
      if (subName !== undefined) {
        return `${stage}-${subName}.md`;
      }
      // profile not used directly in path, but kept here in case future stages
      // need profile-aware naming
      void profile;
      return `${stage}.md`;
    }
  }
}

/**
 * Spawn `claude --print` with prompt fed via stdin.
 *
 * Returns full stdout + stderr + timedOut contract (per workspace.exec spec).
 */
function spawnClaude(opts: {
  bin: string;
  argv: string[];
  cwd: string;
  promptText: string;
  timeoutMs: number;
  /** v0.3 Stage 3.1: cancel via SIGTERM → 5s → SIGKILL on abort. */
  signal?: AbortSignal;
}): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(opts.bin, opts.argv, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killGraceHandle: NodeJS.Timeout | undefined;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    const initiateKill = (markTimedOut: boolean) => {
      if (markTimedOut) timedOut = true;
      child.kill("SIGTERM");
      killGraceHandle = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    };

    const timeoutHandle = setTimeout(() => initiateKill(true), opts.timeoutMs);

    // v0.3 Stage 3.1: AbortSignal-driven cancel for sibling-failure
    // propagation (per arbitration A.F7). timedOut stays false on
    // abort-kill (timedOut is reserved for timeoutMs-driven kills).
    const onAbort = () => initiateKill(false);
    if (opts.signal) {
      if (opts.signal.aborted) initiateKill(false);
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    const finalize = (exitCode: number) => {
      clearTimeout(timeoutHandle);
      if (killGraceHandle) clearTimeout(killGraceHandle);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    };

    child.on("close", (code) => finalize(code ?? -1));
    child.on("error", (err) => {
      stderr += `\n${(err as Error).message}`;
      finalize(-1);
    });

    // Feed prompt via stdin (avoid argv escaping).
    child.stdin?.end(opts.promptText, "utf-8");
  });
}

/**
 * Read upstream artifact contents from disk and apply budget caps.
 * Each artifact is truncated to `perArtifactBudget`; the total bytes
 * accumulated across all artifacts is capped at `totalBudget` (later
 * artifacts are dropped if the total budget is exhausted).
 *
 * Truncation strips bytes off the END (preserves the document opening
 * which usually carries the most important context: title, summary,
 * problem statement, table of contents).
 */
async function collectUpstreamContent(
  artifacts: AisepArtifact[],
  perArtifactBudget: number,
  totalBudget: number,
): Promise<UpstreamArtifactWithContent[]> {
  const out: UpstreamArtifactWithContent[] = [];
  let totalUsed = 0;

  for (const a of artifacts) {
    if (totalUsed >= totalBudget) {
      out.push({
        ref: a.ref,
        contentPreview: "(skipped: total upstream content budget exhausted)",
        truncated: true,
        truncatedBytes: a.sizeBytes,
      });
      continue;
    }

    const remainingTotal = totalBudget - totalUsed;
    const cap = Math.min(perArtifactBudget, remainingTotal);

    let fullContent = "";
    if (a.storage === "file") {
      // contentUri = "file://<absolute path>"
      const path = a.contentUri.startsWith("file://")
        ? a.contentUri.slice("file://".length)
        : a.contentUri;
      try {
        fullContent = await readFile(path, "utf-8");
      } catch (err) {
        fullContent = `(failed to read ${path}: ${(err as Error).message})`;
      }
    } else {
      // inline storage
      fullContent = a.contentInline ?? "";
    }

    const bytes = Buffer.byteLength(fullContent, "utf-8");
    let preview = fullContent;
    let truncated = false;
    let truncatedBytes = 0;
    if (bytes > cap) {
      // Truncate to `cap` bytes (UTF-8 safe: byte-truncate may split a
      // multibyte sequence — slice by character to stay safe).
      preview = sliceByByteBudget(fullContent, cap);
      truncated = true;
      truncatedBytes = bytes - Buffer.byteLength(preview, "utf-8");
    }

    out.push({ ref: a.ref, contentPreview: preview, truncated, truncatedBytes });
    totalUsed += Buffer.byteLength(preview, "utf-8");
  }

  return out;
}

/** UTF-8-safe truncation: take chars until accumulated byteLength ≤ budget. */
function sliceByByteBudget(text: string, budgetBytes: number): string {
  let acc = "";
  let used = 0;
  for (const ch of text) {
    const chBytes = Buffer.byteLength(ch, "utf-8");
    if (used + chBytes > budgetBytes) break;
    acc += ch;
    used += chBytes;
  }
  return acc;
}
