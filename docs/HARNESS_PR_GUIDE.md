# Harness PR & worktree Guide

> **状态**：M-1 第 4 项核心契约 v1.0（2026-05-03）。
>
> **导航**：[索引](HARNESS_INDEX.md) · [Roadmap §13](HARNESS_ROADMAP.md)
>
> **配套 ADR**：[ADR-0013](adr/ADR-0013-worktree-pr-double-reviewer.md)
>
> **配套规约**：
> - [docs/COMMIT_CONVENTION.md](COMMIT_CONVENTION.md)
> - [docs/branch-naming.md](branch-naming.md)
> - [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md)
> - [packages/backend/scripts/git-guard.mjs](../packages/backend/scripts/git-guard.mjs)
> - [packages/backend/scripts/prod-guard.mjs](../packages/backend/scripts/prod-guard.mjs)

---

## 0. 目标与约束

agent 写入主仓库的安全防线。无论 Coder agent 多么"聪明"，必须满足：

1. **零混乱代码管理**：worktree 隔离 + PR 流程 + risk-triggered 双 reviewer + 强制模板
2. **不可逆操作守门**：禁用 `git push -f` / `--no-verify` / `git reset --hard origin/*` / 跳 hook
3. **agent 默认不能改 main**：所有写入走 `harness/<issue-slug>` 分支 → PR → merge

