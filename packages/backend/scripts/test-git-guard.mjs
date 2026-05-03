#!/usr/bin/env node
// test-git-guard.mjs — dev 拒绝场景测试
//
// 测试 git-guard.mjs 的 forbidden flag 检测路径（force-push 到 main 与 author 检查
// 需要真 git history，由 e2e 流程在 M2 加）。

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUARD = join(__dirname, "git-guard.mjs");

const cases = [
  // forbidden flag 应阻断
  { args: ["--no-verify"], expected: 1, reason: "--no-verify rejected" },
  { args: ["--no-gpg-sign"], expected: 1, reason: "--no-gpg-sign rejected" },
  // 安全 flag 应放行
  { args: ["--dry-run"], expected: 0, reason: "--dry-run ok" },
  { args: [], expected: 0, reason: "no flag ok" },
];

let pass = 0, fail = 0;
for (const { args, expected, reason } of cases) {
  // 模拟无 stdin push list 的 standalone 模式（CLI 检 flag）
  const r = spawnSync("node", [GUARD, ...args], {
    encoding: "utf-8",
    input: "",          // 空 stdin → standalone CLI 模式
  });
  if (r.status === expected) {
    console.log(`✓ exit=${r.status} | ${reason} (args: ${args.join(" ") || "(none)"})`);
    pass++;
  } else {
    console.error(`✗ EXPECTED exit=${expected} GOT ${r.status} | ${reason}`);
    console.error(`  stdout: ${r.stdout.trim()}`);
    console.error(`  stderr: ${r.stderr.trim()}`);
    fail++;
  }
}

console.log(`\ngit-guard test: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
