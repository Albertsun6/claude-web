#!/usr/bin/env node
// migrate-v0.2-min1.mjs — Phase 2.D #14 / proposal §Change 5c
//
// Pre-flight check before tagging aisep-protocol@0.2.0: scan ALL
// evolution_log.json files under known workspaces + global, abort if
// any record has `appliesTo.stage.length === 0` (which `.min(1)` will
// reject after schema tightening, combined with loadFile's old
// catch-to-empty fallback would silently erase the entire log).
//
// Idempotent. Exits 0 if clean, 1 if violations.
//
// Usage:
//   node packages/aisep-memory/scripts/migrate-v0.2-min1.mjs
//   node packages/aisep-memory/scripts/migrate-v0.2-min1.mjs --auto-fix   # strip empty-stage records
//
// Per CLAUDE.md R10: global memory at ~/.aisep/; per workspace
// convention <workspace>/.aisep/evolution_log.json.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AUTO_FIX = process.argv.includes("--auto-fix");

function findEvolutionLogs() {
  const home = homedir();
  const globalPath = join(home, ".aisep", "governance-log", "evolution_log.json");
  const workspaceCandidates = [];

  // Search common workspace roots; macOS `find` with -name to avoid heavy
  // recursion. Limit to typical AISEP workspace locations.
  const roots = [
    join(home, "Desktop"),
    "/tmp",
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const out = execSync(
        `find ${root} -maxdepth 5 -path '*/.aisep/evolution_log.json' -type f 2>/dev/null`,
        { encoding: "utf-8" },
      );
      for (const line of out.trim().split("\n").filter(Boolean)) {
        workspaceCandidates.push(line);
      }
    } catch {
      // find may fail on permissions; skip
    }
  }

  const paths = [];
  if (existsSync(globalPath)) paths.push({ path: globalPath, tier: "global" });
  for (const p of workspaceCandidates) paths.push({ path: p, tier: "workspace" });
  return paths;
}

function scan(paths) {
  const violations = [];
  let totalRecords = 0;
  for (const { path, tier } of paths) {
    let log;
    try {
      log = JSON.parse(readFileSync(path, "utf-8"));
    } catch (e) {
      console.error(`[migrate-v0.2-min1] WARN: cannot parse ${path}: ${e.message}`);
      continue;
    }
    const records = log.records ?? [];
    totalRecords += records.length;
    for (const r of records) {
      const stages = r?.appliesTo?.stage;
      if (!Array.isArray(stages) || stages.length === 0) {
        violations.push({
          path,
          tier,
          recordId: r.id ?? "<no id>",
          failurePattern: (r.failurePattern ?? "").slice(0, 80),
        });
      }
    }
  }
  return { violations, totalRecords, totalFiles: paths.length };
}

function autoFix(paths) {
  let fixed = 0;
  for (const { path } of paths) {
    let log;
    try {
      log = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      continue;
    }
    const before = (log.records ?? []).length;
    log.records = (log.records ?? []).filter(
      (r) => Array.isArray(r?.appliesTo?.stage) && r.appliesTo.stage.length > 0,
    );
    const after = log.records.length;
    if (before !== after) {
      writeFileSync(path, JSON.stringify(log, null, 2), "utf-8");
      console.log(`[migrate-v0.2-min1] FIXED ${path}: stripped ${before - after} empty-stage record(s)`);
      fixed += before - after;
    }
  }
  return fixed;
}

const paths = findEvolutionLogs();
console.log(`[migrate-v0.2-min1] scanning ${paths.length} evolution_log.json file(s)`);
for (const { path, tier } of paths) console.log(`  - ${tier.padEnd(10)} ${path}`);

const { violations, totalRecords, totalFiles } = scan(paths);

if (violations.length === 0) {
  console.log(`\n[migrate-v0.2-min1] ✓ PRE-FLIGHT CLEAN — ${totalRecords} records across ${totalFiles} file(s) all have appliesTo.stage.length >= 1`);
  console.log("[migrate-v0.2-min1] Safe to tag aisep-protocol@0.2.0 with .min(1) constraint.");
  process.exit(0);
}

console.error(`\n[migrate-v0.2-min1] ✗ ${violations.length} VIOLATION(S) FOUND:`);
for (const v of violations) {
  console.error(`  [${v.tier}] ${v.path}`);
  console.error(`    id=${v.recordId}  pattern="${v.failurePattern}"`);
}

if (AUTO_FIX) {
  console.error("\n[migrate-v0.2-min1] --auto-fix mode: stripping empty-stage records...");
  const fixed = autoFix(paths);
  console.error(`[migrate-v0.2-min1] ✓ Stripped ${fixed} record(s). Re-run without --auto-fix to verify.`);
  process.exit(0);
}

console.error("\n[migrate-v0.2-min1] Refusing to allow v0.2.0 tag. Resolve violations then re-run.");
console.error("[migrate-v0.2-min1] To auto-strip: node migrate-v0.2-min1.mjs --auto-fix");
process.exit(1);
