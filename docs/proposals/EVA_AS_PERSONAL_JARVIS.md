# Eva 演化为私人贾维斯 — 长期愿景 proposal v0.3 (round 2 修复后 final)

> **Status**: ✅ **用户拍板 + author 仲裁 + round 2 cross-check 修复后 final** · **Date**: 2026-05-06 · **Author**: Claude Sonnet 4.6
> **Review depth**: Phase 1+2+3 完整三相评审完成（[arch verdict](../reviews/eva-as-personal-jarvis-arch-2026-05-06-0042.md) + [cross verdict](../reviews/eva-as-personal-jarvis-cross-2026-05-06-0042.md) + [react-arch](../reviews/eva-as-personal-jarvis-react-arch-2026-05-06-0050.md) + [react-cross](../reviews/eva-as-personal-jarvis-react-cross-2026-05-06-0050.md) + [arbitration log](../reviews/eva-as-personal-jarvis-arbitration-2026-05-06.md)）
> **不可逆度**: **高** — 真"高"。M5-M8 顺序重排（v0.1 v0.2 不同）+ 加 K-jarvis-5/6/7 三条新不变量 + 新加 5 条 FJ7-FJ11 失败模式 + Stage 模型分层（jarvis Subject 走 Memory + Decision 不走 Stage 流水线）+ Memory kind 走 registry 中间路径 + 加密走 J3-B Node crypto。这些决策一旦合入 docs / M-1 数据模型扩展点预留就长期生效，错过预留窗口 M5 启动时补 schema 的代价 = 反向迁移 + 老数据 backfill + iOS 协议 break，远高于现在 author + reviewer 多花的时间
> **范围边界**：本 proposal 是**方向性 / 长期路线图**，不是即将做的 spec。具体 schema 改动每条到 M5+ 启动时再走 contract mode + ADR-lite。本 proposal 只锁定**扩展点应当预留**这个原则
> **配套 proposal**：[EVA_MULTI_PROJECT_USAGE.md v0.3 final](EVA_MULTI_PROJECT_USAGE.md)（短期相变，2026-05-05 用户拍板收敛）。本 proposal 是其延伸：短期是"用 Eva 做工程项目"的相变，长期是"Eva 不只做软件工程"的相变
> **v0.1 → v0.2 收敛信号**：5 BLOCKER 双向 + 1 cross 自我升级 + 1 cross 自我新加 = 7 BLOCKER 全部仲裁吸收 + 13 MAJOR + 5 风险遗漏 + 6 OQ + 3 MINOR + 4 new-finding 全分类 + 3 用户决定（U-J1/U-J2/U-J3 全 = author 推荐）。**0 双向 disagree 硬冲突**。详见 [arbitration log](../reviews/eva-as-personal-jarvis-arbitration-2026-05-06.md)
> **Round 2 lightweight cross-check 完成**（[round 2 verdict](../reviews/eva-as-personal-jarvis-round2-cross-2026-05-06-0100.md)）：抓到 2 BLOCKER (F1+F3 同根) + 3 DRIFT (F2/F4/F5)。v0.2 → v0.3 修复完成：(a) memory + decision schema 扩展前置到 M5 末（M7a 可直接用）；(b) memory_kind_registry 加 `tier` 字段消歧；(c) decision schema 扩展（stage_id nullable + project_id NOT NULL + source_ref_*）；(d) K-jarvis-5/6 落地契约补全；(e) K-jarvis-7 不暗示现有 backend 已支持。0 finding 需要 escalate 完整 round 2 → **v0.3 = final**

---

## 0. Context

用户在第 4 轮对话明确长期愿景："**eva 可以创建多个系统，创建出来系统独立运行，这些系统都是我使用，工程过程和思想留在 eva 中。后期 eva 逐渐演化成能帮我做任何的事情私人助理，不是别人的，是我的贾维斯。**"

身份漂移：

- 第 3 波（任务型 agent，2024-）：Devin / Cursor BG / OpenHands / Eva 当前
- 第 4 波（私人贾维斯，2026 年正在成型）：Eva 长期形态 — 主动陪伴 + 长期记忆 + 跨域调度 + 不只软件工程

**核心识别**：harness 不是 Eva 的终态，是 Eva 长出贾维斯之前必须先长出来的腿。先在最熟悉、最能可控验证的领域（软件工程，dogfood 自己）把"调度 + 评审 + 方法论 + 进化"跑通；然后**把这套骨架的领域假设松开**——并且**承认有些 domain 不适用 Stage 流水线模型**，让它能管别的事。

**用户拍板的硬约束**（沿用 EVA_MULTI_PROJECT_USAGE.md v0.3 + 第 4 轮新增）：

