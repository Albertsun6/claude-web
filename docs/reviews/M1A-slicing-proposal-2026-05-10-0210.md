# Proposal: M1A 切片 (α/β/γ) + 2 个增量 CLI 命令

**Date**: 2026-05-10 02:10
**Status**: **Accepted (PASS-WITH-FIXES applied)** — see [arbiter](M1A-slicing-arbiter-2026-05-10-0210.md)
**Author**: Claude (本会话)
**Reviewers**: vessel-architect + cursor cross (B级)
**触发**: 用户在 M0.5 closeout 之后明确诉求"加快开发进度，需要面板看到状态 + 并行工作"。这个 reorder 是工程排序级决策（不在 ADR-015 DAR 8 项硬触发内），但用户判断属于"重要决策"，要求 B 级评审。

## Plan v5.4 现状（不动）

```
M1A — 多入口 + session 共享（Eva 现成）
Acceptance：
  - curl POST localhost:3030/api/intent -d '{"text":"hi","session_id":"s1"}' 返回 200
  - 同 session_id 在 CLI 和 Web 都能查询到上下文
  - WS /ws 推送 ≥ N 条 trace 事件
依赖：M0.5 ✅ 已完成
```

## Proposal

### Part 1: M1A 拆 3 个增量切片，每个独立 ship + 4-way review + Verify Gate

| 切片 | 用户立刻能用什么 | 包含什么 | 不包含什么 |
|---|---|---|---|
| **M1A-α (panel-first)** | HTTP 入口 + 极简 Web 看活跃 sessions/runs + trace 时间线 | `POST /api/vessel/intent` / `GET /api/vessel/runs` / `GET /api/vessel/sessions` / `GET /api/vessel/traces/<id>`（v0A.1 review fix: `/api/vessel/*` namespace 隔离 Eva）；最小 React 单页挂 `/vessel/min/`（不污染 Eva 主 App.tsx） | WS（β 做）；Eva 多 ProjectTabs UI（γ 做） |
| **M1A-β (parallel-via-WS)** | Web 开 N 个 conversation tab 并发跑 | WS `/ws` upgrade + multiplex by runId；shared protocol 加 `vesselSessionId` / `conversationId` 字段（v0A.1 review fix C-MAJOR-2: 不复用 `resumeSessionId`，那是 Claude CLI 续跑专用）；orchestrator runIntent 接 onMessage 流 | Eva 现成 frontend 接入（γ 做） |
| **M1A-γ (eva-frontend-rewire)** | Eva 现成 React UI（ProjectTabs / sessions sidebar / chat panel）接到 Vessel orchestrator + 多 Conversation per Project | **双层身份模型**（v0A.1 review fix C-MAJOR-1: γ 不是 grep-replace；Eva `byCwd` 在 frontend 107 处引用、11 文件、有 localStorage 持久化）：`projectsByCwd`（保留，cwd-keyed） + `conversationsById`（新增，session_id-keyed）。一次性 localStorage migration：旧 `cwd → sessionId` → 每 cwd 一个 default conversation。改 [App.tsx](packages/frontend/src/App.tsx) 调 `/api/vessel/intent`；ProjectTabs 仍 cwd-keyed，conversation switcher 在 tab 内 | 全部 plan §M1A acceptance 在 γ 完成时满足；voice/inbox/harness/telemetry 等 Eva routes 保留但暂不接 Vessel orchestrator（M1B/M2 处理） |

### Sub-acceptance（v0A.1 review fix A-MAJOR-1：每段独立 verify，γ 完成时对齐 plan §M1A 全集）

| 切片 | 子验收 |
|---|---|
| α | `curl POST /api/vessel/intent -d '{"text":"echo hi","skill":"echo"}'` 返 200 含 AgentResult；`/vessel/min/` 页打开能看到 ≥ 1 session、点 trace_id 看到 span 树 JSON；CLI + Web 并发写 memory.db 不报 SQLITE_BUSY |
| β | wscat 客户端拼 3 个不同 vesselSessionId 的 user_prompt 经 WS，trace 时间线 ≥ 3 路独立 stream，不串路由；conversation_id 与 vesselSessionId 1:1 |
| γ | plan §M1A 全集 acceptance 三条全过；ProjectTab 内能切换多个 conversation；旧 localStorage 数据迁移成功 |

### Part 2: 2 个增量 CLI 命令（M1A-α 内一并 ship）

