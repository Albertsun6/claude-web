# Phase 3 Arbitration — Parallel Work Orchestrator v0.4

> **Author**: Claude (Opus 4.7) · **Date**: 2026-05-03 · **Phase 3** (author arbitration)
> **Inputs**: phase 1 双 verdict (arch / cross) + phase 2 双 react verdict (react-arch / react-cross)
> **Output**: 本文件 + 应用到 v0.5

## 仲裁结果总览

| 类别 | 数量 |
|---|---|
| ✅ 接受 | 13 |
| ⚠️ 部分接受 | 1（cross-F4 严重度，修订动作完全采纳） |
| 🚫 反驳 | 0 |
| 🟡 用户决定 | 2 |
| **总计** | 14 unique findings + 5 phase 2 new findings (dedup 后纳入) |

收敛状态：**Round 1 收敛**（无未解 BLOCKER；🟡 在 ≤3 上限内）。

## 关键修订（双方 phase 2 一致）

### 1. Stage A scope creep —— 强证据双锁

`arch-F1 BLOCKER` + `cross-F2 MAJOR`，phase 2 cross react 给出"中间路径"被双方认可：

- **保留**：`work.jsonl` 最小写入（≤50 行）+ `GET /api/work?cwd=` 端点 — 支持 §5.A 冲突 toast 的"已有 idle worktree" 数据源
- **移除**（推到 **新 Stage A.5**）：Dashboard tab 2 工作台 / stale 检测 / commitCount / prUrl / finalizeAction / Dashboard tab 4
- WorkRecord 收窄到：`{id, worktreePath, branch, baseBranch, status, conversationTitle, lastActivityAt, createdAt}` — 7 字段（v0.4 是 13 字段）

### 2. 三 store 边界划清（cross-F1 + arch-F2 + cross react N1）

**单一真相源原则**：
- `projects.json` = cwd 级（哪个 cwd 是项目）
- `run-registry.ts`（内存）= 实时 in-flight run
- `work-registry`（jsonl，新）= conversation × worktree 级历史
- **work-registry 不存 cwd**：cwd 永远从 `conversationId → projects.json` join 得，避免双写漂移

### 3. lockfile confabulation 修正（cross-F1 + arch react N3）

**v0.4 错误**：声称 work-registry "参 inbox-store.ts: append + lockfile" — 实际 inbox-store.ts **没有** lockfile（[inbox-store.ts:80-89](packages/backend/src/inbox-store.ts), `appendFileSync` + `writeFileSync` 裸跑）。

**v0.5 修订**：work-registry 改"参 [projects-store.ts](packages/backend/src/projects-store.ts)：atomic temp rename + read-modify-write + promise-queue 写锁"。inbox-store.ts 也应该补这个（不在本 proposal 范围，但记 §9 Q）。

### 4. 路径安全 + id 规范（cross-F4）

**v0.4 缺**：proposal 没显式说 worktree id 怎么生成。`verifyAllowedPath`（[auth.ts:114-132](packages/backend/src/auth.ts)）只校验 resolved path 在 allowed root 下，**不防** id 内含 `../`。

**v0.5 修订**（采纳 cross 的 fix，严重度从 BLOCKER 部分降为 MAJOR — 不影响修订动作）：
- id = server-side `randomUUID()`，**不接受**客户端传入
- branch slug 限定 `^[a-zA-Z0-9._/-]+$` 且禁 `..` / 绝对路径 / 空段
- 所有 destructive cleanup 先 `path.resolve()` 并确认 prefix 是 `path.join(cwd, '.claude-worktrees')`

### 5. node_modules 默认不 copy（cross-F3 + arch react N1）

v0.4 把 `cp -RL node_modules` 当 dogfood 候选——cross 验证此 repo 是 pnpm workspace（[pnpm-workspace.yaml](pnpm-workspace.yaml) + [package.json:12](package.json) + workspace deps），cp -RL 会解引用 .pnpm/ 链接造成磁盘膨胀 / workspace 链接断 / native dep 状态分叉。

**v0.5 修订**：
- 默认**不** copy node_modules
- worktree 创建后弹 toast："worktree 内未安装依赖，pnpm test/build 前请回主 cwd 同步 + `pnpm install`"
- "复用主仓 node_modules（symlink）"作为后续 dogfood 实验，不是 Stage A 默认

### 6. Dashboard 依赖图改列表（cross-F7 + arch-F4）

**v0.4 错**：B2 提议 conversation × Issue 拓扑图。手机端拓扑图 UX 历史性差。

**v0.5 修订**：
- B2 退出条件**只**包括 picker（不要求拓扑图渲染）
- Dashboard 依赖呈现默认 list view："blocked by X" / "blocks [Y, Z]"
- 拓扑图作为 dogfood 实验，B3 或 IDEAS 候选，不在 B2 主线

### 7. vertical-fit gate 量化（arch-F3 + cross react N2）

**v0.4 缺**：gate 只写"6 个月 + 用户主动评估"。arch + cross 都判软口号。

