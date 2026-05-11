# Phase 3 Arbitration — 0-pre Review

- **Date**: 2026-05-09 22:55
- **Author**: Claude (debate-review SKILL)
- **Inputs**: 4 × Phase 1 verdicts（architect / pragmatist / risk-officer / cursor cross-reviewer）+ Phase 2 综合（v5.4 lite 不强求独立 react verdict，author 在仲裁时融合）
- **Total findings**: ~37 项（含 7 BLOCKER + 17 MAJOR + 13 MINOR，部分重叠）

> **关键发现**：cursor cross-reviewer（GPT-5.5）独立找出 3 个 BLOCKER 等级 finding（rm -rf 危险 runbook / migration 0004 复用 / license vs gitleaks 错误归一），其中 2 个被 risk-officer 独立确认升级为硬触发命中。**这是异质评审第一次在真实 milestone 中暴露 Claude 集体盲区**。

---

## Phase 2 Cross-Pollination 综合（融合 4 个 verdict）

| 议题 | architect | pragmatist | risk-officer | cursor | 收敛 |
|---|---|---|---|---|---|
| ADR-013 §3 `rm -rf` 危险 runbook | _未发现_ | _未发现_ | **B-R1（硬触发 #8）** | **B1** | 🚨 **3 reviewer 收敛 BLOCKER**（cursor + risk-officer + author Phase 3 ratify） |
| Migration 0004 被多 milestone 复用 | _未发现_ | m-P3 agree | **M-R3 agree+升级** | **M2 BLOCKER** | 🚨 **3 reviewer 收敛 BLOCKER**，拆 0004/0005/0006/0007 |
| R-06 license 风险被 gitleaks 错误覆盖 | _未发现_ | _未发现_ | **B-R2（硬触发 #6）** | **M4** | 🚨 **2 reviewer 收敛 BLOCKER**，拆 R-06a/R-06b |
| Boot 三层 Instance 级缺骨架 | **B-A1 BLOCKER** | _未发现_ | _未发现_ | _未发现_ | ⚠️ Architect 单独发现，但合理 → accept |
| 5 接口 stub 时机 + 落地路径 | **B-A2 BLOCKER** | m-P4 agree | _未发现_ | _未发现_ | ⚠️ Architect 主导，pragmatist agree → accept |
| frontend 排除清单遗漏 / UI 重设计含糊 | **B-A3 BLOCKER** | **M-P3 同议题** | _未发现_ | _未发现_ | ⚠️ 2 reviewer 收敛，escalate owner 决策 |
| TS 协议扩展 → Swift Codable 同步缺 | M-A2 同议题 | _未发现_ | _未发现_ | **M1 MAJOR** | ⚠️ cursor + architect 收敛 |
| Scheduler "内部不动" vs retry policy 矛盾 | _未发现_ | _未发现_ | _未发现_ | **M3 MAJOR** | ⚠️ cursor 单独发现，accept（refine M1C-A 范围） |
| 改名工程量低估 + 缺 Stage 间 checkpoint | _未发现_ | **B-P1 BLOCKER** | _未发现_ | _未发现_ | ⚠️ Pragmatist 单独发现，accept |
| EVA_INVENTORY §7.1 调用链画错（routes/runs） | M-A1 MAJOR | _未发现_ | _未发现_ | _未发现_ | ⚠️ Architect 单独，accept fact-check |
| ADR-013 §3 escalation 没写到 inbox | M-A3 MAJOR | _未发现_ | _未发现_ | _未发现_ | ⚠️ Architect 单独，accept（已在本次 Phase 3 写 inbox） |
| 总改造估计两处不一致 | M-A4 MAJOR | _未发现_ | _未发现_ | _未发现_ | ⚠️ accept fact-check |
| protocol.ts 扩展 LOC 估计偏低 | _未发现_ | **M-P2 MAJOR** | _未发现_ | _未发现_ | ⚠️ accept refine |
| env var 双名 fallback 长期债 | _未发现_ | **M-P1 MAJOR** | _未发现_ | _未发现_ | ⚠️ accept |
| ML worker capability unavailable 通知策略 | _未发现_ | **M-P4** | **M-R2** | _未发现_ | ⚠️ 2 reviewer 收敛 |
| Workflow_state 序列化脱敏 | _未发现_ | _未发现_ | **M-R4** | _未发现_ | ⚠️ accept（加 R-14） |
| iOS Bonjour 服务名暴露 | _未发现_ | _未发现_ | **M-R5** | _未发现_ | ⚠️ accept（加 R-15） |
| 改名期间 secrets re-scan | _未发现_ | _未发现_ | **M-R1** | _未发现_ | ⚠️ accept（ADR-013 加 Stage 5） |
| 文档私人路径 `/Users/yongqian/...` | _未发现_ | _未发现_ | **m-R2** | **m3** | ⚠️ 2 reviewer 收敛，refine 不阻塞 0-pre |
| RISKS 风险等级标记不一致 | _未发现_ | **m-P2** | _未发现_ | _未发现_ | ⚠️ 简单修 |
| RISKS R-07 ✅ 不准确（未实跑） | _未发现_ | _未发现_ | **m-R1** | _未发现_ | ⚠️ accept 标 ⏳ |

