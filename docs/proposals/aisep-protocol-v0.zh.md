# 提案：AISEP 协议 v0.1（阶段 1 契约）

> 状态：供交叉评审的草案（2 名评审人）  
> 模式：`contract`（按 `harness-review-workflow` skill 约定）  
> 分支 / 提交：`feat/aisep-bootstrap` @ `4e829be`  
> 评审人：vessel-architect（Claude 主会话）+ reviewer-cross（cursor-agent gpt-5.5-medium）

## 1. 摘要

本提案请评审人确认 `packages/aisep-protocol/` 中交付的 AISEP v0.1 线格式协议。协议将以下内容形式化：

- 10 阶段 AISEP 方法论 DAG（intake → research → plan → architecture → contract → implement → verify → review → integrate → retrospect）
- architecture 阶段内部 2 阶段 + 增量切片设计
- AlphaEvolve 双层记忆模型（workspace pending → global verified）
- ArchiMate 动机层 requirements.yaml 模式
- TraceChain（REQ → ADR → ZOD → RISK）用于机器可验证的血缘
- 评审结论模型与强制 `trace_id` 绑定（反对模糊「感觉」式反馈）

所有 schema 使用 zod 3.x，并以 `Aisep*` 命名空间前缀，避免与 `@claude-web/shared/harness-protocol.ts` 冲突。

## 2. 评审人说明

### 2.1 评审角色

- **vessel-architect**（Claude 主会话）— 整体架构一致性、跨端对齐、AISEP 范围蔓延风险、命名一致性
- **reviewer-cross**（cursor-agent gpt-5.5-medium，plan 模式）— 异构视角：集体盲区、非 Anthropic 生态替代方案、zod 特有坑、训练截止后的新进展

### 2.2 乒乓上限

≤ 2 轮（M4 红线）。第 3 轮 = 砍范围，而非第三次修订。

### 2.3 仅逻辑焦点（Anthropic Code Review 2026-03）

评审人**不**评论：

- 代码注释中的风格 / 语法 / 笔误
- 文档是否「每节都可以写得更细」
- 无正确性影响的命名抬杠

评审人**要**评论：

- zod schema 形状是否正确
- 7 问锚点门是否满足
- `trace_id` 链是否完整（无孤儿）
- 是否忽略了非显而易见的对立设计方案

### 2.4 评论格式（阶段 1 计划的 R5）

每条评论**必须**绑定到 `(artifact, trace_id, severity, suggestedAction)`。  
类似「我觉得大方向不对」的模糊反馈将不予采纳，除非能落到上述结构。

## 3. 7 问锚点门（阶段 A LCA 等价）

| # | 问题 | 答复 |
|---|------|------|
| Q1 | **数据模型** — 核心实体是否冻结？ | 是。11 个 zod schema（Stage / Phase / Status / Run / Artifact / ArtifactKind / Attempt / WorkspaceMeta / Requirements / Memory / Review / Trace）以严格类型 + 元组枚举定义。22 个 fixture 上做过往返测试。 |
| Q2 | **协议** — 线格式是否冻结？ | 是。JSON，经文件 / stdio / SQLite。camelCase 字段、epoch 毫秒时间戳、不透明 ID、`sha256:<hex>` 内容哈希。`AISEP_PROTOCOL_VERSION = "0.1.0"` + `MIN_CLIENT_VERSION = "0.1.0"`。升版规则见 `version.ts`。 |
| Q3 | **兼容性** — vessel 主线不变量是否保持？ | 是。R1/R2/R3/R4/R6 均由 `.dependency-cruiser.cjs` 强制执行。经验证：`pnpm test:protocol`（123/123 通过）、`pnpm dep-cruiser:check`（138 模块、0 违规），主 vessel worktree 无已修改文件。 |
| Q4 | **不可逆决策** — 是否列出并含回滚计划？ | 是，见下文第 4 节。 |
| Q5 | **权限** — fs / net / spawn 边界是否清晰？ | 是。`AisepWorkspace` 接口是 fs/exec 的**唯一**表面；`aisep-core` **不得** import `aisep-workspace`（R6，由 dep-cruiser 强制）。`aisep-protocol` 本身零副作用表面（纯 DTO + 接口声明）。 |
| Q6 | **资源争用** — 并发 / 锁文件 / SQLite 是否覆盖？ | **部分**。v0 协议为每 `stage_run` 单写者（M1 状态机）。SQLite + 文件锁将在 `aisep-core` 阶段 2 定义。协议层不需要并发原语。 |
| Q7 | **回滚** — 失败恢复路径？ | 是。(a) `AisepAttempt.attemptN ≤ 2` 落实乒乓上限。(b) `AisepArtifact.contentHash` 不可变支持 LKG 快照新鲜度检查。(c) `AisepStageRun.status` 含 `cancelled` 表示用户显式中止。(d) 自托管兜底（git tag 金快照 + `aisep --bypass`）在本协议包外（aisep-cli 职责）。 |

## 4. 不可逆决策（若修订需 ADR）

