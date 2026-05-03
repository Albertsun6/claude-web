# Proposal — Review Mechanism v2（评审 / 辩论 / 裁决 三层形式化）

> **状态**：v2.0（2026-05-03）—— Round 1 评审 + debate-review 后已修订。原 v1.0 提案在评审中暴露 1 BLOCKER + 7 MAJOR + 6 MINOR，全 12 项接受落地（详见 [HARNESS_REVIEW_LOG.md Round 1 review-mech-v2](../HARNESS_REVIEW_LOG.md)）。
>
> **触发**：M-1 retrospective §9 元反思指出 author solo arbitration 是当前评审机制最大盲点。用户 2026-05-03 提出"辩论与评审的关系应该是什么"。
>
> **关联**：[HARNESS_REVIEW_LOG.md](../HARNESS_REVIEW_LOG.md) · [.claude/skills/harness-architecture-review/SKILL.md](../../.claude/skills/harness-architecture-review/SKILL.md) · [.claude/skills/reviewer-cross/SKILL.md](../../.claude/skills/reviewer-cross/SKILL.md) · [~/.claude/skills/debate-review/SKILL.md](~/.claude/skills/debate-review/SKILL.md)

---

## 0. 当前问题

M-1 评审跑了 4 轮 ~38 项 finding 收敛，但**有一个根本盲点**：

```
现在：
评审 phase 1: arch + cross 独立隔离 → 各出 verdict（OK）
辩论 phase 2: ❌ 缺失（reviewer 互不可见到 debate 阶段）
裁决 phase 3: author 单方面 4 档分类 + 修复（单点裁决）
```

具体症状：
- Round 1 contract #1+#2 时，cross 把 PROTOCOL §8 [x] 撒谎只标 `m5` minor，arch 标 BLOCKER。**这两条独立但互补——理应在 phase 2 互怼后让 cross 升级判断**，而不是 author 默默选 arch 的判断
- Round 2 八未定项跑过的"author 写 brief 喂回 reviewer"接近 phase 2 但**reviewer 之间没真对话**——只是 react 到 author counter
- author 是 artifact 的写者，judge 自己写的东西 → 单点 bias

学术 + 业界对应：
- Du et al. 2023 多 Agent debate（ICML 2024）：多 LLM **互看** reasoning + revise → 显著提升 factuality / arithmetic
- Cognition Devin Review：reviewer 看 author 的 Plan 后产 finding，但**多 reviewer 互看互怼**未在该模式中
- AutoGen / LangGraph：multi-agent conversation framework 直接 implements debate

**当前实现是 phase 1 + phase 3 跳过 phase 2**。Plan A 补 phase 2。

---

## 1. 提案内容

### 1.1 三层形式化（doc-only，落到 SKILL + REVIEW_LOG）

明确写到 `harness-architecture-review/SKILL.md` + `reviewer-cross/SKILL.md` + `debate-review/SKILL.md` + `HARNESS_REVIEW_LOG.md` 头部的元配置：

```markdown
## 评审三层

| 层 | 角色 | 输入 | 输出 | 独立性 |
|---|---|---|---|---|
| 评审 (Review) phase 1 | reviewer N 个 | 仅 artifact + skill prompt | 各自 verdict.md | 互不可见 |
| 辩论 (Debate) phase 2 | reviewer N 个（不含 author） | **artifact + own Round 1 verdict + sibling Round 1 verdict**（**不含 author counter**，Round 1 cross M1 修复） | react verdict.md | 互可见；fresh context = 不复用对话历史 / transcript，但允许读本轮 artifact 与 own + sibling Round 1 verdict（Round 1 cross M2 修复） |
| 裁决 (Arbitration) phase 3 | author 草拟 + 用户最终 | 全部 verdicts + react verdicts + author counter | applied fixes + REVIEW_LOG matrix | author 草拟 → 用户终审 |
```

**M0/M1 期 phase 3 author solo 是显式妥协项**（Round 1 arch M-D 修复）：写到 [HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md) M0 / M1 退出条件中——"本期 review 决策接受 author single-arbitration bias，M3+ Synthesizer 上线后允许在新 retrospective 中标记 `M3+ re-arbitrated` 字段，形成 audit trail。" 不写明 = 偷偷锁死 author solo。

### 1.2 phase 2 cross-pollinate 落地

**当前流程（v1）**：
- author 写 Round 2 brief（手动选未定项 + 自己 counter）
- 喂给 reviewer
- reviewer 只能 react 到 brief，不能直接挑战 sibling reviewer 的 specific finding

