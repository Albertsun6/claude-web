#!/usr/bin/env node
// AISEP CLI entry. v0 stub — minimal argv parsing.
//
// Usage:
//   aisep run --workspace <path> [--dry] [--stage <name>]
//   aisep memory <show|stats|promote|retrieve> [...]
//   aisep --help

import { memoryCommand } from "./commands/memory.js";
import { migrateCommand } from "./commands/migrate.js";
import { reportCommand } from "./commands/report.js";
import { runCommand } from "./commands/run.js";
import { verifyCommand } from "./commands/verify.js";

const HELP = `aisep — AI Software Engineering Platform CLI (v0.1)

Commands:
  aisep run --workspace <path> --dry [--stage <name>]
      Run the 10-stage chain on a workspace using MockStageExecutor.
      (Real claude-CLI execution will arrive in Phase 2.5 via aisep-agents.)

  aisep run --real --workspace <path> [--parallel --children a,b,c [--concurrency N]]
                                       [--claude-timeout-ms <ms>]
      v0.3 (v1 fan-out Stage 2.cli-A): when --parallel is on AND
      --children lists >= 2 sub-stage names, the implement stage fans
      out into N parallel child stage_runs. concurrency defaults to 4
      (plan-roadmap hard ceiling); user can ratchet DOWN via --concurrency.
      Sub-stage names must match /^[A-Za-z0-9_.:-]+$/ (RISK-Q4-c).

      --claude-timeout-ms overrides per-attempt 'claude --print' timeout
      (default 600000 ms = 10 min; range 60000..1800000). Bump for heavy
      implement stages on real-business tasks (Pilot-10 finding).

  aisep memory show [--workspace <path>] [workspace|global]
      List memory records of the given tier (default: workspace pending).

  aisep memory stats [--workspace <path>]
      Show counts per tier and per stage.

  aisep memory promote [--workspace <path>] --stage <name> --fix <text> [--pattern <substring>]
      Promote workspace-pending records to global-verified.

  aisep memory record [--tier global|workspace] --stage <name> --pattern <text> --fix <text>
                      [--verified-by human|auto] [--applies-to-domain a,b]
                      [--applies-to-stages s1,s2] [--applies-to-tech-stack t1,t2]
                      [--source-workspace-id <id>] [--workspace <path>]
      Insert a new memory record directly (global tier = human-verified by default).
      Replaces ad-hoc /tmp/seed-from-retro.mjs scripts. Dedup on (stage, failurePattern[:100]).

  aisep memory retrieve [--workspace <path>] --stage <name> [--tier global|workspace]
      Retrieve top-K records for a given stage.

  aisep verify --recheck [--workspace <path>] [--check-name <substring>]
      Deterministically re-run contract_grep.checks[] against on-disk
      artifacts; update verify.md in place. Avoids full stage re-issue
      when only a single deterministic check needs flipping (Phase 2.D #12).

  aisep report [--workspace <path>] [--out <file>] [--open]
      Generate single-file HTML report from AISEP run state. Includes
      stage timeline (Mermaid Gantt), fan-out tree (Mermaid flowchart),
      stage_run table, trace matrix (REQ→ADR→ZOD→RISK→PATCH), and
      contract_grep drill-down. Self-contained for client demo + audit
      evidence (Option E, v0.3+).

  aisep migrate --to 0.4 [--workspace <path>] [--dry-run]
      v0.4 (ADR-022 Decision 5): migrate state.json from v0.3 → v0.4.
      Adds affects=[".*"] + migratedFromV03=true to fan-out child rows
      that lack the affects field; normalizes parent/normal rows.
      Acquires the R7 workspace lock (mode='migrate'). Atomic-rename
      write with .bak snapshot. Idempotent: a no-op if state already
      conforms. --dry-run prints the report without touching disk.

  aisep --help / -h
      Show this message.
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }

  switch (command) {
    case "run":
      return runCommand(argv.slice(1));
    case "memory":
      return memoryCommand(argv.slice(1));
    case "verify":
      return verifyCommand(argv.slice(1));
    case "report":
      return reportCommand(argv.slice(1));
    case "migrate":
      return migrateCommand(argv.slice(1));
    default:
      console.error(`[aisep] Unknown command: ${command}\n`);
      console.error(HELP);
      return 1;
  }
}

main().then(
  (code) => {
    process.exit(code);
  },
  (err) => {
    console.error(`[aisep] Unhandled error: ${(err as Error).stack ?? err}`);
    process.exit(1);
  },
);
