# Eva Worktree 文件锁

并行任务开始前登记占用的核心文件/模块。**运行中 append-only**；cleanup 时把状态从 `active` 改为 `done` 或 append `released` 行，**永不删历史**（M1 双轨实验 plan §"用户 manual #5"）。

## Active Locks (M1 双轨并行实验，2026-05-05)

| Track | 文件 | 状态 | 时间 |
|---|---|---|---|
| Track 1 | packages/backend/src/scheduler.ts:computeNextStage, packages/shared/fixtures/harness/fallback-config.json (agentProfiles), docs/retrospectives/M1-mini2-stage-aware-prompts.md | done | 2026-05-05 16:20（PR #12 合 dev） |
| Track 2 | packages/backend/src/context-manager.ts (NEW), packages/backend/src/harness-queries.ts (createTask + ContextBundle helpers), packages/backend/src/scheduler.ts:spawnAgent | done | 2026-05-05 17:01（PR #13 合 dev） |

> **状态转换记录**（cleanup）：双 Track 已合 dev，状态从 `active` 改为 `done`，**保留行**永不删历史（用户 manual #5）。
>
> **Rebase observation**：Track 2 在自己 worktree 加 lock 行时，dev 上 Track 1 的 "Active Locks" 段尚未存在；Track 2 把行 append 到 OLD "Historical Locks" 表里。Rebase 后 git 报**零冲突**，但**语义漂移** — Track 2 行被错误归到 Historical 段（修复 commit `e8d2f81`）。M1 双轨实验 retrospective **信号 #1**：自由 markdown 锁文件 + 多 worktree 时序异步 → rebase 报 ok 但语义错。M2 自动化必须用**结构化 lock schema** — 详见 [retrospectives/M1-parallel-tracks-experiment.md](docs/retrospectives/M1-parallel-tracks-experiment.md)。
>
> **实验已完成，不再做第 2 次人驱动并行**（per plan §Q3）。后续真并行需求等 M2 agent 自动 spawn + worktree 自动创建 + ResourceLock。

## Historical Locks（旧版表格 — 早期实践）

| worktree 分支 | 占用文件/模块 | 开始日期 | 状态 |
|---|---|---|---|

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
