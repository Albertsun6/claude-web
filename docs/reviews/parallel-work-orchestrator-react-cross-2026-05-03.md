# Phase 2 React — Cross-correctness lens
> Reviewer: reviewer-cross · Date: 2026-05-03 · Phase 2 (cross-pollinate)

## 对 arch 每条 finding 表态

### Arch-F1 (Stage B vs M-1 数据模型契约时序冲突 BLOCKER) — refine
**对方原文**: "Stage B 提议在 harness-store 加 issue_dependencies(parent, child, kind) 表。但 M-1 4 核心契约里数据模型契约刚走完 Round 2 收敛，M0/M1 都没启动；Issue schema 还没真正落库一行。"
**我的表态**: refine（同意时序确实冲突，但 BLOCKER 等级偏重，且 fix 路径 arch 自己给得不彻底）
**理由**: arch 抓住了我 F8（harness_enabled 与 worktree_root 双账本）漏掉的更上游问题——M-1 还没冻结就提 Stage B 表设计。这强化了我 F8。但 BLOCKER 实际只对"现在动手做 Stage B"成立，对"报告里写 Stage B 蓝图"不成立——proposal §0 自称 research/proposal，不是实施 patch。
**新建议**: §5 Stage B 标题前加准入门槛 "**前置依赖：M-1 Issue 数据模型契约 freeze + M1 Issue CRUD 已落库**"。然后采纳 arch 给的备选路径 "Issue.metadata_json 存 depends_on 列表"——这正好与我 F3 "单 FK 列代替 junction table" 形成 Stage B0 → B1 → B2 三档梯度（metadata_json → 单 FK → junction table），dogfood 决定何时升级。

### Arch-F2 (重复 ContextBundle.artifact_refs_json 隐式依赖 MAJOR) — agree
**对方原文**: "两套依赖机制并存（Issue 级 explicit 边 + Task 级 ContextBundle 隐式边）会造成哪条是 source of truth 歧义。"
**我的表态**: agree
**强化作用**: 这放大了我 F3 的简化论据——双依赖机制加上 junction table 是双倍负债。我 F3 只说"junction table 过度建模"，没说"explicit 依赖本身就和 ContextBundle 冗余"。若把 arch-F2 + 我 F3 合并，结论是 Stage B 应该**先尝试不加任何 schema**，只在 Issue.metadata_json 里塞 depends_on 列表（zero migration cost），观察一个月再决定升级路径。

### Arch-F3 (Stage C "M2 之后" 模糊 MAJOR) — agree
**对方原文**: "scheduler.ts 在 HARNESS_ROADMAP §3.2 是 M2 模块。Stage C 说 M2 之后才上，是等 M2 把 scheduler 做出来再加 DAG 拓扑还是占用 M2 的 scheduler 工作量塞 DAG？"
**我的表态**: agree
**强化作用**: arch 看到的是 roadmap 时序耦合，我 Phase 1 只看了静态文件结构没看 roadmap milestone。这是我 cross 镜头看不到、arch 镜头独有的视角。C1/C2 拆分（scheduler hook 接口 vs DAG strategy）是合理工程切分，应直接采纳。

### Arch-F4 (个人单用户场景 DAG fan-out 价值未论证 MAJOR) — agree
**对方原文**: "harness 垂直定位是个人 AI software engineer / 永不商业化。Stage C scheduler 拓扑排序本质上是 agent 团队管理工具——个人单设备一次只能盯 1-2 个 conversation，自动 fan-out 反而触发监控负担失败模式。"
**我的表态**: agree
**强化作用**: 这是 vertical-fit 维度，我的 5 lens（correctness/cross-end/irreversibility/security/simplification）没覆盖这一层。arch-F4 + 我 F6（Telegram fan-out 风暴）实际指向同一个深层问题——个人单用户场景下 fan-out 既无业务价值又有运维风险。两条合并后，Stage C 的"vertical fit gate"（用户主观体感累了才解锁）直接吃掉我 F6 大部分担忧（不 fan-out 就没风暴）。

### Arch-F5 (§10 跳过 phase 2/3 论证不充分 MAJOR) — disagree
**对方原文**: "skill OQ1 触发规则明确：M-1/M0 期一律跑 phase 2。当前是 M-1 期。"
**我的表态**: disagree
**理由**: 此刻我们正在跑 phase 2，所以这个 finding 在 react 阶段已被流程现实推翻。事实上当前"两个独立 reviewer + cross-pollinate"已是 phase 2 形态。arch-F5 的修复建议（"phase 1 双 reviewer + phase 2 仅在 BLOCKER 不一致时触发"）正在被实际执行——这条与其说是 finding 不如说是 meta-observation，应在 convergence 后由作者补 §10 说明，不进 finding 表。

