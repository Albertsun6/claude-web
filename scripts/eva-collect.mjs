#!/usr/bin/env node
// scripts/eva-collect.mjs — Steward V0.5 R1: read pending worker done flags.
//
// 用法：`pnpm eva:collect` 或 `node scripts/eva-collect.mjs`
//
// 主线 (master Claude session) 用 `<id> 收线` / "看看谁完成了" 时跑本脚本。
//
// 读 ~/.vessel/spawn-done/*.json，打印每个 flag 的：task_id / branch / pr_url /
// commit_sha / summary / age。主线之后 echo 给用户，ack 后用 `--clear <id>` 删 flag。
//
// 不依赖外部 npm 包（裸 Node + ESM）。

import { readdirSync, readFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const FLAG_DIR = path.join(homedir(), ".vessel", "spawn-done");
const STALE_HOURS = 24;

function color(text, code) {
  return process.stdout.isTTY ? `[${code}m${text}[0m` : text;
}

function ageHours(completedAt) {
  const t = Date.parse(completedAt);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 3_600_000;
}

function formatAge(hours) {
  if (hours < 1) return `${Math.floor(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function listFlags() {
  if (!existsSync(FLAG_DIR)) return [];
  const entries = readdirSync(FLAG_DIR).filter((f) => f.endsWith(".json"));
  const flags = [];
  for (const entry of entries) {
    const fullPath = path.join(FLAG_DIR, entry);
    try {
      const raw = readFileSync(fullPath, "utf-8");
      const parsed = JSON.parse(raw);
      flags.push({ ...parsed, _file: fullPath, _mtime: statSync(fullPath).mtimeMs });
    } catch (err) {
      flags.push({
        task_id: entry.replace(/\.json$/, ""),
        _file: fullPath,
        _error: err.message,
      });
    }
  }
  return flags.sort((a, b) => (a._mtime ?? 0) - (b._mtime ?? 0));
}

const args = process.argv.slice(2);
const clearIdx = args.indexOf("--clear");

if (clearIdx >= 0) {
  const taskId = args[clearIdx + 1];
  if (!taskId) {
    console.error("Usage: eva-collect --clear <task-id>");
    process.exit(64);
  }
  const target = path.join(FLAG_DIR, `${taskId}.json`);
  if (!existsSync(target)) {
    console.error(`✗ no flag for task=${taskId} at ${target}`);
    process.exit(1);
  }
  unlinkSync(target);
  console.log(`✓ cleared flag for task=${taskId}`);
  process.exit(0);
}

const flags = listFlags();

const generated = new Date().toISOString();
console.log(
  `Steward pending done flags · ${color(FLAG_DIR.replace(homedir(), "~"), "36")} · ${generated}\n`,
);

if (flags.length === 0) {
  console.log(color("(no pending done flags)", "37"));
  console.log("");
  console.log(
    color("Workers signal done via: ./scripts/steward-signal-done.sh <task-id> [--pr URL] [--summary TEXT]", "37"),
  );
  process.exit(0);
}

console.log(
  `Total: ${flags.length}  ` +
    `${color(`pending=${flags.filter((f) => !f._error).length}`, "32")}  ` +
    `${color(`malformed=${flags.filter((f) => f._error).length}`, "31")}\n`,
);

for (const flag of flags) {
  if (flag._error) {
    console.log(color(`✗ ${flag.task_id}`, "31"));
    console.log(`  malformed: ${flag._error}`);
    console.log(`  file: ${flag._file}`);
    console.log("");
    continue;
  }

  const age = ageHours(flag.completed_at);
  const stale = age > STALE_HOURS;
  const badge = stale ? color("STALE", "33") : color("PENDING", "32");

  console.log(`${badge}  ${color(flag.task_id, "1")}`);
  console.log(`  branch:    ${flag.branch ?? "?"}`);
  console.log(`  commit:    ${(flag.commit_sha ?? "?").slice(0, 12)}`);
  console.log(`  worktree:  ${flag.worktree_path ?? "?"}`);
  if (flag.pr_url) console.log(`  pr:        ${flag.pr_url}`);
  if (flag.summary) console.log(`  summary:   ${flag.summary}`);
  console.log(`  completed: ${flag.completed_at} (${formatAge(age)} ago)`);
  if (stale) {
    console.log(
      color(`  ⚠ stale > ${STALE_HOURS}h — 主线可能漏收，请人工核查`, "33"),
    );
  }
  console.log("");
}

console.log(color("ack & clear: pnpm eva:collect --clear <task-id>", "37"));
console.log(
  color(
    `schema: vessel-spawn-done-v1  ·  R1 file flag canonical (proposal §5 R1)`,
    "37",
  ),
);
