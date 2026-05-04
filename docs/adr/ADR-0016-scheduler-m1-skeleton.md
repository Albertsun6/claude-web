# ADR-0016 — EvaScheduler M1 骨架（L3 编排最小切片）

**状态**：Accepted（2026-05-05，M1 第 1 项 L3 编排骨架）

**Decider**：用户 + reviewer-cross（Sonnet phase 1）+ cursor-agent（schema fact-check）+ author 仲裁

**关联**：[HARNESS_ROADMAP §M1](../HARNESS_ROADMAP.md) · [retrospectives/M1-scheduler-skeleton.md](../retrospectives/M1-scheduler-skeleton.md) · [reviews/scheduler-skeleton-cross-2026-05-05-1200.md](../reviews/scheduler-skeleton-cross-2026-05-05-1200.md) · PR #3 · 修复 commit `77c8fdf`

---

## Context

M1 需要一个 L3 Orchestration 骨架来推进 Issue → Stage 状态机，让后续 dogfood 能真跑起来。M2 才接 ContextManager 真编排、Review-Orchestrator、worktree 自动隔离、permission hub 接入。

骨架约束：
- 不引入新基础组件（[§0 #11](../HARNESS_ROADMAP.md)）
- 不锁死 M2 的真编排路线（保留替换余地）
- 必须能立即 dogfood：手动 POST `/api/harness/scheduler/tick` 推一个 Issue 跑完 strategy + implement 两段

---

## Decision

EvaScheduler 满足 5 条：

### 1. 单 tick 拉一个 Issue + fire-and-forget spawn

`tick(projectId?)` HTTP POST 触发，每次拉**最旧的 1 个** eligible Issue（status ∈ `triaged/planned/in_progress`），推到下一个未完成 Stage（`STAGE_SEQUENCE = ["strategy", "implement"]`）。spawn agent 异步，tick 立即返回 taskId。

不做：定时器自动轮询、批量 spawn、跨 project 优先级排序。

### 2. permission mode = `bypassPermissions`（M2 改造点）

scheduler 无交互 UI，无法走 permission hub。M1 用 bypass 跑通骨架；M2 注册 scheduler permission channel + 广播 `decision_requested` 事件。

### 3. Stage 完成态用 `"approved"`（不是 `"done"`）

stage 表 CHECK 约束没有 `"done"`。`STAGE_COMPLETE_STATUSES = {approved, rejected, skipped}`，M1 无 review gate 时直接置 `approved`。M2 接 review-orchestrator 后由 verdict 路由到 approved/rejected。

### 4. cwd 取自 `harness_project.cwd`

agent 必须在 project 目录跑，不能用 `process.cwd()`（backend 启动目录无意义且违反 `CLAUDE_WEB_ALLOWED_ROOTS` 校验）。SQL：`SELECT cwd FROM harness_project WHERE id = ?`。

### 5. 内存层并发保护（M2 改 ResourceLock）

tick 时检查 `STAGE_ACTIVE_STATUSES = {pending, running, awaiting_review}`：同一 Issue 同一 Stage kind 已 active 则拒绝重复 spawn。M2 改 SQLite 行锁 / 文件锁 / ResourceLock 表。

---

## Consequences

**Pros**：
- ✅ M1 dogfood 可立即开跑：手动 tick → 真 spawn claude CLI → WS broadcast 全链路 live
- ✅ M2 替换路径清晰：5 条都明示了"M2 改造点"，不会被骨架锁死
- ✅ 跨端协议合规：`harness_event` 4 个新 kind 已注册到 [protocol.ts](../../packages/shared/src/protocol.ts)（`stage_started/stage_message/stage_done/stage_failed`），broadcast 调用点不绕过 ServerMessage
- ✅ schema 合规：issue/stage 状态枚举与 [migrations/0001_initial.sql](../../packages/backend/src/migrations/) CHECK 约束完全对齐

**Cons**：
- ❌ `bypassPermissions` 期间 agent 可执行任意 tool 不被审计 — 仅限 M1 骨架，M2 必修
- ❌ 内存并发保护重启即失效 — M2 ResourceLock 才持久化
- ❌ 没有 priority queue / fairness — 永远拉最旧 Issue，可能饿死新 Issue（M1 不修，dogfood 不需要）

**不可逆度**：低。骨架，M2 全部替换。回滚路径：drop scheduler.ts + tick endpoint + harness_event 4 个新 kind，issue/stage 表照样可用。

---

## 替代方案及为何驳回

| 方案 | 驳回理由 |
|---|---|
| 跳过 M1 直接做 M2 真 ContextManager | 没有 dogfood 信号，无法判断 ContextManager 该编排什么；先骨架跑通再迭代 |
| permission mode = `default`（走 hub） | scheduler 无交互前端，hub 会永远 pending；M2 才有 scheduler-side approver |
| Stage 完成态加 `"done"` 到 schema | 改 migration 风险高于 M1 收益；用现有 `approved` 即可 |
| 自动定时 tick（cron） | 第一次 dogfood 必须可控，避免 runaway |

---

## Risk-Triggered Migration

如果 M2 dogfood 显示：
- 内存并发保护失效（重启时 active stage 漂移）→ 优先做 ResourceLock 表 + tick 启动时扫描 stale active
- bypassPermissions 期间发生误操作 → 立即接 permission hub（即使 M2 其他部分未完工）
- Issue 排序不公平（饿死）→ 加 `last_picked_at` 字段 + round-robin

---

## Review trail

- Phase 1 cross verdict（Sonnet）：[reviews/scheduler-skeleton-cross-2026-05-05-1200.md](../reviews/scheduler-skeleton-cross-2026-05-05-1200.md) — 2 BLOCKER + 3 MAJOR + 4 MINOR，overall 2.8
- Phase 1 cross verdict（cursor-agent）：未持久化（lessons：见 retrospective §5），但口头反馈命中 2 个额外 schema BLOCKER（issue/stage 状态枚举与 CHECK 约束不符）
- Author 仲裁：4 BLOCKER 全修 + 3 MAJOR 全修 + 3 MINOR 修（m4 跳过：tick 端点 auth 在 M1 不做）
- 修复 commit：`77c8fdf` (`fix(harness): phase 3 仲裁修复 — 4 BLOCKER + 2 MAJOR + 3 MINOR`)
- 初始实现 commit：`d8022c4` (`feat(harness): Eva Scheduler M1 骨架 — EvaScheduler + tick 端点`)
- PR：#3 → dev
- 流程改进：本批违反"先 plan + review 再做"，改进沉淀至 PR #4（reviewer-cross/SKILL.md + harness-review-workflow/SKILL.md）

---

## 与其他 ADR 的关系

- [ADR-0014](ADR-0014-context-bundle-explicit.md)：M1 ContextBundle 仅"issue title + body 拼字符串"，是本 ADR §1 的极简降级；M2 接真 ContextManager 后由 ADR-0014 的显式 ArtifactBundle 替换
- [ADR-0011](ADR-0011-server-driven-thin-shell.md)：scheduler tick endpoint 接 server-driven，未来可暴露给 iOS 触发
- [ADR-0013](ADR-0013-worktree-pr-double-reviewer.md)：M2 worktree 隔离 + double reviewer 替换本 ADR §5 内存并发保护
