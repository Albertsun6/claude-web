# M1C-A+ — Closeout Arbiter
Date: 2026-05-10-2330

## Aggregated findings matrix

| ID | 严重度 | Finding | 决策 |
|---|---|---|---|
| MINOR-arch-1 | MINOR | timeout 测试 race（echo 太快） | deferred / 加 mock sleep skill |
| MINOR-arch-2 | MINOR | external abort reason 优先级注释 | accepted-as-is |
| MINOR-prag-1 | MINOR | HTTP 路由层无单测 | deferred |
| MINOR-prag-2 | MINOR | unref?.() 过度防御 | accepted-as-is |
| MINOR-risk-1 | MINOR | external abort listener 残留风险 | accepted-as-is |

5 MINOR, 0 MAJOR, 0 BLOCKER. 全部 deferred / accepted-as-is. 无 fix-now.

## 跨 reviewer 一致性

- 4 reviewers 全部 PASS
- 无对立 verdict
- 关键决策 architect + cursor 双向认可：
  - timeout=failed 而 user-cancel=cancelled 的状态语义区分
  - inflightControllers 单进程 Map（ADR-011 单进程假设下合理）
  - schema 演进 backwards-compatible（timeoutMs optional）

## M1C-A+ 范围验收

- ✅ WorkflowStep coding 加 `timeoutMs?: number`（持久化进 steps_json）
- ✅ executor 维护 inflightControllers Map + cancelWorkflow + try/finally cleanup
- ✅ HTTP /cancel 调 cancelWorkflow 而非裸 updateWorkflow
- ✅ POST 路由验证 timeoutMs（正数 / Number.isFinite / ≤ 30 分钟）
- ✅ timeout 路径 → status=failed, error_message="step N timed out after Mms"
- ✅ user-cancel 路径 → status=cancelled
- ✅ 7 new test case + 22 既有回归 = 29/29 全过
- ✅ tsc clean, 全套回归（lessons/m1b/m1bplus/soul/m2-ios-alpha/coding-driver/vessel-http/vessel-ws）通过

## Verdict: PASS
- 0 BLOCKER, 0 MAJOR
- 5 MINOR (全部 deferred/accepted-as-is)
- 29/29 workflow 测试 ✅
- 全套回归 ✅
- M1C-A defer 项闭合 ✅

M1C-A+ 完成。M1C-A 留下的"workflow executor 每步 timeout + HTTP cancel →
AbortSignal" defer 项落地。Workflow Engine 现在能处理"卡住的 coding step"
场景，HTTP /cancel 真正阻断在跑的 executor 而非仅更新 DB。

Ready for Verify Gate.


lesson_id: cd425fb5-4cee-447b-8be8-8dbb97f33b17
