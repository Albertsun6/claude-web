# vessel-architect Phase 1 verdict — M1A-α closeout (2026-05-10 02:40)

Reviewer: vessel-architect (Claude main session, opus-4.7-1m)
Scope: M1A-α 实施完成 closeout 4-way review。架构 / 模块边界 / 长期演进 / 5 接口契约 lens。
B-级 review 已修的 5 MAJOR 全部到位（namespace 隔离 / γ 双层身份模型 / β 协议字段 /
busy_timeout=5000 / sub-acceptance 表）—— 本轮只关心**实施落地**是否引入新债。

## Summary

- **Overall**: **PASS-WITH-FIXES**（一处 BLOCKER：panel HTML 在 VESSEL_TOKEN 模式下 100% 不可用；
  一处 MAJOR：HTTP intent 同步契约会绑死 β 重构面）
- **BLOCKER count**: 1
- **MAJOR count**: 3
- **MINOR count**: 4

落地代码与 proposal 对齐度高——5 个 `/api/vessel/*` 路由命名空间 ✅、`busy_timeout = 5000`
✅、`vessel-core list / trace replay` ✅、panel 挂 `/vessel/min/`（不污染 Eva App.tsx）✅、
`/api/vessel/runs` 字段对 v5.4 schema 命名（run_id / skill_id / trace_id / span_id）✅。
M1A-α "用户能立刻看面板" 的子验收基本满足。

