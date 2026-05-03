# Architecture Review — REVIEW_MECHANISM_V2.md (revised v2.0)

**Reviewer**: harness-architecture-review
**Model**: claude-opus-4-7 (1M context)
**Date**: 2026-05-03 11:20
**Files reviewed**:
- /Users/yongqian/Desktop/claude-web/docs/proposals/REVIEW_MECHANISM_V2.md (revised v2.0)
- /Users/yongqian/Desktop/claude-web/docs/HARNESS_REVIEW_LOG.md (含 v1/v2 边界 + 元配置 + 4 个已 ship round)
- /Users/yongqian/Desktop/claude-web/scripts/run-debate-phase.sh (实际脚本，验证 §1.2 输入规则)
- /Users/yongqian/Desktop/claude-web/CLAUDE.md (硬约束)
- /Users/yongqian/Desktop/claude-web/.claude/skills/harness-architecture-review/SKILL.md (头部三层定义)
- /Users/yongqian/Desktop/claude-web/.claude/skills/harness-architecture-review/LEARNINGS.md
- /Users/yongqian/Desktop/claude-web/docs/reviews/review-mech-v2-arch-2026-05-03-1059.md (Round 1 自家 verdict，对照 12 项是否都吸收)
- /Users/yongqian/Desktop/claude-web/docs/reviews/review-mech-v2-cross-2026-05-03-1058.md (仅扫 finding 标题清点，未读正文，因 cross 修复对照需要)

## Summary
- Blockers: 0
- Majors: 2
- Minors: 3
- 总体判断：**建议小改后合并**（即修订版 v2.0 已经吸收了 Round 1 全部 12 项 finding，验证可对齐；剩下两条 MAJOR 是修订时新引入的接缝 / 表述弱点，不阻塞合并，但留着会在第一次自验收 dogfood 时露馅）

---

## 总体判断

一句话：v2.0 修订版做到了"12 项全部接受 + 落点明确"，BLOCKER 拆双门槛、OQ1 改触发条件式、§5 风险扩到 8 条、§10 历史 round 标注、ROADMAP 显式妥协项——这五个方向上的修复都是**结构性正确**而不是 lip-service。但修订过程中出现了两个新接缝：(a) §1.2 PHASE_2_PROMPT 的"不读 author counter"在脚本上有半实现 leak；(b) §4 验收门槛 (b) 二选一虽然写明，但**未规定如何在 author 自验收 dogfood 中保持"实质 vs 仪式"的可证伪性**——因为本提案自己跑自验收时，author 既写艺术品又裁判，会反向诱导 reviewer 配合产 (b1)/(b2)。

整体可以推进 v2 ship + 自验收，但建议在 ship 前修这两条 MAJOR，否则自验收 dogfood 大概率给出"形式上 (b) 满足，实质上反向诱导"的不可信结果。

---

## 必须先改

无 BLOCKER。

---

## 四维评审

### 架构可行性

修订版的形式化结构比 v1 提案稳：三层定义在 SKILL.md / REVIEW_LOG.md 头部都已经 ship（已读到 [HARNESS_REVIEW_LOG.md L19-L46](../HARNESS_REVIEW_LOG.md) 元配置段、SKILL.md 头部三层表），不是只在提案里画饼。`run-debate-phase.sh` 已存在并自标 "M2 review-orchestrator 的 stub"，吻合 Round 1 arch m1 修复要求。脚本读 PHASE_2_PROMPT.md + own + sibling verdict + artifact，确实**没读 author counter / 4 档分类草案**——`build_prompt` 函数 [run-debate-phase.sh L62-L95](../../scripts/run-debate-phase.sh) 只 cat artifact + own + sibling，没有任何 counter / debate-review SKILL 输出物的引用。Phase 2 输入规则在脚本层落实了。

但有一处架构接缝是新引入的：**脚本只能跑 cross 的 react，不能跑 arch 的 react**（[L108-L121](../../scripts/run-debate-phase.sh)）。脚本最后 echo 一段 "NEXT STEP (manual, by author)"，让 author 通过 Agent tool 手动 spawn fresh-context Claude 跑 arch react。这意味着：
- Phase 2 流程是**半自动化 + 半人工**——自动化的部分（cross）由 cursor-agent 跑，人工部分（arch）由 author 在主对话里 spawn Agent。
- author 在 spawn Agent 时**理论上可以污染 Agent prompt**：脚本输出的 echo 行只是建议格式，author 可以加私货（比如多塞一段"我倾向认为 XX"）。这违反 Independence Constraint #1（"不读 author 的 transcript / 思考流"）的精神——v2 形式上把 author counter 排除出 phase 2 输入，但 spawn Agent 这一步给 author 留了非脚本化的注入路径。

