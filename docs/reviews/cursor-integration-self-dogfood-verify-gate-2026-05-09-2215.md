# Verify Gate Result — Cursor Integration Self-Dogfood

- **Date**: 2026-05-09 22:15
- **Artifact**: cursor-cli cross-reviewer 集成（ADR-017 + SKILL.md + cursor-review.sh + spike report）
- **Reference**: [P3 arbiter](cursor-integration-self-dogfood-p3-arbiter-2026-05-09-2210.md)

---

## 5 项 Verify Gate 结果

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 1 | **Finding 闭环**：9 项 finding 都有矩阵裁决 | ✅ **PASS** | accepted 5 / partial 2 / rejected 0 / hung 0 / 2 F? 已决 |
| 2 | **修复落地**：accepted finding 在文件 grep 到改动 | ✅ **PASS** | 7 项立即修：M1→ADR-017 验证段 / M2→cursor-review.sh preflight / m3→ARTIFACT_NAME 限制 / M3→help check / m4→SKILL escape hatch / m1→spike §6 / m2→spike §2 |
| 3 | **回归测试**：脚本可执行 | ✅ **PASS** | `bash -n` 语法通过；m3 路径注入防护实测拦截 `../bad/name`；help 输出正确 |
| 4 | **链接完整性 + Doc 一致性** | ✅ **PASS** | 7 个核心文件全部存在；ADR-017 含 2 处 Prior Art 段 + 2 处 spike report 引用；Eva 提及 10 次（外部仓库正确称呼）/ EVA 大写 0 次（M2-Soul 之前不该出现，**正确**） |
| 5 | **调研引用**：ADR-017 引 prior art | ✅ **PASS** | ADR-017 含完整 Prior Art 段，引用 `docs/research/cursor-cli-cross-reviewer-2026-05-09.md` |

## 整体结果：✅ **5 项全 PASS**

---

## Self-Dogfood 完成判定

| 判定标准 | 状态 |
|---|---|
| ✅ `cursor-review.sh` 跑通 | 51309 bytes prompt → 6422 bytes verdict |
| ✅ cross verdict 文件存在 | `docs/reviews/cursor-integration-self-dogfood-cross-2026-05-09-2205.md` |
| ✅ 5 个 lens 都被覆盖 | verdict 含 5 lens 数值 score（3.4 ~ 4.0）|
| ✅ Lens 5（集体盲区检测）至少尝试一条 | m4 finding 是 Lens 5 真捕到 over-cautious 痕迹 |
| ✅ findings 被 Phase 3 正常 4 档分类 | accepted 5 / partial 2 / 0 rejected / 0 hung |
| ✅ **无 reward gaming**（M1 修复后）| ADR-017 验证段已去掉"必须找出 BLOCKER/MAJOR" |

---

## 异质性证明（self-dogfood 核心结果）

cursor-agent gpt-5.5-medium 找出的 finding 全部是**Claude 自己写时没看到**的：

| Finding | Claude 盲区类型 |
|---|---|
| **M1**（验证段 reward gaming） | **Incentive 偏差**：Claude 在写 ADR-017 时不自觉植入"出 finding 才证明值"动机 |
| **M2**（prompt 外发无脱敏） | **Spec/impl 脱节**：spike report §9 写了风险但 script 没落实，Claude 自审会"信 ADR 已 say" |
| **m3**（ARTIFACT_NAME 注入） | **Bash 安全盲区**：常见但 Claude 写时漏 |
| **m4**（Phase 2 disagree 硬约束 reward gaming） | **Lens 5 真捕集体盲区**：vessel-cross 用异质模型挑战 Vessel 自己的 over-cautious 设计 |
| m1, m2（path / stdin 描述不一致） | **Doc 一致性**：Claude 自己写跨文件难发现 |

**核心结论**：cursor-agent 作为 vessel-cross-reviewer 的**异质性已实证有效**。这次 self-dogfood 是 ADR-014 + ADR-017 + B' 评审工作流的**首次完整真实跑通**——不是同模型扮演，而是真异质源。

---

## 0-meta-lite 完整收尾状态（v5.4.x 增量）

之前 0-meta-lite 完成时缺真异质性（ADR-014 lite 用 Claude 主会话扮演 4 reviewer）。**本次 cursor 集成补上了这个最大短板**。

新增产物（v5.4.x，v5.4 lite 之上的增量）：
- ✅ `docs/research/cursor-cli-cross-reviewer-2026-05-09.md`（spike report，10 段，Status=accepted）
- ✅ `docs/adr/vessel/ADR-017-cursor-cli-cross-reviewer.md`（Status=Accepted）
- ✅ `.claude/skills/reviewer-cross/SKILL.md`（Vessel 项目级，含 5 lens + Independence Constraints + Activation）
- ✅ `.claude/skills/reviewer-cross/LEARNINGS.md`（空起步）
- ✅ `scripts/cursor-review.sh`（含 preflight gitleaks/private-path 检查 + path injection 防护 + version check）
- ✅ 1 次 self-dogfood 完整跑通：1 P1 verdict（cursor）+ 1 P3 arbiter + 1 verify-gate result

**累计 0-meta-lite 工作量**：~3 小时（v5.4 dogfood 1.5h + cursor 集成 1.5h）。

---

## 下一步（v5.4.x 后）

按 v5.4 plan 进入 **0-pre**（Eva 盘点 + 适配层设计）。

**0-pre 评审策略**：
- 先做 vessel-architect / vessel-pragmatist / vessel-risk-officer 三角 Phase 1（Claude 主会话）
- **再加 vessel-cross-reviewer**（cursor-agent，已就位）—— 这次是 4-way Phase 1
- Phase 2 cross-pollinate 仍手动（v5.4 lite 范围）
- 0-pre 是真正的 milestone closeout——按 ADR-014 escalation 触发器 #4，结束时也跑外部 AI 终审（不算 cursor，因为 cursor 已是 Phase 1 reviewer 之一了）

---

## Open Questions（留给后续真实 milestone 评审）

1. cursor 在 m4 提到的"Phase 2 硬约束 reward gaming" —— 已加 escape hatch；但每次评审是不是真的用得上？需要观察 1-2 个 milestone。
2. `--allow-private-paths` flag 在什么场景该用？目前只有 dev 自己 audit Eva 仓库时。文档 case 应该都不用。
3. Eva LEARNINGS.md 累积了 6 条经验（DB schema / Zod / Swift Codable / WS event / spawn race / DATA_DIR）—— Vessel 自己第一条 LEARNING 应该是什么？预测：从 0-pre 第一次 4-way 评审中累积。
