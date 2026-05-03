#!/usr/bin/env node
// git-guard.mjs — pre-push hook + standalone CLI 守门
//
// 关联：docs/HARNESS_PR_GUIDE.md §6 + §9 / ADR-0013 §"防线"
//
// 阻止：
// - force push 到 main / master（worktree 分支用 force-with-lease 允许）
// - --no-verify 跳 hook
// - --no-gpg-sign 绕签名
// - commit author 为空
//
// 安装：链接到 .git/hooks/pre-push:
//   ln -sf ../../packages/backend/scripts/git-guard.mjs .git/hooks/pre-push
//
// 测试：node packages/backend/scripts/test-git-guard.mjs
//
// fail-closed：任何检查失败 → exit 1，git push 中止

import { execSync, spawnSync } from "node:child_process";
import { argv, stdin, exit } from "node:process";

const PROTECTED_REFS = ["refs/heads/main", "refs/heads/master"];
const FORBIDDEN_FLAGS = ["--no-verify", "--no-gpg-sign"];

/** Read pre-push hook stdin: "<local-ref> <local-sha> <remote-ref> <remote-sha>" per line */
function readPushList() {
  return new Promise((resolve) => {
    let buf = "";
    if (stdin.isTTY) return resolve([]);  // standalone test mode
    stdin.setEncoding("utf-8");
    stdin.on("data", (c) => (buf += c));
    stdin.on("end", () => {
      resolve(
        buf.split("\n").filter(Boolean).map((line) => {
          const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
          return { localRef, localSha, remoteRef, remoteSha };
        }),
      );
    });
  });
}

function isForcePush(localSha, remoteSha) {
  if (!remoteSha || remoteSha === "0000000000000000000000000000000000000000") return false;
  // 检测：localSha 不是 remoteSha 的祖先 → force push
  const r = spawnSync("git", ["merge-base", "--is-ancestor", remoteSha, localSha], { encoding: "utf-8" });
  return r.status !== 0;
}

const ZERO_SHA = "0000000000000000000000000000000000000000";

function checkCommitAuthors(localSha, remoteSha) {
  // Round 1 cross m3 修正：删除 ref 时 localSha 全零，git log 会失败。
  // 删除 protected ref 由调用层（main check）处理；这里仅在删除非 protected ref 时跳过 author 检查。
  if (localSha === ZERO_SHA) return [];

  const range = remoteSha && remoteSha !== ZERO_SHA
    ? `${remoteSha}..${localSha}`
    : localSha;
  try {
    const out = execSync(`git log --format='%an|%ae' ${range}`, { encoding: "utf-8" });
    return out.split("\n").filter(Boolean).filter((line) => {
      const [name, email] = line.replaceAll("'", "").split("|");
      return !name?.trim() || !email?.trim() || email.includes("noreply.example") || email === "<>";
    });
  } catch {
    return [];
  }
}

function checkForbiddenFlags() {
  const flags = argv.slice(2);
  return flags.filter((f) => FORBIDDEN_FLAGS.includes(f));
}

async function main() {
  const failures = [];
  const list = await readPushList();

  // Standalone CLI 模式（无 stdin push list）：只检查 forbidden flags
  if (list.length === 0) {
    const badFlags = checkForbiddenFlags();
    if (badFlags.length > 0) {
      console.error(`✗ git-guard: forbidden flags: ${badFlags.join(", ")}`);
      exit(1);
    }
    console.log("git-guard: standalone CLI ok (no push list)");
    exit(0);
  }

  for (const { localRef, localSha, remoteRef, remoteSha } of list) {
    // 1) Force push to protected refs
    if (PROTECTED_REFS.includes(remoteRef) && isForcePush(localSha, remoteSha)) {
      failures.push(`force push to ${remoteRef} (protected) blocked`);
    }

    // 1.5) Delete protected ref（Round 1 cross m3 修正：localSha=0..0 表示删除）
    if (PROTECTED_REFS.includes(remoteRef) && localSha === ZERO_SHA) {
      failures.push(`delete of protected ref ${remoteRef} blocked`);
    }

    // 2) Empty author（删除 ref 时跳过；checkCommitAuthors 内部也跳）
    const badAuthors = checkCommitAuthors(localSha, remoteSha);
    if (badAuthors.length > 0) {
      failures.push(`commits with empty/invalid author: ${badAuthors.length} commit(s)`);
    }
  }

  // 3) Forbidden flags（虽然 pre-push hook 阶段已经太晚，但 standalone CLI 调用时有用）
  const badFlags = checkForbiddenFlags();
  if (badFlags.length > 0) {
    failures.push(`forbidden flags: ${badFlags.join(", ")}`);
  }

  if (failures.length > 0) {
    console.error("✗ git-guard: push BLOCKED");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("\n如需例外，开 issue 走 ADR ritual。绝不允许 --no-verify / --no-gpg-sign 绕开。");
    exit(1);
  }

  console.log(`git-guard: OK (${list.length} ref(s) checked)`);
  exit(0);
}

main().catch((err) => {
  console.error("git-guard fatal:", err);
  exit(1);  // fail-closed
});
