---
stage: meta
version: 1.0
appliesTo: universal
approvedBy: user, reviewer-cross, reviewer-architecture
approvedAt: 2026-05-03
---

# Methodology Evolution Ritual

> **状态**：M-1 末尾立项（Round 1 arch MAJOR-5 修复）。
>
> **关联**：[HARNESS_ROADMAP §16 进化体系](../docs/HARNESS_ROADMAP.md) · [00-discovery.md §6](00-discovery.md) · [01-spec.md §6](01-spec.md)
>
> **目的**：方法论 v1 → v2 / v3 ... 升级路径。原 LEARNINGS rule #4 警告"指标会诱导刷分"，本文是反刷分的 ritual。

---

## 1. 触发条件（自动产 retrospective ≠ 自动升级）

每 Stage 的方法论 §6 定义了"阈值偏离触发"。**触发**意味着：
- 自动产一份 `methodology-v2-candidate-<stageKind>.md` Artifact
- 状态 `draft`
- 通知用户：retrospective 中 N/M 阈值偏离，建议起草 v2

**不自动升级到生产用 v2**——从 draft 到 v2 必须走 ritual。

阈值由方法论 §6 定义；典型阈值：
- 平均人审次数 > 目标值
- 多 reviewer 分歧率 > 30%
- 同类错误重复 ≥ 5 次（reviewer 反复挑出"企业必填段写错"等）

**反刷分**（LEARNINGS rule #4）：阈值不能是单一指标。需要至少满足 2 个不同维度才触发，避免 agent 通过批量低难度 Issue 拉低均值规避升级。

---

## 2. v2 起草流程（Ritual）

1. **用户启动**（不允许 agent 自动）—— 用户读过 `methodology-v2-candidate-*.md` 后决定是否起草
2. **PM Agent 起草** v2.md，输入：
   - 当前 v1 内容
   - 累积 retrospective 列表（含偏离指标）
   - 类似项目的 v2 经验（如有）
3. **Reviewer-cross + Reviewer-architecture 双审**（独立 prompt）
4. **用户拍板**——这是 ritual gate，不是可选项

---

## 3. v1 / v2 并存窗口

当 v2 通过 ritual：
- **新 Issue** 默认绑 v2（`Issue.methodologyVersion = "2.0"`）
- **In-flight Issue**（已 spec / design / implement 中）**锁 v1**——不允许中途切版本，避免 reviewer 看 v2 prompt 评 v1 输出
- **Initiative.methodologyVersion** 字段是 hard reference，迁移需要新 ritual
- 并存窗口持续到所有 in-flight v1 Issue done / wont_fix（预计 1-2 周自然代谢）

---

## 4. 已 ship Artifact 不动

v1 时期产的 Artifact / ReviewVerdict / Decision 永不重新评审。v2 ritual 仅影响新 Issue。

---

## 5. v2 反向验证（先观察后启用）

v2 通过 ritual 后**不立即默认应用**。先在 1 个 toy Issue 上跑一遍：
- 走完整 stage chain
- Reviewer 对比 v1 vs v2 verdict
- 如果 v2 显著差于 v1（评分 < v1 均值 0.5），回退 v2 状态为 `revoked`，重新起草

只有 toy Issue 通过验证 + 用户拍板，v2 才进入生产用。

---

## 6. 失败回退

任何阶段发现 v2 引入回归：
- `Initiative.methodologyVersion = "1.0"`（一键回滚）
- 已用 v2 的 in-flight Issue 锁住 v2（不切回 v1，避免再次切版本污染）
- 新建 Issue 默认 v1
- 写 retrospective 解释 v2 失败原因，作为下次起草输入

---

## 7. v2 上限

不允许同时存在多于 2 个版本（v1, v2）。若 v2 失败要起 v3，必须先把 in-flight v2 Issue 全部完结或显式 revoked。**单调演化**，不并存 v3、v4。

---

## 8. M-1 完工状态

- [x] 本文件是 v1.0 placeholder。具体阈值、自动产 candidate Artifact 流程在 M3 跑足够多 retrospective 后再细化。

**留给 M3+**（首次 v2 起草前）：
- `methodology-v2-candidate.md` 模板
- retrospective.md → candidate 自动转换 prompt
- toy Issue 选择规则（用什么样的 Issue 验证 v2）
