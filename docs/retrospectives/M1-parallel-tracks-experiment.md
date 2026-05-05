# M1 双轨并行实验 Retrospective

> **状态**：✅ 完成（2026-05-05）
>
> **结果分类**：**PASS**（至少 1 次真实 coordination failure 有 timestamped 证据 — 详见 §3.1）
>
> **关联**：[plan](~/.claude/plans/dapper-greeting-tide.md) · evidence: `~/.claude-web-experiment-evidence-2026-05-05/` · PR #11 (Stage 0 board) · PR #12 (Track 1) · PR #13 (Track 2)

> 注：本 retrospective 是 M1 双轨**实验**复盘（一次性，非常态化）。"实验目标不是最高效 ship，而是产 M2 设计信号"（plan）。功能交付（mini #3.1 ContextManager 骨架 + scheduler defects fix）是次要副产品。

---

## 1. 起点 vs 终点

### 进入时
- M1 mini #1（Scheduler 骨架）+ mini #2（stage-aware prompts）已 ship 到 prod v0.4.2
- 用户三连问触发 design rethink：人驱动并行 scalability / 风险 / 是否跳到 M2
- 决议：跑 1 次受控双轨实验，**产 M2 设计信号**，不常态化
- Stage 0 web 看板 + 双 worktree + 三 backend 实例 setup