**v0.5 修订**：C1 day 1 起记录：
- (a) scheduler 推荐接受率（接受 / 总推荐）
- (b) 用户跳过推荐的原因（自由文本 telemetry）
- (c) 用户在 Dashboard 主动找"下一个跑"频次（**不**用 tab 4 打开次数 — 那个 tab 已降级）
- (d) 过去 30 天用户是否反馈"手动模式不够"

gate ADR 模板硬要求这 4 项数据 + 阈值 → fail 则 C2 永不上，IDEAS 存档。

### 8. 不变量列表清理（arch-F5）

**v0.4 错**：把"总管家 Stage A baseline"塞进 §6 不变量 #9，与"human-in-the-loop merge"等同档不变量混为一谈。

**v0.5 修订**：
- §6 不变量 **删** #9（移到 §5 stage 拆分前的 rationale 段）
- §6 不变量保留 1-8（含 #8 "对话粒度 = feature train"，这条是真不变量）

### 9. invariant #8 wording 修正（cross-F5）

**v0.4 错**：暗示切换对话会杀进程。**v0.5 修订**："conversation switch only changes UI focus; run continues until session_ended / interrupt / WS close（[index.ts:280-285,422-428](packages/backend/src/index.ts) + [BackendClient.swift:238-287](packages/ios-native/Sources/ClaudeWeb/BackendClient.swift)）"

### 10. token caching 数字删除（cross-F6 + arch react N2）

**v0.4 错**：声称"省 30-50%"无来源。**v0.5 修订**："基于 Claude prompt caching 机制，预期同对话连续 prompt 更省；具体比例 dogfood 后用 telemetry 验证"。

### 11. P7 vs A3 边界（cross-F8）

**v0.5 修订**：
- IDEAS P7 = "依赖感知 Work Registry / Dashboard / scheduler recommendation"
- IDEAS A3 = 保留"从 issue/PR 描述启动 agent 并产出 PR"
- 两者不再重叠

## 反驳（🚫，0 条）

无。

## 🟡 用户决定（2 条，硬上限 ≤3 内）

### U1. 推进范围（保留，arch react 4 推荐"a"）

| 选项 | 范围 |
|---|---|
| **a. 只 Stage A** | worktree opt-in + work.jsonl 最小写入 + 冲突 toast |
| **b. A + A.5 + B1 + B2** | 加 Dashboard 工作台 + issue.metadata_json migration + dependency picker |
| **c. A + A.5 + B + C 全做（含 vertical-fit gate）** | scheduler + DAG fan-out（gate 决定 C2） |

### U2. Stacked PR 拆分

| 选项 | 含义 |
|---|---|
| **不做（推荐）** | 1 conversation = 1 PR；想 stacked 用 Graphite |
| Stage B+ 才上 | finalize 时按 commit 拆 stacked branches |
| 永远不做 | 锁死 |

## 收敛后已被消化的旧 U3 (v0.4 总管家范围)

v0.4 §8 U3 三选一（i/ii/iii）→ 评审收敛后**自动解决**：
- Stage A 只 ship 最小 work.jsonl + endpoint（不在 U3 范围内的"i"也比 i 更小）
- Stage A.5 ship Dashboard tab 2 + stale + commitCount + prUrl
- iii Web 端 Dashboard → 推到 IDEAS P6（已在 v0.3 加）

不再需要用户决定。

## Convergence judgment

- ✅ 13 接受 + ⚠️ 1 部分接受 + 5 phase 2 new findings 全部应用 → v0.5 修订
- 🟡 2 条用户决定（U1 范围 + U2 stacked PR），≤3 上限内
- 🚫 0 条反驳
- **新 BLOCKER 检查**：v0.5 修订后 schema 改动量仍是 1 行（Stage B1 的 issue.metadata_json migration），不引入新 BLOCKER
- **结论**：**Round 1 收敛**，无需 round 2

## 异质评审性能数据（meta）

| Round | Reviewer 矩阵 | 抓到 | 漏掉 |
|---|---|---|---|
| v0.1-v0.2 | 双 Claude (arch + cross) | 架构 / 范围 / wording | **schema 事实错误** (Issue.metadata_json 不存在) |
| v0.3 | 用户外接 GPT-5.5 | schema 事实 + ignore checklist + cp -RL | 架构错位 (conversation = train) |
| **v0.4** | **Claude arch + cursor-agent cross**（异质对，本 round）| 架构 + schema + cp -RL + path traversal + lockfile + 30-50% + Dashboard UX + 拼盘 IDEAS 边界 | （本 round 没漏） |

异质对（Claude + cursor-agent）相比双 Claude（v0.1-0.2），仅 phase 1 就抓到 **3 个 v0.3 才发现的等级 finding**（lockfile / 30-50% / cp-RL 翻案）+ **1 BLOCKER cross 独家**（path traversal id 规范）。证实 reviewer-cross skill 的 Heterogeneity 警告——同模型集体盲区是真问题，cursor-agent 对 fact-check 的 grep 直觉远高于 Claude self-fact-check。

skill `harness-review-workflow` 的"phase 1 reviewer-cross 必须 cursor-agent" 规则（v0.3 round 后加）首次运行结果**强支持**该规则，应**保留为硬要求**。
