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

import { hashString } from "@claude-web/aisep-core";
import type {
  StageExecutor,
  StageExecutorArgs,
  StageExecutorResult,
} from "@claude-web/aisep-core";
import type {
  AisepArtifact,
  AisepArtifactKind,
  AisepStage,
} from "@claude-web/aisep-protocol";

import type { PromptCompiler } from "./prompt-compiler.js";

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
}

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const KILL_GRACE_MS = 5_000;

export class ClaudeExecutor implements StageExecutor {
  constructor(
    private readonly compiler: PromptCompiler,
    private readonly opts: ClaudeExecutorOptions = {},
  ) {}

  async execute(args: StageExecutorArgs): Promise<StageExecutorResult> {
    const { promptText, promptHash, profile } = await this.compiler.render({
      stage: args.stage,
      phase: args.phase,
      upstreamArtifacts: args.upstreamArtifacts.map((a) => a.ref),
      memoryHits: args.memoryHits as never[],   // protocol type, opaque to core
    });

    // Persist rendered prompt for forensic replay (per .aisep/ convention).
    const taskPath = `.aisep/tmp/task-${args.stage}-${Date.now()}.md`;
    await args.workspace.writeFile(taskPath, promptText);

    const bin = this.opts.claudeBin ?? process.env.CLAUDE_CLI ?? "claude";
    const argv = [
      "--print",
      ...(this.opts.model ? ["--model", this.opts.model] : []),
      ...(this.opts.extraArgv ?? []),
    ];
    const startedAt = Date.now();

    const spawnResult = await spawnClaude({
      bin,
      argv,
      cwd: args.workspace.cwd,
      promptText,
      timeoutMs: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

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
            : spawnResult.stderr.slice(0, 500),
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
    const artifactKey = artifactKey_(args.stage, args.phase);

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

    function artifactKey_(stage: AisepStage, phase: string): string {
      if (stage === "architecture") {
        if (phase === "architecture-brief") return "architecture/brief.md";
        if (phase === "architecture-detail-slice") return "architecture/detail-slice.md";
        return "architecture/index.md";
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

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killGraceHandle = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }, opts.timeoutMs);

    const finalize = (exitCode: number) => {
      clearTimeout(timeoutHandle);
      if (killGraceHandle) clearTimeout(killGraceHandle);
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
