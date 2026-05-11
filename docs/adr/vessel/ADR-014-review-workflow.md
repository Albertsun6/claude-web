# ADR-014: Review Workflow（B' 方案 lite）

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: methodology, governance, review, autonomous-review

## Context

Vessel 是个人长期项目，需要保留 SDLC 评审产物（防过度自信 / 集体盲区）但**不需要会议+人**仪式。前 6 轮 plan 评审都是手动复制粘贴外部 AI 评审，摩擦高、不能随时触发、没有自动化。

第六轮用户反馈：
- 要"尽量少参与，决策时才找我"
- 评审做完后还要加自动检查 gate
- 找业界标准方法论参考

第六轮外部 AI 评审（v5.3-lite）：v5.3 完整版 0-meta（4 subagent + 9 项 Verify Gate + 完整脚本基建）**过重**——是新的 over-engineering 陷阱（"先造评审系统，再造产品"）。要 v5.3-lite 收缩。

业界对应方法论：
- **Stage-Gate**（产品开发）：每阶段 gate 才进下一阶段
- **DAR (Decision Analysis & Resolution)**（CMMI L3）：重大决策结构化
- **Fagan Inspection**（IBM 70s）：多 lens 独立评审 + 收敛
- **CD Promotion Gate**（Continuous Delivery）：自动化 quality gate

## Decision

采用 **B' 自治评审 + Verify Gate 方案**，0-meta-lite 版本——只做最小可用集，问题真出现时再加自动化。

### 流程图

```
[识别决策点 / 设计任务]
        ↓
Phase 0: 外部调研（仅 DAR 触发条件下跑）
   author → WebSearch / GitHub / 文档 / RFC
   → spike report → docs/research/<topic>-<YYYY-MM-DD>.md
   小决策跳过；详见 ADR-015
        ↓
[plan / ADR / milestone 草稿]  ← 引用调研结果（"Prior Art" 段）
        ↓
Phase 1 (manual v5.4): 3 reviewer prompt 轮流隔离评审 → 各 verdict.md（BLOCKER/MAJOR/MINOR）
        ↓
Phase 2 (manual v5.4): 互看 + react verdict（agree/disagree-with-evidence/refine/not-reviewed）
   硬约束：≥1 disagree/refine 防全 agree 退化（Fagan 原则）
        ↓
Phase 3: debate-review SKILL 仲裁 → 4 档矩阵 + 落修复
        ↓
Verify Gate 5 项 (manual v5.4): 跑检查清单
        ↓
   ┌──全过──→ 进入下一阶段
   └──escalation──→ 找 owner（仅以下 8 种触发器）
```

### 4 个 reviewer lens（v5.4 lite：先做 prompt 草稿，不做常驻 subagent）

| Role | Lens / 阶段 | 关键产出 |
|---|---|---|
| **vessel-researcher** | Phase 0 / Prior Art / Trade Study / Spike | spike report（按 ADR-015 模板） |
| **vessel-architect** | Phase 1 / 架构 / 模块边界 / 长期演进 / 接口契约 | 5 接口契约不漏；boot 三层独立可重入；Eva 改造保架构纯度 |
| **vessel-pragmatist** | Phase 1 / 工程可行 / 简洁 / YAGNI / 个人单机 / Eva 复用优先 | 不过度工程；不偷上 LLM Driver；Eva 优先复用；不池化 ML worker |
| **vessel-risk-officer** | Phase 1 / 风险 / 安全 / 数据 / 失败模式 / 可观测性 | RISKS 增量；secrets 不入库；helper subprocess 失败降级；trace 字段脱敏 |

> v5.4 lite：先以 prompt 草稿形式存在（见附录），author 在主会话里轮流扮演每个 role 评审。常驻 `~/.claude/agents/` subagent 暂缓到 future iteration。

### Verify Gate 5 项（v5.4 收缩，4 项暂缓）

#### 必做（5 项）

任何一项失败 → escalation 到 owner。

| # | 检查 | 实现（v5.4 lite） | 借鉴 |
|---|---|---|---|
| 1 | **Finding 闭环**：所有 BLOCKER/MAJOR 都有矩阵裁决（`accepted`/`rejected-with-reason`/`deferred-with-owner+date`） | 手动检查 | Stage-Gate |
| 2 | **修复落地**：accepted finding 在 plan/ADR 文件 grep 到对应改动 | 手动检查 + git diff | CD gate |
| 3 | **回归测试**：现有 `pnpm test` 全过（如改了代码） | 调 pnpm | CI 标准 |
| 4 | **链接完整性 + Doc 一致性**：plan 里所有 file path 都存在；ADR-XXX 引用都存在；Eva/EVA 混用检测 | 批量 `test -e` + grep | Documentation as Code |
| 5 | **调研引用**：重大决策 ADR（DAR 触发条件）必须有「Prior Art」段引用 `docs/research/<topic>.md`；Vessel 特有设计写 "No direct prior art found + 搜索关键词 + 为什么自研" | 手动检查 | Spike / Trade Study |

#### 暂缓（出现真实需求再加）

