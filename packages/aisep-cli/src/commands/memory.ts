// `aisep memory <show|stats|promote|retrieve|record> ...`

import { resolve } from "node:path";

import { AisepMemoryStore } from "@vessel/aisep-memory";
import {
  AisepMemoryVerifiedBySchema,
  AisepStageSchema,
  type AisepMemoryVerifiedBy,
  type AisepStage,
} from "@vessel/aisep-protocol";

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
    case "record":
      return memoryRecord(rest);
    default:
      console.error(
        "[aisep memory] Usage: aisep memory <show|stats|promote|retrieve|record> [...args]",
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

function memoryRecord(rawArgs: string[]): number {
  const { args, rest } = parseGlobalArgs(rawArgs);
  let stage: AisepStage | undefined;
  let pattern: string | undefined;
  let fix: string | undefined;
  let tier: "workspace" | "global" = "global";
  let verifiedBy: AisepMemoryVerifiedBy | undefined;
  let appliesToDomain: string[] | undefined;
  let appliesToStages: AisepStage[] | undefined;
  let appliesToTechStack: string[] | undefined;
  let sourceWorkspaceId: string | undefined;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === "--stage") {
      const parsed = AisepStageSchema.safeParse(rest[++i]);
      if (!parsed.success) {
        console.error(`[aisep memory record] Invalid stage: ${rest[i] ?? "<missing>"}`);
        return 1;
      }
      stage = parsed.data;
    } else if (arg === "--pattern") {
      pattern = rest[++i];
    } else if (arg === "--fix") {
      fix = rest[++i];
    } else if (arg === "--tier") {
      const next = rest[++i];
      if (next !== "workspace" && next !== "global") {
        console.error(`[aisep memory record] Invalid tier: ${next ?? "<missing>"} (must be workspace | global)`);
        return 1;
      }
      tier = next;
    } else if (arg === "--verified-by") {
      const parsed = AisepMemoryVerifiedBySchema.safeParse(rest[++i]);
      if (!parsed.success) {
        console.error(`[aisep memory record] Invalid --verified-by: must be human | auto`);
        return 1;
      }
      verifiedBy = parsed.data;
    } else if (arg === "--applies-to-domain") {
      appliesToDomain = (rest[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg === "--applies-to-stages") {
      const raw = (rest[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const parsedStages: AisepStage[] = [];
      for (const s of raw) {
        const parsed = AisepStageSchema.safeParse(s);
        if (!parsed.success) {
          console.error(`[aisep memory record] Invalid stage in --applies-to-stages: ${s}`);
          return 1;
        }
        parsedStages.push(parsed.data);
      }
      appliesToStages = parsedStages;
    } else if (arg === "--applies-to-tech-stack") {
      appliesToTechStack = (rest[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg === "--source-workspace-id") {
      sourceWorkspaceId = rest[++i];
    } else {
      console.error(`[aisep memory record] Unknown arg: ${arg}`);
      return 1;
    }
  }

  if (!stage || !pattern || !fix) {
    console.error(
      "[aisep memory record] Required: --stage <name> --pattern <text> --fix <text>\n" +
        "  Optional:\n" +
        "    --tier global|workspace          (default: global)\n" +
        "    --verified-by human|auto         (default: human for global, auto for workspace)\n" +
        "    --applies-to-domain a,b          (default: *)\n" +
        "    --applies-to-stages s1,s2        (default: [<stage>])\n" +
        "    --applies-to-tech-stack ts1,ts2  (default: *)\n" +
        "    --source-workspace-id <id>\n" +
        "    --workspace <path>               (cwd for workspace tier and the global path resolver)",
    );
    return 1;
  }

  const store = buildStore(args.workspace);
  const appliesTo = {
    domain: appliesToDomain ?? ["*"],
    stage: appliesToStages ?? [stage],
    techStack: appliesToTechStack ?? ["*"],
  };

  if (tier === "workspace") {
    const record = store.recordPending({
      stage,
      failurePattern: pattern,
      fix,
      appliesTo,
      ...(sourceWorkspaceId ? { sourceWorkspaceId } : {}),
    });
    console.log(
      `[aisep memory record] tier=workspace stage=${stage} id=${record.id}\n  pattern: ${pattern}\n  written to: ${store.workspacePath}`,
    );
    return 0;
  }

  const record = store.recordGlobal({
    stage,
    failurePattern: pattern,
    fix,
    appliesTo,
    ...(verifiedBy ? { verifiedBy } : {}),
    ...(sourceWorkspaceId ? { sourceWorkspaceId } : {}),
  });
  if (record === null) {
    console.log(
      `[aisep memory record] tier=global stage=${stage} DEDUP — record already exists for (stage, failurePattern[:100]); no-op.\n  pattern: ${pattern}`,
    );
    return 0;
  }
  console.log(
    `[aisep memory record] tier=global stage=${stage} id=${record.id} verifiedBy=${record.verifiedBy}\n  pattern: ${pattern}\n  written to: ${store.globalPath}`,
  );
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