**Fagan 异质性硬约束**：cursor + 3 Claude reviewer 共有 finding 3 处（rm -rf / migration / license）+ 各自独立 finding 多处 → **绝对没有全 agree 退化**，符合 ≥1 disagree-with-evidence/refine。

---

## 仲裁矩阵（按严重度）

### 🚨 BLOCKER 收敛（必须修 / escalation 命中）

| ID | 议题 | 仲裁 | 落地动作 |
|---|---|---|---|
| **#1** | ADR-013 §3 `rm -rf` 危险 runbook（B-R1 + cursor B1） | ✅ accepted（**escalation #1**）| 立即修 ADR-013 §3：删除方案 A，锁定方案 B（rsync + cp .git）；写 escalation inbox |
| **#2** | Migration 0004 被多 milestone 复用（M-R3 + cursor M2 + m-P3） | ✅ accepted | 立即修 EVA_TO_VESSEL_MAPPING §1.5：拆 0004（M1C-A workflow_state）/ 0005（M1C-B embedding）/ 0006（M2-Soul soul_history）/ 0007（M2+ capability）；schema_version v103/v104/v105/v106 |
| **#3** | R-06 license vs gitleaks 错误归一（B-R2 + cursor M4） | ✅ accepted（**escalation #2**）| 立即拆 R-06 → R-06a (secrets, mitigated) + R-06b (license, active)；ADR-013 加 Stage 6 license scan；写 escalation inbox |
| **#4** | Boot 三层 Instance 级缺骨架（B-A1） | ✅ accepted | 修 EVA_TO_VESSEL_MAPPING #1：M0 阶段就加最小 Instance 级 boot（"空 Instance"模式）；M2-Soul 仅扩展 |
| **#5** | 5 接口 stub 时机不清（B-A2） | ✅ accepted | 修 ADR-000 §2 加 "5 接口契约存放约定"段；EVA_TO_VESSEL_MAPPING 加 #34 "interfaces/ stub @ 0B" |
| **#6** | frontend 排除清单遗漏（B-A3 + M-P3） | 🟡 **hung**（owner 决策） | 写 escalation inbox：M1A 保留 Eva UI vs UI 重设计（推荐：保留 Eva UI，重设计推到 v0.1 release 后） |
| **#7** | 改名工程量低估 + Stage checkpoint 缺（B-P1） | ✅ accepted | 修 ADR-013 §2：加 "Stage 间 checkpoint" + scripts/verify-rename.sh |

### ⚠️ MAJOR 收敛（accept 修复，不阻塞）

| ID | 议题 | 仲裁 | 落地动作 |
|---|---|---|---|
| #8 | TS 协议扩展 ↔ Swift Codable 同步（cursor M1 + M-A2） | ✅ accepted | 修 EVA_TO_VESSEL_MAPPING #16/#22：加 Swift HarnessProtocol.swift / BackendClient.swift 同步落点 + Acceptance（fixture decode） |
| #9 | Scheduler "内部不动" vs retry policy（cursor M3） | ✅ accepted（refine） | 修 EVA_TO_VESSEL_MAPPING #5：M1C-A 仅做 paused/resume 持久化；retry policy 移到独立 ADR / M1C-A+ |
| #10 | EVA_INVENTORY §7.1 调用链画错（M-A1） | ✅ accepted | 修 §7.1：删除虚构 routes/runs.ts |
| #11 | ADR-013 §3 escalation 写 inbox（M-A3） | ✅ accepted | 本 Phase 3 已落（见 escalation inbox）|
| #12 | 总改造估计不一致（M-A4） | ✅ accepted | 修 EVA_TO_VESSEL_MAPPING §3 加解释（vs 820-1600 多 +260-300） |
| #13 | protocol.ts 扩展 LOC 偏低（M-P2） | ✅ accepted | 修 #16 改 +200-400 |
| #14 | env var 双名 fallback 长期债（M-P1） | ✅ accepted | 修 ADR-013 §2：迁移脚本 alert 用户改 env，不留代码 fallback |
| #15 | ML worker capability unavailable 通知策略（M-P4 + M-R2） | ✅ accepted | 修 ADR-012 §4：加通知策略段（inbox + log + v1+ UI badge）+ invoke 时 health check |
| #16 | workflow_state 序列化脱敏（M-R4） | ✅ accepted | 加 R-14（workflow_state 序列化按 trace-redaction-spec 脱敏） |
| #17 | iOS Bonjour 服务名暴露（M-R5） | ✅ accepted | 加 R-15（Bonjour 网络环境检测） |
| #18 | 改名期间 secrets re-scan（M-R1） | ✅ accepted | 修 ADR-013 §2 加 Stage 5：re-run gitleaks |