**新流程（v2，Round 1 cross M1 + cross M2 修复）**：
- author **不写 brief**
- `scripts/run-debate-phase.sh <issueId>` 脚本（Round 1 cross m1 修复：放 `scripts/` 不是 `backend/scripts/`，与 verify-m1-deliverables.mjs 同级）：
  1. 读 docs/reviews/<issueId>-arch-*.md + docs/reviews/<issueId>-cross-*.md + 原 artifact 文件清单
  2. 拼 prompt（来自 [`~/.claude/skills/debate-review/PHASE_2_PROMPT.md`](~/.claude/skills/debate-review/PHASE_2_PROMPT.md)）：
     ```
     你是 reviewer X (arch / cross)。
     输入：
       - 原 artifact 文件清单（与 phase 1 一致）
       - 你 Round 1 的 verdict
       - sibling reviewer Y 的 Round 1 verdict
     **不读** author 的 4 档分类草案 / counter（Round 1 cross M1 修复——保持 phase 2 纯 reviewer cross-pollinate）

     任务：逐项对 sibling 的每条 finding 表态四选一：
       - agree
       - disagree-with-evidence（必须给具体反例 + sibling finding 的失误点）
       - refine（建议修订；给具体改法）
       - not-reviewed-with-reason（罕见，写明为何不评）

     **硬约束**（Round 1 arch M-B 修复）：
       至少对 sibling 的 1 条 finding 给 disagree 或 refine。
       全 agree → escalate 给 author 标记"无实质对话，phase 2 信号弱"。

     可改自己 Round 1 verdict（撤回 / 升级），但撤回必须给"反例"（具体 sibling 证据 + 自己原 verdict 的失误点）（Round 1 arch OQ2 修复）。
     ```
  3. spawn 两位 reviewer fresh context（不复用对话历史 / transcript）各跑一遍
  4. 两位 reviewer 都看到 sibling verdict —— 这是 cross-pollinate
- 输出：`docs/reviews/<issueId>-arch-react-*.md` + `docs/reviews/<issueId>-cross-react-*.md`

**`scripts/run-debate-phase.sh` 是 M2 review-orchestrator 的 stub**（Round 1 arch m1 修复）：当前是简单 cat 拼 prompt + 调 cursor-agent / 喂 Agent prompt 的薄包装，不是 daemon。M2 实施 review-orchestrator 时升级。

### 1.3 debate-review SKILL 拆成两步

当前 `~/.claude/skills/debate-review/SKILL.md` 把 phase 2 + phase 3 揉在一起。拆成：

```
~/.claude/skills/debate-review/
├── SKILL.md            # phase 3 裁决 only：读 verdicts + react verdicts → 4 档分类 + 应用修复
├── PHASE_2_PROMPT.md   # phase 2 reviewer cross-pollinate 用的 prompt 模板（run-debate-phase.sh 读这个）
└── log.jsonl           # 历史
```

phase 2 由独立 script 触发；phase 3 由 author 用 SKILL 触发。两步语义不混。

### 1.4 不变（明确什么不动）

- evaluator 独立性约束（reviewer 不读 author transcript / 不读 LEARNINGS 之前的对话）—— 仍 enforce
- reviewer-cross SKILL 5 lens / arch SKILL 4 dim —— 不动
- ReviewVerdict markdown 格式 —— 不动
- 用户拍板权 —— 不动（仍是裁决 phase 3 的最终步）
- cursor-agent gpt-5.5-medium 异质性 —— 不动

---

## 2. 实施步骤（Round 1 arch m2 修复：实施 + 自验收 ~2h 总）

| # | 动作 | 文件 | 工作量 |
|---|---|---|---|
| 1 | 更新 `harness-architecture-review/SKILL.md` 加三层 | `.claude/skills/harness-architecture-review/SKILL.md` | 5 min |
| 2 | 更新 `reviewer-cross/SKILL.md` 加三层 | `.claude/skills/reviewer-cross/SKILL.md` | 5 min |
| 3 | 拆 `debate-review/SKILL.md` → 仅 phase 3 + 加 `PHASE_2_PROMPT.md` | `~/.claude/skills/debate-review/{SKILL.md, PHASE_2_PROMPT.md}` | 15 min |
| 4 | 写 `scripts/run-debate-phase.sh` (Round 1 cross m1 修复路径) | `scripts/run-debate-phase.sh` | 30 min |
| 5 | 更新 `HARNESS_REVIEW_LOG.md` 头部元配置加三层表 + 已 ship 4 round 加 "v1 retroactively" 标记 (Round 1 cross M3 + arch m3 修复) | `docs/HARNESS_REVIEW_LOG.md` | 10 min |
| 6 | 更新 `verify-m1-deliverables.mjs` 加 review-mechanism v2 文件存在性 | `scripts/verify-m1-deliverables.mjs` | 5 min |
| 7 | 更新 `HARNESS_ROADMAP.md` M0/M1 退出条件加 "phase 3 author solo 显式妥协项" (Round 1 arch M-D 修复) | `docs/HARNESS_ROADMAP.md` | 10 min |