短期不致命（M-1/M0 期信任 author 自律），但 §1.2 应明确"arch react 必须使用脚本最后 echo 的标准 prompt 模板，不允许 author 加任何 contextual hint"，并把这条标 M2 review-orchestrator 自动化的硬约束。这是 LEARNINGS.md #2 "多 AI 评审必须先限定评什么"的延伸——v2 限定了"读什么"，但没限定"author 不能在 spawn 时加什么"。

第二个架构观察：Synthesizer 的 M3+ 接口仍然没在 v2 期预留。Round 1 arch 评审建议"phase 3 SKILL 应明确接口便于 M3+ 替换"，v2 修订没明确处理这条（§9 不在范围列了"M3+ Synthesizer"，但没说 phase 3 SKILL.md 是否预留 hook）。这条不算遗漏（Round 1 arch 也只是观察项），但若 v2 自验收时发现 phase 3 SKILL 还是 author solo 风格的胶水代码，M3 升级仍是大改。建议在 §1.3 加一行"phase 3 SKILL.md 拆分时为 reviewer 角色预留可插拔位置（M3+ 增加 'synthesizer' 角色调用即可，不重写 SKILL）"。

### 里程碑裁剪

里程碑切分在修订版里收紧得很到位：

- §2 工作量重报 65 → 80 min 实施 + 60 min 自验收 = **总 ~2h**，与 Round 1 arch 建议一致。
- §4 验收双门槛 (a) 流程 + (b) 实质二选一，BLOCKER 修复方向正确。
- OQ1 改触发条件式：M-1/M0 一律跑 / M1+ (a) BLOCKER mismatch / (b) 不可逆 / (c) priority=high，三条触发器具体到可执行的判断粒度。
- §10 历史 4 个 round retroactive 标注、ROADMAP M0/M1 显式妥协项——都按 Round 1 建议落地。

但 OQ1 触发条件的 (c) "Issue.priority=high" 在当前阶段**没有运营定义**：HARNESS_DATA_MODEL.md 里 Issue 实体确实有 priority 字段（low/medium/high），但 M-1 期没有 Issue（M-1 是 contract / 设计文档评审，没用 Issue 表），M0 期 Issue 才开始进表，M1 之前没有 priority=high 真实数据来触发 phase 2。这意味着 (c) 触发条件在 M1+ 实际启用前**等同空规则**——它写在 §6 决议里看起来有威慑，但首次跑到 (c) 的时机至少是 M1 末尾。这不是"决议错"，而是 (c) 触发条件的**生效窗口**没在 ROADMAP 里说清。建议 §6 OQ1 决议加一句"(c) 在 Issue 表填充并产生 priority=high 数据前为 latent，预计 M1 末启用"。

第二个里程碑观察：v2 自验收 dogfood 用本提案自身做 artifact，§4 (b) 二选一的"实质信号"会被**作者-评审者-裁决者一体化**反向诱导。一个被作者既写又审又裁决的 artifact，phase 2 reviewer 看到 sibling 的 finding 时，会本能地"配合"产 (b1)（撤回 / 升级，附反例）或 (b2)（新 finding），这恰恰是验收门槛设计上想避免的"刷指标"行为。**不能简单依赖本提案的自验收来证明 v2 验收门槛设计有效**。建议 §4 加一段："v2 自验收 dogfood 满足 (b) 不能立即闭环；需要在 M0 第一个**与 author 无关的**契约（如 ADR-0011 修订）再跑一次 phase 2，其 (b) 信号才作为门槛有效性证据。" 这是 LEARNINGS.md #4 "里程碑指标要防止 agent 刷通过率"的具体应用：v2 验收的样本不能是 v2 自己。

### 企业管理系统贴谱性

不直接相关——v2 是评审 mechanism 改造，不是垂直域改造。但有两点交叉：

