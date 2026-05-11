# M1A-β Phase 1 review — vessel-pragmatist

**Date**: 2026-05-10 03:20
**Reviewer**: vessel-pragmatist (Claude main session, lens: YAGNI / 守边界 / Eva 复用 / 个人单机)
**Scope**: M1A-β only (WS multi-conversation parallel slice). γ (Eva frontend rewire) explicitly out.
**Files inspected**:
- [packages/shared/src/protocol.ts](../../packages/shared/src/protocol.ts) lines 55-156 (vessel WS family — 2 ClientMessage + 4 ServerMessage)
- [packages/backend/src/index.ts](../../packages/backend/src/index.ts) lines 339-600 (vesselRuns map + handlers)
- [packages/backend/src/orchestrator.ts](../../packages/backend/src/orchestrator.ts) lines 38-120 (onTraceEvent / onSkillMessage hooks)
- [packages/backend/src/observability/trace-writer.ts](../../packages/backend/src/observability/trace-writer.ts) lines 39-100 (FileTraceWriter sink param)
- [packages/backend/src/interfaces/skill.ts](../../packages/backend/src/interfaces/skill.ts) lines 35-47 (SkillContext.onProgress)
- [packages/backend/src/routes/vessel-panel.ts](../../packages/backend/src/routes/vessel-panel.ts) lines 128-180 (WS reconnect)
- [packages/backend/src/test-vessel-ws-multi.ts](../../packages/backend/src/test-vessel-ws-multi.ts) (133 LOC, **8 assert calls** — see Q6)
- [packages/backend/src/run-registry.ts](../../packages/backend/src/run-registry.ts) (Eva runs registry — for Q4)

## Overall verdict

**PASS-WITH-FIXES**

实施基本守边界。**用户 prompt 说 "19 assertions"，实际代码只 8 条 assert** —— 这点先标注，要么 prompt 数错了，要么有其他 test 文件没找到（grep 全包未发现别的 ws-multi test）。基于实际 8 条 assert 评。下面 7 个问题：3 PASS + 2 MINOR + 1 MAJOR (vessel_progress 字段) + 1 MINOR-NIT。

## 7 个 questions 各自结论

### Q1: WS protocol 6 个 message type 是否过度？4 个 server 消息是否真都需要？

**结论：3 个真需要 (trace/completed/error)；vessel_progress 是 [P-MAJOR-1]**。

实际数：2 ClientMessage (`vessel_intent` / `vessel_cancel`) + 4 ServerMessage (`vessel_trace` / `vessel_progress` / `vessel_completed` / `vessel_error`) = 6。

逐个核：
- `vessel_intent` ✅ 必需 (entry point)
- `vessel_cancel` ✅ 必需 (β scope 含取消，index.ts:524 已实装；不放到 v1+ 是合理的，因为 abort 链路一旦不在 β ship，β-test 跑长 coding skill 都没法 ctrl-c)
- `vessel_trace` ✅ 必需 (β acceptance 明令 "trace 时间线 ≥ 3 路独立 stream")
- `vessel_completed` ✅ 必需 (载 `AgentResult` 终态)
- `vessel_error` ✅ 必需 (`vessel_completed.result` 是 success path；error path 单独 message 是合理 narrow contract，比让 client `if result.status === 'failed'` 解构更清晰)
- `vessel_progress` ❌ **β scope 内永远不发**。

**关键证据**：β acceptance test 的 skill 是 `'echo'`（test-vessel-ws-multi.ts:74）。EchoSkill 不调 `onProgress`（它是同步返回 artifact，无 streaming）。整个 M1A-β 测试套里 0 处验证 `vessel_progress`。protocol.ts:138 注释自己写 "Stream-json line from Coding driver" —— 这是 γ/M1B 的 CodingSkill 才用得上的。

