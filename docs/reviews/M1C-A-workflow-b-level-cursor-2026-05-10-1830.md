# M1C-A Workflow Engine + HITL — B-级 Review: cursor-cross

**Date**: 2026-05-10 18:30  
**Scope**: M1C-A-minimal — workflow_state table + pause/resume executor + CLI + HTTP + panel HITL

## BLOCKER

无。

## MAJOR

**M-1: 中断 workflow 的 current_step 语义歧义**

server 重启时，`status='running'` 的 workflow 最后一步可能执行了一半（coding task 被 SIGKILL 了）。`current_step` 指向"正在跑的 step"，resume 时应该从 `current_step` 重跑，还是从 `current_step+1` 继续？

两种语义都有合理场景：
- 重跑：coding task 幂等（不一定）
- 跳过：可能造成工作丢失

**推荐**: `interrupted` 状态下 `vessel-core workflow resume <id>` 默认**重跑** `current_step`（因为 coding task 结果未持久化，视为未完成）。用户可 `--skip` 跳过当前 step。记录在 README 级别文档注释里。

**M-2: WS `vessel_workflow_paused` 事件需要 connection context 关联**

当前 WS per-connection 设计里，`vesselRuns` map 是 per-connection 的。workflow executor 在 server 进程里跑，不属于任何特定 WS connection — 所以 `vessel_workflow_paused` 要 broadcast 到所有连接的 client（不能用 per-run send）。

用已有的 `broadcastToAll()` 函数（index.ts 有，传给 harness router 的那个）。executor 需要 access 到这个 broadcast 函数。**Fix**: workflow router + executor 接受一个 `broadcast: (msg: unknown) => void` 参数，index.ts 注入。

## MINOR

**m-1: vessel-core CLI `workflow resume` 需要 server URL**

CLI 调 HTTP endpoint — 需要知道 server 在哪（`http://localhost:PORT`）。用 `VESSEL_API_URL` env var，默认 `http://localhost:3030`。

**m-2: 接受 architect 建议的所有 minor 点**

memory.db / steps_json / panel 不动 App.tsx — 全部合理。

## 整体判断

设计干净。最大风险是 M-1（中断语义）必须在测试里明确断言（重跑 current_step 后状态变 completed）。M-2（broadcast wiring）是实现时容易遗漏的 coupling 点。
