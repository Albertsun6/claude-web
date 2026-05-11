# M1C-B — Closeout (vessel-pragmatist lens)
Date: 2026-05-11-0100

## Findings

### PASS: 实施量比原计划缩减 ~50%
ADR-012 amendment 之前 plan 估计 M1C-B 要 4 天（Python worker + JSON-RPC 自研
协议 + uv 安装链 + ONNX export 自己跑）。实际：
- migration 0004：~30 行 sql
- embedder.ts：~120 行
- memory-store.ts：~150 行
- CLI 子命令：~100 行
- test-memory：~150 行
- ADR-002 amendment：~50 行
- SHA pinning：~50 行

总实施 ~650 行 + 真模型 download e2e 测试。半天工作量。

### PASS: 测试分层（smoke vs e2e）
默认 `pnpm test:memory` 只跑不要模型下载的 17 个测试 —— CI / dev 不被网络
依赖卡住。`pnpm test:memory:e2e` 才跑真下载 + KNN 找回（12 个额外）。

### PASS: e2e 真实数据验证 (中文 + 英文 mixed)
e2e 测试用 5 条带唯一 marker 的中文/英文混合记录 + 3 条无关记录 —— 验证
"top-5 包含全部 5 条 marker 记录"。这是真实使用场景的核心契约。

### MINOR-1: cmdMemoryAdd 用 --content="..." 而非 stdin
对长 content（多行 markdown）不友好。复杂场景下 user 应该用 echo "..." | xargs
拼 flag，或者将来加 --content-from-stdin。
**Verdict**: MINOR — defer / 用户实际遇到长文本痛点再加。

### MINOR-2: cmdMemoryStatus 异步预热但不阻塞
触发 ready() 但没等 → user 看到 health.loaded=false 然后 status 直接退出 →
模型可能在 process exit 前还没 down 完。下次 status 又重新看到 loaded=false。
**Verdict**: MINOR — accepted-as-is. status 是 snapshot，"loaded" 状态本来就
是异步的。

### INFO: BigInt 用法防御性
better-sqlite3 + sqlite-vec 的 rowid 类型校验严格，必须 BigInt。test-memory
和 memory-store 都用了 BigInt(...) 包装。这个不是 over-defense —— 实测会报
"Only integers are allowed for primary key values"。属于踩坑后的合理修复。

## Verdict: PASS — 2 MINOR (defer / accepted-as-is)