- ❌ Schema 兼容（migration dry-run）
- ❌ NFR 未退化（NFR-driven test runner）
- ❌ Reviewer 异质性（log.jsonl ≥1 disagree/refine 自动检测）
- ❌ 完整 Doc 一致性（版本号 / markdownlint）

### Escalation 触发器（4 软 + 4 硬）

#### 软触发（4 种）

1. **架构师 reviewer 标 finding 为 `decision-required`** —— 价值取舍（如"语言换 Python 还是 TS"）
2. **评审者间 disagree-with-evidence + author 反驳** —— 矩阵显示需 owner
3. **Verify Gate 任何一项失败** —— 自动化能力之外
4. **里程碑 closeout** —— M0 / M1A 等大节点完成时**手动跑一次外部 AI 终审**（异质性兜底）

                                                                                #### 硬触发（v5.4 加；**v0-pre 修订（2026-05-09 owner E2 决策）**：分两类——**真实 production secret + 破坏性操作**仍必`qZ                                                                                                                                                       ``trufflehog` / `git-secrets`：
   - 🚨 **真实 production secret**（owner 自己的 API key / OAuth token / DB 密码 直接 commit）→ **必停** owner 立即处理（撤 token + filter-repo + force push）
   - ✅ **test token / 示例 token / fixture / 借鉴代码 leftover** → 写入 [`docs/security/SECRETS_AND_TEST_TOKENS_LOG.md`](../../../docs/security/SECRETS_AND_TEST_TOKENS_LOG.md)，**不阻塞**当前工作；release 前集中清理
6. **License 风险（AGPL/SSPL/BUSL）**：依赖或借鉴代码命中限制性 license → 写入 [`docs/legal/THIRD_PARTY_LICENSE_LOG.md`](../../../docs/legal/THIRD_PARTY_LICENSE_LOG.md)，**不阻塞**当前工作；release 前集中清理。可以先借鉴或搬用，必须记录来源 + 处理期限。
7. **CVE / security issue**（**分类处理**）：`pnpm audit --audit-level=high`：
   - 🚨 **production runtime 路径上的 CVE**（cli-runner / scheduler / orchestrator 等）→ 必停
   - ✅ **dev-only / 借鉴代码 / test fixture 上的 CVE** → 记录到 SECRETS log（`type: cve-deferred`），release 前处理
8. **破坏性数据迁移 / `rm -rf`**：schema drop column / drop table / data loss / 强删目录 → **必停** owner 批准。**不可 defer**（数据丢失不可逆）。

#### Release Gate（v0-pre 加，2026-05-09 owner E2 决策）

v0.1 release / 公开发布 / 分发 / 上架前必须：
- THIRD_PARTY_LICENSE_LOG.md 所有 active 条目 status 已处理（`removed` / `false-positive` / `approved-for-public`）
- SECRETS_AND_TEST_TOKENS_LOG.md 同上 + `real-production` 计数 = 0 + final gitleaks scan clean

任一未通过 → release-gate escalation owner 处理。

### Phase 3 实现引用

Phase 3 仲裁直接复用 `~/.claude/skills/debate-review/SKILL.md`（跨项目共享）。

## Consequences

### 正面

- ① **个人单机够用**：3 reviewer prompt + 5 项 Verify Gate + 手动跑，1-2 小时上手
- ② **不再单粘贴外部 AI**：日常评审在主会话里跑，外部 AI 仅 milestone closeout 用
- ③ **保留 SDLC 产物纪律**：verdict / 矩阵 / 调研报告全部归档进 docs/，长期记忆
- ④ **escalation 触发器明确**：owner 不需要主动跟踪进度，autopilot 跑出问题才被找

### 负面

- ① **同模型集体盲区**：3 reviewer prompt 都由 author（Claude）扮演，可能有共有偏见 —— **缓解**：milestone closeout 手动跑外部 AI 终审做异质兜底
- ② **手动跑 5 项 Verify Gate**：v5.4 lite 没有自动化脚本 —— **缓解**：5 项都简单（grep / test -e / pnpm test），出现繁琐时再写脚本
- ③ **Fagan 变形**：原 Fagan 强调多人同读 + 会议收敛，B' 改成 prompt 隔离 + react verdict —— **接受**：个人项目能用 prompt 模拟 lens；Phase 2 react verdict 允许明确反驳，不强制造 disagree

### 中性

- 跟 ADR-015 绑定（Phase 0 调研规范）
- 跟 Eva 现有 debate-review SKILL 复用（不重写 Phase 3）

## 暂缓清单（v5.4 → future iteration）

需要时再做：

- ❌ `~/.claude/agents/` 常驻 subagent（4 个配置文件）
- ❌ `scripts/run-debate.sh` 自动 Phase 流转脚本
- ❌ `scripts/verify-gate.sh` 自动检查脚本
- ❌ Phase 2 自动 cross-pollinate 实现
- ❌ Reviewer 异质性自动检查
- ❌ `instance/inbox/` 自动 escalation 通知系统
- ❌ `docs/reviews/INDEX.md` / `reviews.jsonl` 自动索引
- ❌ Verify Gate 暂缓 4 项（schema / NFR / 异质性 / 完整 Doc 一致性）

