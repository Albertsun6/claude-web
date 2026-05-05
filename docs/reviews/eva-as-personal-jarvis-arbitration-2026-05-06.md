# Phase 3 Arbitration — EVA_AS_PERSONAL_JARVIS.md v0.1 → v0.2

**Author**: Claude Sonnet 4.6
**Date**: 2026-05-06 00:55
**Phase**: 3 (author arbitration)
**Read**: phase 1 cross + phase 1 arch + phase 2 react cross + phase 2 react arch + 自身原 v0.1
**Output**: 仲裁矩阵 + v0.2 修订计划 + ≤3 条用户决定清单

按 [`harness-review-workflow` SKILL.md](../../.claude/skills/harness-review-workflow/SKILL.md) L240-256 author 仲裁规则。硬约束：用户决定 ≤ 3 条；超出回 phase 2。

---

## 0. 评审收敛信号统计

| 指标 | 数 | 说明 |
|---|---|---|
| 双向 BLOCKER agree | 5 | arch BLK-1 顺序 + arch BLK-2 schemaless + arch BLK-3 退出条件 + cross B1 加密前置 + cross B2 编号错位 |
| Cross self-upgrade BLOCKER | 1 | cross react 升级自己 M2 → BLOCKER（M5 exit 让 outcome gate 不可执行）|
| Cross self-add BLOCKER | 1 | cross react 自承 round 1 漏 Stage CHECK enum vs 多 domain stage 集合（与 arch 四维 §垂直贴谱性 §1 同问题）|
| 双向 MAJOR agree | 13 | 详见矩阵 |
| 单向 refine | 1 | M4 Memory kind 路线（schemaless vs registry vs CHECK enum 强度差异 — 真分歧）|
| 双向 disagree | 0 | 无硬冲突 |
| New-finding（phase 2）| 4 | arch NF1 密钥同步路径 + arch NF2 FTS5 并发 + cross NF1 M7 拆分后 Decision 边界 + cross NF2 Memory ContextBundle 权限 |
| Cross 提的中间路径 | 2 | 拆 M7a/M7b 解决 M7 顺序 + memory_kind_registry 作为 schemaless vs CHECK 中间方案 |

**判断**：高度收敛（0 硬冲突 + 唯一真分歧 M4 是 author 必须正面拍板的"路线选择"问题），可以进 phase 3 仲裁 + v0.2 修订。但**因 v0.2 修订面巨大**（含 M5-M8 重排 + Memory 表设计 + Stage 模型评估等结构改动），按 SKILL.md L268 收敛判断**可能触发 round 2 phase 1 局部评审**（仅对修订段落）。

---

## 1. Arbitration Matrix（含 30+ 条 finding 全部仲裁）

### 1.1 双向 BLOCKER (5 + 自我升级 1 + 自我新加 1 = 7 条)

| # | Finding | 来源 | 类别 | 处理 |
|---|---|---|---|---|
| BLK-1 | M5-M8 顺序错排（M7 不依赖 M6）| arch BLK-1 + cross react refine | ⚠️ partial accept | **采纳 cross react 中间路径**：改 M5 → M7a (routine/knowledge dry-run executor) → M6 (Memory) → M7b (health/finance executor) → M8 |
| BLK-2 | Memory schemaless kind 与 K7/K12 严格 enum 路线冲突 | arch BLK-2 + cross M4 refine | 🟡 用户决定（U-J1）| 真分歧 — author 不能单方面定。3 选 1 见 §3 用户决定清单 |
| BLK-3 | M5 退出条件依赖 M6 Memory 表，循环依赖 | arch BLK-3 + cross react agree（升级到 BLOCKER）| ✅ accept | 与 BLK-1 联动修：M5 退出条件改 knowledge domain 全链路（不依赖 Memory），routine push 移到 M7a |
| BLK-4 | M5 health/finance domain 上线但加密 sidecar 在 J3 待拍板（不可逆敏感数据落库）| cross B1 + arch react agree + arch 自我修正新维度 1 | ✅ accept | M5 准入条件加第 5 条：J3 加密决策已拍板 + 加密路径已实现 + 旧备份不含敏感明文 |
| BLK-5 | K-jarvis 编号引用错位（M8 段写 K-jarvis-2 主动性预算但定义里 K-jarvis-1 才是）| cross B2 + arch react agree | ✅ accept | typo 必修：M8 段 + §4 表所有"K-jarvis-2"改"K-jarvis-1"|
| BLK-6 | Stage CHECK enum 10 值固定 vs 多 domain stage 集合（cross 自承 round 1 遗漏，升级 BLOCKER）| arch 四维 §垂直贴谱性 §1 + cross react 升级 | 🟡 用户决定（U-J3）| 真分歧 — author 不能单方面定。3 选 1 见 §3 用户决定清单 |
| BLK-7 | M5 exit 让 outcome gate 不可执行（cross 自我升级 M2 → BLOCKER）| cross react 自我升级 | ✅ accept | 已与 BLK-3 同根，修 BLK-3 即修 BLK-7 |

