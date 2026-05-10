# Cross Review — M1A-beta WS multi-conversation parallel

**Reviewer**: vessel-cross-reviewer  
**Model**: gpt-5.5 (Cursor)  
**Date**: 2026-05-10 13:20  

## Summary

- Blockers: 1
- Majors: 3
- Minors: 3
- Lens 5 findings: 2
- Overall verdict: **必须先修 B1，再 closeout**。`/ws` upgrade 鉴权和跨连接 `vessel_cancel` 隔离本身是对的；主要问题是 M1A-β 新 WS live path 绕过了 M1A-α 已加的 HTTP response redaction，并且 run/session identity 在边界上还有两个细节洞。

## Numeric Score

| Lens | Score |
|---|---:|
| 正确性 | 3.6 |
| 跨端对齐 | 3.7 |
| Eva 改造 + Vessel 硬约束 | 4.1 |
| 安全 + 4 类硬触发 | 3.2 |
| 集体盲区检测 | 4.0 |

**Overall**: 3.8（有 BLOCKER，上限 3.9）

## 5 个具体问题结论

1. **panel WS auth — PASS**: `index.ts:320-330` 在 raw upgrade 上调用 `checkWsAuth()`；`auth.ts:109-113` 支持 `?token=`，和 panel `vessel-panel.ts:133-137` 对齐。
2. **跨连接 vessel_cancel 污染 — PASS**: `vesselRuns` 在 `wss.on("connection")` 内创建，`vessel_cancel` 只查当前连接的 `vesselRuns.get(msg.runId)`。
3. **trace sink try/catch — FAIL (MAJOR)**: sync throw 会吞，async rejection 不会。
4. **protocol unknown — ACCEPT WITH MINOR**: beta 阶段可接受 opaque，但 gamma/React 化前要补最小 DTO 或 runtime guard。
5. **Claude 最可能漏看 — WS 新路径复活旧泄漏**: HTTP redaction 已修，但 WS `send()` 直接推 raw `AgentResult` / trace event。

## Findings

### B1 [BLOCKER] WS live response bypasses HTTP path redaction

**Where**: `packages/backend/src/index.ts:555-569`, `packages/backend/src/routes/vessel-intent.ts:45-59`, `packages/backend/src/observability/trace-writer.ts:55-65`

**Issue**: M1A-α 的 HTTP `/api/vessel/intent` 用 `redactAgentResult()` 把 `artifact.files` / `stdoutPath` 转成 `$VESSEL_DATA_DIR/...`，`GET /traces/:id` 也用 `redactTraceEvent()` 处理 `artifact_refs`。但 M1A-β WS path 直接发送 `event` 和 `result`：coding skill 的 `files` / `stdoutPath` 仍是绝对路径，trace spillover 的 `artifact_refs` 也是绝对路径。

**Why blocker**: 这是新 WS surface 重新打开已 close 的 path leak。echo-only integration test 不会触发 coding artifact / stdout spillover，所以 19 assertions 仍会全绿。

**Suggested fix**: 把 `relativizePath` / `redactAgentResult` / `redactTraceEvent` 提成 shared helper，在 WS `vessel_trace` 和 `vessel_completed` 发送前同样调用；补一个 coding fake fixture 测试，断言 WS payload 不含 `DATA_DIR` 绝对前缀。

### M1 [MAJOR] Same-connection duplicate runId can corrupt routing and cancel

**Where**: `packages/backend/src/index.ts:524-546`, `packages/backend/src/index.ts:576-577`

**Issue**: `vessel_intent` 没有检查 `vesselRuns.has(runId)`。同一连接重复发相同 `runId` 时，第二个 handle 覆盖第一个；两个 async closure 继续用同一个 outer `runId` 发消息。第一个完成时 `finally` 会 delete map，把第二个 handle 也删掉；之后 `vessel_cancel` 可能取消不到正确 run。

**Suggested fix**: 在 `vessel_intent` 入队前 reject duplicate runId，返回 `vessel_error DuplicateRunId`；测试同一 WS 连接双发同 runId + cancel。

### M2 [MAJOR] Auto-created vesselSessionId is never latched into WS envelope

**Where**: `packages/backend/src/index.ts:545-569`, `packages/backend/src/routes/vessel-panel.ts:169-177`, `packages/backend/src/orchestrator.ts:74-80`

