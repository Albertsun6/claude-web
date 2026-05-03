---
stage: spec
version: 1.0
appliesTo: universal
approvedBy: user, reviewer-cross, reviewer-architecture
approvedAt: 2026-05-03
---

# Spec 方法论 v1.0

> **状态**：M-1 必产方法论 #2。覆盖 universal，含 enterprise-admin 必填段（[HARNESS_ROADMAP §0 #6 + §12](../docs/HARNESS_ROADMAP.md)）。
>
> **关联**：[HARNESS_DATA_MODEL.md §1.10](../docs/HARNESS_DATA_MODEL.md) Artifact.metadata_json · [HARNESS_CONTEXT_PROTOCOL §3 spec](../docs/HARNESS_CONTEXT_PROTOCOL.md) · [00-discovery.md](00-discovery.md)

---

## 1. 输入定义

Spec Stage 把 triaged Issue 写成可验收 spec.md。输入：

**必填 ContextBundle**：
- 当前 `issue.body` + 元数据（labels / priority / source）
- 上游 Discovery 的 `discovery-output-*.md`（如果有）
- 同 stage_kind=spec methodology v1.0（本文）
- **类似 Issue 的 spec.md**（按 issue.title 模糊匹配 + label 重合度，最多 3 份）
- 业务实体既有清单（如 enterprise-admin 项目的 customer/order schema 摘要）

**可削**：完整 issue history、telemetry。

**找不到 mustInclude → Task fail**（[ADR-0014](../docs/adr/ADR-0014-context-bundle-explicit.md)）。

---

## 2. 产出定义

必产 1 份 `spec.md` Artifact（kind=`spec`），结构：

```markdown
# Spec — <Issue.title>

## 1. 目标
（1 段；从 Issue.body 提炼 + 验收成功标准）

## 2. 范围
- 在范围：...
- 不在范围：...

## 3. 验收准则（可测试化）
- [ ] 准则 1（每条都要写明可测路径：单测 / 集成 / 手测）
- [ ] 准则 2
- ...

## 4. 数据迁移策略（如涉及 schema 改动）
（按 [ADR-0015](../docs/adr/ADR-0015-schema-migration.md) 三档：major/minor/patch）

## 5. 企业管理系统必填段（详见 §7）
（如本 Stage applied to enterprise-admin，必填 4 段）

## 6. 风险与不可逆点
- 不可逆操作清单（DB migration / 真实 API / 部署 / 付费）
- 是否触发 risk-triggered 双 reviewer

## 7. 失败回退
（如何 git revert / 数据回滚）
```

**Artifact metadata_json**（Round 1 arch 垂直#8 部分接受）：

```json
{
  "businessEntities": ["customer", "order", ...],
  "permissionMatrix": { "admin": ["read", "write"], "viewer": ["read"] },
  "approvalSteps": ["manager-review", "compliance-review"],
  "reportSchemas": [...]
}
```

**失败回退**：spec 不能写出可测试化的验收准则 → Task fail，要求 Discovery 阶段重新捕获 Issue。

---

## 3. Agent 提示词模板

```
你是 PM Spec Agent。读以下输入：
{ContextBundle 内容}

按以下规则输出 spec.md（markdown）：
1. 验收准则必须可测试 — 不允许"提升体验"这种空话
2. 数据迁移段必须明确 schema bump 等级（major/minor/patch）
3. 不可逆操作清单必须穷举（DB migration / API key 用法 / 部署命令 / rm -rf）
4. 企业必填段（businessEntities / permissionMatrix / approvalSteps / reportSchemas）：
   - 当 Issue 涉及对应业务时填；不涉及时显式写 "N/A — <原因>"
   - 不允许留空或省略段落
5. 输出 yaml frontmatter + markdown body
```

**Skill 集**：（无）—— spec 是纯文档产出

**工具白名单**：仅允许写入 stage.output_artifact_ids。**不允许**写 packages/ 任何代码。

**Permission mode**：`plan`（read-only）

---

## 4. 人审 checklist

Spec Stage `gate_required = true`（必须人审）。Decision 表单：

```yaml
options:
  - approve: spec.md 通过 → stage status=approved
  - request_changes: 需修改 → 退回 PM Agent
  - reject: 整体重做（回 Discovery）
  - escalate: 升级用户决策（reviewer 分歧时自动触发）
```

**跳过人审条件**：无（spec 是流水线起点，永远人审）。

---

