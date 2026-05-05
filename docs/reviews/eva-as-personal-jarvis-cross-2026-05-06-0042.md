# Cross Review — EVA_AS_PERSONAL_JARVIS.md v0.1

**Reviewer**: reviewer-cross  
**Model**: GPT-5.5  
**Date**: 2026-05-06 00:43  
**Files reviewed**:
- `/tmp/eva-as-personal-jarvis-cross-prompt.md`
- `docs/proposals/EVA_AS_PERSONAL_JARVIS.md`
- `docs/proposals/EVA_MULTI_PROJECT_USAGE.md`
- `packages/backend/src/migrations/0001_initial.sql`
- `packages/backend/src/migrations/0003_stage_failed_reason.sql`
- `docs/HARNESS_DATA_MODEL.md`
- `docs/HARNESS_ROADMAP.md`
- `docs/HARNESS_RISKS.md`
- `docs/AI_ASSESSMENT.md`

---

## Summary

- Blockers: 2
- Majors: 4
- Minors: 3
- 总体判断：必须先修

## Numeric Score

| Lens | Score (0..5) |
|---|---:|
| 正确性 | 3.2 |
| 跨端对齐 | 3.4 |
| 不可逆 | 3.1 |
| 安全 | 2.7 |
| 简化 | 3.6 |

**Overall score**：3.2（有 blocker，上限 3.9）

## Findings

### B1 [BLOCKER] M5 允许 `health/finance` domain 先上线，但加密 sidecar 仍是未拍板事项

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:76`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:121`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:124-128`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:303-309`  
**Lens**: 安全 / 不可逆  
**Issue**: proposal 一边说 M5 扩 `domain_profile` 到 `health / finance / routine`，甚至给 health domain 加血压 / 体重 UI hint；另一边 J3 加密 sidecar 仍是用户待拍板，M5 准入条件只要求 AI_ASSESSMENT 三条 P0，并没有要求加密 sidecar 已完成。  
**Why this is a blocker**: 这会产生一个危险落地路径：M5 先允许创建 health/finance Subject，敏感数据可能先进入未加密的 `harness.db` / retrospective / telemetry / artifact，再等 M7 或 J3 后补加密。健康和财务数据一旦写进未加密主库，后续迁移不是普通 backfill，而是敏感数据清理 + sidecar 搬迁 + 备份清理，回滚成本高。  
**Suggested fix**: 明确拆开 M5 domain 扩展：
- M5 只允许 `knowledge / research / routine` 这类非敏感或低敏 domain。
- `health / finance` enum 值、UI hint、写入路径必须依赖 J3 已拍板且 sidecar storage routing 已实现。
- 如果坚持 M5 就包含 health/finance，则把 “J3-A 或等价加密方案已实现 + 旧备份不含敏感明文” 加入 M5 准入条件。

### B2 [BLOCKER] K-jarvis 编号引用错位，导致主动性预算 gate 不可执行

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:202`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:206-208`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:233-236`  
**Lens**: 正确性 / 跨端对齐  
**Issue**: M8 文本说 “K-jarvis-2 主动性预算硬上限”，但 §6 表格里 K-jarvis-1 才是主动性预算，K-jarvis-2 是 Decision approve。  
**Why this is a blocker**: 这是安全不变量，不是普通编号 typo。M8 的准入条件和核心行为如果引用错 invariant，后续落 `HARNESS_ROADMAP.md`、iOS kill switch、push queue、telemetry acceptance-rate 时会把 gate 绑错对象。主动性预算正是防 FJ3 的核心约束，不能带错编号进入收敛版。  
**Suggested fix**: 统一编号和所有引用：
- K-jarvis-1 = 主动性预算。
- K-jarvis-2 = 关键决策 Decision approve。
- K-jarvis-3 = 一键全关。
- K-jarvis-4 = 不做全屏感知。
- 修正 M8 标题、准入条件、核心动作、§4 “Awareness 短期不重要” 中所有引用。

### M1 [MAJOR] proposal 把 v0.3 的 schema 计划写成了当前落地事实

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:99-100`, `packages/backend/src/migrations/0001_initial.sql:18-26`, `packages/backend/src/migrations/0001_initial.sql:104-112`, `packages/backend/src/migrations/0003_stage_failed_reason.sql:25-26`  
**Lens**: 正确性 / 跨 proposal 一致性  
**Issue**: proposal 说 `harness_project.domain_profile` 和 `methodology.applies_to` 的 5 选扩展已经由 v0.3 P0-4a/P0-4b 加好；但实际 migration 目录只有 `0001`-`0003`，`0001` 中 `harness_project` 没有 `domain_profile`，`methodology.applies_to` 仍是 `claude-web / enterprise-admin / universal`，`0003` 只加 `failed_reason / failed_at`。  
**Suggested fix**: 把 §4 表格状态改成 “v0.3 已收敛 / 已写入 docs 计划，但代码 migration 尚未落地”。M5 准入条件保留 “EVA_MULTI_PROJECT_USAGE v0.3 全 P0/P1 落地”，但不要在当前状态列打 ✅。