**P-MAJOR-1**：`vessel_progress` 在 β 实质零调用 → 是 **forward-compat 字段**，违反 YAGNI 与 "严守边界 先不做复杂的"。三个修法任一：
1. **首选**：β 删 `vessel_progress`，连同 `SkillContext.onProgress`（见 Q2）、`orchestrator.ts:119` 的 `onProgress: input.onSkillMessage` 透传、`index.ts:559` 的 `onSkillMessage` callback。M1B/γ 接 CodingSkill streaming 时再加，那时一并加 schema + handler + test，带语境。删除约影响 ~12 行，且没人 break（无 caller）。
2. 次选：保留但加注释 `// γ/M1B: forwarded by CodingSkill stream-json; M1A-β unused`。但这就是用户想避免的"先做一点试一下"。
3. 不修：等 M1B 时大概率删掉重写（streaming protocol 的实际形状要看 CC stream-json 真实 line shape，现在猜的字段名可能不对）。

**推荐选 1**。删的成本现在最低，越往后改 `SkillContext` 这种 frozen-ish 接口越疼。

### Q2: SkillContext.onProgress 是否偷塞 v1+ 抽象？

**结论：是。[P-MAJOR-1] 同源**。

M0.5 closeout 把 `SkillContext` 当 frozen-ish 看，仅 risk-officer 同意加 `abortSignal`（明确 NFR-F1 5s 强需求）。`onProgress` 加进来的理由是给 β `vessel_progress` 喂数据，但既然 β 不发 `vessel_progress`（Q1），`onProgress` 就是裸的 surface creep。

interfaces/skill.ts:46 注释自己说 "Skills that don't stream just ignore this" —— β 唯一 ship 的 EchoSkill 就是不 stream 的那个 ✅。**唯一会 stream 的 CodingSkill 不在 β scope**（β acceptance 用 echo，不用 coding：test-vessel-ws-multi.ts:74）。

**修法**：随 Q1 一并删。或保留但**绝不在 β 接 CodingSkill→onProgress 真实管线**（避免边界泄漏到 γ）。

**Note**：如果 architect / risk-officer 提出 "onProgress 在 β 加进来比 γ 急刹车塞进来更稳" —— 这是合理反方观点。但用户原话"先不做复杂的"+ "严守边界" 倾向 pragmatist 立场。最终 arbiter 判。

### Q3: FileTraceWriter sink 是否过度通用化？

**结论：可接受 + 1 MINOR**。

trace-writer.ts:39-43 的 `sink?: (event: TraceEvent) => void` —— 是 callback hook 而不是 generic interface，已经是最朴素的形式。M1A-β 唯一 caller 是 orchestrator → WS push（orchestrator.ts:79）。固定字段（`sink: TraceEventSink` 类型 alias）vs callback 之间没有实质差别，callback 反而更 light。

**通过点**：trace-writer.ts:78-80 的 try/catch — "sink errors must not fail trace write" 是真实考虑。如果 sink 是 require-pass interface，这里反而需要 wrap 一层 noop。callback 形态足够。

**[P-MINOR-1]**：sink 当前只在 `FileTraceWriter` ctor 设置，不能 mid-stream attach。M1A-β 没人需要 attach late，但 γ 可能想"先 boot trace writer 再开 WS"。**不改**。如果 γ 真要 mid-attach 再扩 setSink。**当前形态对 β 刚好**。

### Q4: vesselRuns 单独 map 是否过度（能否复用 Eva runs map）？

**结论：单独 map 是对的**。pass。

Eva 的 `runs: Map<string, RunHandle>` 持 `{ abort, permissionToken, unregisterPermission }` —— 字段强绑定 Eva CLI permission flow（PreToolUse hook）。Vessel orchestrator 走的不是 hook 链：
- 它通过 abort signal 取消 (M0.5 已确立)
- 它**不 register permission channel**（Vessel runs 不走 Eva 的 `/api/permission/ask` 路径；index.ts:475 的 channel 只为 user_prompt 路径建）
- 它产出 trace events / AgentResult，不产出 sdk_message stream

如果硬塞进同一 `runs` map：
- (a) `RunHandle` 字段可选化（permissionToken / unregisterPermission 变 optional），整个 map 类型膨胀，permission_reply / interrupt 处理（index.ts:367-389）要加 `if (handle.permissionToken)` 分支，noisier。
- (b) Vessel runs 借用 Eva permission token（无意义占用），更糟。

