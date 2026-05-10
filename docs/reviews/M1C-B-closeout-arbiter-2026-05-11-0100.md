# M1C-B — Closeout Arbiter
Date: 2026-05-11-0100

## Aggregated findings matrix

| ID | 严重度 | Finding | 决策 |
|---|---|---|---|
| MINOR-arch-1 | MINOR | vec_memory 虚拟表延迟创建未文档化 | accepted-as-is（已在 sql 注释说明）|
| MINOR-arch-2 | MINOR | 批量 addMemory 未做 | deferred / M1C-B+ |
| MINOR-prag-1 | MINOR | cmdMemoryAdd 不支持 stdin | deferred |
| MINOR-prag-2 | MINOR | status 异步 ready 不阻塞 | accepted-as-is |
| MINOR-risk-1 | MINOR | SHA 表初次需手填 | **fix-now ✅ 已填入 (90MB / 69a0b846...)** |
| MINOR-risk-2 | MINOR | embedder 没下载 timeout | deferred / dogfood |
| MINOR-cursor-1 | MINOR | SHA 没自动校验 | deferred / M1C-B+ |

7 MINOR, 0 MAJOR, 0 BLOCKER. 1 fix-now 落地，其余 deferred / accepted-as-is.

## 跨 reviewer 一致性

- 4 reviewers 全部 PASS
- 无对立 verdict
- 关键决策（in-process 路径 / SHA pinning / e2e 真模型下载）所有 4 reviewers
  独立认可
- 唯一 fix-now（risk-1: SHA 表填写）已落地

## ADR-012 amendment gate items 验收

| Gate item | 状态 |
|---|---|
| in-process embedding 失败 fallback 路径 | ✅ embedder.ts getPipeline catch + state.loadError + CLI return code |
| HF CDN 国内 mitigation | ✅ ready() Promise 异步预热 + status 命令查 loaded=false |
| model SHA pinning | ✅ model-sha-pinning.md 含 SHA `69a0b846...` |
| EmbeddingClient.health() in-process 语义 | ✅ embedder.health() 返回 {ok, model, loaded, reason} 不阻塞 |
| ADR-002 update | ✅ Status: Proposed → Accepted (amended 2026-05-10)，Decision 段重写 |

## M1C-B 范围验收

- ✅ migration 0004 (memory_records 表 + sqlite-vec 虚拟表 runtime 创建)
- ✅ memory/embedder.ts (transformers.js + bge-small-zh-v1.5 单例 + ready/embed/health)
- ✅ memory/memory-store.ts (sqlite-vec ensureVecReady + addMemory / searchMemory / list / delete / count)
- ✅ vessel-core memory add / search / list / status CLI 子命令
- ✅ test-memory.ts: 17/17 smoke + 12/12 e2e = **29/29 全过**
- ✅ 全套回归 (lessons / workflow / m1b / m1bplus / soul / m2-ios-alpha /
       coding-driver / vessel-http / vessel-ws) 全过
- ✅ Eva path 0 影响（独立 module）

## ROADMAP M1C-B Acceptance（plan v5.4 §M1C-B）

> "写入 5 条 memory record（含唯一测试词 `vessel_test_topic_42a7f9`）→ 重启
> vessel-core → `vessel-core memory search "vessel_test_topic_42a7f9"` 返回这
> 5 条且排在 top-5"

e2e 测试已验证（test-memory.ts Test 4）：
- ✅ 写 5 条带唯一 marker `vessel_e2e_marker_42a7f9` 的记录
- ✅ search marker → top-5 全部命中（"all 5 related records appear in top-5"）
- ✅ 距离升序（"distance ascending at index N"）

> "ML worker 按需启动；闲置 TTL 后自动回收"

→ Amendment 后 in-process 不需要 worker / TTL，conceptually superseded by
ADR-012 amendment §A. ROADMAP 这条 acceptance 应在 docs sync 时同步修订。

> "ML worker 失败时主进程标 memory capability unavailable，但 `vessel-core
> "echo hi"` 仍正常工作"

✅ embedder.ts 失败时 state.loadError 设置，cmdMemoryAdd 返回 1，但 vessel-core
其他命令（如 echo）仍能跑（embedder 是 lazy 单例，没用就没影响）。

## Verdict: PASS
- 0 BLOCKER, 0 MAJOR
- 7 MINOR (1 fix-now 落地，6 deferred / accepted-as-is)
- ADR-012 amendment 5 gate items 全部满足 ✅
- ROADMAP M1C-B acceptance 主条件全部满足 ✅
- tsc clean + 29/29 memory + 全套回归 ✅

M1C-B 完成。Vessel 长期记忆向量检索接通。bge-small-zh-v1.5 中文 + 英文 mixed
embedding + sqlite-vec KNN 在 vessel-core 进程内稳定运行。

Ready for Verify Gate.


lesson_id: b96304ab-dc0a-4392-951f-dda61c5a9879
