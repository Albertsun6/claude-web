# Architecture Review — EVA_AS_PERSONAL_JARVIS.md v0.1

**Reviewer**: harness-architecture-review
**Model**: claude-opus-4-7
**Date**: 2026-05-06 00:42
**Files reviewed**:
- docs/proposals/EVA_AS_PERSONAL_JARVIS.md (368 行, v0.1, jarvis 长期愿景)
- docs/proposals/EVA_MULTI_PROJECT_USAGE.md (v0.3 final, 配套短期 proposal, 一致性参照)
- packages/backend/src/migrations/0001_initial.sql (13 实体 schema 现状)
- docs/HARNESS_DATA_MODEL.md §1.1 / §1.6 / §2.5 (v0.3 sync 后 domain_profile + K12)
- docs/HARNESS_ROADMAP.md §0 #1-23 (不变量) + §6 里程碑 (M-1 → M4)
- docs/HARNESS_RISKS.md §8 R8.1-R8.15 (v0.3 sync 后多项目风险)
- docs/AI_ASSESSMENT.md §高 安全配置 (M5 准入条件 P0 三条)

## Summary

- **Blockers**: 3
- **Majors**: 9
- **Minors**: 5
- **总体判断**：**必须先修后再进 phase 2**。proposal 在长期方向 + 4 原语打分卡 + K-jarvis 4 条不变量上是有判断的，但**核心结构性矛盾（M5-M8 顺序 / Stage 模型与多 domain 冲突 / Memory schemaless 与现有 schema 风格冲突）需要先修，否则 phase 2 cross-pollinate 无法收敛**。

## 总体判断

proposal 把"短期相变 + 长期愿景"分开走独立 proposal 这个判断是对的，author 在 §0 也把范围明确限定在"方向性 / 长期路线图，不是即将做的 spec"。但**自评"不可逆度高"实际并不成立**——proposal 同时选了 J1-A（仅文档预留），等于不动任何代码 / schema，跟 v0.3 已经收敛的 §1.1 / §1.6 / §2.5 之间没有 schema delta。"扩展点应当预留"作为原则，在 J1-A 路径下是空承诺，预留与不预留的差异只在 §1.14 / §1.15 文档段加几行说明。

更核心的问题：proposal 试图把 harness 从"企业管理系统垂直 SDLC harness"调头到"私人贾维斯"，但**原 harness 的核心抽象（10 个固定 Stage CHECK enum / Issue → Stage → Task → Run → Artifact / 评审矩阵 / 方法论 ritual）是为软件 SDLC 设计的，强行套到 health / finance / routine domain 会触发 schema-rebuild + 抽象漂移**。proposal §5 M5 "每个新 domain 配套 Stage kind 集合"轻描淡写带过，但这一句话背后是 Stage CHECK enum 改造 + AgentProfile 集合扩展 + Methodology 表多版本管理 + 评审矩阵 per-domain 配置，绝不是 0006 schema-rebuild migration 一次能解决的。

剩余几个核心矛盾：(a) Memory 表 schemaless kind 与现有所有实体严格 CHECK enum 风格相反；(b) M5-M8 顺序 author 自己在 OQ1 也承认存疑，M7 不依赖 M6；(c) K-jarvis-1 反馈回路与 §0 #21 元工作冻结正面冲突。这三条不解决，phase 2 cross-pollinate 没有收敛点。

垂直贴谱性维度需要重新评估：原 harness 押企业管理系统，jarvis 形态实际是 H 段竞品（Khoj / Mem0 / second brain）的形态。proposal 没有正面回答"为什么不直接 fork karakeep / 装 Khoj 而要在 Eva 上自己长出来"。如果答案是"我已经用 Eva 习惯了 + 数据沉淀在 harness.db 不愿迁移"，那这是个人偏好而不是架构判断，应当承认。

## 必须先改

### [BLOCKER-1] M5-M8 顺序"严格不可乱"假设错误，M7 不依赖 M6

