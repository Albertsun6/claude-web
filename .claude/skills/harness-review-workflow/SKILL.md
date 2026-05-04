---
name: harness-review-workflow
description: Unified Review Mechanism v2 orchestrator. Runs phase 1 (2 independent reviewers — at least one cursor-agent for heterogeneity) → phase 2 (cross-pollinate react) → phase 3 (author arbitration accept/partial/reject) → iterate until convergence → hand user converged final, NOT raw findings. Three modes — `proposal` (research/explore, default; output docs/proposals/), `contract` (schema/契约/方法论; +ADR-lite + dogfood gate), `patch` (PR ready to merge; +ADR-lite + dogfood + PR template alignment per HARNESS_PR_GUIDE.md). Use when user asks to 调研 / 评审 / 评估 + 评审 / 写个报告 / research and propose / write up + review / harness contract review / schema review / PR review-with-convergence / 多轮评审.
---

# harness-review-workflow skill

> **角色**：你是"评审 + 收敛"流水线的发起人。无论是研究 / 契约 / patch，都走相同 phase 1+2+3+迭代主线，区别只在加多少 gate。从用户一个待审议题出发，**完整跑评审 → 自己仲裁 → 迭代到收敛 → 交用户最终版本**，不是 findings 列表。
>
> **核心原则 1**："评审"的目的是**收敛到决定**，不是把分歧倒给用户。phase 2/3 是默认，不是可选。phase 1-only 是 anti-pattern。
>
> **核心原则 2**：reviewer 异质性 = 独立性的 floor。phase 1 至少一位用 **cursor-agent**（非 Claude），不能两位都用 Claude subagent——会产生集体盲区（参考 2026-05-03 PARALLEL_WORK v0.1→v0.2 双 Claude reviewer 都没抓到 `Issue.metadata_json` 不存在的事实，外部 GPT-5.5 一秒命中）。

## Mode 参数（必选 1 个）

| Mode | 触发场景 | 输出位置 | 额外 gate |
|---|---|---|---|
| **`proposal`** (默认) | 研究 / 探索 / 路线图 / 方案选型 / 可逆决策 | `docs/proposals/<TOPIC>.md` | 无 |
| **`contract`** | 数据模型 / 方法论 / SKILL 文件 / 协议契约 / schema 改动 | `docs/contracts/<TOPIC>.md` 或 `docs/proposals/<TOPIC>.md`（视 M-1 约定） | + ADR-lite (`docs/adr/NNNN-...md`) + dogfood gate（如 `scripts/verify-m1-deliverables.mjs` 校验脚本） |
| **`patch`** | PR ready to merge / 不可逆代码改动 / 上线 release | PR description / branch | + ADR-lite + dogfood + PR template 对齐（[HARNESS_PR_GUIDE.md](docs/HARNESS_PR_GUIDE.md)） |

判断 mode：
1. **优先看不可逆度**：可逆 → proposal；schema/契约/方法论 → contract；patch ready → patch
2. **次看输出形态**：纯文字 → proposal；有 SQL DDL / 协议字段 → contract；有 git diff → patch
3. **歧义时降级**：不确定就用 proposal 起步，contract/patch 阶段升级

## When to use

触发短语（任一即可）：
- "调研一下 / 上网搜搜 / 看看别人都怎么做" → proposal mode
- "整理个报告 / 写个报告 / 做个研究" → proposal mode
- "评估 + 评审 / 评审了再做" → proposal/contract（视议题）
- "审这个契约 / schema / 方法论 / SKILL.md" → contract mode
- "审这个 PR / 这次改动 / patch" → patch mode
- "做个 ADR / 落 ADR" → contract / patch mode

## When NOT to use

| 情况 | 走哪 |
|---|---|
| 一行小修复 / typo / log 调整 | 直接做，不评审 |
| 已在 plan mode，写到 plan 文件 | 用 plan workflow，不要重叠 |
| Live incident | 直接做，事后写 retrospective |
| 仅借鉴 OSS 项目找点子 | `borrow-open-source` skill（专门写 IDEAS.md）|
| 单 lens 评审（用户只要 architecture 角度） | 直接调 `harness-architecture-review` lens skill，不走完整 v2 |

## Workflow（6 步，phase 2/3 默认必跑）

### Step 1 — Research

