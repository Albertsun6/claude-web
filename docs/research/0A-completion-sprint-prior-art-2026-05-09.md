---
researched_at: 2026-05-09
review_after: 2026-08-07
sources_checked:
  - https://github.com/aaronjmars/soul.md
  - https://github.com/SillyTavern/SillyTavern
  - https://github.com/letta-ai/letta
  - https://github.com/openinterpreter/open-interpreter
  - https://github.com/crewaiinc/crewai
  - https://github.com/microsoft/autogen
  - https://aider.chat/docs/
  - https://block.github.io/goose/docs/goose-architecture/extensions-design/
  - https://docs.cursor.com/en/background-agent
  - https://newsletter.pragmaticengineer.com/p/how-claude-code-is-built
  - https://docs.ollama.com/api/introduction
  - https://lmstudio.ai/docs/typescript/plugins
  - https://github.com/pipecat-ai/pipecat
  - https://modelcontextprotocol.io/specification/2025-11-25
  - https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
  - https://docs.langchain.com/oss/python/langchain/human-in-the-loop
status: accepted
---

# Spike Report — 0A Completion Sprint Prior Art

> **触发**：用户 0A 完成后要求"完善架构和需求 + 上网找类似项目分析"。按 ADR-015 §「DAR 触发条件」满足"替换核心模块"+"影响隐私/权限/数据迁移"+"改变硬约束"3 项 → 必跑 Phase 0。
>
> **Resolves**: v0A.1 完善 sprint 输入 + 17 条改进建议（A/B/C 分类）

---

## 1. 目标决策

为 Vessel 0A 完成 sprint 提供 prior art：找出 Vessel 已经做对的 / 漏了什么 / 偏离主流的地方 / 应避免的反例。属于 DAR 检查表的 3 项：
- ✅ 替换核心模块（Capability / Memory / Trace 设计可能调整）
- ✅ 影响隐私 / 权限（Permission 三档模型）
- ✅ 改变硬约束（IPC 协议 / Trace schema 是不是要 pivot 到业界标准）

---

## 2. 业界做法（Prior Art）

### 类 1: AI 化身 / Persona / 灵魂规格

| 项目 | License | 活跃度 | 接口形态 | Vessel 对照 |
|---|---|---|---|---|
| **OpenClaw + soul.md 生态** | MIT | **超热**（2025 起，2026 已是 GitHub #1 by stars，~250-355K stars） | SOUL.md + IDENTITY.md + USER.md + AGENTS.md + MEMORY.md（5 文件 + 加载顺序有语义） | Vessel 单文件 soul.md 维护性差；应拆 4 sibling |
| **aaronjmars/soul.md** | MIT | 中（460 stars） | SOUL/STYLE/SKILL/MEMORY 4 文件 + data/ + examples/（good/bad calibration） | 同上，更轻量 |
| **SillyTavern Character Card V3** | AGPL-3.0 | 极高 | PNG + tEXt `ccv3` chunk + base64 JSON；含 lorebook（`character_book` 带 decorators）+ token budgeting | Vessel 没 lorebook；可作长期记忆注入路径 |
| **Letta（前 MemGPT）** | Apache-2.0 | 高 | 三层 memory（core/recall/archival）+ typed blocks + self-edit | Vessel Memory 单层 → 升级三层 |
| **Pi by Inflection** | 闭源（**反例**） | 已衰退（团队大部被 MS 收编） | 固定人格 + 100 turn 失忆 + 强 guardrail | 验证 Vessel 用户可写 soul + 三层 memory + 弱 guardrail 方向对 |
| **OpenPersona / Soulclaw** | MIT | 中 | 4+5+3 架构（Soul/Body/Faculty/Skill 分层）+ 4-tier memory + 80+ personas | Vessel 5 接口平铺，没"哪些是身体哪些是灵魂"语义分层 |

### 类 2: Personal AI Agent Runtime

