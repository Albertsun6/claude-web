# ADR-019: Steward V0 contract — BACKLOG.md + 10-prompt UI + boot ritual

**Status**: Accepted (amended in-place 2026-05-12: v0.3 added I11 dispatch protocol; v0.4 added `即时代办` as 10th prompt + §3.7 combined add+start flow)
**Date**: 2026-05-12
**Reviewers**: harness-architecture-review (Claude) + reviewer-cross (cursor-agent gpt-5.5-medium)
**Review trail**: see `docs/reviews/steward-v0-{arch,cross,react-arch,react-cross,arbitration}-2026-05-12-0026.md`
**Proposal**: `docs/proposals/STEWARD-V0-DESIGN.md` v0.2 (converged)

## Context

Vessel 项目任务追踪状态分散在 5 个 surface（docs/IMPROVEMENTS.md / IDEAS.md / HARNESS_ROADMAP.md / inbox.jsonl / harness.db issue 表）。痛点：(1) 每个 Claude session 不知道今日卡点；(2) 跨 session 协调靠脑记；(3) 完成后没人收尾；(4) "开不开新窗口"靠每次问 Claude。

需要一个**轻量级 orchestrator** ("总管") 集中跟踪 + 推荐下一步 + 协调多窗口。

## Decision

实施 **Steward V0 (Phase 0 MVP)** —— 单一文件 `docs/BACKLOG.md` + 9 个用户 prompt 短语 + Claude session boot ritual。**不**起新 backend service、**不**改 DB schema、**不**做 iOS UI。

具体契约（v0.2 锁死，全部跟随 review 收敛）：

### Schema (docs/BACKLOG.md fenced YAML)

15 个字段（必填: id/title/priority/size/status；选填: depends_on/conflicts_with/parallel_safe_files/assigned_kind/assigned_cwd/blocked_reason/note/completed_at/refs/harness_issue_id）。

- `id` 正则: `^[a-z][a-z0-9-]{2,63}$`
- `status`: `planned | in_progress | blocked | done | dropped` (枚举，唯一权威 - I10)
- `priority`: `P0 | P1 | P2 | P3`
- `size`: `S | M | L`
- `completed_at`: ISO-8601 UTC + `Z` 后缀
- `refs`: 数组，元素格式 `<kind>:<id>` (例: `pr:#42` / `commit:<sha>` / `inbox:<uuid>` / `lesson:<id>` / `adr:<num>`)
- `harness_issue_id`: Phase 0 留空；Phase 2 promote 时填

### 用户面 10 个 prompt 短语（docs/STEWARD_PROMPTS.md）

1. `/boot` 或 `看 backlog 推荐下一步`
2. `开始干 <task-id>`
3. `<task-id> 收线`
4. `加待办: <title>; P<0-3>; <S/M/L>; [note]`
5. `<task-id> blocked 因为 <reason>`
6. `<task-id> 改 P<0-3>` (改优先级)
7. `<task-id> unblock`
8. `<task-id> drop 因为 <reason>`
9. `现在哪些窗口在干啥`
10. `即时代办: <title>; [P<0-3>]; [<S/M/L>]; [note]` — v0.4 amendment：`加待办` + `开始干` 双步合一，1 个 ack 替代 2 个

### Session boot ritual (CLAUDE.md addition)

Claude 新 session 应主动：
1. 读 `docs/BACKLOG.md` (必须)
2. 若顶部"最近更新" > 72h，提醒"Backlog stale"
3. Echo: "Backlog: N in_progress · M planned · K blocked"

**Lazy**：`pnpm eva:sessions` 不在 boot 时跑，问"下一步/活窗口"再跑。
**Fallback**：用户粘 `/boot` 或 `看 backlog 推荐下一步` 手动触发。

### eva:sessions JSON contract

Claude 在自动消费（dispatch 推荐 / `看 backlog 推荐下一步` 等）时**应**用
`pnpm eva:sessions --format json`；ASCII 表只给人眼看。脚本实现：[`scripts/eva-sessions.mjs`](../../../scripts/eva-sessions.mjs)。

形状：

```json
{
  "generated": "<ISO timestamp>",
  "total": <number>,
  "recentlyActive": <number>,
  "processesNoResume": <number>,
  "sessions": [
    {
      "pid": "<string>",
      "etime": "<string, ps elapsed e.g. '05:14:40' or '01-23:45:12'>",
      "sessionId": "<uuid string | null>",
      "cwd": "<absolute path | null>",
      "branch": "<string | null>",
      "lastSeenMs": <epoch ms | null>,
      "lastSeenAgo": "<human string e.g. '2m ago' | null>"
    }
  ]
}
```

字段约束（Steward 消费侧依赖；改这些属契约级修订，需 ADR-020+）：

- `total` = `sessions.length`
- `recentlyActive` = 5 分钟内 jsonl 有写入的 session 数
- `processesNoResume` = 没拿到 `--resume <uuid>` 的进程数（通常是 Claude.app / desktop / hook 子进程残留）
- `sessions` 按"最近活跃优先"排序；`lastSeenMs == null` 的排末尾
- 缺失字段一律 JSON `null`，**不**写文本占位串（如 `"(unresolved)"`、`"-"`）
- 空集仍返回完整对象 + `sessions: []`，**不**走"无活进程"快捷退出
- macOS-only（依赖 `ps -axo`）；其它平台行为未定义

退出码：
- `0`：成功（含空集）
- `2`：参数错误（未知 flag / 未知 format 值）

未来加字段对消费方应是非破坏性（默认忽略未知字段）。