**输入**：用户的问题陈述
**动作**：
- WebSearch 至少 3 个不同角度的查询（best practices / 同类竞品 / 真实失败案例）
- WebFetch 最相关的 3-5 篇深读，提取**机制级细节**（不是营销话语）
- 必要时 spawn Explore subagent 读现有 harness 文档 + 代码，找对接点

**禁止**：仅凭 search 摘要写报告——必须 fetch 原文确认机制描述准确。

### Step 2 — 写 artifact（按 mode 选位置）

| Mode | 文件位置 | 文件名约定 |
|---|---|---|
| proposal | `docs/proposals/<TOPIC>.md` | SCREAMING_SNAKE_CASE |
| contract | `docs/contracts/<TOPIC>.md` 或同 proposal 路径 | 看 M-1 约定 |
| patch | branch + PR description（无独立 markdown） | feat(<scope>): ... 风格 |

**命名**：`<TOPIC>` 用 `SCREAMING_SNAKE_CASE`，简短描述主题（例：`PARALLEL_WORK_ORCHESTRATOR.md` / `M0_HARNESS_CONFIG_MODELLIST.md`）。

**模板**（必须包含这 11 段）：

```markdown
# <Topic> — 调研报告 v0.1

> **Status**: research / proposal · **Date**: YYYY-MM-DD · **Author**: <agent>
> **Review depth**: Phase 1 only（独立 N 评审 → 用户裁决）。Phase 2/3 显式 skip，原因见 §10。
> **不可逆度**: 低 / 中 / 高 — 一句话说明

## 0. Context
用户问题陈述 + 之前对话流摘要

## 1. 业界 N 种典型架构（从轻到重）
表格对比，每行：架构 / 代表 / 隔离层 / 调度层 / 依赖建模 / 适合

## 2. 共识规律（X 篇深读交叉验证）
机制级 finding 的归纳

## 3. 失败模式清单
表格：失败 / 出处 / 原因 / 缓解

## 4. 对接现有 harness 数据模型 / 代码
✅ 已就绪可用 / ❌ 缺口 / ✅ 现有 IDEAS 条目对接关系

## 5. 推荐方案：N 阶段渐进
每阶段：核心 + 不做 + 退出条件

## 6. 关键不变量
防止抄成失败案例的护栏

## 7. 与现有 IDEAS 的合并建议
新增 / 修订哪些 P / H / A 条目

## 8. 待用户拍板的 N 个决策
具体多选题

## 9. 关键 Open Questions（评审时挑战）
留给评审 / 评审后 OQ

## 10. Phase 2/3 评审 skip 原因
- Trigger check: <为什么本提案不需要 phase 2/3>
- Decision: skip phase 2 + skip phase 3
- Why: <可逆 / 单决策点 / 无契约>
- Escalate condition: <什么情况要回头补 phase 2>

## 11. 引用源
全部 markdown link
```

**关键约束**：
- §1 表格至少 3 个候选架构，从轻到重排
- §3 失败模式至少 5 条，交叉来源
- §5 阶段方案每阶段必须有**outcome-based 退出条件**（不是 calendar 日期）
- §10 是硬要求，缺则 evade phase 2/3 不合规

### Step 3 — Phase 1 双独立评审

**并行**（一定要 parallel，否则违反独立性）spawn 2 个 Agent subagent：

#### Reviewer A — architecture-fit lens（Claude 可接）
- 实施：Agent tool subagent_type=`general-purpose`，prompt 包含 `.claude/skills/harness-architecture-review/SKILL.md` 内容
- 评审维度：架构-fit / 里程碑 fit / 垂直 fit / 风险计划 / 方向
- 输出文件：`docs/reviews/<topic>-arch-YYYY-MM-DD.md`

#### Reviewer B — cross-correctness lens（**必须 cursor-agent，非 Claude**）
- 实施：**用 `cursor-agent` CLI**（`/Users/yongqian/.local/bin/cursor-agent`），不能用 Agent tool 起 Claude subagent
- 调用模板参考 [scripts/run-debate-phase.sh](scripts/run-debate-phase.sh)；为 phase 1 写一个 sibling 脚本 `scripts/run-phase1-cross.sh` 或直接 inline `cursor-agent -p <prompt-file>`
- 评审维度：correctness / cross-end alignment / irreversibility / security / simplification
- 输出文件：`docs/reviews/<topic>-cross-YYYY-MM-DD.md`

