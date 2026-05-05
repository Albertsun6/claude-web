# Eva Worktree 文件锁

并行任务开始前登记占用的核心文件/模块。**运行中 append-only**；cleanup 时把状态从 `active` 改为 `done` 或 append `released` 行，**永不删历史**（M1 双轨实验 plan §"用户 manual #5"）。

## Active Locks (M1 双轨并行实验，2026-05-05)

| Track | 文件 | 状态 | 时间 |
|---|---|---|---|
| Track 1 | packages/backend/src/scheduler.ts:computeNextStage, packages/shared/fixtures/harness/fallback-config.json (agentProfiles), docs/retrospectives/M1-mini2-stage-aware-prompts.md | active | 2026-05-05 16:00 |

> Track 2 在 `~/Desktop/claude-web-mini3` worktree（branch `feat/eva-M1-context-manager-skeleton`）独立 append 自己的行 — 合并 dev 时会出现 WORKTREE_LOCK.md merge，是实验观察点之一。

## Historical Locks（旧版表格 — 早期实践）

| worktree 分支 | 占用文件/模块 | 开始日期 | 状态 |
|---|---|---|---|
| feat/eva-M1-context-manager-skeleton | packages/backend/src/context-manager.ts; packages/backend/src/harness-queries.ts context_bundle helpers; packages/backend/src/scheduler.ts spawnAgent | 2026-05-05 | active |

## 端口隔离约定

| 实例 | PORT |
|---|---|
| main dev server | 3030 |
| worktree 1 | 3031 |
| worktree 2 | 3032 |

每个 worktree 在项目根目录建 `.env.local`（已 gitignore）写入对应 PORT：

```bash
echo "PORT=3031" > .env.local
```

## 冲突处理规则

1. 开始 worktree 任务前检查此表，有冲突文件先沟通
2. 同一文件被两个 worktree 修改时：后合入 dev 的一方 rebase 于先合入的之上
3. 合并后：删除此表对应行 + `git worktree remove .worktrees/<name>` + 删除远端分支
