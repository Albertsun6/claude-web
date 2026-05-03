# Architecture Review — REVIEW_MECHANISM_V2.md

**Reviewer**: harness-architecture-review
**Model**: claude-opus-4-7 (1M context)
**Date**: 2026-05-03 10:59
**Files reviewed**:
- docs/proposals/REVIEW_MECHANISM_V2.md
- docs/retrospectives/M-1.md §9 元反思
- docs/HARNESS_REVIEW_LOG.md（元配置 + Round 1/2/contract-2/contract-3-4 矩阵）
- .claude/skills/harness-architecture-review/SKILL.md（结构 / Independence Constraints）
- .claude/skills/reviewer-cross/SKILL.md（Independence Constraints / 5 lens 头部）
- .claude/skills/harness-architecture-review/LEARNINGS.md
- CLAUDE.md（pitfalls / docs map）

## Summary
- Blockers: 1
- Majors: 4
- Minors: 3
- 总体判断：**建议小改后合并**。v2 把缺失的 phase 2 形式化是正确方向，但 OQ1 "一律跑" 默认在工程化上是高估了 cross-pollinate 的边际收益、低估了集体盲区的风险；§5 风险表对 author phase 3 bias 的"留 M3+"的态度从 v2 范围看可以接受，但前提是 §5 风险 #4 的"高概率"必须显式作为 M0 准入门槛而不是被 v2 吸收掉。

---

## 总体判断

一句话：v2 提案在**形式化层面**到位（三层定义清楚、文件落点明确、~65 min 工作量切实可执行），但在**默认行为**和**dogfood 验收闭环**两点上需要收紧才能合并；不收紧会把 phase 2 变成"看起来跑了但收敛 0 disagree" 的仪式化新阶段，反而稀释 v1 的真信号。

---

## 必须先改

### [BLOCKER] 自验收（§4）的"成功条件"过低，会通过仪式化即视为完工

**Where**：REVIEW_MECHANISM_V2.md §4 "验收"

**Lens**：里程碑裁剪 / 风险遗漏

**Issue**：§4 第 5 条说"如果 cross-pollinate 阶段两位 reviewer 真的对 sibling 某条 finding 表态 (agree / disagree / refine)，且这些表态进了 REVIEW_LOG 矩阵 → 验收通过"。问题是：

- PHASE_2_PROMPT.md 显式强制"每条 finding 必须 agree / disagree / refine 三选一" —— 这把出"至少 1 条 sibling 表态"变成了**结构性必然**，不是验收信号。
- M-1 Round 2 "8 未定项跑回去 0 disagree" 的事实证明 cross-pollinate 在低分歧场景会自动 agree-clean。如果验收只看"有没有表态"，必通过；如果不看 agree 与 disagree 的分布、不看是否产生**新发现的 finding**（v1 漏的、phase 2 才浮出的），那 v2 的实质收益没法量化。
- 这与 LEARNINGS.md #4（"里程碑指标要防止 agent 刷通过率"）撞上：v2 自己定义的指标可被 agent / author 通过结构性约束自动达成。

**Why blocker**：v2 的核心论点是"phase 2 廉价高效 → 一律跑"（OQ1 作者倾向）。如果验收信号本身没法证伪这个论点，那 OQ1 的决策就是无证支撑——M-1 实测 1 个数据点（八未定项 0 disagree）没法支撑"一律跑"，必须靠 v2 自验收 + 后续 contract 评审多次跑才能积累证据。当前验收门槛太低 → 可能 1 次跑通就锁死"一律跑" 默认，把不该花的钱花掉。

**Suggested fix**：§4 把验收门槛拆成两条：
1. 流程跑通（结构性，必过）：两份 react verdict 文件落盘、PHASE_2_PROMPT 三选一被遵守、REVIEW_LOG 矩阵记录每条 sibling 表态。
2. **价值信号**（实质性，必须二选一）：要么 (a) phase 2 至少出现 1 条 reviewer 撤回 / 升级原 verdict 的 finding（即 react verdict 与 phase 1 verdict 不同）；要么 (b) phase 2 浮出 1 条 phase 1 双盲都没提的新 finding（reviewer 看 sibling 后联想到的）。两者都没有 → v2 验收**未通过**，需要在第 2 个 contract 再跑一次再判。

不加这条，OQ1 "一律跑" 决策没有证据，等于把成本固化进流程。

---

## 四维评审

### 架构可行性

提案的形式化结构是清晰的：三层（Review / Debate / Arbitration）× N reviewer × 输入边界 × 独立性约束写到 4 个 SKILL.md + REVIEW_LOG 头部。这与 LEARNINGS.md #2 "多 AI 评审必须先限定评什么再限定几个 reviewer"对齐——v2 不增 reviewer，只增加它们的交互层，是正确的优先级。

