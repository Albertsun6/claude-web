# vessel-architect Phase 1 verdict — M1A-β closeout (2026-05-10 03:20)

Reviewer: vessel-architect (Claude main session, opus-4.7-1m)
Scope: M1A-β 实施完成 closeout review。架构 / 模块边界 / 长期演进 / 5 接口契约 lens。
β 范围严控：仅 WS multi-conversation streaming；γ Eva App.tsx rewire / M1B MCP / M1C Workflow / M2-Soul / Voice / iOS 全不在内。
本轮要回答 4 个题目：β 边界 / Trace sink 设计 / WS protocol 字段 / 5 接口契约影响。

## Summary

- **Overall**: **PASS-WITH-FIXES**（0 BLOCKER；2 MAJOR；4 MINOR）
- **BLOCKER count**: 0
- **MAJOR count**: 2
- **MINOR count**: 4

落地与 M1A-α architect 提出的 MAJOR-1 接口口子方案完全对齐：
[orchestrator.ts:53-55](/Users/yongqian/Desktop/Vessel/packages/backend/src/orchestrator.ts#L53-L55)
`IntentInput` 加 `onTraceEvent` / `onSkillMessage` 两路 callback，HTTP 路由不传，
WS 路由穿透到 `ws.send` —— α 已 ship 的 `POST /api/vessel/intent` 同步契约 0 改动 ✓。
panel 也按 α 架构 MINOR-5 建议 setInterval(refreshRuns, 5000) → WS 推送替代 + `?token=`
auth 已透传 ✓。`vessel_intent` / `vessel_cancel` / `vessel_trace` / `vessel_progress` /
`vessel_completed` / `vessel_error` 6 路 ServerMessage / ClientMessage 与 B-级 review
C-MAJOR-2 锁定的 `vesselSessionId` + `conversationId` 字段命名一致 ✓。

但有两处架构债没显式记下，会在 v1+ exporter / γ Eva 接入时撞：

1. **`FileTraceWriter` 通过 constructor 私有字段持有 sink，使 sink 与 Writer
   生命周期 1:1 绑定** —— v1+ 加 OTEL gRPC exporter 时 sink-list 必然 >1，重构面被绑死。
2. **`vessel_progress.message` / `vessel_trace.event` 标 `unknown`** 是 forward-compat
   字段，但 backend bump trace event_type enum 时**没 schemaVersion**，frontend 静默
   兼容 = 测试盲区。这与 α MAJOR-2（panel HTML 反向消费 sqlite 列名）同形。

## 4 题逐条结论

### Q1: β 边界守得住吗（γ / M1B / M1C / Soul / Voice / iOS 偷塞）：**PASS**

逐项 grep + 文件审 ([packages/](/Users/yongqian/Desktop/Vessel/packages/) 11 个 β 变更文件)：

| 越界检查 | 结果 | 证据 |
|---|---|---|
| Eva `byCwd` 改名 / `conversationsById` 引入 | ✅ 无 | [packages/frontend/src/store.ts](/Users/yongqian/Desktop/Vessel/packages/frontend/src/store.ts) 17 处 byCwd 全部沿用 (M1A-γ 才动) |
| Eva App.tsx 改动 | ✅ 无 | App.tsx 不在 β 11 文件清单 |
| iOS-native ([packages/ios-native/](/Users/yongqian/Desktop/Vessel/packages/ios-native/)) | ✅ 无 | β 0 改动 |
| MCP 接入 / permission router wiring | ✅ 无 | orchestrator [`tools: { get: () => null }`](/Users/yongqian/Desktop/Vessel/packages/backend/src/orchestrator.ts#L115) 仍 stub；index.ts vesselRuns handler 不调 permissionToken |
| Workflow Engine | ✅ 无 | orchestrator 单 promise loop 不变 |
| Soul prompt prefix 注入 | ✅ 无 | `systemPromptPrefix` 字段 [drivers/types.ts:42](/Users/yongqian/Desktop/Vessel/packages/backend/src/drivers/types.ts#L42) 仍 undefined |
| Voice ASR/TTS | ✅ 无 | β 不动 voice.ts |

β 严格只动 WS streaming 链路。**唯一可争议**点：`vessel_intent` 的 `conversationId`
字段 [protocol.ts:66](/Users/yongqian/Desktop/Vessel/packages/shared/src/protocol.ts#L66)
当前 backend 不消费（只接 `vesselSessionId`），仅"forward compat for γ"。这不是越界——
`conversationId` 与 `vesselSessionId` 1:1 在 β（β WS test 也没断言 conversationId 路由），
γ 才把它分开。**但 β 不消费的 client 字段也不应让 client 发**——
[index.ts:530](/Users/yongqian/Desktop/Vessel/packages/backend/src/index.ts#L530) 的解构
忽略 `conversationId` —— 客户端发了被静默丢弃。

**MINOR-1**：`conversationId` 是 γ 字段，β 应在 protocol 层保留但加 zod / 注释明确
"M1A-β IGNORES this field; arrives undefined or echoed back by γ"。当前注释
"M1A-γ uses; β allows for forward compat" 没说 backend 会丢，β 客户端误以为字段已
生效。修复 1 行。

### Q2: Trace sink 设计（v1+ OTEL exporter 耦合）：**MAJOR-1**

[trace-writer.ts:39-43](/Users/yongqian/Desktop/Vessel/packages/backend/src/observability/trace-writer.ts#L39-L43)：

```ts
class FileTraceWriter implements TraceWriter {
  constructor(
    private readonly current: TraceContext,
    private readonly sink?: (event: TraceEvent) => void,
  ) {}
  ...
  async write(event) {
    ...
    if (this.sink) {
      try { this.sink(safeEvent); } catch { /* sink errors must not fail trace write */ }
    }
  }
}
```

**正确部分** ✓：
- sink 在 redaction + spillover **之后** fire（line 78-80）→ "live stream and replay are
  byte-identical" 注释成立，π = π 不变量（GET /traces/:id 与 WS push 同 redaction 结果）
- try/catch 包住 sink，sink throw 不破坏 file write —— **fail-isolation OK**
- TraceEventSchema.parse 在 sink 之前跑（line 70）→ malformed event 不会过出墙

**有问题部分** ✗：

#### MAJOR-1: sink 是 1:1 字段而不是 listener-list / EventEmitter

`makeTraceWriter(ctx, { sink })` 一次只能挂一个 sink。当前 β 的设计假设：
"WS 每 runIntent 起一个新 trace writer，每 writer 配一个 ws.send sink"。
这在 β 是 **1 trace : 1 WS connection** 完美映射 —— OK。

但 v1+ 必撞：
- OTEL gRPC exporter（按 [trace.ts:8 v1+ 加 exporter 注释](/Users/yongqian/Desktop/Vessel/packages/backend/src/observability/trace.ts#L8)）
  需要 **同时**：file write + WS push + OTEL push
- M1B 加 permission router 后，permission denied event 还要 fan-out 到 audit log sink
- harness scheduler 想 subscribe trace 用作 task progress

到那时改法：**FileTraceWriter constructor 收 `sinks: ((e: TraceEvent) => void)[]`**
or **TraceWriter 暴露 `addSink(fn): unsubscribe`** 像 EventEmitter。当前的 1:1 sink 字段
要改成数组或 listener pattern，所有 caller (orchestrator.ts:78) 一起改。

**修复**：β 阶段把 sink 从单值改成 `sinks?: Array<(e: TraceEvent) => void>` ——
对 β 单 sink 用法是 0 行为变化（改 [trace-writer.ts:78-80](/Users/yongqian/Desktop/Vessel/packages/backend/src/observability/trace-writer.ts#L78-L80)
为 `for (const sink of this.sinks ?? []) try { sink(safeEvent); } catch {}`，
[orchestrator.ts:78-80](/Users/yongqian/Desktop/Vessel/packages/backend/src/orchestrator.ts#L78-L80)
传 `sinks: input.onTraceEvent ? [input.onTraceEvent] : []`），但 v1+ exporter 引入时
不需要重构 FileTraceWriter constructor —— 只是再 push 一个 sink 进数组。
**β 阶段免费修，v1+ 阶段省一次接口大改**。

**辅助理由**：sink 错误隔离 try/catch ✓（line 79 `catch { /* sink errors must not fail
trace write */ }`），但**没记日志**。生产环境 sink 死掉无声 → 看不到 WS push 失败
（如 ws.send 报 "Cannot send after close"）。建议至少 console.warn 一次。
归到 **MINOR-2**：sink throw 至少 console.warn(err, eventType, span_id) 一次。

#### 还可接受部分

- `safeEvent` 经 `TraceEventSchema.parse` 之后才 fire sink —— sink 收到的就是 schema
  合规对象，frontend 可以信任 `event.event_type` enum 值 ✓
- sink 同步执行（不 await）—— 不会 block file write 完成 ✓
- 没有 backpressure（sink 慢，trace.write 不等） —— 对 ws.send 是 OK 的（ws 自己缓冲），
  对 OTEL exporter 后期接入要重新评估

### Q3: WS protocol 字段 `event` / `message` 标 `unknown` 是否引入 schema bump 静默兼容：**MAJOR-2**

[protocol.ts:128-143](/Users/yongqian/Desktop/Vessel/packages/shared/src/protocol.ts#L128-L143)：

```ts
| {
    type: "vessel_trace";
    runId: string;
    vesselSessionId: string;
    event: unknown;                  // TraceEvent (kept opaque in shared to avoid backend type leak)
  }
| {
    type: "vessel_progress";
    runId: string;
    vesselSessionId: string;
    message: unknown;
  }
```

**正确部分** ✓：
- `event: unknown` 是为了不让 `@vessel/shared` 反向依赖 backend 的 TraceEventSchema —— 这是 **正确** 的依赖方向（shared 是 leaf package，protocol 不能拉 backend types）。
- frontend / iOS 拿到 `unknown` 时如果想用 typed 字段，自己跑 zod parse 或 narrow ——
  [vessel-panel.ts:159](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/vessel-panel.ts#L159)
  panel 直接 `msg.event.event_type / .component / .status` 没 narrow，是省事但**反映了
  client side 对 backend schema 的隐性依赖**。

**有问题部分** ✗：

#### MAJOR-2: trace event_type enum 演进时 frontend 静默兼容

[trace.ts:21-36](/Users/yongqian/Desktop/Vessel/packages/backend/src/observability/trace.ts#L21-L36)
`TraceEventSchema` 的 `event_type` 是 **closed enum**：

```ts
event_type: z.enum([
  'intent.received', 'skill.invoked', 'skill.completed',
  'permission.granted', 'permission.denied',
  'driver.spawned', 'driver.exited',
  'mcp.invoked', 'mcp.completed',          // ← M1B 才会真的 emit
  'workflow.paused', 'workflow.resumed',   // ← M1C 才会真的 emit
  'soul.loaded',                            // ← M2-Soul
  'capability.installed', 'capability.uninstalled',
])
```

M1B 引入 `mcp.invoked` 真实 emit 时 **不需要** 改 schema（已在 enum 内），**但** frontend
panel HTML 的 switch / display logic 不知道这俩 event_type 存在 —— 静默忽略 / 显示乱码。
M1C `workflow.paused` 同理。

更危险：**未来加新 event_type**（比如 `permission.escalated`, `agent.thinking`） →
TraceEventSchema 加值 = backend 侧合法，但 panel HTML / iOS / γ Eva App.tsx 拿到 `unknown`
没 schema discriminator，处理不到。

backend 引入新 event_type 是**事实上的 protocol bump**，但当前 protocol 没 version。

**修复**：
- (a) `vessel_trace.event` 在 protocol.ts 加 `eventTypeVersion?: 1` 或类似版本号 ——
  backend 加新 event_type 时升 1，frontend if `eventTypeVersion > supportedMaxVersion` →
  show "[unknown trace event v2 — update client]" fallback 而非 silent drop
- (b) 或更简单：在 ServerMessage 顶层加 `vessel_protocol_version` constant，frontend
  startup 拿 `/api/vessel/health` 时拉取 server 报告的 protocol 版本，mismatch 警告

**β 不强制做**，但 γ 之前必做（γ 会让 Eva 主 App.tsx 接 vessel_trace，那时再 silent drop
会让用户级 UX 坏）。归到 **MAJOR-2**，owner = M1A-γ。

**辅助 MINOR**：

#### MINOR-3: `vessel_progress.message` 是 `unknown` —— message_count 字段语义

[coding.ts:62-64](/Users/yongqian/Desktop/Vessel/packages/backend/src/skills/coding.ts#L62-L64)
artifact `message_count` 是从 driver metadata 取的；β 通过 `onProgress` 推 `vessel_progress`
但客户端**收到** message 数量不一定等于 metadata.message_count（有 redact 失败时
[cli-runner-driver.ts:120](/Users/yongqian/Desktop/Vessel/packages/backend/src/drivers/cli-runner-driver.ts#L120)
sink throw 静默吞掉）。

最终 `vessel_completed.result.message_count` 与 client 实际收到的 progress count
可能不等。**β 没人会注意**（test-vessel-ws-multi.ts 用 echo skill，message_count = 0），
但 coding skill 跑长任务 dogfood 时能掉 progress 而 metadata 还报 N。

修复：sink throw 至少 metric +1（或 console.warn —— 与 MINOR-2 同 fix）。

### Q4: 5 接口契约影响（SkillContext.onProgress 是否破坏 0B frozen contract）：**PASS（accept optional）**

#### 5 接口现状盘点

| 接口 | 文件 | β 改动 | 影响 |
|---|---|---|---|
| Agent | agent.ts | 无 | — |
| Skill | skill.ts | **加 `onProgress?: (m: unknown) => void`** | 见下分析 |
| Tool | tool.ts | 无 | — |
| Memory | memory.ts | 无 | — |
| App | app.ts | 无（AppManifest.schemaVersion 仍 1） | — |

#### SkillContext 加 onProgress 是 additive optional —— 不需要 schemaVersion bump

按 [ADR-006 §1](/Users/yongqian/Desktop/Vessel/docs/adr/vessel/ADR-006-schema-evolution.md)
"每个 schema 顶部加 schemaVersion … TS 接口：schemaVersion 字段"。但 `SkillContext`
**没有 schemaVersion 字段**，5 接口里只有 `AppManifest.schemaVersion`（capability app
manifest）使用。

ADR-006 是讲 **persisted schema**（YAML / SQLite / config.toml），**不直接管运行时 TS
interface**。运行时 TS interface 的演进规则隐含在 §4 "deprecated 字段保留 ≥ 1 个 minor
版本" + §5 "breaking change 仅跨 major" + ⚠️ "增订字段必须 nullable"。

`onProgress?:` 是 optional —— **现有 EchoSkill 不实现也不传 ctx.onProgress 完全 OK**
（[orchestrator.ts:111-122](/Users/yongqian/Desktop/Vessel/packages/backend/src/orchestrator.ts#L111-L122)
始终传 `onProgress: input.onSkillMessage`，HTTP 路径 input.onSkillMessage = undefined
→ ctx.onProgress = undefined → CodingSkill 也传 undefined → driver onMessage = undefined
→ 不 emit）。**纯 additive**。

M0.5 的 `abortSignal` 也是同模式加进 SkillContext 的（M0.5 retrospective 已记录），
就当时没争议没 bump schemaVersion。**β 沿用一致风格 ✓**。

#### 但有一处需要 retrospective 记一笔

[interfaces/skill.ts:43-46](/Users/yongqian/Desktop/Vessel/packages/backend/src/interfaces/skill.ts#L43-L46)
注释：

```ts
/** M1A-β: optional progress sink for streaming skills (e.g. CodingSkill forwards
 *  CC stream-json messages live to a WS client). Skills that don't stream just
 *  ignore this. Already-redacted form when invoked by the driver. */
onProgress?: (message: unknown) => void;
```

**MINOR-4**：注释里 "Already-redacted form when invoked by the driver" 是契约
关键 —— Skill 实现者可以信任 onProgress 收到的对象已脱敏。但这个契约**没 type-level
约束**：调用 `ctx.onProgress(rawCliMessage)` 在编译期不会被拦。如果 v1+ 出现
non-driver-mediated skill（直接生成 progress message 不经过 driver redact 路径），
潜在泄漏点。

修复：注释加 "**Skill MUST NOT call onProgress with raw / unredacted payloads** —— only
forward objects already through `redactPayload(...)` or driver-supplied messages"。
契约写 in code，将来 review 时能抓。

#### 不改 schemaVersion 的连带验证

- `AppManifest.schemaVersion` (app-schema.ts) 不动 ✓
- `MEMORY_SCHEMA_VERSION` (session-store.ts) 不动 ✓（β 不改 SQL schema）
- `TraceEventSchema` (trace.ts) **enum 不变** ✓（β 不加新 event_type）
- shared/protocol.ts ServerMessage discriminated union **加值不破现有客户端 narrow**（
  client `if (msg.type === 'sdk_message')` 不命中新 vessel_* type）

**结论：β 落地不需要 schemaVersion bump，optional onProgress 字段就够。**

## Out-of-focus findings

### MINOR-5: vesselRuns map 没 unbounded 增长保护（已 cap = 5 in handler，但 ws.close cleanup 是 abort）

[index.ts:540-543](/Users/yongqian/Desktop/Vessel/packages/backend/src/index.ts#L540-L543)
`vesselRuns.size >= 5` 阻止新 intent，但**已存在的 inflight runs**通过 finally
([line 577](/Users/yongqian/Desktop/Vessel/packages/backend/src/index.ts#L577))
`vesselRuns.delete(runId)` 清理 ——无泄漏 ✓。
ws.close handler ([line 596-597](/Users/yongqian/Desktop/Vessel/packages/backend/src/index.ts#L596-L597))
`for (const h of vesselRuns.values()) h.abort.abort(); vesselRuns.clear();` ——
但 abort 不等于 cleanup：abort 触发 orchestrator promise 走 finally / catch，
finally 又去 `vesselRuns.delete(runId)` ——**race**：clear() 先跑还是 delete() 先跑？

实际 ok：clear() 同步跑完后 delete 是 no-op；orchestrator promise 在 ws.close 之后
跑完抛 send() 给已关闭 ws 也不 throw（`ws.readyState !== ws.OPEN` 判断）。
但**注释里没说**，下次有人改 cleanup 顺序时会引入泄漏。

修复 retrospective 记一笔：**ws.close 是异步的（abort fan-out 不立即清空 map），
但 size cap 在 connection 关闭时已无意义**。

### MINOR-6: vessel_completed.vesselSessionId 可能为空字符串

[index.ts:567-569](/Users/yongqian/Desktop/Vessel/packages/backend/src/index.ts#L567-L569)：

```ts
send({ type: "vessel_completed", runId, vesselSessionId: handle.vesselSessionId, result });
```

`handle.vesselSessionId` 在 [line 545](/Users/yongqian/Desktop/Vessel/packages/backend/src/index.ts#L545)
默认 `""` (empty string) when caller 不传 vesselSessionId。client 收到
`{ type: 'vessel_completed', vesselSessionId: '' }` 没法关联到真正的 session id
（orchestrator 内部 bootSession 已生成新 id 但没回传给 handle）。

[test-vessel-ws-multi.ts:65-66](/Users/yongqian/Desktop/Vessel/packages/backend/src/test-vessel-ws-multi.ts#L65-L66)
test 中**始终**传 vesselSessionId（避开了这个 bug），所以 19 assertions 全过但没暴露问题。
β client（panel HTML）也没传 vesselSessionId（[vessel-panel.ts:177](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/vessel-panel.ts#L177)
`ws.send({ type: 'vessel_intent', runId, text, skill })` 不传 vesselSessionId） →
panel 收到的 `vessel_completed.vesselSessionId === ""` —— γ 时把 panel 替成 Eva App.tsx
要 `conversationsById[sessionId]` 查找，empty string 直接坏。

**修复**：trace event 已经携带真实 session_id（FileTraceWriter sink 是 post-redaction）
—— β 应在 onTraceEvent 第一次拿到 trace 时**回填** `handle.vesselSessionId`：

```ts
onTraceEvent: (event) => {
  if (!handle.vesselSessionId) handle.vesselSessionId = event.session_id;
  send({ type: "vessel_trace", runId, vesselSessionId: handle.vesselSessionId, event });
},
```

3 行 patch。归 MINOR-6，必须在 γ 之前修。

## Verdict

PASS-WITH-FIXES。

**Must close before M1A-β closeout retrospective**:

- 无 BLOCKER。

**Must close before M1A-γ implementation**:

- **MAJOR-1**：FileTraceWriter sink 改 `sinks: Array<...>` 或 listener pattern（β 阶段
  免费 5 行 patch；v1+ OTEL exporter 引入时省一次大改）。
- **MAJOR-2**：vessel_trace event_type 演进静默兼容 —— protocol 加 version 字段或
  `/api/vessel/health` 暴露 supported event_types 列表，γ 接 Eva 之前必做。
- **MINOR-6**：vessel_completed.vesselSessionId 当 caller 不传时为空 —— 用 onTraceEvent
  回填（panel + γ Eva 都依赖这个字段做 conversation 路由）。

**MINOR (defer to M1A-γ / M1B / retrospective)**:

- MINOR-1：protocol.ts `vessel_intent.conversationId` 注释明确 β 静默丢弃。
- MINOR-2：sink throw 至少 console.warn 一次（不静默）。
- MINOR-3：vessel_progress.message_count 与实际收到 progress 数量可能不等，与 MINOR-2 同 fix。
- MINOR-4：SkillContext.onProgress 注释加 "MUST NOT pass unredacted" 契约。
- MINOR-5：vesselRuns ws.close cleanup race 注释（不是 bug，是文档债）。

5 接口契约 SkillContext 加 optional `onProgress` 不需要 schemaVersion bump（与 M0.5
abortSignal 同 pattern）。落地总体干净；β 边界守得住，0 γ/M1B/M1C 越界。
两个 MAJOR 都是 v1+ / γ 时才会撞的演进债，β 阶段 5-10 行 patch 即可前置封堵 ——
比 v1+ 阶段大改省 10x effort。

---

## Stdout summary (≤200 字)

PASS-WITH-FIXES。0 BLOCKER + 2 MAJOR + 6 MINOR。
**β 边界 ✓**：无 γ/M1B/M1C/Soul/Voice/iOS 越界。MAJOR-1：FileTraceWriter sink 是 1:1 字段，
v1+ OTEL exporter 引入时被绑死接口；β 阶段 5 行改成 sinks 数组免费修。MAJOR-2：vessel_trace
event_type enum 演进时 frontend 静默兼容，γ 接 Eva 前必加 protocol version 或 health
报告 supported event_types。MINOR-6 隐藏 bug：vessel_completed.vesselSessionId 在 caller
不传时为空字符串，panel + γ Eva 路由会坏；用 onTraceEvent 回填 3 行 patch。
SkillContext.onProgress optional additive，不需要 schemaVersion bump（与 M0.5 abortSignal
同 pattern）；ADR-006 schemaVersion 管 persisted YAML/SQL，不管运行时 TS optional 字段。
