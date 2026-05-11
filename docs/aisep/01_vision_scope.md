# AISEP — Vision & Scope (v0.1)

> 借助 AI 能力开发各种软件（含大型系统）的工程化体系
>
> Status: Draft (Phase 0 文档，2026-05-11)
> Source: `~/.claude/plans/ai-vessel-vessel-bubbly-noodle.md`

## 1. What

**AISEP（AI Software Engineering Platform）** 是一套**借助 AI（Claude CLI 子进程）开发各种软件**的工程化平台。

不是 IDE，不是 chatbot，不是 RAG 知识库——是**软件工程方法论 + DAG-based stage 引擎 + 跨项目记忆库**的组合，把"从想法到 ship"的完整 SDLC 用结构化 stage + machine-verifiable artifact + 多 agent 协作 + 跨项目经验沉淀串成可执行流水线。

## 2. Why（核心动机）

业界 AI coding tool（Cursor / Cline / Aider / Devin / OpenHands）和 newaisep（用户的 v1 MVP）都揭示一个共同问题：

1. **AI 单次会话产出无法跨工程沉淀** — 每个新项目都从零开始，前车之鉴不复用
2. **AI 产出无显式 stage gate** — 一次性产 5 件套时人 reviewer 必崩，rubber-stamp 风险高（CodeRabbit 2025：AI-coauthored PR 含 1.7× more issues / Stack Overflow 2025：66% 开发者修"差一点"AI 代码 / SycEval：58% sycophancy rate）
3. **大型软件需要 DAG 而非线性** — 真实工程含 fan-out（并行实现）/ fan-in（多源汇聚）/ cycle（review→revise），现有 AI coding agent 多为线性 ReAct loop
4. **架构决策被折叠进 plan/spec** — Cursor Plan Mode / Devin / Spec Kit 都把 architecture 隐藏在 plan 里，DB schema / wire protocol / runtime provider 这类高搬迁成本决策一旦走错难改

## 3. Target User

**单一用户：yongqian 本人**——纯个人单机自用，永不分发、永不团队化、永不 SaaS 化。

设计取舍全部按"一个人 + 多个 AI agent"假设做：
- 没有 PM / QA / Architect 角色分工 → AI agent 模拟多视角，人做最终决策
- reviewer = 用户自己 → 严格控制 AI 产出量（架构 brief ≤ 5 页 / detail slice ≤ 4 页）
- 没有 K8s / Redis / Kafka → SQLite + 文件足够
- 没有 OpenAI/Anthropic API key 计费压力 → 全走 `claude --print` 订阅模式 + 可选 cursor-agent 订阅模式

## 4. Scope（v0/v1/v2/v3 路线总览）

### v0（2 周，最小可用）
- 10-stage 方法论线性版（每 stage 严格单 predecessor / 单 successor）
- `aisep-protocol` + `aisep-core` + `aisep-workspace` + `aisep-cli` 骨架
- 1 个 trivial bug pilot（从 vessel `docs/IMPROVEMENTS.md` 选一条）跑通 10 stage 全链路

### v1（4 周，静态 fan-out）
- `.parallel([impl_backend, impl_frontend, impl_tests])` 静态 fan-out
- ready queue 调度（依赖满足即 runnable，并发上限 4）
- architecture stage Phase A 从 `~/.aisep/reference-library/architecture-patterns/` 检索 + fan-out 3 候选

### v2（6 周，fan-in + partial recovery）
- 多源 artifact 按 stage id 装入下一 stage `inputSchema`（Mastra 思想）
- input-hash + artifact-snapshot；fan-in 失败只重跑失败分支
- golden baseline + escape hatch

### v3（8 周，cycle + dynamic subgraph + self-host）
- review → revise cycle（LangGraph 思想，但不依赖 LangGraph）
- agent 提 graph patch（proposal gate）
- AISEP 改 AISEP self-host 双轨（stable graph 执行 + candidate graph 沙盒试跑）

## 5. Non-Goals（明确不做）