### 1.2 双向 MAJOR (13 条)

| # | Finding | 来源 | 类别 | 处理 |
|---|---|---|---|---|
| MAJ-1 | 4 原语百分比无评分依据 | arch §架构可行性 §1 + cross react agree | ✅ accept | §1 表加 4 原语操作化定义（每原语 3-5 个可观察能力），逐项打分 |
| MAJ-2 | 跨 Subject Memory 检索权限 / 边界设计缺失（污染场景）| arch §架构可行性 §2 + cross react agree | ✅ accept | M6 Memory query 必须带 `subject_scope / domain_scope / sensitivity_level`；默认同 Subject + 同 domain；跨域引用必须显式策略允许 |
| MAJ-3 | fact-extractor 数据污染失败模式漏列（FJ7）| arch §架构可行性 §3 + cross react agree + cross react NF2 衍生 | ✅ accept | §3 加 FJ7 + M6 退出条件加 fact 准确率人工抽查 + provenance + low-confidence quarantine + 撤销机制 |
| MAJ-4 | "3 个非 dogfood software project" 时间线模糊 | arch §里程碑裁剪 §1 + cross react agree | ✅ accept | M5 准入条件明确："3 个样本来自 M2-M4 organic dogfood 累积"（不是 M5 启动前额外动作）|
| MAJ-5 | M8 "4 周" 是日历时间违反 §0 #13 | arch §里程碑裁剪 §2 + cross react agree | ✅ accept | 改"N 个完整 routine cycle"或"≥3 个 active week（每周 ≥3 天 dogfood）"，每个 cycle 有明确输入 / push / 用户处理记录 |
| MAJ-6 | M5-M8 全程未提 §0 #21 元工作冻结 / §0 #22 输出仪式预算 | arch §里程碑裁剪 §3 + cross react agree | ✅ accept | M5+ 入口处明确冻结状态：哪些 methodology 可调（M5-M8 期间 K-jarvis-1 反馈回路触发）/ 哪些仍冻结 / 调整是否需 review gate |
| MAJ-7 | M6 "Strategist 引用 Memory ≥30%" 容易 prompt 刷分 | arch §里程碑裁剪 §4 + cross react agree | ✅ accept | 改"覆盖率 ≥ 30% + 引用 fact 与 Issue 真相关性人工评 ≥ 60% + 无关引用扣分" |
| MAJ-8 | Issue/Stage 模型与 routine domain 不匹配 | arch §垂直贴谱性 §2 + cross react agree | ✅ accept（与 BLK-6 联动）| Routine 应独立建模或进 scheduler/routine 表，不硬塞 Issue 流水线 |
| MAJ-9 | 没回答 build-vs-adopt（为什么不 fork Karakeep / 装 Khoj）| arch §垂直贴谱性 §3 + cross react refine | ⚠️ partial accept | **采纳 cross react refine**：补 build-vs-adopt 段，承认"个人偏好也是有效架构输入"——Eva 已有数据 / CLI 权限流 / iOS 客户端 / harness 决策沉淀，这些是真实迁移成本 + Eva 保留"工程过程 + 决策 + 执行权限流"差异化边界。Khoj/Karakeep 可集成或借鉴（详见 OQ6） |
| MAJ-10 | iOS thin shell K4 在 jarvis 形态下不可持续 | arch §垂直贴谱性 §4 + cross react refine | ⚠️ partial accept | **采纳 cross react refine**：不直接判定 thin shell 不可持续。M5 前做 health blood-pressure input spike，验证 5 组件 + slot schema 能否表达 input 类型 + 单位 + 范围 validation；不够再扩 server-driven 组件集 |
| MAJ-11 | §4 表把 v0.3 schema 当落地事实 | cross M1 + arch react agree + arch 自我修正新维度 2 | ✅ accept | §4 表 ✅ → ⏳；加 v0.3 implementation tracking 段链回原 P0-4a/b PR；M5 准入条件依赖明确 |
| MAJ-12 | M5 退出条件越界引用 M6/M8 能力（独立于 BLK-3 但同根）| cross M2 | ✅ accept | 已与 BLK-3 联动修 |
| MAJ-13 | J3-A SQLCipher 与 §0 #11 "唯一允许 better-sqlite3 新依赖" 冲突 | cross M3 + arch react agree | ⚠️ partial accept | **降级 J3-A 为非默认推荐**：SQLCipher 走 J3-A 必须显式触发 anchor gate（§0.5 7 问 #5 依赖增减）+ 用户拍板例外。**默认改 J3-B** Node `crypto` application-level encryption（Argon2 + AES-256-GCM，passphrase 跨设备共用，不依赖 Keychain）|

