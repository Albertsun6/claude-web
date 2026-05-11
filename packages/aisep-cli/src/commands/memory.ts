// `aisep memory <show|stats|promote|retrieve> ...`

import { resolve } from "node:path";

import { AisepMemoryStore } from "@claude-web/aisep-memory";
import { AisepStageSchema, type AisepStage } from "@claude-web/aisep-protocol";

interface MemoryGlobalArgs {
  workspace: string;
}

export async function memoryCommand(rawArgs: string[]): Promise<number> {
  const [sub, ...rest] = rawArgs;
  switch (sub) {
    case "show":
      return memoryShow(rest);
    case "stats":
      return memoryStats(rest);
    case "promote":
      return memoryPromote(rest);
    case "retrieve":
      return memoryRetrieve(rest);
    default:
      console.error(
        "[aisep memory] Usage: aisep memory <show|stats|promote|retrieve> [...args]",
      );
      return 1;
  }
}

function parseGlobalArgs(rawArgs: string[]): { args: MemoryGlobalArgs; rest: string[] } {
  const args: MemoryGlobalArgs = { workspace: process.cwd() };
  const rest: string[] = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]!;
    if (arg === "--workspace" || arg === "-w") {
      args.workspace = rawArgs[++i] ?? args.workspace;
    } else {
      rest.push(arg);
    }
  }
  return { args, rest };
}

function buildStore(workspace: string): AisepMemoryStore {
  return new AisepMemoryStore(resolve(workspace));
}

function memoryShow(rawArgs: string[]): number {
  const { args, rest } = parseGlobalArgs(rawArgs);
  const tier = rest[0] ?? "workspace";
  const store = buildStore(args.workspace);
  const records = tier === "global" ? store.listGlobalVerified() : store.listWorkspacePending();
  if (records.length === 0) {
    console.log(`[aisep memory ${tier}] (empty)`);
    return 0;
  }
  for (const r of records) {
    console.log(`- [${r.stage}] ${r.failurePattern}`);
    console.log(`    fix: ${r.fix}`);
    console.log(`    source: ${r.source}  verifiedBy: ${r.verifiedBy}  shipCount: ${r.shipCount}`);
  }
  return 0;
}

function memoryStats(rawArgs: string[]): number {
  const { args } = parseGlobalArgs(rawArgs);
  const stats = buildStore(args.workspace).stats();
  console.log(`[aisep memory stats]`);
  console.log(`  workspace-pending: ${stats.workspacePending}`);
  console.log(`  global-verified:   ${stats.globalVerified}`);
  for (const [stage, count] of Object.entries(stats.perStage).sort()) {
    console.log(`  per-stage ${stage.padEnd(11)} ${count}`);
  }
  return 0;
}

function memoryPromote(rawArgs: string[]): number {
  const { args, rest } = parseGlobalArgs(rawArgs);
  let stage: AisepStage | undefined;
  let pattern: string | undefined;
  let fix: string | undefined;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === "--stage") {
      const parsed = AisepStageSchema.safeParse(rest[++i]);
      if (!parsed.success) {
        console.error(`[aisep memory promote] Invalid stage: ${rest[i] ?? "<missing>"}`);
        return 1;
      }
      stage = parsed.data;
    } else if (arg === "--pattern") {
      pattern = rest[++i];
    } else if (arg === "--fix") {
      fix = rest[++i];
    }
  }

  if (!stage || !fix) {
    console.error(
      "[aisep memory promote] Required: --stage <name> --fix <text> [--pattern <substring>]",
    );
    return 1;
  }

  const count = buildStore(args.workspace).promote({ stage, failurePatternIncludes: pattern }, fix);
  console.log(`[aisep memory promote] promoted ${count} record(s) to global tier.`);
  return 0;
}

function memoryRetrieve(rawArgs: string[]): number {
  const { args, rest } = parseGlobalArgs(rawArgs);
  let stage: AisepStage | undefined;
  let tier: "workspace" | "global" = "global";
  let domain: string | undefined;
  let limit = 5;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === "--stage") {
      const parsed = AisepStageSchema.safeParse(rest[++i]);
      if (!parsed.success) return 1;
      stage = parsed.data;
    } else if (arg === "--tier") {
      tier = rest[++i] === "workspace" ? "workspace" : "global";
    } else if (arg === "--domain") {
      domain = rest[++i];
    } else if (arg === "--limit") {
      limit = Number(rest[++i]) || 5;
    }
  }

  if (!stage) {
    console.error("[aisep memory retrieve] Required: --stage <name> [--tier global|workspace] [--domain <d>] [--limit N]");
    return 1;
  }

  const hits = buildStore(args.workspace).retrieve({ stage, domain, tier, limit });
  console.log(`[aisep memory retrieve] ${hits.length} hit(s) from ${tier} tier.`);
  for (const h of hits) {
    console.log(`- ${h.failurePattern}\n    fix: ${h.fix}`);
  }
  return 0;
}