- §3 M2 cost projection 段（Round 1 arch M-A 修复）已加："400 reviewer call (v2 一律跑) vs 200 call (v1)" + "OQ1 改触发条件式以避 M2 翻倍"。这段表述准确，回应了 Round 1 评审的 cost 担忧。
- OQ1 触发条件 (b) "schema migration / security / 不可逆" 与企业管理系统 vertical 的实际产物（CRUD 表、表单、审批流、报表）大部分是**routine + low-risk**——意味着 M2 dogfood 的多数 Issue 不会触发 phase 2，cost 控住了。但反面：如果 toy 企业仓库的 Issue 99% routine，M2 期 phase 2 触发率可能近乎零，导致 phase 2 在 M2 仍然没有充分数据来评估有效性。建议 §6 OQ1 决议加"M2 期至少在 5 个 Issue 上**人为触发** phase 2（即使不命中 a/b/c），以保留观察样本"，否则触发条件式可能变成 phase 2 的 silent killer。

垂直贴谱性整体 OK，没有结构性问题。

### 风险遗漏

§5 从 5 条扩到 8 条，吸收了 Round 1 arch 提的 3 条遗漏（权威效应 / 跨模型 contamination / phase 3 不可逆性）+ Round 1 arch BLOCKER（验收门槛过低）+ Round 1 cross M3 + arch m3（v1/v2 边界）。覆盖度从 v1 的 5/8 跳到 8/8，是定量改进。

但有 2 条新风险**修订版没预见**：

**新风险 R9：phase 2 触发器 (a) "Round 1 双 reviewer 间 ≥ 1 BLOCKER mismatch" 在 M-1 实测中不会触发**。M-1 已 ship 的 4 个 round 中：

- Round 1 contract #1+#2：cross 标 §8 撒谎 minor，arch 标 BLOCKER（mismatch）→ 会触发 (a)
- Round 1 contract #2 真实实现：arch 1 BLOCKER + cross 0 BLOCKER（mismatch）→ 触发 (a)
- Round 1 contract #3+#4+method：arch 0 BLOCKER + cross 2 BLOCKER（mismatch）→ 触发 (a)

也就是说 M-1 三次都会触发 (a)，但 v2 修订把 M-1/M0 设为"一律跑"，(a) 触发条件等到 M1+ 才生效。问题：**M1+ 双 reviewer 是否还会频繁 BLOCKER mismatch**？如果 M-1 的 mismatch 模式是因为 reviewer-cross 缺"里程碑出口自检 lens"（§9 已挂起到 M0/M1 方法论改进项），那 M0 修了 lens 后 mismatch 频率会下降，(a) 触发器也跟着失效。这是 v2 OQ1 决议的内嵌假设：**(a) 触发器的有效性依赖 reviewer-cross 不修 lens 盲点**——但 §9 又承诺会挂改进项。两个目标互相消解。建议 §6 OQ1 加一句："(a) 触发频率取决于 reviewer-cross lens 完整度；若 M0 期补完 lens 后 mismatch 频率 < 30%，(a) 触发器失效，回到 M1+ 是否需要更宽的触发条件（如 ≥ 1 MAJOR mismatch）"。

**新风险 R10：debate-review SKILL 拆分后，phase 3 SKILL.md 是否仍允许读 phase 2 react verdict + author counter？** §1.3 拆 SKILL 为 phase 3 only + PHASE_2_PROMPT.md，但 phase 3 SKILL 的输入定义没在修订版明示。从 §1.1 表格 "phase 3 输入：全部 verdicts + react verdicts + author counter" 可以推出 phase 3 SKILL 读所有这些，但 §1.3 拆 SKILL 时没把这条复述到 SKILL.md 内部 prompt。**风险**：拆 SKILL 后，author 跑 phase 3 时若忘了喂 react verdicts（脚本不强制），phase 3 退化回 v1 的 "author solo 看 phase 1 verdicts"。建议 §1.3 加："拆出的 phase 3 SKILL.md 头部硬编码 'Required inputs: docs/reviews/<artifact>-{arch,cross}-*.md + docs/reviews/<artifact>-{arch,cross}-react-*.md + author counter'，缺任何一份即 fail-loud。"

整体风险覆盖度从 v1 的 5/10 提到 v2 的 8/10，仍有 2 条 latent。

---

## Open Questions 强意见

### OQ1（一律跑 → M-1/M0 一律跑 + M1+ 触发条件式）

**同意修订决议方向，但触发条件 (c) 生效窗口和 (a) 频率假设需补充**（见上文里程碑 / 风险遗漏）。修订版决议比 v1 作者倾向稳得多，是结构性进步。

### OQ2（撤回必须给反例）

**同意修订决议**。PHASE_2_PROMPT 强制"反例 = 具体 sibling 证据 + 自己原 verdict 的失误点"是恰当的最低门槛。无新意见。

### OQ3（M0/M1 author solo + ROADMAP 显式妥协项）