### 1.3 风险遗漏 + new invariant (5 + 1)

| # | Finding | 来源 | 类别 | 处理 |
|---|---|---|---|---|
| FJ7 | Memory 数据污染传播 | arch 风险遗漏 §1 + cross react agree | ✅ accept | 加 §3 FJ7 + 缓解：quarantine + provenance + user correction + sampling audit |
| FJ8 | Claude CLI 单点供应商风险升级 | arch 风险遗漏 §2 + cross react refine | ⚠️ partial accept | **采纳 cross react refine**：先定义 degraded mode（不跑 agent 也能查询本地 routine/health/finance 数据）；provider fallback 作为 M8+ OQ，不作为 M7 blocker。**不强制 K-jarvis-5 在 M7+**——仅作 OQ |
| FJ9 | SQLCipher 密钥丢失 = health/finance 永久不可恢复 | arch 风险遗漏 §3 + cross react agree + arch react 与 J3 选项绑定 | ✅ accept | 加 FJ9 + 缓解与 J3 选项绑定：J3-A 走 Keychain + USB 二备份 + 月度演练；J3-B 走 Node crypto + passphrase 备份 ritual |
| FJ10 | K-jarvis-2 Decision approve 与 R7.2 审批疲劳冲突（"重要"边界没定）| arch 风险遗漏 §4 + cross react agree | ✅ accept | 加 FJ10 + Decision form 分级（trivial 自动 approve / minor 默认 approve 可撤销 / major 必须 approve），与 §0 #22 输出侧仪式预算 fast-path 同源 |
| FJ11 | Eva 故障 = 用户生活停摆，备份恢复 ≠ 服务可用 | arch 风险遗漏 §5 + cross react agree | ✅ accept | 加 FJ11 + K-jarvis-3 之外加 read-only degraded mode：iPad + Tailscale 直接读 read-only harness.db 副本（不跑 backend）|

### 1.4 OQ 强意见 (6 条)

| # | Finding | 来源 | 类别 | 处理 |
|---|---|---|---|---|
| OQ1 | M5-M8 顺序 | 双方均强意见 | 已并入 BLK-1 partial accept（M5 → M7a → M6 → M7b → M8）| — |
| OQ2 | kind CHECK enum vs registry vs schemaless | 双方分歧 | 🟡 用户决定 U-J1 | — |
| OQ3 | 一键全关包括 Memory 检索 | 双方均强意见 + cross react agree（提两档方案）| ✅ accept | 采纳 cross react 两档：`passiveMode` 只关 push/observer + `strictLocalMode` 同时关跨 Subject/domain Memory 引用 |
| OQ4 | Integration 抽象必须 | 双方均强意见 + cross react agree | ✅ accept | M7a 前置 `Integration` contract：`kind / authMode / scopes / dryRunSupported / credentialStorage / auditPolicy`；新加一个 integration = 填这张表 + 写 1 个 MCP adapter |
| OQ5 | 第二台设备方案 | 双方均强意见 + cross react refine（不锁死 age）| ⚠️ partial accept | **采纳 cross react**：第二设备 read-only 副本 + 加密传输 + 恢复演练；具体 age/SQLCipher export 在 J3 一起拍板（与 NF1 联动）|
| OQ6 | Khoj 必须加进 §1 表 1 | 双方均强意见 | ✅ accept | §1 表 1 加 Khoj（Apache 2.0, GitHub 27K star, self-hosted second brain assistant），写明 Eva 不直接替代它的 build-vs-adopt 理由（与 MAJ-9 联动）|

