# ADR-012 Amendment 2026-05-10 — Architect Review
Date: 2026-05-11-0000

## Scope of amendment
ADR-012 加 "Amendment 2026-05-10 — ML 任务分级 + Embedding 路径修订"。核心改动：
- 引入"ML 任务分级"（轻量 in-process vs 重量 worker subprocess），由模型大小 +
  推理延迟决定
- §2 决策表 Embedding 行：首选改 transformers.js 进程内（替代死掉的
  fastembed-js）
- ASR/TTS 决策不变；ml-workers/ 目录保留

## Findings

### PASS: 修订是 in-place amendment 不是 supersede
保留原 §1-§7 决策（lifecycle / 目录分工 / 接口契约 / fallback 模式）。Amendment
只动 ML 任务分级 + Embedding 行，影响范围最小。Status 标 "Accepted (amended
2026-05-10)"，git history 仍能看到原始决策演进。

### PASS: 分级标准用具体阈值（不是抽象语句）
"< 200MB ONNX / < 200ms 推理 → in-process"是可量化判断条件。后续遇到新 ML 任
务（如 reranker / sparse retrieval）能直接套这个规则决策，不需要再拍脑袋。

### PASS: 与 spike report 闭合
§ Spike report 字段引用 docs/research/embedding-and-vector-store-2026-05-10.md。
Phase 0 → ADR amendment 链条完整（ADR-015 第 9 段 "Phase 0 → Phase 1 衔接"
落地）。

### MINOR-1: ml-workers/ 目录保留但 M1C-B 不会用
未来 ASR/TTS / 超大 embedding 才用。如果 6-12 个月内没新增 worker，目录变 dead
weight。
**Verdict**: MINOR — accepted-as-is. 文件夹存在但空，不消耗运行时资源。M2-Voice
就会激活。

### MINOR-2: 没明确 in-process embedding 失败的 fallback
amendment 加了正面/负面/中性，但没说"如果 transformers.js 在 vessel-core 跑不
起来怎么办"。原 ADR §4 写了 ML worker 启动失败 fallback；进程内推理失败的处
理没写。
**Verdict**: MINOR — defer 到 M1C-B 实施时具体写。一般来讲：抛 SoulParseError
样的 EmbeddingInitError，标 memory capability unavailable，vessel-core "echo
hi" 仍可用——与原 §4 对 worker 的 degrading mode 一致。

### INFO: Embedding 备选保留 fastembed Python（HTTP loopback OpenAI-compatible）
即使 amendment 选了 in-process，备选路径仍是 Python worker —— 与 plan v5.1 的
回退路径锁定语义一致。

## 架构评估: PASS
- amendment 与原 ADR-012 § 1-§7 不矛盾
- 与 ADR-000 / ADR-001 / ADR-006 / ADR-009 / ADR-015 全部兼容
- Spike report 引用链条完整

## Verdict: PASS — 2 MINOR (deferred / accepted-as-is)