### 离开时
- ✅ 双 PR (PR #12 Track 1 + PR #13 Track 2) 全部合 dev
- ✅ Stage 0 web 看板 (PR #11) live + 用户实测看过
- ✅ Evidence freeze 124K 文件落档
- ✅ 至少 1 条强 M2 信号产出（lock 文件语义漂移）
- 🟡 看板退出决定：见 §6
- 🟡 临时资源未清（Stage 5 cleanup 在 retrospective 之后）

---

## 2. 时间线（按时间序）

| 时间 | 事件 | 实验信号 |
|---|---|---|
| 14:30 | plan 写入 + cursor-agent 评审（5 MAJOR 全应用）+ 用户 manual review 5 项再修 | 反复迭代 plan，本身是信号：复杂提案 phase 1 cross 不够，需要 author 自查 → 沉淀 memory `feedback_self_check_after_review` |
| 15:00 | Stage 0 web 看板实施 + cursor-agent + 实测 + PR #11 + 合 dev | 看板挂在 :3031 dev backend，env-gated |
| 15:30 | Stage 1: 双 worktree (`~/Desktop/claude-web` + `~/Desktop/claude-web-mini3`) + 三 backend (3030 stable v0.4.2 / 3031 launchd dev / 3032 throwaway dev) + WORKTREE_LOCK 注册 Track 1 行 | 三端口同时 alive |
| 15:45 | Track 1 实施 + cursor-agent (2 BLOCKER + 3 MAJOR + 1 MINOR 全应用) + PR #12 | Track 1 改 scheduler.computeNextStage / fallback-config / iOS Settings copy / mini #2 retrospective |
| 16:00 | Track 2 用户在 mini3 worktree 独立实施 + cursor-agent (1 BLOCKER + 3 MAJOR + 2 MINOR 应用 5/6) + commit on Track 2 base | Track 2 改 scheduler.spawnAgent + 新建 context-manager.ts |
| 16:20 | Track 1 PR #12 → dev squash merge (`7a68335`) | 触发"先合先到"约定 |
| 16:21 | Track 2 rebase onto origin/dev | **Git 报 0 conflict 但 WORKTREE_LOCK.md 语义漂移**（信号 #1） |
| 16:25 | Track 2 单独 fix commit `e8d2f81` 修 lock placement + push + open PR #13 | 信号 #1 captured 在 commit history |
| 16:30 | PR #13 CI ✓ pass | |
| 17:00 | Evidence freeze 124K（Stage 3） | |
| 17:01 | PR #13 merge dev (`e80a5b4`)（Stage 4 当前）| |

---

## 3. Q2 风险实证 vs 理论对照表

| # | 理论风险（plan §Q2）| 实证发生？ | 评级 | 证据 |
|---|---|---|---|---|
| 1 | WORKTREE_LOCK.md drift | **是 + 加倍** | **🔥 强信号** | git diff `WORKTREE_LOCK.md` rebase 后语义错置（worktree-lock-full-diff.patch + commit `e8d2f81`） |
| 2 | 共享文件 hot path 冲突 | 没有（物理） | — | scheduler.ts 双方改不同段（computeNextStage vs spawnAgent），git 0 conflict |
| 3 | dependency 漂移 | 微弱 | 弱 | iOS Settings.swift 跨 Track 1 ownership 例外（cross M2 修了 footer copy）— 不是 dep 漂移本身但相同性质 |
| 4 | dogfood 数据隔离边界外漏 | 未触发 | — | 双 DATA_DIR 隔离 OK；本实验未跑 dogfood agent，没碰 ~/.claude/projects/ session jsonl |
| 5 | port 命名混乱 | 未触发 | — | 3030/3031/3032 三个够用，没扩到第 4 个 |
| 6 | 认知切换成本 | **是** | 中信号 | 频繁切 worktree 累；看板**计划上**应缓解但**实际未常用**（见 §6）— 我主要靠终端 git/gh 命令 |
| 7 | fixture 漂移 | 未触发 | — | fallback-config.json Track 1 改 / Track 2 没碰，零干扰 |
| 8 | cursor-agent 评审独立性破 | 未触发 | — | 双 track 各自独立 prompt + 临时 /tmp 文件，verdict 独立产出 |
| 9 | dev backend launchd 状态混乱 | **轻微** | 弱 | :3032 throwaway 用 pnpm dev:backend 起前台，需手动 ps + kill；用户曾问 "track2 还活着吗" — 信号 |
| 10 | commit 顺序敏感 | 是 | 弱 | Track 1 先合，Track 2 必须 rebase。Rebase 路径走通了但有信号 #1 |

**实证强度**：10 条理论风险，1 条强信号 + 2 条中信号 + 2 条弱信号 + 5 条未触发。

### 3.1 强信号 #1 — Lock 文件语义漂移（PASS 触发条件）

**Where**：`WORKTREE_LOCK.md` rebase 后状态（commit `e8d2f81` 修复前）

**What**：
- Track 2 在 base `13c4129`（Track 1 未 merge 时）写自己 lock 行，append 到当时唯一存在的 markdown 表格
- Track 1 PR #12 merge 引入新 "Active Locks" 段 + 把 OLD 表改名 "Historical Locks"
- Track 2 rebase 时 git **零 conflict 报告**，但 Track 2 行**留在 OLD 表**（被改名 Historical 段）
- 语义错置：Track 2 行被错误归到 Historical（已下线）段而非 Active（运行中）段

**Why this matters**：
- Git line-level merge 算法**不懂段落语义**
- 人审或自动化系统读 lock 文件时，Track 2 行被 Historical 段误导 = 当作已结束任务
- 看板 parse Active 段才显示，Track 2 行**不会**在看板显示（M2 自动化必修）

**M2 推论 #1（自动化最高优先级）**：**自由 markdown 锁文件靠不住，必须用结构化 lock schema**：
- 候选 1: SQLite `worktree_lock` 表（与 harness.db 同库），`active`/`done`/`released` 状态机 + FK 到 issue/stage
- 候选 2: YAML / JSON 格式 + JSON Schema 校验 + structured merge tool
- 候选 3: 单独 lock service / API，不在 git tracking 里（避免 merge）

**修复 commit**：`e8d2f81` 手动 reposition Track 2 行到 Active 段。这是手动操作 — 暴露**第 11 条隐含风险**：rebase 报 ok 不等于语义对，需要人工二次审核。

---

## 4. M2 自动化 prioritized 信号

按本实验产出的强弱排序：

### P0（必做，强信号驱动）
1. **结构化 lock schema** 替代自由 markdown — 信号 #1 直接需求
2. **rebase 后语义校验** — git success ≠ semantic ok，需要 lint / CI 步骤检测段落漂移

### P1（中信号驱动）
3. **看板 actually 用得上**（避免 Stage 0 重蹈覆辙） — 见 §6 看板退出决定
4. **跨 ownership 文件 ownership 矩阵 v2** — Track 1 不得不修 iOS Settings.swift 因 cross-end 一致性。M2 必须把 cross-end 维度纳入 ownership 矩阵

### P2（弱信号驱动）
5. **throwaway backend lifecycle** — `:3032` 前台 backend 没 launchd 管，依赖人脑记得 kill。M2 自动 spawn 时必须有自动 teardown
6. **cursor-agent verdict 落盘自动化** — 我两次跑 cursor-agent 都遇到 "shell rejected" + "subagent fallback"，verdict 落 docs/reviews/ 但路径不一致（一次 1100 → 1104 重命名 / 一次直接 1546）。M2 review-orchestrator 需要标准化路径

### Out of scope（明确不在本实验产出）
- M2 真 agent 自动并行（worktree 自动创建 + ResourceLock + permission hub）— 仍按 plan 留 M2 范围

---

## 5. 学到的（沉淀，已落 memory / skill）

| 教训 | 落档位置 |
|---|---|
| cross verdict 应用后必须自查 internal consistency（不能直接 ExitPlanMode）| `feedback_self_check_after_review.md` |
| 周期收尾必给 next-step 调查（3-4 option + 推荐）| `feedback_cycle_closing_survey.md` |
| 默认自动授权常规权限提示（危险操作仍要确认）| `feedback_auto_approve_permissions.md` |
| L7 ops infra fix 仍需 cursor-agent 评审（patch-ops 模式）| `harness-review-workflow/SKILL.md` patch-ops mode |
| schema fact-check 必须读 migration SQL 原文 | `reviewer-cross/SKILL.md` Lens 1 |
| **NEW**：rebase 报 0 conflict ≠ 语义对，markdown 锁文件不可靠 | 本 retrospective + M2 plan input |

---

## 6. 看板退出决定（plan §"看板自身不是 track" 二选一）

按 plan exit rule 评估：

| 评估维度 | 结果 |
|---|---|
| 看板帮上忙吗？ | **微弱** — 我自己在终端跑 gh / git 命令更快；用户实测看过但实操中也是终端为主 |
| API contract 适合 M2 web harness UI 演进吗？ | **不适合** — 4 段（worktrees/backends/prs/locks）是实验 topology 专属，M2 真 harness UI 需要 issue/stage/run/agent/notification 等更多维度 |
| Backend `/api/experiments/parallel-board` 实现质量 | OK 但 throwaway 设计 — 路径前缀 + env gate + 无 WS push，扩展性低 |

**决定：删除**（cleanup PR 在 Stage 5 处理）。理由：
- 看板没真显著缓解 Q2 #6 认知切换成本
- API schema 与 M2 真 harness UI 不兼容，保留反误导
- 沉淀的是"web 看板 ≠ 终端命令更慢"的认知 — 这本身是 M2 信号（web UI 必须有终端做不到的功能才值得做）

**M2 web harness UI 设计输入**：
- 不要复制本看板 4 段 schema
- 必须提供"终端做不到"的功能：实时 WS push（不是 5s polling）/ 多 worktree 联合视图 / 历史 timeline 而非快照
- 否则 M2 看板会重蹈"实现了但没人用"覆辙

---

## 7. 流程问题（不是技术问题）

实验过程中出现的 process drift：

1. **plan 应用 cross verdict 后我直接 ExitPlanMode**（用户 manual review 抓出 5 个真问题）— 已沉淀 `feedback_self_check_after_review`
2. **Track 2 在 base `13c4129` 写 lock 行时**没注意到 dev 已经有 Track 1 的"Active Locks"段（实验本身的 race condition）— 部分原因是看板只读主 worktree，看不到 dev 上的最新 lock 状态
3. **iOS Settings.swift 改动跨 Track 1 ownership** — cross verdict M2 强制要求改 footer copy；ownership 矩阵未涵盖 cross-end 一致性维度

---

## 8. 阶段成功标准复核

per plan §"阶段成功标准（cross M2 修：可证伪化）"：

| 维度 | 触发条件 | 本次 |
|---|---|---|
| **PASS** | ≥1 次真实 coordination failure with timestamped evidence | ✅ 信号 #1 lock 语义漂移有 commit hash + 时间戳 |
| INCONCLUSIVE | 双 PR 全程独立无任何冲突 | 不适用（信号 #1 触发 PASS） |
| FAIL | setup 时间 > 实施时间 OR 阻塞主 Track | 不适用（setup ≈ 实施时间，未阻塞） |

**结论：PASS。** 实验产出至少 1 条强 M2 信号 + 5 条 prioritized list + 看板退出决定。

---

## 9. 不变量 / 后续保护

退出本实验后，明确**不变**：

- ❌ **不会**再做"人驱动并行实验"（按 plan §Q3 不常态化承诺）
- ❌ **不会**留 Stage 0 看板代码（删除决定）
- ❌ **不会**继续维护 `:3032` throwaway backend
- ✅ **保留** evidence 目录 `~/.claude-web-experiment-evidence-2026-05-05/`（M2 设计参考）
- ✅ **保留** WORKTREE_LOCK.md `Historical Locks` 段记录（append-only 原则，永不删历史）

---

## 10. 关键 commit

| commit | 内容 |
|---|---|
| `13c4129` | feat(experiment): parallel-tracks board (Stage 0, env-gated) (#11) |
| `7a68335` | fix(harness): Track 1 — scheduler defects fix + agentProfiles enable + mini #2 retrospective (#12) |
| `e8d2f81` | chore(harness): WORKTREE_LOCK.md — reposition Track 2 row (rebase semantic drift fix) — **信号 #1 永久 commit** |
| `e80a5b4` | feat(harness): Track 2 — ContextManager M1 mini #3.1 skeleton (cross-reviewed) (#13) |
| (本 commit) | docs(retro): M1 双轨并行实验 retrospective + Stage 5 cleanup |

---

**M1 双轨并行实验 终结**：✅ PASS — 至少 1 条强 M2 信号产出（lock 文件语义漂移）+ 看板退出决定（删除）+ evidence 落档 124K + 6 条 process / methodology 教训沉淀。**实验目标达成 — 不再做第 2 次人驱动并行**。
