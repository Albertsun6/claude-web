# Phase 2 React — Cross lens

**Reviewer**: reviewer-cross  
**Model**: gpt-5.5-medium  
**Date**: 2026-05-06 00:50  
**Phase**: 2 (cross-pollinate)

## 对 sibling (arch) 每条 finding 的逐条表态

### Sibling-BLK-1 [BLOCKER] M5-M8 顺序错排，M7 不依赖 M6 — refine
**对方原文摘要**: 建议把 M5→M6→M7→M8 改为 M5→M7→M6→M8，因为 routine / executor 不需要 Memory。  
**我的表态**: 同意“M7 不应整体依赖 M6”，但不完全同意把 M7 整体提前到 M6 前。  
**理由**: 我的 round 1 M2 也指出 M5 exit 混入 M6/M8 能力。cross lens 上更稳的修法是拆 M7：非软件 dry-run executor / routine skeleton 可在 M6 前做；health/finance 等敏感、需历史判断或侧重个性化建议的 executor 不应早于加密 sidecar 和 Memory 污染控制。  
**新建议**: 改成 M5 → M7a（routine/knowledge dry-run executor）→ M6（Memory）→ M7b（health/finance/general executor）→ M8。

### Sibling-BLK-2 [BLOCKER] Memory schemaless kind 与严格 enum 路线冲突 — refine
**对方原文摘要**: `memory.kind` 必须 CHECK enum，不应 dot-namespace 自由字符串。  
**我的表态**: 同意自由字符串是 blocker；不同意所有 kind 都必须长期走 SQL CHECK enum。  
**理由**: 我的 round 1 M4 建议最小注册/校验策略。纯 CHECK enum 会让每种事实类型都变 migration，后续 Memory 迭代太重；纯 schemaless 又会漂移。  
**新建议**: 用 `memory_kind_registry` 做强约束：`kind` 外键到 registry，registry 记录 `payload_schema_ref / owner_domain / deprecated_at`。核心系统 kind 可同步 CHECK enum，扩展 kind 走 registry，不允许裸字符串。

### Sibling-BLK-3 [BLOCKER] M5 退出条件依赖 M6 Memory 表 — agree
**对方原文摘要**: M5 exit 要 routine push + reply + 落 Memory，但 Memory 是 M6 能力，形成循环依赖。  
**我的表态**: 同意。  
**理由**: 这与我的 round 1 M2 完全一致。M5 退出条件不可执行，会让 outcome gate 失效。  
**新建议**: M5 只验证 Subject/domain 形态与现有 Issue/Stage/Retrospective 全链路；routine push 和 Memory 写入移到后续执行层。

### Sibling-M1 [MAJOR] 4 原语百分比无评分依据 — agree
**对方原文摘要**: Eva Memory 30% / Awareness 10% / Action 70% / Orchestration 60% 没有操作化定义。  
**我的表态**: 同意。  
**理由**: 这会让外部竞品表变成主观判断，不利于后续路线裁剪。  
**新建议**: 每个原语定义 3-5 个可观察能力，再逐项打分。

### Sibling-M2 [MAJOR] 跨 Subject Memory 检索权限/边界缺失 — agree
**对方原文摘要**: Memory 检索跨 project/domain，可能把 health fact 注入 work spec。  
**我的表态**: 同意。  
**理由**: 这是安全与跨端契约问题。我的 round 1 没把它列成独立 finding，是遗漏。  
**新建议**: Memory query 必须带 `subject_scope / domain_scope / sensitivity_level`，默认同 Subject，同 domain；跨域引用必须显式策略允许。

### Sibling-M3 [MAJOR] fact-extractor 数据污染失败模式漏列 — agree
**对方原文摘要**: 抽错 fact 后会被 Strategist 引用，再进入 retrospective，形成污染循环。  
**我的表态**: 同意。  
**理由**: 这比普通 LLM 幻觉更严重，因为它进入持久记忆并被反复消费。  
**新建议**: M6 exit 加人工抽查准确率、撤销机制、fact provenance、低置信度隔离区。

### Sibling-M4 [MAJOR] “3 个非 dogfood software project 实测”时间线模糊 — agree
**对方原文摘要**: M5 准入要求 3 个项目，但 v0.3 只要求 1 个，缺口没说明。  
**我的表态**: 同意。  
**理由**: 准入条件不清会让 M5 是“自然等一段时间”还是“额外做验收”变得模糊。  
**新建议**: 写明 3 个样本来自 M2-M4 organic dogfood，还是 M5 前置验收任务。

### Sibling-M5 [MAJOR] M8 “4 周”违反 outcome-based 原则 — agree
**对方原文摘要**: “4 周”是日历时间，不符合 §0 #13。  
**我的表态**: 同意。  
**理由**: 时间本身不能证明行为稳定。  
**新建议**: 改为 N 个 active week / N 个 routine cycle，并要求每个 cycle 有明确输入、push、用户处理记录。

