# REFERENCES.md — Vessel 借鉴项目库

> **作用**：长期记录 Vessel 借鉴的开源项目。每条含：项目名 / 抓取日期 / license / 借鉴点 / 是否依赖 / 我们的判断。
> **更新规则**：每次引入新概念或新依赖前先来这里补一条；删除条目前要 ADR 论证。
>
> **关联**：
> - [`docs/research/0A-completion-sprint-prior-art-2026-05-09.md`](../research/0A-completion-sprint-prior-art-2026-05-09.md) — 35+ 项目深度调研（Phase 0 spike）
> - [`docs/notes/IDEAS.md`](IDEAS.md) — 灵感库（💡/❓/✅）
> - [ADR-007 license](../adr/vessel/ADR-007-license-apache2.md) — license 选择论证
> - [ADR-012 ML worker](../adr/vessel/ADR-012-language-typescript-with-ml-worker.md) — Python worker 边界

---

## 借鉴清单（≥10 条，按里程碑排序）

### 1. Eva (claude-web)
- **项目**：用户桌面 [`/Users/yongqian/Desktop/claude-web/`](file:///Users/yongqian/Desktop/claude-web/)（codename Eva）
- **抓取**：2026-05-09
- **License**：私有（用户自有）
- **借鉴点**：cli-runner / permission / inbox / harness / iOS BackendClient / Voice / Heartbeat / scheduler / projects-store
- **依赖**：✅ 全量复用（Vessel 起点 = Eva fork-rename，详见 [ADR-000](../adr/vessel/ADR-000-adopt-eva-codebase-as-vessel-foundation.md)）
- **判断**：Vessel 不重写 Eva，70% 功能直接继承，增量加 Soul Spec / Capability / 5 接口契约 / MCP / 长期记忆。

### 2. OpenClaw (soul.md author)
- **项目**：[github.com/aaronjmars/soul.md](https://github.com/aaronjmars/soul.md)
- **抓取**：2026-05-09
- **License**：MIT
- **借鉴点**：soul.md 4 sibling 拆分（SOUL.md / STYLE.md / SKILL.md / MEMORY.md）—— v0A.1 A1
- **依赖**：❌ 不依赖（思想借鉴）
- **判断**：核心借鉴。Soul Spec schema 直接参考 OpenClaw v3，但 Vessel 在 Capability App / 5 接口契约上是独立设计。

### 3. SillyTavern V3
- **项目**：[github.com/SillyTavern/SillyTavern](https://github.com/SillyTavern/SillyTavern)
- **抓取**：2026-05-09
- **License**：AGPL-3.0
- **借鉴点**：character card v3 schema（greeting / personality / scenario / first_mes / mes_example）
- **依赖**：❌ AGPL 不引入，思想借鉴
- **判断**：Soul Spec schema 字段命名参考其 character card，但**不复制代码**（avoid AGPL 传染）。

### 4. Letta (formerly MemGPT)
- **项目**：[github.com/letta-ai/letta](https://github.com/letta-ai/letta)
- **抓取**：2026-05-09
- **License**：Apache-2.0
- **借鉴点**：长期记忆 archival / core memory / recall memory 三层概念
- **依赖**：❌ 不引入（Vessel 是 TS，Letta 是 Python）
- **判断**：Memory 接口三层（short / sessionKv / longTerm）参考 Letta 概念但实现独立（sqlite-vec on TS 主进程 + ML worker embedding）。

### 5. Ollama
- **项目**：[github.com/ollama/ollama](https://github.com/ollama/ollama)
- **抓取**：2026-05-09
- **License**：MIT
- **借鉴点**：HTTP loopback + OpenAI-compatible API 模式（v0A.1 A6 ML worker 协议借鉴）
- **依赖**：❌ 不直接引入（Vessel ML worker 自己用 Python）
- **判断**：ml-workers/ 端口 11435+（避开 Ollama 11434）+ OpenAI Embeddings/Audio API 兼容协议直接借鉴 Ollama 模式。

### 6. fastembed (Qdrant)
- **项目**：[github.com/qdrant/fastembed](https://github.com/qdrant/fastembed) (Python) / [fastembed-rs](https://github.com/Anush008/fastembed-rs) / [fastembed-js](https://github.com/Anush008/fastembed-js)
- **抓取**：2026-05-09
- **License**：Apache-2.0
- **借鉴点**：本地 ONNX embedding（无外部 API 依赖）
- **依赖**：✅ M1C-B spike：先试 fastembed-js（ONNX Node），失败 fallback Python fastembed via worker
- **判断**：满足"本地小模型优先"原则。ADR-002 跟进 spike 结果。

### 7. sqlite-vec
- **项目**：[github.com/asg017/sqlite-vec](https://github.com/asg017/sqlite-vec)
- **抓取**：2026-05-09
- **License**：Apache-2.0 / MIT (dual)
- **借鉴点**：SQLite 向量扩展，无独立向量库依赖
- **依赖**：✅ M1C-B 引入（C 扩展通过 better-sqlite3 加载）
- **判断**：满足"个人单机不引专用向量数据库"硬约束。

### 8. whisper.cpp
- **项目**：[github.com/ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- **抓取**：2026-05-09
- **License**：MIT
- **借鉴点**：本地 ASR，CPU/Metal 推理
- **依赖**：✅ M2-Voice 经 ml-workers/src/whisper_server.py 调用（pywhispercpp 绑定）
- **判断**：Eva voice 模块已经验证；Vessel 走 OpenAI Audio API 兼容包装。

### 9. Piper TTS
- **项目**：[github.com/rhasspy/piper](https://github.com/rhasspy/piper)
- **抓取**：2026-05-09
- **License**：MIT
- **借鉴点**：本地 TTS，ONNX 模型
- **依赖**：✅ M2-Voice 经 ml-workers/src/piper_server.py 调用
- **判断**：Eva voice 模块已经验证；Vessel 走 OpenAI Audio Speech API 兼容包装。

### 10. Model Context Protocol (MCP)
- **项目**：[github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- **抓取**：2026-05-09
- **License**：MIT
- **借鉴点**：MCP client SDK，标准 tool / resource 协议
- **依赖**：✅ M1B 引入 `@modelcontextprotocol/sdk`（仅 client，不做 MCP server）
- **判断**：Tool 接口的"外部 tool"形态直接走 MCP 标准，避免自创协议。

### 11. Goose (Block / Square)
- **项目**：[github.com/block/goose](https://github.com/block/goose)
- **抓取**：2026-05-09
- **License**：Apache-2.0
- **借鉴点**：Capability App 装卸式插件 + Manifest 概念
- **依赖**：❌ 不引入（Goose 是 Rust）
- **判断**：CapabilityApp 接口 + boot/uninstall lifecycle + Manifest YAML schema 借鉴 Goose extension 模型。

### 12. Aider
- **项目**：[github.com/Aider-AI/aider](https://github.com/Aider-AI/aider)
- **抓取**：2026-05-09
- **License**：Apache-2.0
- **借鉴点**：CLI-based coding agent + git workflow / artifact 隔离
- **依赖**：❌ 不引入（Aider 是 Python，Vessel 走 CC CLI）
- **判断**：M0.5 CodingDriver artifact 隔离（`instance/workspace/<run_id>/`）借鉴 Aider 的 git-aware workflow。

### 13. CrewAI（反例）
- **项目**：[github.com/joaomdmoura/crewAI](https://github.com/joaomdmoura/crewAI)
- **抓取**：2026-05-09
- **License**：MIT
- **借鉴点**：Multi-agent orchestration（**反例**：v0.1 不做 multi-agent，Vessel 是单内核 + Capability）
- **依赖**：❌ 不引入
- **判断**：作为反例提醒——Vessel 是个人单机助理，不做企业级 multi-agent 编排，避免过度工程化。

### 14. OpenTelemetry
- **项目**：[opentelemetry.io](https://opentelemetry.io) / [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- **抓取**：2026-05-09
- **License**：Apache-2.0
- **借鉴点**：trace_id 32 hex / span_id 16 hex / W3C TRACEPARENT 子进程传播协议
- **依赖**：❌ v0.1 不引 SDK；v1+ 加 exporter 时再引（[trace.ts](../../packages/backend/src/observability/trace.ts) 注释明确）
- **判断**：v0A.1 cursor B1 修复：直接采用 OTEL 标准格式，避免后续迁移成本。

### 15. SQLite (better-sqlite3)
- **项目**：[github.com/WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **抓取**：2026-05-09
- **License**：MIT
- **借鉴点**：同步 SQLite TS binding（Eva 已用）
- **依赖**：✅ Eva 继承
- **判断**：满足"个人单机不引 PG/Redis"硬约束。M1C-B 起加 sqlite-vec 扩展。

---

## 评估维度（每条新增条目检查）

1. **License 兼容性**：避 AGPL/SSPL（按 ADR-007 + E2 log 策略）—— 思想可借鉴，代码不传染
2. **本地优先**：满足 "个人单机 + 本地小模型" 硬约束
3. **TS 主栈兼容**：Python 子进程边界清晰（ADR-012）
4. **维护活跃度**：commits in last 90 days；维护者背景
5. **CVE 历史**：pnpm audit / GitHub security advisory

> **新增条目模板**：复制上面任一条结构，照填 6 字段（项目 / 抓取 / license / 借鉴点 / 依赖 / 判断）。
