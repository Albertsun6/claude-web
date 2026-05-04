# Phase 2 React — Cross-correctness lens (cursor-agent)
> Reviewer: reviewer-cross via cursor-agent · Date: 2026-05-03 · Phase 2 (cross-pollinate)
> Model: gpt-5.5-medium

## 对 arch 每条 finding 表态

### Arch-F1 (Work Registry baseline BLOCKER) — refine
**对方原文摘要**: Work Registry 作为 Stage A baseline 越界，Stage A 退出条件只验证 worktree。
**我的表态**: refine
**理由**: 同意 scope creep，但不建议完全后置。proposal 已把 Stage A 绑定 `POST /api/work`、完整 WorkRecord、Dashboard、stale、commitCount（`docs/proposals/PARALLEL_WORK_ORCHESTRATOR.md:115-151`），确实过重；但冲突 toast 需要一个最小索引，否则“已有 idle worktree”无来源。
**新建议**: Stage A 只保留 `work.jsonl` 最小索引 `{id, worktreePath, branch, status, title, lastActivityAt, createdAt}` + `GET /api/work?cwd=`；Dashboard、stale、commitCount、prUrl、finalizeAction 推到 A.5。

### Arch-F2 (三 store 边界) — agree
**对方原文摘要**: Work Registry / projects.json / RunRegistry 三者 cwd/status/lastActivityAt 语义漂移。
**我的表态**: agree
**理由**: 强化我的 F1/F2 和 cross-end concern。仅靠“每月 audit”不是工程边界；proposal 自己在 Q5 承认漂移风险（`docs/proposals/PARALLEL_WORK_ORCHESTRATOR.md:371`）。
**新建议**: 无。

### Arch-F3 (vertical-fit gate 缺指标) — refine
**对方原文摘要**: C2 gate 只写 6 个月 + 主动评估，缺数据抓手。
**我的表态**: refine
**理由**: 同意必须量化，但不建议用 “Dashboard tab 4 使用频次”，因为我 F7 和 Arch-F4 都认为 tab 4 依赖图本身可能不该进主线。
**新建议**: C1 从 day 1 记录：推荐接受率、跳过原因、用户手动 override 次数、过去 30 天是否反馈“手动不够”。不要把 tab 4 打开次数作为硬 gate。

### Arch-F4 (B2 Tab 4 越权) — agree
**对方原文摘要**: picker 和依赖图是两件事，依赖图会拖慢 B2。
**我的表态**: agree
**理由**: 强化我的 F7。当前 iOS `RunsDashboardSheet` 是简单 List，直接上 conversation × Issue 拓扑图风险过高。
**新建议**: 无。

### Arch-F5 (Invariant #9 wording 冲突) — agree
**对方原文摘要**: Stage 拆分决定不该写成关键不变量。
**我的表态**: agree
**理由**: 强化我的 F2。Stage A 范围是可调整实施策略，不是和 human-in-the-loop merge 同层级的不变量。
**新建议**: 无。

### Arch-F6 (第 3 reviewer 很可能 NO) — agree
**对方原文摘要**: 第 3 lens 先不强推，观察后续 proposal 是否复发。
**我的表态**: agree
**理由**: 弱化“必须新增 reviewer”的冲动。v0.4 的问题更像 self-check 缺口，不一定要立刻扩 reviewer 矩阵。
**新建议**: 无。

### Arch-F7 (CLAUDE.md pitfall 归属正确) — agree
**对方原文摘要**: conversation = feature train 适合写进 CLAUDE.md pitfall。
**我的表态**: agree
**理由**: 强化我的 F5：这条概念正确，只需修正“切换对话会杀进程”的生命周期措辞。
**新建议**: 无。

## 我自己 Phase 1 verdict 的自我修正

### F1 (lockfile MAJOR) — keep
**修正后等级**: MAJOR
**理由**: Arch-F2 强化此点；并发写边界必须设计期定清。

### F2 (Stage A registry 范围 MAJOR) — keep
**修正后等级**: MAJOR
**理由**: Arch-F1 认为 BLOCKER，但我仍判 MAJOR：最小索引可留，问题是范围过大。

### F3 (`cp -RL node_modules` MAJOR) — keep
**修正后等级**: MAJOR
**理由**: Arch 未削弱；pnpm workspace 链接风险仍成立。

### F4 (worktree id 规范 BLOCKER) — keep
**修正后等级**: BLOCKER
**理由**: 涉及路径拼接、git branch、discard 清理，必须在 proposal 层锁死输入规范。

### F5 (conversation switch MINOR) — keep
**修正后等级**: MINOR
**理由**: Arch-F7 强化“train”概念，但不影响生命周期措辞修正。

### F6 (token 30-50% MINOR) — keep
**修正后等级**: MINOR
**理由**: Arch-F3 进一步说明未量化收益不能当 gate 依据。

### F7 (Dashboard 依赖图 MAJOR) — keep
**修正后等级**: MAJOR
**理由**: Arch-F4 独立命中同一风险。

### F8 (IDEAS 边界 MINOR) — keep
**修正后等级**: MINOR
**理由**: Arch-F2 的边界问题也适用于 roadmap 条目边界。

## 新发现 (new-finding)

### N1. Work Registry 不应持久化 cwd 作为可变真相
Arch-F2 让我看到：`cwd` 最好从 project/conversation join 得来，WorkRecord 只保存 worktree/conversation 级事实，避免和 projects.json 双写。

### N2. vertical-fit gate 指标不能依赖尚未验证的依赖图 UI
若 tab 4 被降级，C2 gate 必须来自 scheduler 推荐日志，而不是 Dashboard 使用频次。

## Convergence summary
- 对方共 7 条 finding，我表态分布：5 agree / 0 disagree / 2 refine / 0 new-finding
- 我自己 8 条 finding，修正分布：8 keep / 0 downgrade / 0 withdraw
- 真正未收敛 finding（双方都不让步）：Arch-F1 severity/scope。我认为“最小 Work Registry 索引”可留 Stage A；arch 倾向整体后置或仅 ≤50 行写入。