但**抽象成本/收益不对称**有一处：§1.3 把 debate-review SKILL 拆成 SKILL.md (phase 3) + PHASE_2_PROMPT.md，引入一个独立 shell 脚本 `run-debate-phase.sh` 作为 phase 2 入口。CLAUDE.md 列的 pitfalls #1-#10 没有禁止这种 script，但本仓库迄今所有评审编排都靠"用户手动 prompt + skill 触发"完成，从来没有 backend script 编排 reviewer。引入第一个这种 script 等于**新增一类基础组件**（review orchestrator 的雏形），与提案 §9 "AutoGen / LangGraph framework 引入（永不，违 §0 #11）"承诺暗合矛盾——是否在 packages/backend/scripts/ 下放编排脚本，本身就是 review-orchestrator 的最小 MVP。M-1 retrospective 已挂起 review-orchestrator 到 M2，v2 提前引入 1 个脚本是否合适？建议要么把脚本说明显式写为"M2 review-orchestrator 的 stub"，要么就用纯 markdown 操作手册让 author 手动按步骤跑（成本一致，不引入新组件类）。

第二个架构疑虑：**Synthesizer 的延迟引入是否技术上可逆**？M3+ 加 Synthesizer 时，phase 3 SKILL.md 需要从 "author solo" 改为 "author 草拟 + Synthesizer 复核"，prompts、调用栈、REVIEW_LOG 矩阵格式都要改。v2 有没有为此预留接口？提案没说。这是 §5 风险 #4 "author bias 留 M3+" 的工程对偶——如果不在 v2 期就把"裁决者可替换"作为 phase 3 SKILL 的明确接口（哪怕 author 自己实现两边），M3 时换 Synthesizer 仍是大改。

### 里程碑裁剪

v2 自身**不属于 M0/M-1 退出门槛**，是 M-1 retrospective §9 触发的 mid-flight 改造。这点提案没明确：v2 是 M-1 末尾追加交付物，还是 M0 准入条件之一，还是独立 mini-milestone？需要在 §0 / §8 标清。

§9 "不在范围（推到 M2/M3）" 的切线很好（Adversary、Synthesizer、Domain Expert、AutoGen / LangGraph 全推后），与 LEARNINGS.md #5 "Context Manager 第一版应是协议和审计，不是智能选择器" 的克制风格一致。

但 §2 的工作量估算 65 min **只算了写文件的时间，没算自验收 dogfood 的时间**。§4 验收要求"用本提案自身作为 dogfood artifact，跑完整 Round 1 + phase 2 + phase 3"——这至少多 30-60 min 的实际评审时间（Round 1 双 reviewer 约 15-30 min，phase 2 cross-pollinate 约 15 min，phase 3 裁决约 15 min）。建议 §2 的 65 min 改 "实施 65 min + 自验收 30-60 min = 总 ~2 小时"。这与 LEARNINGS.md #4 "里程碑指标要防止 agent 刷通过率" 类似：低估工作量会诱导跳过验收。

第三个里程碑问题：v2 与 M-1 已 ship 的 4 个契约并行——v2 改 SKILL.md 和 REVIEW_LOG 头部不会触发已 ship 契约的 re-review，但 v2 的"三层" 元配置写到 REVIEW_LOG 头部后，回头看 Round 1/Round 2/contract-2/contract-3-4 都是按 "v1 phase 1 + phase 3" 跑的——它们应该被标 "v1 retroactively"，否则 reader 会困惑"这些 round 没跑 phase 2 是不是漏了"。提案 §1.1 / §7 没说历史 round 的标注策略。

### 企业管理系统贴谱性

不直接相关——这是评审 mechanism 评审，不是垂直域评审。但有一点交叉：M2 dogfood 的"toy 企业仓库"会有大量 Issue（可能数十个），如果 v2 默认 "OQ1 一律跑 phase 2"，每个 routine Issue 都跑 cross-pollinate，**M2 的评审成本会从 v1 的 N×2 calls 涨到 v2 的 N×4 calls**（phase 1 两次 + phase 2 两次），M-1 期单次成本可控，但 M2 dogfood 期可能崩。

提案 §3 成本估算"+15%"只算单次的 token 增量，没算"OQ1 一律跑"在 M2 的 issue 数量放大效应。建议 §3 加一段 "M2 期 cost projection"：假设 M2 跑 20 个 routine Issue × 5 个 stage gate × 2 reviewer × 2 phase = 400 reviewer call，比 v1 的 200 多一倍。如果 v2 不区分 routine vs high-risk Issue 的 phase 2 触发条件，M2 cost 会翻倍。