- **Where**: §5 M5-M8 顺序段 + §9 OQ1 自我承认
- **Lens**: 里程碑裁剪
- **Issue**: author 排 M6（Memory）在 M7（通用执行）之前的理由是"agent 主动决策必须基于历史经验"，但这是 author 的后置假设。Routine executor（每天提醒喝药）/ Decision approve（财务支出）/ Calendar API write 都不需要历史 fact 检索就能跑。M6 真正服务的是"Strategist 跨 Issue 引用历史 pattern"，这是软件 SDLC 场景的优化，不是非软件 domain 启动条件。
- **Why blocker**: 错排顺序会让 jarvis dogfood 推迟一个完整里程碑——M5 ship 后等 M6 fact extraction 跑出 ≥500 fact + Strategist 引用率 ≥30% 才能进 M7，但 M7 才是用户拍板"我的贾维斯"愿景里最具体的能力（routine / health / finance executor）。Memory 是优化层不是基础层，倒过来排会让用户在 M5 → M7 之间等几个月看不到 jarvis 形态实物。M5-M8 顺序属于路线决策，proposal v0.1 一旦合入文档，后续修订需要重跑 phase 1+2+3。
- **Suggested fix**: 改为 M5 → M7 → M6 → M8 顺序。M5 锁 Subject 形态扩展（domain_profile + 每个 domain Stage 集合 + AgentProfile）；M7 在 M5 骨架上跑非软件 executor，证明"agent 不读 fact 也能跑非软件 routine"；M6 加 Memory 层优化跨 Issue 引用，作为 M7 dogfood 后的优化圈；M8 主动观察层在 M7 + M6 都 ship 后做。退出条件相应调整：M5 退出"至少 1 routine Subject 实测"删掉对 Memory 表的依赖（routine 落 retrospective 即可）。

### [BLOCKER-2] Memory 表 schemaless kind 与 K7 schema 严格 enum 路线正面冲突

