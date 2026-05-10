# M1C-B — Closeout (vessel-architect lens)
Date: 2026-05-11-0100

## Scope
长期记忆向量检索 in-process 实现：
- migration 0004 (memory_records 表)
- memory/embedder.ts (transformers.js 单例 + ready/embed/health)
- memory/memory-store.ts (sqlite-vec 加载 + addMemory/searchMemory/CRUD)
- vessel-core memory add/search/list/status CLI
- 17 smoke + 12 e2e 测试 = 29/29 全过
- ADR-002 amendment（Status: Proposed → Accepted (amended 2026-05-10)）
- docs/notes/model-sha-pinning.md

## Findings

### PASS: 实施严格遵循 ADR-012 amendment
ML 任务分级规则落地 —— bge-small-zh-v1.5 (96MB) 走 in-process，与 amendment
"< 200MB ONNX → in-process" 一致。没有 fallback 到 Python worker，原 ml-workers/
目录保留供 M2-Voice / 超大模型用，这与 ADR-012 amendment §A 一致。

### PASS: 接口最小化
EmbeddingClient 接口（ADR-012 §6）暗示了三个方法 embed/health/+ implicit
loading。embedder.ts 实际暴露：
- `ready()`: pre-warm Promise（ADR-012 amendment 隐含的"in-process semantics"）
- `embed(texts)` / `embedOne(text)`
- `health()`: 不阻塞，反映 singleton state
- `setEmbedModel/getEmbedModel`: model id 切换（M1C-B 实际不用，但接口对未来
  abstract 友好）

模块边界清晰：embedder（推理）/ memory-store（数据 CRUD + sqlite-vec）/ CLI
（用户接口）。无循环依赖。

### PASS: 数据模型符合 spike report
memory_records (id BIGINT, kind, content, source, embedding_model, ts) +
vec_memory (rowid alias, embedding float[512])。rowid 对齐让 KNN → JOIN 一步
到位，与 spike report § 7 推荐一致。

### MINOR-1: vec_memory 虚拟表创建延迟到运行时
migration 0004 sql 不能 CREATE VIRTUAL TABLE（sqlite-vec 还没 load），所以
sql 文件里只有注释 + memory-store.ts ensureVecReady() 在第一次用时创建。
这是 architectural choice 而非 bug —— migration 静态层 / runtime 加载层分
开。但对未来 reader 不显然（"为啥 0004 sql 没 vec_memory？"）。
**Verdict**: MINOR — 已经在 sql 里加注释说明。accepted-as-is.

### MINOR-2: M1C-B+ 的批量 addMemory 没做
addMemory 一次一条 + 一次 embedding。理论上 transformers.js pipeline 支持
batch 提高吞吐。当前 yagni 不做，spike report 推荐 future M1C-B+ 优化。
**Verdict**: MINOR — defer.

### INFO: 同进程 embedding 与 ADR-009 helper subprocess 的张力
ADR-009 (MCP server lifecycle) 把 helper subprocess 当受控资源。in-process
embedding 不是 subprocess 但占 ~150-300MB 内存（onnxruntime-node + 模型常驻）。
这个内存成本没有 lifecycle 管控（不像 subprocess 可以 spawn-on-demand TTL
回收）。M1C-B 实施按 plan v5.1 "不池化"原则可接受；M2-Voice 加载 whisper
后内存可能成问题，需要 review。

## 架构评估: PASS
- ADR-012 amendment 决策落地完整
- 依赖方向正确（CLI → memory-store → embedder + sqlite-vec）
- 测试金字塔：smoke (17) 单元 + e2e (12) 集成
- Eva path 0 影响（独立 module，不动 cli-runner / orchestrator）

## Verdict: PASS — 2 MINOR (defer)