### 1.5 MINOR (3 条)

| # | Finding | 处理 |
|---|---|---|
| MIN-1 | §0 说 5 条新风险但 §3 列 6 条 (cross m1) | ✅ accept — typo 改"6 条" |
| MIN-2 | K-jarvis-3 一键全关边界 vs OQ3 author 倾向冲突 (cross m2) | ✅ accept — 与 OQ3 联动修 |
| MIN-3 | 主动性预算缺计数口径 (cross m3) | ✅ accept — 默认"user-global, local timezone week, all devices combined"，server 统一计数 + iOS 只显示状态 |

### 1.6 New-Finding (phase 2, 4 条)

| # | Finding | 处理 |
|---|---|---|
| NF1-arch | 加密 sidecar + 跨设备备份的密钥同步路径缺失 | ✅ accept — 加 §8 J3 第 4 维度"密钥跨设备同步"；J3-B passphrase 在跨设备同步上反而更友好（不绑定 Keychain）→ 进一步加强 MAJ-13 默认推荐 J3-B |
| NF2-arch | SQLite FTS5 + Scheduler 并发 race condition | ✅ accept — M6 启动前做 spike：fact-extractor 与并发 stage runner 同时写入 Memory + FTS5 索引 p95 延迟测试；> 100ms 考虑 lazy build / Memory 单独 SQLite 文件 |
| NF1-cross | M7 拆分后 Decision approve 适用对象需重新定义 | ✅ accept — M7a 明确哪些动作只是 reminder draft / 哪些会触发真实 push / calendar write / health record write，否则 M7a 提前会绕过 K-jarvis-2 审批边界 |
| NF2-cross | Memory 权限边界需要同时落在 query 层和 ContextBundle 层 | ✅ accept — 与 MAJ-2 联动：query 层限制 project_id/domain + ContextBundle 层加 provenance + sensitivity tag，防止 agent / reviewer 复制到 artifact / retrospective |

**计数**：5 BLOCKER 接受（含 1 自我升级 + 1 自我新加 = 实际 7 条 BLOCKER）+ 13 MAJOR 接受（5 ✅ accept + 4 ⚠️ partial）+ 3 MINOR 接受 + 4 new-finding 接受 + 5 风险遗漏 + 1 partial OQ + 1 new-invariant + **3 用户决定** = 30+ 条 finding 全分类。
**用户决定 = 3 条**（满足 SKILL.md L254 ≤ 3 硬约束）。

---

## 2. v0.2 修订计划（应用所有 ✅ accept + ⚠️ partial）

按 SKILL.md L260 应用顺序：先改 BLOCKER 再 MAJOR 再 MINOR。**v0.2 修订面巨大**（涉及大半文档段落），需要 author 重写较多。

### 2.1 修订 §0 Status / 不可逆度

- v0.1 → v0.2，bump version
- 不可逆度从"高"维持"高"——**真"高"**（要重排里程碑顺序 + 新加 K-jarvis-5 不变量 + 改 §4 表状态 + 加 5 条 FJ + 拆 M7 + 新加 J3-B option）
- 加 phase 1+2+3 review trail link
- §0 Context "5 条贾维斯专属新风险" → "**6 条**"（typo 修复 MIN-1）

### 2.2 修订 §1 业界 N 种典型架构

- 加 Khoj 行（OQ6 + MAJ-9）：Apache 2.0 / GitHub 27K star / self-hosted second brain assistant / Memory + Awareness + Action + Orchestration 4 原语打分 / 与 Eva 关系标"build-vs-adopt 核心对照系"
- 表头加注："4 原语百分比按下方 §4 操作化定义"（MAJ-1）

### 2.3 修订 §3 失败模式清单（6 → 11 条）

加 5 条新失败模式 + 缓解：

