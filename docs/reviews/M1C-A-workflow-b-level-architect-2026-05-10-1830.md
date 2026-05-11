# M1C-A Workflow Engine + HITL — B-级 Review: vessel-architect

**Date**: 2026-05-10 18:30  
**Scope**: M1C-A-minimal — workflow_state table + pause/resume executor + CLI + HTTP + panel HITL

## MAJOR

**M-1: workflow_state 放 memory.db，不碰 harness.db**

Eva harness.db 是 Eva 领域特定的"Issue→Stage pipeline"；Vessel workflow_state 是通用多步骤协调层。两者职责不同，混用同一 DB 会让边界模糊。memory.db 已有 sessions + lessons，扩展成 Vessel 自有状态库是正确方向。

Migration: `migrations-memory/0003_m1c_workflows.sql`（独立，不动 harness.db migrations）。

**M-2: 工作流执行器生命周期绑定 HTTP server 进程**

`runIntent()` 是异步的，需要 AbortSignal、trace writer 等 server 进程上下文。CLI `vessel-core workflow resume <id>` 不应在 CLI 进程里重新运行 step — 应调 HTTP `POST /api/vessel/workflows/:id/resume`，让 server 进程里的执行器接管。

Consequence: server 必须在运行才能 resume（CLI 在 server 离线时 → 报错"server offline, start it first"）。这是 M1C-A 可接受约束。

**M-3: 中断处理（server 重启）**

server 启动时扫 `workflow_state WHERE status='running'` → 标 `interrupted`（不自动重试，不删除）。CLI `workflow resume <id>` 对 `interrupted` 状态也生效（允许人工决定是否重跑最后一步）。

## MINOR

**m-1: step 模型 JSON 不需要额外表**

`steps_json TEXT`（JSON 数组） + `current_step INTEGER` 足够 M1C-A。三列 + status 覆盖：步骤定义、执行游标、暂停原因。不需要单独的 `workflow_steps` 表（YAGNI）。

**m-2: HITL UI 不动 Eva App.tsx**

在现有 `/vessel/min/` 面板加 Workflow section：list paused workflows + Approve/Reject 按钮 → POST /api/vessel/workflows/:id/resume。WS `vessel_workflow_paused` 消息触发 UI 显示。不碰 App.tsx（cursor C-MAJOR-1 flag 高复杂度）。

## 建议最小切片

1. `migrations-memory/0003` — `workflow_state` table
2. `memory/workflow-store.ts` — CRUD + status transitions
3. `workflow/executor.ts` — step runner（coding via runIntent + hitl pause）
4. `routes/vessel-workflow.ts` — CRUD + resume HTTP API
5. `routes/vessel-panel.ts` — 加 workflow HITL 展示 + approve/reject 按钮
6. `cli/vessel-core.ts` — `workflow list/resume` 子命令
7. `protocol.ts` — `vessel_workflow_paused/step/completed` WS messages
8. `test:workflow` — pause → restart → resume 端到端