## 5. QA 标准（risk-triggered 双 reviewer）

**Risk 触发条件**（任一即触发双 reviewer）：
- `Issue.priority` ∈ (high, critical)
- `Issue.labels` 含 security / migration / cross-package
- 用户在 spec 起草前手动标 `risk_high=true`
- 涉及企业管理系统必填段中"权限矩阵"或"审批流"变更

**双 reviewer 分工**：
- `Reviewer-compliance`（默认 model: sonnet）—— 评 compliance / 验收准则可测试性 / 不可逆操作清单完备性
- `Reviewer-cross`（默认 model: gpt-5.5-medium via cursor-agent CLI）—— 评 跨端对齐 / 风险盲区 / 简化机会

**评分维度**（每维 0..5）：
- correctness（准则是否精确）
- completeness（必填段是否齐）
- alignment_with_spec（与 Issue.body 一致度）
- security（不可逆操作 / 权限点）
- maintainability（spec 是否清晰可读）

**分歧升级阈值**：任一维度差 ≥ 2 分 → 自动升级用户人审。

---

## 6. Retrospective 触发

每 5 条 spec 产出累积 retrospective：
- 平均人审次数（≤ 3 是健康，> 5 触发方法论调整 ritual）
- "企业必填段写错" 频次（指 reviewer 反复挑出的同类错）
- 分歧率（双 reviewer 任一维度差 ≥ 2 的比例）
- 通过到下游 design stage 后被驳回率

**Round 2 arch flag："carried-over observation items"段必须包含**：
- 上次 retro 中标记 "M2 观察" 的项是否已闭环
- 未闭环的迁移到本 retro 顶部高亮

**阈值偏离触发**方法论 v2 候选起草——**走 [methodologies/EVOLUTION.md](EVOLUTION.md) ritual**：用户启动起草（不允许 agent 自动），三方独立审，先 toy Issue 验证再生产用。Round 1 arch MAJOR-5 修复：阻止单一指标刷分诱导自动升级。

---

## 7. 企业管理系统专属必填段（硬性）

> **关键**：本段是 [HARNESS_ROADMAP §0 #6 + §12](../docs/HARNESS_ROADMAP.md) 的"企业字段必填段"实施。**spec 阶段必填**，不是附加。

### 业务实体补充

每条 spec 必须列出：
- **受影响业务实体清单**（指向 schema 中的具体 entity，如 `customer`, `order_line`, `audit_record`）
- **每实体的字段变更**（add / modify / remove + before/after 类型）
- **跨实体引用关系**变化（FK / cascading 行为）

不涉及时显式写 `businessEntities: []  # N/A — 只改 UI` 不允许省略段落。

### 权限矩阵补充

每条 spec 必须列出：
- **受影响的角色**：admin / manager / employee / viewer / 自定义角色
- **每角色的权限点变化**：read / write / delete / approve / export / 自定义动作
- **角色之间的 escalation 路径**（如 employee → manager 提交审批）

不涉及时显式写 `permissionMatrix: { ... unchanged ... }`。

### 审批流补充

每条 spec 必须列出：
- **触发条件**（如 `customer.creditLimit > 100000` 触发合规审批）
- **当前审批步骤** vs **期望步骤**（diff）
- **超时行为**（auto-approve / auto-reject / escalate）
- **回滚路径**（撤销已生效的审批）

不涉及时显式写 `approvalSteps: []  # N/A — 此 Issue 不改审批流`。

### 报表口径补充

每条 spec 必须列出：
- **报表名 + 数据来源表**
- **聚合粒度**（日 / 周 / 月 / 实体级）
- **期望字段组合**
- **历史口径兼容**（旧报表数据是否仍可重算）

不涉及时显式写 `reportSchemas: []  # N/A`。

---

## 8. 数据迁移策略子段（Round 1 cross 反馈：要明确）

> 用户在 dogfood 第一个 Issue 时反馈过"老数据兼容窗口"应作为必填——本子段实施。

每条改 schema 的 spec 必须包含：

- **schema bump 等级**：patch / minor / major（[ADR-0015](../docs/adr/ADR-0015-schema-migration.md)）
- **老数据兼容窗口**：
  - patch：永久兼容
  - minor：永久 additive 兼容
  - major：1 个 minor 兼容窗口；过期老数据自动 backfill 路径
- **回滚 SQL**：可执行的 down migration 草案
- **数据验证 query**：迁移后跑哪条 query 验证完整性
