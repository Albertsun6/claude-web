# Phase 3 Arbitration — Parallel Work Orchestrator

> **Author**: Claude (Opus 4.7) · **Date**: 2026-05-03 · **Phase 3** (author arbitration)
> **Inputs**: phase 1 双 verdict (`-arch` / `-cross`) + phase 2 双 react verdict (`-react-arch` / `-react-cross`)
> **Output**: 本文件 + 应用 ✅+⚠️ 修订到 PARALLEL_WORK_ORCHESTRATOR.md v0.2

## 仲裁结果总览

| 类别 | 数量 |
|---|---|
| ✅ 接受 | 14 |
| ⚠️ 部分接受 | 1 |
| 🚫 反驳 | 0 |
| 🟡 用户决定 | 1 |
| **总计** | 16 (含 phase 2 新发现) |

收敛状态：**已收敛**。1 条 🟡 在硬上限 ≤3 内。

## 逐条仲裁

### Arch findings

| # | Finding (severity after react) | 类别 | 修订动作 |
|---|---|---|---|
| arch-F1 | issue_dependencies 表违反 M-1 数据契约 (BLOCKER → MAJOR) | ✅ 接受 | Stage B 改用 `Issue.metadata_json` 的 typed `depends_on` 列表，零 schema migration。完全规避 ADR-lite 流程 |
| arch-F2 | 双依赖体系（issue_deps vs ContextBundle）(MAJOR → MINOR) | ✅ 接受 | F1 解决后此条自然消解。§4 "对接现有 harness" 段落改写：only ContextBundle.artifact_refs_json 是工件级依赖，metadata_json depends_on 是 Issue 级，不重叠 |
| arch-F3 | Stage C "M2 之后" 模糊 | ✅ 接受 | 拆 C1（scheduler infrastructure，需 review-orchestrator.ts 上）+ C2（DAG fan-out + worktree 自动启），各自 outcome-based 退出条件 |
| arch-F4 | Stage C 越过 vertical 边界 | ✅ 接受 | C 准入加 vertical-fit gate：先做 6 个月 dogfood，若手动选下一个跑能搞定，则**永不上 C2** |
| arch-F5 | §10 phase 2/3 skip 论证不充分 (cross disagree) | ⚠️ 部分接受 | meta-self-refuting（我们正在跑 phase 2+3，所以"skip"已被否决）。应用：删 §10 整段"skip rationale"，改为"phase 2+3 已跑，本提案版本号反映迭代轮次"。理由 log: cross-react 中说 "self-refuting", 我同意 |
| arch-F6 | MAX_PARALLEL 与现有 backend 并行模型耦合不清 | ✅ 接受 | §6 不变量改清：MAX_PARALLEL=2 是 **per-cwd** 而非 per-connection（指本机所有 conversation 在同一 cwd 上的并发）。和 [packages/backend/src/index.ts] per-connection runs map 不冲突 |
| arch-F7 | P7/P8 范围重叠 (false-positive-candidate) | ✅ 接受 | 删 P8，stacked diffs 改成 A3 的 follow-up note |

### Cross findings

| # | Finding (severity after react) | 类别 | 修订动作 |
|---|---|---|---|
| cross-F1 | pnpm symlink 不可行 | ✅ 接受 | Stage A 改 "**copy** node_modules + lockfile，禁止 worktree 内 `pnpm install`"，改 package.json 必须回主 cwd 同步后再用 |
| cross-F2 | Microsoft "spectacular crash" 可能 false-positive | ✅ 接受 | §3 引用改 paraphrase："distributing subtask execution is easy; coordinating subtask outputs remains hard"——这是文章实际结论，不依赖标题 |
| cross-F3 | issue_dependencies 过设计 | ✅ 接受 | 与 arch-F1 同条解决路径（metadata_json） |
| cross-F4 | Stage B "1 周" 不现实，iOS picker 拆 (MAJOR → MINOR) | ✅ 接受 | 拆 B1 backend (DDL + API) + B2 iOS picker（B2 准入：B1 上线 + 用户用 ≥10 个手动标 dep 后再做 picker，不一周强压）|
| cross-F5 | 路径与 CLAUDE_WEB_ALLOWED_ROOTS 冲突 + IDEAS P1 历史路径不一致 | ✅ 接受 | 路径用 `<cwd>/.claude-worktrees/<id>`（server-generated，在 cwd 内），自动满足 ALLOWED_ROOTS。IDEAS P1 同步修订 |
| cross-F6 | Telegram 4 worktree fan-out 风暴 (MAJOR → MINOR) | ✅ 接受 | §6 不变量加：fan-out 完成通知必须 batched，每 cwd 30s 内最多 1 条；429 backoff 走 exponential |
| cross-F7 | P8 subsume into A3 | ✅ 接受 | 同 arch-F7 |
| cross-F8 | `harness_project.worktree_root NOT NULL` collision | ✅ 接受 | Stage A **不**插 harness_project，只更新 projects.json；harness_project 注册延后到 C1 |

### Phase 2 新发现 (cross-pollinate 产物)

| # | Finding | 类别 | 修订动作 |
|---|---|---|---|
| arch-N1 | Stage A 与 harness_project.worktree_root 双 registry 冲突 | ✅ 接受 | 与 cross-F8 同条解决（dedup）|
| arch-N2 | Stage A 准入 checklist 缺 | ✅ 接受 | §5.A 加 "准入 checklist"：(a) pnpm 策略 = copy + lockfile (b) 路径 = `<cwd>/.claude-worktrees/<id>` (c) ALLOWED_ROOTS 自动覆盖 (d) **不**注册到 harness_project |
| cross-NF1 | §5 用 "1-2 天" / "1 周" 违反 user feedback_no_time_estimates | ✅ 接受 | 全 §5 calendar 措辞替换为 outcome-based 退出条件（v0.1 已部分有，但 stage 标题里的"1-2 天 / 1 周"必须删）|

### 🟡 用户决定（≤3 上限内）

| # | Decision | 选项 |
|---|---|---|
| **U1** | **本提案推进范围** | (a) 只 Stage A（worktree opt-in + 冲突 warning，最小可工作版本） / (b) A + B1 + B2（加依赖标记 UI，但仍手动选下个跑）/ (c) A + B + C 全做（最终上 scheduler，需过 vertical-fit gate） |

其他原 §8 q2/q3/q4 都被评审收敛掉了：
- ~~q2 依赖建模 schema vs json~~ → **解决：metadata_json**
- ~~q3 MAX_PARALLEL 2/3/4~~ → **解决：默认 2，A 稳定后 ramp**
- ~~q4 GitHub 集成时机~~ → **解决：Stage A 加 [push branch] 按钮但不自动 PR；自动 PR 留 C2**

## 反驳（🚫，0 条）

无。所有 finding 都收敛或可接受。

## Convergence judgment

- ✅ 14 接受 + ⚠️ 1 部分接受 = 15 条进 v0.2 修订
- 🟡 1 条用户决定（U1 范围），在 ≤3 上限内
- 🚫 0 条反驳
- **新 BLOCKER 检查**：v0.2 修订后的 schema 改动量 = 0，不引入新 BLOCKER
- **结论**：**Round 1 收敛**，无需 round 2

## 下一步

1. 应用 15 条修订生成 PARALLEL_WORK_ORCHESTRATOR.md **v0.2**
2. 交用户最终版本 + U1 单选题（不是 findings list）
3. 用户拍 U1 后进 plan mode 起实施 plan