| 项目 | License | 活跃度 | 接口形态 | Vessel 对照 |
|---|---|---|---|---|
| **Goose（Block / AAIF）** | Apache-2.0 | 高（29K+ stars） | **Rust + Extension trait（4 方法：name/description/tools/call_tool/status）+ Recipe YAML + 全 MCP 化** | Vessel 5 接口收敛到 Goose 的 Extension + Tool 模式可能更精简 |
| **CrewAI** | MIT | 极高（40K+ stars） | Pydantic agent（role/goal/backstory）+ **Crews（自主协作）+ Flows（显式编排）+ 单 Memory 类 + LanceDB** | Vessel 单 Workflow engine → 拆 Crew/Flow 二分；Memory hierarchical scope |
| **AutoGen → MS Agent Framework** | MIT | 极高（30K+ stars） | **从 implicit GroupChat 转 typed Graph + checkpointing**（2026 大重构） | 反例教训：Vessel 直接走 typed graph，避免 GroupChat |
| **Aider** | Apache-2.0 | 极高（30K+ stars） | **git-first**（每 edit 一个 commit + branch + `/undo`）+ Architect mode（双模型）+ tree-sitter repo map | Vessel cli-runner.ts 应抄 git-first 隔离 |
| **Open Interpreter** | AGPL-3.0 | 极高（55K+ stars） | **极简：LLM + 一个 exec(language, code)** | 反方向：Vessel Tool registry 是否过度复杂？哪些 tool 实际是 bash() 特化？ |
| **smol-developer / smol-ai** | MIT | 中 | 极简单 agent loop | 不深入研究 |

### 类 3: Coding Agent CLI 集成

| 项目 | License | 接口形态 | Vessel 对照 |
|---|---|---|---|
| **Claude Code** | 闭源 | TypeScript + React + Ink + Yoga + Bun build；3 层架构（Extension/Delegation/Core）；Subprocess pattern；Permission 三档 + 静态命令分析 + settings.json 三层 hierarchy | Vessel cli-runner.ts 直接照抄 subprocess 合约 + permission 模型；prefetch 优化范例 |
| **Cursor 3 Agents (2026-04)** | 闭源 | **从 file-centric 转 agent-centric**；Background agents = 异步云端 Ubuntu VM；本地 Agent mode 同步；同时 worktrees + SSH + cloud 多 agent | Vessel cli-runner.ts 默认 `git worktree add` 隔离（轻量 Cursor 模式） |
| **Sweep AI** | Apache-2.0 | 向量索引 + GitHub App + language-agnostic（不写 LSP） | Vessel 不需要 GitHub bot；但 embedding-based code understanding 是替代方向 |
| **GitHub Copilot Workspace / Devin** | 闭源 | sandboxed VM + 长 horizon planning（每 task 一个完整 environment） | 不适用（个人单机硬约束） |

### 类 4: Local-First AI / 本地推理

| 项目 | License | 接口形态 | Vessel 对照 |
|---|---|---|---|
| **Ollama** | MIT | **Go + Gin + 11434 端口 + OpenAI/Anthropic API 兼容 + NDJSON + client-server** | Vessel ML worker 应抄 HTTP loopback + NDJSON（不是 stdio JSON-RPC） |
| **LM Studio** | 闭源（plugin SDK 开源） | **4 plugin types（Tools Provider / Prompt Preprocessor / Generators / Custom Config）**；TS/Python/REST/OpenAI/Anthropic 5 SDK | Vessel Capability 拆 4 hook point（不是单一接口） |
| **Open WebUI Pipelines** | MIT | **Sidecar process + OpenAI-compatible API + 9099 端口**（PIPELINES_URLS auto-download） | 直接借鉴 Pipelines 模式作 ML worker 表面 |
| **llama.cpp / whisper.cpp** | MIT | C++ + 多 binding | Python 子进程 + HTTP > native binding（跨平台维护性更好） |
| **Pipecat** | BSD-2-Clause | **Frame-based async pipeline**（frames + processors）+ 20+ STT / 30+ TTS / 多 LLM | Vessel voice capability 直接吃 Pipecat（不要自拼 STT→LLM→TTS） |

---

## 3. 学术 / 标准参考

### MCP（Model Context Protocol）—— **必须兼容**

- **Spec**: 2025-11-25（最新）— JSON-RPC 2.0 + Hosts/Clients/Servers 三角
- **Server primitives**: Resources / Prompts / Tools
- **Client primitives**: Sampling / Roots / Elicitation
- **生态**: 10000+ 公开 server，67% stdio / 28% Streamable HTTP / 5% 旧 SSE
- **治理**: Anthropic 2025-12 捐给 AAIF（Linux Foundation，Block / OpenAI / Anthropic 共同）
- **使用方**: Claude Code / Goose / LM Studio / Open WebUI / Cursor 全部 MCP 化

**Vessel 含义**：自定义 Capability 协议**会立刻孤立**。Vessel Capability 必须双向 MCP 兼容（既能 expose 成 MCP server 给外部 agent 调，也能 consume 外部 MCP server）。

### OTEL GenAI Semantic Conventions

- **4 类 span**: `create_agent` (CLIENT) / `invoke_agent_client` (CLIENT 远程) / `invoke_agent_internal` (INTERNAL 本地) / `invoke_workflow` (INTERNAL 多 agent)
- **属性命名空间**: `gen_ai.*`
- **必须**: `operation.name`, `provider.name`
- **条件必须**: `agent.id`, `agent.name`, `conversation.id`, `request.model`
- **推荐**: token usage, finish_reasons, server.address
- **支持**: Datadog v1.37+, Amazon, Google, IBM, MS, Elastic 都已 contribute

