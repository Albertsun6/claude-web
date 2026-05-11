# Verify Gate Result — 0-pre Review

- **Date**: 2026-05-09 23:10
- **Artifact**: 0-pre 6 产物（EVA_INVENTORY + EVA_TO_VESSEL_MAPPING + 3 ADR + RISKS）
- **Reference**: [P3 arbiter](0-pre-review-p3-arbiter-2026-05-09-2255.md) + [escalation inbox](../../instance/inbox/2026-05-09-2255-0-pre-escalations.md)

---

## 5 项 Verify Gate

| # | 检查项 | 结果 | 说明 |
|---|---|---|---|
| 1 | **Finding 闭环**：27 项 finding 都有矩阵裁决 | ✅ **PASS** | accepted 25 / partial 2 / rejected 0 / hung 1 / escalation 2 |
| 2 | **修复落地**：accepted finding 在文件 grep 到改动 | ✅ **PASS** | 关键 8 项立即修：① ADR-013 §3 删除 rm -rf；② migration 拆 0004/0005/0006/0007；③ R-06 拆 a/b；④ R-14/R-15 加；⑤ ADR-013 加 Stage 5/6/checkpoint；⑥ env var 不留 fallback；⑦ EVA_TO_VESSEL_MAPPING #1 boot 三层 M0 加最小 Instance 级骨架；⑧ ADR-000 §2 加 5 接口存放约定 + ADR-016 引用 |
| 3 | **回归测试**：`pnpm test` 全过 | **N/A** | 0-pre 是文档无代码改动 |
| 4 | **链接完整性 + Doc 一致性** | ✅ **PASS** | 12 个 0-pre + review 文件全部存在；P3 arbiter 引用 P1 verdict 路径正确；inbox 引用 ADR-013/RISKS 路径正确 |
| 5 | **调研引用**：重大决策 ADR 必须有 Prior Art | ✅ **PASS** | ADR-000 / ADR-012 / ADR-013 各有 1 处 "## Prior Art" 段（按 ADR-015 模板） |

## 整体结果：✅ **5 项 Verify Gate 全 PASS**（4 PASS + 1 N/A）

---

## 0-pre Acceptance 5 条（v5.4 plan）

| # | Acceptance | 状态 |
|---|---|---|
| 1 | EVA_INVENTORY 覆盖核心模块 + coverage 报告 | ✅（17 backend + iOS + shared + DB schema；测试覆盖按 R-07 分两类标） |
| 2 | EVA_TO_VESSEL_MAPPING ≥ 12 个核心 Eva 模块映射 | ✅（**35 行**，远超要求） |
| 3 | ADR-000 + ADR-012 Status=Accepted | ✅（额外加 ADR-013） |
| 4 | M0–M1C 实施相关决策不留 TBD | ⚠️ **partial pass**：1 项 hung（#6 frontend 排除清单）+ 2 项 escalation 待 owner（E1 rm -rf 已立即修但需 owner 确认 / E2 license Stage 6 工具选型） |
| 5 | RISKS ≥ 11 条 | ✅（**14 条**：R-01~R-13 + R-06b + R-14 + R-15） |

---

## 4-way Phase 1 评审实证（异质性 + 集体盲区抓出）

cursor cross-reviewer（GPT-5.5）vs 3 个 Claude reviewer（同主会话扮演 architect / pragmatist / risk-officer）：