垂直贴合度建议：把 OQ1 改为 "phase 2 仅在以下场景一律跑：(a) reviewer 之间分歧 ≥ 1 BLOCKER mismatch；(b) artifact 涉及 schema migration / security / 不可逆操作；(c) M-1/M0 期间所有契约（建立基线证据）。M1+ routine Issue 跳过 phase 2 默认，author 显式触发"。这与 LEARNINGS.md #2 边界 "高风险设计、迁移、安全相关 patch 值得双 reviewer；普通 CRUD 应允许单 reviewer 或抽样复核" 一致。

### 风险遗漏

§5 风险表 5 条覆盖了主要面，但有 3 条遗漏：

**遗漏 1：phase 2 reviewer 阅读 sibling verdict 时的"权威效应"**。sibling verdict 是已经写完、看起来 confident 的 markdown，比 phase 1 时只读 artifact 的状态多了一层"另一个 AI 已经认真想过"的隐性背书。即使 PHASE_2_PROMPT 强制三选一，"agree" 是最低成本选项；当前 §5 风险 #2 的缓解（强制三选一）只防"我同意 sibling 全部"，不防"我对每条都说 agree"。建议加一条 mitigation：**PHASE_2_PROMPT 显式要求至少对 sibling 的 1 条 finding 给出 disagree 或 refine**（"全 agree" 必须 escalate 给 author 标记"无实质对话"）。这与本评审 BLOCKER 互补。

**遗漏 2：Claude vs gpt-5.5 异质性的 contamination 风险**（用户在任务中明确点出）。§5 风险 #1 缓解说 "reviewer-cross 用 gpt-5.5-medium 已经异质化"——这是 phase 1 状态。但 phase 2 让 cross 看到 arch (Claude) 的 verdict markdown，等于 cross 的 phase 2 输入混入了 Claude 的 reasoning。极端情况：cross phase 2 react verdict 的写作风格 / 论证结构会向 Claude 靠拢（mimic effect），削弱异质性。Du et al. debate 论文里多 LLM 是同代同模型族；v2 跨模型族跑 phase 2 是没有先例验证的。建议 §5 加风险 "phase 2 跨模型 contamination：cross 读完 arch verdict 后写作向 Claude 风格漂移"，缓解：M0 第一次跑 phase 2 后人工对比 cross 的 phase 1 vs phase 2 verdict 写作风格（启发式判断）；如果发现明显漂移，回退到 v1 或加规则"react verdict 中禁止 quote sibling verdict 整段，只允许 quote 单 finding 标题"。

**遗漏 3：phase 3 author solo 的 "v2 接受 = 默认锁死到 M3+" 风险**。提案 §6 OQ3 作者倾向"M0/M1 期保持 author solo"，§9 不在范围"Synthesizer 推到 M3+"。但 v2 一旦 ship，author solo phase 3 会成为新基线——M0、M1 的所有 review log 都按 v2 三层走完，phase 3 数据全是 author 出，到 M3+ 时回看会发现"v2 之前积累的所有 phase 3 决策都是 author bias 影响的"。这不是 "v2 解决不了 author bias" 的问题（提案明确承认），而是 "v2 推迟解决到 M3+" 让 v2 之间产生的所有评审决策都成为 sunk cost——M3+ 引入 Synthesizer 后是否要回头 re-arbitrate v2 期的 review？提案没说。

建议 §5 / §9 / §6 OQ3 三处都加一行 "v2 期 phase 3 决策不视为 final-irreversible；M3+ Synthesizer 上线后允许在新 retrospective 中标记 'M3+ re-arbitrated' 字段，形成 audit trail。" 这和 LEARNINGS.md #3 "全链路 MVP 可保留，但每个 Stage 需要最小不可作假的产出" 一脉相承——phase 3 的产出（4 档分类）需要可被 M3+ 后回溯 / 反对。

---

## Open Questions 强意见

### OQ1（一律跑）

**反对作者倾向**。理由见上文 BLOCKER + 垂直贴合度 + 风险遗漏 #2。"M-1 八未定项 0 disagree → 廉价高效"是 N=1 证据，不能支撑 "一律跑" 默认。建议改为 "M-1/M0 期一律跑（建立基线）；M1+ 仅在分歧 / 高风险 / 不可逆场景触发；M2 dogfood 后用真实数据决定是否回到一律跑"。这是工程上更稳的渐进式启用。

### OQ2（reviewer 撤回 verdict）

**同意作者倾向**。允许撤回是必要的，否则 reviewer 顽固化。但建议 PHASE_2_PROMPT 要求**撤回必须给"反例"**（具体的 sibling 证据 + 自己原 verdict 的失误点），不是只写"读 sibling 后我撤回 M3"。否则撤回会变成 phase 2 的低成本"我同意"伪装。