- **FJ7** Memory 数据污染传播（fact-extractor 抽错 fact → Strategist 引用 → 写错 spec → retrospective 再次抽取 = 错误循环）→ 缓解：M6 退出加 fact 准确率人工抽查 + provenance + low-confidence quarantine + 撤销机制
- **FJ8** Claude CLI 单点供应商风险升级 → 缓解：先定义 degraded mode（read-only 查询，不跑 agent），provider fallback 作为 M8+ OQ
- **FJ9** SQLCipher 密钥丢失 = health/finance 数据永久不可恢复 → 缓解与 J3 选项绑定（J3-A: Keychain + USB 二备份 + 月度演练；J3-B: Node crypto + passphrase 备份 ritual）
- **FJ10** K-jarvis-2 Decision approve 与 R7.2 审批疲劳冲突 → 缓解：Decision form 分级（trivial/minor/major），与 §0 #22 fast-path 同源
- **FJ11** Eva 故障 = 用户生活停摆 → 缓解：read-only degraded mode（iPad + Tailscale 直接读 read-only harness.db 副本，不跑 backend）

### 2.4 修订 §4 对接现有 harness（4 原语打分卡）

- 加 4 原语操作化定义：每原语 3-5 个可观察能力 + Eva 当前 against 该定义的逐条得失（替换 v0.1 的 vibes 百分比，MAJ-1）
- §4 schema 扩展点表 ✅ → ⏳（MAJ-11）+ 加一段 "v0.3 implementation tracking" 链回 P0-4a/b 状态
- 加 Stage 模型扩展评估行（独立于 domain_profile）：v0.1 完全没列 Stage CHECK enum 改造（BLK-6）

### 2.5 修订 §5 推荐方案 — **大幅重写 M5-M8 顺序**

**M5 → M7a → M6 → M7b → M8 顺序**（采纳 cross react 中间路径 + arch BLK-1 调头）：

#### M5 Subject 形态扩展（保留但收紧）

- 准入条件加第 5 条：**U-J2 (J3) 加密决策已拍板 + 加密路径已实现 + 旧备份不含敏感明文**（BLK-4）
- 准入条件第 4 条 "3 个非 dogfood software project 实测"明确："来自 M2-M4 organic dogfood 累积"（MAJ-4）
- 退出条件改：**至少 1 个 `knowledge` domain Subject 实测全链路**（不依赖 Memory，BLK-3 + BLK-7）
- 删除 v0.1 退出条件 "至少 1 个 routine domain Subject 实测每天 push" → 移到 M7a
- 新增 M5 前置 spike：health blood-pressure input UI spike（验证 server-driven 5 组件 + slot schema 能否表达 input 类型/单位/范围 validation，MAJ-10）
- 新增 M5 段：Stage 模型扩展评估（按 U-J3 用户决定确定走 Stage enum 扩 / 复合 enum / Routine 走非 Stage 抽象）

#### M7a 通用执行 agent — routine + knowledge dry-run（新加，介于 M5 和 M6 之间）

- 核心：routine domain dry-run executor（不真实 push，只生成 reminder draft 入 retrospective）+ knowledge domain agent（不依赖 Memory，纯 retrospective 驱动）
- M7a 前置：Integration 抽象 contract（OQ4）—— `Integration { kind, authMode, scopes, dryRunSupported, credentialStorage, auditPolicy }`
- M7a 前置：Decision approve 适用对象重新定义（NF1-cross）—— 哪些动作只是 reminder draft / 哪些会触发真实 push / calendar write
- 退出条件：跑通 1 个 routine Subject dry-run（每天生成 reminder draft + 用户回复 + 落 retrospective）+ 1 个 knowledge Subject 全链路

#### M6 个人记忆层（保留但 kind 路线由 U-J1 决定）

- 准入：M7a 完成（routine/knowledge dry-run 跑出 ≥100 条 retrospective 可作 fact extraction 训练样本）
- 核心：按 U-J1 决定走 schemaless / registry / CHECK enum 路线（详见 §3 用户决定）
- M6 启动前 spike：FTS5 + Scheduler 并发 race condition 实测（NF2-arch）
- Memory 跨 Subject 检索权限边界（MAJ-2 + NF2-cross）：query 层限 project_id/domain/sensitivity_level + ContextBundle 层加 provenance + sensitivity tag
- 退出条件：fact 准确率人工抽查 ≥ N% + Strategist 引用率 ≥ 30% **+ 引用 fact 真相关性人工评 ≥ 60% + 无关引用扣分**（MAJ-7）