**实施工作量**：~80 min

**自验收 dogfood**：30-60 min（用 v2 修订版自审：Round 1 双 reviewer + phase 2 cross-pollinate + phase 3 裁决）

**总工作量**：~2 h（实施 80 min + 自验收 60 min）。

---

## 3. 成本估算

按每个 contract 的评审成本（agent calls + tokens）：

| 阶段 | 当前 | v2 后 | 增量 |
|---|---|---|---|
| phase 1 评审（独立） | 2 calls (arch + cross) | 2 calls | 0 |
| phase 2 辩论（cross-pollinate） | 2 calls (但只读 brief) | 2 calls (读 own + sibling Round 1 verdict + artifact；**不读 author counter**，dogfood Round B1 修复) | tokens +30%（输入更大）|
| phase 3 裁决 | author solo | author + (M3+) Synthesizer | 当前 0 增量；M3 +1 call |

**M0/M1 期间总成本增量**：约 +15%（仅 phase 2 输入扩展）。

**避免的成本**：单次 review 漏 BLOCKER 导致 dogfood 撞墙的返工成本。M-1 实测：cross 漏判 §8 撒谎为 BLOCKER（标 minor）—— 没 phase 2 的话 author 的 4 档分类是单点决定，可能漏修。

---

## 4. 验收（Round 1 arch BLOCKER 修复：拆双门槛）

实施后跑一次自验证：
1. 用本提案 v2.0 修订版自身作为 dogfood artifact
2. arch + cross Round 1 评审本提案
3. **跑 scripts/run-debate-phase.sh** 让两位 reviewer 看 sibling verdict 互怼
4. author 用拆开的 phase 3 SKILL 裁决
5. 用户审最终决议

**门槛 (a) 流程必过**（结构性，必满足）：
- 两份 react verdict 文件落盘
- PHASE_2_PROMPT 的"四选一"语义被遵守（每条 sibling finding 都有 agree / disagree / refine / not-reviewed 之一）
- REVIEW_LOG 矩阵记录每条 sibling 表态分布
- "至少 1 条 disagree 或 refine"硬约束被遵守（全 agree 自动 escalate）

**门槛 (b) 价值信号**（实质性，**必须二选一**）：
- 要么 (b1) phase 2 至少出现 **1 条 reviewer 撤回 / 升级 / refine-改 fix 的 finding**（react verdict 与 phase 1 verdict 不同；**refine 算 (b1) 仅当它改变 phase 3 应用的修复方案**——纯措辞 refine 不算）（dogfood Round cross m3 + arch refine 修复）
- 要么 (b2) phase 2 浮出 **1 条 phase 1 双盲都没提的新 finding**（reviewer 看 sibling 后联想到的）

**两者都没有 → v2 验收未通过**，需要在第 2 个 contract 再跑一次再判。

不加这条门槛，v2 验收会被结构性强制满足，而失去信号——"OQ1 一律跑" 默认会被无证支撑锁死。

**M2 cost projection**（Round 1 arch M-A 修复）：
M2 dogfood 假设 20 个 routine Issue × 5 个 stage gate × 2 reviewer × 2 phase = 400 reviewer call（v2 一律跑）vs 200 call（v1 单 phase）。如果 v2 不区分 routine vs high-risk Issue 的 phase 2 触发条件，M2 cost 翻倍。**因此 OQ1 默认改**：M-1/M0 期间所有契约一律跑（建立基线证据），M1+ 改触发条件式（详见 §6 OQ1）。

---

## 5. 风险（Round 1 arch + cross 后扩展到 8 条）