---

## 附录 A — Reviewer Prompt 草稿

> 0-meta-lite：以下 prompt 在主会话里**手动扮演**使用。author（Claude）按顺序加载每个 role，独立评审 artifact，输出 verdict。

### A.1 vessel-architect

```
你是 vessel-architect reviewer。你的 lens 是：
- 架构纯度（5 层架构 / 模块边界 / 接口契约）
- 长期演进（Eva 改造能否保架构正确性 / 后续扩展空间）
- 5 接口契约（Agent / Skill / Tool / Memory / App）的完整性
- Boot 三层独立可重入（进程 / Instance / Session）

你必须：
1. 通读完整 artifact（plan / ADR / milestone）
2. 逐条找 finding，按级别标 BLOCKER / MAJOR / MINOR
3. 对每条 finding 写：位置（行号 / 段名）+ 简短描述 + 为什么是问题（架构后果）
4. 标 decision-required：如果某 finding 涉及价值取舍 / 路线选择，必须由 owner 拍板

你不要：
- 评论代码风格 / 命名细节 / 文档措辞（除非影响架构理解）
- 替 pragmatist 评（工程可行 / 简洁 / YAGNI 不是你的 lens）
- 替 risk-officer 评（安全 / 失败模式不是你的 lens）

输出格式：markdown，按 BLOCKER / MAJOR / MINOR 三段组织，每段列 findings。
```

### A.2 vessel-pragmatist

```
你是 vessel-pragmatist reviewer。你的 lens 是：
- 工程可行性（个人项目复杂度 / 维护成本 / 学习曲线）
- YAGNI（避免过度设计 / 不为不存在的需求做准备）
- Eva 优先复用（先查 EVA_TO_VESSEL_MAPPING，能复用就重构而非重写）
- 个人单机硬约束（不上 K8s / Redis / PG / token 计费 LLM）
- 阶段拆分合理性（一个里程碑只暴露一个最大风险点）

你必须：
1. 通读完整 artifact
2. 找过度工程化迹象（多余抽象 / 未来扩展性陷阱 / over-engineering）
3. 找违反 Eva 优先复用的地方（"为什么不直接用 Eva 现成模块"）
4. 找硬约束违反（隐性引入服务端依赖 / 隐性 token 计费 / 多租户假设）
5. 标 BLOCKER / MAJOR / MINOR

你不要：
- 替 architect 评（接口契约 / 架构纯度不是你的 lens）
- 替 risk-officer 评（安全 / 风险登记不是你的 lens）

输出格式：markdown，按 BLOCKER / MAJOR / MINOR 三段组织。
```

### A.3 vessel-risk-officer

```
你是 vessel-risk-officer reviewer。你的 lens 是：
- 风险登记（任何"如果 X 失败"都要进 RISKS.md）
- 安全（secrets / 数据隐私 / 文件权限 / 路径白名单）
- 失败模式（helper subprocess 挂掉怎么办 / ML worker 失败 / 网络断开 / 磁盘满）
- 可观测性（trace 字段脱敏 / 大输出走 artifact_refs）
- 4 类硬触发（secrets / license / CVE / 破坏性数据迁移）

你必须：
1. 通读完整 artifact
2. 找未登记的风险（应该在 RISKS.md 但缺失的）
3. 找触及 4 类硬触发的内容（应该 escalation 到 owner 但没标的）
4. 找失败模式漏洞（什么情况下会崩 / 什么情况下静默失败）
5. 标 BLOCKER / MAJOR / MINOR

你不要：
- 替 architect 评（架构纯度不是你的 lens）
- 替 pragmatist 评（YAGNI / 简洁不是你的 lens）

特别注意：发现 secrets / license 风险 / CVE / 破坏性数据迁移 时**必须标 BLOCKER + escalation-required**，不论是否会影响架构 / 工程。

输出格式：markdown，按 BLOCKER / MAJOR / MINOR 三段组织。
```

### A.4 vessel-researcher（Phase 0 用）

```
你是 vessel-researcher。你的工作是 Phase 0 外部调研，产出 spike report。

触发条件：DAR yes/no 检查表满足任一项（详见 ADR-015）。

你的工作流：
1. 接收"目标决策"（要决定什么？）
2. 用 WebSearch / WebFetch / general-purpose Agent 找 Prior Art
3. 找 3-5 个相关项目（含 license / 活跃度 / 接口形态）
4. 找学术 / 标准参考（如有）
5. 做对比表（按 Vessel 硬约束打分）
6. 估算成本（实施工作量 + 维护 + 学习曲线）
7. 设计迁移路径 + 回退方案
8. 检查 license / security 风险
9. 推荐方案 + 留不确定点

输出：spike report 进 docs/research/<topic>-<YYYY-MM-DD>.md，10 段必备（详见 docs/research/README.md）。

特殊情况：
- Vessel 特有设计无 Prior Art → 显式写 "No direct prior art found + 搜索关键词 + 为什么自研"
- 调研结果显示某方案触及 4 类硬触发 → 标 escalation-required
```
