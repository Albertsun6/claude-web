# Phase 1 Review — Architecture-fit lens
> Reviewer: harness-architecture-review · Date: 2026-05-03 · Phase 1 (independent)

## Summary verdict
ACCEPT-WITH-CHANGES

## Findings

### F1. Stage B 与 M-1 数据模型契约时序冲突 — [BLOCKER]
**Where**: §5 Stage B, §10 "不可逆度低"
**Issue**: Stage B 提议在 `harness-store` 加 `issue_dependencies(parent_issue_id, child_issue_id, kind)` 表。但 M-1 状态显示 4 核心契约里**数据模型契约**刚走完 Round 2 评审收敛（见 retrospectives），M0/M1 都没启动；Issue schema 还没真正落库一行。proposal 同时声明"不可逆度低 / 全部可改可删"，与"加 DDL 表"互斥——schema migration 一旦有真实数据就需要迁移脚本（参考 ADR-0010/0015 schema 迁移策略）。
**Why it matters**: 越过 M-1 还在收敛的 Issue 实体直接给它加新表，会绕开"M-1 一次性奠基→之后任何分层/协议变更走 ADR"原则（HARNESS_ROADMAP §0 #3）。Phase 2/3 skip 的前提"低不可逆"被打破。
**Suggested fix**: Stage B 的 schema 加表必须改走 ADR-lite 流程，并在文中显式标注"等 M-1 数据模型契约 freeze + M1 Issue CRUD 落地后才能起评"。或：Stage B 改成在 `Issue.metadata_json` 用 typed metadata 存 `depends_on` 列表（不动 schema），Stage C 真正需要 join 查询时再升级到独立表。

