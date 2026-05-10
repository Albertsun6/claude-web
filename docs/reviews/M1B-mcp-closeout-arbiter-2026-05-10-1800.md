# M1B MCP + permission — Phase 3 arbiter verdict

**Date**: 2026-05-10 18:00  
**Phase 2 react skipped**: finding 4-way convergence 强，无 contested finding  
**4-way inputs**: architect / pragmatist / risk-officer / cursor-cross

## 异质性确认

- **1 convergent BLOCKER** (risk-officer + cursor): null byte path sanitization → **已 fix** (2 lines, `rawPath.includes('\0')` guard in both `/fs/file` + `/fs/tree`)
- **1 convergent MAJOR defer** (arch + pragmatist + risk): index.ts SIGTERM/SIGINT signal handler race with @hono — defer to M1C 统一 onShutdown
- **1 pragmatist MAJOR**: SDK 未引入 ✅（B-级 review 决策已落实，4-way 确认合理）
- **cursor 独家**: tilde expansion 未被 test 覆盖 (MINOR, accepted)

## 4 档分类矩阵

### ✅ 接受（已 fix）

| Finding | Source | Fix | 验证 |
|---|---|---|---|
| **BLOCKER null byte path sanitization** | risk-officer + cursor | `\0` check before path.resolve() in both routes | tsc exit 0 + test:m1b 13/13 ✓ |

### ⚠️ 部分接受（defer）

| Finding | Defer 决策 |
|---|---|
| SIGTERM/SIGINT signal race with @hono | M1C 统一信号处理（owner: M1C 实施时） |
| traces/ 目录无 rotation（R-M1B-2）| M1C observability 话题 |
| CLI-MCP wire-up（coding tasks 实际用 MCP）| M1B+ 追加 slice（vessel-core 启动 CLI 时注入 MCP env） |
| tilde expansion test coverage | M1B+ 或 M1C test 补齐时加 |

### 🚫 反驳

无。

### 🟡 挂起

无。

## Phase 3 行动汇总

- ✅ 修 1 BLOCKER（null byte path sanitization — 2 line fix）
- ⚠️ Defer 4 MAJOR/MINOR（信号处理 / trace rotation / CLI-MCP wire / tilde test coverage）
- ✅ tsc clean + test:m1b 13/13 + 既有测试 suite 全 green

## 关键洞察

**M1B 制度性教训：lifecycle ≠ wire-up**

`McpServerManager.spawn()` 管理了 MCP server 的生命周期（启动 / 退出清理），但 Claude CLI 不知道这个 MCP server 存在。"我管了它的生命"不等于"它在工作流里被用到了"。下一步（M1B+）才是 wire-up：vessel-core 在 `spawn Claude CLI` 时通过环境变量注入 MCP server 地址，让 coding tasks 真正能调用 MCP 工具。

**第 12 次 cursor + Claude 互补**：  
cursor 指出 tilde expansion 未被测试 —— 该路径是用户实际会走的（`~/Desktop/foo.txt`），属于 happy path 缺口。archer m-1 指出合成 trace session_id 方案，两者形成互补：一个关注 UX 覆盖，一个关注安全边界。

## 决策

✅ **M1B MCP + permission 边界验收通过**（修 1 BLOCKER 后）。

**累计已完成 milestone**: 0-meta-lite / 0-pre / 0A / 0A.1 / 0B / M0 / M0.5 / M1A-α / M1A-β / L1-minimal / **M1B**

## debate-review log entry

```json
{"date":"2026-05-10","planFile":"docs/reviews/M1B-mcp-closeout-arbiter-2026-05-10-1800.md","totalClaims":8,"accepted":1,"partial":4,"rejected":0,"hung":0,"biggestInsight":"lifecycle ≠ wire-up：管了 MCP server 生命周期不等于 coding tasks 能用到它；需 M1B+ CLI spawn 时注入 MCP env","biggestMistake":"null byte path sanitization 遗漏 — path.resolve() 前未过滤 %00，risk-officer + cursor convergent catch","newPrinciplesAdded":0,"newRisksAdded":0,"reviewerSkippedQuestions":[],"counterChallenges":["architect M-1 signal race: 接受 defer（M1C 统一）","pragmatist: traces rotation 接受 defer（M1C observability）"],"contract":"M1B-mcp-permission","mechVersion":"v2-lite"}
```
