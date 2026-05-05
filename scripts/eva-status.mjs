#!/usr/bin/env node
// scripts/eva-status.mjs — print eva.json status (CLI status reader for H12 v1).
//
// 用法：`node scripts/eva-status.mjs` 或 `pnpm eva:status`
//
// 不依赖外部 npm 包（裸 Node + ESM），即使 backend 没起来也能跑。
// 若 eva.json 不存在或 schema 错，明确报错指向 schema spec。

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const EVA_JSON_PATH = path.resolve(REPO_ROOT, "eva.json");

// Cross M1 修：CLI 校验对齐 packages/shared/src/eva-config.ts schema。
// 不复用 zod（vanilla mjs 不引入 build 步骤），改成手写等同规则。schema 改时
// 此处也要同步改（双源校验，eva-config.test.ts 跑 zod，CLI 跑这里，git tree 中
// 的 eva.json 双方都过才算 ok — 漂移会被 lint 发现）。
const VALID_STATUSES = new Set(["active", "done", "released"]);
const OWNS_PATTERN = /^[a-zA-Z0-9_./-]+(#[a-zA-Z_][a-zA-Z0-9_-]*)?$/;
// ISO 8601 datetime sniff — 不要严格解析每条规则（mjs 没 zod 仿不全），但拦明显错。
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function fail(msg) {
  console.error(`[31m✗[0m ${msg}`);
  process.exit(1);
}

function color(text, code) {
  return process.stdout.isTTY ? `[${code}m${text}[0m` : text;
}

function statusBadge(status) {
  if (status === "active") return color("active  ", "32"); // green
  if (status === "done") return color("done    ", "37"); // gray
  if (status === "released") return color("released", "33"); // yellow
  return color(status, "31");
}

if (!existsSync(EVA_JSON_PATH)) {
  fail(`eva.json not found at ${EVA_JSON_PATH}\nSchema: packages/shared/src/eva-config.ts`);
}

let raw;
try {
  raw = JSON.parse(readFileSync(EVA_JSON_PATH, "utf-8"));
} catch (err) {
  fail(`eva.json invalid JSON: ${err.message}`);
}

if (raw?.version !== 1) {
  fail(`eva.json version must be 1, got ${JSON.stringify(raw?.version)}`);
}

if (!Array.isArray(raw.worktrees)) {
  fail("eva.json missing worktrees array");
}

// Field validation — match shared/src/eva-config.ts 主要规则
for (const [i, w] of raw.worktrees.entries()) {
  const where = `worktrees[${i}]`;
  if (typeof w.name !== "string" || !w.name) fail(`${where} missing or non-string 'name'`);
  if (typeof w.branch !== "string" || !w.branch) fail(`${where} missing or non-string 'branch'`);
  if (typeof w.path !== "string" || !w.path) fail(`${where} missing or non-string 'path'`);
  if (!VALID_STATUSES.has(w.status)) fail(`${where} bad status='${w.status}' (active/done/released only)`);
  if (w.port !== undefined) {
    if (!Number.isInteger(w.port) || w.port < 1024 || w.port > 65535) {
      fail(`${where} port out of range (must be int 1024-65535)`);
    }
  }
  if (w.dataDir !== undefined && typeof w.dataDir !== "string") fail(`${where} dataDir must be string`);
  if (w.note !== undefined && typeof w.note !== "string") fail(`${where} note must be string`);
  if (w.since !== undefined) {
    if (typeof w.since !== "string" || !ISO_DATETIME.test(w.since)) {
      fail(`${where} since must be ISO 8601 datetime (got '${w.since}')`);
    }
  }
  if (w.owns !== undefined) {
    if (!Array.isArray(w.owns)) fail(`${where} owns must be array`);
    for (const [j, entry] of w.owns.entries()) {
      if (typeof entry !== "string") fail(`${where}.owns[${j}] must be string`);
      if (entry.includes("..")) fail(`${where}.owns[${j}] '${entry}' must not contain '..'`);
      if (entry.startsWith("/")) fail(`${where}.owns[${j}] '${entry}' must be relative path`);
      if ((entry.match(/#/g) ?? []).length > 1) fail(`${where}.owns[${j}] '${entry}' has multiple '#' separators`);
      if (!OWNS_PATTERN.test(entry)) fail(`${where}.owns[${j}] '${entry}' does not match path[#symbol] pattern`);
    }
  }
}

// Active uniqueness — matches shared schema superRefine
const active = raw.worktrees.filter((w) => w.status === "active");
const seenKeys = new Map(); // key like "name:foo" -> index
for (const [i, w] of active.entries()) {
  for (const key of ["name", "branch", "path", "port", "dataDir"]) {
    const v = w[key];
    if (v === undefined) continue;
    const compoundKey = `${key}:${v}`;
    if (seenKeys.has(compoundKey)) {
      fail(`active worktrees collide on ${key}='${v}' (entries ${seenKeys.get(compoundKey)} and ${i})`);
    }
    seenKeys.set(compoundKey, i);
  }
}

// Summary line
const counts = {
  active: raw.worktrees.filter((w) => w.status === "active").length,
  done: raw.worktrees.filter((w) => w.status === "done").length,
  released: raw.worktrees.filter((w) => w.status === "released").length,
};

const generated = new Date().toISOString();
console.log(`Eva worktrees · ${color(EVA_JSON_PATH.replace(REPO_ROOT, "."), "36")} · generated ${generated}\n`);
console.log(
  `Total: ${raw.worktrees.length}  ` +
  `${color("active=" + counts.active, "32")}  ` +
  `${color("done=" + counts.done, "37")}  ` +
  `${color("released=" + counts.released, "33")}\n`,
);

if (raw.worktrees.length === 0) {
  console.log(color("(empty)", "37"));
  process.exit(0);
}

// Table header
const widths = { status: 10, name: 30, port: 6, branch: 50 };
const header = [
  "STATUS".padEnd(widths.status),
  "NAME".padEnd(widths.name),
  "PORT".padEnd(widths.port),
  "BRANCH".padEnd(widths.branch),
].join("  ");
console.log(color(header, "1")); // bold
console.log("-".repeat(header.length));

// Sort: active first, then done, then released
const sorted = [...raw.worktrees].sort((a, b) => {
  const order = { active: 0, done: 1, released: 2 };
  return (order[a.status] ?? 3) - (order[b.status] ?? 3);
});

for (const w of sorted) {
  const row = [
    statusBadge(w.status).padEnd(widths.status + 11), // +11 for ANSI codes
    String(w.name).slice(0, widths.name).padEnd(widths.name),
    String(w.port ?? "-").padEnd(widths.port),
    String(w.branch).slice(0, widths.branch).padEnd(widths.branch),
  ].join("  ");
  console.log(row);
  if (w.note) {
    console.log(`  ${color(w.note.slice(0, 100), "37")}`);
  }
}

console.log("");
console.log(
  color(
    "Schema: packages/shared/src/eva-config.ts  ·  v1 单机本地范围（H12，不含 auto-lock）",
    "37",
  ),
);
