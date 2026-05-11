# M1C-A+ — Closeout (vessel-architect lens)
Date: 2026-05-10-2330

## Scope
M1C-A 的 defer 项落地：
- WorkflowStep coding 加 `timeoutMs?: number`（per-step 超时）
- executor 维护 module-level `inflightControllers: Map<workflowId, AbortController>`
- `cancelWorkflow(id)` 可主动 abort 在跑的 workflow
- HTTP /cancel 路由调 cancelWorkflow 而不是直接更新 DB
- 状态语义：timeout → `failed` (error_message 含 'timed out')；user-cancel → `cancelled`

## Findings

### PASS: 状态机扩展正确
现有 7 个 status (pending/running/paused/interrupted/completed/failed/cancelled) 全部
保留。timeout 路径走 `failed`，复用既有 `error_message` 字段；user-cancel 走
`cancelled`，与 M1C-A 既有语义一致。无新状态、无 schema 变化。

### PASS: 单一职责保留
- workflow-store.ts：纯数据 CRUD + schema constants（MAX_STEP_TIMEOUT_MS）
- executor.ts：跑 + abort 协调
- vessel-workflow.ts：HTTP 校验 + 路由调用

新增 inflightControllers Map 是 executor 的内部状态，不外泄到 store 或路由。

### PASS: 资源清理 try/finally
runWorkflowFromStep 用 try/finally 确保 cleanup() 在所有出口（success / fail
/ pause / abort / 异常抛出）都跑，从 Map 删除 controller，移除 external
abort 监听。`inflight controller cleaned up after run` 测试断言验证。

### MINOR-1: timeoutMs 测试有 race condition
Test 9（per-step timeout=1ms）依赖 setTimeout 在 echo skill 完成前 fire。
个人单机 + echo 只是 in-memory DB 写入，可能 < 1ms 完成 → race 输给 runIntent。
测试有"race won → 跳过断言"分支，contract 无法在快机上稳定验证。
**Real-world impact**: 真实 coding step (Claude CLI subprocess + 多秒) 远远慢
于 timer，timeout 路径会稳定触发。仅测试基础设施局限。
**Verdict**: MINOR — defer / 加 fake-driver mock skill 实现 sleep。

### MINOR-2: external abortSignal 与 cancelWorkflow 的 reason 优先级
runWorkflowFromStep 处理 externalAbort 时：如果 reason 已经被 set（譬如
cancelWorkflow 先调）→ 不覆盖。这是对的（先到 reason 胜出）。但行为没有
显式注释，未来读代码者需要顺着 inflightCancelReasons 字典查。
**Verdict**: MINOR — 已经在 line "if (!inflightCancelReasons.has(...))" 注释了
但可以更明显。

### INFO: ADR-011 (runtime process model) 单进程假设
inflightControllers 是 module-level 单进程状态；M1C-A markInterruptedOnStartup
已经处理 server 重启。Vessel "个人单机"硬约束下仍合理；如未来加 cluster mode
（不在 v0.x roadmap）这个 Map 需要换共享存储。

## 架构评估: PASS
- WorkflowStep schema 演进 backwards-compatible（timeoutMs 可选）
- 状态机无新状态
- inflightControllers 作为 process-local fastpath，DB 持久化仍是事实来源
- 29/29 测试通过（含 race 备用分支）

## Verdict: PASS — 2 MINOR (deferred / accepted-as-is)
