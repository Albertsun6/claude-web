# M1B MCP + permission — 4-way closeout: vessel-pragmatist

**Date**: 2026-05-10 17:30  
**Verdict**: PASS-WITH-FIXES

## BLOCKER

无。

## MAJOR

**M-1: `process.once` for SIGTERM/SIGINT in index.ts 与已有 Eva 信号处理叠加**

Eva codebase 本身没有全局 SIGTERM handler 在 index.ts（vessel-core.ts CLI 有，但那是另一个进程入口）。所以 `once` 不会与 Eva 冲突。但 `@hono/node-server` `serve()` 内部注册了 SIGTERM，导致两个监听器：
1. @hono 的：优雅关闭 HTTP
2. 我们新加的：mcpManager.shutdown() + process.exit

`once` 保证每个只触发一次，race condition 低，但 exit 顺序不确定。**同 architect M-1，defer to M1C**。

**M-2: vesselFsRouter 没有 /api/vessel 前缀的 health 路由**

用户调试时需要 `/api/vessel/health` 检查 vessel 子系统。当前 `test:vessel-http` 测试使用的 `/api/vessel/health` 实际路由到哪里？（可能是 `vessel-intent.ts` 里的 /health 路由）

**检查结果**: vessel-intent.ts 有 `vesselRouter.get('/health', ...)` → 返回 JSON ok:true。不受 M1B 影响。**Not a blocker**.

## MINOR

**m-1: McpServerManager `shutdown()` 在 `this.servers.clear()` 前没有 await child exit**

`proc.kill('SIGKILL')` 是异步的，`this.servers.clear()` 紧跟其后。进程可能未真正退出就从 map 里删了。对于 acceptance test `pgrep -f mcp-server-filesystem` 来说，SIGKILL 后进程会很快消亡（< 100ms），3s 等待 + 立刻 SIGKILL + clear 在实践里没问题。**Accept**.

**m-2: 现有 `/api/fs/file` (Eva) 和新 `/api/vessel/fs/file` (Vessel) 功能重叠**

Eva /api/fs 提供文件树 + 内容；Vessel /api/vessel/fs 新增 trace event。未来可能让 Eva 路由 deprecated。接受重叠 — Eva routes 是为前端 UI，Vessel routes 是为 reviewer/observer 审计。两者有不同 consumer，不需要现在合并。

## 落地状态

| 项 | 状态 |
|---|---|
| SDK (@modelcontextprotocol/sdk) 未引入 | ✅ 按 B-级 review 决策 |
| 不写 ~/.claude/settings.json | ✅ |
| VESSEL_MCP_SERVERS env var 驱动 | ✅ |
| null byte fix 后再跑 tsc | 待 |
