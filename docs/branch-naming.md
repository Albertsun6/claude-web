# Branch Naming

> harness 流水线 + 人工 branch 命名规约（M-1 v1.0，2026-05-03）。
>
> 关联：[HARNESS_PR_GUIDE.md §2](HARNESS_PR_GUIDE.md) · [ADR-0013](adr/ADR-0013-worktree-pr-double-reviewer.md)

---

## 1. 主分支

- `main` — 唯一真相分支。永不 force push（[git-guard.mjs](../packages/backend/scripts/git-guard.mjs) enforce）
- `master` — 历史分支别名；同样保护

---

## 2. harness 流水线分支

格式：

```
harness/<issueId>-<3-5-word-slug>
```

例：
- `harness/iss-01HJK5XB0CDEF03-add-credit-code`
- `harness/iss-01HJK5XB0CDEF03-customer-unifiedcode`

约束：
- `<issueId>` 必须存在于 [harness.db.issue](../docs/HARNESS_DATA_MODEL.md) — Coder agent 创建分支前 [worktree.ts](../packages/backend/src/worktree.ts)（M2）查表
- slug 是 issue.title 的 3-5 词缩写（kebab-case，全小写，去 stop-words）
- slug 不超过 30 字符
- 一个 Issue 只一个 worktree branch（重新跑 stage 不开新 branch；force-push-with-lease 到同一 branch 即可）

**例外**（Round 1 cross m2 修正）：
- `harness/discovery-<slug>` / `harness/spike-<slug>` / `harness/sweep-<scope>-<date>` 这三类预留前缀**没有 issueId**。它们的 owner key 改用 `stageRunId`（discovery）、`initiativeId`（spike）、`scope+date`（sweep）。worktree.ts 创建时按前缀查不同的 owner 表。

---

## 3. 预留前缀

| 前缀 | 用途 | 流水线特殊化 |
|---|---|---|
| `harness/discovery-<slug>` | discovery Stage 短任务 | 跳过 Coder Stage，stage.kind=discovery 上 |
| `harness/hotfix-<id>-<slug>` | 紧急 hotfix | **跳过 strategy / discovery / spec**；从 design 起步 |
| `harness/spike-<slug>` | 探索性 spike（throw-away） | merge 前必须显式 close；不进 main |
| `harness/sweep-<scope>-<date>` | 周期性清理（cron 或 /schedule 触发） | recurring scope；e.g. `harness/sweep-deps-2026-05-03` |

---

## 4. 人工分支（非 harness 流水线）

格式更宽松，但仍不允许：
- ❌ 空格 / 中文（git 兼容性）
- ❌ `master` / `main` / `head` / `tag` 作为名（reserved）
- ❌ `..` / `~` / `^` / `:` / `?` / `*` / `[` 等 git ref 非法字符

推荐格式：
```
<type>/<short-desc>
```

例：
- `feat/voice-recorder`
- `fix/keyboard-overlap`
- `refactor/conversation-store`

---

## 5. PR 分支生命周期

1. 创建：`git worktree add .worktrees/<issueId> -b harness/<issueId>-<slug> main`
2. 工作：在 worktree 内 commit；force-push-with-lease 允许（仅自己的 branch）
3. PR：`gh pr create` — 自动生成模板（[pr-manager.ts](../packages/backend/src/pr-manager.ts) M2）
4. merge：squash to main
5. 清理：merge 后 `git worktree remove .worktrees/<issueId>` + 删除 remote branch

---

## 6. 禁止

- ❌ 直接基于其他 harness/* branch 开新分支（每个 Issue 独立 branch from `main`）
- ❌ 跨 Issue 复用 branch（merge 后 branch 应删除）
- ❌ 长期长支（> 30 天未 merge 应 close 重建，避免与 main divergence）