#### M7b health/finance/general executor（新加，从原 M7 拆出来）

- 准入：M6 完成 + U-J2 加密 sidecar 真落地 + FJ9 密钥备份 ritual 就位
- 核心：health-coach / health-logger / health-reviewer + finance-recorder / finance-reconciler + 通用 assistant-general agent
- 工具白名单按 domain 分桶 + prod-guard 扩到非软件操作（calendar:write / mail:send / iot:device.power）
- 退出条件：跑通 1 个 health Subject 全链路（baseline + daily-log + weekly-review + alert）

#### M8 主动观察层（保留但准入收紧）

- 准入：M7b 完成 + K-jarvis-1 主动性预算硬上限实现 + K-jarvis-3 一键全关开关上线 + N 个完整 routine cycle K-jarvis-1 没违反（**不用"4 周"日历时间**，MAJ-5）
- M5+ 全程明确 §0 #21 元工作冻结状态：M5+ 期间 K-jarvis-1 反馈回路允许触发 ritual 调整（解冻条件已满足），但调整本身需走 review gate（MAJ-6）

### 2.6 修订 §6 关键不变量 — **K-jarvis 编号修复 + 加新条**

**修复 K-jarvis 编号错位**（BLK-5）：
- §6 表保持现有 K-jarvis-1/2/3/4 定义不变
- §5 M8 段所有 "K-jarvis-2 主动性预算" → "K-jarvis-1 主动性预算"
- §4 表所有 K-jarvis-2 引用同样修正

**加新不变量**：
- ~~K-jarvis-5 强制非 Claude provider~~ — **不加**（FJ8 改成 OQ 而非不变量，按 cross react refine）
- 加 K-jarvis-5：**Memory 跨 Subject 检索默认禁止跨域引用 + ContextBundle 层 provenance + sensitivity tagging**（MAJ-2 + NF2-cross）
- 加 K-jarvis-6：**Decision form 分级**（trivial 自动 approve / minor 默认 approve 可撤销 / major 必须 approve），防 R7.2 审批疲劳全面回归（FJ10）
- 加 K-jarvis-7：**read-only degraded mode**（iPad + Tailscale 直接读 read-only harness.db 副本不跑 backend），防 FJ11 Eva 故障 = 生活停摆

### 2.7 修订 §7 与现有 IDEAS / RISKS / ROADMAP 合并建议

更新 §7.1-§7.6 反映 v0.2 新内容：
- §7.1 ROADMAP 加 §0 #24-#27（K-jarvis-1/2/3 + #27 K-jarvis-7 read-only degraded mode）
- §7.2 RISKS §11 加 RJ.1-RJ.11（11 条对应 FJ1-FJ11，v0.1 6 → v0.2 11）
- §7.3 DATA_MODEL §1.14/§1.15 Memory + Routine 表占位说明（若 U-J1 选 schemaless 则不立 schema；若选 CHECK enum 则给完整 DDL）
- §7.4 LANDSCAPE §6 加 Khoj
- §7.5 INDEX 加本 proposal v0.2 入口
- §7.6 IDEAS 加 J1-J8（按 v0.2 M5-M8 + M7a/b 拆分）

### 2.8 修订 §8 用户决定 (U1/U2/U3 → U-J1/U-J2/U-J3 — 与短期 proposal U1/U2/U3 不冲突)

3 条新用户决定，详见下方 §3。

### 2.9 修订 §9 Open Questions

- 删除已升级为 spike / 已纳入仲裁的 OQ1 / OQ2 / OQ4
- 保留 OQ5 / OQ6（已在 v0.2 仲裁中处理 partial）
- 加新 OQ7：FJ8 provider fallback 在 M8+ 是否真上？degraded mode 是否够用？
- 加新 OQ8：M5 health blood-pressure input UI spike 结果（M5 启动前必须答）
- 加新 OQ9：M6 FTS5 + Scheduler 并发 race condition spike 结果（M6 启动前必须答）

