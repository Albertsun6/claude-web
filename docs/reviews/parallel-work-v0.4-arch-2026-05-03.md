# Phase 1 Review — Architecture-fit lens (Claude)
> Reviewer: harness-architecture-review · Date: 2026-05-03 · Phase 1 (independent, heterogeneous pair)

## Summary verdict
ACCEPT-WITH-CHANGES

v0.4 已修掉 v0.3 主要架构错位（conversation = train 不是 PR），方案结构基本健康。但 §5.A 把 Work Registry 钉死为 "Stage A baseline + 必备" 是真正的 scope creep，与 Invariant #15（进化是副产物而非独立组件）+ #11（不引入新基础组件）紧张；§6.5 与 projects.json 的责任边界没说清；vertical-fit gate 缺指标抓手。这三条在合并前必须收紧，否则 Stage A 退出时已经背一个无法回滚的"总管家"组件。

## Findings

### F1. Work Registry 作为 Stage A baseline 越界 — [BLOCKER]
**Where**: §5.A "Stage A — Worktree opt-in + Work Registry baseline" + §6 不变量 #9
**Issue**: §6 不变量 #9 直接写"总管家是 Stage A baseline，不是后期附加"。理由是"Stage B picker 依赖列出所有 conversation 端点"。但 Stage A 真正能验证的退出条件只有 worktree 流程（§5.A "退出条件：连续做完 ≥3 个真实 feature 用 worktree 不出事故"），work-registry 的价值取决于 Stage B 是否上——而 Stage B 准入要 ≥10 个手动标依赖案例，非常可能 6 个月内根本不上。
**Why it matters**: 违反 Invariant #15（进化是副产物）。Work Registry 是典型"独立组件"——新 jsonl 文件、新 store、新 routes、新 Dashboard tab——而它在 Stage A 不解决任何已验证痛点（Stage A 痛点是文件冲突，worktree 已经解决）。"端点会返工"不是 baseline 的理由——`/api/work` 端点 Stage B 加 ≤30 行；vs Stage A 强行 ship 一个 jsonl + lockfile + LRU + UI tab，完全反比例。
**Suggested fix**: 把 §6 不变量 #9 删掉。Stage A 仅要 worktree opt-in + 同 cwd 冲突 toast + finalize 三按钮。Work Registry 推到 Stage A.5（Stage A dogfood ≥3 feature 后 + 用户自己说"看不清状态了"再起）；或最低限度 Stage A 只 ship `work.jsonl` 写入（≤50 行），UI 不加 tab。

### F2. Work Registry vs projects.json vs RunRegistry 三者边界未划清 — [MAJOR]
**Where**: §6.5 "数据层" + Q5 (§9)
**Issue**: §6.5 仅说"参 inbox-store.ts 模式"，但没回答关键问题：projects.json 已有 cwd 注册 + lastUsedAt 等字段；run-registry 已有 in-flight 状态；WorkRecord 字段 (cwd / lastActivityAt / status) 与前两者高度重叠。Q5 自己也意识到了"会不会语义漂移"，答案是"每月 audit 一次"——这是**承认会漂移但放任**。CLAUDE.md pitfall #9 就吃过 projects.json 并发写错的亏。
**Why it matters**: 三个 store 同时存 cwd 状态会复制 CLAUDE.md pitfall #9。"每月 audit"是非工程解。从架构上必须**单一真相源**：要么 work-registry 是 projects.json 的 view，要么 work-registry 接管 projects.json 把后者降级为缓存。现在的设计两边都不是。
**Suggested fix**: §6.5 加一段"边界声明表"：projects.json = cwd 级（什么 cwd 是项目）、run-registry = 实时 in-flight、work-registry = conversation × worktree 级历史。明确 work-registry 的 cwd 字段**不读、不写**——cwd 永远从 conversationId → projects.json 解析。或者更简单：work-registry 不存 cwd，只存 conversationId + worktreePath，UI 时再 join。

### F3. vertical-fit gate 缺判定抓手 — [MAJOR]
**Where**: §5.C2 vertical-fit gate + Q1 (§9)
**Issue**: gate 写"C1 跑 ≥6 个月 + 用户主动评估"，没定义"评估依据是什么数据"。Q1 自己也问"数据要怎么记录才能让 gate 决断有依据？"——这正是 v0.3 arch-F4 想避免的"软口号 gate"。如果 gate 只靠用户当时心情，等于没 gate，6 个月后大概率默认上 C2。
**Why it matters**: vertical-fit gate 是 v0.4 控制"个人 vertical 越界"的核心机制。没量化依据则 gate 形同虚设，Invariant #15 / #19（L1/L2 不卷）失去刹车。
**Suggested fix**: 在 §5.C1 加"scheduler 必须从 day 1 记录两组数据：(a) 用户接受推荐次数 / 推荐次数 = 命中率；(b) 用户在 Dashboard tab 4 主动找'下一个跑'的频次"。gate ADR 模板硬要求这两个数据 + "过去 30 天用户是否反馈手动模式不够"。低于阈值 → gate fail → C2 永不上，存档 IDEAS。

