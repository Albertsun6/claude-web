# M1C-B — Closeout (vessel-risk-officer lens)
Date: 2026-05-11-0100

## Findings

### PASS: SHA pinning 文件已落地
docs/notes/model-sha-pinning.md 含初始化步骤 + 验证 shell 命令 + future
automation 说明。M1C-B 实施 gate item #3 完成。

### MINOR-1: SHA pinning 表当前为空
"populated on first install" — 模型已在 e2e 测试时下载到 ~/.cache/huggingface/，
但 SHA 没填进表。**应该现在跑一次 `shasum -a 256` 把 SHA 写入表**，否则文档
是 dead reference。
**Risk**: Low — 个人单机使用是 user 自己装；非签名权重的供应链威胁也只在 HF
被劫持时成立。
**Verdict**: MINOR — 现在补一行（见 fix）。

### PASS: in-process embedding 失败 fallback
embedder.ts 的 getPipeline catch 块：load 失败时 reset pipelinePromise + 抛
错 + state.loadError 记录原因。callers (memory-store) 看到错误自己决定如何
降级。CLI cmdMemoryAdd 抛错后返回 1（exit code），vessel-core 进程不会
crash —— 与 ADR-012 amendment §B "in-process 失败 fallback" 一致。

### PASS: input 大小防御
- memory_records.kind CHECK 约束（4 个枚举值）
- content 是 TEXT 没大小硬限 —— 但调用方（CLI / HTTP）应限。
  - cmdMemoryAdd 没限 content 长度 → 极长 content 会被一次 embed 处理（bge
    自带 max_len=512 token，超出会 truncate）。不会让 vessel-core 崩，只是
    embedding 质量降。
  - HTTP 路由没加（M1C-B 没暴露 HTTP；都是 CLI）—— 暂无攻击面。
**Verdict**: 当前安全。HTTP 路由未来加时需复用 vessel-workflow.ts 的
MAX_TEXT_CHARS=8000 模式。

### MINOR-2: embedder 没设 download timeout
transformers.js 默认 fetch 模型 —— 没有 timeout，理论上 HF CDN hang 会让
ready() 永远不 resolve。生产环境 user 看到 vessel-core memory add 卡死。
**Verdict**: MINOR — defer / dogfood 1-2 周观察是否真碰到。如果出现，
embedder.ts 加 `AbortController` + setTimeout(60000)。

### PASS: 不暴露任何 secret 到 stdout / DB
- embedding_model 字段写 model name（如 "Xenova/bge-small-zh-v1.5"），公开信息
- content 是 user 输入，user 自己决定敏感性
- 没有 API key / token / 凭证
- 模型权重在 HF cache 不进 vessel-core 数据目录

### INFO: sqlite-vec pre-v1
依赖 ^0.1.9，"expect breaking changes"。Mitigation：pinned to ^0.1.9 (而不
是 ^0.x.x)，每次升级前过 vec_memory schema 兼容性 check。

## Verdict: PASS — 2 MINOR (1 fix-now: SHA 填入)
