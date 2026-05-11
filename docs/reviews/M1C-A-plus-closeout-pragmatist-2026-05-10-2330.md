# M1C-A+ — Closeout (vessel-pragmatist lens)
Date: 2026-05-10-2330

## Findings

### PASS: 范围控制
- workflow-store.ts +4 行（timeoutMs 字段 + MAX_STEP_TIMEOUT_MS 常量）
- executor.ts ~80 行新增 + 重构（inflightControllers / cancelWorkflow / applyAbortOutcome）
- vessel-workflow.ts ~20 行（POST 验证 timeoutMs + /cancel 调 cancelWorkflow）
- test-workflow.ts +120 行（4 个新 test case）
- 0 新依赖

总实现 < 250 行（含测试）。比 M1C-A 本身小很多（M1C-A 是新建 schema + executor）。

### PASS: 默认行为 0 改变
不指定 timeoutMs → 完全等同于 M1C-A 行为。既有 22/22 测试全过，无回归。

### PASS: cancelWorkflow 区分 in-flight vs DB-only
HTTP /cancel 先调 cancelWorkflow(id)，返回 false 表示没在跑（pending /
paused 没 executor），路由再 fallback 直接 updateWorkflow + broadcast。返回
体加 `aborted: bool` 让客户端知道是哪条路径。这种"先尝试主动取消，失败
再走 DB"两段式比纯 DB-update 优雅，符合"in-flight ≠ DB state"的真实情况。

### PASS: timeout=0 / 负数 / NaN / Infinity 全拦截
路由层校验 `Number.isFinite(t) && t > 0`。timeoutMs=0 不算合法（语义模糊），
NaN/Infinity 拦截。30 分钟上限防止 timeoutMs=Number.MAX_SAFE_INTEGER 这种
作妖。

### MINOR-1: HTTP 路由层没单测
test-workflow.ts 测的是 store + executor。POST timeoutMs 校验 / /cancel
返回 aborted:true|false 这些路由层逻辑没单测。test-vessel-http-concurrent
跑了一些 vessel HTTP 但没覆盖 workflow 路由。
**Verdict**: MINOR — defer / vessel HTTP test 已经有就插过去。

### MINOR-2: timeoutHandle.unref?.() 防御性写法
Node.js 的 setTimeout 返回 Timer 对象有 .unref() 方法（标准 API）；?. 是过
度防御（运行时一定有）。无害，pragmatist 偏好简洁。
**Verdict**: MINOR — accepted-as-is.

### INFO: timeout 路径走 'failed' 是有意区分
按之前讨论：用户主动 cancel = 'cancelled'（用户意愿），系统超时 = 'failed'
（执行失败需用户关注）。两者在 list / panel UI 上颜色 / icon 不同，差异
有用。

## Verdict: PASS — 2 MINOR (deferred / accepted-as-is)
