# M1C-A+ — Closeout (vessel-risk-officer lens)
Date: 2026-05-10-2330

## Findings

### PASS: timeoutMs 上限 30 分钟防御 DoS
若不限制，恶意调用方可以 POST timeoutMs=Number.MAX_SAFE_INTEGER 让 setTimeout
注册一个永不触发的 timer + 占用一个 inflight 槽位，配合 MAX_STEPS=20 还
能造成大量 controller 持有。30 分钟上限合理；workflow 真要更长得切多步。

### PASS: timer.unref() 防止僵尸进程
setTimeout(...).unref() 让 timer 不阻塞 event loop 退出。如果 vessel-core
正常 shutdown 但有 inflight workflow，timer 不会延迟 process exit。Node.js
runtime 安全实践。

### PASS: try/finally 保证 inflightControllers 清理
即使 runIntent 抛出未捕获异常或在 catch 之外的代码路径出错，finally 块的
cleanup() 仍执行。inflightControllers / inflightCancelReasons 不会泄漏，
重复 cancelWorkflow(已完成 workflow) 也是 no-op（false return）。

### PASS: 双调用 cancel 幂等
HTTP /cancel 第一次：cancelWorkflow 返回 true → executor 跑 applyAbortOutcome
→ 状态 'cancelled'。
HTTP /cancel 第二次：路由检查 status === 'cancelled' → 409 直接拒绝，不会
重复 abort。

### MINOR-1: external abort 监听器移除时机
runWorkflowFromStep 用 externalAbort.addEventListener('abort', listener) +
finally cleanup 里 removeEventListener。如果 cleanup 异常（极小概率），
listener 残留 → externalAbort 仍持有对 controller 的引用 → potential leak。
**Risk**: Very low — cleanup 没 throw 路径（只是 Map.delete + removeEventListener
本身），但理论存在。
**Verdict**: MINOR — accepted-as-is.

### PASS: cancelWorkflow / inflightWorkflowIds 没暴露给 HTTP
两个 export 仅供 executor 模块和测试用。HTTP 路由通过 cancelWorkflow 调
用，没暴露 raw inflightControllers Map（不允许外部 abort 任意 workflow
without going through 路由权限）。

### INFO: timeout 路径不持久化原因到 DB
error_message = `step <i> timed out after <ms>ms` —— 这个字符串是 DB 里
唯一的 timeout 证据。如果运维要按"哪些 workflow 因 timeout 失败"做统计，
得 LIKE '%timed out%'。考虑加 error_kind 字段（'timeout' | 'exception' |
'user_cancel'）会更结构化，但当前 schema 不支持，是 future schema 演进。
**Verdict**: INFO — defer until 真有运维需求。

### PASS: race 路径不影响 production
Test 9 race 局限性是测试设施问题，不影响生产代码逻辑。真实 coding step
(Claude CLI 数秒) 与 setTimeout(timeoutMs) 量级对比稳定 → timeout 路径
production 可靠。

## Verdict: PASS — 1 MINOR (accepted-as-is)