| CLI | 作用 | 实现 |
|---|---|---|
| `vessel-core trace replay <trace_id>` | 读 `~/.vessel/traces/<trace_id>/*.json`，按 parent_span_id 排序打印缩进 span 树 | ≤ 30 行 in cli/vessel-core.ts；plan v5.4 §observability 已设计回填 |
| `vessel-core list [--limit N]` | 直读 `memory.db` 列最近 N 个 session/intent/skill_invocation 状态。`--limit` 默认 20。**M1A stub —— direct SELECT, will be replaced by Memory interface in M1C-B per ADR-002**（v0A.1 review fix MINOR） | ≤ 30 行 |

**为什么加这俩**：用户即刻有"看状态"工具，不依赖 HTTP/Web。

### Part 2.5: 跨进程 SQLite 并发（v0A.1 review fix C-MAJOR-3）

α/β 让 `pnpm vessel-core` (CLI) 与 backend HTTP server 同时打开 `memory.db`。better-sqlite3 单 connection 同步 API + WAL 仍是 single writer：跨进程并发写需要 `busy_timeout` 否则直接 SQLITE_BUSY。

**Fix**：[session-store.ts:openMemoryDb](packages/backend/src/memory/session-store.ts) 加 `db.pragma('busy_timeout = 5000')` —— 跨进程并发写阻塞最多 5 秒后让出 / retry，不死锁。

**集成测试**：α 加 1 个 test：启动 backend 写 `/api/vessel/intent` 同时跑 `pnpm vessel-core --skill=echo "concurrent"`，验证不报 SQLITE_BUSY。

### Part 3: 不做的事（守边界）

- ❌ 不接 Eva voice/inbox/harness/telemetry routes 到 Vessel orchestrator（M1B / M2 处理）
- ❌ 不引 trace dashboard 高级可视化（D3/cytoscape 等）—— v1+
- ❌ 不改 ROADMAP 的 M1A→M1B→M1C→M2 顺序
- ❌ 不动 5 接口 stub / ADR / harness.db / capability runtime

## 关键问题供 reviewer 评判

### 给 vessel-architect 的问题

1. **切片独立性**：α 不依赖 β/γ 的代码就能 ship + verify？β 不依赖 γ 就能 ship？
2. **5 接口契约**：α 暴露 `/api/runs/list` / `/api/traces/<id>` 是否暗示 Memory 接口字段（trace 不在 5 接口内是 internal contract，路由暴露算泄漏吗）？
3. **CLI 增量是否偷塞 v1+ 抽象**：`vessel-core list` 直接 SELECT 表是绕过 Memory 接口；可接受吗（M0.5 EchoSkill 同样绕过 Memory full surface）？
4. **更好的切法**：是否有 2 切分 / 不切的更好方案？

### 给 cursor 异质 cross 的问题

1. **Eva App.tsx 适配代价**：Eva [App.tsx:byCwd](packages/frontend/src/store.ts) 是 cwd-keyed，Vessel 是 session_id-keyed。重命名 byCwd → bySessionId 是 grep-replace 还是要重新设计 ProjectTabs 的概念映射？
2. **memory.db 锁竞争**：M0.5 单进程 single-writer。M1A-β 多 session WS 并发跑 vessel-core skill 时，多 writer 竞争 memory.db；better-sqlite3 是同步 API + 单连接 writer，是 OK 还是会死锁？
3. **trace 文件 dir 无限增长**：`~/.vessel/traces/<trace_id>/*.json` per run，没轮转。当用户跑 100+ runs 后 ls 会慢；α 要不要先做 retention？
4. **多 session WS 路由的 Eva-side bug**：Eva BackendClient.swift / store.ts 已经实现 runIdToConversation；M1A-β 直接复用这个协议安全吗，还是 session_id 模型与 conversation_id 有 race？
5. **Claude 这次的 blind spot**：基于过去 7 次 cursor 抓 BLOCKER 的盲区集，本提案最可能漏看的是？

## 评审输出格式

每位 reviewer 写自己的 verdict 到 `docs/reviews/M1A-slicing-{architect,cross}-2026-05-10-0210.md`，包含：

- Overall verdict: PASS / PASS-WITH-FIXES / REJECT
- 4 个 question 各自结论
- BLOCKER / MAJOR / MINOR findings
- 对替代方案的反提案（如有）
- ≤ 200 字 stdout 总结