### Sibling-M6 [MAJOR] M5-M8 未处理元工作冻结与仪式预算 — agree
**对方原文摘要**: K-jarvis-1 反馈回路可能与 §0 #21 冻结、§0 #22 输出预算冲突。  
**我的表态**: 同意。  
**理由**: 这会影响能否根据 acceptance rate 调 ritual。  
**新建议**: 在 M5+ 入口处明确冻结状态：哪些 methodology 可调、哪些仍冻结、调整是否需要 review gate。

### Sibling-M7 [MAJOR] Memory 引用率 ≥30% 可被 prompt 刷分 — agree
**对方原文摘要**: Agent 可被要求强制引用 fact，导致指标失真。  
**我的表态**: 同意。  
**理由**: 这是典型可被优化的代理指标。  
**新建议**: 改为引用率 + 相关性人工评估 + “无关引用扣分”。

### Sibling-M8 [MAJOR] Stage CHECK enum 10 值固定与多 domain stage 冲突 — agree
**对方原文摘要**: 非软件 domain 的 stage 集合不同，现有 `stage.kind` CHECK enum 锁死。  
**我的表态**: 同意。  
**理由**: 这是我的 round 1 没独立列出的重大遗漏。它直接影响 M5 schema 可行性。  
**新建议**: M5 必须先回答 Stage 是扩成 per-domain 字典，还是 routine/health 走非 Stage 抽象。

### Sibling-M9 [MAJOR] Issue/Stage 模型与 routine domain 不匹配 — agree
**对方原文摘要**: “每天提醒喝药”不是一次性 Issue，而是周期性任务。  
**我的表态**: 同意。  
**理由**: 用 Issue/Stage 承载 cron 会制造占位 Issue 污染。  
**新建议**: Routine 应独立建模或进入 scheduler/routine 表，不应硬塞 Issue 流水线。

### Sibling-M10 [MAJOR] 没回答为什么不直接 fork Karakeep / 装 Khoj — refine
**对方原文摘要**: 如果只是个人偏好，应承认不是架构判断。  
**我的表态**: 同意需要回答，但不认为“个人偏好”就不是有效架构输入。  
**理由**: 本项目硬约束是纯个人自用，用户已有 Eva 数据、CLI 权限流、iOS 客户端和 harness 过程沉淀，这些都是真实迁移成本。  
**新建议**: proposal 应补一段 build-vs-adopt 判断：Khoj/Karakeep 可集成或借鉴，但 Eva 保留“工程过程 + 决策 + 执行权限流”这一差异化边界。

### Sibling-M11 [MAJOR] iOS thin shell 在 jarvis 形态下不可持续 — refine
**对方原文摘要**: health/finance/routine 需要专用输入 UI，server-driven 5 组件可能不够。  
**我的表态**: 同意风险存在，但不应直接判定 thin shell 不可持续。  
**理由**: iOS 当前策略是 server-driven config，health 血压、finance 金额这类表单可以先用有限 schema 验证，不必预设 native domain app 爆炸。  
**新建议**: 在 M5 前做一个 health blood-pressure input spike，验证 5 组件 + slot 是否够用；不够再扩 server-driven 组件集。

### Sibling-R1 [MAJOR] FJ7 Memory 数据污染传播 — agree
**对方原文摘要**: 错 fact 会进入闭环并放大。  
**我的表态**: 同意。  
**理由**: 这是 Memory 层最核心失败模式。  
**新建议**: 加入 FJ7，并给出 quarantine / provenance / user correction / sampling audit。

### Sibling-R2 [MAJOR] FJ8 Claude CLI 单点供应商风险升级 — refine
**对方原文摘要**: M7+ 必须有非 Claude provider fallback。  
**我的表态**: 同意风险升级；不同意在 M7+ 直接要求非 Claude provider。  
**理由**: 当前项目硬约束明确复用 Claude CLI subscription，provider abstraction 会扩大范围，并可能碰到 SDK/API 计费路线。  
**新建议**: 先定义 degraded mode：不跑 agent 也能查询本地 routine/health/finance 数据；provider fallback 作为 M8+ OQ，不作为 M7 blocker。

### Sibling-R3 [MAJOR] FJ9 SQLCipher 密钥丢失不可恢复 — agree
**对方原文摘要**: Keychain 丢失会导致 health/finance 数据永久不可恢复。  
**我的表态**: 同意。  
**理由**: 我的 round 1 B1 关注未加密敏感落库，但没覆盖密钥恢复。  
**新建议**: J3-A 必须附带密钥备份、恢复演练、旧备份敏感明文清理策略。

### Sibling-R4 [MAJOR] FJ10 Decision approve 与审批疲劳冲突 — agree
**对方原文摘要**: “重要”边界没定义，可能每个动作都要审批。  
**我的表态**: 同意。  
**理由**: 安全约束如果没有分级，会把 R7.2 用户审批疲劳带回来。  
**新建议**: 定义 trivial/minor/major 三档，只有 major 必须同步 approve，minor 可默认 approve 但可撤销。