| 风险 | 概率 | 缓解 |
|---|---|---|
| cross-pollinate 后两位 reviewer 互相妥协 = 集体盲区放大（同 LLM 系列模式同步漂移） | 中 | reviewer-cross 用 gpt-5.5-medium 非 Claude，已经异质化；M3 视情况引第三方 model |
| reviewer 读 sibling verdict 后失去独立判断（变成"我同意 sibling"） | 中 | PHASE_2_PROMPT.md 强制每条 finding 四选一 + **至少 1 条 disagree / refine 硬约束**（Round 1 arch M-B 修复）；全 agree 自动 escalate |
| run-debate-phase.sh 输入 prompt 过大（含两份 verdict），cursor-agent / Agent 超 stream timeout | 低 | M-1 期 verdict ~150 行，sibling + own + artifact 总 prompt ~600-800 行，远低于 1M context |
| author 在 phase 3 裁决时仍 bias（拆 SKILL 不解决根因） | 高 | 本提案不解决 author bias，**M0/M1 期作为显式妥协项**写到 [HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md) 退出条件中（Round 1 arch M-D 修复）；M3+ Synthesizer 上线后允许 retro re-arbitrate v2 期决策（加 audit trail 字段）；不视为 final-irreversible |
| 增加流程复杂度，新人/未来 Claude 不理解三层 | 低 | 三层定义写到 4 个 SKILL.md + REVIEW_LOG 头部，主动透传 |
| **phase 2 跨模型 contamination**（Round 1 arch M-C）：cross 读完 arch verdict 后写作风格 / 论证结构向 Claude 漂移，削弱异质性。Du et al. debate 论文里多 LLM 是同代同模型族；v2 跨模型族跑 phase 2 是没有先例验证 | 低-中 | M0 第一次跑 phase 2 后**人工对比** cross 的 phase 1 vs phase 2 verdict 写作风格；如发现明显漂移，回退到 v1 或加规则"react verdict 中禁止 quote sibling verdict 整段，只允许 quote 单 finding 标题" |
| **PHASE_2_PROMPT 强制三选一 = "出现表态" 是结构性必然，不是验收信号**（Round 1 arch BLOCKER） | 高（如不修） | 验收 §4 拆 (a) 流程必过 + (b) 实质二选一（撤回 / 升级 OR 新 finding） |
| **v1 / v2 REVIEW_LOG 并存边界缺**（Round 1 cross M3 + arch m3） | 中 | REVIEW_LOG 头部加版本边界 + 已 ship 4 round 加 "v1 retroactively, no phase 2" 标记；v2 ship 后新 round 必须含 phase 1/2/3 三段 |

---

## 6. Open Questions（Round 1 arch 评审后已敲定）

- **OQ1**：phase 2 cross-pollinate 是否一律跑？
  - **决议**（Round 1 arch M-A 评审反对原作者倾向）：**M-1/M0 期一律跑**（建立基线证据，~5 个 contract）；**M1+ 触发条件式**：(a) Round 1 双 reviewer 之间 ≥ 1 BLOCKER mismatch；(b) artifact 涉及 schema migration / security / 不可逆操作；(c) Issue.priority=high。否则跳过 phase 2，单 author solo phase 3。M2 dogfood 后用真实数据决定是否回到一律跑
  - **(c) 生效窗口**（dogfood Round arch m2 修复）：`Issue.priority` 字段在 spec stage 由 PM Agent 填写。**M-1/M0 期 Issue 表还没真业务数据**，所以 (c) 触发**M1+ 才生效**（M-1/M0 期靠"一律跑"覆盖）。
  - **跳过日志格式**（dogfood Round cross M3 + arch refine）：跳过 phase 2 时 REVIEW_LOG 必须记录 trigger check 结果（每条 a/b/c 的 source-of-truth 字段，如 `harness.db.issue.priority='normal' / labels=['refactor']`），不允许只写"未触发"——否则审计无法区分"漏跑"vs"合法跳过"
- **OQ2**：phase 2 reviewer 是否允许撤回 Round 1 verdict？
  - **决议**（Round 1 arch 同意 + 加约束）：**允许撤回 + 必须给反例**——PHASE_2_PROMPT 强制"撤回需写：sibling 的具体证据 + 自己原 verdict 的失误点"。无反例的纯撤回视为低成本"我同意"伪装，不算实质对话
- **OQ3**：phase 3 仍 author solo 是否够？
  - **决议**（Round 1 arch 部分同意 + 升级要求）：**M0/M1 期保持 author solo**，但**升级为 [HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md) M0/M1 退出门槛的显式妥协项**（不是默默接受）。文字："本期所有 review 决策接受 author single-arbitration bias，M3+ Synthesizer 上线后允许在新 retrospective 中标记 `M3+ re-arbitrated` 字段，形成 audit trail。"