### OQ3（phase 3 仍 author solo）

**部分同意作者倾向**。M0/M1 保持 author solo 是务实，但**前提是 §5 风险 #4 "author bias 留 M3+" 必须从"风险一行"升级为"M0/M1 准入门槛的明确妥协项"**——写到 HARNESS_ROADMAP M0/M1 退出条件中："本期所有 review 决策接受 author single-arbitration bias，M3+ Synthesizer 上线后允许 retro re-arbitrate。" 不写明，v2 等于偷偷把 author solo 锁死。

### OQ4（数字 score 落 SQLite）

**同意作者倾向不加**。M-1 范围已敲定 markdown only，v2 不应扩范围。但这意味着 v2 验收（§4）只能用 markdown grep / 人眼判断，无法用 SQL 查"phase 2 vs phase 1 verdict diff 率"——这进一步放大 BLOCKER 提的"验收信号弱"问题。

---

## 建议的下一版改动

1. **修 BLOCKER**：§4 验收门槛拆成结构性 + 实质性两条；实质性要求 phase 2 至少出现 1 条撤回 / 升级 / 新 finding。
2. **OQ1 改默认**：phase 2 不一律跑，改为 "M-1/M0 期一律跑（基线证据），M1+ 触发条件式（分歧 ≥ 1 BLOCKER mismatch / 高风险 artifact / 不可逆操作）"。§3 加 M2 cost projection 段证明默认全跑会翻倍。
3. **§5 加 3 条遗漏风险**：phase 2 权威效应（强制至少 1 条 disagree/refine）、跨模型 contamination（M0 首次跑后 audit cross 写作风格漂移）、phase 3 决策可逆性（M3+ Synthesizer 上线后允许 retro re-arbitrate，加 audit trail 字段）。
4. **§2 工作量重报**：65 min 实施 + 30-60 min 自验收 dogfood = 总 ~2 小时；不要用 65 min 误导决策。
5. **§1.3 run-debate-phase.sh 定位说明**：明确这是 M2 review-orchestrator 的 stub，或退化为 markdown 操作手册让 author 手动跑（避免提前引入新组件类）。
6. **历史 round 标注**：v2 ship 后回头给 HARNESS_REVIEW_LOG.md 已有的 4 个 round 加 "v1 retroactively, no phase 2" 标记，避免 reader 困惑。
7. **§6 OQ3 升级**：把 "M0/M1 期保持 author solo" 从作者倾向升级为 HARNESS_ROADMAP M0/M1 退出门槛的**显式妥协项**，而不是默默接受。

---

## What I Did Not Look At

- `~/.claude/skills/debate-review/SKILL.md`（用户路径，本评审未读；提案 §1.3 拆分计划仅按提案描述判断）
- `packages/backend/scripts/run-debate-phase.sh`（不存在，提案未来产出）
- `scripts/verify-m1-deliverables.mjs` 当前内容（只在提案 §2 #6 引用）
- `docs/HARNESS_ROADMAP.md`（仅引用 LEARNINGS 与 review log；未实读）
- 其他 reviewer (`reviewer-cross`) 的 verdict on this proposal（独立性约束，禁止读 `docs/reviews/review-mech-v2-cross-2026-05-03-1058.md`）
- M-1 retrospective §1-§8（仅读 §9）
- 已 ship 的 4 个 round 的 verdict 文件细节（仅扫了 review log 矩阵）
- 学术原始论文 Du et al. 2023（提案引用，未独立校验语义）
- AutoGen / LangGraph framework 当前能力（提案 §9 排除，未独立校验）
- iOS / 后端真实代码层面是否会受 v2 影响（v2 是 doc-only + 1 script，应当不影响；未独立 grep）

---

## 三行总结

- **Blockers**: 1（§4 验收门槛过低，会被结构性强制满足而失去信号）
- **Majors**: 4（OQ1 一律跑默认在 M2 翻倍成本 / phase 2 权威效应未缓解 / 跨模型 contamination 风险未列 / phase 3 决策不可逆性未铺路）
- **Minors**: 3（run-debate-phase.sh 是新组件类未表态 / 工作量低估漏自验收 / 历史 round 标注策略缺）
- **Overall verdict**: 建议小改后合并——v2 方向正确（形式化三层是必要的），但需要修 BLOCKER + 改 OQ1 默认 + 补 3 条遗漏风险，否则 v2 ship 后会把 "phase 2 一律跑" 和 "author solo phase 3" 两个未充分论证的默认锁死到 M3+。