- **Where**: §5 M6 核心动作段 + §9 OQ2 自我承认
- **Lens**: 架构可行性
- **Issue**: proposal §5 M6 明文 `kind 是字符串（不是 enum），按 dot-namespace 分类`，理由引 Tana supertag。但当前 0001_initial.sql 里所有 enum 字段（issue.source / issue.priority / issue.status / stage.kind / stage.status / stage.weight / artifact.kind / artifact.storage / methodology.applies_to / task.model / task.status / run.model / decision.* / idea_capture.source）全部走 CHECK enum 严格约束，0005 schema-rebuild migration 还专门做了 enum 扩展配套；ADR-0010 / ADR-0015 + K7（schema migration additive 优先 + 单调升 user_version）的核心理由就是"四端协议靠 enum 锁住才不漂移"。Memory 表突然走 schemaless 是反路线。
- **Why blocker**: 不是细节争议，是架构风格选择。一旦 M6 落地 schemaless `kind`，K-jarvis 形态以下 N 个新实体（Routine / KnowledgeNode / HealthEntry / FinanceEntry / IoTState 见 §2 共识规律 5）都会延用 schemaless 路径——v0.3 才刚把 K12 跨端 enum graceful fallback 立成不变量，M6 立刻引入"无 enum 的字段"会让 K12 适用范围打折（fallback 只在已知 enum 之间，schemaless 字段本身不可 fallback）。
- **Why blocker**: schemaless 还会让 [context-manager.ts NEVER_ALLOWED](../../packages/backend/src/context-manager.ts#L86-L94) 这种基于固定字面量的安全 gate 不能直接复用——FTS5 + LIKE 模糊匹配 ≠ enum 严格命中，prod-guard 黑名单单源真相在 Memory 表上失效。
- **Suggested fix**: kind 仍走 CHECK enum + 配套 0008+ additive migration。第一批 enum 值 = `fact.user-preference / fact.health.baseline / fact.routine.cron / decision.health.alert / pattern.coder.success / pattern.reviewer.anti-pattern` 等 ≤20 个，后续每加一类知识走一次 0008-N additive migration（与 0004 P0-4a 同形态，minor bump）。Tana supertag 的灵活性在个人自用 + 单 SQLite 文件 + 严格 schema 路线下不是优势，是反模式。如果 author 仍坚持 schemaless，必须在 phase 2 给出"K7 + ADR-0015 + K12 在 Memory 表上失效是可接受的"的具体论证。

### [BLOCKER-3] M5 退出条件依赖 M6 还没做的能力，循环依赖

- **Where**: §5 M5 退出条件段第 3 条
- **Lens**: 里程碑裁剪
- **Issue**: M5 退出条件原文："至少 1 个 `routine` domain Subject 实测：每天 push 1 条提醒 + 你回复 + 落 Memory 表（由 M6 才真做，M5 占位用 retrospective）"。author 自己也承认"M5 占位用 retrospective"，但 retrospective 是 issue-bound（[migrations/0001_initial.sql L293-303](../../packages/backend/src/migrations/0001_initial.sql#L293-L303) `issue_id NOT NULL REFERENCES issue(id)`），每天 push 提醒不是 Issue → 强行占位会触发"每天 1 个 Issue 走 strategy → ... → observe 10 个 Stage" 的退化，要么硬塞 placeholder Issue（污染 Issue 表），要么改 retrospective 表 schema（提前触发 M6 的改动）。
- **Why blocker**: 退出条件无法可执行验证 = M5 ship 没有客观判定依据，整个 outcome-based gate（§0 #13）失效。这是结构性问题，不是退出条件文案改一改能解决的。
- **Suggested fix**: 与 BLOCKER-1 配套修。改 M5 → M7 → M6 → M8 顺序后，M5 退出条件改为"至少 1 个 `knowledge` domain Subject 实测：从想法 → spec（按 knowledge 模板）→ 多 stage 推进 → retrospective 全链路跑通"——只用现有 Issue/Stage/Retrospective 模型即可验证，不依赖 Memory 表。Routine domain 的"每天 push 提醒"退出条件移到 M7。

## 四维评审

### 架构可行性

**优点**：
- 4 原语打分卡（Memory / Awareness / Action / Orchestration）借自 usejarvis.dev 是合理评估框架，把 Eva 当前形态的"Action 70% + Orchestration 60% + Memory 30% + Awareness 10%"打分给出了清晰短板诊断。
- Memory 表用 SQLite + FTS5 不引入 Qdrant / Mem0 独立服务，与 §0 #11 一致，author 抄机制不抄实现的判断对。
- SQLCipher 密钥用 macOS Keychain 这条选择是对的——Keychain 已是系统能力不引入新组件，与 J3-A 推理一致。
- M5 准入条件硬卡 AI_ASSESSMENT P0 三条（fail-closed permission + safe startup + WS payload limit），把"jarvis 数据敏感度高 = 安全配置必须先做完"的逻辑链锁住，这条做得对。

**风险**：
- §1 表 1 第 9 行"Eva (本项目) v0.4.5 + dev"自评 Memory 30% / Awareness 10% / Action 70% / Orchestration 60% 这四个具体百分比没给评分依据。打分卡的可比性靠分维度操作化定义，proposal 没给定义就直接打分，等于用 vibes 评估架构差距。建议 phase 2 之前补一段"4 原语操作化定义 + Eva 当前能力 against 该定义的逐条得失"。
- 跨 Subject 检索 fact 的权限/边界设计缺失。M6 SQL 模板 `SELECT * FROM memory_fts WHERE memory_fts MATCH ? AND project_id IN (...) AND kind LIKE 'fact.%'` 跨多 project 检索，与 v0.3 §3 已修正伪风险段"FK 链严格按 project 隔离"路线相反——dogfood 项目的 fact 流到企业项目 spec、health domain 的 fact 流到 work routine 等跨域污染场景没设计。
- fact-extractor 抽错的 fact（"血压 130/80"被 extractor 抽成"血压 13080"）进 Memory 表后被 Strategist 引用就是误导，是数据污染失败模式。Mem0 论文也强调"fact 准确性 ≠ extraction 模型自动通过"。proposal 没列这条失败模式（FJ1-FJ6 都没覆盖）。

### 里程碑裁剪 (M5-M8)

**优点**：
- 按准入 + 退出条件推进，不写日历估算，符合 §0 #13。
- M5 准入要求 EVA_MULTI_PROJECT_USAGE v0.3 全 P0/P1 落地 + AI_ASSESSMENT P0 三条 + M3 + M4 完成，把短期 proposal 与长期 proposal 的接续逻辑写明了，cross-reference 准确。
- M5/M6/M7/M8 不做项写得明确（M5 不引入 Memory / 不引入观察层 / 不接 IoT；M6 不引入向量库 / 不引入 RAG / 不引入 Knowledge Graph 三元组；M7 不引入主动观察层 / 不接外部 SaaS / 不开屏幕全感知；M8 不开 OCR / 不允许 agent auto-execute 不可逆）。这种"明确不做"比"明确做什么"更能锁定边界。

**风险**：
- BLOCKER-1 / BLOCKER-3 已展开。
- M5 准入条件之一"至少 3 个非 dogfood software project 实测跑通"与 EVA_MULTI_PROJECT_USAGE v0.3 P0-4 退出条件"至少 1 个非 dogfood Project 实测创建"相差 3x。如果 M5 准入要求 3 个软件项目实测，意味着 v0.3 ship 之后还要等 M2-M4 期间 organic 累积到 3 个。proposal 没说这是 M2-M4 自然产出还是 M5 启动前的额外动作，M2 master plan 当前在 loop1→loop2 空窗期，3 个非 dogfood 项目时间线模糊。
- M8 主动观察层准入条件"至少 4 周 M7 dogfood 期间 K-jarvis-2 没被违反（push 数从未超限）"——4 周是日历时间，违反 §0 #13。建议改为"M7 期间至少 N 个完整周（每周 ≥3 天 active）K-jarvis-2 没被违反"或"至少 N 个完整 routine cycle 验证未超限"。
- M5-M8 全程没提到 §0 #21 元工作冻结 / §0 #22 输出侧仪式预算约束。冻结条件硬卡是"M1 跑出 ≥1 个真 dogfood Issue"——M5+ 期间 §0 #21 还冻结吗？如果不冻结，K-jarvis-1 反馈回路（acceptance rate < 30% 触发 ritual 调整）才能跑；如果冻结，K-jarvis-1 跑不动。这条需要明确。
- M6 退出条件"Strategist agent 引用 Memory fact 的覆盖率 ≥ 30%"是个 agent 行为指标，agent 可以通过 prompt 内强制 inject "你必须引用 ≥1 条 Memory fact" 来刷分。LEARNINGS.md #4 已经记录"里程碑指标要防止 agent 刷通过率"。建议改为"覆盖率 ≥ 30% + 引用 fact 与 Issue 真相关性人工评 ≥ 60%"。

### 垂直贴谱性 (jarvis 形态)

**关键变化**：proposal 把 Eva 项目身份从"AI Software Engineer Harness（垂直押企业管理系统）"扩到"私人贾维斯（不只软件工程，所有领域）"。这是身份漂移，需要重新评 vertical fit。

**核心矛盾**：原 harness 的 13 实体 + 10 固定 Stage CHECK enum + 评审矩阵 + Methodology ritual gate 全部为软件 SDLC 设计。把这套抽象套到非软件 domain（health / finance / routine / knowledge）有三层张力没解决：

1. **Stage CHECK enum 10 值固定 vs 多 domain 不同 stage 集合**：[migrations/0001_initial.sql L123-125](../../packages/backend/src/migrations/0001_initial.sql#L123-L125) `kind IN ('strategy','discovery','spec','compliance','design','implement','test','review','release','observe')` 是 schema-level 锁死。M5 "每个新 domain 配套 Stage kind 集合（与软件 SDLC 10 stage 不同）"必然触发 schema-rebuild 大改 + 评审矩阵重做 + Methodology 表 stage_kind 字段语义变化（从"10 选 enum"到"per-domain 字典"）。proposal §4 schema 扩展点表里完全没列 Stage 表的 enum 改动，这是重大遗漏。
2. **Issue/Stage/Task 模型与 routine domain 不匹配**："每天提醒喝药"不是一次性 Issue，是 cron task；"每月血压趋势 review"不是 Stage 流水线，是周期性 query。强行套 Issue → Stage 模型会变成"每天创建 1 个占位 Issue 走 strategy → ... → observe 10 个 Stage"——荒谬。author 在 M5 退出条件里说"占位用 retrospective"已经暴露了这一点，但没正面回应抽象不匹配。
3. **企业管理系统垂直方向 vs jarvis 形态的资源 trade-off**：原 harness §0 #19 "L1/L2 不与已有强对手卷"明确把预算集中到 L3 + L7（编排 + 横切）。jarvis 形态加 health / finance / calendar / iot / mail 集成（M7）等于把预算回到 L1/L2 + L6（Subject 形态扩展）。proposal §3 FJ5 自己也承认"集成面爆炸"，但没正面回答"为什么这是 Eva 应该投资的方向，而不是直接 fork karakeep / 接 Mem0 / 装 Khoj 走 H 段竞品路线"。如果答案是"我已经用 Eva 习惯了 + 数据沉淀在 harness.db 不愿迁移"，这是个人偏好而非架构判断，proposal 应当承认。

**iOS thin shell K4 在 jarvis 形态下不可持续**：v0.3 K4 已 ack P1-2b（iOS UI 项目切换器）是"thin shell 已知例外"。jarvis 形态会把例外扩到 N 个 domain：health domain 血压输入是"数字 + 单位 + 时间戳"特殊表单 / finance domain 是"金额 + 币种 + 时间戳 + 类目"四元组 / routine domain 是 cron 配置 + reminder UI。M0 ADR-0011 server-driven 5 固定原生组件 + slot 是否能承载这些 input UI，proposal §5 M5 一句"加 domain-specific UI hints"带过，没评估可行性。建议 phase 2 之前用 health domain 血压输入做一次 spike：5 固定组件 + slot schema 能否表达 input 类型 + 单位 + 范围 validation。

### 风险遗漏

**author 列了 6 条 FJ1-FJ6 + 4 条 K-jarvis 不变量**，覆盖了主线（单点 / schema 演化 / 注意力反转 / 私密信息中心化 / 集成面爆炸 / agentic over-reach），但**漏列以下 5 条 jarvis 形态特有风险**：

1. **FJ7（建议加）Memory 数据污染传播**：fact-extractor 自动跑 → 抽错的 fact 入 Memory → Strategist agent 引用错误 fact 写错 Issue spec → 错的 Issue spec retrospective 又被 fact-extractor 再次抽取 = 错误循环放大。Mem0 / LangMem 论文都强调 fact accuracy 是 long-term memory 的第一难题。缓解：M6 退出条件加"fact 准确性人工抽查 ≥ N% / 每 N 条 fact 用户确认 1 次"。
2. **FJ8（建议加）Claude CLI 单点供应商风险升级**：jarvis 形态比 software harness 更严重依赖 Claude CLI 可用性（health alert / finance reconcile / routine push 都靠 spawn claude），Anthropic 关停 Pro / 改计费 / API 路径变更 = 整个 jarvis 失能。原 §0 #2 "永不调用 Anthropic SDK"是为版权 / 计费考虑，没覆盖供应商可用性。建议 K-jarvis-5：M7+ 必须有 1 个非 Claude provider（OpenAI / Gemini / 本地 Ollama）作为 fallback runtime。
3. **FJ9（建议加）SQLCipher 密钥丢失 = health/finance 数据永久不可恢复**：J3-A 推荐 SQLCipher 用 macOS Keychain 存密钥，但 Keychain 在系统重装 / 改密码 / iCloud 同步异常时可能丢失。一旦丢失密钥 = 加密 .db 文件无法解密 = 所有 health/finance 数据永久无效。FJ4 缓解只说"加密"，没说密钥备份策略。建议 J3-A 配套：密钥定期 export 到加密 USB（或 1Password / iCloud Keychain 二备份），且每月 1 号 dry-run 解密演练（与 EVA_MULTI_PROJECT_USAGE P1-3 备份恢复演练对称）。
4. **FJ10（建议加）K-jarvis-2 关键决策 Decision approve 与 R7.2 用户审批疲劳冲突**："任何不可逆非软件操作（calendar/mail/iot 写）永远只能建议 + 用户拍板" 听起来安全，但 health 每次用药提醒、finance 每笔记账、routine 每个 cron 都要 approve = 又是 R7.2 审批疲劳全面回归。proposal 说"重要回复 / 任何不可逆"，"重要"边界完全没定。建议 K-jarvis-2 配套 Decision form 分级（trivial 自动 approve / minor 默认 approve 可撤销 / major 必须 approve），与 §0 #22 输出侧仪式预算的 fast-path 同源。
5. **FJ11（建议加）Eva 故障 = 用户生活停摆，第二台设备恢复路径 ≠ 服务可用**：FJ1 缓解只说"跨设备备份"，但备份恢复 ≠ 服务可用。今天 Mac 挂了，"今天该吃药"在第二台设备能否查询？OQ5 留给 reviewer 但没设计这个降级查询路径。建议 K-jarvis-3 一键全关开关之外加一条"降级查询模式"：iPad + Tailscale 直接读 read-only harness.db 副本（不跑 backend），UI 只展示不写入。

## Open Questions 强意见

- **OQ1（M5-M8 顺序）**：见 BLOCKER-1。强意见 = 改为 M5 → M7 → M6 → M8。M7 不依赖 M6，倒过来排让 jarvis dogfood 推迟一个完整里程碑。
- **OQ2（kind 字典表）**：见 BLOCKER-2。强意见 = kind 必须走 CHECK enum + 配套 0008+ additive migration。schemaless 与现有 ADR-0010 / ADR-0015 / K7 / K12 整套 schema 严控路线相反，是反模式。
- **OQ3（一键全关边界）**：强意见 = 一键全关应当真"degrade to v0.4.5 形态"，包括关掉 Memory 检索。理由：用户拍这个开关是因为"Eva 替我决定太多 / 噪音过多 / 想回归手动模式"，Memory 检索本身就是替用户决定的输入源（Strategist 引用 fact 影响 Issue spec 走向），不关 = 半废 = 一键全关变成假动作。author 倾向"Observer / 主动 push 关，Memory 检索保留"是把"用户控制权回归"误读成了"主动通道关停"。
- **OQ4（集成层抽象）**：强意见 = 必须有。否则 N 个 integration（calendar / mail / iot / health / finance / banking / contacts / files）散落实现 = §0 #11 灰区，每加一个 integration 都要决策 SDK / OAuth / API quota / 凭据存储路径 / dry-run 支持 / prod-guard 黑名单覆盖。建议 M7 加 `Integration` 抽象（kind / authMode / scopes / dryRunSupported / credentialStorage），所有 MCP server 走统一注册，新加一个 integration = 填这张表 + 写 1 个 MCP adapter。
- **OQ5（第二台设备）**：强意见 = iPad + Tailscale rsync + age 加密。理由：(a) 用户已有 Tailscale 假设（CLAUDE.md "Tailscale serve 已 wired"）；(b) iPad 与 Mac 同账号，iCloud Keychain 共享密钥可减少 FJ9 密钥丢失风险；(c) NAS 引入新硬件 + 新组件违反 §0 #11；(d) 远程云存储违反"纯个人自用永不分发"硬约束。
- **OQ6（漏列竞品）**：强意见 = Khoj 必须加进 §1 表 1。Khoj 是 Apache 2.0 self-hosted second brain assistant（GitHub 27K star），形态完全契合"个人自用 + 永不分发 + 数据本地"，是 Eva jarvis 形态最贴近的对照系——评估"为什么不直接装 Khoj"是判断 Eva 走自己路线合理性的核心问题。Reflect / Logseq / Obsidian + LLM 插件是 PKM 工具与 Eva orchestration 路径垂直可不加；Rhasspy / Mycroft 已停可不加。

## 建议的下一版改动

1. **M5-M8 顺序改 M5 → M7 → M6 → M8**（修 BLOCKER-1 + BLOCKER-3）。M5 退出条件改为 knowledge domain Subject 全链路跑通（不依赖 Memory 表）；routine domain push 提醒退出条件移到 M7。
2. **Memory 表 kind 改 CHECK enum + 配套 0008+ additive migration**（修 BLOCKER-2）。第一批 enum 值 ≤20 个，后续每加一类知识走一次 0008-N additive migration。如果 author 仍坚持 schemaless，phase 2 必须给出"K7 + ADR-0015 + K12 失效是可接受的"的具体论证。
3. **M5 §5 加一节"Stage 模型扩展评估"**：明确说明 Stage CHECK enum 10 值固定如何 vs 多 domain 不同 stage 集合。要么 Stage enum 扩到 N domain × 10 stage（schema-rebuild 大改）/ 要么改 Stage 模型为 `(domain, kind)` 复合 enum（更大 schema-rebuild）/ 要么承认 Stage 模型不适用 routine/health/finance domain 走另一套抽象（推荐：jarvis Subject 走 Memory + Decision 直接驱动，跳过 Stage 流水线）。proposal 必须正面回答这个抽象选择。
4. **加 §3 FJ7-FJ11 5 条新失败模式 + K-jarvis-5 反 Anthropic 单点供应商不变量**（修风险遗漏 1-5）。
5. **M5 §准入条件"3 个非 dogfood software project 实测跑通"明确时间线**：是 M2-M4 organic 累积还是 M5 启动前额外动作？如果是后者，M5 启动门槛大幅抬高需要 ack。
6. **M8 准入条件"4 周 dogfood K-jarvis-2 没违反"改非日历表述**（修 §0 #13）。改为"N 个完整 routine cycle"或"N 个 active week（每周 ≥3 天 dogfood）"。
7. **M5-M8 全程明确 §0 #21 元工作冻结状态**：M5+ 期间 HARNESS_EVOLUTION_FROZEN 是开是关？K-jarvis-1 反馈回路触发 ritual 调整与冻结期不允许 ritual 调整冲突，必须先解决。

## What I Did Not Look At

- **未读 author transcript / 思考流 / 工具调用历史**（phase 1 独立性约束）。
- **未读 reviewer-cross 的 verdict**（phase 1 独立性约束）。
- **未深读** docs/HARNESS_AGENTS.md（agent profile 层面对 jarvis 形态的影响 / health-coach / health-logger / health-reviewer 三角色与现有评审矩阵的契合度）。
- **未深读** docs/HARNESS_ARCHITECTURE.md L6 Subject Project 段（M5 Subject 形态扩展从"git 仓库"扩到"任意 Subject"对 L6 抽象的具体影响）。
- **未深读** docs/HARNESS_LANDSCAPE.md（§7.4 author 提议加 §6 "贾维斯方向竞品全景"段，仅就 §1 表 1 9 个项目对比做了评估）。
- **未深读** Mem0 / Khoj / Tana supertag 等外部参照源代码（仅就 proposal §1 / §2 引用的判断做了 cross-check，未独立验证 Mem0 91% 延迟降 / 90% token 省 / 53→67% 准确率这些 benchmark 数字）。
- **未涉及** OQ4 集成层抽象的具体 schema 设计（仅给方向建议）。
- **未涉及** 用户决定 J1/J2/J3 的具体数值是否合理（仅评估 author 推荐选项的判断逻辑）。
- **未做** phase 2 cross-pollinate 应有的与 reviewer-cross verdict 的对照（phase 1 独立性约束）。