**为什么非 Claude 是硬要求**：reviewer-cross skill 自身就写了 "Heterogeneity：本 skill prompt 是 model-agnostic 的，意图被喂给**非 Claude 模型**（cursor-agent gpt-5.5-medium / gpt-5.3-codex）以最大化集体盲区防护"。M-1 retrospective 第 1 条教训："**异质性（不同模型）是独立性的floor**，同模型 + 同 prompt = 表演"。**双 Claude reviewer = phase 1 失效**——会一致性盲到 schema 事实错误（如 2026-05-03 PARALLEL_WORK_ORCHESTRATOR v0.1→v0.2 都没抓到 `Issue.metadata_json` 不存在的事实，外部 GPT-5.5 一秒命中）。

**Independence constraints（HARD，prompt 里必须显式写）**：
- 只允许读：`docs/proposals/<topic>.md` + 自己的 lens skill + 必要时 fact-check 的源文件（**强烈鼓励**实际打开 migration SQL / schema 文件，不要只信文档摘要）
- **不允许读**：另一个 reviewer 的 verdict 文件（哪怕已存在）
- **不允许读**：作者 transcript / chat history
- 启动时必须 parallel（cursor-agent 与 Claude Agent 同步起，不能串行）—— 后启的会被前者污染

**Fact-check 强制**：声称"schema 字段 X 存在"前**必须**读 migration SQL 或 schema 定义文件原文，不能引 docs/HARNESS_DATA_MODEL.md 摘要——后者可能描述未来设计，前者是落地事实。这是 Claude reviewer 最容易掉的坑（confabulation 风险）。

#### Verdict 文件格式

```markdown
# Phase 1 Review — <Lens-name> lens
> Reviewer: <skill-name> · Date: YYYY-MM-DD · Phase 1 (independent)

## Summary verdict
[ACCEPT / ACCEPT-WITH-CHANGES / REJECT / REQUIRES-PHASE-2]

## Findings

### F1. <title> — [BLOCKER / MAJOR / MINOR / FALSE-POSITIVE-CANDIDATE]
**Where**: §X 段落 Y
**Issue**: <what's wrong>
**Why it matters**: <impact>
**Suggested fix**: <concrete edit>

### F2. ...

## Strong points
（让作者修订时不丢的亮点）

## Open questions for the user
（不是 blocker，给用户思考）
```

### Step 4 — Phase 2 cross-pollinate（默认必跑，不跳过）

**目的**：让两位 reviewer 看见对方观点、自我修正自己 verdict、产生 cross-discovered findings。这一步是收敛的关键。

并行 spawn 两个 react-reviewer：

#### React-Reviewer A — arch 看 cross 的 verdict
- subagent_type: `general-purpose`
- 输入：`docs/proposals/<topic>.md` + arch verdict（自己写的）+ cross verdict（对方写的）+ `harness-architecture-review` skill
- **任务**：对 cross 的每条 finding 给 4 选 1 表态：`agree / disagree / refine / new-finding`，硬约束 ≥1 `disagree` 或 `refine`（防止"互捧"），撤回原 finding 必须给反例
- 输出：`docs/reviews/<topic>-react-arch-YYYY-MM-DD.md`

#### React-Reviewer B — cross 看 arch 的 verdict
- 同上，对调
- 输出：`docs/reviews/<topic>-react-cross-YYYY-MM-DD.md`

**Independence**：phase 2 prompt 里**不允许**读 author transcript，但**必须**读对方 phase 1 verdict。

参考已落地的 [scripts/run-debate-phase.sh](scripts/run-debate-phase.sh) 当作 stub 实现（M2 review-orchestrator.ts 会自动化）。

#### React verdict 结构

```markdown
# Phase 2 React — <Lens-name>
> Reviewer: <skill-name> · Date: YYYY-MM-DD · Phase 2 (cross-pollinate)

## 对对方 finding 的逐条表态

### F1（对方原编号）— [agree / disagree / refine / new-finding]
**对方原文**: <quote>
**我的表态**: <one of 4>
**理由**: <why>
**新建议**（仅 refine / new-finding 时）: <concrete edit>

### F2 ...

## 我自己 phase 1 verdict 的自我修正
（哪些 finding 看了对方后想 downgrade BLOCKER → MAJOR / 撤回 / 加新的）

## 新发现（new-finding）
（对方角度让我看到的盲区）
```

**收敛信号**：phase 2 跑完，统计：
- 双向 agree 的 finding → 准 accept
- 双向 disagree 的 finding → 真分歧，需 phase 3 author 仲裁
- 单向 refine → 修订建议，author 接受改文 / 反驳

