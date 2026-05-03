我会直接基于你贴出的 artifact 内容做独立 cross-review，只输出 verdict markdown，不读文件、不跑命令、不改任何东西。# Cross Review — harness M-1 context/pr/methodology contracts

**Reviewer**: reviewer-cross  
**Model**: gpt-5.5-medium (via cursor-agent CLI)  
**Date**: 2026-05-03 02:53  
**Files reviewed**:
- docs/HARNESS_CONTEXT_PROTOCOL.md
- docs/adr/ADR-0014-context-bundle-explicit.md
- docs/HARNESS_PR_GUIDE.md
- docs/adr/ADR-0013-worktree-pr-double-reviewer.md
- docs/COMMIT_CONVENTION.md
- docs/branch-naming.md
- packages/backend/scripts/git-guard.mjs
- packages/backend/scripts/prod-guard.mjs
- packages/backend/scripts/test-prod-guard.mjs
- packages/backend/scripts/test-git-guard.mjs
- methodologies/00-discovery.md
- methodologies/01-spec.md

---

## Summary

- Blockers: 2
- Majors: 5
- Minors: 4
- 总体判断：必须先修

## Findings

### B1 [BLOCKER] ContextBundle 隔离与“允许 grep worktree”互相冲突

**Where**: `docs/HARNESS_CONTEXT_PROTOCOL.md §6`；`docs/adr/ADR-0014-context-bundle-explicit.md §Decision #1`  
**Lens**: 安全 / 跨端对齐  
**Issue**: 文档同时要求“agent 输入 = ContextBundle，绝不是整个 repo”，又允许 agent 在 worktree 副本里 grep，只是不允许读非 ContextBundle 文件。  
**Why this is a blocker**: `grep` 本身会返回匹配行内容；只要能对整个 worktree grep，就等价于可读取非 Bundle 文件片段，核心安全边界不可 enforce。  
**Suggested fix**: 改成一种可执行边界：只把 ContextBundle materialize 到独立只读目录，agent 的 grep/read 只能作用于该目录；或者完全禁止 grep worktree，仅允许 Context Manager 预先选入 Artifact。

### B2 [BLOCKER] git-guard 声称能阻止 `--no-verify`，但 pre-push hook 会被它跳过

**Where**: `docs/HARNESS_PR_GUIDE.md §9`；`docs/adr/ADR-0013-worktree-pr-double-reviewer.md §git-guard.mjs`；`packages/backend/scripts/git-guard.mjs` `FORBIDDEN_FLAGS`  
**Lens**: 安全 / 正确性  
**Issue**: `git push --no-verify` 会跳过 pre-push hook，因此 hook 内检查 argv 不能阻止该 flag。  
**Why this is a blocker**: 这是不可逆操作沙箱的核心防线之一，当前设计给出的是“看起来有防线、实际可绕过”的安全承诺。  
**Suggested fix**: 不再把 pre-push hook 描述为能拦截 `--no-verify`。把该检查放到 agent shell wrapper / prod-guard 执行前、CI、GitHub branch protection 或 server-side hook；文档同步改成“本地 hook 只能防误操作，不能防主动绕过”。

### M1 [MAJOR] Stage 默认选择表不是可机器执行的 `ArtifactKindGlob`

**Where**: `docs/HARNESS_CONTEXT_PROTOCOL.md §2` vs `§3`  
**Lens**: 跨端对齐 / 正确性  
**Issue**: §2 定义 `ArtifactKindGlob` 形如 `spec` / `review_*` / `current-issue.spec`，但 §3 表里写的是 `Initiative.intent`、`现状摘要`、`相关源文件 grep`、`merged PR` 等自然语言 selector。  
**Suggested fix**: 定义正式 selector schema，例如 `{ kind, scope, source, required, maxItems, freshness }`，并把 §3 表改成该 schema 的实例；自然语言说明只能做注释。

### M2 [MAJOR] fail-loud 与新项目首轮运行冲突

**Where**: `methodologies/00-discovery.md §1`；`methodologies/01-spec.md §1`  
**Lens**: 正确性 / 简化  
**Issue**: Discovery 把 telemetry、inbox、最近 git log、IDEAS、IMPROVEMENTS 都列为必填；Spec 把“类似 Issue 的 spec.md”列为必填。新项目或首个 Issue 很可能没有 telemetry/inbox/类似 spec。  
**Suggested fix**: 把“可能为空但合法”的来源改成 `mayInclude`，或明确 `requiredButMayBeEmpty` 语义。类似 spec 应该是“最多 3 份，0 份合法”，不能作为普通 mustInclude。

### M3 [MAJOR] Review gate 用数字评分，但 reviewer-cross 产物没有数字字段