**Issue**: panel 发送 `vessel_intent` 时不带 `vesselSessionId`。`runIntent()` 会 `bootSession()` 自动创建 session，但 WS handle 的 `vesselSessionId` 保持 `""`；后续 `vessel_trace` / `vessel_completed` envelope 也带空字符串。代码注释写了 "Latch vesselSessionId from result"，但没有实现。

**Suggested fix**: 在 `onTraceEvent` 第一次看到 `event.session_id` 时设置 `handle.vesselSessionId = event.session_id`，再发送；或让 `runIntent()` 返回 sessionId。补 panel no-session case 测试。

### M3 [MAJOR] Sink callback type allows async rejection outside try/catch

**Where**: `packages/backend/src/observability/trace-writer.ts:78-80`, `packages/backend/src/drivers/cli-runner-driver.ts:119-120`, `packages/backend/src/interfaces/skill.ts:43-46`

**Issue**: callback 类型写成返回 `void`，但 TypeScript 允许 `async () => {}` 赋给 void-returning callback。当前 `try { sink(...) } catch {}` 只能吞同步 throw，Promise rejection 会变成 unhandled rejection。

**Suggested fix**: 定义 `type Sink<T> = (value: T) => void | Promise<void>`，调用处用 `void Promise.resolve(sink(value)).catch(...)`；fake driver 同步更新。

### m1 [MINOR] WS auth code passes, but no token-mode regression test

**Where**: `packages/backend/src/test-vessel-ws-multi.ts:39-65`, `packages/backend/src/auth.ts:109-113`

**Issue**: 实现已经验证 `?token=`，但测试只在无 `VESSEL_TOKEN` 模式打开 `ws://.../ws`。下一次改 upgrade handler 时容易退回 unauth bypass。

**Suggested fix**: 增加一个小测试：设置 `VESSEL_TOKEN=x`，无 token upgrade 应 401，`?token=x` 应 open。

### m2 [MINOR] `event: unknown` / `message: unknown` is okay for beta, but panel reads fields unchecked

**Where**: `packages/shared/src/protocol.ts:132-142`, `packages/backend/src/routes/vessel-panel.ts:152-162`

**Issue**: shared protocol 保持 opaque 能避免 backend type leak；但 panel 已经假设 `event.event_type` / `message.type` 存在。现在是 vanilla JS，坏消息只会显示少一点；到 M1A-γ React/TS 后会变成隐式 any pressure。

**Suggested fix**: beta 可不阻塞；gamma 前加最小 `VesselTraceEventEnvelope` / `VesselProgressEnvelope` runtime guard，或只公开 UI 需要的 3-4 个字段。

### m3 [MINOR] Panel still has periodic polling despite beta WS switch

**Where**: `packages/backend/src/routes/vessel-panel.ts:146`, `packages/backend/src/routes/vessel-panel.ts:180-182`

**Issue**: WS 已在 completed/error 时 `refreshRuns()`，但页面仍 `setInterval(refreshRuns, 5000)`；文件头注释也还说 WS out of scope / polling。不是 correctness bug，但和 "替换 3s polling 为 WS" 的 closeout 叙述不完全一致。

**Suggested fix**: 保留 initial refresh + completed/error refresh；如果要兜底，改成显式低频 fallback 并更新注释。

## False-Positive Watch

- B1 只在 coding skill 或 trace payload spillover 时显性触发；echo-only path 不会复现。但 `ClaudeCodeDriver` 明确返回绝对 `files` / `stdoutPath`，所以不是纯理论风险。
- M3 当前调用方 `send()` 是同步函数，所以现状不会由 panel 触发；风险来自接口契约允许未来 async sink。

## What I Did Not Look At

- 没有重审 M1A-α HTTP body cap / 0.0.0.0 token guard / allowlist 已修项，只核对它们是否被 WS 新路径绕过。
- 没有运行测试；本次是静态 byte-level review。
- 没有审 Swift/iOS，因为 M1A-β 范围是 backend WS + minimal panel。

## Lens 5 — Claude 集体盲区判断

这次最可能漏看的是 **"旧问题在新 transport 上复活"**：大家会记得 path leak 已在 HTTP closeout 修掉，于是默认它不再是问题；但 WS 走了另一条 serialization path，没有复用同一个 redaction helper。第二个盲区是 **client-supplied runId collision**：正常 UI 用 `crypto.randomUUID()`，所以 happy path 和并发测试都不会碰到，但服务端路由表必须自己维护唯一性。
