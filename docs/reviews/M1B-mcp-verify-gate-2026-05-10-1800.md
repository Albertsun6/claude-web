# M1B MCP + permission Verify Gate — 2026-05-10 18:00

> 5 项必做。**结果**：✅ **5/5 全过**（修完 1 BLOCKER 后）。

## ✅ Gate 1: Finding 闭环

| 类型 | 数量 | 处理 |
|---|---|---|
| BLOCKER (≥ 2 convergent: risk-officer + cursor) | 1 | fixed |
| MAJOR (defer: signal race / trace rotation / CLI-MCP wire / tilde test) | 4 | deferred-with-owner+milestone |
| MINOR | 2 | accept/defer |

[Phase 3 arbiter](M1B-mcp-closeout-arbiter-2026-05-10-1800.md)

## ✅ Gate 2: 修复落地

| Fix | Path | Verification |
|---|---|---|
| null byte path sanitization | `routes/vessel-fs.ts` lines 62-63 + 110 | `GET /fs/file?path=foo%00bar` → 400 ✓ |
| `McpServerManager` spawn/kill lifecycle | `mcp/manager.ts` | test:m1b manager lifecycle 8/8 ✓ |
| `permission.denied` trace on 403 | `routes/vessel-fs.ts emitDenied()` | trace file in dataDir/traces/ ✓ |
| index.ts MCP startup + shutdown hooks | `index.ts` VESSEL_MCP_SERVERS + process.once | code review ✓ |

## ✅ Gate 3: 回归测试

```
pnpm --filter @vessel/backend exec tsc --noEmit  # exit 0
pnpm --filter @vessel/shared test                # 123 tests pass
pnpm --filter @vessel/backend test:coding-driver # pass
pnpm --filter @vessel/backend test:vessel-http   # pass
pnpm --filter @vessel/backend test:vessel-ws     # pass
pnpm --filter @vessel/backend test:lessons       # pass
pnpm --filter @vessel/backend test:m1b           # 13 assertions pass (NEW)
```

## ✅ Gate 4: 链接完整性 + Doc 一致性

- B-级 review (architect + cursor) 存在: `M1B-mcp-b-level-architect/cursor-2026-05-10-1000.md` ✓
- 4-way closeout 4 文件存在 ✓
- Phase 3 arbiter 存在 ✓
- `mcp/manager.ts` 不引 `@modelcontextprotocol/sdk`（B-级 review 决策落实）✓
- `index.ts` 不写 `~/.claude/settings.json`（B-级 review 决策落实）✓
- `packages/backend/package.json` 无新 npm 依赖（只用 Node.js built-ins）✓

## ✅ Gate 5: 调研引用

M1B 使用现有 ADR-009（mcp-server-lifecycle）覆盖 MCP lifecycle 决策，无新外部选型（SDK 被明确 defer）。DAR yes/no：
- 引入新依赖：NO（无新 npm 包；`npx @modelcontextprotocol/server-filesystem` 是运行时 optional）
- 引入新协议：部分（MCP server spawn，但不说 MCP 协议——仅 stdio 子进程管理）
→ Phase 0 spike 非必须（B-级 review 覆盖了架构决策）。

## 🚫 Escalation triggers

无：
- ❌ 无 decision-required finding
- ❌ 无 unresolved disagree  
- ❌ Verify Gate 全过
- ❌ 无 secrets / license / CVE / 破坏性数据迁移

## 制度性教训新增

**lifecycle ≠ wire-up**（第 12 次 cursor + Claude 互补）

`McpServerManager.spawn()` 管理了 MCP server 子进程的生命周期（启动 / 退出清理），但 Claude CLI 在执行 coding task 时不知道这个 MCP server 存在。"我管了它的生命"不等于"它在工作流里被用到了"。实现了可观测的正确顺序：先有 lifecycle，再有 wire-up（M1B+：spawn CLI 时注入 MCP server 地址）。

## 决策

✅ **M1B MCP + permission 边界验收通过**。

**累计已完成 milestone**: 0-meta-lite / 0-pre / 0A / 0A.1 / 0B / M0 / M0.5 / M1A-α / M1A-β / L1-minimal / **M1B**

**今天用户能用的**（M1B 新增）:
- `VESSEL_MCP_SERVERS='[{"name":"fs","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","~/Desktop"]}]'` → vessel-core 启动时 auto-spawn MCP server，退出时 SIGTERM 清理
- `GET /api/vessel/fs/file?path=/allowed/file.txt` → 200 + content（VESSEL_ALLOWED_ROOTS 内）
- `GET /api/vessel/fs/file?path=/etc/passwd` → 403 + `permission.denied` trace event 写盘
- `GET /api/vessel/fs/tree?root=/allowed/dir` → 200 + entries[]

**下一步选项**：
- **M1B+** (MCP CLI wire-up) — vessel-core spawn Claude CLI 时注入 MCP server env 让 coding tasks 能调用 MCP 工具
- **M1C-A** (Workflow Engine + HITL) — 用户"几十个 agent 在干活"诉求最接近形态

lesson_id: (closeout finalize 后填入)


lesson_id: 60de173c-bce1-4cb4-bc96-115d5daa5848
