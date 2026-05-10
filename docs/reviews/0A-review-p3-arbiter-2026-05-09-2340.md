# Phase 3 Arbitration — 0A Review

- **Date**: 2026-05-09 23:40
- **Author**: Claude (debate-review SKILL)
- **Inputs**: cursor cross-reviewer verdict + Claude combined verdict（v5.4 lite 合并）
- **Total findings**: 18 项（0 BLOCKER + 10 MAJOR + 8 MINOR）

> **关键发现**：cursor cross-reviewer 找出 **4 个 Claude 完全 missed** MAJOR：Trace 脱敏 vs replay 冲突 / driver.exited.error 命名不一致 / SessionSchema.source 单 enum 跨入口失效 / Agent.run() 返回 union 状态边界不清。Lens 5 抓到 over-cautious M0 observability 倾向。**cursor 异质评审在 0A 仍然抓到 Claude 集体盲区**。

---

## 仲裁矩阵

| ID | 主张 | Source | 仲裁 | 落地 |
|---|---|---|---|---|
| **cursor M1** | Trace 脱敏 vs replay 冲突 | cursor | ✅ accepted | NFR-O3 改默认脱敏 replay；原文需 `--unsafe-raw` flag |
| **cursor M2** | driver.exited.error vs schema 不一致 | cursor | ✅ accepted | NFR-F1 改 `event_type=driver.exited + status=error` |
| **cursor M3** | SessionSchema.source 单 enum | cursor | ✅ accepted | 改 `createdFrom: Source` + `activeSources?: Source[]` |
| **cursor M4** | Permission trace 含敏感 path | cursor | ✅ accepted | NFR-P1/P3 改用 `path_class` + `path_hash` + `redacted_path` |
| **cursor M5** | Agent.run() 返回 union 模糊 | cursor | ✅ accepted | 统一 `Promise<AgentResult>`，artifact 进 result.artifact |
| Claude M-A1 | AppManifest schemaVersion z.literal(1) | Claude | ✅ accepted | 改 z.number().int().min(1) |
| Claude M-A2 | Workflow 接口未定义 | Claude | ✅ accepted | FRAMEWORK §11 加 placeholder |
| Claude M-R1 | TraceEvent.payload z.unknown() | Claude | ✅ accepted | 加 .refine() JSON + ≤4KB |
| Claude M-P1 | MoSCoW 表行数与统计不符 | Claude | ✅ accepted | 修统计：M=10 / S=4 / C=4 / W=1 |
| Claude M-P2 | ROADMAP §11.2 跟 EVA_TO_VESSEL_MAPPING 重叠 | Claude | ✅ accepted | 简化引用 |
| **cursor m4 (Lens 5)** | M0 observability over-cautious | cursor | ⚠️ partial accepted | M0 简化（trace tree + 12 字段 schema + 脱敏 + grep gate；GraphLib 无环 + 完整 replay 推 M0.5/M1A）|
| cursor m1 | PermissionScope import 缺 | cursor | ✅ accepted | 加 import |
| cursor m2 | ROADMAP 引私人 plan 路径 | cursor | ✅ accepted | 改 "plan v5.4"（不入库） |
| cursor m3 | ADR README 状态表达模糊 | cursor | ✅ accepted | 改"0A ADR index ready；ADR-002 intentionally Proposed until M1C-B spike" |
| Claude m-R1 | Trace event_type enum 扩展机制 | Claude | ✅ accepted | §5 加注释 |
| Claude m-A1 | ADR-002 Status=Proposed | Claude | ✅ accepted | 改 "Accepted-conditional" |
| Claude m-R2 | NFR 缺 Performance 类 | Claude | ⚠️ partial accepted | 不阻塞 0A；M0+ 实测后填具体值 |
| cursor F? | AppManifestSchema.skills 是否 .min(1) | cursor | ⚠️ partial（待决策）| owner 决定：v0.1 是否允许纯 Tool Capability（无 Skill）→ 当前 partial：**不强制 .min(1)**，允许纯 Tool Capability（如未来 monitoring Capability） |

---

## 统计

- ✅ accepted: **15**
- ⚠️ partial: **3**
- 🚫 rejected: 0
- 🟡 hung: 0
- 🚨 escalation: **0**（无 4 类硬触发命中；R-06a/R-06b log-not-block policy 已生效）

---

## 异质性证明（0A 第 2 轮）

