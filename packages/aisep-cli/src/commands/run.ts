// `aisep run [--workspace <path>] [--dry] [--stage <name>]`
//
// v0 stub: uses MockStageExecutor when --dry, otherwise refuses to run
// because aisep-agents (real executor) is not yet wired in.

import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import { ClaudeExecutor, PromptCompiler } from "@vessel/aisep-agents";
import {
  AisepRunner,
  AisepStore,
  ids,
  type MemoryProvider,
  type StageExecutor,
} from "@vessel/aisep-core";
import { AisepMemoryStore } from "@vessel/aisep-memory";
import {
  AisepStagePhaseSchema,
  AisepStageSchema,
  type AisepStage,
  type AisepStagePhase,
} from "@vessel/aisep-protocol";
import { NodeWorkspace } from "@vessel/aisep-workspace";

import { MockStageExecutor } from "../mock-executor.js";
import { parsePlanParallel } from "../parse-plan-parallel.js";

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
  /**
   * v0.3 (v1 fan-out Stage 2.cli-A): enable fan-out at the implement stage.
   * When `parallel` is true AND `children` is non-empty, the implement
   * stage is dispatched via runner.runFanOutParent() instead of the
   * normal single-stage runStage(). Stage 2.cli-B will derive `children`
   * from plan stage's `parallel:` block; Stage 2.cli-A requires manual
   * `--children name1,name2,...` (≥ 2 names).
   */
  parallel?: boolean;
  parallelChildren?: string[];
  /** v0.3: concurrency cap for fan-out (default 4 per plan roadmap; user-tunable). */
  concurrency?: number;
  /**
   * v0.3 (Pilot-10 finding 2026-05-13): override per-attempt `claude --print`
   * subprocess timeout. Default in claude-executor.ts is 10 minutes; bump
   * for heavy implement stages or ratchet down for quick smoke runs.
   */
  claudeTimeoutMs?: number;
  /**
   * v0.4 (ADR-022 Decision 4): id-stable retry of a single failed
   * fan-out child. When set, the stage chain is bypassed entirely and
   * the cli calls runner.runRetryChild for the named id.
   */
  retryChild?: string;
  /**
   * v0.4 (ADR-022 Decision 4 + F3): use F3-style 1.5× timeout multiplier
   * for the retry attempt. Recorded on the attempt log for forensic
   * traceability; full executor integration (real ClaudeExecutor)
   * threads this through to spawnClaude in a follow-up.
   */
  bumpTimeout?: boolean;
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
  //
  // Phase 2.D #13: plan stage gets cross-stage memory — surfaces open
  // failure modes for every downstream stage so plan §1.5 can flag them
  // as risks before architecture invests in detailed ADRs. Other stages
  // get only their own stage's memory (no noise).
  const allStages = AisepStageSchema.options as AisepStage[];
  const memoryProvider: MemoryProvider = {
    async retrieve(stage) {
      if (stage === "plan") {
        const all: unknown[] = [];
        for (const s of allStages) {
          const hits = memory.retrieve({ stage: s, tier: "global", limit: 3 });
          all.push(...hits);
        }
        return all;
      }
      return memory.retrieve({ stage, tier: "global", limit: 5 });
    },
  };

  const executor: StageExecutor = args.real
    ? new ClaudeExecutor(new PromptCompiler(), {
        model: args.model,
        ...(args.claudeTimeoutMs !== undefined ? { timeoutMs: args.claudeTimeoutMs } : {}),
      })
    : new MockStageExecutor();
  const runner = new AisepRunner({
    store,
    workspace: ws,
    executor,
    memoryProvider,
  });

  // v0.4 (ADR-022 Decision 4): retry-child fast path — bypass the stage
  // chain and call runner.runRetryChild for the named id. Acquires the
  // R7 workspace lock inside the runner; refuses if held.
  if (args.retryChild !== undefined) {
    console.log(
      `[aisep run] retry-child ${args.retryChild}${args.bumpTimeout ? " (--bump-timeout)" : ""}`,
    );
    try {
      const retried = await runner.runRetryChild({
        childId: args.retryChild,
        ...(args.bumpTimeout ? { bumpTimeout: true } : {}),
      });
      console.log(
        `[aisep run] retry-child ${retried.id.slice(0, 12)}… → ${retried.status}`,
      );
      if (retried.status !== "succeeded") return 3;
      return 0;
    } catch (err) {
      console.error(`[aisep run] retry-child failed: ${(err as Error).message}`);
      return 5;
    }
  }

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

    // v0.3 (v1 fan-out Stage 2.cli-C): auto-detect parallel: block in
    // plan.md as a fallback when --parallel / --children weren't passed
    // manually. Manual flags always win (explicit > auto).
    let effectiveParallel = args.parallel === true;
    let effectiveChildren = args.parallelChildren;
    let effectiveAffectsByName: Map<string, string[]> | undefined;
    if (stage === "implement" && !effectiveParallel) {
      const planPath = join(cwd, "plan.md");
      if (existsSync(planPath)) {
        const planMd = readFileSync(planPath, "utf-8");
        let autoEntries;
        try {
          autoEntries = parsePlanParallel(planMd);
        } catch (e) {
          console.error(
            `[aisep run] plan.md has a malformed 'parallel:' block; refusing to dispatch: ${(e as Error).message}`,
          );
          return 4;
        }
        if (autoEntries) {
          effectiveParallel = true;
          effectiveChildren = autoEntries.map((e) => e.name);
          // v0.4: thread affects through to runFanOutParent (Decision 2).
          effectiveAffectsByName = new Map(
            autoEntries.map((e) => [e.name, e.affects]),
          );
          console.log(
            `[aisep run] auto-detected fan-out from plan.md: parallel=${effectiveChildren.join(",")}`,
          );
        }
      }
    }

    // v0.3 (v1 fan-out Stage 2.cli-A): fan out implement when --parallel
    // is on AND children specified. Other stages stay on the normal
    // single-stage path.
    if (
      stage === "implement" &&
      effectiveParallel &&
      effectiveChildren &&
      effectiveChildren.length >= 2
    ) {
      const cap = args.concurrency ?? 4;
      console.log(
        `[aisep run] implement   (none                        ) → fan-out (parallel=${effectiveChildren.join(",")}, concurrency=${cap})`,
      );
      const { parent, children } = await runner.runFanOutParent({
        stage: "implement",
        predecessorId: lastRunId,
        concurrencyCap: cap,
        children: effectiveChildren.map((name) => ({
          name,
          // v0.4 Decision 2: prefer plan.md-declared affects; fall back to
          // `packages/<name>/.*` heuristic when the child comes from
          // `--children <name>` CLI flag without a plan.md backing it.
          affects: effectiveAffectsByName?.get(name) ?? [
            `packages/${name}/.*`,
          ],
        })),
      });
      for (const c of children) {
        console.log(
          `[aisep run]   ↳ child ${c.id.slice(0, 12)}… → ${c.status}`,
        );
      }
      console.log(
        `[aisep run] implement   (parent settle               ) → ${parent.status}${
          parent.status === "failed" ? " (stopping chain)" : ""
        }`,
      );
      if (parent.status === "failed") return 3;
      lastRunId = parent.id;
      continue;
    }

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

