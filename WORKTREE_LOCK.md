# Eva Worktree 文件锁

并行任务开始前登记占用的核心文件/模块，合并后删行。

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