**单独 map (`vesselRuns`) 反而是低耦合**。命名 + 注释（index.ts:353-356）已经表明意图。close handler (index.ts:595-597) 也清得干净。**保留**。

### Q5: panel WS reconnect (setTimeout(connectWS, 2000)) 是否提前做了不该做的弹性？

**结论：[P-MINOR-2]，弱 fix 推荐**。

vessel-panel.ts:139 `ws.addEventListener('close', () => { ...; setTimeout(connectWS, 2000); });`

权衡：
- **支持保留**：panel 是开发调试工具，每天跑 + 后端可能 tsx watch restart（CLAUDE.md 提到 watcher 重启会断 WS）。如果不重连，每次 backend 改代码用户都要 F5。开发体验差。
- **支持删除**：本切片明令"试用阶段，让连接失败 fail-loud" —— 静默 setTimeout 重连掩盖了 backend 死掉/认证错乱。当前实现：close 后无限循环重试，2s 一次，永不放弃。如果 token 过期或 backend 退出，panel 会 silent 一直试。

**当前最严重问题**：reconnect 不区分 close reason。401 (authError) 和正常 close 都触发重连 → 401 时无限 reconnect spam server。

**推荐 [P-MINOR-2]**：
- (a) 加最大重连次数（5 次后停 + 显式 "disconnected, reload page"）
- 或 (b) 在 `ws.onclose` event 检查 `event.code === 1008` (auth) → 不重连
- 或 (c) 简单接受现状但加 console.warn 让用户至少看得到

**不阻塞 ship**。panel 是 dev panel，不是产品 UI；最大重连风险是日志 spam，不影响 β acceptance。但 (a) 5 行代码，建议补。

### Q6: integration test 19 assertions 是否过度？

**结论：用户说 19，实测 8**。需要先核对计数。

`grep -c "assert(" test-vessel-ws-multi.ts` = **8**。逐一看（test-vessel-ws-multi.ts:52,94,100,103,106,108,118）：
1. `backend reachable` — 必需
2. `run completed` × 3 (3 conn loop) — 必需
3. `wrongRoute.length === 0` × 3 — **β 核心 acceptance：不串路由**
4. `traceEvents.length >= 1` × 3 — β acceptance "≥ 3 路独立 stream"
5. `vessel_completed got` × 3
6. `vessel_completed carries correct vesselSessionId` × 3
7. `session persisted in memory.db` × 3 — 持久化验证

总 (3 conn × ~6 assertion + 1 ready) = 约 19 condition fired，**但 source 只有 8 个 assert call**（loop 内 fire 多次）。所以 prompt 的 "19" 估计是 condition 数，不是 source line 数。

**可裁项**：
- 持久化 (loop 7) 可裁 → α 已经测了 SQLite 写入路径；β 是 WS routing slice，重测 DB 持久化 = 重叠覆盖。**[P-MINOR-3] 弱推荐裁**，省 4 行代码 + 1 个 fetch round-trip。
- traceEvents ≥ 1 是 acceptance 核心，不能裁。
- wrongRoute === 0 是核心，不能裁。
- vesselSessionId carry-forward (loop 6) 是 contract 关键，不能裁。

**总评**：8 assert / 3 conn × 6 condition 不算过度，是合身的 acceptance 翻译。**不改也接受**。如要裁就只裁 loop 7（DB 持久化重叠 α）。

### Q7: 5 个 ID (vesselSessionId / conversationId / runId / trace_id / span_id) clearer or noisier?

**结论：noisier，但只能咬牙接受。[P-NIT]**。

逐个看是否真不可缺：
- `runId` ✅ 客户端 → server 路由的 token (per-conn)；删不掉
- `trace_id` / `span_id` ✅ OTEL 标准 + α/M0.5 已 ship；删不掉
- `vesselSessionId` ✅ memory.db 实际 session 主键（多次 intent 同一 session）；删不掉
- `conversationId` ⚠️ **β scope 内 1:1 等于 vesselSessionId**（protocol.ts:58 自己说："both 1:1 in M1A-β"）。γ 才会 1:N 化（一个 conversation 多个 vessel sessions OR 反过来）。