### Arch-F6 (MAX_PARALLEL=2 与 backend per-cwd 并行耦合 MINOR) — agree
**对方原文**: "MAX_PARALLEL 是限制 scheduler 主动 spawn 的 conversation 数，还是限制总并发？"
**我的表态**: agree
**强化作用**: 这正是我应该在 cross-end 段抓但漏掉的 backend ↔ scheduler 边界歧义。arch 给的 fix（"MAX_PARALLEL 仅约束 scheduler 自动 fan-out；用户主动 spawn 不在配额内"）干净直接，应采纳。

### Arch-F7 (P8 stacked PR 与 P7 重叠 MINOR / FALSE-POSITIVE-CANDIDATE) — agree
**对方原文**: "P7（依赖调度器）+ P8（stacked diffs）作为两条 idea，但 stacked diffs 本质是线性依赖链，和 DAG 是同一抽象的两种 UX。"
**我的表态**: agree
**强化作用**: 与我 F7 完全收敛——双方独立都看到 P8 是 P7 alternative UX 不应另开 IDEAS 条目。两位 reviewer 在 simplification lens 下重合是好事，作者应直接合并采纳。

## 我自己 Phase 1 verdict 的自我修正

### F1 (pnpm symlink MAJOR) — keep
arch 没碰这条；我对 pnpm 拓扑的判断仍成立。保留。

### F2 (Microsoft "spectacular crash" 引用 MAJOR/FALSE-POSITIVE) — keep
仍是 false-positive candidate，arch 没独立验证，需要 phase 3 时 WebFetch 确认。

### F3 (issue_dependencies 过度建模 MINOR) — keep + 强化
arch-F2 把它从 "junction 太重" 升级到 "整套 explicit 边都冗余"，我 F3 升格为 "考虑零 schema 起步"。仍 keep 但和 arch-F1/F2 合并落地。

### F4 (iOS dependency picker 假设 Issue 表存在 MAJOR) — downgrade 到 MINOR
arch-F1 让 Stage B 整段移到 M-1 freeze 之后，iOS picker 自然延期；当下不再是阻塞性缺口。仍记录为 cross-end 提示，等 Stage B 真启动时再升回 MAJOR。

### F5 (worktree 路径 allowlist + path-traversal MAJOR) — keep
arch 没覆盖安全 lens；这条独立成立，必须在 Stage A API contract 落地前补。

### F6 (Telegram fan-out 无 throttling MAJOR) — downgrade 到 MINOR
arch-F4 vertical-fit gate 把 Stage C 自动 fan-out 设为"可能永远不做"——风暴前提消失大半。仍 keep 作为 Stage C 解锁前的 must-fix，但优先级降低。

### F7 (P8 stacked diffs 重叠 MINOR) — keep（arch-F7 收敛同方向）
两位独立到位，直接 ship 修订。

### F8 (harness_enabled 与 worktree_root 双账本 MINOR) — keep + 强化
arch-F1 给了上游版本（M-1 freeze 时序）。我 F8 处理的是 Stage A 落地时的 schema 双账本问题，与 arch-F1 互补不重叠，保留。

## 新发现 (new-finding)

### NF1. Stage B "1 周" 估算违反 §0 #6 "no time estimates" 原则 — [MINOR]
**Lens**: simplification + 用户偏好对齐
**Where**: §5 Stage B 副标题 "（1 周）"，§5.A "（1-2 天）"
arch 没看到、我 Phase 1 也没看到的盲区：用户 MEMORY 明确记录 `feedback_no_time_estimates.md` "用准入/退出条件推进，不用 2 周/4 周这种日历估算"。proposal §5 三阶段标题里都带日历估算（1-2 天 / 1 周 / M2 之后），违反此偏好。修复：删除括号里的天数估算，仅保留 outcome-based 退出条件（连续 2 周用 worktree 做完 ≥3 个真实 feature）——后者本身已是用户偏好的"准入/退出条件"形态，无需再加日历数字。

## Convergence summary

- arch 共 7 条 finding。我表态分布：**agree 4 条（F2, F3, F4, F6, F7=5 wait recount）** — agree 5 条（F2/F3/F4/F6/F7），refine 1 条（F1），disagree 1 条（F5）。已满足"≥1 disagree/refine"独立性约束。
- 我自己 Phase 1 共 8 条。修正分布：keep 5 条（F1/F2/F5/F7/F8），keep+强化 1 条（F3），downgrade 2 条（F4 → MINOR、F6 → MINOR）；新增 1 条（NF1 时间估算违反用户偏好）。无 withdraw。
- **真正未收敛 finding（双方都不让步）**：仅 arch-F5（phase 2/3 skip 是否合规）——我维持 disagree，因为正在跑的 phase 2 本身就是反例。这条留给作者在 §10 补一句"phase 2 已在评审过程中触发，仅 phase 3 仍 skip"即可消解，非真分歧。
- **强收敛点**：双方独立到达"Stage B 应零 schema 起步 + Stage C vertical-fit gate + P8 与 P7 合并"三共识。这三条作者可直接合并采纳无需仲裁。