### F4. Stage 拆分粒度合理但 B2 Tab 4 越权 — [MINOR]
**Where**: §5.B2 + §6.5 UI 第 Tab 4
**Issue**: A / B1 / B2 / C1 / C2 五段不嫌多——每段都有可独立验证的退出指标，符合 outcome-based 原则。但 B2 把"Dashboard 第 4 tab 依赖图"放进来，是把 UI 投入合并进了"加 picker"工作里。手机屏依赖图是另一类工程难题（Q6 自己承认），混在 B2 会拖延 picker 这个真正高价值的 surfacing。
**Why it matters**: 里程碑可执行性问题——B2 退出条件混了两件事，画图卡住的话 picker 也无法独立 ship。
**Suggested fix**: 把"Tab 4 依赖图"从 B2 拆到 B3 或注明"B2 ship picker 即可退出，依赖图渲染留给 dogfood 决定要不要做"。

### F5. Invariant #9 与架构 #15 的 wording 冲突 — [MINOR]
**Where**: §6 不变量 #9
**Issue**: 用"总管家是 Stage A baseline，不是后期附加"这种命令式 wording 写进"关键不变量"列表，是把一个 stage 拆分决定提级到了和 #1（human-in-the-loop on merge）同档的不变量。这两件事不在同一抽象层。
**Why it matters**: 不变量列表必须是跨 plan 永远成立的硬约束。具体 stage 起步范围不属于此层。混进来会稀释 §6 的权威性，未来读者会怀疑"这个 #9 真不变吗"。
**Suggested fix**: 把 #9 移到 §5 stage 拆分前的 rationale 段，§6 不变量保留 1-8 + 把"对话粒度 = train"留下（这条是真不变量）。

### F6. 第 3 reviewer lens 是开放问题但答案很可能是 NO — [MINOR / FALSE-POSITIVE-CANDIDATE]
**Where**: §10 教训 #6 + Q（隐含）
**Issue**: 教训 #6 提议加 user-workflow fit lens（第 3 reviewer）。架构影响：当前 reviewer 是 arch + cross 异质对（Claude + cursor-agent），加第 3 lens 要么是 Claude#3（恶化 集体盲区）、要么是另一个外部 model（启动复杂度升一档）。教训 #6 自己也说"放 §9 留 dogfood 后回看"——没催着合并。
**Why it matters**: 不是真 BLOCKER，但作为评审 skill 自己用户必须意识到——第 3 lens 解决的是"这次架构错位"这个 single 数据点，不一定是 reviewer 矩阵缺陷。可能教 author 在 proposal 自己 self-check user-workflow 更便宜。
**Suggested fix**: 当前 v0.4 §10 教训 #6 处理已经 OK（明确放后看）。FALSE-POSITIVE-CANDIDATE：评审者（我）不应在此 v0.4 评审里强推第 3 lens。仅建议教训 #6 加"低优先：先看后续 3 个 proposal 评审是否再次出现工作流错位 → 真复发再加 lens"。

### F7. CLAUDE.md pitfall #11 归属正确 — [FALSE-POSITIVE-CANDIDATE]
**Where**: §7 + §6 不变量 #8
**Issue**: 提案要把"1 conversation = 1 feature train"加进 CLAUDE.md "Common pitfalls"。可能担心 CLAUDE.md 是否合适。
**Why it matters**: CLAUDE.md pitfall 段已有 #7 "iOS BackendClient 是 per-conversation 不是 global"、#8 "Conversation.id ≠ sessionId"——粒度 / 跨 session 概念约束**正是** pitfall 段的目标用法。新增第 11 条完全 fit。
**Suggested fix**: 无 — 维持现议。这条不是 finding，明确 dismiss false positive。

## Strong points

1. v0.3 → v0.4 真把 conversation = train 这个工作流错位修了，§6 不变量 #8 + §6.5 token-saving 启发段写得很扎实，这是 v0.3 评审完全漏掉的层面。
2. §5 stage 拆分有真退出条件（≥3 feature / ≥10 dep / ≥70% 命中率），不是日历估算，符合 [feedback_no_time_estimates] + Invariant #13。
3. §6 不变量 #6 batched 通知 + Telegram 429 backoff 把 cross-F6 真落地了。
4. §10 教训段对自己 v0.1-v0.3 失误很诚实，特别是 #2 双 Claude reviewer 集体盲区 + #5 跳过评审教训，强化 phase 2/3 默认必跑。

## Open questions for the user

1. F1 BLOCKER：Work Registry 真的需要 Stage A 起步上线吗？还是 Stage A 退出后再 ship？
2. F2 MAJOR：projects.json / run-registry / work-registry 三者你愿意做单一真相源切割吗？还是接受"每月 audit"软方案？
3. F3 MAJOR：vertical-fit gate 你接受加硬量化指标（命中率 + Dashboard tab 4 使用频次 + 30 天反馈）吗？
4. U2 stacked PR：从架构看推荐"不做"——claude-web 单用户场景 stacked 收益低，Graphite 已是工业方案，不必内嵌。

## What I Did Not Look At

- v0.1 / v0.2 / v0.3 评审文件（独立性约束）
- cursor-agent 同 round verdict（并行运行）
- 实际 work-registry.ts / inbox-store.ts 代码结构（只读 proposal + 引用片段）
- Stage C2 fan-out 集成失败模式（vertical-fit gate 通过前不评估）
