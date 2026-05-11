# Vessel 评审目录（reviews/）

存放每一轮 plan / ADR / milestone 改动的评审 verdict 文件。这是项目长期记忆的一部分，**不删**。

## 文件命名规则

```
<artifact>-<phase>-<role>-<TS>.md
```

- `<artifact>`：被评审的对象，如 `v5.4-self-review` / `M0` / `ADR-002`
- `<phase>`：`p1`（Phase 1 隔离评审）/ `p2`（Phase 2 cross-pollinate）/ `p3`（Phase 3 仲裁矩阵）
- `<role>`：`architect` / `pragmatist` / `risk-officer` / `researcher` / `arbiter`
- `<TS>`：`YYYY-MM-DD-HHMM`

例：
- `v5.4-self-review-p1-architect-2026-05-09-2110.md`
- `v5.4-self-review-p1-pragmatist-2026-05-09-2110.md`
- `v5.4-self-review-p3-arbiter-2026-05-09-2130.md`

## 工作流（v5.4 0-meta-lite 手动版）

按 [`docs/adr/vessel/ADR-014-review-workflow.md`](../adr/vessel/ADR-014-review-workflow.md) 的 B' 方案执行。

### Phase 0 — 外部调研（仅在 DAR 触发条件下跑）

由 author 直接召唤 `general-purpose` Agent 或用 WebSearch / WebFetch 做调研。产出 `docs/research/<topic>-<YYYY-MM-DD>.md`，按 [docs/research/README.md](../research/README.md) 的 10 段模板。**必须满足 DAR yes/no 检查表任一项才跑**——否则跳过。

### Phase 1 — 三角隔离评审

按 ADR-014 附录的 3 个 reviewer prompt 草稿，**轮流**用每个 prompt 评审同一份 artifact，输出 3 份 verdict：
- `<artifact>-p1-architect-<TS>.md`
- `<artifact>-p1-pragmatist-<TS>.md`
- `<artifact>-p1-risk-officer-<TS>.md`

每份 verdict 至少包含：
- **Findings 清单**：每条标级别（BLOCKER / MAJOR / MINOR）+ 简短描述 + 引用位置
- **Decision-required 标记**（如有）：标 owner 必须拍板的 finding
- **Risk callouts**（如有）：触及 4 类硬触发的（secrets / license / CVE / 破坏性数据迁移）

### Phase 2 — Cross-pollinate

reviewer 互看对方 verdict，写 react verdict。文件名 `<artifact>-p2-<role>-react-<TS>.md`。

每条 finding 标 4 档：
- `agree`
- `disagree-with-evidence`
- `refine`
- `not-reviewed`

**硬约束**：3 份 react verdict 加起来 ≥ 1 条 `disagree-with-evidence` 或 `refine`，否则视为全 agree 退化（Fagan 原则），重跑 Phase 1。

### Phase 3 — 仲裁矩阵

author 用 [`debate-review` SKILL](file:///Users/yongqian/.claude/skills/debate-review/SKILL.md) 仲裁，输出 `<artifact>-p3-arbiter-<TS>.md`，包含：
- 4 档判断矩阵（✅ accepted / ⚠️ partial / 🚫 rejected-with-reason / 🟡 deferred-with-owner+date）
- 修复落地说明（accepted 的 finding 在哪个文件改了）
- 反向挑战（给下一轮评审者）

最后跑 [Verify Gate 5 项](../adr/vessel/ADR-014-review-workflow.md#verify-gate-5)。

## Secrets 扫描（每次 dogfood 前 + pre-commit 推荐）

```bash
# 安装一次：
brew install gitleaks

# 扫当前工作树：
gitleaks detect --no-git --verbose --source . --report-path /tmp/gitleaks-report.json

# 扫 git 历史（fork-rename 之前必跑）：
gitleaks detect --verbose --source . --report-path /tmp/gitleaks-history.json

# 推荐 pre-commit hook（`.git/hooks/pre-commit`）：
#!/bin/sh
gitleaks protect --staged --verbose || exit 1
```

详见 [ADR-014 §「硬触发 #5」](../adr/vessel/ADR-014-review-workflow.md)。

## 索引（按时间倒序，手动维护）

| 日期 | Artifact | Phase 完成 | Verify Gate |
|---|---|---|---|
| 2026-05-09 | v5.4 plan dogfood self-review | P1 + P2 + P3 ✓ | 5 项手动跑（见 verify-gate-2026-05-09-result.md） |

> 自动索引（`reviews.jsonl`）暂缓到 future iteration（v5.4 评审 AI 建议手动维护即可）。
