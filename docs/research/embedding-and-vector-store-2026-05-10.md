# Embedding 推理 + 向量存储 — Phase 0 Spike Report

> **researched_at**: 2026-05-10
> **review_after**: 2026-08-08（+90 天，超期使用前必须 refresh，per ADR-015）
> **sources_checked**: HuggingFace model cards (12), GitHub repos (10), npm registry (4), Apple Developer docs (1), Simon Willison TIL (1), Mastra/LocalWebAI 衍生项目 (2)
> **决策服务于**: M1C-B（长期记忆向量检索）

## 1. 目标决策

为 Vessel 选定本地 embedding 推理路径 + 向量存储引擎，让"长期记忆向量检索"
能在个人单机 Mac arm64 上离线运行。

**DAR 触发条件**（ADR-015 yes/no 检查表，4 项命中）：
- ☑ 引入新依赖（onnxruntime-node / sqlite-vec / fastembed Python 至少其一）
- ☑ 引入新存储引擎（向量索引或 BLOB 自管）
- ☑ 引入新语言或 worker（可能新增 Python ML worker 类型）
- ☑ 影响 NFR（向量检索延迟 / 内存占用 / 启动开销）

按 ADR-015，"重大外部选型必引 prior art"——本报告是引文凭据。

---

## 2. 业界做法（Prior Art）