**分歧点**：γ 会用，所以 β 加上是 forward-compat。这和 Q1 的 vessel_progress 表面相似但实质不同——`conversationId` 在 β 是 **optional** 字段（protocol.ts:66 `conversationId?: string`），server 端 index.ts:530 解构时没读它，**真的零成本占位**。

**不删 conversationId 的理由**：
- γ 紧跟 β 后做（不是 v1+ 那种远期）
- β 删了 γ 又要加，且要协调 client/server 同步升级，破坏现有 panel + test 的协议兼容性
- 当前 zero-cost optional

**[P-NIT]**：5 个 ID 同时存在确实噪声。protocol.ts:55-60 的注释做得好，但建议在 README / docs/HARNESS_DATA_MODEL.md 加一张 ID-身份图（cheatsheet）：

```
runId        client→server WS routing (per-prompt)
vesselSessionId  memory.db 持久 session (多 intent 串)
conversationId   UI tab identity (γ 才 1:N)
trace_id     OTEL，跨多 run 同 trace
span_id      OTEL 树节点
```

**优先级 NIT**，不阻塞。

## findings 汇总

| ID | 严重度 | 描述 | 建议动作 |
|---|---|---|---|
| **P-MAJOR-1** | **MAJOR** | `vessel_progress` 与 `SkillContext.onProgress` 在 β 零调用 → forward-compat surface creep | β 内删 (vessel_progress message + onProgress 字段 + orchestrator 透传 + index.ts 559)；M1B 接 CodingSkill 时一并加 |
| P-MINOR-1 | MINOR | sink 不可 mid-stream attach | 不改 (β 不需要) |
| P-MINOR-2 | MINOR | panel WS reconnect 不区分 close reason → 401 也无限重连 | 加 max retry 或检查 close.code 1008 |
| P-MINOR-3 | MINOR | test loop 7 (DB 持久化) 与 α 测试重叠 | 弱推荐裁；不裁也接受 |
| P-NIT | NIT | 5 个 ID 概念噪声 | 加 ID cheatsheet 到 docs |

无 BLOCKER。**P-MAJOR-1 不阻 ship，但强烈推荐在 β-merge 前修**（deferring 它就是把 surface creep 当 ship 的一部分接受了，正好违反用户最近一句指示）。

## 反提案 / 替代方案

**delete vessel_progress + onProgress 的极简 β**（per P-MAJOR-1）：
- M1A-β = 5 message type (2C/3S)，不是 6
- SkillContext 仍 frozen-ish (M0.5 + abortSignal only)
- 等 γ 或 M1B 真接 CodingSkill streaming 时一并加 streaming surface，连带 vessel_progress schema + handler + 真实 stream-json shape 测试。
- 节省 LOC：~12 行

**panel WS reconnect 极简版**：3 次后停（5 行 patch）。

无大改架构反提案。整体方向对。

## 总结（≤200 字）

**PASS-WITH-FIXES (1 MAJOR + 3 MINOR + 1 NIT)**。M1A-β WS routing slice 守边界主体合格：vesselRuns 单独 map 是对的（避免 Eva permission flow 字段污染）；FileTraceWriter sink callback 形态足够轻；test 8 assert 不算过度。**P-MAJOR-1：vessel_progress + SkillContext.onProgress 在 β 实质零调用 (EchoSkill 不 stream，CodingSkill 不在 β)，是给 M1B/γ 占位的 surface creep，违反"严守边界 先不做复杂的"。建议 β-merge 前删，~12 行；M1B 接真实 stream-json 时一并加** schema + handler。MINOR：panel WS 不区分 401 close 会无限 spam reconnect，建议 max retry 5 次。NIT：5 个 ID 噪声，加 cheatsheet 缓解。conversationId 占位虽然也是 forward-compat 但 zero-cost optional + γ 紧跟、可接受。8 assert (用户说 19) — 实测源是 8 个 assert call，loop 触发 ≈ 19 condition；不算过度，只 loop 7 的 DB 持久化与 α 重叠可裁。