- ❌ **不做团队协作**（即使开源也保持个人单机定位）
- ❌ **不做实时多人 review**
- ❌ **不锁死任何垂直领域**（Odoo ERP 作为 reference-library 中的一个可选 pattern，不是 core）
- ❌ **不做 web/iOS UI**（v0/v1 CLI 即可；newaisep dashboard-ui 后期可借鉴）
- ❌ **不引入新基础组件**（无 Redis / NATS / Postgres / 向量 DB）
- ❌ **不直接依赖** LangGraph / Temporal / Argo / Flyte / Dagster / Mastra / Inngest（抄思想自写 ~500-1000 LoC TS engine）
- ❌ **不用 Anthropic Agent SDK**（按 token 计费，违反订阅模式硬约束）

## 6. AISEP 与 Vessel / Eva 的关系

AISEP 是 **vessel 的核心 Capability App**（后期），但 v0 阶段**完全独立于 vessel 主线和 HARNESS_***：
- 物理隔离：`packages/aisep-*` 集群 + `docs/aisep/`
- 依赖红线：dependency-cruiser CI 强制 `aisep-*` 与 `backend` 互不 import
- vessel 是 AISEP 的**第一个 pilot 项目**——AISEP 用 spawn `claude --print` 开发 vessel 自身的小 bug fix（v0）/ 中型 feature（v1+）
- 后期合并：通过 Capability manifest 注册到 VesselCore，零代码迁移（详见 [ADR-018](../adr/vessel/ADR-018-aisep-vs-harness.md)）

AISEP 与现有 `docs/HARNESS_*.md` 系列**长期独立并行**——HARNESS_* 继续走 M2 Loop 8+，AISEP 走自己的 v0/v1/v2/v3 spiral，长期归宿留待 6 个月后决定。

## 7. AISEP 与 newaisep 的关系

`~/Desktop/newaisep` 是用户 v1.0 MVP（Python + Pydantic + Jinja2 + Gemini + Odoo 18 ERP 生成），实战覆盖 7 个 workspaces。

新 AISEP **不是 newaisep 移植**，而是 v2 **通用化重做**：
- 借鉴：M1-M7 stage chain 概念 / AlphaEvolve 双层免疫记忆 / Native Agent Compiler（j2 → task.md → spawn 执行）/ Workspace 产物链 / 强类型 gate
- 不要：Odoo 18 垂直锁死 / Gemini Antigravity / Python 全栈
- **Odoo 特化代码搬进** `~/.aisep/reference-library/architecture-patterns/odoo-erp/`——作为可选 pattern 长期支持用户 Odoo ERP 开发
- 详见 [docs/aisep/borrowed/newaisep-extraction-plan.md](borrowed/newaisep-extraction-plan.md)

## 8. 成功标准（v0 验收）

- [ ] 10-stage 方法论文档完整（`02_methodology-v0.1.md` + `03_architecture-stage-spec.md`）
- [ ] `aisep-protocol` 包通过 cross-review（vessel-architect + reviewer-cross + cursor-agent 三 reviewer convergence）
- [ ] 1 个 trivial bug pilot 跑通：从 `aisep run` 到 patch.diff 到 apply 到通过 backend 既有测试套件
- [ ] `~/.aisep/governance-log/evolution_log.json` 至少有 1 条 promote 记录
- [ ] dependency-cruiser CI 通过：`aisep-*` 与 `backend` 零互相 import
- [ ] vessel `feat/eva-M2-loop7-ci-e2e` 进度不受任何打断（红线 R3/R4 守住）

## 9. 关键参考

- 完整 plan：`~/.claude/plans/ai-vessel-vessel-bubbly-noodle.md`
- 边界 ADR：[ADR-018 aisep-vs-harness](../adr/vessel/ADR-018-aisep-vs-harness.md)
- 方法论：[02_methodology-v0.1.md](02_methodology-v0.1.md)
- architecture stage spec：[03_architecture-stage-spec.md](03_architecture-stage-spec.md)
- 跨项目记忆库 ontology：[04_global-memory-ontology.md](04_global-memory-ontology.md)
- newaisep 抽取清单：[borrowed/newaisep-extraction-plan.md](borrowed/newaisep-extraction-plan.md)