### Sibling-R5 [MAJOR] FJ11 Eva 故障导致生活停摆 — agree
**对方原文摘要**: 备份恢复不等于服务可用，需要第二设备降级查询。  
**我的表态**: 同意。  
**理由**: Jarvis 形态的可用性风险比软件 harness 更高。  
**新建议**: 加 read-only degraded mode，优先保证“能查今天要做什么”，不要求能执行 agent。

### Sibling-OQ1 [强意见] M5→M7→M6→M8 — refine
**我的表态**: 同 Sibling-BLK-1，建议拆 M7a/M7b。  
**理由**: routine dry-run 可早于 Memory；health/finance 个性化执行不应早于 Memory 污染控制与加密策略。  
**新建议**: M5 → M7a → M6 → M7b → M8。

### Sibling-OQ2 [强意见] kind 必须 CHECK enum — refine
**我的表态**: 同 Sibling-BLK-2，建议 registry 强约束，不裸字符串。  
**理由**: CHECK enum 最安全但迭代成本高；registry 能保留约束与扩展性。  
**新建议**: `memory.kind` 外键 registry，核心 kind 可同步 CHECK enum。

### Sibling-OQ3 [强意见] 一键全关应包括 Memory 检索 — agree
**我的表态**: 同意。  
**理由**: “degrade to v0.4.5”如果仍允许 Strategist 引 Memory，就不是完整回退。  
**新建议**: 分两档：`passiveMode` 关 push/observer，`strictLocalMode` 同时关跨 Subject/domain Memory。

### Sibling-OQ4 [强意见] 必须有 Integration 抽象 — agree
**我的表态**: 同意。  
**理由**: calendar/mail/iot/health/finance 分散接入会让凭据、dry-run、权限、审计策略失控。  
**新建议**: M7 前置 `Integration` contract：`kind / authMode / scopes / dryRunSupported / credentialStorage / auditPolicy`。

### Sibling-OQ5 [强意见] iPad + Tailscale rsync + age 加密 — refine
**我的表态**: 同意 iPad + Tailscale 是优先候选；不应现在锁死 age。  
**理由**: 如果采用 SQLCipher sidecar + Keychain，age 备份密钥链路需要和 J3-A 密钥恢复统一设计，不能平行再造一套。  
**新建议**: OQ5 改为“第二设备 read-only 副本 + 加密传输 + 恢复演练”，具体 age/SQLCipher export 在 J3 里一起拍板。

### Sibling-OQ6 [强意见] Khoj 必须加进 §1 表 1 — agree
**我的表态**: 同意。  
**理由**: Khoj 与 personal second brain assistant 形态最贴近，不列会削弱 build-vs-adopt 判断。  
**新建议**: 加 Khoj，并明确 Eva 不直接替代它的理由：工程过程、权限流、CLI execution、harness.db 决策沉淀。

## 我自己 round 1 verdict 的自我修正

- 上调我方 M2 严重性：M5 exit 混入 M6/M8 不只是 major，应并入 blocker，因为它让 M5 outcome gate 不可执行。
- 补充我方遗漏：Stage CHECK enum 与多 domain stage 集合冲突，应作为 major/blocker 进入 phase 3 仲裁。
- 修正我方 M4：`memory_kind_registry` 比“CHECK enum 或 allowlist”更合适；裸 dot-namespace 不可接受，但全量 CHECK enum 也可能过重。
- 保留我方 B1：health/finance 在加密 sidecar 未落地前不能进入 M5 可写路径；sibling 未充分覆盖“敏感明文先落库后迁移”的不可逆风险。
- 保留我方 B2：K-jarvis 编号错位仍需修，sibling 没展开但不构成反例。

## 新发现 (new-finding)

### NF1 [MAJOR] M7 拆分后需要重新定义 “Decision approve” 的适用对象
如果 M7a 提前做 routine dry-run executor，必须明确哪些动作只是 reminder draft，哪些动作会进入真实 push / calendar write / health record write。否则 “M7 提前”会绕过 K-jarvis-2 的审批边界。

### NF2 [MAJOR] Memory 权限边界需要同时落在 query 层和 ContextBundle 层
只在 SQL query 里限制 `project_id/domain` 不够；检索结果进入 ContextBundle 后，还需要记录 provenance 和 sensitivity，防止后续 agent 或 reviewer 复制到 artifact / retrospective。

## Phase 2 收敛信号

- 双向 agree 数: 16
- 双向 disagree 数: 0
- 单向 refine 数: 9
- 结论: 两位 reviewer 对 “M5 exit 循环依赖 / Memory 裸 schemaless 风险 / Stage 模型冲突 / 敏感 domain 加密前置 / Memory 污染” 已高度收敛；phase 3 应优先处理这些，而不是继续扩展新愿景范围。