- 纯个人自用：永不分发、永不商业化、不团队化（沿用 [docs/HARNESS_INDEX.md §跨文档关键约束 #5](../HARNESS_INDEX.md)）
- 不引入新基础组件：保留 [docs/HARNESS_ROADMAP.md §0 #11](../HARNESS_ROADMAP.md)
- 不调用 SDK（§0 #2）
- 不抄 Devin VM 隔离 / Kelos K8s / OpenHands 自建 runtime（违反 §0 #11 / #2 / #3）
- iOS thin shell（§0 #1，K4）
- 工程过程和思想留在 Eva 中
- 不强行做"屏幕全感知"
- **U-J1-B 用户拍板**：Memory kind 走 registry 中间路径（核心 kind CHECK enum + 扩展 kind registry 外键）
- **U-J2-B 用户拍板**：加密走 J3-B Node crypto application-level（passphrase 跨设备共用，不引入 SQLCipher）
- **U-J3-C author 默认**（用户略过询问视为 defer to author）：jarvis Subject 分层——software/knowledge 走 Stage 流水线，routine/health/finance 走 Memory + Decision 直驱

本 proposal 的目标：在 M2 期间 schema 还在动的窗口内，把"M-1 数据模型应当预留 jarvis 扩展点 + 两套抽象分层"这一原则锁定，避免 M5 启动时补 schema 的天文级代价。

---

## 1. 业界 N 种典型架构（从轻到重，按"四原语"打分）

借 [usejarvis.dev](https://www.usejarvis.dev/) 的四原语分类（Memory / Awareness / Action / Orchestration）作为评估框架。

> **4 原语百分比按 §4 操作化定义**（v0.1 vibes 打分推翻，v0.2 加操作化）

| # | 项目 | License | Memory | Awareness | Action | Orchestration | 与 Eva 关系 |
|---|---|---|---|---|---|---|---|
| 1 | [hyhmrright/JARVIS](https://github.com/hyhmrright/JARVIS) | 自托管 | RAG + Qdrant | 多 channel 监听 | 多 LLM failover + supervisor | Visual Workflow Studio | 抄 supervisor + expert agent 思路；不抄 Qdrant + docker compose（违反 §0 #11） |
| 2 | [usejarvis.dev](https://www.usejarvis.dev/) | 商业 | Persistent semantic + entity graphs + fact extraction | 7s OCR + activity tracking | Browser/desktop/terminal/voice | Multi-machine WS + JWT | 抄 4 原语分类作打分卡；不抄 OCR（隐私不可接受 K-jarvis-4）+ 多机 JWT（违反 §0 #11） |
| 3 | [JARVIS Core](https://github.com/Turbo31150/jarvis-core) | 自托管 | 26 modules | 9 specialized agents | MCP 协议 | 任务路由 + multi-agent | 抄 MCP 协议 + 9 agent 分工；不抄 26 模块过细 |
| 4 | [Mem0](https://mem0.dev/blog/blog/state-of-ai-agent-memory-2026) | 独立服务 + 商业 | fact extraction + entity graph + 向量 | — | 多框架 | OpenAI/LangGraph/CrewAI 集成 | 抄"fact extraction + entity graph + semantic retrieval"三层结构在 SQLite + FTS5 实现；不抄独立服务 + Qdrant |
| 5 | [LangMem](https://gamgee.ai/vs/mem0-vs-langmem/) | LangChain 官方 | Active + automated background | — | LangGraph 内 | 强耦合 LangChain | 不抄（与 Eva spawn CLI 路线冲突） |
| 6 | [Open Interpreter](https://github.com/OpenInterpreter/open-interpreter) | MIT | conversation history | Local desktop | Code interpreter | 单 agent loop | 仅参考；Eva 已比它在 orchestration 上强 |
| 7 | [Tana](https://tana.inc/) | 商业 SaaS | Supertag | — | — | — | 抄 supertag 思路应对 schema 演化压力（但 v0.2 U-J1-B 走 registry 中间路径而非纯 schemaless） |
| 8 | [Karakeep（前 Hoarder）](https://github.com/karakeep-app/karakeep) | 自托管 | Bookmark + RAG | — | 浏览器扩展 | — | 仅参考"个人知识库"形态；不冲突，未来可集成 |
| **9** | **[Khoj](https://github.com/khoj-ai/khoj)**（v0.2 新加 OQ6）| Apache 2.0 (27K star) | semantic search + chat | — | 浏览器扩展 | semantic chat | **build-vs-adopt 核心对照系**（详见 §4.5） |
| 10 | [Eva (本项目)](../HARNESS_INDEX.md) v0.4.5 + dev | 私有 | harness.db 元数据；retrospective 离散文档（无 fact extraction） | 仅 user prompt + CLI stdout | spawn `claude` CLI | Scheduler 单进程 setInterval | 自身 |

**判断**：Eva 当前形态在 Action 和 Orchestration 已经过半，但 Memory 和 Awareness 短板明显。**短期投资 Memory 性价比最高**；**Awareness 短期不投资**。

---

## 2. 共识规律（5 篇深读交叉验证）

| 共识 | 出处 | 在 Eva 的对应 |
|---|---|---|
| 长期记忆比扩 context window 性价比高 90% 量级 | Mem0 benchmark 2026 | Eva 当前没有长期记忆层；retrospective 是离散 markdown |
| 主子任务分层 + 子任务读全 trajectory 学习 | Devin managed Devins 2026 | Eva Strategist 当前不读历史 retrospective |
| 项目身份必须是第一类公民 | EVA_MULTI_PROJECT_USAGE v0.3 | Eva 短期 P0-4a 已加 domain_profile 5 选 |
| 主动性必须有硬上限（防 agent 过度主动）| 综合多家观察 | Eva 当前没有"主动性预算"——长期加 jarvis 模式必须前置 |
| 私密信息中心化 = 单 SQLite 文件就是密钥 | 综合 Mem0 安全实践 + AI_ASSESSMENT.md | jarvis 形态加 health / finance / family domain 后必须加密 sidecar（v0.2 走 J3-B Node crypto）|
| schema 演化在贾维斯尺度爆炸（13 → 30+ 实体）| Tana supertag 经验 | Eva 当前 13 实体 + M2 加；jarvis 形态加 Memory / Routine / KnowledgeNode 等 |
| **不同 domain 本质不同：一次性目标 vs 高频小事件**（v0.2 新加共识）| GitHub Issues vs Discussions / Linear Issue vs Inbox / Notion Database vs Page | jarvis Subject 必须分层（U-J3-C）：software/knowledge 走 Stage 流水线，routine/health/finance 走 Memory + Decision 直驱 |

---

## 3. 失败模式清单（**v0.1 6 → v0.2 11 条**，含 phase 2 揭示的 5 条新盲区）

| # | 失败模式 | 出处 / 推断 | 缓解（对应 §5 M5-M8 + §6 K-jarvis）|
|---|---|---|---|
| FJ1 | Eva 单点 = 你生活/工作的单点（R-K，比短期 R-G 严重）| 短期 R-G 升级 | M5 关键 domain（health/finance/routine）必须有降级查询路径 + harness.db 每周跨设备备份 |
| FJ2 | 知识库 schema 演化压力（13 → 30+ 实体）| Tana supertag 经验 | M6 引入 memory_kind_registry 中间路径（U-J1-B），不为每类知识开独立表 |
| FJ3 | 注意力反转 — Eva 提示你该做什么 → Eva 替你决定 | 综合 R7.2 + Devin auto-execute 失控案例 | M8 引入"主动性预算"硬上限（K-jarvis-1），iOS 顶栏一键全关回归被动应答态（K-jarvis-3 + K-jarvis-7）|
| FJ4 | 私密信息中心化 — 单 SQLite 文件 = 内在生活密钥 | AI_ASSESSMENT.md + jarvis health/finance domain 数据敏感度 | M5 敏感 domain (health/finance) 走 J3-B Node crypto application-level 加密；M0 安全配置硬约束（AI_ASSESSMENT P0 三条）必须先全做完 |
| FJ5 | 集成面爆炸（IoT / 邮件 / 日历 / 财务 / 健康 / 浏览器 / 文件系统）| Awareness 原语自然演化 | M7a 前置 Integration 抽象 contract（OQ4）—— 所有 MCP server 走统一注册 |
| FJ6 | "全能助理"能力边界陷阱（agentic over-reach）| usejarvis.dev "AI That Operates" 倾向 | 所有非软件操作默认 dry-run，真实执行必须 Decision approve（K-jarvis-2 + K-jarvis-6 分级）|
| **FJ7** | **Memory 数据污染传播**（fact-extractor 抽错 fact → Strategist 引用 → 写错 spec → retrospective 再次抽取 = 错误循环）| arch react phase 2 揭示 | M6 退出加 fact 准确率人工抽查 + provenance + low-confidence quarantine 隔离区 + 撤销机制 |
| **FJ8** | **Claude CLI 单点供应商风险升级**（jarvis 比 software harness 更依赖 Claude 可用性）| arch react phase 2 揭示 | 先定义 degraded mode（K-jarvis-7 read-only 查询不跑 agent），provider fallback 作为 M8+ OQ7（不强制 K-jarvis-5 不变量）|
| **FJ9** | **加密密钥丢失 = health/finance 数据永久不可恢复** | arch react phase 2 揭示 + cross react agree | 缓解与 J3-B 选项绑定：Node crypto + passphrase 备份 ritual（passphrase 写在密码管理器 + USB 二备份 + 月度演练）|
| **FJ10** | **K-jarvis-2 Decision approve 与 R7.2 用户审批疲劳冲突**（"重要"边界没定）| arch react phase 2 揭示 + cross react agree | K-jarvis-6 Decision form 分级（trivial 自动 approve / minor 默认 approve 可撤销 / major 必须 approve），与 §0 #22 fast-path 同源 |
| **FJ11** | **Eva 故障 = 用户生活停摆**（备份恢复 ≠ 服务可用）| arch react phase 2 揭示 + cross react agree | K-jarvis-7 read-only degraded mode（iPad + Tailscale 直接读 read-only harness.db 副本，不跑 backend）|

---

## 4. 对接现有 harness（按 4 原语打分卡）

### 4.1 4 原语操作化定义（v0.2 新加，回应 MAJ-1）

每原语用 3-5 个**可观察能力**操作化定义，避免 vibes 打分。

#### Memory（长期记忆）

可观察能力：
- M-a 存储事实抽取的能力（自动从 retrospective 抽 fact）
- M-b 跨实体语义检索（按主题/关键字检索 fact，不只按 ID）
- M-c 时序推理（"上次发生这种情况是什么时候")
- M-d 实体图（fact 之间的关联）
- M-e 重要性排序（哪条 fact 更值得 retain）

**Eva 当前**：M-a 无 / M-b 无（FTS5 在 Issue/Artifact 上有，未在 Memory 上） / M-c 无 / M-d 无 / M-e 无 → 0/5 = 0% （v0.1 vibes "30%" 推翻）

#### Awareness（环境感知）

可观察能力：
- A-a 用户主动输入（prompt / Inbox）
- A-b CLI subprocess 输出
- A-c 系统事件（calendar / mail / iot 等外部信号）
- A-d 时序触发（cron / schedule）
- A-e 屏幕 / activity tracking（**永久否决，K-jarvis-4**）

**Eva 当前**：A-a 有 / A-b 有 / A-c 无 / A-d 无（仅 launchd 后端进程级，无 Subject 级 cron） / A-e 永不做 → 2/4 = 50%（A-e 不计入分母，因永久否决）

#### Action（执行）

可观察能力：
- Ac-a 软件命令（git / pnpm / vitest）
- Ac-b MCP 工具调用
- Ac-c 文件读写
- Ac-d 网络请求（agent 调用外部 API）
- Ac-e 非软件操作（calendar:write / mail:send / iot:device.power）

**Eva 当前**：Ac-a 有 / Ac-b 有 / Ac-c 有 / Ac-d 有（通过 MCP）/ Ac-e 无 → 4/5 = 80%（v0.1 vibes "70%" 修正）

#### Orchestration（调度）

可观察能力：
- O-a Stage 状态机（Issue → Stage → Task → Run）
- O-b 多 agent 协调（不同 agent 角色 spawn）
- O-c 评审矩阵（多 reviewer 独立打分）
- O-d 跨 Subject 路由（Inbox 自动路由到对应 Subject）
- O-e 主动性触发（Observer agent 主动 emit）

**Eva 当前**：O-a 有 / O-b 有 / O-c 有 / O-d 无 / O-e 无 → 3/5 = 60%

### 4.2 v0.3 implementation tracking（v0.2 新加，回应 MAJ-11）

§4.3 表格状态 ✅ → ⏳ 是因为 v0.3 短期 proposal 是 doc-only，**migration 代码尚未落地**：

| v0.3 决议 | docs 状态 | 代码状态 |
|---|---|---|
| 0004 additive migration (harness_project.domain_profile) | ✅ 已 sync HARNESS_DATA_MODEL.md §1.1 | ⏳ 未实施 |
| 0005 schema-rebuild migration (methodology.applies_to enum) | ✅ 已 sync HARNESS_DATA_MODEL.md §1.6 | ⏳ 未实施 |
| K12 跨端 enum graceful fallback contract | ✅ 已 sync HARNESS_DATA_MODEL.md §2.5 | ⏳ 未实施（Swift Codable + TS Zod 改动未做）|
| ProjectsAPI ↔ harness_project 同步规则 | ✅ 已 sync | ⏳ 未实施 |

**M5 准入条件依赖**：v0.3 docs 决议 + **代码全部落地**才能算"v0.3 全 P0/P1 ship"。M2 master plan loop2+ 期间这些落地是核心工作。

### 4.3 schema 扩展点表（v0.2 修订，含 Stage 模型评估）

| 扩展点 | 当前状态 | M5+ 目标 | 不可逆度 |
|---|---|---|---|
| `harness_project.domain_profile` | ⏳ v0.3 docs 已决议 (5 选)，代码未落 | M5 0006 schema-rebuild 扩到 ≥8 选含 `knowledge / health / finance / routine` 等非软件 domain（K12 fallback 保护老 iOS）| 中 |
| `methodology.applies_to` | ⏳ 同上 | 同上 0006 同步扩展（与 domain_profile 对齐）| 中 |
| **Stage CHECK enum 10 值固定**（v0.2 新加，**U-J3-C 用户决定**）| ✅ 当前固定 10 值（strategy → observe）| **不扩展**——Stage 模型只服务 software / knowledge domain；routine/health/finance 走 Memory + Decision 直驱不走 Stage 流水线（详见 §5 M7a）| 低（不动 Stage schema）|
| `Memory` 实体表（v0.3 round 2 修复：前置到 M5 末）| ❌ 不存在 | **M5 末**新加 `memory(id, kind TEXT NOT NULL REFERENCES memory_kind_registry(kind), project_id, payload_json, created_at, expires_at?, importance, provenance, sensitivity_level)` + 基本 INSERT/SELECT 能力（**不含 fact-extractor 不含 FTS5**，留 M6）| 中 |
| `memory_kind_registry`（v0.3 round 2 修复：加 tier + 前置到 M5 末）| ❌ 不存在 | **M5 末**新加 `memory_kind_registry(kind PRIMARY KEY, tier TEXT NOT NULL CHECK (tier IN ('core','extension')), payload_schema_ref, owner_domain, deprecated_at)`；M5 末 seed 第一批 core kind（≤10 个，含 `config.routine.cron / decision.routine.handled / fact.user-preference` 等）；扩展 kind 走 INSERT row（不需 migration）| 中 |
| `memory_quarantine` 隔离区（v0.2 新加，FJ7；v0.3 round 2 留 M6）| ❌ 不存在 | **M6** fact-extractor 输出经 application gate 校验 against registry；不在 registry 内的 kind 进 quarantine 表先隔离，等 ritual review 决定升级 | 低 |
| **`decision` schema 扩展**（v0.3 round 2 新加，回应 round 2 F4 DRIFT）| ✅ 当前 `decision.stage_id NOT NULL REFERENCES stage(id)` | **M5 末**改 schema：`stage_id` 改 nullable + 加 `project_id TEXT NOT NULL REFERENCES harness_project(id)` + `subject_domain TEXT` + `source_ref_type TEXT` (枚举: 'stage' \| 'memory' \| 'routine_trigger' \| 'observer_emit') + `source_ref_id TEXT` + `severity TEXT NOT NULL CHECK (severity IN ('trivial','minor','major'))` (回应 K-jarvis-6 落地契约 F5)；现有 stage-bound decision row 走 source_ref_type='stage' 兼容老路径 | 中（schema-rebuild 改 NOT NULL → nullable）|
| `Routine` 实体（提醒 / 日程 / 周期任务）| ❌ 不存在 | **M7a 走 Memory + Decision 直驱**（U-J3-C），不独立建表；routine 配置存 `memory(kind='config.routine.cron')` + trigger 触发 `decision(source_ref_type='routine_trigger', source_ref_id=memory.id)` | 低（无新表）|
| **加密 application-level（U-J2-B）** | ❌ 不存在 | M5 health / finance domain 字段经 Node `crypto` AES-256-GCM 加密 + Argon2 密钥派生（passphrase）+ payload_json 字段加密存储 | 低（不引入新依赖）|
| 主动性预算 server-driven config | ❌ 不存在 | M8 加 `proactivity_budget: { weekly_push_limit: 7, kill_switch: ... }` | 低 |
| 跨设备备份 cron + read-only degraded mode | ❌ 不存在 | M5 关键 domain 必须 rsync 到第二台设备（iPad + Tailscale）+ K-jarvis-7 iPad read-only 副本 | 低 |

### 4.4 Memory 跨 Subject 检索权限边界（v0.2 新加，回应 MAJ-2 + NF2-cross）

K-jarvis-5 强约束：

- query 层：所有 Memory query 必须带 `subject_scope / domain_scope / sensitivity_level`，默认同 Subject + 同 domain；跨域引用必须显式策略允许
- ContextBundle 层：检索结果进入 ContextBundle 后记录 provenance + sensitivity tag，防止 agent / reviewer 复制到 artifact / retrospective
- 默认：health domain Memory 不能流到 software domain 的 Issue spec

### 4.5 Build vs Adopt — 为什么不直接装 Khoj / fork Karakeep（v0.2 新加，回应 MAJ-9 + OQ6）

Khoj（[GitHub khoj-ai/khoj](https://github.com/khoj-ai/khoj)，Apache 2.0，27K star）是个人 second brain assistant，形态完全契合"个人自用 + 永不分发 + 数据本地"。诚实回答"为什么不直接装 Khoj 而要在 Eva 上长出来"：

**真实迁移成本**：
- Eva 已有数据（v0.4.5 一年 + dogfood retrospective + git history）
- CLI subprocess 权限流（permission-hook + prod-guard 即将上线）
- iOS 客户端（Seaidea SwiftUI native）
- harness 决策沉淀（[docs/proposals/](.) 多份 phase 1+2+3 评审历史）

**Eva 保留差异化边界**（jarvis 形态后仍 distinct from Khoj）：
- **工程过程沉淀**：Eva 不只是 second brain，而是"软件工程过程 + 决策 + 执行权限流"的 harness。Khoj 是"知识检索助手"，没有 SDLC stage / 评审矩阵 / 方法论 ritual
- **执行权限流**：Khoj 不调 CLI 不写代码，Eva 的 Coder agent 跑 worktree + git push + PR。Khoj 是 read-mostly，Eva 是 read-write
- **跨域 orchestration**：Eva 长期目标是"工程项目 + 知识 + 健康 + 财务 + 日程"统一调度，Khoj 只做知识

**借鉴方向**：Khoj 的语义检索实现（FTS + LLM rerank）可直接借鉴到 Memory 层。Karakeep 的 RAG 知识库可作为未来知识 domain 的 reference implementation。

**判断**：Khoj 不替代 Eva 但 Eva 的 Memory 层可以借鉴 Khoj 实现。这是合理的 build + adopt 混合策略。

---

## 5. 推荐方案：M5 → M7a → M6 → M7b → M8 演进路径（**v0.2 顺序重排**，BLOCKER-1 接受 cross react 中间路径）

按 [docs/HARNESS_ROADMAP.md §0 #13](../HARNESS_ROADMAP.md) 不做日历估算，用准入 + 退出条件推进。M5 → M7a → M6 → M7b → M8 顺序严格不可乱（v0.2 与 v0.1 不同）。

### M5 Subject 形态扩展

**核心**：把 L6 形态从"git 仓库"扩到"任意 Subject"；domain_profile enum 扩到非软件 domain；明确 Stage 模型分层（U-J3-C）。

**准入条件**（必须全满足）：

- ✅ M2 master plan 5 大目标全部 ship
- ✅ M3 + M4 完成（quality + observability + methodology v2）
- ✅ EVA_MULTI_PROJECT_USAGE v0.3 全 P0/P1 落地（**含 docs 决议 + 代码全部 ship**，详见 §4.2 implementation tracking）
- ✅ 至少 3 个非 dogfood software project 实测跑通（来自 M2-M4 organic dogfood 累积，**不是 M5 启动前额外动作**，回应 MAJ-4）
- ✅ [docs/AI_ASSESSMENT.md §安全配置](../AI_ASSESSMENT.md) 三条 P0 全做完
- ✅ **U-J2-B 加密路径已实现 + 旧备份不含敏感明文**（回应 BLK-4）
- ✅ M5 前置 health blood-pressure input UI spike 通过（回应 MAJ-10）

**核心动作**：

- 0006 schema-rebuild migration v300：`harness_project.domain_profile` enum 扩到 ≥ 8 选（含 `knowledge / health / finance / routine` 等非软件 domain）
- 0006 同步：`methodology.applies_to` enum 同样扩展（与 domain_profile 对齐 + 加 `'memory-driven'` 标识 routine/health/finance 类型，与 software/knowledge 类型并存）
- **0007 additive migration v301（v0.3 round 2 新加，前置 memory + decision schema）**：
  - 新加 `memory_kind_registry(kind PRIMARY KEY, tier TEXT NOT NULL CHECK (tier IN ('core','extension')), payload_schema_ref, owner_domain, deprecated_at)` + seed ≤10 条 core kind（`config.routine.cron / decision.routine.handled / fact.user-preference / fact.health.baseline / fact.health.daily / fact.routine.cron` 等）
  - 新加 `memory(id, kind TEXT NOT NULL REFERENCES memory_kind_registry(kind), project_id, payload_json, created_at, expires_at?, importance, provenance, sensitivity_level)` 基本表（**不含 FTS5 不含 fact-extractor**，留 M6）
  - schema-rebuild `decision` 表：`stage_id` 改 nullable + 加 `project_id TEXT NOT NULL REFERENCES harness_project(id)` + `subject_domain` + `source_ref_type / source_ref_id` + `severity TEXT NOT NULL CHECK (severity IN ('trivial','minor','major'))`；现有 stage-bound decision row backfill `source_ref_type='stage' / source_ref_id=stage_id` 兼容
- **Stage 模型分层**（U-J3-C）：
  - software-* / knowledge domain 走 Stage 流水线（现有 10 stage CHECK enum 不动）
  - routine / health / finance domain 走 Memory + Decision 直驱（不创建 Issue / Stage row）
- iOS server-driven schema 加 domain-specific UI hints（health 血压 / 体重 input 模板，按 spike 验证后的 5 组件 + slot schema 实现）
- K12 跨端 enum graceful fallback 已就位（v0.3 K12），新 enum 值老 iOS 不破

**不做**：
- 不引入 fact-extractor / memory_fts / memory_quarantine（M6 范围）
- 不引入主动观察层（M8 范围）
- 不接 IoT / 邮件 / 日历集成（M7a/M7b 范围）

**退出条件**（all of）：
- 0006 + 0007 migration 跑通 + harness-store 测试全绿
- 至少 1 个 `knowledge` domain Subject 实测全链路跑通：从想法 → spec（按 knowledge 模板）→ 多 stage 推进 → retrospective（**不依赖 fact-extractor**，回应 BLK-3 + BLK-7）
- memory 表 + memory_kind_registry seed 完整，能 INSERT / SELECT core kind row
- decision 表能创建 source_ref_type='memory' / 'routine_trigger' 的 row（基础校验）
- 老 iOS 装包看到新 domain enum 不崩（K12 fallback 验证）
- ~~routine domain push 提醒~~ 移到 M7a

### M7a 通用执行 agent — routine + knowledge dry-run（**v0.2 新加，介于 M5 和 M6 之间；v0.3 round 2 修复**）

**核心**：M7a 是 routine domain dry-run executor + knowledge domain agent 的最小可用形态。**Memory 基本表 + Decision 扩展 schema 已在 M5 末就位**（v0.3 round 2 修复 F1+F3 BLOCKER：M7a "不依赖 Memory" 措辞推翻——M7a **依赖 M5 末就位的 memory + decision 基本 schema**，但**不依赖 M6 的 fact-extractor / FTS5 / quarantine**）。

**准入条件**：
- ✅ M5 完成
- ✅ Integration 抽象 contract 落地（OQ4）：`Integration { kind, authMode, scopes, dryRunSupported, credentialStorage, auditPolicy }`，所有 MCP server 走统一注册
- ✅ Decision approve 适用对象重新定义（NF1-cross）：哪些动作只是 reminder draft / 哪些会触发真实 push / calendar write / health record write
- ✅ K-jarvis-6 Decision form 分级 server-driven config 上线（trivial / minor / major）

**核心动作**：
- AgentProfile 加：
  - `routine-executor`（轻量 dry-run，每天生成 reminder draft 入 retrospective，不真实 push）
  - `knowledge-curator`（按 knowledge domain stage 链推进，纯 retrospective 驱动）
- routine domain 用 Memory + Decision 驱动（不走 Stage）：
  - routine 配置存 Memory `(kind='config.routine.cron', payload_json={schedule, domain, action})`
  - cron 触发 → routine-executor 生成 reminder draft → 入 retrospective + Decision row
  - 用户 approve / dismiss → 落 Memory `(kind='decision.routine.handled')`

**不做**：
- 不引入 Memory fact extraction（M6 范围）
- 不接 health-coach 等敏感 domain executor（M7b 范围）
- 不开主动观察层（M8 范围）

**退出条件**：
- 跑通 1 个 routine Subject dry-run（每天生成 reminder draft + 用户回复 + 落 retrospective）
- 跑通 1 个 knowledge Subject 全链路（不依赖 Memory）
- 至少 100 条 retrospective 入库（作为 M6 fact extraction 的训练样本）

### M6 个人记忆层（fact extraction + FTS5 + registry 扩展，**v0.3 round 2 修复：不再"第一次引入 memory 表"**）

**核心**：在 M5 末就位的 memory + memory_kind_registry 基本 schema 上，加 fact-extractor + FTS5 索引 + memory_quarantine 隔离区。

**准入条件**：
- ✅ M7a 完成（≥100 条 retrospective + ≥ N 条 routine memory row 作 fact extraction 样本）
- ✅ FTS5 + Scheduler 并发 race condition spike 通过（NF2-arch）

**核心动作**（v0.3 round 2 修订）：

- 0008 additive migration v302（M6 范围，与 M5 末 0007 拆开）：
  - 给现有 `memory` 表加 FTS5 索引 (`memory_fts`)
  - 新加 `memory_quarantine(id, kind TEXT, payload_json, created_at, reviewed_at, decision)` 隔离表
  - registry 扩展 kind row（fact.* / pattern.* 等 fact-extractor 输出 kind，所有 tier='extension'）
- 加 `fact-extractor` ritual stage（轻量，每次 retrospective 落库时自动跑）
  - 输入：retrospective.md
  - 输出：N 条 fact.* 行
  - **fact-extractor 输出经 application gate 校验 against registry**：
    - 在 registry → INSERT 进 memory 表
    - 不在 registry → INSERT 进 memory_quarantine 表（隔离区）
    - 周期性 ritual review 决定 quarantine kind 是否升级到 registry
  - LLM 用 Sonnet（事实抽取 ≠ 创造，不需要 Opus）
- Strategist agent 在新 Issue 分解时**主动检索 Memory** 引用同 domainProfile 的成功 fact / 失败 anti-pattern
  - SQL 模板：`SELECT * FROM memory_fts WHERE memory_fts MATCH ? AND project_id IN (...) AND kind LIKE 'fact.%' AND sensitivity_level <= ? ORDER BY importance DESC LIMIT 20`
  - 跨 Subject 检索默认禁止跨 domain（K-jarvis-5）

**不做**：
- 不引入向量数据库（违反 §0 #11；FTS5 + 关键字检索 + LLM rerank 个人自用足够）
- 不引入 RAG（同上，FTS5 直接 inject 进 ContextBundle 即可）
- 不引入 Knowledge Graph 三元组

**退出条件**：
- Memory 表实体数 ≥ 500 行 fact（M7a 累积的 retrospective 跑完 fact-extractor 后）
- Strategist agent 引用 Memory fact 的覆盖率 ≥ 30%
- **fact 准确性人工抽查 ≥ 70%**（防 FJ7 数据污染传播，回应 MAJ-7 防刷分）
- **引用 fact 与 Issue 真相关性人工评 ≥ 60% + 无关引用扣分**（回应 MAJ-7）
- quarantine 隔离表 review ritual 跑通至少 3 轮

### M7b health/finance/general executor（**v0.2 新加，从原 M7 拆出来**）

**核心**：health / finance / general assistant agent，依赖 M6 Memory 层。

**准入条件**：
- ✅ M6 完成
- ✅ U-J2-B Node crypto application-level 加密真落地（payload_json 字段加密存储）
- ✅ FJ9 密钥备份 ritual 就位（passphrase 写在密码管理器 + USB 二备份 + 月度演练）

**核心动作**：
- AgentProfile 加：
  - `health-coach` / `health-logger` / `health-reviewer`（health domain 三角色）
  - `finance-recorder` / `finance-reconciler`（finance domain 双角色）
  - `assistant-general`（通用执行）
- 工具白名单按 domain 分桶（health agent 不能调 finance API；routine agent 不能改代码文件）
- 新 MCP server 接入：`calendar` / `mail` / `iot` / `health-export`（用 MCP 协议保持 §0 #2 + §0 #11）
- 所有非软件操作默认 dry-run，真实执行经过 Decision approve（K-jarvis-2 + K-jarvis-6 分级）

**不做**：
- 不引入主动观察层（M8 范围）
- 不接外部 SaaS（违反纯个人自用）
- 不开屏幕全感知（FJ4 + K-jarvis-4 永久否决）

**退出条件**：
- 跑通 1 个 health Subject 全链路（baseline + daily-log + weekly-review + alert）+ 加密验证（health.db payload_json 字段密文）
- 跑通 1 个 finance Subject 全链路 + 加密验证

### M8 主动观察层（严格在 K-jarvis-1 主动性预算约束内）

**核心**：在 K-jarvis-1 + K-jarvis-3 + K-jarvis-7 约束下，加被动观察 + 主动建议层。

**准入条件**：
- ✅ M7b 完成
- ✅ K-jarvis-1 主动性预算硬上限实现且 server-driven 可调
- ✅ K-jarvis-3 一键全关开关 iOS 上线（含两档 passiveMode + strictLocalMode）
- ✅ K-jarvis-7 read-only degraded mode 实现（iPad + Tailscale）
- ✅ 至少 N 个完整 routine cycle K-jarvis-1 没违反（**改非日历表述**，回应 MAJ-5）

**核心动作**：
- Observer agent（Haiku，按 cron 跑）扫描 Memory 表 + 外部信号，主动 emit 建议
- 建议进入 push queue，受 K-jarvis-1 周预算限制
- 用户 acceptance rate 落 telemetry，喂给 K-jarvis-1 注意力反转检测
- iOS 顶栏增加"主动性开关"，可一键全关回归被动应答态
- M5+ 期间 K-jarvis-1 反馈回路允许触发 ritual 调整（解冻条件已满足），但调整本身需走 review gate（回应 MAJ-6）

**不做**：
- 不开屏幕 OCR / 全感知（FJ4 + K-jarvis-4 永久否决）
- 不允许 agent 自动执行不可逆操作（即使在主动性预算内，所有真实执行仍走 Decision approve）

**退出条件**：
- 一周内主动 push ≤ 7 条建议
- 用户 acceptance rate ≥ 50%（健康度判断）
- K-jarvis-3 一键全关测试：开关关闭后 Observer agent 不再 emit push（passiveMode + strictLocalMode 各测）
- K-jarvis-7 read-only degraded mode：模拟 Mac 故障，iPad 能查询"今天该做什么"

---

## 6. 关键不变量（K-jarvis 系列，**v0.2 扩到 7 条**）

> **沿用所有现有不变量**（K1-K12 from EVA_MULTI_PROJECT_USAGE v0.3 + K13-K22 from HARNESS_ROADMAP.md §0）。本段只列**贾维斯形态新增**的 7 条。

| # | 不变量 | 防什么失败 |
|---|---|---|
| **K-jarvis-1** | **主动性预算硬上限** — Eva 主动 push 给用户的建议数量按周设硬上限（**默认 ≤ 7 条 / 周**，server-driven 可调，**计数口径 = user-global / local timezone week / all devices combined**），超额必须排队；用户 acceptance rate 持续 < 30% 触发 ritual 调整或自动回 M7a 调 prompt | FJ3 注意力反转 |
| **K-jarvis-2** | **关键决策必须 Decision approve** — 财务支出 ≥ 阈值 / 健康用药 / 重要回复 / 任何不可逆非软件操作（calendar/mail/iot 写）永远只能"建议 + 用户拍板"，agent 不允许有 auto-execute 路径 | FJ3 + FJ6 agentic over-reach |
| **K-jarvis-3** | **一键全关开关两档** — iOS 顶栏 kill switch，分两档：`passiveMode` 只关 Observer / 主动 push（保留 Memory 检索 + Strategist 跨 Issue 引用）/ `strictLocalMode` 同时关跨 domain 跨 Subject Memory 引用，degrade to v0.4.5 形态（采纳 cross react 两档方案，回应 OQ3 + m2）| FJ1 单点 + FJ3 注意力反转 |
| **K-jarvis-4** | **不做全屏感知** — 永久否决"屏幕 OCR / activity tracking / 永久后台监听"等高隐私换便利的 Awareness 路径 | FJ4 私密信息中心化 + FJ5 集成面爆炸 |
| **K-jarvis-5** | **Memory 跨 Subject 检索 policy 三档**（v0.3 round 2 修订 F5 DRIFT）— query policy 三档：`same_subject`（默认）/ `same_domain_cross_subject`（同 domainProfile 跨 Subject 显式策略允许，如 dogfood Eva fact 引用到 software-cli Eva 工具开发 Subject）/ `cross_domain_explicit`（跨 domain 必须 K-jarvis-3 strictLocalMode 关闭 + 显式 policy 允许）。query 层 + ContextBundle 层均强制带 policy 字段；ContextBundle 检索结果记录 provenance + sensitivity tag | FJ7 Memory 数据污染传播 + 跨域信息泄漏 |
| **K-jarvis-6** | **Decision form 分级**（v0.3 round 2 修订 F5：schema 字段 `decision.severity TEXT NOT NULL CHECK (severity IN ('trivial','minor','major'))` 已在 M5 末 0007 落地）— trivial 自动 approve / minor 默认 approve 可撤销 / major 必须同步 approve；防 R7.2 审批疲劳全面回归（与 §0 #22 fast-path 同源）| FJ10 K-jarvis-2 与 R7.2 冲突 |
| **K-jarvis-7** | **read-only degraded mode（iPad 直接读 read-only DB 副本不跑 backend）**（v0.3 round 2 修订 F5：明确不依赖现有 backend HTTP 路由）— iPad + Tailscale 拿 rsync 过来的 read-only `harness.db` 副本，**iPad 端独立读（不依赖 Mac backend 在线）**；与 K-jarvis-3 strictLocalMode 联动；如未来要走 HTTP degraded mode，单独设计只读 router 不暗示当前 backend 已支持 | FJ11 Eva 故障 = 用户生活停摆 |

**v0.2 删除**：~~K-jarvis-5 强制非 Claude provider~~（采纳 cross react refine：FJ8 改成 OQ7 而非不变量；degraded mode 已由 K-jarvis-7 提供基本保障）

---

## 7. 与现有 IDEAS / RISKS / ROADMAP 的合并建议（v0.2 修订）

### 7.1 在 [docs/HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md) 新增

- 新加 §6.5 / §7 段："M5-M8 长期路线（贾维斯形态）"，包含 M5 → M7a → M6 → M7b → M8 顺序 + 准入/退出条件
- §0 加新原则 #24 主动性预算（K-jarvis-1）+ #25 关键决策 Decision approve（K-jarvis-2）+ #26 一键全关两档（K-jarvis-3）+ #27 不做全屏感知（K-jarvis-4）+ #28 跨 Subject Memory 边界（K-jarvis-5）+ #29 Decision form 分级（K-jarvis-6）+ #30 read-only degraded mode（K-jarvis-7）

### 7.2 在 [docs/HARNESS_RISKS.md](../HARNESS_RISKS.md) 新增

加 §11 "贾维斯形态风险（M5+）"组，含 **11 条 RJ.1-RJ.11** 对应 FJ1-FJ11（v0.1 6 条 → v0.2 11 条）。

### 7.3 在 [docs/HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md) 新增

- §1.14 加 Memory + memory_kind_registry + memory_quarantine 实体的**预留扩展点**说明（不立即落 schema，等 M6 启动时走 contract mode）
- §1.15 加 Routine 不独立建表说明（U-J3-C 走 Memory + Decision 直驱）
- §2.5 K12 跨端 enum fallback contract 段加 jarvis domain_profile enum 扩展示例
- 新加 §2.6 Stage 模型分层 contract（U-J3-C）：software/knowledge 走 Stage / routine/health/finance 走 Memory + Decision

### 7.4 在 [docs/HARNESS_LANDSCAPE.md](../HARNESS_LANDSCAPE.md) 新增

加 §6 "贾维斯方向竞品全景"，含表 1 §1 业界 10 个项目对比 + Khoj 行 + build-vs-adopt 段（详见 §4.5）。

### 7.5 在 [docs/HARNESS_INDEX.md](../HARNESS_INDEX.md) 新增

加 EVA_AS_PERSONAL_JARVIS.md v0.2 入口 + 在跨文档关键约束段加 "K-jarvis 7 条不变量"。

### 7.6 在 [docs/IDEAS.md](../IDEAS.md) 新增

加 J1-J9 共 9 条 jarvis 长期演进条目（对应 M5/M7a/M6/M7b/M8 各核心动作 + Stage 分层 + memory_kind_registry + Integration 抽象）。

---

## 8. 待用户拍板的决策记录（v0.2 收敛后）

> v0.1 D1/D2/D3 由用户在 v0.2 仲裁阶段已全拍板。本段记录拍板结果以备审计。

### U-J1: Memory `kind` 路线 — 拍板 **U-J1-B memory_kind_registry 中间路径**

| ID | 选项 | author 倾向 | 用户拍板 |
|---|---|---|---|
| U-J1-A | CHECK enum 严格路线 | 谨慎推荐 | — |
| **U-J1-B** | **memory_kind_registry 中间路径**（核心 kind CHECK enum + 扩展 kind registry 外键 + payload_schema_ref + quarantine 隔离区 + ritual review 升级）| **强推荐** | ✅ |
| U-J1-C | 完全 schemaless | 不推荐 | — |

**落地约束**（v0.2 §5 M6）：
- 第一批 registry kind ≤ 20 个，含 fact.* / decision.* / pattern.* / config.*
- fact-extractor 输出经 application gate 校验 against registry，不在 registry 内的 kind 走 quarantine 隔离区
- 周期性 ritual review 决定 quarantine kind 是否升级到 registry

### U-J2: 加密 sidecar 路径 — 拍板 **U-J2-B Node crypto application-level**

| ID | 选项 | author 倾向 | 用户拍板 |
|---|---|---|---|
| U-J2-A | J3-A SQLCipher | 不推荐（违反 §0 #11）| — |
| **U-J2-B** | **J3-B Node crypto application-level**（AES-256-GCM + Argon2 + passphrase）| **强推荐** | ✅ |
| U-J2-C | 推迟 health/finance domain 到 M7b 之后 | 备选最保守 | — |

**落地约束**（v0.2 §5 M5 + M7b 准入条件）：
- 加密路径 M5 启动前实现 + 旧备份不含敏感明文
- Passphrase 跨设备共用（不绑 Keychain）+ passphrase 备份 ritual（密码管理器 + USB 二备份 + 月度演练）

### U-J3: jarvis Subject 走 Stage 流水线还是绕过 Stage — defer to author **U-J3-C 分层**

| ID | 选项 | author 倾向 | 用户拍板 |
|---|---|---|---|
| U-J3-A | Stage CHECK enum 扩到 N domain × stage | 不推荐 | — |
| U-J3-B | Stage 模型改 (domain, kind) 复合 enum | 不推荐 | — |
| **U-J3-C** | **分层：software/knowledge 走 Stage，routine/health/finance 走 Memory + Decision 直驱** | **强推荐** | ✅ defer to author（用户略过询问视为 defer）|

**用户重新拍板触发条件**：M7a 实施时如果发现 Stage 分层带来不可预见的复杂度（例如 iOS 看板 UI 两套视图维护成本过高），author 应主动 escalate 询问用户是否切到 U-J3-A / U-J3-B。

**落地约束**（v0.2 §4.3 + §5 M5）：
- Stage CHECK enum 10 值固定不动
- routine / health / finance domain 走 Memory + Decision 直驱（不创建 Issue / Stage row）
- domain_profile enum 直接决定走哪条路径（schema 层强制）

---

## 9. 关键 Open Questions（评审时挑战）

留给 phase 1 / round 2 reviewer 挑战的开放问题（v0.2 删除已升级为 spike / 已纳入仲裁的 OQ1 / OQ2 / OQ4）：

- **OQ5**：第二台设备 read-only 副本 + 加密传输（U-J2-B passphrase 跨设备）+ 恢复演练具体实施细节（与 J3-B 联动）
- **OQ6**：Khoj build-vs-adopt 已答（§4.5），保留 OQ 是确认未来若 Khoj 推出 jarvis 形态特性是否要重新评估
- **OQ7**：FJ8 provider fallback 在 M8+ 是否真上？K-jarvis-7 read-only degraded mode 是否够用替代非 Claude provider 强制要求？
- **OQ8**：M5 health blood-pressure input UI spike 结果（M5 启动前必须答）—— 5 组件 + slot schema 能否表达 input 类型 / 单位 / 范围 validation
- **OQ9**：M6 FTS5 + Scheduler 并发 race condition spike 结果（M6 启动前必须答）—— fact-extractor 与并发 stage runner 同时写入 Memory 表 + FTS5 索引 p95 延迟
- **OQ10**：M7a Decision approve 适用对象边界（NF1-cross 触发）—— 哪些 routine 动作只是 reminder draft 哪些会触发真实 push / calendar write
- **OQ11**：jarvis Subject 分层后的 iOS 看板 UI 设计（U-J3-C 触发）—— software/knowledge 走 Issue → Stage 流水线视图，routine/health/finance 走 Memory feed + Decision queue 视图，两类切换 / 跨域报表如何

---

## 10. Phase 2/3 评审 + Round 2 局部评审

**v0.1 → v0.2 进度**：

- ✅ Phase 1 双独立评审完成（[arch verdict](../reviews/eva-as-personal-jarvis-arch-2026-05-06-0042.md) + [cross verdict](../reviews/eva-as-personal-jarvis-cross-2026-05-06-0042.md)）
- ✅ Phase 2 cross-pollinate 完成（[react-arch](../reviews/eva-as-personal-jarvis-react-arch-2026-05-06-0050.md) + [react-cross](../reviews/eva-as-personal-jarvis-react-cross-2026-05-06-0050.md)）
- ✅ Phase 3 author 仲裁完成（[arbitration log](../reviews/eva-as-personal-jarvis-arbitration-2026-05-06.md)）
- ✅ 用户拍板 U-J1-B / U-J2-B / U-J3-defer (→ U-J3-C)，3 拍板与 author 推荐一致

**v0.2 收敛判断**（按 SKILL.md L262-268）：

- ✅ 修订完所有 ✅ accept + ⚠️ partial（本文件即修订后版本）
- ✅ 无未解 BLOCKER（7 BLOCKER 全部 §5 / §6 吸收 + 1 路线分歧 BLK-2 / 1 抽象分歧 BLK-6 走 U-J1-B / U-J3-C）
- ✅ 用户决定 ≤ 3 条（U-J1/U-J2/U-J3 三条全拍板）

**v0.2 引入新设计可能引入新 BLOCKER 维度**（按 SKILL.md L268）：

- M7 拆 M7a/M7b（v0.1 不存在的拆分）
- memory_kind_registry + quarantine 设计（U-J1-B 用户决定后 v0.2 才落 schema 层细节）
- Stage 模型分层 U-J3-C（schema 不动但语义大改：domain_profile 决定走 Stage 还是 Memory + Decision）

**判定**：v0.2 写完后**建议跑 round 2 phase 1 局部评审**——仅对修订段落（§5 M5-M8 重排 + §4.3 schema 扩展点表 + §6 K-jarvis-5/6/7 新加 + §3 FJ7-FJ11 新加 + §4.5 build-vs-adopt + §1 Khoj 行）跑 round 2，验证修订没引入新 BLOCKER。

**例外**：3 用户拍板与 author 推荐一致 → round 2 局部评审范围更小（只看 M7 拆 / Memory registry / Stage 分层语义），可能 1 轮收敛。

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
- [Khoj — Personal AI second brain](https://github.com/khoj-ai/khoj) — v0.2 OQ6 加入

内部 Eva 文档引用：

- [docs/proposals/EVA_MULTI_PROJECT_USAGE.md](EVA_MULTI_PROJECT_USAGE.md) — 短期相变 v0.3 final（配套 proposal）
- [docs/HARNESS_ARCHITECTURE.md](../HARNESS_ARCHITECTURE.md) — L6 Subject Project 段
- [docs/HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md) — §1.1 / §1.6 / §2.5（v0.3 已扩展）
- [docs/HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md) — §0 #1-23 不变量
- [docs/HARNESS_RISKS.md](../HARNESS_RISKS.md) — §8 多项目使用风险（v0.3 已加）
- [docs/HARNESS_LANDSCAPE.md](../HARNESS_LANDSCAPE.md) — 现有 §1-§5 竞品分析
- [docs/HARNESS_INDEX.md](../HARNESS_INDEX.md) — 文件总入口
- [docs/IDEAS.md](../IDEAS.md) — H 段（H18 Provider Runtime + H19-H26 多项目使用 v0.3 已加）
- [docs/AI_ASSESSMENT.md](../AI_ASSESSMENT.md) — §安全配置 P0 三条（M5 准入条件之一）
- [.claude/skills/harness-review-workflow/SKILL.md](../../.claude/skills/harness-review-workflow/SKILL.md) — phase 1+2+3 评审编排
- [.claude/skills/reviewer-cross/SKILL.md](../../.claude/skills/reviewer-cross/SKILL.md) — cross lens
- [.claude/skills/harness-architecture-review/SKILL.md](../../.claude/skills/harness-architecture-review/SKILL.md) — arch lens

内部 Eva 代码引用（v0.2 NF1/NF2 触发）：

- [packages/backend/src/migrations/0001_initial.sql](../../packages/backend/src/migrations/0001_initial.sql) — 13 实体 schema 现状（Stage CHECK enum 10 值 L123-125）
- [packages/backend/src/scheduler.ts](../../packages/backend/src/scheduler.ts) — Scheduler 单进程 setInterval（NF2 FTS5 并发 spike 对象）
- [docs/HARNESS_ROADMAP.md §0.5](../HARNESS_ROADMAP.md) — anchor gate 7 问（U-J2-A 触发条件）

Phase 1+2+3 review trail：

- [docs/reviews/eva-as-personal-jarvis-arch-2026-05-06-0042.md](../reviews/eva-as-personal-jarvis-arch-2026-05-06-0042.md) — phase 1 arch verdict (Claude Opus 4.7)
- [docs/reviews/eva-as-personal-jarvis-cross-2026-05-06-0042.md](../reviews/eva-as-personal-jarvis-cross-2026-05-06-0042.md) — phase 1 cross verdict (cursor-agent GPT-5.5)
- [docs/reviews/eva-as-personal-jarvis-react-arch-2026-05-06-0050.md](../reviews/eva-as-personal-jarvis-react-arch-2026-05-06-0050.md) — phase 2 react arch
- [docs/reviews/eva-as-personal-jarvis-react-cross-2026-05-06-0050.md](../reviews/eva-as-personal-jarvis-react-cross-2026-05-06-0050.md) — phase 2 react cross
- [docs/reviews/eva-as-personal-jarvis-arbitration-2026-05-06.md](../reviews/eva-as-personal-jarvis-arbitration-2026-05-06.md) — phase 3 author arbitration

---

## 12. v0.1 → v0.2 修订对照（审计 trail）

### v0.2 主要改动

- §0 Status: research/proposal → ✅ 用户拍板 + author 仲裁收敛；不可逆度 v0.1"高" 维持"高"（含 v0.2 新加约束）
- §0 Context: 加 U-J1-B / U-J2-B / U-J3-C 三个用户拍板；"5 条贾维斯专属新风险" → "6 条" + v0.2 扩到 11 条
- §1 表 1: 加 Khoj 行 + 表头注（4 原语百分比按 §4 操作化定义）
- §3 失败模式: 6 → 11 条（加 FJ7-FJ11）
- §4: 加 §4.1 4 原语操作化定义（替换 v0.1 vibes 百分比）+ §4.2 v0.3 implementation tracking + §4.3 schema 扩展点表加 Stage 模型评估（U-J3-C）+ memory_kind_registry + memory_quarantine + 加密 application-level + §4.4 Memory 跨 Subject 检索权限边界（K-jarvis-5）+ §4.5 build-vs-adopt（Khoj/Karakeep）
- §5 M5-M8 顺序重排: M5 → M7a → M6 → M7b → M8（v0.1 是 M5 → M6 → M7 → M8）
- §6 K-jarvis 不变量: 4 → 7 条（加 K-jarvis-5/6/7；删 K-jarvis-5 强制非 Claude provider 改成 OQ7）+ K-jarvis 编号 typo 修复（BLK-5）
- §7 合并建议: 全面更新（加 K-jarvis-5/6/7 / RJ.1-RJ.11 / Stage 模型分层 contract）
- §8 用户决定: 拍板记录（U-J1-B / U-J2-B / U-J3-defer→U-J3-C）
- §9 OQ: 删 OQ1/OQ2/OQ4（已纳入仲裁），加 OQ7-OQ11
- §10: 已不 skip，建议 round 2 局部评审
- §11: 加 Khoj 链接 + scheduler.ts + anchor gate 引用
- §12: 新加（v0.1 → v0.2 修订对照审计 trail）

### v0.2 → v0.3 修订（round 2 cross-check 触发）

cursor-agent (gpt-5.5) round 2 lightweight cross-check 抓 2 BLOCKER + 3 DRIFT：

- **F1+F3 BLOCKER (同根)**：M7a 声明"不依赖 Memory" 但核心动作要求 routine 配置存 Memory + 创建 Decision row，与当前 `decision.stage_id NOT NULL` 冲突
  - **v0.3 修复**：把 memory + memory_kind_registry + decision schema 扩展前置到 M5 末（0007 additive）；M6 只做 fact-extractor + FTS5 + quarantine 扩展（0008）；M7a "不依赖 Memory" 措辞推翻——M7a 依赖 M5 末就位的基本 schema，但不依赖 M6 的 fact-extractor / FTS5
- **F2 DRIFT**：memory_kind_registry "核心 kind CHECK enum + 扩展 registry FK" SQL 上不能两套都加在 memory.kind
  - **v0.3 修复**：registry 加 `tier TEXT CHECK (tier IN ('core','extension'))`；memory.kind 只走 FK 不加额外 CHECK
- **F4 DRIFT**：Decision 直驱缺 schema 落点
  - **v0.3 修复**：M5 末 0007 schema-rebuild `decision`：stage_id 改 nullable + 加 project_id NOT NULL + subject_domain + source_ref_type/source_ref_id + severity
- **F5 DRIFT**：K-jarvis-5/6/7 落地契约不足
  - **v0.3 修复**：K-jarvis-5 改 policy 三档（same_subject / same_domain_cross_subject / cross_domain_explicit）；K-jarvis-6 schema 字段 decision.severity 已在 M5 末落；K-jarvis-7 明确不依赖现有 backend HTTP 路由

### v0.3 → v0.4 触发条件

- v0.3 修复完所有 round 2 BLOCKER + DRIFT，按 SKILL.md L262-268 收敛判断 v0.3 = final
- 若未来 round 3 reviewer (M5 启动前) 抓到 v0.3 修复引入的新 BLOCKER → 回 phase 2 cross-pollinate 该段落 + phase 3 author 仲裁，迭代到 v0.4
- 当前 v0.3 已 user-approved + author-arbitrated + round 2-fixed 三层收敛，**进入落地阶段**（M5 启动时各 schema 改动走 contract mode + ADR-lite）
