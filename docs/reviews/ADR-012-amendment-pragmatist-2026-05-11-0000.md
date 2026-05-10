# ADR-012 Amendment 2026-05-10 — Pragmatist Review
Date: 2026-05-11-0000

## Findings

### PASS: 修订减少 M1C-B 实施成本
原 ADR-012 假设 M1C-B 必跑 Python worker（多语言运维 + uv 安装 + JSON-RPC 协
议自研）。Amendment 让 M1C-B 路径变成"npm install + 加 1 个 ts 文件"。约 50% 工
作量缩减。

### PASS: 用真实数据驱动决策
Amendment 引述 Phase 0 spike 三个调研子任务的具体结论（fastembed-js archived /
transformers.js 14k★ 活跃 / bge-small-zh-v1.5 唯一满足 4 条硬约束）。不是凭感
觉拍板。

### PASS: 不删 ml-workers/ 路径
Amendment 没删 ml-workers/ 目录约定，M2-Voice / 未来超大 embedding 还用得上。
"减法做得太干净"反而是另一种过度工程化。

### PASS: 200MB / 200ms 阈值有判断意义
- bge-small-zh-v1.5 ~96MB：明显 < 200MB → in-process ✅
- whisper-large ~1.5GB：明显 > 500MB → worker ✅
- bge-base-zh-v1.5 ~390MB：在中间灰区——按规则该 worker，但实际可以视情况
  调（推荐：先 worker，性能问题真出现再改 in-process）。规则不绝对但可操作。

### MINOR-1: amendment 一段话很长
"### A. ML 任务分级"段读起来比较密集。如果未来还有 ML 任务出现（比如 reranker
/ TTS-streaming），这个表会膨胀，可能要拆成独立段。
**Verdict**: MINOR — defer / 出现第三类 ML 任务时再重构。

### MINOR-2: HF CDN 国内首启 30s-2min 是真实痛点但只在 Negative 一笔带过
amendment "Negative" 里写"首次模型下载 ~96MB 走 HF CDN，国内首启可能 30s-2min；
mitigation：background download + 完成前 search API 返回 503"。但这个 mitigation
是 M1C-B 实施时要落实的具体功能，amendment 说了但没承诺执行细节。
**Verdict**: MINOR — defer 到 M1C-B 实施 acceptance 显式包含。

## Verdict: PASS — 2 MINOR (deferred)
