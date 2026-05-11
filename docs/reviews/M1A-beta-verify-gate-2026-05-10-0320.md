# M1A-β Verify Gate — 2026-05-10 03:20

> 5 项必做。**结果**：✅ **5/5 全过**（修完 4 BLOCKER + 1 MAJOR after Phase 3）。

## ✅ Gate 1: Finding 闭环

| 类型 | 数量 | 处理 |
|---|---|---|
| BLOCKER | 4 (≥2 reviewer convergent: 2; risk-officer 独家: 2) | 全部 fixed |
| MAJOR | 8 | 1 fixed / 6 deferred / 1 反驳 |
| MINOR | 11 | defer |

[Phase 3 arbiter](M1A-beta-review-p3-arbiter-2026-05-10-0320.md)。

## ✅ Gate 2: 修复落地

| Fix | 路径 | 验证 |
|---|---|---|
| Path leak (artifact_refs 相对化) | `observability/trace-writer.ts` build safeEvent 时 relativize | code review；M1A-α HTTP test 仍 pass |
| Path leak (vessel_completed result) | `index.ts` 用 `redactAgentResult(result)` | code review |
| Process-wide concurrency cap | `index.ts` `vesselTotalInflight` ≤ 8 | code review |
| WS maxPayload | `WebSocketServer({ maxPayload: 64*1024 })` | code review |
| vesselSessionId backfill | onTraceEvent 第一次 fire 回填 handle | code review |
| Panel reconnect | 1008 stop / 5 max retries / 指数退避 | code review |

## ✅ Gate 3: 回归测试

```
pnpm --filter @vessel/backend exec tsc --noEmit  # exit 0
pnpm --filter @vessel/shared test                # 123 tests pass
pnpm --filter @vessel/backend test:coding-driver # 13 assertions pass
pnpm --filter @vessel/backend test:vessel-http   # 5 assertions pass
pnpm --filter @vessel/backend test:vessel-ws     # 19 assertions pass (3-way cross-route 0)
```

## ✅ Gate 4: 链接完整性 + Doc 一致性

- M1A-β proposal / arbiter / 4 Phase 1 verdicts / Phase 3 arbiter / Verify Gate 全部链路存在
- shared/protocol.ts 加 6 vessel_* 消息（2 Client + 4 Server）
- trace-redaction-spec §3a/§4 由 trace-writer 集中实施（不在 HTTP / WS handler 重复）

## ✅ Gate 5: 调研引用

M1A-β 是 [accepted M1A-slicing proposal](M1A-slicing-proposal-2026-05-10-0210.md) 的实施段，**非新决策**。

## 🚫 Escalation triggers

无：
- ❌ 4 软触发（无 decision-required / 无 unresolved disagree / Verify Gate pass / cursor closeout 已跑）
- ❌ 4 硬触发：
  - secrets：path leak 4 处 fix 集中在 trace-writer / index.ts 的 redactAgentResult；redactor 子树 force-mask 仍生效
  - license：M1A-β 引入 `ws` 的 client 端用 (test only `ws` package 已是 backend deps)，无新依赖
  - CVE：无
  - 破坏性数据迁移：M1A-β 不动 schema

## 制度性教训新增（待加 plan 工程方法论原则）

> **Redaction / sanitization fix 必须放在数据生成层，不放在消费层**。多消费层时所有 surface 自动继承 fix；放消费层会让"新 surface 漏抓旧 fix"成必然事件。M1A-α path leak fix → M1A-β WS surface 重新泄漏，正是这条规则被违反的 case。

## 决策

✅ **M1A-β 验收通过**。M1A-α + M1A-β 完成 = 用户已能在 panel 看 dozens of conversations 并发 + WS 实时 trace stream + CLI/HTTP/WS 三入口共享 session_id。

下一步选项：
- **M1A-γ**: Eva App.tsx rewire（cursor C-MAJOR-1 已 flag — **复杂度高**，11 文件 / 107 cwd 引用 / localStorage migration / 双层身份模型；用户曾说"先不做复杂的"）
- **暂停 M1A，进 M1B**: MCP + permission 边界（解锁 Tool 接 filesystem / web 等，让 coding skill 真有"工具箱"）
- **暂停 M1A，进 M1C-A**: Workflow Engine（HITL 持久化，让你有"长跑工作流" — 接近用户"几十个 agent 同时工作"诉求）

## debate-review log entry

```json
{"date":"2026-05-10","planFile":"/Users/yongqian/Desktop/Vessel/docs/reviews/M1A-beta-*","totalClaims":17,"accepted":6,"partial":7,"rejected":1,"hung":0,"biggestInsight":"第 10 次 cursor + Claude 互补：M1A-α 修过的 path leak fix 在 M1A-β WS surface 又出现。制度性规则：redaction/sanitization fix 必须放数据生成层 (trace-writer/driver/orchestrator)，不放消费层 (HTTP route/WS handler/CLI)。M1A-α 当时把 fix 放消费层 = 新 surface 必漏","biggestMistake":"实施 M1A-β 时复用 trace event 但没意识到原 fix 在 HTTP route 文件，WS sink 路径绕过；4-way review 后 risk-officer + cursor 同形抓出","newPrinciplesAdded":1,"newRisksAdded":0,"reviewerSkippedQuestions":[],"counterChallenges":["pragmatist 提议删 vessel_progress + SkillContext.onProgress (0 production caller) 被反驳: FakeCodingDriver fixture.messages → ctx.onMessage 已激活；CC 真路径 cli-runner-driver.ts 也激活；删了 M1B 必加是 LIFO 浪费"],"contract":"M1A-β 4-way closeout","mechVersion":"v2-lite"}
```