**Vessel 含义**：Vessel "OpenTelemetry-lite 12 字段"应**直接吃** OTEL GenAI conventions（不要发明 trace_id / span_id 等）。

### HITL Pattern (LangGraph + CrewAI + HumanLayer + MS Semantic Kernel + Temporal)

- `interrupt_before` 暂停在某 node
- 序列化整个 state（messages + tool_results + intermediate artifacts）到 checkpointer
- 等人响应后从断点 resume

**Vessel 含义**：M1C-A workflow_state 设计已大致对齐，但应明确"checkpoint 序列化什么 / 怎么 reload 全 state"。

---

## 4. 对比表（按 Vessel 硬约束打分）

| 维度 | Vessel 当前 0A | OpenClaw 模式 | Goose 模式 | Letta 模式 | Aider 模式 |
|---|---|---|---|---|---|
| 个人单机兼容 | ✅ | ✅ | ✅ Rust 单进程 | ❌ Python + PostgreSQL | ✅ |
| 不上 token 计费 LLM | ✅ | ✅ | ✅ 任何 LLM 后端 | ❌ 需 API key | ⚠️ 默认走 API |
| TS 主栈兼容 | ✅ | N/A（markdown） | ❌ Rust | ❌ Python + TS SDK | ❌ Python |
| Eva 优先复用 | ✅ | N/A | ❌ | ❌ | ❌ |
| 维护成本 | 中 | 低（纯 markdown） | 中 | 高（PG migration） | 低 |
| **MCP 兼容** | ❌ | N/A | ✅ 全 MCP 化 | ⚠️ 部分 | ❌ |
| **OTEL GenAI** | ❌（自定义 12 字段） | N/A | ⚠️ 部分 | ⚠️ 部分 | ❌ |
| **HITL checkpointer** | 设计中（M1C-A） | N/A | ⚠️ Recipe 不强 | ⚠️ | ❌ |

---

## 5. 成本估算

| 改进 | 实施工作量 | 维护成本 | 学习曲线 |
|---|---|---|---|
| A1 soul.md 拆 4 sibling | S（2-4 hrs，0A 文档修订） | 极低 | 零 |
| A6 ML worker HTTP loopback | M（4-8 hrs，FastAPI 模板 + TS fetch client） | 低 | 低（Ollama API 兼容生态丰富） |
| A7 OTEL GenAI conventions | M（重新设计 trace schema + redaction spec 同步） | 低（用 OTEL JS SDK） | 中（需读 OTEL spec） |
| A2 Memory 三层 typed blocks | L（M1C-A/B 实施时改） | 中 | 中（Letta 文档参考） |
| A3 Capability 4 hook point | L（M0.5+ 实施时改） | 中 | 中（LM Studio plugin 参考） |
| A4 git worktree 隔离 | M（M0.5 cli-runner adapter 时） | 低 | 低 |
| A5 Permission Claude Code 三档 | M（M1B 实施时） | 中 | 低 |

---

## 6. 迁移路径

### 阶段 1（0A 完善 sprint，立即做）

仅做不影响 0B plumbing 的 A 类（**3 项**）：
- A1 soul.md 拆 4 sibling — FRAMEWORK §6 SoulSpec schema 修订
- A6 ML worker IPC HTTP loopback — FRAMEWORK §4 + ADR-012 修订（影响 0B 的 ml-worker/types.ts stub）
- A7 OTEL GenAI conventions — FRAMEWORK §5 Trace 协议 + trace-redaction-spec 修订（影响 0B 的 observability/trace.ts stub）

### 阶段 2（M0+ 各 milestone 实施时改 A 类剩余 4 项）

不阻塞 0B；记入 ROADMAP 各 milestone 的"改进"段：
- A2 Memory 三层 → M1C-A/B 实施时
- A3 Capability 4 hook point → M0.5+ 实施时
- A4 git worktree 隔离 → M0.5 cli-runner adapter 时
- A5 Permission 三档 → M1B 实施时

### 阶段 3（B 类全部推到 ROADMAP，C 类全部进 IDEAS）

- B1 SillyTavern V3 character card 导入器 → M2-Soul+
- B2 Lorebook with decorators → M1C-B
- B3 Recipe YAML → M1C-A 之后
- B4 双模式 chat → v1+
- B5 HITL via interrupt → M1C-A 借鉴 LangGraph

---

## 7. 回退方案