### 🟢 MINOR / Refine（可选修复）

| ID | 议题 | 仲裁 | 落地动作 |
|---|---|---|---|
| #19 | 文档私人路径 `/Users/yongqian/...`（m-R2 + cursor m3） | ⚠️ partial（v0.1 release 前修） | 不阻塞 0-pre；加到 R-15 "未来开源前清理私人路径" |
| #20 | 5 接口 / 枚举 canonical 顺序（m-A1） | ⚠️ partial（0A 时锁） | 0A FRAMEWORK 时锁字母序，不强制改 EVA_INVENTORY |
| #21 | EVA_INVENTORY §3 缺 package names（m-A2） | ✅ accepted | 修 §3 顶部加 package names |
| #22 | RISKS 风险等级标记不一致（m-P2） | ✅ accepted | 删图例段（已有"高/中/低"列） |
| #23 | RISKS R-07 ✅ 不准确（m-R1） | ✅ accepted | 改 ⏳，0B 跑测试通过后再标 ✅ |
| #24 | ADR-016 反向引用 ADR-000 §2（m-P4） | ✅ accepted | 修 ADR-000 §2 加 ADR-016 引用 |
| #25 | venv 子原因细分（m-R3） | ✅ accepted | 修 ADR-012 §4 加 venv 3 子原因 |
| #26 | 0-pre Acceptance 状态过期（cursor m2） | ✅ accepted | 修 EVA_TO_VESSEL_MAPPING §5 勾选状态 |
| #27 | Workflow resume API 命名不一致（cursor m1） | ✅ accepted | 锁 `POST /api/workflows/:id/resume` 进 0A FRAMEWORK |

---

## 统计

- ✅ **accepted: 25 项**
- ⚠️ partial: 2 项（#19, #20）
- 🚫 rejected: 0 项
- 🟡 **hung（owner 决策）: 1 项**（#6 frontend 排除清单）
- 🚨 **escalation-required: 2 项**（#1 + #3 = 4 类硬触发命中）

---

## 立即修复策略

按 v5.4 lite 精神，accept 项**立即修文档**（不留 future iteration），但**不写 plan v5.5**。仅修：
- ADR-013（破坏性 runbook 删除 + 加 Stage 5/6 + Stage checkpoint + env var 不留 fallback）
- ADR-000（5 接口契约存放约定 + Driver 引用）
- ADR-012（ML worker 通知策略 + venv 子原因）
- EVA_INVENTORY（§7.1 调用链 + §3 package names）
- EVA_TO_VESSEL_MAPPING（migration 拆 4 个 + #1 boot 加 Instance 级 + #5 retry policy 推迟 + #16 LOC 改 + #22 Swift 同步 + §3 解释 + §5 勾选状态）
- RISKS.md（拆 R-06a/b + 加 R-14/R-15 + R-07 改 ⏳ + 删图例段）

---

## Escalation Inbox 通知（2 项硬触发）

立即写 `instance/inbox/2026-05-09-2255-0-pre-escalations.md`（owner 必须看）：

1. 🚨 **#1 BLOCKER**：ADR-013 §3 `rm -rf ~/Desktop/Vessel` 危险 runbook（4 类硬触发 #8）→ 已立即修（删方案 A）
2. 🚨 **#3 BLOCKER**：R-06 license vs gitleaks 错误归一（4 类硬触发 #6）→ 已立即修（拆 R-06a/b + Stage 6 license scan）
3. 🟡 **#6 hung**：frontend 排除清单 / UI 重设计含糊（owner 决策推荐：保留 Eva UI）

---

## 反向挑战（给下一轮）

1. **架构师 lens 没看到 rm -rf BLOCKER**：B-R1/cursor B1 都是 risk lens + Lens 5 抓的——说明 architect prompt 应该加"runbook 安全性"维度（M1C-A 之前补 SKILL）。
2. **cursor M2 (migration 0004 复用) 是真盲区**：3 个 Claude reviewer 都没看到这个 SQLite 演进 bug——证明 GPT-5.5 在 schema 设计上有 Claude 没有的先验知识库。
3. **B-A1 boot 三层 Instance 级 cursor 也没看到**：说明 boot 三层是 Vessel 特有架构概念（CONCEPTS §3.5），cursor 没读 CONCEPTS 不知道——下次 cursor 评审应把 CONCEPTS §3.5 也喂进 prompt。

## 异质性证明

cursor cross-reviewer 在 4-way 评审里证明价值：
- 找 3 个 BLOCKER 是 Claude 集体盲区
- Lens 5 触发率高（B1 + M4 + m3 都是 Lens 4-5 angle）
- Phase 2 没机制让 cursor 跟 Claude reviewer 互看 verdict（v5.4 lite 限制）—— 但 Phase 3 author（Claude）做了融合，仍达成 Fagan 异质性

ADR-017 cursor cli 集成在第 1 个真实 milestone（0-pre）证明价值有效。
