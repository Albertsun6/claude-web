// `aisep run [--workspace <path>] [--dry] [--stage <name>]`
//
// v0 stub: uses MockStageExecutor when --dry, otherwise refuses to run
// because aisep-agents (real executor) is not yet wired in.

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { AisepRunner, AisepStore, ids } from "@claude-web/aisep-core";
import { AisepStageSchema, type AisepStage } from "@claude-web/aisep-protocol";
import { NodeWorkspace } from "@claude-web/aisep-workspace";

import { MockStageExecutor } from "../mock-executor.js";

interface RunArgs {
  workspace: string;
  dry: boolean;
  stage?: AisepStage;
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

  if (!args.dry) {
    console.error(
      "[aisep run] Non-dry runs require @claude-web/aisep-agents (Phase 2.5).\n" +
        "       For now, pass --dry to run the 10-stage chain with MockStageExecutor.",
    );
    return 2;
  }

  const store = new AisepStore(cwd, workspaceId);
  const executor = new MockStageExecutor();
  const runner = new AisepRunner({ store, workspace: ws, executor });

  const stages: AisepStage[] = args.stage
    ? [args.stage]
    : (AisepStageSchema.options as AisepStage[]);

  console.log(`[aisep run] workspace=${cwd} dry=true stages=${stages.join(",")}`);

  let lastRunId: string | undefined;
  for (const stage of stages) {
    const result = await runner.runStage({ stage, predecessorId: lastRunId });
    console.log(
      `[aisep run] ${stage.padEnd(11)} → ${result.status}${
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
  const args: RunArgs = { workspace: process.cwd(), dry: false };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]!;
    if (arg === "--workspace" || arg === "-w") {
      args.workspace = rawArgs[++i] ?? args.workspace;
    } else if (arg === "--dry") {
      args.dry = true;
    } else if (arg === "--stage" || arg === "-s") {
      const next = rawArgs[++i];
      const parsed = AisepStageSchema.safeParse(next);
      if (!parsed.success) {
        console.error(`[aisep run] Invalid stage: ${next ?? "<missing>"}`);
        return undefined;
      }
      args.stage = parsed.data;
    } else {
      console.error(`[aisep run] Unknown arg: ${arg}`);
      return undefined;
    }
  }
  return args;
}