如阶段 1 三项 A 类改进发现实施障碍：
- **A1 失败**（拆文件破坏现有 OpenClaw 引用）→ 保留单文件 soul.md，仅在 §6 SoulSpec 加 frontmatter sibling 字段引用
- **A6 失败**（HTTP loopback 在某 OS 不工作）→ 回退 stdio JSON-RPC（ADR-012 §6 原方案）
- **A7 失败**（OTEL GenAI spec 太重 / 找不到 JS SDK）→ 回退自定义 12 字段（current 0A），但加注引用 OTEL GenAI 命名空间映射表

回退点：v0A.1 改动后 4-way 评审；如有 BLOCKER → owner 决策回退或继续 spike。

---

## 8. 与 Vessel 硬约束兼容性

| 硬约束 | A1 (soul 拆) | A6 (HTTP IPC) | A7 (OTEL GenAI) |
|---|---|---|---|
| 个人单机 | ✅ | ✅ loopback 不出本机 | ✅ |
| 不上 token 计费 LLM | ✅ | ✅ | ✅ |
| TS 主栈 + ML worker | ✅ | ✅ | ✅ JS SDK 存在 |
| Eva 优先复用 | ✅（仅扩展 schema） | ⚠️ 改动 ml-worker/types.ts stub | ⚠️ 改动 observability/trace.ts stub |
| Capability 装卸 | ✅ | ✅ | ✅ |

3 项 A 类都通过硬约束检查。

---

## 9. License / Security 风险

| 项目 | License | 风险 | 备注 |
|---|---|---|---|
| OpenClaw soul.md | MIT | 低 | 借鉴模式（非代码） |
| SillyTavern V3 spec | AGPL-3.0 | **中** | 借鉴 spec 模式不传染；但实现需写自家代码 |
| Letta | Apache-2.0 | 低 | 思想借鉴 |
| Goose | Apache-2.0 | 低 | 思想借鉴；如需直接用 Recipe YAML 模式可参考 |
| Aider | Apache-2.0 | 低 | 思想借鉴 |
| OTEL JS SDK | Apache-2.0 | 低 | 直接 dependency |
| MCP TypeScript SDK | MIT | 低 | 已计划 dependency（M1B） |
| Ollama API | MIT | 低 | API 兼容借鉴（不依赖 Ollama 本身） |
| Pipecat | BSD-2-Clause | 低 | M2-Voice 时可考虑直接 dependency |

无 AGPL/SSPL/BUSL **依赖**风险（SillyTavern AGPL 是 spec 借鉴非代码 import）。

---

## 10. 推荐 + 不确定的地方

### 推荐方案：**阶段化完善，3 个 A 类立即做，剩余推迟**

**0A.1 完善 sprint 内**（**3 项 A 类**）：
1. **A1 soul.md 拆 4 sibling**（修 FRAMEWORK §6 SoulSpec schema + REQUIREMENTS NFR）
2. **A6 ML worker HTTP loopback**（修 FRAMEWORK §4 + ADR-012）
3. **A7 OTEL GenAI conventions**（修 FRAMEWORK §5 + trace-redaction-spec + REQUIREMENTS NFR-O1/2/3）

**0A.1 不立即做但记录的**（4 项 A 类 + 5 项 B 类 + 5 项 C 类）：
- A2-A5 进 ROADMAP 各 milestone
- B1-B5 进 ROADMAP M2+ / v1+
- C1-C5 进 IDEAS.md 灵感库

### 留给 Phase 1 reviewer 挑战的不确定点

1. **Vessel 是否真需要 MCP 双向兼容**？v0.1 仅 owner 一个用户，无外部 agent 调 Vessel；MCP consume 已在 ROADMAP M1B。如果不做 MCP expose，Vessel "ecosystem play" 推到 v1+ 是否可接受？
2. **OTEL GenAI 是否过早**？当前 12 字段 schema 已经在 trace-redaction-spec 落地很深，pivot 到 OTEL GenAI 可能引入未来规范变化风险（spec 仍在 incubating 状态）。
3. **soul.md 拆 4 sibling vs 单文件 + frontmatter** —— 哪个更适合 Vessel 个人单机定位？拆文件好处是 git diff 可读性，坏处是 5 个文件管理。
4. **HTTP loopback vs stdio JSON-RPC** —— HTTP 调试友好但启动成本（端口管理 / 防火墙）；stdio 简单但调试难。Ollama 模式胜在生态兼容（OpenAI/Anthropic SDK 直接当 client）。
5. **A2-A5 推到 milestone 实施时改 vs 0A 一次改完** —— 如 0A 已 over-engineer 的话，每次实施时 refactor 是技术债；但一次改完是文档蔓延。哪个更对？
