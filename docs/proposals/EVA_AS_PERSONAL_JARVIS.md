# Eva 演化为私人贾维斯 — 长期愿景 proposal v0.1

> **Status**: research / proposal · **Date**: 2026-05-06 · **Author**: Claude Sonnet 4.6
> **Review depth**: Phase 1+2+3 完整三相评审（**不可逆度高，必须走完整三相**）
> **不可逆度**: **高** — 触动 M-1 数据模型扩展点（Memory 表 + domainProfile 非软件 enum）+ 长期路线方向 M5-M8 + Eva 项目身份从"AI Software Engineer Harness"扩到"私人贾维斯"。M-1 schema 决策窗口正在 M2 期间持续动（v102 → v200），错过这次扩展点预留窗口，M5 启动时补 schema 代价 = 反向迁移 + 老数据 backfill + iOS 协议 break，远高于现在 author + reviewer 多花的时间
> **范围边界**：本 proposal 是**方向性 / 长期路线图**，不是即将做的 spec。具体 schema 改动每条到 M5+ 启动时再走 contract mode + ADR-lite。本 proposal 只锁定**扩展点应当预留**这个原则
> **配套 proposal**：[EVA_MULTI_PROJECT_USAGE.md v0.3 final](EVA_MULTI_PROJECT_USAGE.md)（短期相变，2026-05-05 用户拍板收敛）。本 proposal 是其延伸：短期是"用 Eva 做工程项目"的相变，长期是"Eva 不只做软件工程"的相变

---

## 0. Context

用户在第 4 轮对话明确长期愿景："**eva 可以创建多个系统，创建出来系统独立运行，这些系统都是我使用，工程过程和思想留在 eva 中。后期 eva 逐渐演化成能帮我做任何的事情私人助理，不是别人的，是我的贾维斯。**"

这句话改变了 Eva 的身份定位：

- 第 3 波（任务型 agent，2024-）：Devin / Cursor BG / OpenHands / Eva 当前 — 给定一个软件工程任务，agent 跑几小时把活干完
- 第 4 波（私人贾维斯，2026 年正在成型）：Eva 长期形态 — 主动陪伴 + 长期记忆 + 跨域调度，不只软件工程，所有领域

**核心识别**：harness 不是 Eva 的终态，是 Eva 长出贾维斯之前必须先长出来的腿。先在最熟悉、最能可控验证的领域（软件工程，dogfood 自己）把"调度 + 评审 + 方法论 + 进化"跑通；然后**把这套骨架的领域假设松开**，让它能管别的事。

**用户拍板的硬约束**（沿用 EVA_MULTI_PROJECT_USAGE.md v0.3 + 第 4 轮新增）：

