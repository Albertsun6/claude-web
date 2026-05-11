# M1A-α Phase 1 review — vessel-pragmatist

**Date**: 2026-05-10 02:40
**Reviewer**: vessel-pragmatist (Claude main session, lens: YAGNI / 守边界 / Eva 复用 / 个人单机)
**Scope**: M1A-α only (panel-first slice). β/γ explicitly out.
**Files inspected**:
- [packages/backend/src/routes/vessel-intent.ts](../../packages/backend/src/routes/vessel-intent.ts) (97 LOC)
- [packages/backend/src/routes/vessel-panel.ts](../../packages/backend/src/routes/vessel-panel.ts) (142 LOC, 129 of which are HTML body)
- [packages/backend/src/cli/vessel-core.ts](../../packages/backend/src/cli/vessel-core.ts) (235 LOC, +list / +trace replay)
- [packages/backend/src/test-vessel-http-concurrent.ts](../../packages/backend/src/test-vessel-http-concurrent.ts) (113 LOC)
- [packages/backend/src/memory/session-store.ts](../../packages/backend/src/memory/session-store.ts) (busy_timeout = 5000)
- [packages/backend/src/index.ts](../../packages/backend/src/index.ts) lines 35-118 (route wiring)
- [packages/backend/src/orchestrator.ts](../../packages/backend/src/orchestrator.ts) lines 38-69 (already exposes conversationId via trace ctx, predates α)

## Overall verdict

**PASS-WITH-FIXES**

α 没有偷塞 β/γ 字段。守边界做得相当干净。但有 3 处 MINOR 想看到收紧；都不阻塞 ship。

## 6 个 questions 各自结论

### Q1: α 是否偷塞 β/γ 字段？(panel HTML 有无 WS hook? CLI 有无 WS-related stub?)

**结论：没有。** 干净通过。

证据（grep `WebSocket|ws|conversation_id|conversationId|vesselSessionId|streaming` on `vessel-intent.ts` / `vessel-panel.ts` / `vessel-core.ts`）：
- `vessel-panel.ts`：只在 注释 写 "WS streaming (just polls runs list every 3s)" 标明 out-of-scope。HTML 内 0 处 `WebSocket(...)` / 0 处 SSE / 0 处 `conversationId`。
- `vessel-intent.ts`：HTTP route 接收 `{ text, sessionId, skill }` —— **没有** `vesselSessionId` / `conversationId` 字段（β 才加的）。
- `vessel-core.ts`：CLI 只有 list / trace replay 两个 M1A-α 子命令。无 WS client stub，无 `--conversation-id` flag。
- `orchestrator.ts:69`：`newRootContext({ conversationId: session.id, runId })` —— 这个 `conversationId` 在 M0.5 就存在了（trace context 字段，等价 sessionId），不是 α 偷塞。**OK**。

**唯一可挑剔的小点**：β review prompt 提到要新增 `vesselSessionId` 字段独立于 `resumeSessionId`。α 这版用 `body.sessionId` 直接喂 `runIntent.sessionId`。这意味着 β 接入时要么 (a) 重命名 `sessionId → vesselSessionId`（破坏现有 panel HTML / `test-vessel-http-concurrent` payload），要么 (b) 平行新增字段。建议 β 选 (b)，α 这版 `sessionId` 字段保持不动，避免回头改 α 工件。**不是 finding，是给 β 实施者的提醒。**

### Q2: 极简 panel HTML 是否过度（200+ vanilla JS vs React 路径）？

**结论：不过度。vanilla 是正确选择。**