### Step 5 — Phase 3 author 仲裁（默认必跑）

**调用** `.claude/skills/debate-review/SKILL.md`（已有），由作者（你 = 这个 skill 的发起人）：

1. 读 phase 1 双 verdict + phase 2 双 react verdict
2. 对**每条** finding 形成判断矩阵：

| 类别 | 含义 | 处理 |
|---|---|---|
| **✅ 接受** | 双向同意 OR 一方 disagree 但理由不充分 | 修订到 proposal v0.X+1 |
| **⚠️ 部分接受** | 同意问题存在但用不同 fix | 修订时改 fix 措辞，记录原 fix 在 log |
| **🚫 反驳** | 作者明确不接受，附**具体反驳理由** + 反例 | 不改 proposal，理由进 arbitration log |
| **🟡 用户决定** | 真正需用户偏好的（vertical 定位 / 里程碑取舍 / 风险偏好），有限 escalate | 进"待用户决定"清单，**最多 3 条** |

**硬约束**：🟡 用户决定不能超 3 条。若 >3，说明作者没尽到仲裁责任，回 phase 2 再跑一轮 cross-pollinate。

输出 arbitration log：`docs/reviews/<topic>-arbitration-YYYY-MM-DD.md`，每条 finding 一行表态 + 理由。

### Step 6 — 修订到 v0.X+1 + 收敛判断

**应用所有 ✅ 接受 + ⚠️ 部分接受**到 `docs/proposals/<topic>.md`，bump version v0.1 → v0.2。

**收敛判断**：v0.X+1 是否还有 BLOCKER 级未解 finding？

| 状态 | 下一步 |
|---|---|
| v0.X+1 没有 🟡 用户决定 + 没有未解 BLOCKER | **收敛**——交用户最终版（不是 findings list） |
| v0.X+1 有 🟡 用户决定（≤3 条） | 交用户：v0.X+1 + 仲裁 log + 用户拍板清单 |
| v0.X+1 修订引入新 BLOCKER（reviewer 没说服 OR 新维度） | **回 Step 3，跑 round 2 phase 1**（仅对修订段落）|

**最多 3 轮**。3 轮后还不收敛说明问题超出本 skill 范围，强制 escalate 到用户做架构级决断。

### Step 7 — Mode-specific gates（仅 contract / patch 必跑）

收敛后、交用户前，按 mode 加额外 gate：

#### proposal mode
**无额外 gate**。直接进"用户报告"。

#### contract mode
1. **ADR-lite**：写 `docs/adr/NNNN-<short-slug>.md`（4-decimal 编号顺接），结构最小 4 段：
   - Context（这是什么决定，为什么需要）
   - Decision（具体做什么，不做什么）
   - Consequences（影响 + 不可逆度 + 回滚路径）
   - Review trail（链回 phase 1+2+3 verdict + arbitration 文件）
2. **Dogfood gate**：跑现有 `scripts/verify-m1-deliverables.mjs`（或类似校验脚本），所有项必须 pass。schema 改动还要：
   - 写 migration（可前向 + 可回滚）
   - 在 staging DB / clone 上 dry-run
   - 旧数据兼容性测试

#### patch mode
contract 全部 +：
3. **PR template 对齐**：按 [HARNESS_PR_GUIDE.md](docs/HARNESS_PR_GUIDE.md) 模板填 PR description（包含：what / why / risk / rollback）
4. **链回所有 review 文件**到 PR description（Phase 1/2/3 verdict + arbitration log + ADR），让 reviewer 在 GitHub 一键追溯到本地评审
5. **不可逆操作前确认用户**：force-push、schema migration on production、prod 配置 release——一律先口头授权再执行

### 用户报告（最终交付）

**收敛后** 给用户：
1. ✅ 收敛 verdict（"phase 1+2+3 跑完，N 接受 / M 部分 / K 反驳 / J 用户决定"）
2. proposal 最终版（v0.X）+ 仲裁 log 路径
3. 🟡 待用户决定清单（如有），≤3 条具体多选
4. 一句话："这是收敛后版本，待你定 [J 个具体决定]，定了直接进 plan"

**不收敛**给用户的报告：明确说"3 轮没收敛，原因 X，需要你做架构决断 Y"——不要装收敛了。

## Escalation rules（这些情况升级用户决断）

**最小 3 条**（区别于"未收敛"，这些是真需要用户偏好）：

