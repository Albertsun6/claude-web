// `aisep report --workspace <path> [--out <file>] [--open]`
//
// Option E (v0.3+) — generate single-file HTML report from AISEP run state.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { AisepStore } from "@vessel/aisep-core";

import { buildReport } from "../report/builder.js";
import { renderReport } from "../report/render.js";

interface ReportArgs {
  workspace: string;
  out?: string;
  open: boolean;
}

function parseArgs(rawArgs: string[]): ReportArgs | undefined {
  const args: ReportArgs = { workspace: process.cwd(), open: false };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]!;
    if (arg === "--workspace" || arg === "-w") {
      args.workspace = rawArgs[++i] ?? args.workspace;
    } else if (arg === "--out" || arg === "-o") {
      args.out = rawArgs[++i];
    } else if (arg === "--open") {
      args.open = true;
    } else {
      console.error(`[aisep report] Unknown arg: ${arg}`);
      return undefined;
    }
  }
  return args;
}

export async function reportCommand(rawArgs: string[]): Promise<number> {
  const args = parseArgs(rawArgs);
  if (!args) return 1;

  const cwd = resolve(args.workspace);
  const statePath = join(cwd, ".aisep", "state.json");
  if (!existsSync(statePath)) {
    console.error(`[aisep report] no state.json at ${statePath}; nothing to report`);
    return 2;
  }

  // Load state via AisepStore for type-safe access.
  const stateRaw = JSON.parse(readFileSync(statePath, "utf-8")) as {
    workspaceId: string;
  };
  const store = new AisepStore(cwd, stateRaw.workspaceId);
  const stageRuns = store.listStageRuns({});
  // List all artifacts (no built-in helper; scan via listArtifactsByStageRun per run).
  const artifacts = stageRuns.flatMap((r) => store.listArtifactsByStageRun(r.id));

  // Build artifact-contents map from on-disk files (workspace-relative).
  const artifactContents: Record<string, string> = {};
  for (const a of artifacts) {
    const filePath = join(cwd, a.ref.key);
    if (existsSync(filePath)) {
      try {
        artifactContents[a.ref.key] = readFileSync(filePath, "utf-8");
      } catch {
        // skip unreadable
      }
    }
  }

  // Workspace meta: pull from state.json directly (store doesn't expose meta).
  // Default fields for projection; CLI consumer typically has the full
  // AisepWorkspaceMeta but for report we only need name + cwd + status + etc.
  // Use minimal placeholder so report works on any state.json.
  const workspaceMeta = {
    id: stateRaw.workspaceId,
    name: cwd.split("/").pop() ?? "workspace",
    cwd,
    status: "active" as const,
    techStack: [],
    createdAt: Date.now(),
    shipCount: stageRuns.filter((r) => r.stage === "retrospect" && r.status === "succeeded").length,
    adoptedPatterns: [],
  };

  const report = buildReport({
    workspace: workspaceMeta,
    stageRuns,
    artifacts,
    artifactContents,
  });

  const html = renderReport(report);
  const outPath = args.out ? resolve(args.out) : join(cwd, "report.html");
  writeFileSync(outPath, html, "utf-8");
  console.log(`[aisep report] wrote ${outPath} (${html.length} bytes; ${stageRuns.length} stages, ${report.parallelGroups.length} parallel group(s), ${report.contractGrepChecks.length} contract_grep checks)`);

  if (args.open) {
    // Spawn macOS `open` / Linux `xdg-open`. Best-effort; ignore failure.
    const bin = process.platform === "darwin" ? "open" : "xdg-open";
    try {
      const child = spawn(bin, [outPath], { detached: true, stdio: "ignore" });
      child.unref();
      console.log(`[aisep report] opened with ${bin}`);
    } catch (e) {
      console.error(`[aisep report] --open failed: ${(e as Error).message}`);
    }
  }
  return 0;
}