### 2.10 修订 §10 Phase skip 段（已不 skip）

更新进度：phase 1+2+3 全跑完 + 3 用户决定待拍板。

### 2.11 修订 §11 引用源

加 NF1 NF2 触发的内部代码引用（[scheduler.ts](../../packages/backend/src/scheduler.ts) + [HARNESS_ROADMAP.md §0.5 anchor gate](../HARNESS_ROADMAP.md)）+ 加 Khoj GitHub 链接（OQ6）。

---

## 3. 用户决定清单（≤3 条，硬约束满足）

按 SKILL.md L309-317 真正需要用户偏好的事项。

### U-J1: Memory `kind` 路线选哪条？(BLK-2 + cross M4 真分歧)

**背景**：BLK-2 + cross M4。proposal v0.1 §5 M6 提议 `kind` 自由字符串 dot-namespace（参考 Tana supertag）。两位 reviewer 反对：

- arch 主张 **CHECK enum 严格路线**（与 K7/K12/ADR-0010 整套 schema 严控一致）
- cross 主张 **memory_kind_registry 中间路径**（kind 外键 registry，registry 记录 payload_schema_ref / owner_domain / deprecated_at）

| ID | 选项 | author 倾向 | 不可逆度 |
|---|---|---|---|
| U-J1-A | **CHECK enum 严格路线**：第一批 enum 值 ≤20 个，每加新 kind 走 0008-N additive migration，与 K7/K12 一致 | 谨慎推荐 | 中（每加 kind 一次 migration，迭代成本高但安全）|
| U-J1-B | **memory_kind_registry 中间路径**：核心 kind（fact.* / decision.* / pattern.*）走 CHECK enum，扩展 kind 走 registry 外键 + payload_schema_ref + quarantine 隔离区 + ritual review 升级 | **推荐** | 中（保留约束 + 扩展性）|
| U-J1-C | **完全 schemaless** dot-namespace（v0.1 原方案）：不走任何 SQL 约束 | 不推荐 | 高（与 K7/K12 路线相反，K12 跨端 fallback 失效）|

**author 倾向 U-J1-B 理由**：CHECK enum 严格路线（U-J1-A）每加 kind 都要 migration 太重，jarvis 形态 Memory 表 fact 类型会快速增长（fact.user-pref / fact.health.* / fact.routine.* / decision.* / pattern.* 等）；纯 schemaless（U-J1-C）确实违反 K7/K12。registry 中间路径既保留约束（外键 + payload_schema_ref + quarantine）又支持迭代扩展（registry 是 application-level table，加新 kind = INSERT row），与 K7/K12 通过 application gate 兼容。

### U-J2: M5 准入条件加密 sidecar 路径选哪条？(BLK-4 + MAJ-13 真分歧)

**背景**：BLK-4 要求 M5 准入加 J3 加密决策已落地。MAJ-13 把 J3-A SQLCipher 降级（与 §0 #11 冲突）。

| ID | 选项 | author 倾向 | 不可逆度 |
|---|---|---|---|
| U-J2-A | **J3-A SQLCipher**：触发 §0.5 anchor gate + 用户拍板例外，引入 SQLCipher native 依赖 | 不推荐 | 高（违反 §0 #11，且密钥同步路径复杂 NF1）|
| U-J2-B | **J3-B Node crypto application-level**：用 Node 原生 crypto（AES-256-GCM）+ Argon2 派生密钥（passphrase）。passphrase 跨设备共用，不绑 Keychain | **强推荐** | 低（不引入新依赖 + 跨设备同步友好）|
| U-J2-C | **推迟 health/finance domain 到 M7b 之后**：M5 只允许 knowledge / research / routine 等非敏感 domain；health/finance domain enum 值不在 M5 落地 | 备选（最保守）| 低（推迟敏感 domain，但失去 M5 多 domain 验证机会）|

**author 倾向 U-J2-B 理由**：J3-A SQLCipher 违反 §0 #11 + NF1 密钥跨设备同步问题（SQLCipher binding 在 iPad 上能否解密 macOS Keychain 原始密钥未知）；J3-B Node crypto 用现有依赖（Node 原生 crypto + 一个 npm Argon2）+ passphrase 跨设备共用反而更适合 OQ5 第二台设备恢复路径。U-J2-C 太保守，会让 M5 失去多 domain 验证机会（health/finance 是 jarvis 形态最具体的 use case，不能等到 M7b）。