### M2 [MAJOR] M5 exit condition 混入 M6/M8 能力，破坏里程碑顺序

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:130-139`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:141-158`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:200-214`  
**Lens**: 正确性 / 简化  
**Issue**: M5 明确 “不引入 generic Memory 表”，但退出条件要求 `routine` domain “每天 push 1 条提醒 + 你回复 + 落 Memory 表”。push 属于 M8 主动层，Memory 表属于 M6。  
**Suggested fix**: M5 exit 改成只验证 Subject/domain 形态，例如：创建 `routine` Subject、按 routine 模板生成 spec/stage/retrospective，但不要求主动 push，也不要求写 Memory。真正 “提醒 + 回复 + 入 Memory” 移到 M7/M8。

### M3 [MAJOR] J3-A 对 SQLCipher 的判断与 §0 #11 不一致

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:305-309`, `docs/HARNESS_ROADMAP.md:96`  
**Lens**: 不可逆 / 安全  
**Issue**: J3-A 说 SQLCipher “本质仍是 SQLite，不算引入新基础组件”，但 roadmap §0 #11 明写 “SQLite + better-sqlite3 是除 Hono+WS 之外唯一允许的新依赖”。SQLCipher npm/native binding 至少是新依赖，可能也是新的部署/runtime 约束。  
**Suggested fix**: 不要直接把 J3-A 标为不违反 #11。改成：J3-A 需要显式用户例外 + native dependency spike；否则默认推荐 J3-B（Node `crypto` application-level encryption）或 J3-C 作为临时方案。

### M4 [MAJOR] Memory `kind` 使用自由字符串，但缺最小注册/校验策略

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:150-152`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:317-318`  
**Lens**: 正确性 / 简化  
**Issue**: proposal 已识别 `kind` 命名漂移风险，但正文仍只给自由 dot-namespace，没有规定谁能注册 kind、如何 deprecate、如何避免 `fact.health` / `fact.health.bp` 漂移。  
**Suggested fix**: 不必现在建复杂 ontology，但 M6 contract 至少要有 `memory_kind_registry` 或文档化 allowlist：`kind_prefix`, `owner_domain`, `payload_schema_ref`, `deprecated_at`。这样保留 generic Memory，同时不完全放弃约束。

## Minor Findings

### m1 [MINOR] 风险数量描述自相矛盾

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:32`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:69-78`  
**Lens**: 正确性  
**Issue**: §0 说 “5 条贾维斯专属新风险 R-K..R-P”，但 §3 实际列 FJ1-FJ6 共 6 条。  
**Suggested fix**: 改成 “6 条贾维斯专属新风险”。

### m2 [MINOR] 一键全关的边界在 invariant 和 OQ3 中冲突

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:235`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:319`  
**Lens**: 跨端对齐 / 安全  
**Issue**: K-jarvis-3 表格说 kill switch 关闭 “跨 domain 跨 Subject 引用，degrade to v0.4.5”；OQ3 又说 author 倾向 “Observer / 主动 push 关，但 Memory 检索保留”。  
**Suggested fix**: 在 v0.1 就定义两档开关：`passiveMode` 只关 Observer/push，`strictLocalMode` 同时关跨 domain Memory 引用。

### m3 [MINOR] 主动性预算缺计数口径

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:292-295`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:221-223`  
**Lens**: 跨端对齐  
**Issue**: “≤7 条 / 周” 没定义计数维度：全局用户级、每设备、每 domain、每 Subject，周边界按本机时区还是 UTC。  
**Suggested fix**: 默认定义为 “user-global, local timezone week, all devices combined”，server 统一计数，iOS 只显示状态。

## False-Positive Watch

- F? `SQLCipher` 是否算 “新基础组件” 可能需要用户最终解释边界；但按当前 `HARNESS_ROADMAP.md §0 #11` 原文，它至少不是已允许依赖，因此不能在 proposal 中直接宣称不冲突。
- F? M5 `routine` exit condition 可能作者本意是 “用 retrospective 占位”，不是实际 push/Memory 写入；但当前文字包含 “每天 push” 和 “落 Memory 表”，后续执行者会按字面验收。

## What I Did Not Look At

- 没有读取 author transcript / 思考流。
- 没有读取另一位 reviewer 的 verdict。
- 没有运行 migration，只静态读取 SQL。
- 没有联网核验外部竞品和 benchmark 数据。
- 没有检查 Swift / TS 实现文件，因为本次是长期 proposal phase 1，不是 patch review。