- 实际 HTML body 129 行（包含 CSS + JS），全文件 142 行。比 200 行还少。
- React 路径成本：Vite 子页面 + 路由配置 + build pipeline + Eva App.tsx 污染。**proposal A-MINOR-2 已经明令"不污染 Eva 主 App.tsx"**，所以 React 路径要么需要独立 Vite entry（多 build target），要么塞 Eva App.tsx（违反 γ 边界）。两个都比 vanilla 重。
- 个人单机硬约束下，vanilla HTML 完美匹配："launch backend → 浏览器开 `/vessel/min/` → 看状态"。0 build step。
- 真要批评：HTML 长字符串没语法高亮，编辑体验稍差。但这换来"没有任何前端 build 依赖"，划算。

**通过，无 finding。**

### Q3: busy_timeout = 5000 是否合理？(2000ms 不够吗？5s UX 能接受吗？)

**结论：5000 是 over-engineered for personal-single-user，但成本零，所以放过。**

实际场景：CLI 与 backend HTTP 同时写 `memory.db`。每次写就是几条 INSERT，连接持有锁的窗口 < 1ms（better-sqlite3 同步 + 事务内 INSERT）。在个人单机：
- 真冲突概率：极低（用户不会同时 50 路并发 vessel-core CLI）。
- 冲突时阻塞实际时长：通常 1-10ms。busy_timeout 是**上限**不是常态。
- 5s 上限触发的场景：写方挂了、死锁、SQLite 内部异常 —— 这种情况 2s 还是 5s 都已经是 UX 灾难，差异不大。

但 5000 选值也不亏：
- M0.5 cli-runner 的 SIGTERM→SIGKILL grace 是 5000ms，与之对齐有"对称记忆点"价值。
- 减一秒到 4000ms 也救不了 UX。

**不改。无 finding。**

但如果 ship 后真观察到 5s 阻塞 UX 差，简单调到 2000ms。**这是配置值不是契约**。

### Q4: test-vessel-http-concurrent 的 5+5 规模是否合适？

**结论：合适，但有 1 处 MINOR 应该收紧。**

5 HTTP parallel + 5 CLI sequential 是合理 smoke test：
- 5 路足够触发 SQLite WAL writer 排队，不需要 50 路。
- CLI sequential（不是 parallel）规模已经够：每条 CLI 都是独立进程独立 DB connection，5 次串行就能跨 3 次 backend HTTP write 窗口，足够覆盖跨进程冲突。
- 整测试 ~6s（waitForBackend 10s budget + 5 CLI 串行 spawn ~5×0.8s）。CI 友好。

**[P-MINOR-1]** test 缺一个 negative-control assertion：busy_timeout 真的发挥作用吗？还是 5+5 太轻根本没冲突？建议在测试输出里多加一行 `console.log` 报告"max observed lock wait time"或简单"测了多少次 INSERT 期间 retry 了几次"。否则万一某天 better-sqlite3 升级把 busy_timeout 默默忽略了，这测试还是绿的。

**优先级**：MINOR，可 defer 到 β 时一并加（β 引入 WS 后冲突窗口更长，那时再补 retry-counter 更有意义）。**不阻塞 α ship**。

### Q5: CLI list / trace replay 是否绕过 Memory 接口偷塞 v1+ 抽象？

**结论：没有偷塞，但要确认 ADR-002 注释覆盖完整。**

- `cmdList`：直 SELECT `sessions` / `skill_invocations` / JOIN `intents`。  vessel-core.ts:82 注释明确写 "M1A stub — replaced by Memory interface in M1C-B per ADR-002"。✅
- `cmdTraceReplay`：直读 `~/.vessel/traces/<id>/*.json` 文件系统。**没有** ADR 注释。但 trace replay 在 plan v5.4 §observability 已经设计为"读取 trace 文件"，本身就是 file-based 的 read-side，不是 Memory 接口范畴。✅
- HTTP `/api/vessel/sessions` / `/api/vessel/runs`（vessel-intent.ts:57-81）：同样直 SELECT，**没有** 同款 ADR-002 注释。

**[P-MINOR-2]** `vessel-intent.ts` 的 `/sessions` 和 `/runs` handler 缺一行 ADR-002 stub 注释（CLI list 已有，HTTP 缺）。建议加：