| # | 决策 | 若修订的迁移成本 |
|---|------|------------------|
| 1 | 包命名空间 `@claude-web/aisep-protocol`（与 dev 分支约定一致） | 重命名影响 N 处 import，但可机械替换 |
| 2 | `Aisep*` 类型前缀，避免与 `@claude-web/shared/harness-protocol` 冲突 | 机械重命名 |
| 3 | v0.1 冻结 10 阶段枚举（`intake / research / plan / architecture / contract / implement / verify / review / integrate / retrospect`） | 增阶段 = MINOR；删/改名 = MAJOR |
| 4 | architecture 阶段 2 阶段 + 增量切片（在 `AisepStagePhase` 枚举中） | Phase A/B 拆在线枚举里 — 若改为 V-Model 两阶段需 schema 迁移 |
| 5 | camelCase 线格式（相对 harness-protocol 既有约定） | v0.1 锁定；跨端（Swift）往返需保持 |
| 6 | `AisepAttempt.attemptN ≤ 2` 硬上限 | 放宽需重新评估反谄媚回归风险 |
| 7 | TraceId 命名空间 `^(REQ|ADR|ZOD|RISK|G|D|C|P|S)-` 正则 | 增命名空间 = MINOR；改已有 = MAJOR |
| 8 | `AisepArtifactKind` 15 值枚举 | 增 kind = MINOR；改名 = MAJOR |
| 9 | `AisepWorkspace` 为 TS 接口（**非**线 DTO） | 若升为线 DTO 需为 `exec()` 结果做序列化，复杂度高；保持为运行时接口 |
| 10 | zod 3.x 依赖（即便 zod 4 发布也不用） | 大版本 zod 升级可能需重生成 fixture |

## 5. 跨端兼容矩阵（v0.1）

| 方向 | 状态 | 说明 |
|------|------|------|
| TS → JSON → TS 往返 | ✅ 已验证（22 fixtures） | `protocol-round-trip.test.ts` |
| TS → JSON → Swift 往返 | ⏳ v0 不适用（无 Swift 消费者） | 预留给 v2（iOS AISEP UI） |
| TS → JSON → Python 往返 | ⏳ 不适用 | newaisep 借用代码在 `~/.aisep/reference-library/`，不在协议路径内 |
| Schema → JSON Schema 导出 | ⏳ 阶段 2 交付物 | 将使用 zod-to-json-schema |

## 6. 异构评审焦点（专给 reviewer-cross）

reviewer-cross 应显式探查四类 Claude 盲区：

1. **训练截止后进展**：是否存在 zod 4.x 模式或其它校验库（valibot、arktype 等）能显著改善 schema 编写体验？若有，是否值得从 zod 3 迁移？
2. **非 Anthropic 生态替代**：是否有成熟 AI agent 编排协议（如 AG-UI、MCP server schema、OpenAI Agents SDK 消息格式）值得 AISEP 对齐以利互操作？
3. **主流定义漂移**：2025–2026 年「标准」AI 编程 harness 架构是否已变化，使 10 阶段 DAG 显得过时？
4. **小众但成熟设计**：是否有 ICSE / FSE / TSE 2024–2026 的 SDLC 论文描述线格式，预判了 AISEP v0.1 尚未覆盖的问题？

## 7. 本轮评审范围外

- `aisep-core` / `aisep-workspace` / `aisep-agents` / `aisep-memory` / `aisep-context` / `aisep-cli`（阶段 2）
- SQLite DDL（阶段 2；草案在 `docs/aisep/02_methodology-v0.1.md` 第 5 节）
- 试点 bug-fix 工作流（阶段 3）
- newaisep Odoo 模式迁移到 `~/.aisep/reference-library/`（独立阶段，见 `docs/aisep/borrowed/newaisep-extraction-plan.md`）
- ADR-018 本身（已在阶段 0 提交；不在本提案内）

## 8. 验收标准

评审人应给出 `pass / pass_with_comments / revise_required` 之一：

- **pass**：无 critical+major，≤ 5 条 minor → 原样合并
- **pass_with_comments**：≤ 1 条 critical **或** ≤ 5 条 major，且作者可在 ≤ 1 轮内处理 → 作者更新后合并
- **revise_required**：≥ 2 条 critical **或** > 5 条 major **或** 发现根本性设计缺陷 → 作者修订后重新提交（按 M4，第二轮为最后一轮）

作者（Claude 主会话）将把仲裁结论记入 `docs/proposals/aisep-protocol-v0-arbitration.md`，使用 `accept / partial / reject` 矩阵。

## 9. 给评审人的索引

- 代码：`packages/aisep-protocol/src/`
- Fixtures：`packages/aisep-protocol/fixtures/aisep/`（21 个文件）
- 测试：`packages/aisep-protocol/src/__tests__/`（39 个测试，全部通过）
- README：`packages/aisep-protocol/README.md`
- 计划（事实来源）：`~/.claude/plans/ai-vessel-vessel-bubbly-noodle.md` 中「Phase 1: 协议骨架 + cross-review」
- ADR-018：`docs/adr/vessel/ADR-018-aisep-vs-harness.md`
- 方法论：`docs/aisep/02_methodology-v0.1.md`
- Architecture 阶段规范：`docs/aisep/03_architecture-stage-spec.md`
- 记忆本体：`docs/aisep/04_global-memory-ontology.md`
- newaisep 抽取：`docs/aisep/borrowed/newaisep-extraction-plan.md`
