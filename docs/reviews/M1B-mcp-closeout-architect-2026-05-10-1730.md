# M1B MCP + permission — 4-way closeout: vessel-architect

**Date**: 2026-05-10 17:30  
**Verdict**: PASS-WITH-FIXES

## BLOCKER

无。

## MAJOR

**M-1: index.ts SIGINT/SIGTERM handler 用 process.once + setImmediate 调 process.exit 可能与 @hono/node-server 内部信号处理冲突**

`@hono/node-server` 的 `serve()` 内部可能也注册了 SIGTERM handler（优雅关闭 HTTP server）。用 `once` 替代 `on` 后，第一个触发的 handler（MCP shutdown）调 `setImmediate(() => process.exit(...))` — 这在 process.exit 之前 @hono 的 handler 可能还没清理完 HTTP 连接。

**Risk**: 已连接的 WS 客户端收不到 FIN，产生 broken pipe。

**Mitigation（已接受）**: 对于 M1B 来说这是 edge case — vessel-core HTTP server 通常由 launchctl 管理，不频繁重启，且 WS 重连有指数退避。但下一个信号重构（M1C 或 M2）应统一信号处理到一个 onShutdown() 函数，MCP shutdown 作为其中一步而非独立 `once` 监听。**defer to M1C**.

**M-2: vessel-fs.ts 不验证 path query 参数含 null bytes（%00 HTTP encoding）**

虽然 `verifyAllowedPath` 最终会因 stat 失败返回 404，但 null byte 在 log / trace 中可能造成混乱。`path.resolve()` 在 Node.js 不会截断 null byte，stat 会 ENXIO。

**Fix**: 在 `path.resolve()` 之前加 `if (rawPath.includes('\0')) return c.json({error:'invalid path'},400)` — 2 行。

**接受**: 修复落地（见下方 Gates）。

## MAJOR deferred

**M-3: MCP server 实际没被 Claude CLI 使用**（cursor B-级 review 已标注）

当前 `mcpManager.spawn()` 启动了 MCP 进程，但 coding task 里 Claude CLI 并不知道这个 MCP server 在跑。因此 M1B 实现了"lifecycle management"但没有"tool wire-up"。

**Decision**: 接受 defer — M1B acceptance 测的是 HTTP permission + lifecycle，不是 CLI-MCP 集成。CLI-MCP 集成（vessel-core 在 spawn CLI 时通过 env 注入 `ANTHROPIC_MCP_SERVERS` 或 claude-project-config）defer to **M1B+**（下一个 MCP 追加 slice）。

## MINOR

**m-1: vessel-fs.ts MAX_FILE_BYTES 常量为 512KB**，Eva /api/fs 是 1MB。两个端点行为不一致，可能让用户疑惑。**Accept as-is** — Vessel 端点 512KB 是更保守的安全边界，注释已写。

**m-2: test-m1b.ts 中 McpServerManager 动态 import 会在不同 Node.js 进程间共享模块缓存** — 测试里先 setenv VESSEL_MCP_SERVERS 再 parseMcpSpecsFromEnv 可能受 module cache 影响。**Not a runtime issue** (production reads env at import time in manager.ts, test does dynamic import).

## 落地检查

| Fix | 状态 |
|---|---|
| null byte 检查 vesssel-fs.ts | 修完待验证 |
| tsc --noEmit exit 0 | ✅ |
| test:m1b 13/13 pass | ✅ |
| test:lessons pass | ✅ |
| test:vessel-http pass | ✅ |
| test:vessel-ws pass | ✅ |
