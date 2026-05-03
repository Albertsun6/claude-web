#!/usr/bin/env node
// M-1 守门：检查 4 个核心契约 + 方法论的关键 artifact 是否真实存在。
// 用 fs.existsSync，不允许 doc 自报 [x]。
//
// 用法：node scripts/verify-m1-deliverables.mjs
// 退出码：0 = 全部存在；1 = 有缺失（CI 应当 fail）。
//
// Round 1 评审 BLOCKER-1 的根因：HARNESS_PROTOCOL.md §8 五条 [x] 全部不存在但被当作完工。
// 本脚本是修复："文件存在性可信，[x] 不可信"。

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 每条：path + which contract owns it + 是否 M-1 必产 */
const DELIVERABLES = [
  // 契约 #1 数据模型 ✅
  { path: "docs/HARNESS_DATA_MODEL.md",                              contract: "#1 data-model",  required: true },
  { path: "docs/adr/ADR-0010-sqlite-fts5.md",                        contract: "#1 data-model",  required: true },
  { path: "docs/adr/ADR-0015-schema-migration.md",                   contract: "#1 data-model",  required: true },
  { path: "packages/backend/src/migrations/0001_initial.sql",        contract: "#1 data-model",  required: true },
  { path: "packages/backend/src/harness-store.ts",                   contract: "#1 data-model",  required: true },
  { path: "packages/backend/src/test-harness-schema.ts",             contract: "#1 data-model",  required: true },

  // 契约 #2 协议
  { path: "docs/HARNESS_PROTOCOL.md",                                contract: "#2 protocol",    required: true,  note: "doc only at start of M-1" },
  { path: "docs/adr/ADR-0011-server-driven-thin-shell.md",           contract: "#2 protocol",    required: true },
  { path: "packages/shared/src/harness-protocol.ts",                 contract: "#2 protocol",    required: true },
  { path: "packages/shared/fixtures/harness/",                       contract: "#2 protocol",    required: true,  isDir: true },
  { path: "packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift", contract: "#2 protocol", required: true },
  { path: "packages/shared/src/__tests__/harness-protocol.test.ts",  contract: "#2 protocol",    required: true },

  // 契约 #3 ContextBundle
  { path: "docs/HARNESS_CONTEXT_PROTOCOL.md",                        contract: "#3 context",     required: true },
  { path: "docs/adr/ADR-0014-context-bundle-explicit.md",            contract: "#3 context",     required: true },

  // 契约 #4 PR/worktree
  { path: "docs/HARNESS_PR_GUIDE.md",                                contract: "#4 pr",          required: true },
  { path: "docs/adr/ADR-0013-worktree-pr-double-reviewer.md",        contract: "#4 pr",          required: true },
  { path: ".github/PULL_REQUEST_TEMPLATE.md",                        contract: "#4 pr",          required: true },
  { path: "docs/COMMIT_CONVENTION.md",                               contract: "#4 pr",          required: true },
  { path: "docs/branch-naming.md",                                   contract: "#4 pr",          required: true },
  { path: "packages/backend/scripts/git-guard.mjs",                  contract: "#4 pr",          required: true },
  { path: "packages/backend/scripts/prod-guard.mjs",                 contract: "#4 pr",          required: true },

  // 方法论
  { path: "methodologies/00-discovery.md",                           contract: "methodology",    required: true },
  { path: "methodologies/01-spec.md",                                contract: "methodology",    required: true },

  // Review Mechanism v2 (2026-05-03)
  { path: "docs/proposals/REVIEW_MECHANISM_V2.md",                   contract: "review-v2",      required: true },
  { path: "scripts/run-debate-phase.sh",                             contract: "review-v2",      required: true },
];

let missing = 0;
let present = 0;
const byContract = new Map();

for (const d of DELIVERABLES) {
  const abs = join(ROOT, d.path);
  const ok = existsSync(abs);
  if (ok) present++; else missing++;
  if (!byContract.has(d.contract)) byContract.set(d.contract, { ok: 0, miss: 0, items: [] });
  const bucket = byContract.get(d.contract);
  if (ok) bucket.ok++; else bucket.miss++;
  bucket.items.push({ ok, path: d.path, note: d.note });
}

console.log("M-1 deliverables verification\n");

for (const [contract, bucket] of byContract) {
  const status = bucket.miss === 0 ? "✅" : (bucket.ok === 0 ? "⛔" : "⚠️ ");
  console.log(`${status} ${contract}  (${bucket.ok}/${bucket.ok + bucket.miss})`);
  for (const item of bucket.items) {
    const mark = item.ok ? "  ✓" : "  ✗";
    const note = item.note ? `  — ${item.note}` : "";
    console.log(`${mark} ${item.path}${note}`);
  }
  console.log();
}

console.log(`Total: ${present} present, ${missing} missing.`);

if (missing > 0) {
  console.error(`\nM-1 INCOMPLETE: ${missing} deliverables missing.`);
  process.exit(1);
}

console.log("\nAll M-1 deliverables present. ✅");
process.exit(0);
