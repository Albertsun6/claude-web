#!/usr/bin/env node
// AISEP CLI entry. v0 stub — minimal argv parsing.
//
// Usage:
//   aisep run --workspace <path> [--dry] [--stage <name>]
//   aisep memory <show|stats|promote|retrieve> [...]
//   aisep --help

import { memoryCommand } from "./commands/memory.js";
import { runCommand } from "./commands/run.js";

const HELP = `aisep — AI Software Engineering Platform CLI (v0.1)

Commands:
  aisep run --workspace <path> --dry [--stage <name>]
      Run the 10-stage chain on a workspace using MockStageExecutor.
      (Real claude-CLI execution will arrive in Phase 2.5 via aisep-agents.)

  aisep memory show [--workspace <path>] [workspace|global]
      List memory records of the given tier (default: workspace pending).

  aisep memory stats [--workspace <path>]
      Show counts per tier and per stage.

  aisep memory promote [--workspace <path>] --stage <name> --fix <text> [--pattern <substring>]
      Promote workspace-pending records to global-verified.

  aisep memory retrieve [--workspace <path>] --stage <name> [--tier global|workspace]
      Retrieve top-K records for a given stage.

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