### U-J3: jarvis Subject 走 Stage 流水线还是绕过 Stage？(BLK-6 真分歧)

**背景**：BLK-6 + arch §垂直贴谱性 §1。原 harness 13 实体 + 10 固定 Stage CHECK enum + 评审矩阵 + Methodology ritual 全部为软件 SDLC 设计。jarvis 形态（health / finance / routine / knowledge）强行套 Stage 模型有抽象不匹配。

| ID | 选项 | 描述 | 不可逆度 |
|---|---|---|---|
| U-J3-A | **Stage CHECK enum 扩到 N domain × 10 stage**：每个 domain 自己的 stage 集合（如 health: baseline → daily-log → weekly-review → alert），全部进 CHECK enum。schema-rebuild 大改 | 高（schema-rebuild + Methodology 表 stage_kind 字段语义变化）|
| U-J3-B | **Stage 模型改 (domain, kind) 复合 enum**：stage.kind 拆 stage.domain + stage.kind_within_domain | 极高（更大 schema-rebuild）|
| U-J3-C | **承认 Stage 模型不适用 routine/health/finance**：jarvis Subject 走另一套抽象（Memory + Decision 直接驱动，跳过 Stage 流水线）；只 knowledge / software domain 走 Stage 模型 | **author 推荐** | 中（架构分层但不破坏现有 Stage 模型）|

**author 倾向 U-J3-C 理由**：U-J3-A / U-J3-B 都会破坏原 harness 软件 SDLC 抽象的清晰度（10 stage 严格顺序 → N domain × stage 复杂矩阵）；U-J3-C 承认 jarvis 不同 domain 用不同抽象，knowledge/software domain 保留 Stage（已 dogfood 验证），routine/health/finance 走 Memory + Decision 直接驱动（更贴 cron task / 周期性 query 的本质）。这条与 MAJ-8（Issue/Stage 与 routine 不匹配）联动 fix。

---

## 4. v0.X+1 收敛判断

按 SKILL.md L262-268：

| 条件 | 状态 |
|---|---|
| v0.2 修订完所有 ✅ accept + ⚠️ partial | 待执行（§2 计划清晰可实施，但**修订面巨大**）|
| v0.2 是否还有未解 BLOCKER？ | 否（5 BLOCKER 全部 §2 计划吸收 + 1 路线分歧 BLK-2 / 1 抽象分歧 BLK-6 走 U-J1 / U-J3）|
| 用户决定 ≤ 3 条？ | ✅ 是（U-J1/U-J2/U-J3 三条）|
| 是否引入新 BLOCKER 维度？ | **可能** — v0.2 修订引入 (a) M7 拆 M7a/M7b 设计、(b) Memory kind 路线决定后的 schema 设计、(c) Stage 模型分层（U-J3-C）这三处是新设计，可能引入 reviewer 没看过的 BLOCKER 维度 |

**判定**：v0.2 写完后**建议 round 2 phase 1 局部评审**——仅对修订段落（§5 M5-M8 重排 + §6 K-jarvis-5/6/7 新加 + §3 FJ7-FJ11 新加）跑 round 2，验证修订没引入新 BLOCKER。

**例外**：U-J1/U-J2/U-J3 用户拍板若与 author 推荐一致（U-J1-B / U-J2-B / U-J3-C），round 2 局部评审范围更小（只看 M7 拆 + K-jarvis 新加 + FJ7-FJ11），可能 1 轮收敛。

---

## 5. 下一步

1. **执行 §2 v0.2 修订计划**：edit `docs/proposals/EVA_AS_PERSONAL_JARVIS.md` v0.1 → v0.2，应用所有 §2.1-§2.11 改动（**修订面大，约 60% 段落需重写**）
2. **commit v0.2** + commit arbitration log
3. **交用户**：v0.2 + 本仲裁 log + U-J1/U-J2/U-J3 三条决定清单
4. **用户拍板后**：根据收敛判断决定是否跑 round 2 phase 1 局部评审

完成 4 步后 Phase D（长期 proposal）进入收敛阶段，进 Phase E（用户拍板 + 最终化）。
