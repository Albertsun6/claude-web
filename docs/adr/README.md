# Vessel ADR Index（架构决策记录索引）

> **目录组织**：按 [ADR-010](vessel/ADR-010-docs-organization.md) + [ADR-000](vessel/ADR-000-adopt-eva-codebase-as-vessel-foundation.md) §3
>
> **状态**：**v0A.1 完善 sprint 完成** · 2026-05-10 · 18 份 Vessel ADR Accepted + 1 份 Proposed（ADR-002 intentionally Proposed until M1C-B spike）
>
> **v0A.1 增订**（基于 [Phase 0 调研 spike report](../research/0A-completion-sprint-prior-art-2026-05-09.md)）：
> - **A1 (FRAMEWORK §6)**：soul.md 单文件 → 拆 4 sibling（SOUL/STYLE/SKILL/MEMORY，借鉴 OpenClaw / aaronjmars）
> - **A6 (FRAMEWORK §4 + ADR-012 §3)**：ML worker IPC stdio JSON-RPC → HTTP loopback + OpenAI API 兼容（Ollama/Pipelines 模式）
> - **A7 (FRAMEWORK §5.5/5.6/5.7)**：Trace 12 字段保留 + 加 OTEL GenAI Semantic Conventions 兼容映射 + W3C Trace Context（v1+ pivot 路径）
> - **A2-A5** + **B1-B5** 进 ROADMAP §11.5（按 milestone 实施时改进）
> - **C1-C5** 进 [IDEAS.md](../notes/IDEAS.md) 灵感库

---

## Vessel ADR（按编号）

