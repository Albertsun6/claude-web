# ADR-012: Language = TypeScript（主栈）+ ML Worker 边界（Python 子进程）

- **Status**: Accepted (amended 2026-05-10)
- **Date**: 2026-05-09 (original) / 2026-05-10 (amendment)
- **Deciders**: yongqian
- **Tags**: language, runtime, ml-boundary, eva-evolution
- **Resolves**: v4 第四轮外部 AI 评审 / D' 路线技术栈选型
- **Depends on**: ADR-000-adopt-eva-codebase-as-vessel-foundation
- **Spike report (amendment)**: [docs/research/embedding-and-vector-store-2026-05-10.md](../../research/embedding-and-vector-store-2026-05-10.md)

## Amendment 2026-05-10 — ML 任务分级 + Embedding 路径修订

> 修订动机来自 [Phase 0 spike report](../../research/embedding-and-vector-store-2026-05-10.md)
> 的两条关键发现：
>
> 1. **fastembed-js (Anush008/fastembed-js) 已 archived 2026-01-15**，原本作为
>    "TS 主进程内 ONNX 首选"的路径死了。
> 2. **HF 官方 transformers.js v4** + `onnxruntime-node`（macOS arm64 prebuilt）
>    可在 TS 主进程内稳定跑 < 200MB ONNX 模型（如 bge-small-zh-v1.5）。
>
> 这推翻了 ADR-012 原版"所有 ML 任务都走 subprocess worker"的笼统假设。
> 实际边界更细：**模型够小就跑进程内，超大模型才走 worker**。

### Amendment 决策

#### A. ML 任务**分级**（新增）

| 等级 | 标准 | 进程模型 | 例 |
|---|---|---|---|
| **轻量（in-process）** | ONNX 模型 < 200MB；推理 < 200ms/调用；**TS 进程内**通过 `transformers.js` + `onnxruntime-node` 跑 | TS 主进程内 | embedding (bge-small-zh-v1.5)；轻量重排 |
| **重量（worker subprocess）** | 模型 > 500MB，或 native binary 必须（whisper.cpp, piper），或长生命周期 daemon | Python / native worker subprocess | ASR (whisper-large)；TTS (piper)；未来超大 embedding (Qwen3-Embedding-0.6B) |

**判断规则**：模型大小是首要门槛；推理延迟和 Apple Silicon 原生加速可用性是
次要门槛。**默认偏向 in-process**——只在 ONNX 路径明显劣势时才走 worker。

#### B. 第 §2 决策表 Embedding 行修订

原表：
> Embedding（M1C-B）：首选 fastembed-js ONNX Node；备选 fastembed Python 子进程

修订为：

| ML 任务 | 实施 |
|---|---|
| **Embedding 轻量**（M1C-B 首选） | `@huggingface/transformers` + `onnxruntime-node` **TS 进程内**；模型 bge-small-zh-v1.5（MIT，96MB，512 维） |
| **Embedding 备选** | Python `fastembed` (Qdrant Apache-2.0) 子进程，HTTP loopback OpenAI-compatible API（保留原 v0A.1 修订 A6 设计） |
| **向量库** | `sqlite-vec` 加载到 better-sqlite3，**不走 worker** |

#### C. ASR / TTS 决策**不变**

whisper-cli / edge-tts / piper 仍走 spawn subprocess（生产已验证 + 模型大 +
native binary 必须）。Amendment 不影响 §2 ASR/TTS 行。

#### D. ml-workers/ Python 目录**仍保留**

即使 embedding 走 in-process，未来超大模型 / ASR / TTS 仍需要 Python worker。
ml-workers/ 目录 + uv 工具链不删。

### Amendment Consequences

正面：
- **更少多语言运维**：M1C-B 不再要求 user 装 Python；embedding 路径纯 TS
- **更快冷启动**：in-process 比 spawn Python 子进程快 ~1-2s
- **HF 官方 transformers.js** 维护者更稳定（vs Anush008 单作者 archived）

负面：
- **onnxruntime-node 是 native prebuilt**，体积约 +30MB（已可接受）
- **首次模型下载** ~96MB 走 HF CDN，国内首启可能 30s-2min；mitigation：
  background download + 完成前 search API 返回 503

中性：
- 实施时新增依赖：`@huggingface/transformers` + `sqlite-vec`（pnpm 加 2 行）
- 与 v0.1 不上 LLM Driver 硬约束**仍不冲突**（embedding 不是 LLM 推理）
- 与 ADR-009 (helper subprocess lifecycle) **不冲突**（in-process 不需要 lifecycle 管理）

