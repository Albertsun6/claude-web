// `aisep run [--workspace <path>] [--dry] [--stage <name>]`
//
// v0 stub: uses MockStageExecutor when --dry, otherwise refuses to run
// because aisep-agents (real executor) is not yet wired in.

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { ClaudeExecutor, PromptCompiler } from "@claude-web/aisep-agents";
import {
  AisepRunner,
  AisepStore,
  ids,
  type MemoryProvider,
  type StageExecutor,
} from "@claude-web/aisep-core";
import { AisepMemoryStore } from "@claude-web/aisep-memory";
import {
  AisepStagePhaseSchema,
  AisepStageSchema,
  type AisepStage,
  type AisepStagePhase,
} from "@claude-web/aisep-protocol";
import { NodeWorkspace } from "@claude-web/aisep-workspace";

import { MockStageExecutor } from "../mock-executor.js";

interface RunArgs {
  workspace: string;
  dry: boolean;
  real: boolean;
  model?: string;
  stage?: AisepStage;
  /** Comma-separated subset of stages, e.g. "intake,research,plan,architecture,contract". */
  stages?: AisepStage[];
  /** Explicit phase override; if omitted, architecture defaults to "architecture-brief". */
  phase?: AisepStagePhase;
}

/**
 * Default phase for a stage when user does not pass --phase.
 *
 * Architecture defaults to Phase A "architecture-brief" so the 7-question
 * anchor gate + 5-page hard limit prompts trigger automatically (Pilot-01
 * Issue #5).
 */
function defaultPhaseFor(stage: AisepStage): AisepStagePhase {
  if (stage === "architecture") return "architecture-brief";
  return "none";
}

export async function runCommand(rawArgs: string[]): Promise<number> {
  const args = parseRunArgs(rawArgs);
  if (!args) return 1;

  const cwd = resolve(args.workspace);
  mkdirSync(cwd, { recursive: true });

  const workspaceId = ids.workspace();
  const ws = new NodeWorkspace(cwd, {
    id: workspaceId,
    name: cwd.split("/").pop() ?? "workspace",
    cwd,
    status: "active",
    techStack: [],
    createdAt: Date.now(),
    shipCount: 0,
    adoptedPatterns: [],
  });

  if (!args.dry && !args.real) {
    console.error(
      "[aisep run] Pick a mode: --dry (MockStageExecutor) or --real (ClaudeExecutor).\n" +
        "      --real requires the `claude` CLI on PATH; tokens will be consumed.",
    );
    return 2;
  }

  const store = new AisepStore(cwd, workspaceId);
  const memory = new AisepMemoryStore(cwd);

  // R11: retrieve from `global-verified` tier only — never inject
  // workspace-pending content (low-trust, not yet human-verified) into a
  // prompt that drives autonomous agent behavior.
  const memoryProvider: MemoryProvider = {
    async retrieve(stage) {
      return memory.retrieve({ stage, tier: "global", limit: 5 });
    },
  };

  const executor: StageExecutor = args.real
    ? new ClaudeExecutor(new PromptCompiler(), { model: args.model })
    : new MockStageExecutor();
  const runner = new AisepRunner({
    store,
    workspace: ws,
    executor,
    memoryProvider,
  });

  const stages: AisepStage[] = args.stages
    ? args.stages
    : args.stage
    ? [args.stage]
    : (AisepStageSchema.options as AisepStage[]);

  const mode = args.real ? "real (ClaudeExecutor)" : "dry (MockStageExecutor)";
  console.log(`[aisep run] workspace=${cwd} mode=${mode} stages=${stages.join(",")}`);

  let lastRunId: string | undefined;
  for (const stage of stages) {
    const phase = args.phase ?? defaultPhaseFor(stage);
    const result = await runner.runStage({ stage, phase, predecessorId: lastRunId });
    console.log(
      `[aisep run] ${stage.padEnd(11)} (${phase.padEnd(28)}) → ${result.status}${
        result.status === "failed" ? " (stopping chain)" : ""
      }`,
    );
    if (result.status === "failed") return 3;
    lastRunId = result.id;
  }

  console.log("[aisep run] all stages succeeded.");
  return 0;
}

function parseRunArgs(rawArgs: string[]): RunArgs | undefined {
  const args: RunArgs = { workspace: process.cwd(), dry: false, real: false };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]!;
    if (arg === "--workspace" || arg === "-w") {
      args.workspace = rawArgs[++i] ?? args.workspace;
    } else if (arg === "--dry") {
      args.dry = true;
    } else if (arg === "--real") {
      args.real = true;
    } else if (arg === "--model") {
      args.model = rawArgs[++i];
    } else if (arg === "--phase") {
      const next = rawArgs[++i];
      const parsed = AisepStagePhaseSchema.safeParse(next);
      if (!parsed.success) {
        console.error(`[aisep run] Invalid phase: ${next ?? "<missing>"} (must be none | architecture-brief | architecture-detail-slice)`);
        return undefined;
      }
      args.phase = parsed.data;
    } else if (arg === "--stage" || arg === "-s") {
      const next = rawArgs[++i];
      const parsed = AisepStageSchema.safeParse(next);
      if (!parsed.success) {
        console.error(`[aisep run] Invalid stage: ${next ?? "<missing>"}`);
        return undefined;
      }
      args.stage = parsed.data;
    } else if (arg === "--stages") {
      const next = rawArgs[++i];
      if (!next) {
        console.error(`[aisep run] --stages requires a comma-separated list`);
        return undefined;
      }
      const parsedStages: AisepStage[] = [];
      for (const s of next.split(",").map((x) => x.trim()).filter(Boolean)) {
        const parsed = AisepStageSchema.safeParse(s);
        if (!parsed.success) {
          console.error(`[aisep run] Invalid stage in --stages: ${s}`);
          return undefined;
        }
        parsedStages.push(parsed.data);
      }
      args.stages = parsedStages;
    } else {
      console.error(`[aisep run] Unknown arg: ${arg}`);
      return undefined;
    }
  }
  return args;
}