- 纯个人自用：永不分发、永不商业化、不团队化（沿用 [docs/HARNESS_INDEX.md §跨文档关键约束 #5](../HARNESS_INDEX.md)）
- 不引入新基础组件：保留 [docs/HARNESS_ROADMAP.md §0 #11](../HARNESS_ROADMAP.md)
- 不调用 SDK（§0 #2）
- 不抄 Devin VM 隔离 / Kelos K8s / OpenHands 自建 runtime（违反 §0 #11 / #2 / #3）
- iOS thin shell（§0 #1，K4）
- 工程过程和思想留在 Eva 中（用户原话）— harness.db 不只是临时元数据存储，而是知识沉淀中心
- 不强行做"屏幕全感知"（隐私换便利的成本不对称，详见 §6 K-jarvis 不变量）

本 proposal 的目标：在 M2 期间 schema 还在动的窗口内，把"M-1 数据模型应当预留 jarvis 扩展点"这一原则锁定，避免 M5 启动时补 schema 的天文级代价。具体内容：4 个 jarvis 原语打分卡 + 5 条贾维斯专属新风险 R-K..R-P + M5-M8 演进路径 + 4 条 jarvis 专属不变量。

---

## 1. 业界 N 种典型架构（从轻到重，按"四原语"打分）

借 [usejarvis.dev](https://www.usejarvis.dev/) 的四原语分类（Memory / Awareness / Action / Orchestration）作为评估框架。这套分类是 2026 年这一波贾维斯工具的事实共识——抄分类不抄实现。

| # | 项目 | License | Memory（长期记忆）| Awareness（环境感知）| Action（执行）| Orchestration（调度）| 与 Eva 的关系 |
|---|---|---|---|---|---|---|---|
| 1 | [hyhmrright/JARVIS](https://github.com/hyhmrright/JARVIS) | 自托管开源 v0.8.0 | RAG + Qdrant 向量库 | 多 channel 监听 (Slack/Discord/TG/Feishu/WA) | 多 LLM failover + supervisor + expert agents | Visual Workflow Studio | 不抄实现（Qdrant + docker compose 违反 §0 #11），抄"supervisor + expert agent 路由"思路 |
| 2 | [usejarvis.dev](https://www.usejarvis.dev/) | 商业 | Persistent semantic memory + entity graphs + fact extraction | Screen capture + OCR every 7 seconds + activity tracking | Browser / desktop / terminal / voice I/O | Multi-machine WS + JWT auth | 不抄屏幕 7s OCR（隐私不可接受）、不抄多机 JWT（违反 §0 #11）；抄"四原语分类"作为打分卡 |
| 3 | [JARVIS Core (Turbo31150)](https://github.com/Turbo31150/jarvis-core) v10.1 | 自托管开源 | 26 modules（含 memory）| 9 specialized agents | MCP 协议 | 任务路由 + 多 agent delegation + observability | 不抄"26 模块"过度细分；抄 MCP 协议接入（Eva 已支持）+ 9 agent 分工思路 |
| 4 | [Mem0](https://mem0.dev/blog/blog/state-of-ai-agent-memory-2026) | 独立服务 + 商业 | 事实抽取 + 知识图谱 + 向量索引；52.8K star + $24M 融资 | — | 任意框架 | 与 OpenAI / LangGraph / CrewAI 集成 | 不抄独立服务（违反 §0 #11，引入 Mem0 + 向量库）；抄"fact extraction + entity graph + semantic retrieval"三层结构在 SQLite + FTS5 上实现 |
| 5 | [LangMem](https://gamgee.ai/vs/mem0-vs-langmem/) | LangChain 官方 | Active memory + automated background handlers | — | LangGraph 内 | tightly coupled 到 LangChain | 不抄（强耦合 LangChain，与 Eva spawn CLI 路线冲突）|
| 6 | [Open Interpreter](https://github.com/OpenInterpreter/open-interpreter) | MIT | conversation history | Local desktop | Code interpreter | 单 agent loop | 仅参考语义；Eva 已比 Open Interpreter 在 orchestration 上强 |
| 7 | [Tana](https://tana.inc/) | 商业 SaaS | Supertag（实体类型下放到行级别）| — | — | — | 不抄 SaaS 形态（数据出本机，违反纯个人自用）；抄 supertag 思路应对 §3.2 schema 演化压力 |
| 8 | [Karakeep（前 Hoarder）](https://github.com/karakeep-app/karakeep) | 自托管开源 | Bookmark + RAG | — | 浏览器扩展 | — | 仅参考"个人知识库"形态；与 Eva 不冲突可未来集成 |
| 9 | [Eva (本项目)](../HARNESS_INDEX.md) v0.4.5 + dev | 私有 | harness.db 元数据；retrospective 离散文档（无 fact extraction）| 仅 user prompt + CLI stdout | spawn `claude` CLI | Scheduler 单进程 setInterval | 自身 |

**判断**：Eva 当前形态在 Action（70%）和 Orchestration（60%）已经过半，但 Memory（30%）和 Awareness（10%）短板明显。**短期投资 Memory 性价比最高**（Mem0 benchmark：91% 延迟降 / 90% token 省 / 53→67% 准确率）；**Awareness 短期不投资**（隐私换便利的成本不对称）。

---

## 2. 共识规律（5 篇深读交叉验证）

| 共识 | 出处 | 在 Eva 的对应 |
|---|---|---|
| 长期记忆比扩 context window 性价比高 90% 量级 | [Mem0 benchmark 2026](https://mem0.ai/blog/benchmarked-openai-memory-vs-langmem-vs-memgpt-vs-mem0-for-long-term-memory-here-s-how-they-stacked-up) | Eva 当前没有长期记忆层；retrospective 是离散 markdown 文件，无 fact 抽取无跨 Issue 检索 |
| 主子任务分层 + 子任务读全 trajectory 学习 | [Devin managed Devins 2026](https://www.cognition-labs.com/blog/devin-can-now-manage-devins) | Eva Strategist 当前不读历史 retrospective；新 Issue 分解时无法引用同 domainProfile 的成功 pattern |
| 项目身份必须是第一类公民（在 jarvis 形态下扩到"Subject Domain 身份"）| 沿用 EVA_MULTI_PROJECT_USAGE.md v0.3 共识 | Eva 短期 P0-4a 已加 domain_profile 5 选；长期需扩到非软件 domain |
| 主动性必须有硬上限（防 agent 过度主动 → 用户失去判断主权）| 综合多家观察：Eva 自身风险 R7.2 用户审批疲劳 + Devin auto-execute 用户失控案例 + 心理学"决策疲劳" | Eva 当前没有"主动性预算" — 长期加 jarvis 模式必须前置 |
| 私密信息中心化 = 单 SQLite 文件就是"内在生活的密钥" | 综合 [Mem0 安全实践](https://mem0.ai/blog/long-term-memory-ai-agents) + Eva [docs/AI_ASSESSMENT.md](../AI_ASSESSMENT.md) §安全配置 | Eva 当前无加密；jarvis 形态加 health / finance / family domain 后必须加密 sidecar |
| schema 演化在贾维斯尺度爆炸（13 → 30+ 实体）| Tana supertag 经验 | Eva 当前 13 实体 + M2 加 stage_status_dispatched + failed_reason；jarvis 形态会加 Memory / Routine / KnowledgeNode / HealthEntry / FinanceEntry / IoTState 等 ≥10 个新实体 |

---

## 3. 失败模式清单（6 条贾维斯专属，新增于 EVA_MULTI_PROJECT_USAGE 之外）

| # | 失败模式 | 出处 / 推断 | 缓解（对应 §5 M5-M8 + §6 K-jarvis）|
|---|---|---|---|
| FJ1 | Eva 单点 = 你生活/工作的单点（R-K，比短期 R-G 严重）| EVA_MULTI_PROJECT_USAGE R-G 升级。心理依赖一旦形成，"今天该吃药 / 几点接孩子 / 客户欠款"全押在 harness.db | M5 关键 domain（health/finance/routine）必须有降级查询路径 + harness.db 每周跨设备备份（比短期 P1-3 更严）|
| FJ2 | 知识库 schema 演化压力（13 → 30+ 实体）| EVA_MULTI_PROJECT_USAGE R-L | M6 引入 generic Memory 表 + kind 索引（参考 Tana supertag 思路），不为每类知识开独立表 |
| FJ3 | 注意力反转 — Eva 提示你该做什么 → Eva 替你决定 | 综合 R7.2 + Devin auto-execute 失控案例 | M8 引入"主动性预算"硬上限（每周 push ≤ N 条），iOS 顶栏一键全关回归被动应答态 |
| FJ4 | 私密信息中心化 — 单 SQLite 文件 = 内在生活密钥 | [docs/AI_ASSESSMENT.md §高安全配置](../AI_ASSESSMENT.md) 风险 + jarvis health/finance domain 数据敏感度 | M5 敏感 domain (health/finance) 走 SQLCipher 加密 sidecar DB（与 harness.db 物理分离）；M0 安全配置硬约束（[AI_ASSESSMENT.md](../AI_ASSESSMENT.md) P0 三条）必须先全做完 |
| FJ5 | 集成面爆炸（IoT / 邮件 / 日历 / 财务 / 健康 / 浏览器 / 文件系统）| Awareness 原语自然演化 | M7 通用执行 agent 工具白名单按 domain 分桶 + prod-guard 扩到非软件操作；不强行做全感知（如屏幕 7s OCR）|
| FJ6 | "全能助理"能力边界陷阱（agentic over-reach）| usejarvis.dev "AI That Operates" 倾向 + 经典 agent autonomy 失控 | 所有非软件操作默认 dry-run，真实执行必须经过 Decision approve；prod-guard.mjs 扩到非软件命令（如 calendar:write / mail:send / iot:device.power）|

---

## 4. 对接现有 harness（按 4 原语打分卡）

借 usejarvis.dev 四原语作为打分维度。**Eva 当前形态打分（v0.4.5 + dev）**：

| 原语 | 当前得分 | 缺什么 | 对应 §5 M-X |
|---|---|---|---|
| **Memory** 长期记忆 | 30% | harness.db 存的是元数据（Stage 状态机 / Run / Artifact），不是个人经验记忆。retrospective 是离散 markdown，没有跨 Issue 索引和事实抽取 | M6 个人记忆层（Memory 表 + FTS5 + fact extraction ritual）|
| **Awareness** 环境感知 | 10% | 只感知"用户主动发的 prompt"和"CLI 子进程 stdout"。不感知日历 / 邮件 / 位置 / 健康 / 设备状态 | M8 主动观察层（**严格在 K-jarvis-2 主动性预算约束内**，不做全屏 OCR）|
| **Action** 执行 | 70% | spawn `claude` CLI 已能做绝大部分软件操作；非软件类执行（发通知 / 写日历 / 改 IoT / 查信息）走 MCP 已能补 | M7 通用执行 AgentProfile（按 domain 分桶工具白名单）|
| **Orchestration** 调度 | 60% | Scheduler 已有；per-conversation 路由已有；缺**跨域路由**——一条想法该进哪个 Subject 不会自动判断 | M5 Subject 形态扩展（domain_profile 扩到非软件）+ M6 Strategist 跨 Subject 引用历史 fact |

**关键观察**：Memory + Orchestration 跨域路由是短板。Action 不缺，Awareness 短期不重要（K-jarvis-2 + K-jarvis-4 否决全感知）。

### 现有 schema 的扩展点准备状态

| 扩展点 | 当前状态 | M5+ 目标 | 不可逆度 |
|---|---|---|---|
| `harness_project.domain_profile` | ✅ EVA_MULTI_PROJECT_USAGE v0.3 P0-4a 加 5 选软件类型 enum（已用 K12 跨端 fallback 保护）| 扩到非软件 domain：`knowledge / health / finance / routine / research` 等 | 中（schema-rebuild 改 enum，但 K12 fallback 保护老 iOS）|
| `methodology.applies_to` | ✅ EVA_MULTI_PROJECT_USAGE v0.3 P0-4b 与 domain_profile 同步扩到 5 选 | 同上扩到非软件 domain；每个 domain 有自己的 stage 集合 + agent profile + 方法论模板 | 中（同 0005 schema-rebuild）|
| `Memory` 实体表 | ❌ 不存在 | M6 新加 `memory(id, kind, project_id, payload_json, created_at)` + FTS5 索引 + kind 字段下放（参考 Tana supertag）| 高（新表 + 大量数据写入）|
| `Routine` 实体（提醒 / 日程 / 周期任务）| ❌ 不存在 | M7 新加；与 Memory 共表（kind='routine.*'）或独立 | 中（generic Memory 容纳）|
| 加密 sidecar DB | ❌ 不存在 | M5 health / finance domain 走 SQLCipher | 中（独立文件不影响 harness.db）|
| 主动性预算 server-driven config | ❌ 不存在 | M8 加 `proactivity_budget: { weekly_push_limit, kill_switch }` | 低（server-driven 配置可逆）|
| 跨设备备份 cron | ❌ 不存在 | M5 关键 domain 必须 rsync 到第二台设备 | 低（运维脚本）|

---

## 5. 推荐方案：M5-M8 演进路径（每阶段 outcome-based 退出条件）

按 [docs/HARNESS_ROADMAP.md §0 #13](../HARNESS_ROADMAP.md) 不做日历估算，用准入 + 退出条件推进。M5 → M8 顺序严格不可乱。

### M5 Subject 形态扩展

**核心**：把 L6 形态从"git 仓库"扩到"任意 Subject"；domain_profile enum 扩到非软件 domain。

**准入条件**（必须全满足才能进 M5）：
- ✅ M2 master plan 5 大目标全部 ship
- ✅ M3 + M4 完成（quality + observability + methodology v2）
- ✅ EVA_MULTI_PROJECT_USAGE v0.3 全 P0/P1 落地 + 至少 3 个非 dogfood software project 实测跑通
- ✅ [docs/AI_ASSESSMENT.md §安全配置](../AI_ASSESSMENT.md) 三条 P0 全做完（fail-closed permission + safe startup + WS payload limit）

**核心动作**：
- 0006 schema-rebuild migration v300：`harness_project.domain_profile` enum 扩到 ≥ 8 选（含 `knowledge / health / finance / routine` 等非软件 domain）
- 0006 同步：`methodology.applies_to` enum 同样扩展（与 domain_profile 对齐）
- 每个新 domain 配套：(a) Stage kind 集合（与软件 SDLC 10 stage 不同）、(b) AgentProfile 集合、(c) 方法论模板、(d) 工具白名单
- iOS server-driven schema 加 domain-specific UI hints（如 health domain 显示血压 / 体重 input 模板）
- K12 跨端 enum graceful fallback 已就位（v0.3 K12），新 enum 值老 iOS 不破

**不做**：
- 不引入 generic Memory 表（M6 范围）
- 不引入主动观察层（M8 范围）
- 不接 IoT / 邮件 / 日历集成（M7 范围）

**退出条件**（all of）：
- 0006 migration 跑通 + harness-store 测试全绿
- 至少 1 个 `knowledge` domain Subject 实测：从想法 → spec（按 knowledge 模板）→ 多 stage 推进 → retrospective 全链路跑通
- 至少 1 个 `routine` domain Subject 实测：每天 push 1 条提醒 + 你回复 + 落 Memory 表（由 M6 才真做，M5 占位用 retrospective）
- 老 iOS 装包看到新 domain enum 不崩（K12 fallback 验证）

### M6 个人记忆层（fact extraction + knowledge graph）

**核心**：在 SQLite + FTS5 上实现"事实抽取 + 实体图 + 语义检索"三层结构（Mem0 思路抄机制不抄实现）。

**准入条件**：
- ✅ M5 完成（至少 1 个非软件 Subject 跑通）
- ✅ 至少 100 条 retrospective 入库（作为 fact extraction 的训练 / 调试样本）

**核心动作**：
- 0007 additive migration v301：新加 `memory(id, kind, project_id, payload_json, created_at, expires_at?, importance: 0..1)` 表 + FTS5 索引
  - `kind` 是字符串（不是 enum），按 dot-namespace 分类：`fact.user-preference / fact.health.baseline / decision.health.alert / pattern.coder.success / pattern.reviewer.anti-pattern` 等
  - kind 设计参考 [Tana supertag](https://tana.inc/)：实体类型下放到行级别，避免每加一类知识就开一张表（防 §3 FJ2 schema 爆炸）
- 加 `fact-extractor` 这个 ritual stage（轻量 stage，每次 retrospective 落库时自动跑）
  - 输入：retrospective.md
  - 输出：N 条 `fact.*` 行入 Memory 表
  - LLM 用 Sonnet（事实抽取 ≠ 创造，不需要 Opus）
- Strategist agent 在新 Issue 分解时**主动检索 Memory** 引用同 domainProfile 的成功 fact / 失败 anti-pattern
  - SQL 模板：`SELECT * FROM memory_fts WHERE memory_fts MATCH ? AND project_id IN (...) AND kind LIKE 'fact.%' ORDER BY importance DESC LIMIT 20`

**不做**：
- 不引入向量数据库（违反 §0 #11；FTS5 + 关键字检索 + LLM rerank 个人自用足够）
- 不引入 RAG（同上，FTS5 直接 inject 进 ContextBundle 即可）
- 不引入 Knowledge Graph 三元组（M7+ 视情况，先看 fact + kind dot-namespace 是否够用）

**退出条件**：
- Memory 表实体数 ≥ 500 行 fact（M5 累积的 retrospective 跑完 fact-extractor 后）
- Strategist agent 引用 Memory fact 的覆盖率：在新 Issue spec 里 ≥ 1 条 fact reference 的比例 ≥ 30%
- Mem0 benchmark 类比指标：跨 Issue 检索 p95 < 2s + 准确率（人工评 fact 是否真相关）≥ 60%

### M7 通用执行 agent + 非软件操作 sandbox

**核心**：加 `assistant-general` AgentProfile + 工具白名单扩到非软件操作。

**准入条件**：
- ✅ M6 完成（Memory 表跑起来）
- ✅ FJ4 加密 sidecar 完成（health / finance domain 数据加密落库）
- ✅ FJ6 prod-guard 扩展完成（命令黑名单加 calendar:write / mail:send / iot:device.power 等）

**核心动作**：
- AgentProfile 加：
  - `routine-executor`（轻量，跑日程提醒 / 周报汇总）
  - `health-coach` / `health-logger` / `health-reviewer`（health domain 三角色）
  - `finance-recorder` / `finance-reconciler`（finance domain 双角色）
  - `knowledge-curator`（知识库整理）
- 工具白名单按 domain 分桶（不同 domain 的 agent 不能用别 domain 的工具）：
  - health agent 不能调 finance API
  - routine agent 不能改代码文件
- 新加 MCP server 接入：`calendar` / `mail` / `iot` / `health-export`（用 MCP 协议保持 §0 #2 + §0 #11 不变）
- 所有非软件操作默认 dry-run，真实执行必须经过 Decision approve（参考 FJ6 + 短期 P0-2 prod-guard 设计）

**不做**：
- 不引入主动观察层（M8 范围）
- 不接外部 SaaS（pgsql / Sentry / Datadog 等违反纯个人自用）
- 不开屏幕全感知（FJ4 + K-jarvis-4 否决）

**退出条件**：
- 跑通 1 个 `routine` domain Subject：每周自动汇总过去 7 天 Memory 内 fact + 推送给你 + 你回复后入 Memory
- 跑通 1 个 `health` domain Subject：daily-log 录入血压 / 体重 + 每周 review 对比 baseline + 异常预警走 Decision

### M8 主动观察层（**严格在主动性预算约束内**）

**核心**：在 K-jarvis-2 主动性预算硬上限 + K-jarvis-3 一键全关开关约束下，加被动观察 + 主动建议层。

**准入条件**：
- ✅ M7 完成
- ✅ K-jarvis-2 主动性预算硬上限（如 ≤ 7 条 push / 周）实现且 server-driven 可调
- ✅ K-jarvis-3 一键全关开关 iOS 上线
- ✅ 至少 4 周 M7 dogfood 期间 K-jarvis-2 没被违反（push 数从未超限）

**核心动作**：
- Observer agent（Haiku，按 cron 跑）扫描 Memory 表 + 外部信号（calendar / mail / health 数据），主动 emit 建议
- 建议进入 push queue，受 K-jarvis-2 周预算限制
- 用户 acceptance rate（点 approve / dismiss）落 telemetry，喂给 K-jarvis-1 注意力反转检测
- iOS 顶栏增加"主动性开关"，可一键全关回归被动应答态

**不做**：
- 不开屏幕 OCR / 全感知（FJ4 + K-jarvis-4 永久否决）
- 不允许 agent 自动执行不可逆操作（即使在主动性预算内，所有真实执行仍走 Decision approve）

**退出条件**：
- 一周内主动 push ≤ 7 条建议
- 用户 acceptance rate ≥ 50%（健康度判断；过低 = 噪音过多需要回 M8 调，过高 = 可能注意力反转风险）
- K-jarvis-3 一键全关测试：开关关闭后 Observer agent 不再 emit push

---

## 6. 关键不变量（K-jarvis 系列，4 条 jarvis 专属）

> **沿用所有现有不变量**（K1-K12 from EVA_MULTI_PROJECT_USAGE v0.3 + K13-K22 from HARNESS_ROADMAP.md §0）。本段只列**贾维斯形态新增**的 4 条。

| # | 不变量 | 防什么失败 |
|---|---|---|
| **K-jarvis-1** | **主动性预算硬上限** — Eva 主动 push 给用户的建议数量按周设硬上限（如 ≤ 7 条 / 周），超额必须排队；用户 acceptance rate 持续 < 30% 触发 ritual 调整或自动回 M7 调 prompt | FJ3 注意力反转 |
| **K-jarvis-2** | **关键决策必须 Decision approve** — 财务支出 ≥ 阈值 / 健康用药 / 重要回复 / 任何不可逆非软件操作（calendar/mail/iot 写）永远只能"建议 + 用户拍板"，agent 不允许有 auto-execute 路径 | FJ3 + FJ6 agentic over-reach |
| **K-jarvis-3** | **一键全关开关** — iOS 顶栏增加 kill switch，可一键全关 Observer / 主动 push / 跨 domain 跨 Subject 引用，回归纯被动应答态（degrade to v0.4.5 形态） | FJ1 单点 + FJ3 注意力反转 |
| **K-jarvis-4** | **不做全屏感知** — 永久否决"屏幕 OCR / activity tracking / 永久后台监听"等高隐私换便利的 Awareness 路径（usejarvis.dev 7s OCR 路径不抄）；Awareness 仅限：用户主动喂的输入 + Subject 内显式 fetch 的外部信号（calendar API / mail IMAP / health export 等用户主动授权的数据源）| FJ4 私密信息中心化 + FJ5 集成面爆炸 |

---

## 7. 与现有 IDEAS / RISKS / ROADMAP 的合并建议

### 7.1 在 [docs/HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md) 新增

- 新加 §6.5 / §7 段："M5-M8 长期路线（贾维斯形态）"，包含 M5 Subject 形态扩展 / M6 个人记忆层 / M7 通用执行 agent / M8 主动观察层 + 准入/退出条件
- §0 加新原则 #24 主动性预算（K-jarvis-1）+ #25 一键全关开关（K-jarvis-3）+ #26 不做全屏感知（K-jarvis-4）

### 7.2 在 [docs/HARNESS_RISKS.md](../HARNESS_RISKS.md) 新增

加 §11 "贾维斯形态风险（M5+）"组，含 6 条 RJ.1-RJ.6 对应 FJ1-FJ6（沿用 §8 多项目使用风险的命名约定）。

### 7.3 在 [docs/HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md) 新增

- §1.14 / §1.15 加 Memory + Routine 实体的**预留扩展点**说明（不立即落 schema，等 M6 / M7 启动时再走 contract mode）
- §2.5 K12 跨端 enum fallback contract 段加 jarvis domain_profile enum 扩展示例

### 7.4 在 [docs/HARNESS_LANDSCAPE.md](../HARNESS_LANDSCAPE.md) 新增

加 §6 "贾维斯方向竞品全景"，含表 1 §1 业界 9 个项目对比 + 战略含义（哪些必抄思路 / 哪些必躲）。

### 7.5 在 [docs/HARNESS_INDEX.md](../HARNESS_INDEX.md) 新增

加 EVA_AS_PERSONAL_JARVIS.md 入口 + 在跨文档关键约束段加 "K-jarvis 4 条不变量"。

### 7.6 在 [docs/IDEAS.md](../IDEAS.md) 新增

加 J1-J8 8 条 jarvis 长期演进条目（对应 M5-M8 各核心动作）。

---

## 8. 待用户拍板的决策（≤3 条，硬约束满足）

按 [`harness-review-workflow` SKILL.md](../../.claude/skills/harness-review-workflow/SKILL.md) L309-317 真正需要用户偏好的事项。

### J1: M-1 数据模型是否预留 Memory 表与扩展 domainProfile 字段？

**背景**：本 proposal 核心建议"M-1 数据模型应当预留 jarvis 扩展点"。但实际**预留方式**有两种：

| ID | 选项 | author 倾向 | 不可逆度 |
|---|---|---|---|
| J1-A | 仅在文档预留（[HARNESS_DATA_MODEL.md §1.14/§1.15](../HARNESS_DATA_MODEL.md) 写"M6 / M7 启动时新加 Memory / Routine 表"占位说明），M2 / M3 / M4 期间不动 schema | **强推荐** | 低（可逆，未来仍可改）|
| J1-B | 在 0008 migration 现在就 additive 加 `memory` / `routine` 空表（schema 预先存在但代码不写不读），M5+ 启动时才用 | 谨慎 | 中（提前固化未知 schema 的字段名 / 索引设计）|
| J1-C | 引入 schemaless 思路：harness.db 加 `extension_table(id, namespace, payload_json)` 通用扩展槽，未来所有新实体都进这一张表 | 不推荐 | 中（schemaless 等于放弃 SQL 约束）|

**author 倾向 J1-A 理由**：M-1 / M2 当前是 software-engineer harness 的最稳形态；提前加未来表会引入读不读 / 写不写的复杂性。J1-A 的"文档预留 + ADR-0010-M5 占位"既锁定方向又不固化细节。等 M6 真启动时由 contract mode + ADR-lite 决定 schema 细节。

### J2: 主动性预算硬上限的具体数值？

**背景**：K-jarvis-1 + M8 启动时设 weekly push 上限。

| ID | 选项 | 含义 | 影响 |
|---|---|---|---|
| J2-A | 严格：≤ 3 条 / 周 | 极少打扰，主要靠用户主动问 | 主动性几乎为 0；适合保守用户 |
| J2-B | 适中：≤ 7 条 / 周（约每天 1 条）| 每天最多 1 个建议，量级可控 | **author 推荐**；接近 §16 进化体系自动 retrospective 频率 |
| J2-C | 宽松：≤ 21 条 / 周（约每天 3 条）| 较多互动，接近"日常助理" | 风险更高，需更严格 acceptance rate 阈值 |
| J2-D | server-driven 可调，启动时由用户在 iOS settings 选 | 允许用户随时调，更灵活 | 实现成本最低；author 也推荐与 J2-B 组合（默认 7，可调）|

**author 倾向 J2-B + J2-D 组合**：默认 7 条 / 周（接近每天 1 条），server-driven 可调。

### J3: 健康 / 财务等敏感 domain 数据是否引入加密 sidecar DB？

**背景**：FJ4 + K-jarvis-4。M5 health / finance domain 数据敏感度远高于软件工程 metadata。

| ID | 选项 | 含义 | 影响 |
|---|---|---|---|
| J3-A | 引入 SQLCipher 加密 sidecar DB（health.db / finance.db），与 harness.db 物理分离 | 加密强度高，但需 SQLCipher npm 包（is it within §0 #11？）| author 推荐——SQLCipher 是 SQLite 加密扩展，本质仍是 SQLite，不算引入新基础组件 |
| J3-B | 不引入加密，但敏感字段 application-level encrypt 后存入 harness.db（如 AES-256-GCM 用 Node crypto）| 不引入新依赖；但密钥管理更复杂 | 风险中等 |
| J3-C | 不引入任何加密，依赖 macOS FileVault 全盘加密 | 实施最简；但被远程访问时仍裸露 | 仅当全盘加密 + Tailscale 内网假设成立时 OK |

**author 倾向 J3-A 理由**：SQLCipher 是 SQLite 标准扩展，与"不引入新基础组件"原则不冲突；密钥管理用 macOS Keychain（已有，不引入新组件）；与短期 P2-3 .env.harness 加密备份策略对称。

---

## 9. 关键 Open Questions（评审时挑战）

留给 phase 1 reviewer 挑战的开放问题：

- **OQ1**：M5-M8 演进顺序是否严格不可乱？理论上 M7 通用执行 agent 可以在 M6 个人记忆层之前做（agent 不读历史 fact 也能跑），但 author 排 M6 在前是因为"agent 主动决策必须基于历史经验"。是否有更优排序？
- **OQ2**：J1 Memory 表设计 `(kind, payload_json)` schemaless 风险：kind 字符串无 CHECK 约束，未来可能出现 kind 命名漂移（fact.health vs fact.health.bp）。是否需要 kind 字典表？
- **OQ3**：K-jarvis-3 一键全关开关的"全关"边界：关闭 Observer 后，Strategist 是否还能引用 Memory？author 倾向是 "Observer / 主动 push 关，但 Memory 检索保留"，但用户可能希望"完全 degrade 到 v0.4.5 形态"。
- **OQ4**：FJ5 集成面爆炸——iCloud / Apple Health / Google Calendar / Gmail / 电信运营商 API / 银行 API 等接入路径，每条都是一次 SDK / OAuth / API quota 决策。是否需要在 M7 加一层"集成层抽象"避免每个 integration 散落实现？
- **OQ5**：跨设备备份（FJ1 缓解）"每周 rsync 到第二台设备"的"第二台设备"怎么定义？iPad？另一台 Mac？远程 NAS？每个选择都有权衡（成本 / 同步频率 / 加密 / 隐私）。
- **OQ6**：本 proposal §1 表 1 把 Eva 与 9 个项目对比，但是否漏了：(a) Khoj（开源 second brain assistant）；(b) Reflect / Logseq / Obsidian + LLM 插件；(c) Rhasspy / Mycroft（已停）等 voice-first jarvis？

---

## 10. Phase 2/3 评审 skip 原因

**不 skip**——本 proposal 不可逆度高（影响 M-1 数据模型扩展点 + 长期路线方向 + Eva 项目身份扩展），必须走完整 phase 1+2+3。

- Trigger check: 涉及 M5-M8 路线方向决策（4 个里程碑）+ K-jarvis 4 条新不变量 + FJ1-FJ6 6 条新风险 + 3 条用户决定（J1/J2/J3 均涉及 M-1 数据模型 / iOS thin shell 长期约束）
- Decision: **跑 phase 1 + phase 2 + phase 3，不 skip**
- Why: 决策影响 M-1 数据模型 schema 扩展点预留 + iOS 协议长期演化 + 项目身份定位
- Escalate condition: 如果 phase 1 任一 reviewer 提出 BLOCKER 否定 K-jarvis-1 / J1-A / M5-M8 顺序之一，phase 2 必须重点 cross-pollinate；phase 3 author 仲裁 ≥ 3 条用户决定时回 phase 2

---

## 11. 引用源

外部参照（按出现顺序）：

- [usejarvis.dev — Personal AI assistant runtime](https://www.usejarvis.dev/)
- [hyhmrright/JARVIS — Self-hosted AI OS v0.8.0](https://github.com/hyhmrright/JARVIS)
- [Turbo31150/jarvis-core — JARVIS Core v10.1](https://github.com/Turbo31150/jarvis-core)
- [Mem0 — State of AI Agent Memory 2026](https://mem0.dev/blog/blog/state-of-ai-agent-memory-2026)
- [Mem0 vs LangMem benchmark](https://mem0.ai/blog/benchmarked-openai-memory-vs-langmem-vs-memgpt-vs-mem0-for-long-term-memory-here-s-how-they-stacked-up)
- [Mem0 long-term memory architecture](https://mem0.ai/blog/long-term-memory-ai-agents)
- [Mem0 vs LangMem comparison (Gamgee)](https://gamgee.ai/vs/mem0-vs-langmem/)
- [Devin 2026 — Cognition managed Devins](https://www.cognition-labs.com/blog/devin-can-now-manage-devins)
- [Devin 2026 release notes](https://docs.devin.ai/release-notes/2026)
- [Tana — Supertag 实体类型下放到行级别](https://tana.inc/)
- [Karakeep (前 Hoarder) — 个人知识库自托管](https://github.com/karakeep-app/karakeep)
- [Open Interpreter — local code interpreter](https://github.com/OpenInterpreter/open-interpreter)
- [SQLCipher — SQLite encryption extension](https://www.zetetic.net/sqlcipher/)

内部 Eva 文档引用：

- [docs/proposals/EVA_MULTI_PROJECT_USAGE.md](EVA_MULTI_PROJECT_USAGE.md) — 短期相变 v0.3 final（配套 proposal）
- [docs/HARNESS_ARCHITECTURE.md](../HARNESS_ARCHITECTURE.md) — L6 Subject Project 段
- [docs/HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md) — §1.1 / §1.6 / §2.5（v0.3 已扩展）
- [docs/HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md) — §0 #1-23 不变量
- [docs/HARNESS_RISKS.md](../HARNESS_RISKS.md) — §8 多项目使用风险（v0.3 已加 R8.x）
- [docs/HARNESS_LANDSCAPE.md](../HARNESS_LANDSCAPE.md) — 现有 §1-§5 竞品分析
- [docs/HARNESS_INDEX.md](../HARNESS_INDEX.md) — 文件总入口
- [docs/IDEAS.md](../IDEAS.md) — H 段（H18 Provider Runtime + H19-H26 多项目使用 v0.3 已加）
- [docs/AI_ASSESSMENT.md](../AI_ASSESSMENT.md) — §安全配置 P0 三条（M5 准入条件之一）
- [.claude/skills/harness-review-workflow/SKILL.md](../../.claude/skills/harness-review-workflow/SKILL.md) — phase 1+2+3 评审编排
- [.claude/skills/reviewer-cross/SKILL.md](../../.claude/skills/reviewer-cross/SKILL.md) — cross lens
- [.claude/skills/harness-architecture-review/SKILL.md](../../.claude/skills/harness-architecture-review/SKILL.md) — arch lens