export function parseRunArgs(rawArgs: string[]): RunArgs | undefined {
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
    } else if (arg === "--parallel") {
      args.parallel = true;
    } else if (arg === "--children") {
      const next = rawArgs[++i];
      if (!next) {
        console.error(`[aisep run] --children requires a comma-separated list of sub-stage names`);
        return undefined;
      }
      const names = next.split(",").map((x) => x.trim()).filter(Boolean);
      if (names.length < 2) {
        console.error(`[aisep run] --children requires at least 2 names (fan-out doesn't apply to 1 child)`);
        return undefined;
      }
      const SUB_NAME_RE = /^[A-Za-z0-9_.:-]+$/;
      for (const n of names) {
        if (!SUB_NAME_RE.test(n)) {
          console.error(`[aisep run] --children: name "${n}" must match /^[A-Za-z0-9_.:-]+$/ (shell-safe per RISK-Q4-c)`);
          return undefined;
        }
      }
      args.parallelChildren = names;
    } else if (arg === "--concurrency") {
      const next = rawArgs[++i];
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1 || n > 4) {
        console.error(`[aisep run] --concurrency must be an integer in [1, 4] (plan-roadmap hard ceiling); got "${next}"`);
        return undefined;
      }
      args.concurrency = n;
    } else if (arg === "--claude-timeout-ms") {
      const next = rawArgs[++i];
      const n = Number(next);
      // 60s lower bound: anything lower is almost certainly a mistake
      // (claude --print cold-start alone takes ~10s). 30min upper bound:
      // prevents pathological hang-forever runs from accidentally being
      // dispatched and locking up the workspace.
      if (!Number.isFinite(n) || n < 60_000 || n > 30 * 60 * 1000) {
        console.error(`[aisep run] --claude-timeout-ms must be in [60000, 1800000] ms; got "${next}"`);
        return undefined;
      }
      args.claudeTimeoutMs = n;
    } else if (arg === "--retry-child") {
      const next = rawArgs[++i];
      if (!next || next.length === 0) {
        console.error(`[aisep run] --retry-child requires a stage_run id (e.g. sr-01HJK...)`);
        return undefined;
      }
      args.retryChild = next;
    } else if (arg === "--bump-timeout") {
      args.bumpTimeout = true;
    } else {
      console.error(`[aisep run] Unknown arg: ${arg}`);
      return undefined;
    }
  }

  // Cross-flag validation: --parallel requires --children
  if (args.parallel && (!args.parallelChildren || args.parallelChildren.length < 2)) {
    console.error(`[aisep run] --parallel requires --children name1,name2[,...] (>= 2)`);
    return undefined;
  }
  // v0.4: --bump-timeout only meaningful with --retry-child
  if (args.bumpTimeout && !args.retryChild) {
    console.error(`[aisep run] --bump-timeout requires --retry-child <id> (ADR-022 Decision 4)`);
    return undefined;
  }
  return args;
}
