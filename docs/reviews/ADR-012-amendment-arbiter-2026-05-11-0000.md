# ADR-012 Amendment 2026-05-10 — Arbiter
Date: 2026-05-11-0000

## Aggregated findings matrix

| ID | 严重度 | Finding | 决策 |
|---|---|---|---|
| MINOR-arch-1 | MINOR | ml-workers/ 目录暂时 dead weight | accepted-as-is |
| MINOR-arch-2 | MINOR | in-process embedding 失败 fallback 没写 | deferred/M1C-B |
| MINOR-prag-1 | MINOR | ML 任务分级表会膨胀 | deferred |
| MINOR-prag-2 | MINOR | HF CDN 国内 mitigation 没列入 acceptance | deferred/M1C-B |
| MINOR-risk-1 | MINOR | model SHA pinning 没写为 acceptance | deferred/M1C-B |
| MINOR-risk-2 | MINOR | onnxruntime-node native supply chain | accepted-as-is |
| MINOR-cursor-1 | MINOR | EmbeddingClient.health() in-process 语义 | deferred/M1C-B |

7 MINOR, 0 MAJOR, 0 BLOCKER. 全部 deferred / accepted-as-is. 无 fix-now.

## 跨 reviewer 一致性

- 4 reviewers 全部 PASS
- 无对立 verdict
- 关键决策（ML 任务分级 + Embedding 走 in-process transformers.js）所有 4
  reviewers 独立认可
- Spike report 引用链条 + ADR-015 Phase 0 → Phase 1 衔接路径合规

## Amendment 验收

- ✅ Status 标 "Accepted (amended 2026-05-10)"，原决策 §1-§7 保留
- ✅ Amendment 段含分级表 + Embedding 行修订 + ASR/TTS 不变 + ml-workers/ 保留
- ✅ Spike report 引用进 ADR header + Amendment 主文
- ✅ Consequences (Positive / Negative / Neutral) 完整
- ✅ 7 MINOR finding 全部 deferred 到 M1C-B 实施时落实

## M1C-B 实施 gate items（必须在 closeout 时验证）

- [ ] in-process embedding 失败的 fallback 路径
- [ ] HF CDN 国内 mitigation（background download + 完成前 503）
- [ ] model SHA pinning 文件（docs/notes/model-sha-pinning.md）
- [ ] EmbeddingClient.health() in-process 实现语义
- [ ] ADR-002 update（embedding 选型从 fastembed Python 改为 transformers.js
      in-process；Python worker 降为备选）

## Verdict: PASS
- 0 BLOCKER, 0 MAJOR
- 7 MINOR (全部 deferred/accepted-as-is)
- Phase 0 spike report → ADR amendment 链合规 ✅
- ADR-015 流程合规 ✅
- 与 ADR-000/001/006/009/015 全部兼容 ✅

ADR-012 Amendment 2026-05-10 = Accepted。M1C-B 实施 gate item 列表清晰，可以
进 M1C-B 实施段。

Ready for Verify Gate.


lesson_id: 77e32c0a-df7b-45a9-80e7-365e981652c8
