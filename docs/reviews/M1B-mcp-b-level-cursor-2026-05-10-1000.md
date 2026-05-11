# M1B MCP + Permission — B-级 Review: cursor-cross

**Date**: 2026-05-10 10:00  
**Scope**: M1B-minimal proposal — MCP subprocess lifecycle + vessel HTTP permission enforcement  
**Verdict**: PASS (with caution on runtime deps)

## MAJOR

**M-1: npx @modelcontextprotocol/server-filesystem 的运行时网络依赖**

`npx @modelcontextprotocol/server-filesystem <paths>` 首次运行会从 npm registry 下载包。
这意味着：
- 测试环境（CI / 离线）可能无法通过 `pgrep -f mcp-server-filesystem` 验收
- vessel-core 启动时若 MCP server spawn 失败（网络超时），不应 crash，应 warn + `mcpManager.running()` 返回空

**Fix**: `McpServerManager.spawn()` 捕获所有 spawn 错误，log warning，返回 `false` 而非 throw。vessel-core 降级：无 MCP server 时 coding 任务仍然工作（MCP capability unavailable，不影响 core）。

**M-2: pgrep -f criterion 要求进程命令行含 mcp-server-filesystem**

`npx` 启动的 node 进程命令行通常是 `node /path/to/node_modules/.bin/mcp-server-filesystem <paths>` 或 `node /tmp/npx-xxx/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js ...`，`-f` flag 按全命令行匹配，会命中。但如果包缓存路径变化，命令行可能不含 `mcp-server-filesystem`。

推荐验收时用 manager 的 `running()` 方法（返回 names[]）替代 pgrep 做单元测试断言；pgrep 只做手动集成验收（不加入自动测试）。

## MINOR

**m-1: 403 响应体应含诊断信息**

返回 `{ error: "path not allowed", denied_path: redacted, allowed_count: N }` 而非空 403，便于调试。`denied_path` 用 `redactFreeformText(absPath)` 脱敏后写入（不暴露用户主目录具体结构给 trace 外部）。

**m-2: MCP manager shutdown timeout**

SIGTERM → wait 3s → SIGKILL（不是 5s）。MCP server-filesystem 是轻量 node 进程，3s 足够；5s 延长 vessel-core 关闭窗口，影响 SIGINT 体感。

## 整体判断

最小切片合理，无 SDK 无新 npm 依赖（spawn 级别）对 M1B 够用。CLI-MCP 集成（coding 任务实际用 MCP 工具）推 M1B+ 处理是正确的优先级判断。