1. **vertical positioning**：方案越过既定垂直范围（个人 vs 团队 vs SaaS）
2. **milestone 取舍**：方案落 M-X vs M-Y 影响其他 M 准入条件
3. **不可逆决策**：schema migration / 第三方契约 / 公开 API 形状

仲裁阶段把这些自动 route 到 🟡 用户决定，不当作 author-resolvable。

## Decision tree（mode 选择）

```
用户问题进来
    │
    ├─ live incident？ ─── 是 ──→ 直接做，事后写 retrospective
    │       │
    │       否
    │       │
    ├─ 一行 typo / 小修复？ ─── 是 ──→ 直接做，不评审
    │       │
    │       否
    │       │
    └──→ 用本 skill，按特征选 mode：
                │
                ├─ 输出是研究 / 路线图 / 探索方案 → mode=proposal（默认）
                ├─ 输出是 schema / 契约 / 方法论 / SKILL.md → mode=contract（+ ADR + dogfood gate）
                └─ 输出是 git diff / PR ready to merge → mode=patch（+ ADR + dogfood + PR template）
                │
                收敛 → 交用户
                未收敛 → 第 4+ 轮 OR escalate 用户决断
```

## Anti-patterns（不要做）

- ❌ **跑完 phase 1 就交用户** —— 等于让用户当仲裁，违反 skill 核心原则。**phase 2/3 是默认必跑**
- ❌ **双 Claude reviewer**（phase 1 两位都用 Agent tool 起 Claude subagent）—— 同模型集体盲区；至少一位必须 cursor-agent
- ❌ **声称 "schema 字段 X 存在" 没读 migration SQL** —— Claude 容易 confabulation；fact-check 必须读 `packages/backend/src/migrations/*.sql` 原文，不是 docs 摘要
- ❌ **用 ">3 条 🟡 用户决定" 当托词** —— 那是作者没仲裁好，回 phase 2 再跑
- ❌ 串行 spawn 两个 reviewer——必须 parallel，否则独立性破
- ❌ 在 phase 1 reviewer prompt 里贴另一位的 verdict——独立性破（phase 2 才能贴）
- ❌ §1 表只列 1-2 个候选——评审会说"调研不充分"
- ❌ §5 阶段用 "M2-M3" 这种日历——用户明确反对，必须 outcome-based 退出条件
- ❌ 没 fetch 原文就 cite——评审会发现"摘要 vs 实际不符"
- ❌ 报告写完直接进 plan mode——必须先评审收敛 + 交用户
- ❌ contract mode 跳过 ADR-lite —— 不可逆决策无审计 trail，未来回查无依据
- ❌ patch mode 跳过 dogfood gate —— 上线后崩了再回头修代价大

## Examples

- **2026-05-03 PARALLEL_WORK_ORCHESTRATOR (proposal mode)**：用户问"多窗口并行做需求怎么不冲突"。本 skill 跑 phase 1+2+3：5 篇 fetch (Claude Code / AddyOsmani / Microsoft swarm / Nova OS / Devin) + Explore harness 数据模型 + 双 Claude reviewer + 双 react cross-pollinate + 14 ✅ / 1 ⚠️ / 0 🚫 / 1 🟡。
  **教训**：v0.1→v0.2 双 Claude reviewer 都没抓到 `Issue.metadata_json` 不存在（confabulation 自 docs 摘要），外部 GPT-5.5 一秒命中。从此 phase 1 reviewer-cross 必须 cursor-agent。

## 与其他 review skill 的关系

| Skill | 角色 | 用途 |
|---|---|---|
| `harness-review-workflow`（本 skill） | **发起人 / 编排者** | 编排 phase 1+2+3+gates，覆盖 proposal/contract/patch 三 mode |
| `harness-architecture-review` | **lens A** | 被本 skill 调用，扮演架构-fit reviewer（Claude OK）|
| `reviewer-cross` | **lens B** | 被本 skill 调用，扮演 cross-correctness reviewer（**必须 cursor-agent**）|
| `debate-review` | **phase 3 机制** | 本 skill Step 5 调用，作者读所有 verdict 形成 accept/partial/reject 矩阵 |
| `borrow-open-source` | **不同 pipeline** | 专门借鉴 OSS 项目，输出 IDEAS.md（不走 phase 1+2+3）|

## 维护

如发现 phase 1 误判（用户裁决说"不该 skip phase 2"），把案例记到本文件 `## Examples` 段并修订 `## Escalation rules`。每次 escalate 都更新一次。