---

## Context

第三/四/五轮外部 AI 评审建议：**主系统保 TS，ML 能力作为本地 worker / 子进程边界**。M1C 前 spike 验证（fastembed-js 是否够，否则 Python worker）。失败也只是把 ML worker 写成 Python，**不把整个 core 改成 Python**。

第五轮评审增订：
- "vessel-core 是唯一常驻主服务进程；ML / MCP / CC CLI 都是受控 helper subprocess"（不是多服务架构）
- "Python worker 失败只降级对应 capability，不影响 core"（健康检查 + capability 自动 disable）

## Decision

### 1. 主栈 = TypeScript

- 沿用 Eva backend / frontend / shared / iOS Swift 不变
- pnpm 9.0.0 workspace（ADR-001）
- Node 20+（Eva 现有要求）
- 类型检查：`tsc --noEmit`
- 测试：`tsx --test`（Eva 现有，沿用）

### 2. ML 任务走子进程 worker 边界

ML 类任务（embedding / ASR / TTS / 向量索引）以 **subprocess + IPC** 方式与 vessel-core 主进程通信：

| ML 任务 | 实现选项（M1C-B / M2-Voice spike 决定） |
|---|---|
| **Embedding**（M1C-B） | **首选**：`fastembed-js` ONNX Node（如果在 TS 主进程能跑）；**备选**：fastembed Python 子进程（**HTTP loopback 127.0.0.1:11435 + OpenAI Embeddings API 兼容**，v0A.1 修订 A6） |
| **ASR**（M2-Voice） | 沿用 Eva voice routes spawn `whisper-cli`（已生产验证）；包装为 ML worker |
| **TTS**（M2-Voice） | 沿用 Eva spawn `edge-tts`（中文）/ piper-tts（英文）；包装为 ML worker |
| **向量库**（M1C-B） | `sqlite-vec` 作为 better-sqlite3 加载的 C 扩展（不是子进程） |

### 3. ML worker lifecycle（v5.1 评审锁定，v5.4 lite 不变）

- **不池化**——M1C-B 一个 embedding worker 按需启动 + TTL 闲置回收；M2-Voice 再加 ASR/TTS worker
- **Capability uninstall 时**：
  - **专属 worker**（如 voice capability 独占的 ASR/TTS worker）→ 立即 shutdown
  - **共享 worker**（如 embedding worker 跨多 Capability 用）→ 走 TTL 自然回收
- 池化等真实性能问题出现再做（YAGNI）

### 4. ML worker 启动失败 fallback（v5.4 dogfood B-R2 增订）

主进程检测 worker exit 后：
- 标 capability unavailable
- 通知用户（escalation 到 inbox）
- 但**仍保持 vessel-core 服务可用**（degrading mode）

**首次启动失败模式 + 检测策略**（B-R2 fix）：
- fastembed 模型下载失败（网络 / 中国网络环境）→ 错误归因 "model download failed: <URL>"
- Python 版本不兼容（用户 Python < 3.10）→ "incompatible python version: <version>"
- pip install 失败（依赖编译错误，如 piper-tts on Apple Silicon）→ "ml-worker dependency install failed: <pkg>"
- `ml-workers/` 目录权限不对 → "ml-workers/ permission denied"
- venv 没建好（用户没装 uv 或 venv）→ "ml-workers venv missing; run `uv venv` to create"

`vessel-core --health` 命令报具体原因（不是泛 'unavailable'）。

### 5. 目录分工

| 目录 | 语言 | 职责 |
|---|---|---|
| `packages/backend/src/ml-worker/` | TS | manager（spawn lifecycle）+ client（embedding-client / asr-client / tts-client）+ JSON-RPC 协议 |
| `ml-workers/` | Python | 实际 worker 实现（`embedding_server.py` / `whisper_server.py` / `piper_server.py`）+ `pyproject.toml`（uv 或 pip + venv 独立管） |

### 6. Vessel 主进程对 ML worker 的接口

```typescript
// packages/backend/src/ml-worker/types.ts
// v0A.1 修订（cursor M1 2026-05-10）：详细接口签名 / OpenAI-compatible API spec / lifecycle
// 以 [FRAMEWORK §4.2](../../design/FRAMEWORK.md) 为权威；本 ADR 仅记决策（不复制接口定义，避免 contract drift）

export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>;
  health(): Promise<{ ok: boolean; reason?: string }>;
}

export interface AsrClient {
  transcribe(wav: Buffer): Promise<string>;
  health(): Promise<{ ok: boolean; reason?: string }>;
}

export interface TtsClient {
  synthesize(text: string, opts?: { voice?: string; rate?: number }): Promise<Buffer>;
  health(): Promise<{ ok: boolean; reason?: string }>;
}
```

