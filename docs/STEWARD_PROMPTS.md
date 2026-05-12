# Steward Prompts — 用户面短语清单

> **9 个 copy-paste 短语，覆盖 80% 操作**。粘到任意 Cursor 窗口的 Claude 输入框即可。
> 详细用法 + 工作流见 [`STEWARD_USAGE.md`](STEWARD_USAGE.md)
> 数据契约见 [`adr/vessel/ADR-019-steward-v0-contract.md`](adr/vessel/ADR-019-steward-v0-contract.md)

---

## 10 个短语

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
| 10 | **即时代办**（加 + 立刻做） | `即时代办: <title>; [P<0-3>]; [<S/M/L>]; [note]` |

---

## 1 — Boot ritual / 看下一步

**两种触发，等价**：

```
/boot
```

或自然语言（**总是能用，不依赖 skill**）：

```
看 backlog 推荐下一步
```

或最短：

```
看 backlog
```

**Claude 会**：读 `docs/BACKLOG.md` → 若顶部"最近更新"> 72h 提醒 stale → echo `"Backlog: N in_progress · M planned · K blocked"`。若加了"看下一步"，进一步：跑 `pnpm eva:sessions` 看活窗口 → 输出 top 3 候选 + 每项标签（"本窗口直接做" / "需开新窗口" / "等着"）+ 给"开新窗口"的具体命令模板。

**何时用**：新会话开始时，或者你忘了下一步该干啥。

**关于 `/boot`**：这是 Claude Code 注册的 slash command，对应 [`.claude/skills/boot/SKILL.md`](../.claude/skills/boot/SKILL.md)。在 Cursor 里粘 `/boot` 时 Claude Code 自动加载 skill 内容到 Claude context。**前提**：该 skill 文件存在且被 Cursor 索引到（每个 Vessel workspace 启动时自动）。如果 `/boot` 没反应，用自然语言版本兜底。

---

## 2 — 开始一项

```
开始干 <task-id>
```

例：

```
开始干 m2-voice-proposal
```

**Claude 会**：找到这个 id → 验 `status=planned` + `depends_on` 全 done → 跑 `pnpm eva:sessions` 看活窗口 → **不直接动手**，先给 spawn 分析 + 推荐 + 等你拍板：

```
Task: m2-voice-proposal
  size=M · priority=P2 · parallel_safe_files=["docs/proposals/"]
  depends_on=[] · assigned_kind 候选=main

Spawn 分析：
  • size=M  → 倾向 spawn（≤ 半天，单独 session 不算亏）
  • parallel_safe_files 跟主窗口最近改的文件零重叠 → spawn 安全
  • 主窗口状态：idle / busy / in-context
  • eva:sessions：除我外 N 个活窗口

建议：SPAWN（或 STAY / USER-MANUAL）
理由：<1-2 句>
```

你回 1 个短语：

- `ok spawn` → Claude echo 5 步命令 (worktree + eva.json + Cursor open + 给新 session 的 prompt 模板) → 再等一次 ack (I8 mid-tier) → 执行 → commit (I9 守门)
- `ok stay` → Claude 改 BACKLOG: `status: in_progress` + `assigned_kind: main` → commit (I9 守门) → 在本窗口开始做
- `用户做` → Claude 改 BACKLOG: `status: in_progress` + `assigned_kind: user-manual` → commit (I9 守门) → 主窗口只跟踪
- 改主意：`<id> drop 因为 ...` / `<id> blocked 因为 ...` / `<id> 改 P<n>`

**关键**：所有 spawn / stay / 用户做决策都过你的眼。Claude 不静默选边。

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

### V0.5 R1：worker self-signaling（file flag canonical）

worker session 在 task 完成时（PR 开了 / commit 推了 / tests 跑过）**应**自己跑：

```bash
./scripts/steward-signal-done.sh <task-id> --pr <PR_URL> --summary "<1 line>"
```

这会写 `~/.vessel/spawn-done/<task-id>.json`（atomic 写 + canonical 完成证据）。

**主线侧**：粘 `看 backlog` 或 `pnpm eva:collect` 时，Claude 自动扫这个目录，echo pending 完成项给你：

```
PENDING  steward-v05-r1-worker-signal-fileflag
  branch:    feat/steward-v05-r1-r2
  pr:        https://github.com/.../pull/N
  summary:   R1 file flag + reader script + docs
  completed: 2026-05-12T03:00:00Z (5m ago)
```

你回 `ok` 收线 → Claude 跑 `pnpm eva:collect --clear <id>` + 走原本 `<id> 收线` 协议。**worker 不直接改 BACKLOG.md / eva.json**（I1 source-of-truth 仍然由主线握）。

### V0.5 R2：worker 开 PR 但 **不默认 auto-merge**

worker 完成时：
- **代码改动 (含 backend / frontend / ios-native / scripts)**：worker push branch + `gh pr create`，但 **NOT auto-merge**；signal done 让主线 + 用户 review 后再 merge
- **docs / research / proposal / ADR / retrospective**：worker push + 开 PR；如果 branch protection 已要求 CI pass，可由 worker 在 signal 时备注 "ready for auto-merge"，主线确认后 `gh pr merge --auto`

理由：multi-agent 让 worker 自己 merge 自己的代码 = 失审查边界。Phase 6 v2 verdict 强调 review boundary 不该让 worker 单方面跨。

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

## 10 — 即时代办（加 + 立刻做）

```
即时代办: <title>; [P<0-3>]; [<S/M/L>]; [note]
```

例：

```
即时代办: 修 iOS launch 时崩溃
```

或带字段：

```
即时代办: 改 ADR-019 review trail 链接; P2; S; 链接错位
```

**默认**：`priority=P1`（不是 P0——P0 留给真阻塞）+ `size` Claude 推（讲不准时问你）

**Claude 会**：一次 echo 同时确认两件事——加进 BACKLOG + 进 dispatch 协议（v0.3 I11）：

```
即时代办 提议:
  id: <slug-from-title>
  title: <你给的>
  priority: P1 (默认；可改 P0/P2/P3)
  size: S (Claude 推；可改 M/L)
  status: in_progress  ← 跳过 planned 直接进
  assigned_kind 候选: main

并 dispatch 分析:
  • size 维度 → ...
  • parallel_safe_files 跟主窗口最近改的文件 <猜测>
  • 主窗口状态 <idle/busy>
  • eva:sessions：N 个活窗口

建议：STAY (或 SPAWN / USER-MANUAL)
理由：<1-2 句>

你的选择：ok | ok spawn | 用户做 | 改 P / 改 size / drop
```

你 `ok` 一次 = 同时承认两件事：写 BACKLOG（commit, I9 守门）+ 按推荐方式开始。

**对比 `加待办`**：

| 短语 | 行为 | 适用场景 |
|---|---|---|
| `加待办: ...` | 加进 backlog (`status=planned`) 等以后做 | 想到一件事先记着，**不**急做 |
| `即时代办: ...` | 加进 backlog (`status=in_progress`) + 立刻进 dispatch 协议 | 想到一件事**马上做** |

**关键不变量**：仍然不破 I1（BACKLOG 是单一写入点）+ I5（用户 ack 后 Claude 才写）+ I8 mid-tier（write 需 ack）+ I11（dispatch 需用户拍板）—— 这条 prompt 只是把 `加待办` + `开始干` **两步合一**，不引入新决策权。

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