**同意修订决议方向**。但建议明确 ROADMAP 的 M0/M1 退出条件文字位置（§1.1 引用了 [HARNESS_ROADMAP.md M0 / M1 退出条件]，但 ROADMAP 真实段号未引）。如果 ROADMAP 没真改，v2 ship 后 ROADMAP 还会缺这条妥协项的说明，等于光在提案里写了。建议 §2 实施步骤 #7（"更新 HARNESS_ROADMAP.md M0/M1 退出条件加显式妥协项"，10 min）补一行 acceptance：实施完成后 grep `re-arbitrated` 关键字应在 ROADMAP 命中至少 1 处。

### OQ4（数字 score 不落 SQLite）

**同意修订决议**。M-1 范围已敲定，v2 不扩范围正确。但承认这削弱 §4 (b) 验收的可查性（只能 markdown grep / 人眼判断 phase 2 vs phase 1 verdict diff），属于已知妥协，修订版 §6 OQ4 已承认。

---

## 12 项 v1 finding 吸收对照

逐条核对 v2.0 修订是否真吸收 v1 评审的 12 项：

| v1 finding | 来源 | v2.0 修订位置 | 是否吸收 | 新引入问题 |
|---|---|---|---|---|
| arch BLOCKER 验收门槛过低 | review-mech-v2-arch | §4 拆 (a) + (b) | ✅ 完整 | (b) 自验收反向诱导（本评审 MAJOR-2） |
| arch MAJOR-A M2 cost projection | review-mech-v2-arch | §3 加 cost 段 / §4 末尾段 | ✅ 完整 | — |
| arch MAJOR-B 至少 1 disagree/refine 硬约束 | review-mech-v2-arch | §1.2 PHASE_2_PROMPT + §5 风险 #2 缓解 | ✅ 完整 | — |
| arch MAJOR-C 跨模型 contamination | review-mech-v2-arch | §5 加风险 #6（"phase 2 跨模型 contamination"） | ✅ 完整 | — |
| arch MAJOR-D phase 3 决策可逆性 | review-mech-v2-arch | §6 OQ3 升级 ROADMAP 显式妥协项 + §9 加 audit trail | ✅ 完整 | OQ3 实施 #7 acceptance 弱（本评审 MINOR-3） |
| arch m1 run-debate-phase.sh 是新组件类 | review-mech-v2-arch | §1.2 标 "M2 review-orchestrator 的 stub" + 脚本注释 | ✅ 完整 | 脚本 arch react 半人工接缝（本评审 MAJOR-1） |
| arch m2 工作量重报 | review-mech-v2-arch | §2 改 80 min + 60 min = 2h | ✅ 完整 | — |
| arch m3 历史 round 标注 | review-mech-v2-arch | §10 加版本边界 + 4 个 round 加注 | ✅ 完整 | 未明列哪 4 round（本评审 MINOR-1） |
| cross M1 phase 2 输入定义自相矛盾 | review-mech-v2-cross | §1.2 改 "author 不写 brief"，脚本不读 counter | ✅ 完整（已在 run-debate-phase.sh 验证） | — |
| cross M2 fresh context vs 读自己 verdict 冲突 | review-mech-v2-cross | §1.1 表格"fresh context = 不复用对话历史，但允许读本轮 verdict" | ✅ 完整 | — |
| cross M3 v1/v2 边界 | review-mech-v2-cross | §10 加版本边界 + REVIEW_LOG 头部已 ship | ✅ 完整 | 同 arch m3（本评审 MINOR-1） |
| cross m1 脚本路径 backend/scripts → scripts | review-mech-v2-cross | §1.2 + §2 步骤 #4 改路径 | ✅ 完整（已 ship 在 /scripts/） | — |
| cross m2 验收"至少 1 条真表态"太弱 | review-mech-v2-cross | §4 拆 (a) + (b) | ✅ 完整 | 同 arch BLOCKER 接缝 |
| cross m3 reviewer-cross lens 盲点 | review-mech-v2-cross | §9 不在范围加"挂到 M0/M1 方法论改进项" | ✅ 完整（明确 not v2 范围） | (a) 触发器假设依赖（本评审 风险 R9） |

汇总：**12 项全部吸收**（实际包含 1 BLOCKER + 7 MAJOR + 6 MINOR = 14 项；v2 §0 写"12 项"略有偏差，应为 14 项；不影响结论但 §0 文字可校）。