```ts
// M1A stub — direct SELECT, replaced by Memory interface in M1C-B per ADR-002.
```

否则未来读 vessel-intent.ts 的人不知道这是 stub vs final API surface。文件头注释提到了"Out of scope: WS / Eva rewire / Auth"但没提"SELECT 是 stub"。**5 秒改完，建议在 α 内顺手补**。

### Q6: Eva 现有 routes (/api/runs / /api/sessions) 是否需要 deprecation 标记？

**结论：暂不打 deprecation 标记。** 但要在文档/索引中明示语义边界。

理由：
- 两套路由**语义完全不同**（已检查代码）：
  - Eva `/api/runs`：cli-runner subprocess 进程注册表（active runs + interrupt by runId）—— 服务于 Eva frontend WS clients。
  - Vessel `/api/vessel/runs`：memory.db 的 `skill_invocations` 历史持久化记录。
- Eva `/api/runs` 在 γ 完成时**不会消失** —— Eva frontend 仍会用它（Vessel 替不了 cli-runner 进程注册表本身的功能）。"deprecate" 是错的语义。
- 真正的 deprecate 时机：M1B/M2 时 Eva frontend 接 Vessel orchestrator → /api/vessel/* 后，Eva 老 chat WS protocol 才考虑 deprecate（也只是 HTTP 部分，cli-runner 进程注册表估计永远在）。
- arbiter 已说"Eva 老路由 γ 时再 deprecate"，α 时机太早。

**[P-MINOR-3]** 但建议 α 内做一件极小事：在 `vessel-intent.ts` 的文件头注释加一行：

```ts
// Note: Eva also has /api/runs (cli-runner registry) and /api/sessions (jsonl history).
// Different semantics; namespace `/api/vessel/*` ensures isolation. No deprecation in M1A-α.
```

避免后续 reviewer / 新会话搞混。这条已经在 vessel-intent.ts:5-7 部分提到过，但叙述偏 review 视角，不直接告诉新读者"Eva 那边还有"。**可选**。

## 反提案 / 替代方案

无。α 的工件结构（vanilla HTML + 4 routes + CLI subcommand + 1 integration test）**精度刚好**。pragmatist 没有更小的切法可以提议；没有 over-design 可以砍。

## findings 汇总

| ID | 严重度 | 描述 | 建议动作 |
|---|---|---|---|
| P-MINOR-1 | MINOR | test-vessel-http-concurrent 缺 negative-control（busy_timeout 真起作用？） | defer 到 β 一起补 |
| P-MINOR-2 | MINOR | vessel-intent.ts `/sessions` `/runs` handler 缺 ADR-002 stub 注释（CLI list 已有，HTTP 漏） | α 内顺手补，~30 秒 |
| P-MINOR-3 | MINOR (optional) | vessel-intent.ts 文件头注释可加一句明示 Eva /api/runs 不同语义 | 可选 |

无 BLOCKER，无 MAJOR。

## 总结（≤200 字）

**PASS-WITH-FIXES（3 MINOR）**。M1A-α 守边界优秀：panel HTML 全无 WS / conversationId 字段；CLI 无 β stub；orchestrator 的 `conversationId` 是 M0.5 既有 trace 字段不算偷塞。vanilla 129 行 HTML 比 React 路径更 fits 个人单机。busy_timeout=5000 over-engineered 但零成本接受。MINOR-1：concurrent test 缺 negative-control 验证 busy_timeout 真起效，可 defer β。MINOR-2：vessel-intent.ts 的 /sessions /runs 缺 ADR-002 stub 注释（CLI list 已有，HTTP 漏一致性），30 秒补。MINOR-3：可加一行注释明示 Eva /api/runs 语义不同避免后续混淆。Eva 老 routes 不打 deprecation（语义不同，γ 时也不会消失）。立即 ship α，4-way review 后进 β。
