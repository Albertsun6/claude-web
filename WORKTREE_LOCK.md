# Eva Worktree 文件锁（已迁移到 [eva.json](./eva.json)）

> **本文件已降级为人读说明 + 历史归档**（H12 v1，2026-05-05）。机器可读的 worktree 注册表迁移到根目录 [`eva.json`](./eva.json)，schema 在 [`packages/shared/src/eva-config.ts`](./packages/shared/src/eva-config.ts)。
>
> 触发原因：M1 双轨并行实验 retrospective **强信号 #1** —— 自由 markdown 表 git rebase 报零冲突但段落归属错置（修复 commit `e8d2f81`），不可机器验证。详见 [retrospectives/M1-parallel-tracks-experiment.md](docs/retrospectives/M1-parallel-tracks-experiment.md)。

## 当前状态查询

```bash
pnpm eva:status        # CLI 一屏状态表
cat eva.json | jq .   # raw JSON
```

> **⚠️ 多机器使用警告（v1）**：`eva.json` 当前直接进 git，但其中 `path` / `port` / `dataDir` 字段是**本机绝对值**（如 `~/Desktop/claude-web-mini3` / `:3032` / `~/.claude-web-track2`）。其他机器拉到 repo 后这些值大概率不对路径。**v1 单用户单机器 scope**，不保证 cross-machine clone 可用。多机 / 团队场景需要 H13+ 拆 `eva.json`（repo policy）+ `eva.local.json`（本机覆盖，gitignore），现在不预先拆。

`eva.json` 字段 schema：
- `version: 1`（schema 版本，bump 必须 ADR + migration）
- `worktrees: [{ name, branch, path, port?, dataDir?, owns: [], status, since?, note? }]`
- `status` 枚举：`active` / `done` / `released`（**append-only**，永不删行）

## 与 H12 v1 范围

H12 v1 **只做** schema + status reader + 本文件降级。**不做** auto-lock / 冲突阻止 / hooks 执行 — 留给：
- **H13** lifecycle hooks（pre-start / post-start / pre-merge / post-merge ...）
- **M2 ResourceLock** 模块（真锁定 + 自动加解锁）

参见 [docs/IDEAS.md](docs/IDEAS.md) H12-H17 段。

## 端口隔离约定（保留 — 仍是人手动遵守）

| 实例 | PORT | DATA_DIR |
|---|---|---|
| main dev server / 主 worktree | 3030（prod stable）/ 3031（dev） | `~/.claude-web` / `~/.claude-web-dev` |
| worktree 1（次要并行）| 3032 | `~/.claude-web-trackN` |
| worktree 2+ | 待规划 | 待规划 |

每个 worktree 在项目根目录建 `.env.local`（已 gitignore）写入对应 PORT：

```bash
echo "PORT=3032" > .env.local
echo "CLAUDE_WEB_DATA_DIR=$HOME/.claude-web-trackN" >> .env.local
```

> H12 后续（H13）会把 `port` / `dataDir` 从 `.env.local` 上推到 `eva.json` 单一来源。当前 v1 双源并存。

## 冲突处理规则（保留）

1. 开始 worktree 任务前查 `eva.json`（pnpm eva:status），有冲突文件先沟通
2. 同一文件被两个 worktree 修改时：后合入 dev 的一方 rebase 于先合入的之上
3. 合并后：状态从 `active` 改 `done`（不删 eva.json 行，append-only）；`git worktree remove .worktrees/<name>`；删远端分支

## Historical Markdown Locks（旧表，2026-05-05 前）

历史保留以备审计。新增不要写到这里 — 写到 `eva.json`。

### M1 双轨实验 active locks（已 done，归档于 eva.json）

| Track | 文件 | 状态 | 时间 |
|---|---|---|---|
| Track 1 | packages/backend/src/scheduler.ts:computeNextStage, packages/shared/fixtures/harness/fallback-config.json (agentProfiles), docs/retrospectives/M1-mini2-stage-aware-prompts.md | done | 2026-05-05 16:20（PR #12）|
| Track 2 | packages/backend/src/context-manager.ts (NEW), packages/backend/src/harness-queries.ts (createTask + ContextBundle helpers), packages/backend/src/scheduler.ts:spawnAgent | done | 2026-05-05 17:01（PR #13）|

> 上述行已迁移到 [eva.json](./eva.json) `M1-defects-fix-and-retro` + `M1-context-manager-skeleton` 条目。本表仅人读历史归档，新增 entry **不要**写到这里 — 写到 `eva.json`。