| # | 标题 | Tier | Status | 依赖 | 落到 milestone |
|---|---|---|---|---|---|
| **000** | [Adopt Eva Codebase as Vessel Foundation](vessel/ADR-000-adopt-eva-codebase-as-vessel-foundation.md)（D' 路线锁定） | 1 | ✅ Accepted | — | 0-pre / 0B |
| **001** | [Package Manager = pnpm](vessel/ADR-001-package-manager-pnpm.md) | 2 | ✅ Accepted | ADR-000 | 全程 |
| **002** | [Embedding = fastembed via Python Worker](vessel/ADR-002-embedding-fastembed-via-python-worker.md) | 1 | 🔄 **Proposed**（pending M1C-B spike） | ADR-012 | M1C-B |
| **003** | [v0.1 仅支持 CC CLI](vessel/ADR-003-single-cli-only-cc.md)（不抽象多 CLI） | 2 | ✅ Accepted | ADR-016 | M0.5 |
| **004** | [Soul Spec 注入目标 = CC CLI Prompt Wrapper](vessel/ADR-004-soul-prompt-injection-target.md) | 2 | ✅ Accepted | ADR-016 | M2-Soul |
| **005** | [INSTANCE 隔离 + Fork-Friendly](vessel/ADR-005-instance-isolation.md) | 2 | ✅ Accepted | ADR-000 | 0B+ |
| **006** | [Schema 演进策略](vessel/ADR-006-schema-evolution.md) | 2 | ✅ Accepted | ADR-000 | 0B / 各 milestone |
| **007** | [License = Apache-2.0](vessel/ADR-007-license-apache2.md) | 2 | ✅ Accepted | — | 0B |
| **008** | [配置位置 = ~/.vessel/config.toml](vessel/ADR-008-config-location.md) | 2 | ✅ Accepted | ADR-005 | 0B |
| **009** | [MCP Server Lifecycle](vessel/ADR-009-mcp-server-lifecycle.md)（按需起 + TTL） | 1 | ✅ Accepted | ADR-014 / ADR-012 | M1B |
| **010** | [文档目录组织](vessel/ADR-010-docs-organization.md)（docs/ + Diátaxis + ADR） | 2 | ✅ Accepted | — | 0-meta-lite+ |
| **011** | [Vessel-Core Runtime Process Model](vessel/ADR-011-runtime-process-model.md) | 1 | ✅ Accepted | ADR-012 / ADR-009 | M0+ |
| **012** | [Language = TypeScript + ML Worker](vessel/ADR-012-language-typescript-with-ml-worker.md) | 1 | ✅ Accepted | ADR-000 | 全程 |
| **013** | [Rename Strategy](vessel/ADR-013-rename-strategy.md)（claude-web → Vessel） | 1 | ✅ Accepted | ADR-000 | 0B / M2-iOS |
| **014** | [Review Workflow（B' lite）](vessel/ADR-014-review-workflow.md) | 1 | ✅ Accepted | — | 0-meta-lite+ |
| **015** | [Research Before Design](vessel/ADR-015-research-before-design.md)（Spike/Trade Study） | 1 | ✅ Accepted | ADR-014 | 0-meta-lite+ |
| **016** | [Coding Driver Interface（C 路径）](vessel/ADR-016-coding-driver-interface.md) | 1 | ✅ Accepted | ADR-000 / ADR-012 | M0.5 |
| **017** | [Cursor CLI Cross-Reviewer](vessel/ADR-017-cursor-cli-cross-reviewer.md)（异质评审引擎） | 1 | ✅ Accepted | ADR-014 / ADR-015 | 0-meta-lite+ |
| **018** | [AISEP vs HARNESS 边界](vessel/ADR-018-aisep-vs-harness.md)（独立 Capability 体系 vs 现有 HARNESS_* 试点） | 1 | ✅ Accepted | ADR-000 / ADR-013 / ADR-017 | aisep 全程 |
| **019** | [Steward V0 Contract](vessel/ADR-019-steward-v0-contract.md)（BACKLOG.md + 10-prompt UI + boot ritual） | 1 | ✅ Accepted | ADR-014 | 0-meta-lite+ |
| **020** | [PIM 统一捕获入口](vessel/ADR-020-pim-capture-entry.md)（v2.1 个人 PIM 试点 backend 模块） | 1 | 🔄 **Proposed**（pending M0-PIM Day 7 验收） | ADR-000 / ADR-006 / ADR-008 / ADR-013 / ADR-018 | M0-PIM |
| **022** | [AISEP v2 Fan-In](vessel/ADR-022-aisep-v2-fan-in.md)（multi-source aggregation + per-child failure recovery） | 1 | ✅ Accepted | ADR-018 / ADR-014 | aisep v0.4 |

> ADR-021 编号当前空闲，预留给 ADR-019 Steward 契约后续修订（参 ADR-019 §"改 schema 字段含义...需 ADR-020+"）。本表 020 已被 PIM 占用；下次 Steward 契约修订用 021。

**Tier 划分**（按 v5.4 dogfood M-P2 partial）：
- **Tier 1**（15 份）：重大决策 + Phase 0 调研（如适用）
- **Tier 2**（7 份）：1-2 段简短决策 / 决策已明确 / 无需 Phase 0

---

## Eva Legacy ADR（不 renumber，保留作历史证据）

`docs/adr/eva-legacy/`（按 ADR-000 §3 + v5.1 评审 Q3 决策）：6 份 Eva 旧 ADR，0B Stage 4 (0B-8) 已搬入。**编号不变**（4 位数 0010-0016）以与 Vessel ADR（3 位数 000-017）区分。

| Eva ADR | 标题 | 状态判定（参 supersede 矩阵） |
|---|---|---|
| [ADR-0010](eva-legacy/ADR-0010-sqlite-fts5.md) | SQLite FTS5 全文检索 | ✅ 沿用（与 sqlite-vec 共存） |
| [ADR-0011](eva-legacy/ADR-0011-server-driven-thin-shell.md) | Server-driven Thin Shell | ✅ 沿用（Vessel iOS 仍是薄壳） |
| [ADR-0013](eva-legacy/ADR-0013-worktree-pr-double-reviewer.md) | Worktree PR Double Reviewer | ✅ 沿用（与 ADR-014 review workflow 互补） |
| [ADR-0014](eva-legacy/ADR-0014-context-bundle-explicit.md) | Context Bundle Explicit | ✅ 沿用（与 Vessel ADR-014 编号巧合，非 supersede） |
| [ADR-0015](eva-legacy/ADR-0015-schema-migration.md) | Schema Migration | ⚠️ 部分 superseded by ADR-006 |
| [ADR-0016](eva-legacy/ADR-0016-scheduler-m1-skeleton.md) | Scheduler M1 Skeleton | ⚠️ 部分 superseded by Workflow Engine（M1C-A） |

---

## Supersede 矩阵（Vessel ADR ↔ Eva 旧 ADR）

| Eva ADR | Vessel ADR | 关系 |
|---|---|---|
| ADR-0010 sqlite-fts5 | （未直接 supersede）| 全文检索仍 Eva 设计；Vessel M1C-B 加 sqlite-vec 向量检索（与 fts5 共存） |
| ADR-0011 server-driven thin shell | （未直接 supersede）| Eva 设计仍有效，Vessel iOS 沿用同模式（M2-iOS） |
| ADR-0013 worktree-pr-double-reviewer | ADR-014（互补） | Eva 双 reviewer 是 Eva harness 内置，Vessel ADR-014 是更宏观的 4-way review；两者互补不冲突 |
| ADR-0014 context-bundle-explicit | （未直接 supersede） | Eva harness 设计仍有效；编号与 Vessel ADR-014 巧合（4 位 vs 3 位区分） |
| ADR-0015 schema migration | ADR-006 | Vessel 扩展（拆 0004/0005/0006/0007 + 4 类硬触发 #8 不可 drop） |
| ADR-0016 scheduler-m1-skeleton | M1C-A Workflow Engine | Vessel M1C-A 扩展 Eva scheduler + HITL 持久化；Eva ADR-0016 部分 superseded |

---

## 决策路径（按时间顺序）

按 plan v5.4 评审辩论流水：

- **第一轮外部 AI（v1→v2）**：5 条具体批评 + 方法论建议 + 路线
- **用户第三轮反馈（v2→v3.1）**：8 条 + 我主动补 7 条
- **第三轮外部 AI（v3.1→v4）**：5 个 Open Question 答 + 5 个细节修
- **第四轮外部 AI（v4→v5）根本决策评审**：D 升级到 D' → ADR-000 锁定
- **第五轮外部 AI（v5→v5.1）辩论收尾**：10 项细节修
- **用户第六/七/八轮反馈（v5.1→v5.3）**：自治评审 + 外部调研 + 文档目录
- **第六轮外部 AI（v5.3→v5.4）lite 收缩**：12 项收缩 + 不一致修
- **0-meta-lite dogfood**：cursor 集成 → ADR-016 / ADR-017
- **0-pre 4-way 评审**：cursor 抓 3 BLOCKER 集体盲区
- **0A 评审**：（待跑）

详见 plan v5.4 §「评审辩论流水」。

---

## ADR 写作规范（按 ADR-014 + ADR-015）

每份 ADR 必含：
- frontmatter（Status / Date / Deciders / Tags / Tier / Depends on / Spike report）
- Context / Decision / Consequences（正/负/中性）
- Prior Art（重大决策必有；Vessel 特有设计写 "No direct prior art found"）
- 验证 / 实施时机 / 暂缓项（如适用）

模板参考：[adr.github.io](https://adr.github.io/)。
