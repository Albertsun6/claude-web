# ADR-012 Amendment 2026-05-10 — Cursor Cross Review
Date: 2026-05-11-0000

## Cross-cutting concerns

### PASS: ADR-015 流程合规
Phase 0 → spike report → ADR amendment 三段式合规。spike report 引用进 ADR；
amendment 引用回 spike report。后续 reviewer 可以双向追溯。

### PASS: 与 plan v5.1 fallback 路径一致
plan v5.1 锁定语义"M1C-B 双 spike 失败则推 v1+，M1C-A 不依赖 embedding 仍可
独立完成"。Amendment 没违反这个语义——实际反而把 spike 路径从"双"变成"单"
（in-process 主路径 + Python worker 备用），更清晰。

### PASS: ADR-012 与 ADR-002 边界清晰
ADR-002 (embedding-fastembed-via-python-worker) 是早期约定。Amendment 修订
ADR-012 决策表时 implicitly 让 ADR-002 也需要修订（首选不再是 fastembed
Python，是 transformers.js）。但 Amendment 没动 ADR-002——这是有意的 deferred
work。
**Recommendation**: M1C-B 实施 closeout 时 update ADR-002 (or supersede with
ADR-002a)。

### PASS: 对比 §1-§7 确认无矛盾
- §1 主栈 TS → 与 in-process embedding 完全契合
- §2 ML 任务 worker 边界 → amendment 加分级，不删原表
- §3 worker lifecycle → in-process 不需要 lifecycle，但 amendment 没否定
  worker lifecycle（仍适用 ASR/TTS）
- §4 worker 启动失败 fallback → 不变
- §5 目录分工 → ml-workers/ 保留
- §6 接口契约 → EmbeddingClient interface 仍保留（in-process 实现也实现这个
  interface，签名不变）

### MINOR-1: §6 EmbeddingClient interface 没明确 in-process / out-of-process 的实现差异
Amendment 引述 in-process 路径，但 ADR-012 §6 的 EmbeddingClient.health() 在
in-process 模式下永远返回 ok（没 subprocess 可挂）—— 这种 case 没在
amendment 里说明。
**Verdict**: MINOR — defer 到 M1C-B 实施时统一处理。in-process 实现 health()
检查 model loaded + ONNX runtime initialized 即可。

### Finding 矩阵汇总

| ID | 严重度 | 来源 | Finding | 决策 |
|---|---|---|---|---|
| MINOR-arch-1 | MINOR | architect | ml-workers/ 目录暂时 dead weight | accepted-as-is |
| MINOR-arch-2 | MINOR | architect | in-process embedding 失败 fallback 没写 | defer/M1C-B |
| MINOR-prag-1 | MINOR | pragmatist | ML 任务分级表会膨胀 | defer/第三类 ML 任务时重构 |
| MINOR-prag-2 | MINOR | pragmatist | HF CDN 国内 mitigation 没列入 acceptance | defer/M1C-B acceptance |
| MINOR-risk-1 | MINOR | risk | model SHA pinning 没写为 acceptance | defer/M1C-B closeout |
| MINOR-risk-2 | MINOR | risk | onnxruntime-node native supply chain | accepted-as-is |
| MINOR-cursor-1 | MINOR | cursor | EmbeddingClient.health() in-process 语义 | defer/M1C-B |

7 MINOR, 0 MAJOR, 0 BLOCKER. 全部 deferred / accepted-as-is. 无 fix-now.

## Verdict: PASS