吸收质量：12/12 结构性到位，没有"假吸收 = 写在提案里但没真改文件"的情况。run-debate-phase.sh 实际存在 + REVIEW_LOG.md 头部 v1/v2 边界 + ROADMAP 妥协项（待 §2 步骤 #7 实施验证）—— 都是可验证的。

但吸收过程**新引入 5 条问题**（本评审 2 MAJOR + 3 MINOR），见下面 finding 段。

---

## Findings (本次新发现)

### [MAJOR] M-1 arch react 步骤的 author spawn-injection 风险

**Where**：[REVIEW_MECHANISM_V2.md §1.2](../proposals/REVIEW_MECHANISM_V2.md) + [run-debate-phase.sh L108-L121](../../scripts/run-debate-phase.sh)

**Lens**：架构可行性 / 风险遗漏

**Issue**：脚本只跑 cross react，arch react 由 author 在主对话手动 spawn Agent。脚本最后 echo 一段标准 prompt 让 author 复制，但**没有约束 author 在 spawn 时不加 contextual hint**。author 可以在 Agent prompt 里塞"我倾向认为 sibling 的 X 条不对" 等私货，违反 Independence Constraint #1 的精神（"reviewer 不读 author 思考流"）。

**Suggested fix**：§1.2 加段："arch react 必须使用 run-debate-phase.sh 输出的标准 prompt 模板（一字不改），author 不允许加任何 contextual hint。M2 review-orchestrator 自动化后此约束转为脚本内嵌强制。" 同时 §5 加一条风险"phase 2 author spawn-injection（M0/M1 信任 author 自律，M2 自动化）"。

### [MAJOR] §4 验收门槛 (b) 在自验收 dogfood 中的反向诱导

**Where**：[REVIEW_MECHANISM_V2.md §4 + §8](../proposals/REVIEW_MECHANISM_V2.md)

**Lens**：里程碑裁剪 / 风险遗漏

**Issue**：v2 自验收用本提案自身做 dogfood artifact。author 既是 artifact 写者又是 phase 3 裁决者，phase 2 reviewer 看到 sibling 的 finding 时会本能地"配合"产 (b1) 撤回 / 升级或 (b2) 新 finding——这恰恰是 BLOCKER 修复要避免的"刷指标"。**不能依赖本提案自验收闭环 (b) 门槛设计有效**。

**Suggested fix**：§4 加："v2 自验收 dogfood 满足 (b) 不闭环；需要在 M0 第一个**与 v2 author 无关的**契约（如 M0 ADR-0011 后续修订、SHARED_DICTIONARY 引入等）再跑一次 phase 2，其 (b) 信号才作门槛有效性证据。" §8 完工状态加一项 "[ ] 第二个非自身 contract 跑完 phase 2 后再封板 OQ1 默认"。

### [MINOR] §10 历史 4 round 未明列具体名字

**Where**：[REVIEW_MECHANISM_V2.md §10](../proposals/REVIEW_MECHANISM_V2.md) "已 ship 的 4 个 round"

**Lens**：里程碑裁剪

**Issue**：§10 写"已 ship 的 4 个 round (Round 1+2 contract #1+#2 / Round 1 contract #2 / Round 1 contract #3+#4+method)" —— 看起来只列了 3 个（Round 1 contract #1+#2 + Round 2 contract #1+#2 = 1.5 算 2 个？ + Round 1 contract #2 = 1 个 + Round 1 contract #3+#4+method = 1 个），算式不清晰。HARNESS_REVIEW_LOG.md 实际有 4 段：Round 1 contract #1+#2、Round 2 contract #1+#2、Round 1 contract #2 真实实现、Round 1 contract #3+#4+method。建议 §10 列文字与 REVIEW_LOG 标题一一对齐（用 "Round 1 contract #1+#2" / "Round 2 contract #1+#2 八未定项" / "Round 1 contract #2 真实实现" / "Round 1 contract #3+#4+method"），避免歧义。

**Suggested fix**：§10 改成显式列表 4 行，每行对应 REVIEW_LOG 段标题。

### [MINOR] OQ1 触发条件 (c) "Issue.priority=high" 的生效窗口未说

**Where**：[REVIEW_MECHANISM_V2.md §6 OQ1](../proposals/REVIEW_MECHANISM_V2.md)

**Lens**：里程碑裁剪

**Issue**：(c) 在 Issue 表填充并产生 priority=high 数据前为 latent，预计 M1 末才能首次触发。但 §6 没说，看起来像 M0 就能用。

**Suggested fix**：§6 OQ1 决议加 "(c) 在 Issue 表 priority=high 数据出现前为 latent，预计 M1 末启用；M-1/M0 期主要靠'一律跑'生成数据，M1 期靠 (a)+(b) 触发"。