### 7. Spike 时机

- M1C-B 前必跑 spike：fastembed-js（首选）vs Python worker（备选）—— 选定方案落 ADR-002 增订段
- 双 spike 都失败 → M1C-B 推 v1+；M1C-A（Workflow 挂起恢复）仍按计划完成（v5.1 评审锁定 fallback 路径）

## Consequences

### 正面

- ① **进程边界清晰**——TS 主进程不引入 Python 依赖；Python worker 依赖独立管（uv 或 pip + venv 放 `ml-workers/`），跟主项目 pnpm 完全分离
- ② **Python worker 失败只降级对应 capability**——主进程检测 worker exit 后标 capability unavailable + 通知用户，但仍保持 vessel-core 服务可用
- ③ **TS 侧 manager/client 在 `packages/backend/src/ml-worker/`；Python 侧实现在顶层 `ml-workers/`**——两个目录分工清楚，不混淆
- ④ **沿用 Eva 已有 ML 集成**——voice routes spawn whisper-cli 已生产验证，仅需包装为 ML worker
- ⑤ **生态最佳**——TS 在 Web/CLI/服务工程化最强，Python 在 ML 推理生态最广，各自取长

### 负面

- ① **多语言运维（TS + Python）**——但**进程边界清晰**：开发者改 TS 时不需要碰 Python，反之亦然
- ② **Python worker 安装复杂度**——首次启动需 `uv venv` + `uv pip install`；缓解方案：vessel-core 启动时检查 + 一键 setup 命令
- ③ **HTTP loopback 比 in-process 慢**——但 embedding/ASR/TTS 单次调用本来就 100ms+，IPC 开销 < 5%，可接受。v0A.1 修订（A6）从 stdio JSON-RPC 改 HTTP loopback + OpenAI API 兼容（Ollama/Pipelines 模式），调试 + 生态兼容性显著提升
- ④ **fastembed-js spike 可能失败**——v1+ 才决定；fallback 是 Python worker（不影响主架构）

### 中性

- 跟 ADR-000（Eva 演进）+ ADR-001（pnpm）+ ADR-006（Schema 演进）+ 现有 Eva voice routes 高度耦合
- 跟 v0.1 不上 LLM Driver 硬约束**不冲突**——ML worker 是 SDLC 工具（embedding/ASR/TTS），不是 LLM 推理；vessel-core 运行时仍只走 cli-runner.ts → CC CLI

## Prior Art

主要参考：
- **Eva 现有 voice routes**（`packages/backend/src/routes/voice.ts`）：spawn whisper-cli + edge-tts 子进程 + 临时文件管理。已生产验证 5 个集成挑战。
- **Sidecar pattern**（K8s/微服务）：辅助进程独立伸缩，但 Vessel 是单机不需要 K8s
- **Web Worker / Service Worker**（前端）：进程隔离 + 消息传递，类似但 Vessel 用 OS 子进程

Search keywords: `["typescript ml worker subprocess", "node child_process json-rpc python", "fastembed-js typescript bindings", "ml inference sidecar pattern personal app"]`

Rationale for self-design 部分（lifecycle 规则）：
- 不池化 + 按需启动 + TTL 回收是 Vessel 特化决策（个人单机 N=1 用户，池化是过度工程化）
- 专属 worker uninstall 立即 shutdown / 共享 worker 走 TTL 是 Vessel Capability 装卸语义衍生（不存在于 Eva）

## 验证

- ADR-012 Status = Accepted（**已**）
- M1C-B spike 完成后 ADR-002（embedding 选型）锁定
- M1C-B Acceptance：`vessel-core --health` 报具体原因（不是泛 unavailable）
- ML worker 失败时主进程标 memory capability unavailable，但 `vessel-core "echo hi"` 仍正常工作
- ML worker 子进程随 vessel-core 退出而清理（`pgrep -f "embedding_server.py"` 在 vessel-core 退出后返回空）

## 暂缓项（v1+）

- pool-based ML worker（性能问题真出现时再做）
- Cross-machine ML worker（远程 GPU）—— 违反"个人单机"硬约束
- ML worker 加密 IPC——v1+ 可选
