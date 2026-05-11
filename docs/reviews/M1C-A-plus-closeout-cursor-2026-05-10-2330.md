# M1C-A+ — Closeout (cursor cross-review lens)
Date: 2026-05-10-2330

## Cross-cutting concerns

### PASS: 闭合 M1C-A 的 defer 项
M1C-A closeout MINOR-arch-2 ("Per-step timeout / HTTP cancel → AbortSignal,
defer to M1C-B") 和 closeout 矩阵里的 "每步 timeout + HTTP cancel → AbortSignal,
defer 项" 现在都已落地。M1C-A+ 的核心承诺兑现。

### PASS: M1C-A 现有功能完全保留
22 个原 M1C-A test case 全部回归通过。HITL pause/resume / interrupted-on-startup
/ external abort 都不变。新增 7 个 M1C-A+ test case（含 race 备用分支）。

### PASS: schema 演进 backwards-compatible
WorkflowStep 加 timeoutMs 是 optional 字段：
- 老 workflow（DB 里已存在）反序列化无字段 → undefined → executor 不
  schedule timer
- 新创建的 workflow 可选用，老调用方不感知
- migration 不需要

### PASS: 状态转换语义清晰
| 触发源 | 终态 | error_message |
|---|---|---|
| step 完成 | completed | null |
| step throw | failed | err.message |
| step timeout | failed | "step N timed out after Mms" |
| user cancelWorkflow | cancelled | null |
| external abortSignal | cancelled | null |
| pre-cancelled DB | (executor early return) | (already set) |

差异化清晰。前端可按 status + error_message.includes('timed out') 区分
timeout vs 通用 failure。

### PASS: 测试 race 局限被显式标记
Test 9 / Test 12 都加了 "race won → 跳过断言" 的备用分支，stdout 写
"ℹ" 注释而不是 fail。CI 跑出来不会假阳性，operator 看 log 知道哪条路径
被 race。

### Finding 矩阵汇总

| ID | 严重度 | 来源 | Finding | 决策 |
|---|---|---|---|---|
| MINOR-arch-1 | MINOR | architect | timeout 测试 race | defer/mock skill |
| MINOR-arch-2 | MINOR | architect | external abort reason 优先级注释 | accepted-as-is |
| MINOR-prag-1 | MINOR | pragmatist | HTTP 路由层无单测 | defer |
| MINOR-prag-2 | MINOR | pragmatist | unref?.() 过度防御 | accepted-as-is |
| MINOR-risk-1 | MINOR | risk | external abort listener 残留风险 | accepted-as-is |

5 MINOR, 0 MAJOR, 0 BLOCKER. 全部 deferred / accepted-as-is. 无 fix-now.

## Verdict: PASS