### F2. 重复 ContextBundle.artifact_refs_json 的隐式依赖机制 — [MAJOR]
**Where**: §4 "缺口" 第 1 项 + Stage B 整段
**Issue**: 报告自己在 §4 ✅ 段已经识别到"ContextBundle.artifact_refs_json 提供 task 输入工件清单，等价于隐式依赖"，但 §5 Stage B 又新增 `issue_dependencies` 边表。两套依赖机制并存（Issue 级 explicit 边 + Task 级 ContextBundle 隐式边）会造成"哪条是 source of truth"的歧义——尤其 Issue 跨多个 Stage，每个 Stage 的 Task 都有自己的 ContextBundle。
**Why it matters**: 双依赖体系是 schema 长期负债；scheduler 选 ready issue 时要 union 两边，retrospective 复盘"为什么这条 Issue 等了"也要 union。harness 强调"窄腰"(§0 #11)，应优先复用现有抽象。
**Suggested fix**: 在报告里显式回答"为什么 ContextBundle.artifact_refs 不够用"。一个合理回答是"Issue 还没 spec 出来时无法填 ContextBundle，所以需要更早期的 Issue 级别依赖"——如果是这样请把这条理由写进 Stage B 设计动机段。

### F3. Stage C "M2 之后" 的承诺过于模糊 — [MAJOR]
**Where**: §5 Stage C "退出条件：M2 review-orchestrator 已 ship + harness Issue 真实存量 ≥20 个"
**Issue**: scheduler.ts 在 HARNESS_ROADMAP §3.2 是 M2 模块（与 review-orchestrator 同行）。Stage C 说"M2 之后才上"，但 scheduler.ts 本身就是 M2 必交付物——意思是"等 M2 把 scheduler 做出来再加 DAG 拓扑"还是"占用 M2 的 scheduler 工作量塞 DAG"？两者实施成本差一个数量级。另外 ≥20 Issue 的硬数字未说明来源。
**Suggested fix**: 把 Stage C 拆成两个子项：(C1) M2 scheduler.ts 必须留 hook 接口接受 dependency-aware pluggable strategy；(C2) DAG fan-out 在 M3 retrospective 数据回看后再启用。这样不和 M2 主线抢预算。

### F4. 个人单用户场景下 DAG fan-out 价值未论证 — [MAJOR]
**Where**: §0 + §5 Stage C + §8 待用户拍板 #1
**Issue**: harness 垂直定位是"个人 AI software engineer / 永不商业化 / 永不开放给 team"（HARNESS_ROADMAP §0 #13）。报告自己在 §2.a 引证 "sweet spot 2-4"，§9 Q1 也承认"是不是手动 git stash + worktree 就够了"是关键问题。Stage C 的 scheduler 拓扑排序本质上是"agent 团队管理工具"——个人单设备一次只能盯 1-2 个 conversation，自动 fan-out 反而触发 §3 表里的"监控负担"失败模式。
**Why it matters**: 越过 vertical 边界做 enterprise SaaS 形态的功能是 harness 反复警惕的反模式（HARNESS_LANDSCAPE 战略含义"L1/L2 不卷"）。
**Suggested fix**: 在 §5 Stage C 开头加一段 "vertical fit gate"：明确除非 Stage A+B 跑满 1-2 个月后用户主观体感"我已经在手动调度 ≥3 个并行任务且累"才解锁 Stage C；否则永久不做。这是 §0 #13 单用户定位的天然刹车。

### F5. §10 跳过 phase 2/3 论证不充分 — [MAJOR]
**Where**: §10 "Phase 2/3 评审 skip 原因"
**Issue**: skill OQ1 触发规则（SKILL.md）明确："M-1/M0 期一律跑 phase 2"。当前是 M-1 期。报告援引"决策完全可逆"作为豁免，但 (a) 当前是 M-1 阶段就触发硬规则；(b) Stage B 含 schema migration 同样命中"涉及 schema migration / 不可逆"触发条件之一。
**Suggested fix**: 要么把 §10 改成"phase 1 双 reviewer + phase 2 仅在 BLOCKER 不一致时触发"（这正是当前已 spawn 两位独立评审的形态），要么直接走完整 phase 2。建议前者并落到 REVIEW_LOG。

### F6. MAX_PARALLEL=2 与 backend 已有 per-cwd 并行 run 模型耦合未说清 — [MINOR]
**Where**: §6 第 2 条
**Issue**: backend cli-runner 已经支持每个 WS 连接的 parallel-run map（见 CLAUDE.md backend 段）。MAX_PARALLEL 是限制 scheduler 主动 spawn 的 conversation 数，还是限制总并发？用户主动新开第 3 个对话被拒绝吗？
**Suggested fix**: 在 §6 第 2 条加注："MAX_PARALLEL 仅约束 scheduler 自动 fan-out；用户主动 spawn 不在配额内"。

### F7. §7 新增 IDEAS P8 stacked PR 与 P7 范围重叠 — [MINOR / FALSE-POSITIVE-CANDIDATE 置信度中]
**Where**: §7 第 4 项
**Issue**: 新增 P7（依赖调度器）+ P8（stacked diffs）作为两条 idea，但 stacked diffs 本质是"线性依赖链"，和 DAG 是同一抽象的两种 UX。同条 issue 同时挂 P7 和 P8 容易让后续 IDEAS reviewer 来回复盘。
**Suggested fix**: 合并为一个 P7 "依赖感知调度（含 DAG + stacked-diff UX 两种呈现）"，或 P8 显式标 "P7 的 alternative UX，不并行实现"。注：可能我误读，作者也许刻意想分两条 track。

## Strong points (don't lose these in revisions)
- §1 横向调研 5 种架构 + §2 五条共识规律是高质量前置；引证密度足够，非通用 best practice。
- §3 失败模式表把 "Microsoft swarm 集成阶段崩了"、"集成是真正难的"翻成具体缓解措施，避免重蹈。
- §6 关键不变量第 1、3 条（merge 必须人审 / 不做 file-overlap detection）是正确取舍，与 harness §16.3 哲学一致。
- §5 三阶段切分本身合理：Stage A 退出条件"2 周 ≥3 feature 不出事故"是 outcome-based 不是 calendar-based，符合 §0 第 14 条。
- 主动列出 §8 4 个用户决策 + §9 4 个 Open Questions，符合"先讨论再做"用户偏好。

## Open questions for the user (not blockers, just to consider)
- 你目前真实并行任务数中位数是几？（Stage C 是否有真实需求的关键证据）
- 如果 ContextBundle.artifact_refs 加上 "Issue-level pre-spec ref" 字段，是不是就不需要单独 issue_dependencies 表？
- 想保留 "用户主观体感累了才解锁 Stage C" 这种感性触发器，还是更愿意定一个量化指标（比如近 30 天有 ≥10 次手动 worktree 切换）？
