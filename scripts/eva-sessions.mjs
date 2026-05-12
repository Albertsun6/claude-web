#!/usr/bin/env node
// scripts/eva-sessions.mjs — print active Claude Code sessions (Step 2 of
// 并行 session 协调 plan).
//
// 用法：
//   `pnpm eva:sessions`                  → 人眼 ASCII 表（默认）
//   `pnpm eva:sessions --format json`    → 机器消费契约（Steward boot ritual 用）
//
// 也被 `pnpm eva:status` 在 worktree 表后顺手打印一遍（默认 text）。
//
// 设计：纯派生视图，零写入。Claude Code 已经把所有需要的状态写在磁盘上了：
//   - 每个会话的 jsonl 在 ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
//   - 活进程可由 ps -axo cmd 过滤 'claude' + 抓 `--resume <uuid>` 拿到 session id
//   - jsonl 的 mtime 就是「最近活动时间」
//
// 因此不需要新文件 / 注册 / 心跳 / hook，零侵入；只要 ps + readdir + stat。
//
// JSON 输出契约（与 ADR-019 §eva:sessions JSON contract 镜像；Steward 消费侧依赖）：
//   {
//     generated:          ISO timestamp,
//     total:              活进程数,
//     recentlyActive:     5 分钟内 jsonl 有写入的数,
//     processesNoResume:  进程在但没拿到 --resume <uuid> 的数,
//     sessions: [{
//       pid, etime, sessionId, cwd, branch, lastSeenMs, lastSeenAgo
//     }]
//   }
// 缺失字段（cwd/branch/sessionId/lastSeen*）一律 JSON null，不用文本占位串。
// 空集仍返回完整对象 + sessions:[]，不退出到 "(no live ...)" 文本路径。
//
// macOS-only（用了 `ps -axo`），跟项目其它脚本一致。

import { execSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");

// Manual flag parsing (sibling style to scripts/eva-hook.mjs:73-84;
// keep zero-dep tradition).
function parseFormat(argv) {
  let format = "text";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format") {
      format = argv[++i];
    } else if (a.startsWith("--format=")) {
      format = a.slice("--format=".length);
    } else {
      process.stderr.write(`eva-sessions: unknown arg '${a}'\n`);
      process.exit(2);
    }
  }
  if (format !== "text" && format !== "json") {
    process.stderr.write(
      `eva-sessions: unknown format '${format}', expected text|json\n`,
    );
    process.exit(2);
  }
  return format;
}
const FORMAT = parseFormat(process.argv.slice(2));

function color(text, code) {
  return process.stdout.isTTY ? `[${code}m${text}[0m` : text;
}

// Encoded cwd → real cwd. Claude Code replaces `/` with `-` and prefixes with `-`.
// Lossy by design (original `-` in path indistinguishable from `/`), so verify
// each candidate exists. Best-effort guess otherwise.
function decodeProjectDir(encoded) {
  // Encoded form: "-Users-yongqian-Desktop-Vessel"
  if (!encoded.startsWith("-")) return null;
  const guess = "/" + encoded.slice(1).replace(/-/g, "/");
  if (existsSync(guess)) return guess;
  // Fallback: try collapsing repeated slashes
  const collapsed = guess.replace(/\/+/g, "/");
  if (existsSync(collapsed)) return collapsed;
  return guess; // best-effort, may not exist
}