### Invariants (11 条)

- **I1**: BACKLOG.md 是唯一写入点
- **I2**: id 永久不变；rename 算新建
- **I3**: 每次 status 转移产出可审计 diff；commit 视 git status 而定
- **I4**: done/dropped 项永久保留 (200KB 阈值后 quarterly archive)
- **I5**: 用户从不写 YAML；Claude 改完显示 diff 待复核
- **I6**: 不复制 inbox/IMPROVEMENTS 内容到 backlog，引用即可
- **I7**: BACKLOG.id ↔ harness.issue.id 命名空间隔离；桥接靠 `harness_issue_id` 字段
- **I8**: 三层执行白名单
  - read-only auto: 默许自动跑 (`git status` / `ls` / `cat` / `pnpm eva:sessions`)
  - write needs ack: echo 命令 + 等用户 `ok/yes/继续` (`git commit` / 改文件 / `gh pr edit`)
  - destructive needs explicit affirmative: 用户主动短语肯定 (`rm -rf` / `git push --force` / `git worktree remove`)
- **I9**: commit 守门：BACKLOG.md 改后 `git status --porcelain` 检查；纯净则自动 commit；有其它 dirty 文件则只 stage BACKLOG + ack 后 commit；决不静默 stage 其它
- **I10**: `status` 字段是状态唯一权威；section header (Active / Blocked / Done) 仅人眼导航；Claude 解析时只看 `status`
- **I11** (v0.3 amendment 2026-05-12): Dispatch 决策必经用户拍板。`开始干 <id>` 触发时 Claude 给 spawn 分析 + 推荐 + 等用户回 `ok spawn` / `ok stay` / `用户做`；永不静默选边。这是 I8 mid-tier 在 dispatch 场景的细化，**不是新决策**——in-place amendment，无新 review。详见 `docs/proposals/STEWARD-V0-DESIGN.md` v0.3 §3.5。

## Consequences

### 优点

- ✅ 单一文件 = 单一 source of truth (G2)
- ✅ in-repo + 跨 session 可读 (G3)
- ✅ Phase 1+ 可演化路径锁死（`harness_issue_id` 字段 + I7）(G5)
- ✅ 三层执行白名单防 Claude 静默 destructive 操作 (新加固)

### 缺点 / 风险

- ⚠️ R1: BACKLOG merge 冲突 (低概率) — Phase 1 加软锁缓解
- ⚠️ R2: YAML 解析错损坏数据 (中概率/高影响) — 三层 mitigation: schema 锁 + diff 复核 + `~/.vessel/backlog-mirror.jsonl` append-only 镜像
- ⚠️ R6: Cursor 没 session-start hook，boot ritual 命中率 ≈ 80% — `/boot` fallback 手动触发兜底

### 不可逆度

**中等**。Schema 字段 + invariants 是 contract，写下后所有未来 session 受约束。改 schema 字段含义（如 `status` 枚举改）属契约级修订，需走 ADR-020+。

### Rollback path

删 4 个 artifact + CLAUDE.md 那一节：
- `docs/BACKLOG.md`
- `docs/STEWARD_PROMPTS.md`
- `docs/adr/vessel/ADR-019-steward-v0-contract.md` (本 ADR 自身)
- CLAUDE.md "Session boot ritual" 段落

新增的 backlog-only 项可从 `~/.vessel/backlog-mirror.jsonl` 复原。

## Rejected alternatives

每条都有 reviewer 提过 / 我反驳的具体理由：

| 备选 | 拒绝理由 |
|---|---|
| 立刻起 REST API + 后端 service | 太重；Phase 0 单文件够；Phase 1 看用上没再加 |
| BACKLOG out-of-repo (`~/.vessel/backlog.yaml`) | review F3 反驳：换问题不解问题（path 发现 + 跨 session 知晓） |
| 立刻动 harness.db `issue` 表 | M2+ scope；I7 + `harness_issue_id` 字段已预留 Phase 2 桥 |
| 6 个 prompt（v0.1） | review F6: 至少 3 类高频缺 (改优先级/unblock/drop) |
| BACKLOG.id 强制 `bl-` 前缀 | review F1 反驳：可读性下降；`harness_issue_id` + I7 已够 |
| priority+size 排序饿死问题 | review m2 反驳：Phase 0 单用户无并发竞争，无饿死物理条件 |
| 5 次 cold-boot reliability gate | review F7 反驳：Phase 0 过重；`/boot` fallback 足够 |
| 4 字段 assigned_session 拆分 | review F2/M3: 2 字段够 (`assigned_kind` + `assigned_cwd`)；branch/note 是 Phase 1+ 才需 |

## Review trail

- Phase 1 verdicts:
  - `docs/reviews/steward-v0-arch-2026-05-12-0026.md` (1 BLOCKER + 5 MAJOR + 4 MINOR + 1 info)
  - `docs/reviews/steward-v0-cross-2026-05-12-0026.md` (1 BLOCKER + 3 MAJOR + 4 MINOR)
- Phase 2 react verdicts:
  - `docs/reviews/steward-v0-react-arch-2026-05-12-0026.md`
  - `docs/reviews/steward-v0-react-cross-2026-05-12-0026.md`
- Phase 3 arbitration: `docs/reviews/steward-v0-arbitration-2026-05-12-0026.md`
- Converged proposal: `docs/proposals/STEWARD-V0-DESIGN.md` v0.2

**收敛 verdict**: ✅ 12 accept · ⚠️ 5 partial · 🚫 1 rebut (cross m2 starvation) · 🟡 0 user-decision
