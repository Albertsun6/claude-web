---
stage: discovery
version: 1.0
appliesTo: universal
approvedBy: user, reviewer-cross, reviewer-architecture
approvedAt: 2026-05-03
---

# Discovery 方法论 v1.0

> **状态**：M-1 必产方法论 #1。覆盖 universal（适用 claude-web 自身 + enterprise-admin 项目）。
>
> **关联**：[HARNESS_ROADMAP §12](../docs/HARNESS_ROADMAP.md) · [HARNESS_DATA_MODEL.md §1.3](../docs/HARNESS_DATA_MODEL.md) · [HARNESS_CONTEXT_PROTOCOL §3 discovery](../docs/HARNESS_CONTEXT_PROTOCOL.md)

---

## 1. 输入定义

Discovery Stage 从五大来源提炼 Issue：

| 来源 | 路径 | 加权（M-1 默认） |
|---|---|---|
| `ideas_md` | `docs/IDEAS.md` 中未画掉的条目 | 1.0 |
| `user_feedback` | 直接对话 / Telegram 转发 / Inbox triage 后的想法 | 1.5（最高） |
| `git_log` | 最近 N 次 commit 的 chore/fix 模式（重复出现可能是 hidden Issue） | 0.6 |
| `telemetry` | `~/.claude-web/telemetry.jsonl` warn/error 频次 | 1.0 |
| `inbox` | `~/.claude-web/inbox.jsonl` 未 triage 的 IdeaCapture | 1.2 |

**必填 ContextBundle 输入**（[HARNESS_CONTEXT_PROTOCOL §3](../docs/HARNESS_CONTEXT_PROTOCOL.md)）：
- `docs/IDEAS.md` 当前内容
- `docs/IMPROVEMENTS.md` 当前内容
- 最近 50 条 git log 摘要
- `~/.claude-web/telemetry.jsonl` 末 200 行
- 未 triage `idea_capture` 行（按 captured_at desc 50 条）

**可削（按 budget）**：旧 Issue 标题 list（仅 status='done' 最近 30 天）

**Context Manager 行为**：找不到上述任一 mustInclude → Task 直接 fail（[ADR-0014](../docs/adr/ADR-0014-context-bundle-explicit.md)）。

---

## 2. 产出定义

每个 Discovery Stage 产 **0..N 条 Issue draft**（不 commit 到 DB，先以 Artifact 形态产出由用户 triage）：

```yaml
title: ≤ 60 字符
body: 100..500 字描述（含来源引用）
source: ideas_md | user_feedback | git_log | telemetry | inbox
priority: low | normal | high | critical
labels: [...]   # security / migration / cross-package / refactor / docs / ...
projectId: required
initiativeId: optional   # 如能挂上则挂
risk_high: bool          # 触发 risk-triggered 双 reviewer
```

**必产 Artifact**：`discovery-output-<TS>.md`（kind=`spec`），content 是 Issue draft 列表。

**失败回退**：5 大来源都为空（罕见）→ 产空列表 + retrospective 标记"无可发现"。不报错。

---

## 3. Agent 提示词模板

```
你是 Discovery Agent (PM Profile)。读以下输入：
{ContextBundle 内容}

按以下规则输出 0..N 条 Issue draft：
1. 优先级排序：source 加权 × 重复出现次数 × 紧急度
2. 去重：标题相似 (Levenshtein < 5) 的合并为一条
3. 不抢 Coder 工作：不写实现细节，只描述"什么 + 为什么 + 验收边界"
4. 标 risk=high：触及 security / migration / cross-package / 不可逆操作
5. 输出 yaml-front-matter + markdown body 格式

不允许：
- 自由读 cwd 文件（不在 ContextBundle 中的文件不可读）
- 推测"应该"做什么（Issue body 必须有 source 引用）
```

**Skill 集**：（无）—— Discovery 只读纯文本，不需特殊技能

**工具白名单**：仅允许写入 stage.output_artifact_ids（产 Issue draft Artifact）。**不允许**调 Bash / Edit / Write / Glob / Grep。

**Permission mode**：`plan`（read-only）

---

## 4. 人审 checklist

每条 Discovery 产出的 Issue draft 必须人审通过才进 `issue` 表。Decision 表单：

```yaml
options:
  - approve: 直接进 issue 表 status=triaged
  - reject: 丢弃 + 写 reason 到 retrospective
  - merge_into: 合并到现有 Issue（要求选 issueId）
  - request_info: 退回 Discovery Agent 补充信息
```

**跳过人审条件**（自动 approve）：
- source ∈ (telemetry, inbox) AND priority='low' AND labels 不含敏感（security/migration/cross-package）

其他必走人审。

---

## 5. QA 标准

Discovery Stage 不走双 reviewer（轻量 light Stage）。单 reviewer-architecture 抽样：

- 每 N=5 条产出抽 1 条评审：
  - 来源引用是否准确
  - 优先级判断是否合理
  - 是否漏掉同类已存在 Issue
  - 是否把"实现细节"误塞进了 spec body

评分维度：`accuracy | completeness | non-duplication`，每维 0..5。

抽样命中率 < 3.5/5 → 触发方法论调整 ritual。

---

## 6. Retrospective 触发

每 5 条 Discovery 产出累积一份 retrospective.md：

- 5 大来源各自命中率（产 Issue / 评审通过 比）
- 加权系数是否需要调整（用户 manual override 频次反映）
- 自动 approve 比例（< 30% 表明 risk 判断过严；> 70% 表明判断过松）

**Round 2 arch 加字段："carried-over observation items"段必须包含**：
- 上次 retro 中标记 "M2 观察" 的项是否已闭环
- 未闭环的迁移到本 retro 顶部高亮

阈值偏离触发方法论 v2 候选起草——**走 [methodologies/EVOLUTION.md](EVOLUTION.md) ritual**，不自动升级。Round 1 arch MAJOR-5 修复：避免阈值刷分诱导。

---

## 7. 企业管理系统专属附加（Round 1 arch M4 降级：discovery 仅"指向 + 标记"）

进入企业 admin 项目时附加规则。**discovery 阶段不强填具体字段 diff** — 只识别 Issue 涉及哪些段，具体字段 / 步骤 / 报表口径 diff 在 [01-spec.md §7](01-spec.md) 阶段细化。

### 标记段 4 项

Discovery Agent 必须在 Issue body 末尾加 `enterpriseImpact:` 标签，列出 Issue 涉及的**段名**：

```yaml
enterpriseImpact:
  businessEntities: ["customer", "order"]    # 指向受影响实体
  permissionMatrix: true                     # 是否涉及角色 / 权限点变化（true / false / unknown）
  approvalSteps: false                       # 是否涉及审批流变化
  reportSchemas: unknown                     # 是否涉及报表 / 数据导出
```

具体字段 diff / 步骤变化 / 报表口径在 spec 阶段填。

> Round 1 arch M4 修正：原文档说 4 段在 discovery 是"硬性必填"具体内容；实际 user_feedback/inbox 来源 80% 写不出 schema diff，导致 PM Agent 频繁 request_info。降级为"指向 + 标记"，让 Discovery 关注"对的范围 + 高粒度风险标"，spec 阶段才填字段。

### 不允许

- ❌ 自动推断 schema diff（必须 request_info 让用户细化）
- ❌ 跳过 enterpriseImpact 段（即使所有标记都是 false 也要写出）
- ❌ 把 spec 级别细节塞进 discovery（违反 §3 prompt "不抢 Coder/PM 工作"）
