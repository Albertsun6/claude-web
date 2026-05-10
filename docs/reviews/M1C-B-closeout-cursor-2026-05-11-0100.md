# M1C-B — Closeout (cursor cross-review lens)
Date: 2026-05-11-0100

## Cross-cutting concerns

### PASS: 5 个 ADR-012 amendment gate items 全部落地

| Gate item | 落地证据 |
|---|---|
| in-process embedding 失败 fallback 路径 | embedder.ts getPipeline catch + state.loadError；CLI cmdMemoryAdd return 1 |
| HF CDN 国内 mitigation | embedder.ready() Promise 异步预热；status 命令显示 loaded=false 让 user 看到下载进度状态 |
| model SHA pinning | docs/notes/model-sha-pinning.md 含 SHA `69a0b846...` (90MB model.onnx) |
| EmbeddingClient.health() in-process 语义 | embedder.health() 返回 {ok, model, loaded, reason}；不阻塞 |
| ADR-002 update | Status: Proposed → Accepted (amended 2026-05-10)；Decision 段重写 |

### PASS: Phase 0 spike report → ADR amendment → 实施 链条闭合
spike report 推荐路径 A → ADR-012 + ADR-002 amendment 决策 A → M1C-B 实施
按 A 路径完成。三段路径首尾一致。这是 ADR-015 设计意图（Phase 0 → Phase 1
→ 实施）的完整证据。

### PASS: Eva path 0 影响
- cli-runner.ts 不变
- orchestrator.ts 不变
- packages/backend/src/routes/* 不变（M1C-B 没暴露 HTTP）
- 现有 lessons / workflow / soul / m1bplus / m2-ios-alpha / coding-driver /
  vessel-http / vessel-ws 测试全部回归通过
- memory.db schema 演进 v3 → v4，对老 DB 用户透明（migration 自动 apply）

### PASS: 真实 e2e 验证
e2e 测试拉了 90MB 模型 + 跑 8 条记录的 KNN search + 验证 top-5 找回。这不是
mock —— 是真实生产路径走通。29/29 e2e 测试 pass 是高置信度信号。

### MINOR-1: SHA pinning 没自动校验
现在 SHA 写在 doc 里但 vessel-core 启动 / `memory status` 不主动 verify。如果
权重被替换 vessel-core 不会 alert。
**Verdict**: MINOR — defer / M1C-B+ 加 `memory verify-sha` subcommand。

### Finding 矩阵汇总

| ID | 严重度 | 来源 | Finding | 决策 |
|---|---|---|---|---|
| MINOR-arch-1 | MINOR | architect | vec_memory 虚拟表延迟创建未文档化 | accepted-as-is |
| MINOR-arch-2 | MINOR | architect | 批量 addMemory 没做 | defer |
| MINOR-prag-1 | MINOR | pragmatist | cmdMemoryAdd 不支持 stdin | defer |
| MINOR-prag-2 | MINOR | pragmatist | status 异步 ready 不阻塞 | accepted-as-is |
| MINOR-risk-1 | MINOR | risk | SHA 表初次需手填 | **fix-now** ✅ 已填 |
| MINOR-risk-2 | MINOR | risk | embedder 没下载 timeout | defer / dogfood |
| MINOR-cursor-1 | MINOR | cursor | SHA 没自动校验 | defer / M1C-B+ |

7 MINOR, 0 MAJOR, 0 BLOCKER. 1 fix-now 已落地（SHA 已填入 model-sha-pinning.md），其余
deferred / accepted-as-is.

## Verdict: PASS
