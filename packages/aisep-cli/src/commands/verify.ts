// `aisep verify --recheck --workspace <path>`
//
// Phase 2.D #12: deterministic re-run of contract_grep checks against
// the on-disk workspace state. Avoids "blockers that are resolvable by
// a deterministic re-run of a single check forcing full re-issue of
// upstream stages" (Pilot-04 retro §5 integrate candidate).

import { exec } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface ContractGrepCheck {
  name: string;
  command: string;
  ok: boolean;
  read_from_disk?: boolean;
}

interface VerifyReport {
  contract_grep?: {
    ok?: boolean;
    checks: ContractGrepCheck[];
  };
  [k: string]: unknown;
}

const JSON_FENCE_RE = /```json\s*\n([\s\S]*?)\n```/;

export async function verifyCommand(rawArgs: string[]): Promise<number> {
  const [sub, ...rest] = rawArgs;
  if (sub !== "--recheck") {
    console.error(
      "[aisep verify] Usage: aisep verify --recheck [--workspace <path>] [--check-name <substring>]\n" +
        "  Re-runs contract_grep.checks[] against on-disk artifacts and updates verify.md in place.",
    );
    return 1;
  }

  let workspace = process.cwd();
  let checkNameFilter: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === "--workspace" || arg === "-w") {
      workspace = rest[++i] ?? workspace;
    } else if (arg === "--check-name") {
      checkNameFilter = rest[++i];
    } else {
      console.error(`[aisep verify --recheck] Unknown arg: ${arg}`);
      return 1;
    }
  }

  const cwd = resolve(workspace);
  const verifyPath = join(cwd, "verify.md");

  let raw: string;
  try {
    raw = readFileSync(verifyPath, "utf-8");
  } catch {
    console.error(`[aisep verify --recheck] no verify.md found at ${verifyPath}`);
    return 1;
  }

  const match = raw.match(JSON_FENCE_RE);
  if (!match) {
    console.error("[aisep verify --recheck] no \\`\\`\\`json fence found in verify.md");
    return 1;
  }

  let report: VerifyReport;
  try {
    report = JSON.parse(match[1]!) as VerifyReport;
  } catch (e) {
    console.error(`[aisep verify --recheck] failed to parse JSON: ${(e as Error).message}`);
    return 1;
  }

  const checks = report.contract_grep?.checks;
  if (!checks || !Array.isArray(checks)) {
    console.error("[aisep verify --recheck] verify.md JSON is missing contract_grep.checks[]");
    return 1;
  }

  const targets = checkNameFilter
    ? checks.filter((c) => c.name.includes(checkNameFilter!))
    : checks;
  if (targets.length === 0) {
    console.error(`[aisep verify --recheck] no checks matched filter "${checkNameFilter}"`);
    return 1;
  }

  console.log(
    `[aisep verify --recheck] cwd=${cwd}  re-running ${targets.length}/${checks.length} contract_grep check(s)`,
  );

  let flips = 0;
  for (const check of targets) {
    const prev = check.ok;
    try {
      await execAsync(check.command, { cwd, timeout: 30_000, shell: "/bin/bash" });
      check.ok = true;
    } catch {
      check.ok = false;
    }
    if (prev !== check.ok) flips += 1;
    const arrow = prev === check.ok ? "" : `  (was ${prev ? "✓" : "✗"})`;
    console.log(`  [${check.ok ? "✓" : "✗"}] ${check.name}${arrow}`);
  }

  if (report.contract_grep) {
    report.contract_grep.ok = checks.every((c) => c.ok);
  }

  const newJson = JSON.stringify(report, null, 2);
  const newRaw = raw.replace(JSON_FENCE_RE, () => "```json\n" + newJson + "\n```");
  writeFileSync(verifyPath, newRaw, "utf-8");

  console.log(
    `[aisep verify --recheck] done. ${flips} flip(s). contract_grep.ok=${report.contract_grep?.ok ?? "n/a"}`,
  );
  return 0;
}