| 项目 | URL | License | 活跃度 | 借鉴点 |
|---|---|---|---|---|
| **Qdrant fastembed (Python)** | [github.com/qdrant/fastembed](https://github.com/qdrant/fastembed) | Apache-2.0 | 2936★，最近 push 2026-04-21 | "ONNX 推理打包成单一 lib" 的范式参考 |
| **Anush008 fastembed-js** | [github.com/Anush008/fastembed-js](https://github.com/Anush008/fastembed-js) | MIT | **🔴 已 archived 2026-01-15** | 反例：单作者社区 port 不可作为 prod 路径 |
| **transformers.js v4** | [github.com/huggingface/transformers.js](https://github.com/huggingface/transformers.js) | Apache-2.0 | 14k★，HF 官方维护 | 替代 fastembed-js 的活跃 ONNX 路径 |
| **sqlite-vec** | [github.com/asg017/sqlite-vec](https://github.com/asg017/sqlite-vec) | Apache-2.0 | 7558★，最近 push 2026-04-08，pre-v1 | SQLite 单文件向量扩展，Vessel SQLite-first 哲学契合 |
| **Simon Willison openai-to-sqlite** | [TIL post](https://til.simonwillison.net/llms/openai-embeddings-related-content) | Apache-2.0 | Simon 长期推 | "几千条 BLOB + JS 余弦"零依赖范式 |
| **Ollama embeddings** | [ollama.com/library/nomic-embed-text](https://ollama.com/library/nomic-embed-text) | MIT (Ollama) + Apache-2.0 (model) | 上游高活跃 | "本地 daemon HTTP API" 范式 |
| **DarwinKit** | [github.com/0xMassi/darwinkit](https://github.com/0xMassi/darwinkit) | (待核) | 小但精 | macOS 原生 NLContextualEmbedding via Swift CLI + JSON-RPC over stdio 先例 |

> **关键 finding**：fastembed-js 在 v5.1 evaluation 时还活，**v5.4 → 现在已 archived**。
> 这种"单作者社区 port"路径的 staleness 是真实风险；选 HF / Qdrant / Apple
> 等"组织维护"路径更安全。

---

## 3. 学术 / 标准参考

- **MTEB / C-MTEB benchmark**（[huggingface.co/spaces/mteb/leaderboard](https://huggingface.co/spaces/mteb/leaderboard)）
  embedding 模型 retrieval 质量行业标准。中文专用 C-MTEB 用于本报告模型对比。
- **Approximate Nearest Neighbors**（HNSW / IVF）— sqlite-vec 当前用 brute-force
  exact search（v0.1.x），未来 v0.2 计划 HNSW 索引（issue #112）。本 spike 不依
  赖 ANN，几千-几万条 brute force 在个人单机够用。
- **Matryoshka Representation Learning (MRL)**（Kusupati et al, 2022）— Qwen3-Embedding
  和 jina-v3 都用 MRL，可在 32-1024 维之间动态截断，省 sqlite-vec 空间。本 spike
  M1C-B 暂用固定维度，MRL 留作后续优化。

---

## 4. 对比表（按 Vessel 硬约束打分）

四个候选路径，每个 + 模型选择：

| 路径 | Embedding 推理 | 向量存储 | 进程模型 | TS 主栈契合 | 个人单机契合 | 关键风险 |
|---|---|---|---|---|---|---|
| **A. transformers.js + sqlite-vec** | TS 进程内（onnxruntime-node, native prebuilt arm64） | sqlite-vec 扩展（asg017） | 单进程 | ✅ 强 | ✅ 强 | sqlite-vec pre-v1 + 维护 gap; transformers.js 模型 download 首启慢 |
| **B. fastembed Python worker + sqlite-vec** | Python 子进程（uv + Qdrant fastembed） | sqlite-vec 扩展 | 主进程 + Python helper | ⚠️ 多语言运维 | ⚠️ 加 Python 依赖 | Python uv 子进程 + JSON-RPC 没成品先例（没人这么拼） |
| **C. Ollama daemon + sqlite-vec** | Ollama HTTP server（已 daemon） | sqlite-vec 扩展 | 主进程 + ollama helper | ✅ Node fetch 即可 | ⚠️ 需独立装 ollama + 占持续端口 | 高并发 hang issue #3029；不在 vessel 进程组内不易 lifecycle 管理 |
| **D. transformers.js + BLOB + JS 余弦** | TS 进程内 | better-sqlite3 BLOB（无扩展） | 单进程 | ✅ 强 | ✅ 强 | 几万条以上线性扫描慢；功能受限（不支持 ANN） |

按 5 接口契约 + Vessel 硬约束（个人单机 / TS 主栈 / 不要企业级 / helper subprocess
受控生命周期）打分：A > D > C > B。

---

## 5. 成本估算（相对值）

| 路径 | 实施工作量 | 学习曲线 | 维护成本 | 总评 |
|---|---|---|---|---|
| A. transformers.js + sqlite-vec | 中（~2 天 spike + 集成）| 低（npm + Hono 已会）| 中（sqlite-vec pre-v1 关注 release）| 适中 |
| B. fastembed Python worker | 高（~4 天，含 Python uv + JSON-RPC 自研协议）| 中（Python 端独立）| 高（双语言两套 lockfile）| 偏高 |
| C. Ollama daemon | 低（~1 天 fetch wrapper）| 低 | 低 | 但要求 user 已装 ollama，安装成本转给 user |
| D. BLOB + JS cosine | 低（~半天）| 极低 | 极低 | 早期可行；规模受限 |

---

## 6. 迁移路径

如选 **路径 A**（transformers.js + sqlite-vec）：
1. 新增 npm 依赖：`@huggingface/transformers` + `sqlite-vec`
2. backend/src/memory/ 加 `embeddings.ts`（封装 model load + embed），单例（v0.1 不池化）
3. memory.db 加新表 `memory_records (id, kind, content TEXT, embedding BLOB)` + sqlite-vec virtual table
4. 加 migration 0004（schema_version=4）
5. 加 `vessel-core memory add / search` CLI 子命令
6. 集成测试：写入 5 条含唯一测试词 → 重启 → search → top-K 含
7. 模型默认 bge-small-zh-v1.5（见 §11 推荐）

如未来要换路径（A → B/C/D），切换点是 `embeddings.ts` 单文件 + migration 数据迁移
脚本，影响范围窄。

---

## 7. 回退方案

如果 **路径 A spike 失败**（onnxruntime-node 在 arm64 不稳 / sqlite-vec 在
better-sqlite3 加载失败 / 中文质量不够）：

- **回退顺序**：A → D（去掉 sqlite-vec，纯 BLOB + JS 余弦）→ C（Ollama）→ 推 v1+
- D 最容易，几千条规模够用；如果 user 数据膨胀到几万条再加 sqlite-vec
- C 是"用户已装 ollama"前提下的零代价路径
- B（Python worker）作为最后兜底，因为引入双语言运维

**plan v5.1 锁定语义** 已支持回退：M1C-B spike 双失败则推 v1+，M1C-A 不依赖
embedding 仍可独立完成（已完成 + M1C-A+ 落地）。

---

## 8. Vessel 硬约束兼容性

| 硬约束 | 路径 A 是否兼容 | 说明 |
|---|---|---|
| TypeScript 主栈 | ✅ | 进程内 npm 依赖，不引入 Python |
| 个人单机不要企业级 | ✅ | 单进程，无 daemon |
| 不上 LLM Driver / token billing | ✅ | 完全本地 ONNX 推理 |
| Coding CLI 不走 SDK | ✅（无关） | 此 spike 不涉及 Coding 路径 |
| helper subprocess 受控生命周期 | ✅（无关） | 路径 A 无 subprocess |
| 集成 = 借鉴搬开源代码 | ✅ | npm install 也算"借鉴"；模型权重是 MIT/Apache-2.0 |
| ML worker 边界（ADR-012）| ⚠️ 名义上不需要 worker，但与 ADR-012 "ML 任务走子进程 worker" 表述矛盾 | 需要 ADR-012 修订（见 §11）|

> **路径 A 与 ADR-012 的张力**：ADR-012 写的是"ML worker 子进程"作为基础假设，
> 当时假设 ML 推理过重 ts 主进程跑不动。但 transformers.js + onnxruntime-node
> 已经把 ONNX 推理跑进 ts 进程内（Apple Silicon Metal/CPU），这个假设在
> 2026 年不成立。**M1C-B 实施前应修订 ADR-012**，改成"ML 推理首选 ts 进程内
> ONNX；超大模型（如 whisper-large）才走 Python worker 边界"，与 plan v5.1
> 既有 fallback 路径一致。

---

## 9. License / Security 风险

### 依赖 license
- `@huggingface/transformers`: Apache-2.0 ✅
- `onnxruntime-node`（间接）: MIT ✅
- `sqlite-vec` npm: Apache-2.0 ✅
- `better-sqlite3`（已用）: MIT ✅

### 模型 license（首选 + 备选）
- **bge-small-zh-v1.5**: MIT ✅（首选）
- multilingual-e5-small: MIT ✅（次优）
- jina-v3: ❌ CC-BY-NC（**违反 Vessel 硬约束，必须排除**）
- m3e-base: ❌ NC + 已停维护（**排除**）

### CVE / supply chain
- HuggingFace transformers.js（HF 官方组织）— 上游攻击面集中且监督高
- sqlite-vec — 单作者维护（Alex Garcia），社区监督较弱；建议 pinning version
- 建议在 M1C-B 实施前跑一次 `pnpm audit --audit-level=high` 并 record SHA

### 模型权重源
模型从 HuggingFace CDN 下载。HF 默认走 https + ETag 校验，但权重不签名 — 极
端 supply chain 攻击仍可能。**Mitigation**: 首次下载后把 model SHA 记入
`docs/notes/model-sha-pinning.md`，后续启动比对。M1C-B 实施时落地。

---

## 10. Staleness 元数据

```yaml
researched_at: 2026-05-10
review_after: 2026-08-08
sources_checked:
  - github.com/qdrant/fastembed (push 2026-04-21)
  - github.com/Anush008/fastembed-js (archived 2026-01-15)  # 关键变更
  - github.com/huggingface/transformers.js (HF 官方)
  - github.com/asg017/sqlite-vec (push 2026-04-08, pre-v1)
  - huggingface.co/BAAI/bge-small-zh-v1.5 (MIT)
  - huggingface.co/Qwen/Qwen3-Embedding-0.6B (Apache-2.0, 2025-05 发布)
  - npm registry @huggingface/transformers v4.x
```

90 天后（2026-08-08）超期使用本结论前必须 refresh，重点关注：
1. sqlite-vec 是否进入 v1 stable
2. fastembed Python 是否新增 BGE-M3 原生支持
3. 是否有新模型进入 < 200MB 中文友好梯队
4. ADR-012 是否已修订

---

## 11. 推荐 + 不确定的地方

### 推荐：路径 A — transformers.js + sqlite-vec + bge-small-zh-v1.5

**理由**（按重要性排）：
1. **TS 进程内**最契合 Vessel "个人单机不要企业级"硬约束
2. **HF 官方维护** transformers.js 比单作者 archived fastembed-js 安全得多
3. **bge-small-zh-v1.5** 是唯一同时满足 < 200MB / ≤ 512 维 / MIT / 官方 ONNX
   全部 4 条硬约束的中文模型
4. sqlite-vec 与 better-sqlite3 文档化兼容，Vessel 已在用 better-sqlite3
5. **回退路径明确**：A spike 失败 → D（纯 BLOB + JS 余弦）几千条规模够用

### 不确定的地方（留给 Phase 1 reviewer 挑战 / dogfood 验证）

1. **sqlite-vec pre-v1 breaking changes 节奏**——能否承受 v0.x → v0.y 升级
   带来的迁移工作？需要 dogfood 一段时间观察。
2. **transformers.js 首次模型 download** 在 ts 启动时会卡多久（HF CDN 中国大陆
   访问质量）？需要测试。bge-small-zh-v1.5 ONNX ~96MB，国内首次拉可能 30s-2min。
   建议：初始启动 background download + 完成前 search API 返回 503。
3. **bge-small-zh-v1.5 中文检索质量** vs 用户主观期望——C-MTEB retrieval 61.77
   在中文 small 档是 SOTA 之一，但与 Qwen3-Embedding-0.6B 的 ~70（推算）有差距。
   M1C-B 跑通后 dogfood 1-2 周观察是否需要升级到 base 档。
4. **ADR-012 修订**——路径 A 与 ADR-012 "ML 任务走子进程 worker" 假设冲突。
   实施 M1C-B 前必须先发起 ADR-012 修订（最小改动：加段说明 ts 进程内 ONNX
   优先，超大模型才走 worker）。这是 **gate item**。
5. **Vessel-specific design 部分**：memory 接口（Memory.add / Memory.search）
   是 Vessel 自研，无直接 prior art —— `Prior Art: No direct prior art found.
   Search keywords: ["personal-AI memory interface", "vessel core memory"].
   Rationale for self-design: 5 接口契约 0A 已锁定，本 spike 仅落地实现细节
   而不动接口形状`。

### Phase 1 reviewer 应额外审查

- **vessel-architect**: ADR-012 修订路径与 Vessel 整体 ML 哲学是否一致
- **vessel-pragmatist**: bge-small 选型 vs Qwen3 升级触发条件是否说清
- **vessel-risk-officer**: 模型权重 SHA pinning + supply chain mitigation 落地时机
- **cross**: sqlite-vec pre-v1 风险与 v0.1 锁版本策略