参见 [HARNESS_ROADMAP §0 #7 + §13](HARNESS_ROADMAP.md)。

---

## 1. Worktree 隔离

每个 Issue 一个 worktree，路径 `<projectCwd>/.worktrees/<issueId>`。

```bash
git worktree add .worktrees/iss-01HJK5XB0CDEF03 -b harness/iss-01HJK5XB0CDEF03-add-credit-code main
```

约束：
- 一个 Issue 一个 worktree（不复用）
- worktree 完成 + PR merge 后由 [packages/backend/src/worktree.ts](../packages/backend/src/worktree.ts)（M2 引入）自动清理
- agent spawn 时 `cwd = worktree path`，**永不**指向主 cwd
- worktree 内可用 Edit/Write；主 cwd 只读

---

## 2. Branch 命名

详见 [docs/branch-naming.md](branch-naming.md)。基本格式：

```
harness/<issueId>-<3-5word-slug>
```

预留前缀：
- `harness/discovery-*` — discovery Stage 短任务
- `harness/hotfix-*` — 跳过 strategy/discovery/spec 直接改

---

## 3. Commit 消息

详见 [docs/COMMIT_CONVENTION.md](COMMIT_CONVENTION.md)。格式：

```
<type>(<scope>): <subject>

<body>

harness-stage: <kind>
Co-Authored-By: <agent-profile>
```

`<type>` 复用现有 `feat / fix / docs / refactor / test / perf / chore`；harness 新增隐式 scope `(harness)` 表示流水线产物。

---

## 4. PR 模板

每个 Issue 一个 PR，模板见 [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md)。

强制字段（M2 引入 [pr-manager.ts](../packages/backend/src/pr-manager.ts) enforce）：
- Issue 链接
- Stage kind
- AgentProfile id
- Reviewer Verdict 列表（risk-triggered 双 reviewer 时含 2 条）
- Decision 历史（user approval rationale）
- 回滚预案
- changelog 摘要
- cost（USD + tokens）

PR 描述自动从 spec.md + design_doc.md + verdicts 拼接（M2 引入）。

---

## 5. Merge 规则

merge 仅当：
- ✅ Reviewer Verdict 全部 ≥ 4.0/5（risk-triggered 双 reviewer 时两个 verdict 都满足）
- ✅ 用户 Decision approved
- ✅ CI 全绿（包括 git-guard / prod-guard pre-push 检查）
- ❌ 任一不满足 → 必走人审

merge 方式：**仅允许 squash merge**（保持 main 干净；commit 序列在 worktree 分支保留）。

---

## 6. 回滚

发现问题：
- ✅ `git revert <commit>` — 默认方式
- ❌ `git reset --hard origin/main` — 禁止
- ❌ `git push --force` 到任何远程分支 — 禁止
- ❌ `git push --force-with-lease` 到 main/master — 禁止（worktree 分支可）

参见 [git-guard.mjs](../packages/backend/scripts/git-guard.mjs) §"forbidden 操作"。

---

## 7. 多 Issue 并行

- 不同 Issue 各自 worktree + 各自 PR；冲突按 Issue 优先级 + 时间序处理
- 同一 Issue 多次迭代不开新 PR；force-push-with-lease 到 worktree 分支允许（不是 main）
- Hotfix 走 `harness/hotfix-<id>-<slug>` 分支，跳过 strategy/discovery/spec，从 design 起步

---

## 8. 资源锁（Round 1 评审引入）

[HARNESS_ROADMAP §0 #17](HARNESS_ROADMAP.md) 资源隔离原则。每个 Issue 有专属：
- worktree
- sessionId 命名空间
- 临时文件目录
- logical port range（M2 引入 [resource-lock.ts](../packages/backend/src/resource-lock.ts)）

并行 agent 时**不允许共享可写资源**。M-1 仅约定，M2 实施。

---

## 9. 不可逆操作沙箱（Round 1 cross B2/M4/M5 修正后的诚实版本）

[HARNESS_ROADMAP §0 #16 + §17](HARNESS_ROADMAP.md)。**多层防御，单层不是"安全沙箱"**：

| 层 | 工具 | 强度 | 边界 |
|---|---|---|---|
| 1. agent shell wrapper | prod-guard.mjs CLI 模式 | 高（agent 主动绕不过自身 wrapper）| 仅在 agent 命令进入 spawn 前生效 |
| 2. 本地 git pre-push hook | git-guard.mjs | **低（dev guardrail）**| `--no-verify` 直接跳过 hook 自身。仅防误操作 |
| 3. CI / branch protection | GitHub Actions + repo settings | 高（攻击者也难绕） | 需 repo 配置；M2 引入 |
| 4. spawn env allowlist | worktree.ts spawn() | 高（清空敏感变量）| 实施在 M2 [worktree.ts](../packages/backend/src/worktree.ts)；不是单纯 cp .env |

**Round 1 cross B2 修正**：原文档把 git-guard.mjs `--no-verify` 检查写成"阻止"是误导。`git push --no-verify` 直接跳过 pre-push hook 自身——hook 内 argv 检查无效。已降级为"误操作 guardrail"。**真不可绕过守门** 必须放在 layer 1 / 3 / 4。

**Round 1 cross M4 修正**：prod-guard.mjs 当前是 regex scanner，**漏掉** `rm -fr` / 变量路径 / quoted 路径 / 多命令串联等。已在脚本内文档为"dev guardrail，不是安全沙箱"。M2 实施时改用 shellwords/tokenizer 解析 argv + allowlist 主导的安全模型。

**Round 1 cross M5 修正**：原 "worktree 内独立 .env" 不阻止子进程继承父进程环境。M2 [worktree.ts](../packages/backend/src/worktree.ts) 实施时 `spawn` 必须用 env allowlist：默认清空所有敏感变量（包括 `*_API_KEY` / `*_TOKEN` / `STRIPE_*` / `OPENAI_*` 等），仅注入 sandbox/dev 凭据。`.env` 仅作为补充注入，不是隔离机制。

详见 [docs/adr/ADR-0013-worktree-pr-double-reviewer.md](adr/ADR-0013-worktree-pr-double-reviewer.md) §"防线"（已对齐本节）。

---

## 10. M-1 完工状态

- [x] [docs/HARNESS_PR_GUIDE.md](HARNESS_PR_GUIDE.md) — 本文
- [x] [docs/adr/ADR-0013-worktree-pr-double-reviewer.md](adr/ADR-0013-worktree-pr-double-reviewer.md)
- [x] [docs/COMMIT_CONVENTION.md](COMMIT_CONVENTION.md)
- [x] [docs/branch-naming.md](branch-naming.md)
- [x] [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) — harness 段补充
- [x] [packages/backend/scripts/git-guard.mjs](../packages/backend/scripts/git-guard.mjs) + dev 拒绝场景测试
- [x] [packages/backend/scripts/prod-guard.mjs](../packages/backend/scripts/prod-guard.mjs) + dev 拒绝场景测试

**留给 M2**：
- [pr-manager.ts](../packages/backend/src/pr-manager.ts) — 自动产 PR 描述、enforce 模板字段
- [worktree.ts](../packages/backend/src/worktree.ts) — `git worktree add/remove` 自动化
- 双 reviewer risk-triggered 集成（[review-orchestrator.ts](../packages/backend/src/review-orchestrator.ts)）
- [resource-lock.ts](../packages/backend/src/resource-lock.ts) — file-lock + DB 行锁
