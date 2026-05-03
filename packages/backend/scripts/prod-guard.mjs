#!/usr/bin/env node
// prod-guard.mjs — agent 调用前守门
//
// 关联：docs/HARNESS_PR_GUIDE.md §9 / ADR-0013 §"防线" / HARNESS_ROADMAP §0 #16
//
// **重要**（Round 1 cross M4 修正）：当前实现是 **regex scanner**，作为 **dev guardrail**，
// **不是安全沙箱**。已知漏覆盖：`rm -fr`（顺序变体）/ 变量展开（`rm -rf $HOME/x`）/
// quoted 路径 / heredoc / 多命令串联（`a && b`）/ shell 转义。M2 实施时必须改用 shellwords/
// tokenizer 解析 argv，并采用 allowlist 主导的安全模型（不在 allowlist 的命令默认 require_approval）。
// 在此之前，prod-guard 主要用于：(a) agent 流水线提示作者"该走人审"，(b) 测试场景的覆盖率守门。
//
// 阻止以下操作未走 dry-run + 人审：
// - DB migration（生产 DB 凭据）
// - 真实三方 API 调用（付费 / 不可逆）
// - 部署命令（gh release / vercel deploy 等）
// - rm -rf / truncate / DROP TABLE 类破坏性命令
//
// 用法（agent 在执行 shell 命令前 stdin 发命令字符串到 prod-guard）：
//   echo "<command>" | prod-guard.mjs --context <stage-kind>:<issueId>
// 或在 cli-runner 包装层调用：
//   const result = checkProdGuard(command, { stageKind, issueId, dryRunArtifactId });
//
// 退出码：
//   0 = allowed
//   1 = blocked（agent 不允许执行）
//   2 = require approval（需先产 dry-run Artifact + 用户 Decision approve 后才能执行）

import { argv, stdin, exit } from "node:process";

const FORBIDDEN_HARD = [
  // 立即阻止
  /\brm\s+-rf\s+\/(?!tmp\/)/,                       // rm -rf 任何非 /tmp/ 路径
  /\bgit\s+push\s+(.*\s)?--force(\s|$)/,            // git push --force（不带 -with-lease）
  /\bgit\s+push.*--force-with-lease.*\b(main|master)\b/, // force-with-lease 到 main/master 禁
  /\bgit\s+push.*\b(main|master)\b.*--force-with-lease/, // 同上但顺序不同
  /\bgit\s+reset\s+--hard\s+(origin\/)?(main|master)/, // reset --hard origin/main
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)/i,              // SQL DROP
  /\bTRUNCATE\s+TABLE/i,                            // SQL TRUNCATE
  /\b(curl|wget).*\$\{?(STRIPE|OPENAI|ANTHROPIC|TWILIO)_API_KEY/i,  // 真三方 API key 用法
];

const REQUIRE_APPROVAL = [
  // 需先 dry-run + 人审
  /pnpm.*\bmigrate\b/,
  /\bbun\s+run\s+migrate/,
  /\bnode.*migrations.*\.mjs/,
  /\bgh\s+release\s+create/,
  /\bvercel\s+(deploy|--prod)/,
  /\bnetlify\s+deploy.*--prod/,
  /\bkubectl\s+(apply|rollout|delete)/,
  /\bdocker\s+push/,
  /sudo\b/,
];

function check(command, context) {
  // 1) 硬禁
  for (const pat of FORBIDDEN_HARD) {
    if (pat.test(command)) {
      return { decision: "block", reason: `pattern matched FORBIDDEN_HARD: ${pat.source}` };
    }
  }

  // 2) 需审
  for (const pat of REQUIRE_APPROVAL) {
    if (pat.test(command)) {
      const hasDryRun = context?.dryRunArtifactId !== undefined;
      const hasApproval = context?.decisionApproved === true;
      if (!hasDryRun) {
        return {
          decision: "require_approval",
          reason: `pattern matched REQUIRE_APPROVAL: ${pat.source}; missing dryRunArtifactId in context`,
        };
      }
      if (!hasApproval) {
        return {
          decision: "require_approval",
          reason: `pattern matched REQUIRE_APPROVAL: ${pat.source}; missing user Decision approval`,
        };
      }
    }
  }

  return { decision: "allow", reason: "no forbidden pattern matched" };
}

function readContextArg() {
  const idx = argv.indexOf("--context");
  if (idx === -1) return undefined;
  const ctx = argv[idx + 1];
  if (!ctx) return undefined;
  const [stageKind, issueId] = ctx.split(":");
  return { stageKind, issueId };
}

async function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    if (stdin.isTTY) return resolve("");
    stdin.setEncoding("utf-8");
    stdin.on("data", (c) => (buf += c));
    stdin.on("end", () => resolve(buf.trim()));
  });
}

async function main() {
  const command = await readStdin();
  if (!command) {
    console.error("prod-guard: no command on stdin");
    exit(64);
  }

  const context = readContextArg();
  const r = check(command, context);

  console.log(`prod-guard: ${r.decision.toUpperCase()} — ${r.reason}`);

  switch (r.decision) {
    case "allow":          exit(0);
    case "require_approval": exit(2);
    case "block":          exit(1);
  }
}

// Export for programmatic use (cli-runner wrapper)
export function checkProdGuard(command, context) {
  return check(command, context);
}

// Run if invoked directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("prod-guard fatal:", err);
    exit(1);
  });
}
