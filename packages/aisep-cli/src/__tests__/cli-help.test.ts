// F5 (Phase 2.F, 2026-05-13): smoke-test `cli.ts --help` parses & exits 0.
//
// Pilot-10b finding #5: the F2 HELP text contained a backtick inside a
// backtick-template-literal, which tsx/esbuild rejected at parse-time.
// Vitest didn't catch it because no test file imports `cli.ts` directly
// (only `runCommand` / `reportCommand` are imported; the HELP string is
// module-scope but never evaluated by the unit tests).
//
// This test spawns `tsx packages/aisep-cli/src/cli.ts --help` and
// asserts exit code 0 + presence of the 4 subcommand names. Cheap
// (~3s with tsx warmed cache) but catches the class of bug deterministically.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// __tests__/ -> src/ -> aisep-cli/
const CLI_PATH = path.resolve(HERE, "..", "cli.ts");

describe("cli.ts --help smoke (F5)", () => {
  it("parses without syntax error and exits 0", () => {
    // Use `pnpm exec tsx` so we re-use the workspace's tsx without
    // assuming a global install. spawnSync inherits PATH; pnpm exec
    // adds node_modules/.bin to it. Timeout 15s — typical cold run
    // is 1-3s, hot 200-500ms.
    const result = spawnSync("pnpm", ["exec", "tsx", CLI_PATH, "--help"], {
      encoding: "utf-8",
      timeout: 15_000,
    });

    if (result.status !== 0) {
      // surface stderr to make failures debuggable
      // (test name + assertion already explains why)
      console.error("[F5 smoke] stderr:", result.stderr);
      console.error("[F5 smoke] stdout:", result.stdout);
    }

    expect(result.status).toBe(0);
    // All 4 user-facing subcommand verbs must appear
    expect(result.stdout).toContain("aisep run");
    expect(result.stdout).toContain("aisep memory");
    expect(result.stdout).toContain("aisep verify");
    expect(result.stdout).toContain("aisep report");
  });
});
