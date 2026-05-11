# M1B MCP + Permission — B-级 Review: vessel-architect

**Date**: 2026-05-10 10:00  
**Scope**: M1B-minimal proposal — MCP subprocess lifecycle + vessel HTTP permission enforcement  
**Verdict**: PASS-WITH-FIXES

## MAJOR

**M-1: @modelcontextprotocol/sdk 客户端对 M1B acceptance 非必需**

M1B acceptance criteria 测的是：
1. HTTP 200 / 403 权限 enforcement
2. `pgrep -f mcp-server-filesystem` vessel-core 退出后为空（子进程清理）

vessel-core 只需要 `child_process.spawn` 启动 MCP server 子进程，Claude CLI 自带 MCP client 能力。vessel-core 不需要主动说 MCP 协议。**defer SDK 到 M1B+** (e.g., 当 vessel-core 需要 intercept MCP tool calls 时再引)。这样 M1B 不引入新 npm 依赖，只用 Node.js built-ins + 现有 auth.ts。

**M-2: MCP server config 不写 ~/.claude/settings.json**

`~/.claude/settings.json` 是用户个人 Claude CLI 配置，vessel-core 写它会：
- 与用户已有 MCP 配置冲突
- 用户在非 Vessel 场景下也跑 Claude CLI 时被污染
- 文件归属混淆（Vessel 数据 vs 用户 Claude 数据）

推荐：vessel-core 通过 `VESSEL_MCP_SERVERS` 环境变量（JSON 数组）或 `~/.vessel/mcp-servers.json` 驱动自己的 MCP server lifecycle。当 coding task 需要 MCP，vessel-core 在 spawn Claude CLI 时通过 `--mcp-server` flag 或 `ANTHROPIC_MCP_SERVERS` 等 CLI 环境变量注入（按 CLI 实际 API 确认）。

## MINOR

**m-1: HTTP fs 端点 trace context 合成方案**

`makeTraceWriter` 需要 `TraceContext`（含 `conversation_id` + `run_id`）。HTTP fs 请求无会话上下文，用合成常量：
```
session_id = 'vessel-fs-api'
run_id     = randomUUID() per request
```
这样 trace 文件路径仍唯一，且 grep session_id=vessel-fs-api 能聚合所有 HTTP fs 访问审计。

**m-2: 与现有 /api/fs 的关系**

Eva `/api/fs` 已有 `verifyAllowedPath` 检查，但不发 trace 事件。M1B 加 `/api/vessel/fs/*` 不重复现有路由；差别在于：后者发 `permission.denied` trace event，是 M1B 的核心增量价值。

## 建议范围（最小切片）

1. `packages/backend/src/mcp/manager.ts` — 子进程 spawn/kill（no SDK）
2. `packages/backend/src/routes/vessel-fs.ts` — HTTP 权限 + trace
3. `index.ts` — 挂载 + 关闭时 `mcpManager.shutdown()`
4. 环境变量 `VESSEL_MCP_SERVERS` 驱动 MCP server 配置
5. Tests: 允许路径 200 + 拒绝路径 403 + trace 文件 + manager lifecycle