- **OQ4**：是否同步加 ReviewVerdict 数字 score 落 SQLite？
  - **决议**：**不加**。M-1 cross M3 已确认"M-1 markdown 即可，M2 review-orchestrator 解析落 DB"。v2 不扩范围。但承认这削弱 §4 验收的 SQL 可查性（只能 markdown grep / 人眼判断 phase 2 vs phase 1 verdict diff 率），属于已知妥协

---

## 7. 实施后的 review log entry 格式

`HARNESS_REVIEW_LOG.md` 每轮评审记录改为：

```markdown
### Round N — <artifact>

**phase 1 评审 verdicts**：
- arch: docs/reviews/<artifact>-arch-<TS>.md
- cross: docs/reviews/<artifact>-cross-<TS>.md

**phase 2 辩论 react verdicts**（cross-pollinate）：
- arch react: docs/reviews/<artifact>-arch-react-<TS>.md
- cross react: docs/reviews/<artifact>-cross-react-<TS>.md

**phase 3 裁决 矩阵**（含 phase 2 之后的最终判断）：
（22 项主张 4 档分类，与当前 v1 一致）

**用户拍板**：✅ / ⚠️ / 🚫
```

---

## 8. 验收完成后的 v2 完工状态

- [x] 4 个 SKILL.md 都写明三层（arch + cross + debate-review + PHASE_2_PROMPT）
- [x] `run-debate-phase.sh` 可独立跑通
- [x] phase 3 SKILL.md 拆出 + PHASE_2_PROMPT.md 上库
- [x] HARNESS_REVIEW_LOG.md 头部元配置更新
- [x] verify-m1-deliverables.mjs 加 v2 文件检查
- [x] **dogfood §4 验收 (a) + (b) PASS（v2 dogfood Round 2026-05-03）**
  - (a) 流程必过：✅ 两份 react verdict 落盘；四选一被遵守；arch react 3 refine + cross react 5 refine 满足"≥1 disagree/refine"硬约束
  - (b1) ✅ cross 自降 phase 1 B1 (BLOCKER → MAJOR)，附反例
  - (b2) ✅ phase 2 浮出 3 new findings (arch react N1+N2 / cross react N1) — phase 1 双盲都没提

**checklist 与 §4 对齐**（dogfood Round cross M2 修复）：本节验收门槛与 §4 双门槛**完全一致**，不弱化为"至少 1 条表态"。

---

## 9. 不在范围（推到 M2/M3）

- Adversary / Red Team reviewer 角色（M2 第一个 risk-triggered Issue 时加）
- Synthesizer 第三方裁决角色（M3 视 author bias 真问题再加；v2 期决策**不视为 final-irreversible**，加 `M3+ re-arbitrated` audit trail 字段）
- Domain Expert reviewer / End User reviewer（M4 视情况）
- AutoGen / LangGraph framework 引入（永不，违 §0 #11 不引入新基础组件）
- ReviewVerdict 数字 score 落 SQLite 行（M2 review-orchestrator 一并落地）
- **reviewer-cross "里程碑出口自检 lens"**（Round 1 cross m3 修复：v2 不修这个 lens 盲点；M-1 retrospective §5 已点出"cross 漏判 §8 撒谎为 BLOCKER"。挂到 M0/M1 方法论改进项，不混入 v2 范围）

## 10. 历史 round retroactive 标注（Round 1 cross M3 + arch m3 修复）

v2 ship 时：

- `HARNESS_REVIEW_LOG.md` 头部加版本边界段：
  ```
  ## 评审机制版本
  - v1（2026-05-03 之前）：phase 1 独立评审 + author solo arbitration 合并 phase 2/3
  - v2（2026-05-03 起）：phase 1 独立评审 + phase 2 cross-pollinate（reviewer 互怼）+ phase 3 author 草拟 + 用户终审。M3+ 加 Synthesizer 时升级
  ```
- 已 ship 的 4 个 round（Round 1+2 contract #1+#2 / Round 1 contract #2 / Round 1 contract #3+#4+method）每段开头加注：
  > **本 round 按 v1 跑（v2 之前），无 phase 2 cross-pollinate verdict。M3+ Synthesizer 上线后允许在新 retrospective 中标记 `M3+ re-arbitrated`。**
- v2 后新 round 强制三段（phase 1 / phase 2 / phase 3）

**不回填**已有 round 的 phase 2 verdict（伪造历史）。仅做版本边界标注。