cursor 4-way 评审第 2 个真实 milestone（continued from 0-pre）。cursor 抓 4 个独立 MAJOR 都是 Claude 集体盲区：

| Finding | cursor lens | Claude (architect/pragmatist/risk) |
|---|---|---|
| **M1 Trace 脱敏 vs replay** | Lens 1 + 4 | ❌ all missed |
| **M2 driver.exited.error 不一致** | Lens 1 + 2 | ❌ all missed（Claude m-R1 类似但不精确） |
| **M3 SessionSchema.source 单 enum** | Lens 2（跨端对齐） | ❌ all missed |
| **M4 Permission trace sensitive path** | Lens 4（4 类硬触发 #5 secrets） | ❌ all missed |
| M5 Agent.run() union | Lens 1 | ❌ architect missed |

3 Claude lens 也找了 cursor 没看到的（AppManifest schemaVersion z.literal / Workflow 接口未定义 / TraceEvent.payload z.unknown / MoSCoW 总数 / ROADMAP 重叠 / NFR 缺 Performance）—— 互补，不冗余。

**这是 0A milestone 的关键质量保证**：cursor 找的全是设计层 bug（有些会在 M0 实施时炸出来 / 有些是 Wire Protocol 跨端不一致 / 有些是 API 设计模糊）。Claude 找的是文档级（统计错 / 重叠 / 缺类别）和小型设计漏洞。**真正互补的多 lens 评审**。

---

## 立即修复（13 项关键）

按 v5.4 lite 精神，立即修关键 finding，简单的文档修订推到 0B：

### A. 立即修（cursor 5 MAJOR + Claude 关键）

1. ✅ NFR-O2 / NFR-O3 / FRAMEWORK §5 / trace-redaction-spec：Trace 脱敏 vs replay 拆两层
2. ✅ NFR-F1：event_type=driver.exited + status=error
3. ✅ FRAMEWORK §8 SessionSchema：createdFrom + activeSources?
4. ✅ NFR-P1/P3 / trace-redaction-spec：permission event 用 path_class + path_hash + redacted_path
5. ✅ FRAMEWORK §2.1 Agent.run()：统一 Promise<AgentResult>
6. ✅ FRAMEWORK §2.5 + §6 + §7：AppManifestSchema / SoulSpecSchema schemaVersion 改 z.number().int().min(1)
7. ✅ FRAMEWORK §5 TraceEventSchema.payload：加 .refine() JSON + ≤ 4KB
8. ✅ FRAMEWORK §2.5：加 PermissionScope import

### B. 推到 0B 一起改（次要文档修订）

9-15. cursor m1-m3 + Claude m-R1 / m-A1 / M-P1 / M-P2：MoSCoW 总数 / ROADMAP plan 路径 / ADR README 状态 / event_type 扩展注释 / ADR-002 Status / FRAMEWORK §11 Workflow placeholder / ROADMAP §11.2 简化

### C. M0+ 实施时填具体值

16. NFR Performance 类（M0/M0.5 实测后填）

### D. M0 / M0.5 实施时简化（Lens 5）

17. M0 observability：仅 12 字段 schema + 脱敏 + grep gate；GraphLib 无环验证 + 完整 replay 推 M0.5/M1A

---

## 反向挑战（给下一轮）

1. **cursor 在 0A 评审 4-way 第二次仍找出 Claude 集体盲区**——证明异质评审长期价值（不是一次性夸张）。
2. **Trace 脱敏 vs replay 冲突**是个好例子：Vessel 文档写得久会有"NFR 矛盾"自我冲突；cursor 在 cross-end 对齐 lens 抓到，Claude 同模型多 prompt 没抓到——可能 Claude 太"信赖" trace-redaction-spec 已写。
3. **SessionSchema.source 单 enum 是 cross-end DTO 设计 bug**——cursor 在 Lens 2（TS Zod ↔ Swift Codable ↔ SQLite 三端对齐）真有不同先验。
4. **Lens 5 over-cautious 检测**：cursor 又一次找出 Vessel 自己的过度工程化（M0 observability）—— 这跟 v5.4 dogfood m4（Phase 2 disagree 硬约束）一脉相承。

## What I Did Not Look At

- 没读 11 个新 ADR 全文（只 cursor 评了 ADR README + 我抽样了 ADR-001/002/004/009/011）—— 推到 0B 时再 spot check
- 没跑 `pnpm test:cli` 验证 Eva characterization tests 仍通过（0B 会跑）