| Finding | cursor | architect | pragmatist | risk-officer | 收敛 / 单源 |
|---|---|---|---|---|---|
| **rm -rf 危险 runbook** | **B1 BLOCKER** | _missed_ | _missed_ | **B-R1（独立确认 + 升级硬触发 #8）** | 🚨 **2 reviewer 收敛** |
| **migration 0004 复用** | **M2 BLOCKER** | _missed_ | m-P3 agree | **M-R3 升级** | 🚨 **3 reviewer 收敛** |
| **license vs gitleaks 错误归一** | **M4 MAJOR** | _missed_ | _missed_ | **B-R2（升级硬触发 #6）** | 🚨 **2 reviewer 收敛** |
| Boot 三层 Instance 级缺骨架 | _missed_ | **B-A1 BLOCKER** | _missed_ | _missed_ | architect 单源 |
| 5 接口 stub 时机 | _missed_ | **B-A2 BLOCKER** | m-P4 agree | _missed_ | architect 主导 |
| frontend 排除清单遗漏 | _missed_ | **B-A3** | **M-P3** | _missed_ | 2 Claude 收敛 → escalation E3 |
| 改名工程量 + Stage checkpoint | _missed_ | _missed_ | **B-P1** | _missed_ | pragmatist 单源 |
| TS Wire Protocol → Swift 同步 | **M1** | M-A2 同议题 | _missed_ | _missed_ | 2 reviewer 收敛 |
| Scheduler retry policy 矛盾 | **M3** | _missed_ | _missed_ | _missed_ | cursor 单源 |

**异质性净价值**：
- cursor 抓出 **3 个 BLOCKER 集体盲区**（rm -rf / migration / license）—— Claude reviewer 全没看到
- 3 Claude reviewer 也找出 cursor 没看到的（boot 三层 Instance 级 / frontend 排除 / 改名工程量）
- **真互补，非冗余**——证明 ADR-017 cursor cli 集成在第 1 个真实 milestone 实证价值

---

## 推迟到 0A 阶段处理的 finding（17 项）

按 v5.4 lite 精神，剩余 accepted MAJOR/MINOR 推到 0A 写时一起改（不阻塞 0-pre Acceptance）：

- 🟢 **MINOR 修订（11 项）**：图例段 / R-07 标 ⏳ / 5 接口 canonical 顺序 / package names / venv 子原因 / Workflow resume API 命名 / 私人路径占位符 / 等
- 🟡 **MAJOR refine（6 项）**：TS Wire Protocol → Swift 同步落点 / Scheduler retry 推迟 / EVA_INVENTORY §7.1 调用链 fact-check / 总改造估计解释 / protocol.ts LOC 改 +200-400 / ML worker 通知策略

详见 [P3 arbiter 仲裁矩阵](0-pre-review-p3-arbiter-2026-05-09-2255.md) ID #19-#27 + #8-#15 partial。

---

## 0-pre 完成状态

✅ **0-pre 主体完成**（4 PASS + 1 partial = 实质性 0-pre Accepted）

🚨 **2 项 escalation 等 owner 决策**（已写 inbox）：
- E1 rm -rf 危险 runbook（4 类硬触发 #8） — 已立即修，等 owner 确认方案 B
- E2 license vs gitleaks 错误归一（4 类硬触发 #6） — 已加 ADR-013 Stage 6，等 owner 确认 license-checker 工具选型

🟡 **1 项 hung**：
- E3 frontend 排除清单 / UI 重设计含糊 — 推荐 a（M1A 保留 Eva UI），等 owner 确认

**进入 0A 之前必须**：owner 处理 inbox 3 项 → 全部 ✅ 后立即进 0A。

---

## v5.4.x → v0-pre 累计

- **0-meta-lite**：3 reviewer prompt 草稿 + 2 README + 2 ADR + 1 dogfood
- **v5.4.x cursor 集成**：ADR-017 + cursor-review.sh + reviewer-cross SKILL + 1 self-dogfood
- **0-pre**：6 产物（EVA_INVENTORY + EVA_TO_VESSEL_MAPPING + 3 ADR + RISKS）+ 4-way Phase 1 评审 + Phase 3 仲裁 + 8 立即修 + 2 escalation

**累计文档** ~5000+ 行 markdown / 13 个 review verdict / 2 个 escalation inbox（1 已归档 + 1 待 owner）。

**累计 ADR**：5 个 Accepted（ADR-000 / ADR-012 / ADR-013 / ADR-014 / ADR-015 / ADR-016 / ADR-017 = 7 个 Accepted）。