但有一个被 B-级 review 漏看的 **auth 撞墙**：panel HTML 在 `/vessel/min/` 路径，**不在
`/api/*` middleware 覆盖范围内**（[index.ts:97](/Users/yongqian/Desktop/Vessel/packages/backend/src/index.ts#L97)
的 `app.use("/api/*", authMiddleware)` 不命中 `/vessel/min/`），但 panel 内嵌的所有
fetch 都打 `/api/vessel/*`（**会**被 authMiddleware 拦），且**没有 Authorization
header / `?token=` 拼接**。结果：VESSEL_TOKEN 一旦设置（Tailscale serve / 公网 mac mini
迁移场景必设），panel 加载 OK 但 "Run intent" 全部 401，看板不显示任何数据。这是 BLOCKER。

## 5 lens questions 逐条结论

### Lens 1 (`/api/vessel/*` surface 是否暗示 Memory / observability internal 契约): **PASS-WITH-MINOR**

5 路由列表：

| Route | 暴露的内部表 | Memory 接口暴露？ | Trace 暴露？ |
|---|---|---|---|
| `POST /api/vessel/intent` | （仅 AgentResult） | 否 | 否（trace_id 只在 result 中可观察，不是 Memory 字段） |
| `GET /api/vessel/sessions` | `sessions.id` / `created_at` / `last_seen_at` | 部分 | 否 |
| `GET /api/vessel/runs` | `skill_invocations` × `intents` JOIN（含 `intent_text`） | 部分 | 否 |
| `GET /api/vessel/traces/:id` | trace span tree（FRAMEWORK §5 公开 schema） | 否 | **是（公开）** |
| `GET /api/vessel/health` | counts + `dataDir` | 否 | 否 |

按 FRAMEWORK §2.4 Memory 是 short / sessionKv / longTerm 三层抽象，**`sessions` 表本身
不在 Memory 接口里**——它是 [`session-store.ts`](/Users/yongqian/Desktop/Vessel/packages/backend/src/memory/session-store.ts)
的 M0 直接 sqlite stub（不是 Memory full surface）。所以暴露 `id / last_seen_at` 不算
泄漏 Memory contract；但 **`intents.text` 透过 `/api/vessel/runs?limit=20` 暴露用户原始
prompt 到 HTTP 是新增 surface**。M0.5 closeout review architect 已明确："memory.db
本身不脱敏（Memory 是 feature, recall 需全 prompt）"——这个论点在 CLI / orchestrator
内部是对的，但 **HTTP 暴露上是新决策**。FRAMEWORK §5 trace-redaction-spec 明确管 trace
files，从未管 memory.db 的 HTTP 出站。

**MINOR-1**：`/api/vessel/runs` 默认带 `intent_text`（`SELECT i.text AS intent_text`，
[vessel-intent.ts:71-77](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/vessel-intent.ts#L71-L77)）。
panel HTML 当前 `slice(0, 80)` 截断，但这是客户端的事；HTTP 全量返。**建议**：`runs`
路由默认 omit `intent_text`，加 `?include=intent_text` opt-in。或 server 端按
`trace-redactor.redactString(text)` 走一遍（path/secret 模式）。M1B 加 permission
enforce 时这个口子会跟 `permissionScope.paths` 冲突——一个被 path-allowlist 拒绝的
`cwd` prompt 内容仍能从 `/api/vessel/runs` 读出。

**MINOR-2**：`/api/vessel/traces/:id` 直接 `readdirSync(dir).map(readFileSync.parse)`
([vessel-intent.ts:92-95](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/vessel-intent.ts#L92-L95))。
单 trace 通常 ≤ 10 spans 但 CodingDriver 跑 5 分钟可以堆 100+ spans + spillover
`.stdout` 文件每个最多 4 KiB redacted summary（FRAMEWORK §5.1）。这个 endpoint 没
streaming，也没 limit。一个 trace 1000 spans × 4 KiB = 4 MiB 一次返回，panel 单 select
全跑完就阻塞。M1A-α 单用户没问题，但**当 vessel-core 在 dogfood 期跑长任务**（M1B 加
filesystem MCP server 后真实跑 30+ min coding 任务）就会撞。建议加 `?from=N&limit=200`
分页 + `events.length > 500 → return events: [], hint: 'use vessel-core trace replay'`。

### Lens 2 (HTTP intent 同步 AgentResult → β 加 WS 时是否难重构): **MAJOR**

**MAJOR-1**：`POST /api/vessel/intent` 当前是
```ts
const result = await runIntent({...});
return c.json(result);
```
([vessel-intent.ts:49-54](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/vessel-intent.ts#L49-L54))。

`runIntent` 是 single-promise——success / failed / paused / cancelled 一次性返回。
M1A-β 要加的 WS 则需要在 runIntent 执行**期间**实时推 sdkMessage / permission_request
/ trace event 流。两个语义无法共存：

- 选项 A（β 重新 wrap）：β 在 orchestrator 加 `runIntent({onMessage, onTrace, ...}): Promise<AgentResult>`
  callback hook，HTTP 路由保留同步契约（不传 callback），WS 路由传 callback 给 ws.send。
  这是 Eva [cli-runner.ts](/Users/yongqian/Desktop/Vessel/packages/backend/src/cli-runner.ts)
  现成 pattern。**可行但 orchestrator.ts 接口要扩**（IntentInput 加 5 个 callback）。
- 选项 B（β 把 HTTP intent 也改流式）：HTTP 改 SSE 或 chunked。打破 "α 已锁的 fetch
  返 JSON" 契约，且 panel HTML 也要改。

**问题**：α 没显式记下 "HTTP intent 同步契约 = α-only，β 会改" 还是 "永久同步，β WS
另起 endpoint"。如果 β 选 A，α 已经 ship 的 panel.html 不动；如果 β 选 B，HTTP-only
caller（Eva 后续 inbox 触发器、harness pipeline 复用 Vessel intent）都要改。

**建议**：M1A-α 的 [orchestrator.ts](/Users/yongqian/Desktop/Vessel/packages/backend/src/orchestrator.ts)
在 IntentInput 加 `onMessage?: (e: SdkMessage) => void`（默认 undefined，HTTP 路由不传），
并加注释 `// M1A-β: WS 路由传 ws.send 转发 cli-runner stdout` —— 在 α 阶段 **不实现**
回调（runIntent body 里没用），但**接口口子先开**，β 只填 body 不动签名。这避免 β
被迫扩接口或让 α HTTP 路由一起重构。

否则 β 必然会撞上 "改不改 IntentInput 签名" 的难题，且这个改动会要求 panel.html /
CLI / 任何 α 已 ship 的 caller 一起 audit。

### Lens 3 (panel HTML 是否引入不该有的耦合): **BLOCKER + MAJOR**

#### BLOCKER-1: panel auth 不可用（Tailscale / 公网设 VESSEL_TOKEN 时 100% 失败）

`/vessel/min/` 路由注册在 `app.use("/api/*", authMiddleware)` **之后但路径不匹配**
（[index.ts:117-118](/Users/yongqian/Desktop/Vessel/packages/backend/src/index.ts#L117-L118)）。
所以：
- panel HTML 自身**无 auth**——任何人能访问（但只是个静态 HTML，没敏感信息）。
- panel JS fetch 的 `/api/vessel/*` 全部**有 auth**——但 fetch 没 Authorization header
  ([vessel-panel.ts:62-63](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/vessel-panel.ts#L62-L63)
  `fetch(p)` / `fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' } })`）。

结果：VESSEL_TOKEN 一设，panel 加载成功但 "loading…" 永远卡 401，看不到任何 runs。
M0.5 dogfood 当前 mac mini 局域网 + 无 token 还能用；上 Tailscale 立刻挂。这是
M1A-α 验收 "panel 打开能看到 ≥ 1 session 和 ≥ 1 trace span 树" 的硬伤。

**修复**：

A. **简单做法**：panel 路由也走 `/api/vessel/min` 让 authMiddleware 覆盖；fetch 接受
   `?token=` query param（auth.ts:75-77 已支持）：

```ts
// panel HTML 内
const TOKEN = new URLSearchParams(location.search).get('token') ?? '';
const Q = TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : '';
async function get(p) { return (await fetch(p + Q)).json(); }
async function post(p, body) {
  return (await fetch(p + Q, { method: 'POST', headers: ..., body: ... })).json();
}
```
然后用户访问 `https://<host>/vessel/min/?token=<TOKEN>`，token 在 URL 里——单用户
个人单机 OK（与 Eva 现有 frontend 同模式）。

B. **更好做法**：panel `/vessel/min/` 加 hash-fragment auth（`#token=...` 不进 server log），
   fetch 拼 `Authorization: Bearer`。但要写更多 JS，对个人单机 overkill。

**推荐 A**——5 行 patch，与 Eva frontend [withAuthQuery](/Users/yongqian/Desktop/Vessel/packages/frontend/src/auth.ts)
一致。

#### MAJOR-2: panel HTML 反向暴露 sqlite schema 字段名

panel JS 直接消费 `r.run_id / r.skill_id / r.status / r.trace_id / r.intent_text /
r.started_at`（[vessel-panel.ts:71-79](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/vessel-panel.ts#L71-L79)）。
这些字段名**就是 [`migrations-memory/0001_m0_sessions.sql`](/Users/yongqian/Desktop/Vessel/packages/backend/src/) 的
列名**——`/api/vessel/runs` SELECT 直接 alias 列名作为 JSON key。即 SQL schema 是 panel
HTML 的隐式契约。

后果：

- M1C-B 落 Memory full surface 时 schema 列名要改（如 `skill_invocations.run_id` → `runs.id`），
  必须同时 audit panel HTML——但 panel HTML 是个 string template，不会被 TypeScript /
  Zod 静态检查发现 mismatch。运行时静默坏掉。
- 任何外部 consumer 用 `/api/vessel/runs` 都会绑死 schema。

**建议**：在 [vessel-intent.ts](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/vessel-intent.ts)
里把 SELECT alias 显式起 API field name，并在文件头加 `// API surface — DO NOT couple
to memory.db column names; M1C-B refactor must keep these JSON keys stable`。
当前**事实上对齐**了，但没显式承诺。

### Lens 4 (CLI subcommand argv[0]/argv[1] 路由 → β 加 WS-related CLI 时会不会爆): **MINOR**

[cli/vessel-core.ts:148-158](/Users/yongqian/Desktop/Vessel/packages/backend/src/cli/vessel-core.ts#L148-L158)：

```ts
if (argv[0] === 'list') { ... return cmdList(limit); }
if (argv[0] === 'trace' && argv[1] === 'replay' && typeof argv[2] === 'string') { ... }
const args = parseArgs(argv);
```

这是手写 dispatcher，**不是 yargs / commander framework**。M1A-α 只有 3 个 verbs（默认
intent / list / trace replay）能用。M1A-β / M1B 加 CLI 的几率：

- `vessel-core watch` (β 加 WS tail trace 流)
- `vessel-core sessions list / show <id>` (β 加 conversation 列表，不同于现 list)
- `vessel-core mcp list / spawn / kill <server>` (M1B ADR-009 lifecycle)
- `vessel-core capability install / uninstall` (M2)

到 5+ verbs 时手写 dispatcher 会嵌套到 `argv[0] === 'X' && argv[1] === ...` 4-5 层。
不是爆，是**慢慢退化成 if-else 林子**。

**MINOR-3**：M1A-β closeout 前考虑切到 **commander.js / cac**（轻量、无依赖、同款 ergonomics）。
`@oclif/core` 是过度。**注意 ADR-001 锁定 pnpm 但没锁 CLI framework**——这个
切换 0 风险。M1A-α 暂留手写 OK（3 verb 还在 readable 区间）。

### Lens 5 (M1A-α 是否引入了某个 5 接口 stub 必须升 schemaVersion): **PASS**

5 接口 stub 现状（grep 实测 [interfaces/](/Users/yongqian/Desktop/Vessel/packages/backend/src/interfaces/)）：

- `agent.ts` — 无变更（M1A-α 不改 Agent 契约）。
- `skill.ts` — M0.5 已加 `abortSignal`（已有 retrospective 记录）；M1A-α 不再动。
- `tool.ts` — 无变更。
- `memory.ts` — 无变更。`session-store.ts` 内部加 `busy_timeout = 5000` 是
  **同实现 pragma 调整，不是接口字段变更**。
- `app.ts` — 无变更，`AppManifest.schemaVersion` 仍 1。

`memory.db` 自己的 `MEMORY_SCHEMA_VERSION = 1` 也不需要升——只是 pragma 行为变更，
SQL 表 schema 不动（[session-store.ts:29](/Users/yongqian/Desktop/Vessel/packages/backend/src/memory/session-store.ts#L29)）。

**结论：无 schemaVersion bump 需要**。所有 5 接口契约保持不变。proposal §Part 3 "不动
5 接口 stub" 落地准确。

但有一个 **新 surface 没 schemaVersion**：`/api/vessel/*` HTTP API 自己。Eva 老 routes
也没有 versioning（`/api/runs` 不带 `v1/` 前缀），所以这是**全 backend 的一致问题**，不是
α 引入。延后到 M1B（external consumer 进场前）做整体 `/api/vN/` namespace 决策即可。

## Out-of-focus findings

### MINOR-4: 集成测试 [test-vessel-http-concurrent.ts](/Users/yongqian/Desktop/Vessel/packages/backend/src/test-vessel-http-concurrent.ts) 用 hard-coded port 3050

如果开发者本地 :3050 已占（rare 但可能），测试 hang 在 `waitForBackend` 10s timeout
然后报 "backend reachable" 失败。**建议**：用 ephemeral port——`getPort()` (npm) 或
直接 `listen(0)` 让 OS 选；test runner 把端口注入 `PORT` env。当前实现假设 :3050
可用，CI fragile。M0.5 历史也用类似 hard-coded ports，是一致的 lazy 风格——下个 review 圈
统一改。

### MINOR-5: panel HTML `setInterval(refreshRuns, 3000)` 没 abort

panel 关 tab 时 setInterval 不会自动停（浏览器会，但开发者 / iOS WebView 内嵌
panel 时未必）。每 3s 一个 GET 跑了几小时累计带宽不大但 syscalls 累计可观。
**建议**：用 `document.visibilityState !== 'visible' → skip` 或 `EventSource`
推送（β 起）。M1A-α 个人单机不影响，retrospective 记一笔即可。

## Verdict

PASS-WITH-FIXES。

**Must close before M1A-α closeout retrospective**:

- **BLOCKER-1**: panel HTML 在 VESSEL_TOKEN 模式下不可用——加 `?token=` query
  propagation（推荐方案 A，5 行 patch）。**否则 panel 在 dogfood 真机环境必然全 401，
  完全否定 α 的"用户立刻能看面板"价值主张**。

**Must close before M1A-β implementation**:

- **MAJOR-1**: orchestrator.ts `runIntent` IntentInput 加 `onMessage?: (e) => void` 接口
  口子（α 不实现，β 填 body），并加注释明确 "M1A-β WS 路由用此 callback"。否则 β 必撞
  "改 IntentInput 签名 / 让 α 一起 refactor" 的两难。
- **MAJOR-2**: 在 [vessel-intent.ts](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/vessel-intent.ts) 头加 `// API surface — DO NOT couple to memory.db column names`，
  显式承诺 JSON keys 是 API contract，与 SQL 列名解耦。M1C-B 重构时按此承诺保 keys 稳定。

**MINOR (defer to M1A-β / M1B / retrospective)**:

- MINOR-1: `/api/vessel/runs` 默认 omit `intent_text`，加 `?include=intent_text` opt-in
  + redact-on-egress 通行规则。
- MINOR-2: `/api/vessel/traces/:id` 加分页 / 大 trace 提示用 `vessel-core trace replay`。
- MINOR-3: M1A-β 切 cac / commander，避免手写 if-else 林子。
- MINOR-4: 测试用 ephemeral port 替代 hard-coded :3050。
- MINOR-5: panel `setInterval` 加 visibility check / 切 SSE（β 时）。

实施总体落地干净——5 路由名空间隔离、busy_timeout 到位、CLI subcommand 沿用 plan
§observability 设计、panel 不污染 Eva 主 App.tsx、并发集成测试明确覆盖 C-MAJOR-3 修复。
唯一硬伤是 panel auth 漏写——这个 B-级 review 也没抓出来（reviewers 看的是 proposal
不是落地细节），属第 9 次 cursor 应该抓的盲区集合（架构 reviewer 没 dogfood Tailscale
路径的体感）。修 BLOCKER + 2 MAJOR 后即可 closeout。

---

## Stdout summary (≤200 字)

PASS-WITH-FIXES。1 BLOCKER + 3 MAJOR + 4 MINOR。
**BLOCKER**：panel `/vessel/min/` 不在 `/api/*` middleware 覆盖内但 fetch `/api/vessel/*`
有 auth + 无 token 拼接——VESSEL_TOKEN 一设全 401，panel "用户立刻能看面板" 价值归零。
修法 5 行：`?token=` 透传到 fetch。
**MAJOR**：(1) `runIntent` 同步 AgentResult 契约——IntentInput 必须先开 `onMessage` callback
口子，否则 β 加 WS 撞签名重构两难；(2) panel HTML 直接消费 sqlite 列名作为 JSON key，
没显式承诺 API contract 与 schema 解耦——M1C-B 重构会静默坏；(3) `/api/vessel/runs` 全量返
`intent_text` 是新 PII 出站 surface，超出 trace-redaction-spec 管辖，与 M1B
permissionScope.paths 隔离冲突。
5 接口 stub 无需 schemaVersion bump。落地总体干净；BLOCKER 是 dogfood-Tailscale lens
盲区（B-级 review 漏看），与第 8 次 cursor cross-finding 同形。