### [MINOR] OQ3 ROADMAP 妥协项实施 acceptance 弱

**Where**：[REVIEW_MECHANISM_V2.md §2 步骤 #7](../proposals/REVIEW_MECHANISM_V2.md)

**Lens**：里程碑裁剪

**Issue**：§2 步骤 #7 "更新 HARNESS_ROADMAP.md M0/M1 退出条件加显式妥协项" 工作量 10 min，但没 acceptance check——v2 ship 后 ROADMAP 是否真改可能只在 verify-m1-deliverables 里 grep 文件存在，而不验内容。

**Suggested fix**：步骤 #7 加 acceptance："实施完成后 grep `re-arbitrated\|author single-arbitration` 关键字应在 HARNESS_ROADMAP.md M0/M1 退出条件段命中至少 1 处"。verify-m1-deliverables.mjs 可加这条。

---

## 建议的下一版改动

1. **修 MAJOR-1**：§1.2 加 "arch react 必须用脚本输出的标准 prompt 一字不改，author 不允许加 contextual hint"；§5 加风险 R9 "phase 2 author spawn-injection（M0/M1 信任，M2 强制）"。
2. **修 MAJOR-2**：§4 末尾加 "v2 自验收 dogfood 不闭环 (b) 门槛设计有效性；M0 第一个非自身 contract 跑完 phase 2 后才作为门槛证据"；§8 加 "[ ] 第二个非自身 contract phase 2 完成后封板 OQ1 默认"。
3. **修 MINOR-1**：§10 4 个 round 显式按 REVIEW_LOG 标题列出。
4. **修 MINOR-2**：§6 OQ1 (c) 加 latent 窗口说明。
5. **修 MINOR-3**：§2 步骤 #7 加 grep acceptance；同步加到 verify-m1-deliverables.mjs。
6. （观察项，不强制本版）§5 加风险 R10 "(a) 触发器频率依赖 reviewer-cross 不修 lens 盲点；M0 修 lens 后若 mismatch < 30%，回到是否需要更宽触发"，可挂 retrospective。

---

## What I Did Not Look At

- `~/.claude/skills/debate-review/SKILL.md` 内部内容（仅信任 §1.3 描述拆分）
- `~/.claude/skills/debate-review/PHASE_2_PROMPT.md` 实际内容（仅信任 §1.2 描述四选一硬约束）
- `docs/HARNESS_ROADMAP.md` M0/M1 退出条件实际是否写了 "author single-arbitration bias" / "M3+ re-arbitrated" 字样（信任 §1.1 引用）
- `scripts/verify-m1-deliverables.mjs` 当前内容（仅信任 §2 步骤 #6 描述）
- `docs/retrospectives/M-1.md` §9 元反思全文（仅扫了 §0 引用）
- 其他 reviewer (`reviewer-cross`) Round 2 的 verdict on revised v2.0（独立性约束，未读 `docs/reviews/review-mech-v2-revised-cross-*.md`，sibling 并行评审中）
- `.claude/skills/reviewer-cross/SKILL.md` 头部三层是否落地（仅信任 §1.1 描述）
- M-1 实测的 cross / arch BLOCKER mismatch 数据用于校验风险 R9 假设（仅引用 REVIEW_LOG 矩阵段，未独立统计）
- 学术原始论文（Du et al. / Cognition Devin Review）—— 提案引用，未独立校验
- iOS / 后端真实代码层面——v2 是 doc + 1 script，应不影响 runtime；未独立 grep

---

## 三行总结

- v2.0 修订版**完整吸收**了 Round 1 全部 12 项 finding（实际为 14 项；§0 文字偏差但不影响结论），结构性到位、可验证、run-debate-phase.sh 实际落盘且 phase 2 输入规则脚本层落实。
- 修订过程**新引入 5 条问题**（2 MAJOR + 3 MINOR）：arch react 半人工 spawn-injection 风险 / 自验收反向诱导 (b) 门槛 / §10 历史 round 未明列 / OQ1 (c) 生效窗口 / OQ3 ROADMAP acceptance 弱。
- **总体判断：建议小改后合并**——v2 方向正确（吸收 12 项 + 形式化稳）、但建议修两条 MAJOR 后再 ship 自验收 dogfood，否则首次自验收很可能给出"形式上 (b) 满足，实质上反向诱导"的不可信结果，反而稀释 v2 验收门槛设计的初衷。
