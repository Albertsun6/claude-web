# M1A-β Phase 3 arbiter verdict — 2026-05-10 03:20

## Phase 1 inputs (4 reviewers)

| Reviewer | Verdict | BLOCKER | MAJOR | MINOR | File |
|---|---|---|---|---|---|
| vessel-architect | PASS-WITH-FIXES | 0 | 2 | 6 | [`p1-architect`](M1A-beta-review-p1-architect-2026-05-10-0320.md) |
| vessel-pragmatist | PASS-WITH-FIXES | 0 | 1 | 3 | [`p1-pragmatist`](M1A-beta-review-p1-pragmatist-2026-05-10-0320.md) |
| vessel-risk-officer | **NOT-YET-PASS** | 4 | 2 | 2 | [`p1-risk-officer`](M1A-beta-review-p1-risk-officer-2026-05-10-0320.md) |
| cursor cross | NOT-YET-PASS | 1 | 3 | — | [`cross`](M1A-beta-review-cross-2026-05-10-0320.md) |

## 异质性确认 ✅ 第 10 次 cursor + Claude 互补

- risk-officer + cursor 收敛于 **同一类 BLOCKER**：M1A-β WS 路径绕过 M1A-α 修过的 path leak fix（artifact_refs 漏 home dir 绝对路径 + AgentResult.artifact 漏 home dir）—— 这是 M1A-α 同形 bug 的 surface 复现
- risk-officer 独家：process-wide concurrency cap missing + WS maxPayload 100MB
- architect 独家：FileTraceWriter sink 1:1 对 v1+ multi-sink 不友好 + trace event_type closed enum 对 M1B/M1C 演进静默 drop
- pragmatist 独家：vessel_progress + SkillContext.onProgress 0 production caller，质疑 surface creep

**关键洞察**：M1A-α closeout 修过的 path leak fix 在 M1A-β 引入 WS 第二条 surface 后又破了。**新 surface 就要 inherit 旧 fix；如果 fix 在 surface-specific 文件 (vessel-intent.ts 的 relativizePath) 里，新 surface 必漏抓**。教训：把 fix 推到尽量靠近数据生成的层（trace-writer 而非 HTTP route）。

## 4 档分类矩阵

### ✅ 接受（已 fix in this commit）

| Finding | Source | 修复 | 验证 |
|---|---|---|---|
| **BLOCKER R-M1Aβ-2 + cursor BLOCKER**: vessel_trace.event.artifact_refs 漏绝对 home dir | risk-officer + cursor | trace-writer.ts: 在 safeEvent 构建期把 artifact_refs 中所有 DATA_DIR-prefixed paths 替换成 `$VESSEL_DATA_DIR/...`。所有 sink consumer (HTTP + WS) 都看 relative form | code review；后续 spillover 测试覆盖 |
| **BLOCKER R-M1Aβ-3**: vessel_completed.result 漏 AgentResult.artifact home dir | risk-officer + cursor | index.ts WS handler 用 `redactAgentResult(result)` 包 result（与 M1A-α HTTP 同源）；export from vessel-intent.ts | code review |
| **BLOCKER R-M1Aβ-1**: 跨 connection 绕过 5/conn 上限 | risk-officer | 加 process-wide `vesselTotalInflight` counter (cap 8)；429 拒绝；finally 必 decrement | code review |
| **BLOCKER R-M1Aβ-4**: WS maxPayload 默认 100MB | risk-officer | `new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })` | WS 单 frame 超过 64K 立即 close ws |
| **MAJOR architect MINOR-6 + cursor MAJOR**: vesselSessionId="" 回填 | architect + cursor | onTraceEvent 第一次 fire 时若 handle.vesselSessionId 空，从 event.session_id 回填 | code review |
| **MINOR P-MINOR-2**: panel reconnect 无限 spam | pragmatist | 加 max 5 retries + 1008 (auth fail) 立即停 + 指数退避 | code review |

### ⚠️ 部分接受（defer with reasoning）

| Finding | Source | 决策 | Why |
|---|---|---|---|
| **MAJOR architect-1**: FileTraceWriter sink 1:1 → v1+ multi-sink 撞 | architect | **Defer to v1+** | M1A-β 唯一 caller 是 orchestrator → WS。pragmatist 也判 PASS（callback form 是最轻形）。改 `sinks: Array` 是 5 行但当前只 1 个 sink，YAGNI。引 OTEL exporter 时再做 |
| **MAJOR architect-2**: vessel_trace.event_type closed enum vs M1B/M1C 新事件 | architect | **Defer to M1B**: 真添 `mcp.invoked` 时一次性扩 event_type enum + protocol version | β 阶段 14 个 event_type 已涵盖 M1A 用例 |
| **MAJOR R-M1Aβ-5**: vessel_progress.message 无 size cap + 无 backpressure | risk-officer | **Defer to M1B**：M1A-β 唯一 caller 是 FakeCodingDriver fixture.messages（小）；真 CC stream-json 接入是 M1B 范围 | M1A-α 已 cap text=32K + concurrency=5 + WS frame=64K 多重防护 |
| **MAJOR cursor-3**: async sink rejection (Promise) try/catch 漏 | cursor | **Defer to v1+**：sink 当前都是 sync function；async 是 forward-compat 没 caller | doc note 加在 trace-writer.ts |
| **MINOR architect-2**: console.warn 一次 sink 错误 | architect | M1A-β 加日志 (1 行) | now or β |
| **MINOR architect-3+4**: vessel-runs cap docstring + protocol cheatsheet doc | architect | doc work，留 M1A-γ 一并 | M1A-γ |

### 🚫 反驳

| Finding | Source | 反驳理由 |
|---|---|---|
| **P-MAJOR-1**: 删 vessel_progress + SkillContext.onProgress（0 production caller） | pragmatist | **反驳。Pragmatist 漏看 FakeCodingDriver fixture.messages → ctx.onMessage 链路 (drivers/fake-coding-driver.ts 已激活)**。CodingDriver 真 CC 路径也激活 (cli-runner-driver.ts onMessage 转发 redactPayload)。删了 M1B 必加，是 LIFO debug 浪费。**保留**，加 comment "M1B 起 CC stream-json 实流接入" |

### 🟡 挂起

无。

## Phase 3 行动汇总

- ✅ 修 4 BLOCKER（path leak relativize at trace-writer / process cap / WS maxPayload / vesselSessionId backfill）
- ✅ 修 1 MAJOR + 1 MINOR (panel reconnect)
- ⚠️ Defer 4 MAJOR + 3 MINOR （含 owner+截止）
- 🚫 反驳 1 MAJOR (vessel_progress 删除提议)
- ✅ tsc clean / 19 assertion WS test 全过 / shared 123 / coding-driver 13 / vessel-http 5

## 制度性教训

> **M1A-α 修过的 path leak fix 在 M1A-β 又出现** —— 因为 fix 写在 surface-specific 文件 (HTTP route 的 relativizePath)。新 surface 必漏抓。
>
> **新原则**: redaction / sanitization 类 fix 必须放在**数据生成层**（trace-writer / driver / orchestrator），不放在**消费层**（HTTP route / WS handler / CLI output）。多消费层时所有 surface 自动继承 fix。

要把这条加进 plan 工程方法论原则。

## 决策

✅ **M1A-β 验收通过**（修 4 BLOCKER + 1 MAJOR after Phase 3 arbitration）。可进 Verify Gate → M1A-γ（Eva App.tsx rewire — 复杂度高，cursor C-MAJOR-1 已 flag）。
