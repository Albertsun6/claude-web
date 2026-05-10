# ADR-009: MCP Server Lifecycle（按需起 + TTL 闲置回收）

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: mcp, lifecycle, m1b
- **Tier**: 1（重大决策；影响 M1B + 长期 Capability lifecycle）
- **Depends on**: ADR-014（escalation #5 secrets 跟 MCP server stdout 关联）+ FRAMEWORK §3 (Tool / ToolRegistry)
- **Spike report**: 无（决策由 v5.4 第三轮外部 AI 评审 Q3 + Eva permission/registry 现有 pattern 驱动）

## Context

M1B 起 vessel-core 通过 MCP（Model Context Protocol）调用外部工具（filesystem / git / playwright / 等）。每个 MCP server 是独立子进程。Lifecycle 管理影响：
- 资源占用（不池化时长期常驻浪费内存）
- 启动延迟（每次按需起冷启动慢）
- Capability uninstall 语义（NFR-C1 / NFR-C2）

第三轮外部 AI 评审 Q3 建议：按需起 + TTL 闲置回收。

## Decision

### 1. 不池化（与 ADR-012 ML worker 同原则）

- M1B 一个 MCP server（filesystem）按需启动
- v1+ 用户装多 Capability 引入更多 MCP server 时**不池化**
- 池化等真实性能问题出现再做（YAGNI）

### 2. 按需起（lazy spawn）

- vessel-core 启动时**不**立即 spawn 所有 MCP server
- 第一次调用某 MCP tool 时检测：
  - server 未启动 → spawn（带 trace_id env var）
  - server 已启动 → 复用
- spawn 同步等待 ready handshake（MCP 协议）

### 3. TTL 闲置回收

- 默认 TTL = **10 分钟**（无调用）
- 闲置超 TTL → SIGTERM 进程组（5 秒后 SIGKILL 兜底）
- 下次需要时重新 spawn（冷启动延迟可接受，CC CLI 同款体验）

### 4. Capability uninstall 时

按 NFR-C1 / NFR-C2：
- **专属 MCP server**（如 voice-specific MCP）→ 立即 SIGTERM
- **共享 MCP server**（如 filesystem 多 Capability 共用）→ 走 TTL（最后一个 Capability uninstall 后 TTL 内自动回收）

### 5. 进程组 + cleanup（沿用 Eva pattern）

- spawn 时 `start_new_session=true`（独立 process group）
- vessel-core 退出时 SIGTERM 全部 MCP server process group
- 按 NFR-S1：vessel-core 退出后 `pgrep -f mcp-server-*` 必须返回空

### 6. trace_id 传播

按 FRAMEWORK §5 Trace 协议（v0A.1 cursor B1 修订统一为 W3C Trace Context）：
- spawn MCP server 时 set `TRACEPARENT='00-<32-hex-trace-id>-<16-hex-span-id>-<flags>'`（W3C 标准）+ `VESSEL_CONVERSATION_ID` + `VESSEL_RUN_ID`（Vessel 特有命名空间）
- MCP server 输出 trace event 时按 OTEL hex 格式引用这些 id
- vessel-core 接收 MCP response 时记 `mcp.invoked` / `mcp.completed` event
- **不再使用旧 `VESSEL_TRACE_ID` / `VESSEL_PARENT_SPAN_ID`**（v0A.1 已废弃）

### 7. 失败模式（NFR-F1 类似）

- MCP server spawn 失败 → 标该 tool unavailable + log
- MCP server 中途崩溃 → vessel-core 检测 stderr / exit → 标 tool unavailable + log + 主进程不挂

## Consequences

### 正面

- ① **YAGNI 简洁**：不池化 = 1 个 MCP server 1 个进程，调试简单
- ② **资源弹性**：TTL 回收避免长期常驻
- ③ **Capability 装卸语义自洽**：跟 ADR-012 ML worker lifecycle 一致
- ④ **沿用 Eva pattern**：进程组终止 + trace 传播都是 Eva 已验证
- ⑤ **YAGNI 可演进**：v1+ 真出现性能问题时可加 pool（不破坏接口）

### 负面

- ① **冷启动延迟**：第一次调用 MCP tool 需等 spawn（500ms-2s 估计）—— 缓解：vessel-core 启动时**预热常用 MCP server**（按 config.toml `prewarm_mcp` 列表）
- ② **TTL=10 分钟**对长间歇用户可能过短 —— 缓解：`config.toml` 可配置 `mcp.idle_ttl_seconds`
- ③ **多 Capability 共享 MCP 时 ref count 复杂** —— 缓解：M1B 仅 filesystem 单 server，复杂度推到 v1+

## Prior Art

参考：
- **Eva permission registry pattern**：通过 token 注册/释放 channel + 590s timeout（与本 ADR 590s ↔ 10min 不同但 lifecycle 思想一致）
- **MCP TypeScript SDK** ([`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk))：standard client API
- **systemd socket activation**：按需起 service 模式（OS 级别，Vessel 应用级别参考）

Search keywords: `["mcp server lifecycle subprocess", "process pool vs lazy spawn personal app", "model context protocol lifecycle"]`

Rationale for self-design：
- 不池化是 Vessel 特化（个人单机 N=1 用户）
- TTL 回收 + 共享 ref count 是 Vessel 特有 Capability 装卸语义衍生
- 没有现成的开源参考实现（MCP SDK 不规定 lifecycle policy）
