# ADR-0013 — Worktree + PR + Risk-Triggered 双 Reviewer

**状态**：Accepted（2026-05-03，M-1 第 4 项核心契约）

**Decider**：用户 + reviewer-cross + reviewer-architecture（M-1 ritual）

**关联**：[HARNESS_PR_GUIDE.md](../HARNESS_PR_GUIDE.md) · [HARNESS_AGENTS.md §3](../HARNESS_AGENTS.md) · [HARNESS_ROADMAP §0 #7 / §13 / §16 / §17](../HARNESS_ROADMAP.md)

---

## Context

agent 改主仓库的安全防线。Devin / Cursor BugBot 都用类似模式，但要点在**单线程写 + 多线程评**（Cognition 总结："writes single-threaded, reviewers contribute findings, not actions"）。

claude-web harness 必须满足：
- agent 默认无生产凭据 / 无 force push 权限 / 无 main 直推权限
- 风险高的改动（DB migration / cross-package / security）双 reviewer
- 普通 CRUD risk-triggered 单 reviewer 即可，不一刀切（Round 1 评审已采纳）

---

## Decision

### 1. Worktree 隔离（每 Issue 一个）

每个 Issue 创建专属 git worktree：`<projectCwd>/.worktrees/<issueId>`，分支 `harness/<issueId>-<slug>`。

约束：
- 一个 Issue 一个 worktree（不复用）
- agent spawn cwd = worktree path（**永不**主 cwd）
- worktree merge 后由 worktree.ts 自动清理

### 2. PR 强制流程

每 Issue 一个 PR（多 commit OK）。PR 模板字段强制：
- Issue 链接 / Stage kind / AgentProfile / Reviewer Verdicts / Decision 历史 / 回滚预案 / changelog 摘要 / cost

merge 仅当：
- ✅ Reviewer Verdict 全 ≥ 4.0/5
- ✅ 用户 Decision approved
- ✅ CI 全绿（git-guard + prod-guard）

merge 方式：仅 squash merge。

### 3. Risk-Triggered 双 Reviewer

不一刀切全 Issue 双 reviewer。触发条件（任一即触发）：
- `Issue.priority = high` 或 `critical`
- `Issue.labels` 含 `security` / `migration` / `cross-package`
- 用户在 spec 阶段手动标 `risk=high`
- **Hotfix 默认 risk=high**（Round 1 arch MINOR-9 修正）—— `harness/hotfix-*` 分支跳过 spec 阶段意味着 risk_high 信号永远不会从 spec 来，但 hotfix 通常是生产事故场景，恰恰高风险。除非 PR 描述显式标 `hotfix-risk: low` 并写理由（用户审一次后允许），否则双 reviewer 强制

否则单 reviewer + 用户审。M3 起根据 dogfood 漏检率数据决定是否升级全量双 reviewer。

### 4. Reviewer 独立性约束

reviewer 的 ContextBundle **严格只含** spec.md + design_doc.md + patch + diff（详见 [ADR-0014 §1](ADR-0014-context-bundle-explicit.md) + [HARNESS_AGENTS.md §3](../HARNESS_AGENTS.md)）。**不读** Coder transcript / sibling reviewer verdict。

实操：[review-orchestrator.ts](../../packages/backend/src/review-orchestrator.ts)（M2 引入）通过 Context Manager 强制 enforce；违反 → Verdict 失效需重跑。

### 5. Single-Threaded Writes（Cognition 教训）

**只有 Coder 改代码**。Reviewer 只产 findings 不改代码（Devin Review 模式）。这避免：
- 多 agent 并发改同一文件
- Blame 归属混乱（"是谁修的 bug"）
- merge race

并行 N 个 Issue 的 N 个 Coder 各自 worktree 隔离 → 不抢资源。

---

## 防线（不可逆操作沙箱，§0 #16+#17）

### git-guard.mjs（pre-push hook）

阻止：
- ❌ force push to `main` / `master`（其他分支 force-with-lease 允许）
- ❌ `--no-verify` 跳 hook
- ❌ `--no-gpg-sign`
- ❌ commit author 为空

dev 测试：[scripts/test-git-guard.mjs](../../packages/backend/scripts/test-git-guard.mjs)（M-1 内含拒绝场景）

### prod-guard.mjs（agent 调用前）

阻止以下未走 dry-run + 人审：
- DB migration（生产 DB 凭据）
- 真实三方 API 调用（付费 / 不可逆）
- 部署命令（`gh release` / `vercel deploy` 等）
- `rm -rf` / `truncate` / `DROP TABLE` 类破坏性命令

dev 测试：[scripts/test-prod-guard.mjs](../../packages/backend/scripts/test-prod-guard.mjs)

### 凭据隔离

worktree 内独立 `.env`（不继承主进程）。M2 [worktree.ts](../../packages/backend/src/worktree.ts) 创建时 cp 一份只含 dev / sandbox 凭据的 `.env`，永不指向 prod secrets。

---

## Consequences

**Pros**：
- ✅ agent 即使被 prompt injection 也无法 force push main
- ✅ Reviewer 看到的就是 PR 的合规视图，不被 author 推理污染
- ✅ Risk-triggered 减少 high-volume 低风险任务的 review 成本
- ✅ Single-threaded writes 与 Cognition 经验对齐
- ✅ Worktree 隔离允许多 Issue 真实并行（[资源锁见 §0 #17](../HARNESS_ROADMAP.md)）

**Cons**：
- ❌ Hotfix 也要走 worktree + PR — 比直接改 main 慢一拍。`harness/hotfix-*` 前缀缩短流程但不绕过
- ❌ Squash-only merge 丢失 worktree 内 commit 序列（commit 序列在分支保留可查）
- ❌ M2 实施成本：[worktree.ts](../../packages/backend/src/worktree.ts) + [pr-manager.ts](../../packages/backend/src/pr-manager.ts) + [review-orchestrator.ts](../../packages/backend/src/review-orchestrator.ts) + [resource-lock.ts](../../packages/backend/src/resource-lock.ts) 四个模块

---

## 替代方案及为何驳回

| 方案 | 驳回理由 |
|---|---|
| 不用 worktree，直接 branch checkout | 单 cwd 多分支不能并行；agent A 切换破坏 agent B 的 in-flight 文件 |
| 全 Issue 双 reviewer（不 risk-triggered） | M2 早期数据少，全双 reviewer 浪费成本；Round 1 评审第一轮已挑出（cross 不接受全量） |
| Reviewer 也能改代码（提议 fix） | Cognition 明确："writes single-threaded"；混合 review + edit 破坏归属 + 引入 merge race |
| 不做 prod-guard，靠 prompt 约束 | prompt injection 攻击面太大；硬性脚本守门最稳 |

---

## 与其他 ADR 的关系

- [ADR-0014](ADR-0014-context-bundle-explicit.md)：reviewer ContextBundle 独立性是本 ADR §"#4 Reviewer 独立性约束" 的协议层 enforce
- [ADR-0010](ADR-0010-sqlite-fts5.md)：PR 数据落 `harness.db.review_verdict` + `harness.db.decision`
- [ADR-0011](ADR-0011-server-driven-thin-shell.md)：双 reviewer 触发规则（risk-triggered config）通过 server-driven config 下发，可热改
- [ADR-0015](ADR-0015-schema-migration.md)：DB migration 走 prod-guard 守门