function getBranch(cwd) {
  if (!existsSync(cwd)) return null;
  try {
    return execSync(`git -C "${cwd}" branch --show-current`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function fmtAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// 1. Scan live `claude` processes
let psOut;
try {
  psOut = execSync(
    "ps -axo pid=,etime=,command= | grep -E '/claude\\s|claude --' | grep -v grep",
    { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
  );
} catch {
  // grep exits non-zero if no matches; that's fine
  psOut = "";
}

const sessions = [];
for (const line of psOut.trim().split("\n")) {
  if (!line) continue;
  const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/);
  if (!m) continue;
  const [, pid, etime, command] = m;
  // Filter to Claude Code CLI processes (not Claude.app / Claude desktop)
  if (!command.includes("/claude ") && !command.includes("/claude\t")) continue;
  if (command.includes("Claude.app")) continue;
  // Extract --resume <uuid> if present
  const resumeMatch = command.match(/--resume\s+([a-f0-9-]{36})/);
  const sessionId = resumeMatch ? resumeMatch[1] : null;
  sessions.push({ pid, etime, sessionId, command });
}

// 2. For each session id, locate its jsonl + decode cwd
function findJsonlForSession(sessionId) {
  if (!sessionId || !existsSync(CLAUDE_PROJECTS)) return null;
  for (const dir of readdirSync(CLAUDE_PROJECTS)) {
    const candidate = path.join(CLAUDE_PROJECTS, dir, `${sessionId}.jsonl`);
    if (existsSync(candidate)) {
      return { jsonl: candidate, projectDir: dir, cwd: decodeProjectDir(dir) };
    }
  }
  return null;
}

const rows = sessions.map((s) => {
  const loc = findJsonlForSession(s.sessionId);
  const lastSeenMs = loc ? statSync(loc.jsonl).mtimeMs : null;
  const cwd = loc?.cwd ?? null;
  const branch = cwd ? getBranch(cwd) : null;
  return {
    pid: s.pid,
    etime: s.etime,
    sessionId: s.sessionId,
    cwd,
    branch,
    lastSeenMs,
    lastSeenAgo: lastSeenMs ? fmtAgo(lastSeenMs) : null,
  };
});

// 3. Aggregate + sort (shared by both text and JSON output)
const generated = new Date().toISOString();
const totalCount = rows.length;
const liveCount = rows.filter(
  (r) => r.lastSeenMs && Date.now() - r.lastSeenMs < 5 * 60_000,
).length;
const noResumeCount = rows.filter((r) => !r.sessionId).length;

// Sort: most recently active first; processes without sessionId last
rows.sort((a, b) => {
  if (a.lastSeenMs && !b.lastSeenMs) return -1;
  if (!a.lastSeenMs && b.lastSeenMs) return 1;
  return (b.lastSeenMs ?? 0) - (a.lastSeenMs ?? 0);
});

// 4. JSON format — emit machine-readable payload, then exit.
//    Schema mirrored in ADR-019 §eva:sessions JSON contract.
if (FORMAT === "json") {
  const payload = {
    generated,
    total: totalCount,
    recentlyActive: liveCount,
    processesNoResume: noResumeCount,
    sessions: rows.map((r) => ({
      pid: r.pid,
      etime: r.etime,
      sessionId: r.sessionId,
      cwd: r.cwd,
      branch: r.branch,
      lastSeenMs: r.lastSeenMs,
      lastSeenAgo: r.lastSeenAgo,
    })),
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

// 5. Text format — unchanged human-readable rendering.
console.log(
  `Active Claude Code sessions · derived from ps + ~/.claude/projects · generated ${generated}\n`,
);
console.log(
  `Total: ${totalCount}  ` +
    `${color("recently_active=" + liveCount, "32")}  ` +
    `${color("processes_no_resume=" + noResumeCount, "37")}\n`,
);

if (rows.length === 0) {
  console.log(color("(no live claude processes)", "37"));
  process.exit(0);
}

const widths = { pid: 7, etime: 10, branch: 38, cwd: 30, last: 12 };
const header = [
  "PID".padEnd(widths.pid),
  "RUN".padEnd(widths.etime),
  "BRANCH".padEnd(widths.branch),
  "CWD".padEnd(widths.cwd),
  "LAST".padEnd(widths.last),
].join("  ");
console.log(color(header, "1"));
console.log("-".repeat(header.length));

for (const r of rows) {
  const cwdDisplay = r.cwd ? r.cwd.replace(HOME, "~") : color("(unresolved)", "37");
  const branchDisplay = r.branch ?? color("-", "37");
  const lastDisplay = r.lastSeenAgo ?? color("(no jsonl)", "37");
  const row = [
    String(r.pid).padEnd(widths.pid),
    String(r.etime).padEnd(widths.etime),
    String(branchDisplay).slice(0, widths.branch).padEnd(widths.branch),
    String(cwdDisplay).slice(0, widths.cwd).padEnd(widths.cwd),
    String(lastDisplay).slice(0, widths.last).padEnd(widths.last),
  ].join("  ");
  console.log(row);
  if (r.sessionId) {
    console.log(`  ${color("session=" + r.sessionId, "37")}`);
  }
}

console.log("");
console.log(
  color(
    "Pure derived view — no registration / no heartbeat / no schema. Recency from jsonl mtime.",
    "37",
  ),
);