**Where**: `docs/HARNESS_PR_GUIDE.md §5`；`methodologies/01-spec.md §5`；reviewer-cross Verdict Output Format  
**Lens**: 跨端对齐  
**Issue**: PR merge 规则要求 Reviewer Verdict 全部 `≥ 4.0/5`，Spec QA 也定义 0..5 维度评分；但 reviewer-cross 的标准产物是 blocker/major/minor markdown，没有强制 numeric score。  
**Suggested fix**: 给 `ReviewVerdict` 契约补齐统一字段：`overallScore`、`dimensionScores`、`blockingFindings[]`。同时规定 blocker 存在时 score 上限，例如最高 3.9。

### M4 [MAJOR] prod-guard 的正则边界挡不住文档声称要挡的破坏命令

**Where**: `packages/backend/scripts/prod-guard.mjs` `FORBIDDEN_HARD`  
**Lens**: 安全  
**Issue**: `rm -rf` 只拦字面量 `/` 且顺序固定，漏掉 `rm -fr`、`rm -rf "$HOME/x"`、`rm -rf ~/x`、相对路径删除等；shell 转义、换行、变量展开也容易绕过。  
**Suggested fix**: 不要把 regex scanner 当成强安全边界。至少先用 shellwords/tokenizer 解析 argv，再做命令级策略；更稳的是 agent shell wrapper 默认 allowlist，危险命令 require approval。

### M5 [MAJOR] “worktree 内独立 .env，不继承主进程”描述不成立

**Where**: `docs/adr/ADR-0013-worktree-pr-double-reviewer.md §凭据隔离`；`docs/HARNESS_PR_GUIDE.md §9`  
**Lens**: 安全 / 跨端对齐  
**Issue**: 复制一份 worktree `.env` 不能阻止 child process 继承父进程环境变量里的 prod secrets。  
**Suggested fix**: 在 M2 `worktree.ts` / runner 契约里明确 `spawn env` 使用 allowlist，默认清空敏感变量，只注入 sandbox/dev 凭据；`.env` 只能作为补充，不是隔离机制。

### m1 [MINOR] commit convention 的 subject 规则与示例冲突

**Where**: `docs/COMMIT_CONVENTION.md §1` vs `§4`  
**Lens**: 正确性  
**Issue**: Subject 规则写“全小写”，示例却有 `unifiedCreditCode`、`Issue`、`Coder Agent` 等大小写。  
**Suggested fix**: 改成“英文普通词小写；代码标识符、专有名词可保留大小写”。

### m2 [MINOR] branch 命名要求 issueId 必须存在，但预留 discovery 分支没有 issueId

**Where**: `docs/branch-naming.md §2` vs `§3`  
**Lens**: 正确性  
**Issue**: §2 说 `<issueId>` 必须存在于 issue 表；§3 又允许 `harness/discovery-<slug>`，它没有 issueId。  
**Suggested fix**: 明确 discovery/spike/sweep 是例外，并定义它们的 owner key，比如 `stageRunId` 或 `initiativeId`。

### m3 [MINOR] `git-guard` author 检查对删除 ref / 全零 localSha 未定义

**Where**: `packages/backend/scripts/git-guard.mjs` `checkCommitAuthors(localSha, remoteSha)`  
**Lens**: 正确性  
**Issue**: pre-push 删除远端分支时 `localSha` 可能是全零；当前会构造不合法 git log range 或产生误判。  
**Suggested fix**: 对 all-zero `localSha` 单独处理：删除 protected ref 直接阻止，删除非 protected ref 跳过 author 检查。

### m4 [MINOR] `prod-guard` 测试覆盖了 happy path，但没有覆盖明显绕过形式

**Where**: `packages/backend/scripts/test-prod-guard.mjs`  
**Lens**: 安全 / 正确性  
**Issue**: 测试只覆盖当前 regex 能识别的字面量，没有覆盖 `rm -fr`、变量路径、quoted path、换行、多命令串联。  
**Suggested fix**: 增加这些 reject cases；如果暂时不实现 parser，至少把文档降级为“dev guardrail，不是安全沙箱”。

## False-Positive Watch

- F? B1 是否允许 grep 的真实含义可能是“只能 grep bundle materialized files”，但文档当前没有这样写；作者应确认实现边界。
- F? M3 如果 `review_verdict` DB 已另有 numeric score 字段，本次未审该 schema 全文；但当前 artifact 间没有把 reviewer-cross markdown 映射到评分。

## What I Did Not Look At

- Did not run scripts or tests; this is static review only.
- Did not inspect actual repository files beyond the artifact text pasted in the prompt.
- Did not read author transcript, architecture reviewer verdict, or prior tool history.
- Did not verify SQLite schema, Swift Codable, or TS Zod definitions unless included in the pasted artifacts.
