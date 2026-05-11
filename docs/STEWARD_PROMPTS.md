# Steward Prompts — 用户面短语清单

> **9 个 copy-paste 短语，覆盖 80% 操作**。粘到任意 Cursor 窗口的 Claude 输入框即可。
> 详细用法 + 工作流见 [`STEWARD_USAGE.md`](STEWARD_USAGE.md)
> 数据契约见 [`adr/vessel/ADR-019-steward-v0-contract.md`](adr/vessel/ADR-019-steward-v0-contract.md)

---

## 9 个短语

| # | 操作 | 粘这个 |
|---|---|---|
| 1 | **Boot ritual / 看下一步** | `/boot` 或 `看 backlog 推荐下一步` |
| 2 | **开始一项** | `开始干 <task-id>` |
| 3 | **收一项** | `<task-id> 收线` |
| 4 | **加一项** | `加待办: <title>; P<0-3>; <S/M/L>; [note]` |
| 5 | **暂停一项** | `<task-id> blocked 因为 <reason>` |
| 6 | **改优先级** | `<task-id> 改 P<0-3>` |
| 7 | **恢复一项** | `<task-id> unblock` |
| 8 | **放弃一项** | `<task-id> drop 因为 <reason>` |
| 9 | **看活窗口** | `现在哪些窗口在干啥` |

---

## 1 — Boot ritual / 看下一步

```
/boot
```

或同义：

```
看 backlog 推荐下一步
```

**Claude 会**：读 `docs/BACKLOG.md` → 若顶部"最近更新"> 72h 提醒 stale → echo `"Backlog: N in_progress · M planned · K blocked"`。若加了"看下一步"，进一步：跑 `pnpm eva:sessions` 看活窗口 → 输出 top 3 候选 + 每项标签（"本窗口直接做" / "需开新窗口" / "等着"）+ 给"开新窗口"的具体命令模板。

**何时用**：新会话开始时，或者你忘了下一步该干啥。

---

## 2 — 开始一项

```
开始干 <task-id>
```

例：

```
开始干 m2-voice-proposal
```

**Claude 会**：找到这个 id → 验 `status=planned` + `depends_on` 全 done → 跑 `pnpm eva:sessions` 看活窗口 → 决策"本窗口直接做"或"开新窗口"：
- 本窗口做 → 改 BACKLOG: `status: in_progress` + `assigned_kind: main`
- 开新窗口 → echo 5 步命令 (worktree + eva.json + Cursor open) → **等你 `ok` 后 (I8 mid-tier)** 执行
- commit (I9 守门)

---

## 3 — 收一项

```
<task-id> 收线
```

例：

```
m2-voice-proposal 收线
```

**Claude 会**：找到这个 id → 验 `status=in_progress` → 问你 outcome (`done` / `blocked` / `dropped`)：
- done → 标 `completed_at` (ISO-8601 UTC + Z) + `refs`
- blocked → 改 `status=blocked` + 问你 `blocked_reason`
- dropped → 改 `status=dropped` + 问你原因

若该项有 worktree（`assigned_kind=worktree`），自动跑 `pnpm eva:hook pre-remove --dry-run` → **等你 `ok` 后** → `--yes` 执行。

---

## 4 — 加一项

```
加待办: <title>; P<0-3>; <S/M/L>; [note]
```

例：

```
加待办: 修 inbox iOS 视图的滑动 lag; P2; M; 影响录入体验
```

**Claude 会**：自动生成 id (从 title slugify，撞了加 -2 -3) → 加到 BACKLOG.md `Active` 段 → echo diff → **等你 `ok` 后** commit。

字段都不必填的话也可以省略：

```
加待办: 写 README 中文版
```

→ Claude 会默认 `P3 / M`，再让你确认。

---

## 5 — 暂停一项

```
<task-id> blocked 因为 <reason>
```

例：

```
m2-voice-impl blocked 因为 等 m2-voice-proposal 通过
```

**Claude 会**：改 `status: planned → blocked` + 必填 `blocked_reason`。

⚠️ **跟 computed-blocked 不同**：如果一项的 `depends_on` 还有未 done 项，它实际上是 computed-blocked，`status` 仍 `planned`。`blocked` 状态是"用户主动决定暂停"。

---

## 6 — 改优先级

```
<task-id> 改 P<0-3>
```

例：

```
m2-voice-proposal 改 P1
```

**Claude 会**：改 `priority` 字段，commit。

---

## 7 — 恢复一项

```
<task-id> unblock
```

例：

```
m2-voice-impl unblock
```

**Claude 会**：改 `status: blocked → planned` + 清 `blocked_reason`。

---

## 8 — 放弃一项

```
<task-id> drop 因为 <reason>
```

例：

```
cross-session-messaging drop 因为 永远用不上
```

**Claude 会**：改 `status: → dropped` + 把 reason 写进 `note` + 移到 Done 段。dropped 项**永久保留**作为审计 trail（I4）。

---

## 9 — 看活窗口

```
现在哪些窗口在干啥
```

**Claude 会**：跑 `pnpm eva:sessions` → 输出每个活 Claude session 的 PID / 分支 / cwd / 最近活动时间 + 哪个 BACKLOG 项 assigned 在那 cwd（如果有的话）。

---

## 三层执行白名单 (I8) 速查

Claude 跑命令前的归类（不必死记，看 Claude echo 时就懂）：

| 层 | 例子 | 行为 |
|---|---|---|
| **read-only auto** | `git status` / `ls` / `cat` / `pnpm eva:sessions` | 默许自动跑 |
| **write needs ack** | `git commit` / 改 BACKLOG.md / `gh pr edit` | echo 命令 + 等你 `ok` / `yes` / `继续` |
| **destructive needs explicit affirmative** | `rm -rf` / `git push --force` / `git worktree remove` | echo + **必须**你主动短语肯定 |

**你不会被催**：Claude 在 ack 等待状态会停止执行，安静等你回复。

---

## 出错时

| 现象 | 怎么修 |
|---|---|
| Claude 没主动读 BACKLOG | 粘 `/boot` 手动触发 |
| `开始干 <id>` 报错 "depends_on 未完成" | 先把前置项收掉，或者 `<id> unblock` 改强解锁 |
| `开始干 <id>` 报错 "conflicts_with X in_progress" | 等 X 完成或开新窗口 |
| `<id> 收线` 报错 "not in_progress" | 这一项还没开始；先 `开始干 <id>` |
| YAML 解析坏了（罕见，R2） | 从 `~/.vessel/backlog-mirror.jsonl` 复原 |
| 你忘了 task-id 怎么拼 | `看 backlog 推荐下一步`，列表里有 id |

---

## 不在这里的场景

|场景 | 走哪 |
|---|---|
| 30 秒碎想录入 | iOS Inbox 视图 → 之后 triage |
| 改架构决策 | 写 proposal → `harness-review-workflow` 评审 |
| 改 ADR / schema | 同上 + 走 contract mode |
| 写 PR / 提交代码 | 正常 git/gh 流程，**不**走 steward |
| 调研别人怎么做 | `survey` skill |

Steward 是**工作分发 + 跟踪 + 收尾**层，不替代代码 / 评审 / 调研工作本身。
