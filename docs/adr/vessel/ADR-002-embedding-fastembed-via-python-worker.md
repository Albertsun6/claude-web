# ADR-002: Embedding = transformers.js in-process（amended 2026-05-10 from "fastembed via Python Worker"）

- **Status**: **Accepted (amended 2026-05-10)** — 原 Proposed 决策被 M1C-B Phase 0 spike 推翻
- **Date**: 2026-05-09 (original) / 2026-05-10 (amendment)
- **Deciders**: yongqian
- **Tags**: embedding, in-process, m1c-b
- **Tier**: 1（重大决策 + Phase 0 调研已完成）
- **Depends on**: ADR-012（TS + ML worker 边界，amended 2026-05-10）
- **Spike report**: [docs/research/embedding-and-vector-store-2026-05-10.md](../../research/embedding-and-vector-store-2026-05-10.md)

## Amendment 2026-05-10

> Phase 0 spike 关键发现：
> 1. **Anush008/fastembed-js 已 archived 2026-01-15** —— 原"备选 1"路径死了。
> 2. **HF 官方 transformers.js v4** + `onnxruntime-node` 在 Mac arm64 进程内
>    稳定跑 < 200MB ONNX 模型（实测 bge-small-zh-v1.5 ~96MB）。
> 3. **bge-small-zh-v1.5** 是唯一同时满足 < 200MB / ≤ 512 维 / MIT / 官方
>    ONNX 全部 4 条硬约束的中文模型（C-MTEB retrieval 61.77）。
> 4. **sqlite-vec** v0.1.9 与 better-sqlite3 兼容，512 维向量 + KNN 已生产可用。
>
> 这推翻了原 ADR-002 "首选 fastembed Python worker"决策。in-process 路径现在
> 是首选 —— 简化 M1C-B 实施（无 Python uv / 无 JSON-RPC 自研协议）。

### 修订决策

**首选（new default）**：
- **Embedding**: `@huggingface/transformers` v4.x (Apache-2.0) + `onnxruntime-node` 在 vessel-core ts 主进程内
- **模型**: `Xenova/bge-small-zh-v1.5` (MIT, 96MB ONNX, 512 维, L2-normalized)
- **向量存储**: `sqlite-vec` (Apache-2.0) 加载到 better-sqlite3 的 memory.db
- **进程模型**: 与 Soul / MCP / cli-runner 同进程

**备选（保留作为兜底）**：
- fastembed Python via worker（HTTP loopback OpenAI-compatible API）
- 触发条件：模型超过 200MB（如 Qwen3-Embedding-0.6B 1.2GB）或 transformers.js 在
  目标平台跑不动

**M1C-B 实际实施验证**（2026-05-10）：
- ✅ 17/17 smoke + 12/12 e2e 测试通过
- ✅ 真实 HF CDN 模型下载 + 中英文混合 embedding + KNN 找回测试通过
- ✅ 4 条硬约束全满足
- ✅ Eva path 不受影响（独立 module）

### 修订 Consequences

正面：
- M1C-B 实施工作量比原计划缩减 ~50%（无 Python worker 自研协议）
- 单语言运维（pure TS）
- 冷启动比 spawn Python 快 ~1-2s
- HF 官方 transformers.js 比 archived fastembed-js 维护更稳定

负面：
- onnxruntime-node native binary 增加 ~30MB 安装体积（已可接受）
- 首次模型下载 ~96MB（HF CDN，国内 30s-2min）
- sqlite-vec 仍 pre-v1（"expect breaking changes"）—— pinned to ^0.1.9

中性：
- 与 ADR-012 amendment 2026-05-10（ML 任务分级）协同
- 备选 Python worker 路径不删，保留 ml-workers/ 目录给 M2-Voice / 未来超大模型

---

## Context (original 2026-05-09)

M1C-B 长期记忆向量检索需要 embedding 能力。Vessel 硬约束：v0.1 不上 token 计费 LLM API；本地小模型优先（与 whisper/Piper 同思路）。

## Decision（条件 Accept）

**首选**：fastembed Python via worker（spawn `ml-workers/src/embedding_server.py`，stdin/stdout JSON-RPC）。

**备选**（Phase 0 spike 验证）：
- 尝试 1：fastembed-js（ONNX Node）—— 直接在 TS 主进程跑，免 Python 依赖
- 尝试 2：sentence-transformers via Python worker（fastembed 不可用时）

**Fallback**：双 spike 都失败 → M1C-B 推 v1+；M1C-A（Workflow 挂起恢复）仍按计划完成（不依赖 embedding，按 v5.1 评审决议）。

## 触发 Phase 0 调研

按 ADR-015 yes/no 检查表：
- ✅ 引入新依赖（fastembed / fastembed-js / sentence-transformers）
- ✅ 引入新存储（向量列 + sqlite-vec）
- ✅ 引入新 worker（Python ML worker）

→ M1C-B 实施前必跑 Phase 0 spike，写 spike report 进 `docs/research/embedding-typescript-options-<date>.md`（按 ADR-015 §「Spike Report 模板」10 段）。

## 暂不 Accept 理由

- fastembed-js 在 1M+ 上下文 / 大 batch 场景下的稳定性未知（本地无法预先测）
- ONNX Node 与 macOS arm64 + Apple Silicon 优化的兼容性未验证（R-03）
- 中国网络下 fastembed 模型下载失败率（R-02）

owner 在 M1C-B 跑 spike 后 review report → 把 Status 改 Accepted（或选备选 / fallback）。

## Prior Art（待 spike 时补全）

预期参考：
- [fastembed](https://github.com/qdrant/fastembed)（Python 主项目，Apache-2.0）
- [fastembed-js](https://github.com/Anush008/fastembed-js)（ONNX Node 实现，Apache-2.0）
- sentence-transformers（hugging face，Apache-2.0）

## Consequences（条件接受）

- 取决于 spike 结果；本 ADR Status=Proposed 不阻塞 M0–M1C-A
- ML worker lifecycle 规则（按 ADR-012 §3）：embedding 是共享 worker，TTL 闲置回收
