# ADR-011: Vessel-Core Runtime Process Model

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: runtime, process-model, m0
- **Tier**: 1（重大决策；影响 M0 boot + 全程 lifecycle）
- **Depends on**: ADR-012（TS + ML worker）+ ADR-009（MCP lifecycle）+ FRAMEWORK §9 三层 boot
- **Spike report**: 无（决策由 NFR-S1 + Eva backend 现有进程模型 + v5.1 评审 F1 修订驱动）

## Context

第三轮外部 AI 评审 Q3 提出补一个 ADR-011 锁定 vessel-core 运行时进程模型（前台 CLI / HTTP server / daemon / 多模式）。NFR-S1 要求 vessel-core 是唯一常驻主服务进程。

## Decision

### 1. 主进程模型 = HTTP server + WebSocket（沿用 Eva）

- 启动命令：`pnpm dev:backend` 或 `node packages/backend/dist/index.js`（生产）
- 监听端口：默认 `3030`（沿用 Eva）；可通过 `~/.vessel/config.toml` 改
- HTTP routes：`/api/intent` / `/api/workflows/:id/resume` / `/api/permission/ask` / `/api/voice/*` / `/api/inbox/*` / 等
- WebSocket：`/api/ws`（trace stream + 多会话路由）

### 2. CLI 入口 = Wrapper 进程（M0 起）

- `pnpm vessel-core "<intent>"` 或 `pnpm exec vessel-core ...`（按 ADR-001 pnpm script）
- 实现：CLI 命令 spawn 一个轻量 Node 进程 → POST `/api/intent` 到 vessel-core HTTP server → stream 输出
- vessel-core HTTP server 必须先启动（CLI 进程**不**自动 spawn vessel-core，避免多服务）
- vessel-core 未启动时 CLI 报 "vessel-core not running, start with `pnpm dev:backend`"

### 3. M0 阶段：前台 CLI（不 daemonize）

- vessel-core 跑在前台终端（`pnpm dev:backend` 直接占 stdout）
- ctrl-c → SIGINT → bootProcess teardown（按 NFR-F1 / NFR-S1）
- 重启策略：手动（owner 跑 `pnpm dev:backend` 启动）

### 4. M1A 起：HTTP server + WebSocket 模式

- 仍是单进程（HTTP + WS 共享 Hono server）
- iOS / Web 客户端通过 HTTP/WS 接入
- 沿用 Eva 端口 3030

### 5. v1+ 才考虑 daemon 模式

按 NFR-S1 + Eva 现状：
- ❌ v0.1：不 daemonize（前台跑，明示主进程在线）
- ❌ v0.1：不上 systemd / launchd unit（增加运维复杂度）
- ⚠️ v1+：按需引入 launchd（macOS owner 启动登录时自动跑 vessel-core）—— 单独 ADR 锁定

### 6. Helper subprocess（不算多服务）

按 NFR-S1 + ADR-012 + ADR-009：
- ML worker（embedding / whisper / piper）— spawn / TTL / shutdown
- MCP server（filesystem / etc.）— 同
- CC CLI（cli-runner spawn）— per-run
- **vessel-core 始终是唯一常驻服务进程**；helper subprocess 受控生命周期

### 7. 进程层级图（M2 完成后状态）

```
vessel-core (主进程 + HTTP/WS server)        ← 唯一常驻
├── ml-worker:embedding (Python)             ← TTL 回收
├── ml-worker:whisper (Python，voice 卸载时立即 SIGTERM)
├── ml-worker:piper (Python，同)
├── mcp-server:filesystem (subprocess)       ← TTL 回收
├── mcp-server:git (subprocess)              ← TTL 回收
└── cli-runner spawn:
    └── claude (CC CLI per-run)              ← per-Run，run 完即退
        └── permission-hook.mjs callback to /api/permission/ask
```

### 8. 启动序列（按 FRAMEWORK §9 三层 boot）

```
$ pnpm dev:backend
├── bootProcess()
│   ├── 加载 config.toml
│   ├── 开 SQLite + sqlite-vec
│   ├── 初始化 Tool Registry / Permission / Trace
│   ├── 加载 Capability App manifests（boot() 它们）
│   ├── 启动 HTTP server (3030) + WS upgrade handler
│   └── 报 ready
├── bootInstance()                          ← M0 最小骨架；M2-Soul 扩展
│   ├── 加载 Instance 名（M0: "vessel-core"，M2-Soul: "EVA"）
│   ├── 恢复 Memory（M1C-A 起）
│   └── 报 instance ready
└── (等待 Intent)
    └── bootSession() ← 每次新 session 第一个 Intent 时
        ├── 创建 session_id
        ├── 拉相关 long-term memory（M1C-B 起）
        ├── 创建 trace span
        └── 检查 paused workflow（M1C-A 起）
```

### 9. 关闭序列

```
SIGINT / SIGTERM → bootProcess.teardown():
├── 拒绝新 Intent（HTTP 503）
├── 等待 in-flight Intent 完成（5 秒 grace period）
├── SIGTERM 全部 helper subprocess process group
├── 5 秒后 SIGKILL 兜底
├── 关闭 SQLite（WAL checkpoint）
└── 退出
```

## Consequences

### 正面

- ① **NFR-S1 满足**：vessel-core 唯一常驻；helper subprocess 受控
- ② **沿用 Eva 进程模型**：minimal change；Eva 已生产验证
- ③ **三层 boot 清晰**：进程级一次启动；Instance/Session 级独立可重入（CONCEPTS §3.5）
- ④ **CLI 入口轻量**：CLI wrapper 不 spawn vessel-core，避免多服务
- ⑤ **v1+ daemon 路径不阻塞**：v0.1 前台 CLI + v1+ 加 daemon 兼容

### 负面

- ① **vessel-core 必须先启动**才能用 CLI —— 缓解：`vessel-core --auto-start` flag（v1+）或 launchd（v1+）
- ② **owner 关电脑前必须手动 ctrl-c**（不然 process 残留 / 数据 inconsistent）—— 缓解：bootProcess.teardown 处理 SIGINT；macOS sleep 不算 SIGINT，但 vessel-core 重启自愈
- ③ **多机器同步 vessel-core 状态需手动**（v0.1 不上云）—— 与 Vessel 个人单机硬约束自洽

## Prior Art

参考：
- **Eva 自家进程模型**（packages/backend/src/index.ts L1-L507）—— 直接借鉴
- **systemd / launchd**（OS 级 daemon）—— v1+ 参考
- **Node.js process 信号处理 best practice**

Search keywords: `["nodejs cli daemon mode", "personal app process model", "single-user backend service lifecycle"]`

Rationale for self-design 部分：
- 三层 boot 是 Vessel 特有架构（CONCEPTS §3.5）
- helper subprocess 受控生命周期 + NFR-S1 是 Vessel 特有约束
