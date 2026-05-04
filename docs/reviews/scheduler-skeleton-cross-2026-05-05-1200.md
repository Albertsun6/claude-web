# Cross Review — Eva Scheduler M1 骨架

**Reviewer**: reviewer-cross
**Model**: claude-sonnet-4-6
**Date**: 2026-05-05 12:00
**Files reviewed**:
- packages/backend/src/scheduler.ts (new)
- packages/backend/src/cli-runner.ts (taskId addition)
- packages/backend/src/routes/harness.ts (broadcast param + tick endpoint)
- packages/backend/src/index.ts (broadcastToAll + route mount moved)

---

## Summary

- Blockers: 2
- Majors: 3
- Minors: 4
- 总体判断：**必须先修 2 个 blocker，再合并**

## Numeric Score

| Lens | Score (0..5) |
|---|---|
| 正确性 | 2.5 |
| 跨端对齐 | 2.0 |
| 不可逆 | 3.5 |
| 安全 | 3.0 |
| 简化 | 3.5 |

**Overall score**：2.8（有 blocker，上限 3.9；实际因 2 个 blocker 压到 2.8）

---

## Findings

### B1 [BLOCKER] scheduler.ts 广播的 harness_event payload 与 ServerMessage schema 不兼容

**Where**: `scheduler.ts:76-83`, `scheduler.ts:88-96`, `scheduler.ts:163-170`, `scheduler.ts:177-183`；对比 `packages/shared/src/protocol.ts:95-101`

**Lens**: 跨端对齐、正确性

**Issue**:
`ServerMessage` 的 `harness_event` 类型要求字段为 `{ type, kind, payload? }`，其中 `kind` 是枚举 `"config_changed" | "stage_changed" | "task_started" | "decision_requested" | "run_appended" | "review_complete"`。

但 scheduler 广播的 payload 用了自定义字段结构：
```ts
// scheduler.ts:76
{ type: "harness_event", event: "stage_started", issueId, stageId, stageKind, taskId }
// scheduler.ts:88
{ type: "harness_event", event: "stage_failed", issueId, stageId, taskId, error }
// scheduler.ts:163
{ type: "harness_event", event: "stage_message", issueId, stageId, taskId, msg }
```

问题：
1. `event` 字段不存在于 `ServerMessage` union — iOS / 前端解析时直接进 unknown case 或解码失败
2. `stage_started` / `stage_failed` / `stage_message` / `stage_done` 均不在 `kind` 枚举里
3. `issueId` / `stageId` / `taskId` 字段完全不在协议 schema 中，iOS 端看不到

同时 `index.ts:270` 的 `harnessConfigEvents` 广播用的是正确的 `ServerMessage`，而 scheduler 绕过了 `ServerMessage` 类型约束，因为 `broadcastToAll(msg: unknown)` 接受任意对象。

**Why this is a blocker**: 一旦合入，iOS `BackendClient` 收到 `type=harness_event` 时会走入 `kind=unknown` 兜底分支（如果有的话），或解码失败静默丢弃。前端 WS handler 同理。调试时看不到任何错误，只是事件静默消失。

**Suggested fix**:
1. 在 `protocol.ts` 的 `kind` 枚举里加入 `"stage_started" | "stage_failed" | "stage_message" | "stage_done"`
2. 把 `issueId` / `stageId` / `taskId` 放入 `payload?: unknown` 字段：`{ type: "harness_event", kind: "stage_started", payload: { issueId, stageId, taskId } }`
3. 或者新建专用 `SchedulerEvent` discriminated union 并纳入 `ServerMessage`

---

### B2 [BLOCKER] tick() 无并发保护 — 同一 Issue 可被双重 spawn

**Where**: `scheduler.ts:40-100`（整个 tick 方法）

**Lens**: 正确性

**Issue**:
`tick()` 调用 `spawnAgent()` 时是 fire-and-forget（`.catch()` 只处理错误，不 block）。`spawnAgent()` 是异步的，在 claude CLI 跑完之前 stage status 仍是 `"running"`。

但 `computeNextStage()` 的判定逻辑（`scheduler.ts:102-112`）只跳过 `status === "done"` 的 stage，**不跳过 `"running"` 的 stage**：

```ts
existingStages
  .filter((s) => s.status === "done")  // ← 只过滤 done，running 的 stage 被当作"未跑"
  .map((s) => s.kind as StageKind)
```

结果：用户连续两次 POST `/scheduler/tick`，第一次 spawn 了 `strategy` stage 但还未完成，第二次 tick 又看到 `strategy` 不在 doneKinds 里，重新 `createStage` 一个新的 `strategy` stage 并再次 spawn。同一 Issue 会有两个并发的 `strategy` run，两个都写 `stage_done`，数据库出现两条 strategy stage 记录。

**Why this is a blocker**: 并发 spawn 会导致数据库 stage 重复、claude CLI 资源竞争、WS 广播错乱。M1 骨架即便手动触发，用户双击也会触发。

**Suggested fix**:
在 `computeNextStage` 中同时跳过 `"running"` 状态的 stage：
```ts
const occupiedKinds = new Set(
  existingStages
    .filter((s) => s.status === "done" || s.status === "running")
    .map((s) => s.kind as StageKind),
);
```
或者在 tick 开始时先检查该 Issue 是否已有 running stage，有则直接返回 `{ issued: false, reason: "stage already running" }`。

---

### M1 [MAJOR] randomUUID import 存在但从未使用

**Where**: `scheduler.ts:13`

**Lens**: 正确性（dead import，可能是残留计划）

**Issue**: `import { randomUUID } from "node:crypto"` 存在但在整个文件中没有任何调用。`taskId` 的构成是 `${issue.id}/${stage.id}`，都来自 DB，不需要 randomUUID。

**Why this is a major**: 表明代码未经完整 review 就提交（dead import 通常是 tsc 不报错但 linter 会报 `no-unused-vars`）。如果后续有 linter 检查会失败。

**Suggested fix**: 删除 line 13 的 import。

---

### M2 [MAJOR] spawnAgent() 中 `messages` 数组只写不读，是内存泄漏

**Where**: `scheduler.ts:153`

**Lens**: 正确性、简化

**Issue**:
```ts
const messages: unknown[] = [];
// ...
onMessage: (msg) => {
  messages.push(msg);  // 持续累积
  // messages 之后从未被读取或清空
```

对于一个长时间运行的 stage（claude CLI 可能输出数百条消息），`messages` 数组会无限增长并持有闭包引用，直到 `spawnAgent()` Promise resolve 后才 GC。

**Why this is a major**: 对于大型 Issue（长 context），内存占用不可控。

**Suggested fix**: 直接删除 `messages` 数组及 `messages.push(msg)` 那行——`onMessage` 已经通过 `broadcast` 把消息推出去了，本地缓存没有用途。

---

### M3 [MAJOR] 路由挂载顺序移位引入了隐藏的条件分支漏洞

**Where**: `index.ts:107-122`（DB init 失败分支）vs `index.ts:262-265`（正常路由挂载）

**Lens**: 正确性

**Issue**:
DB init 失败时，在 line 114 挂了一个全局 `app.all("/api/harness/*")` 503 handler。但正常情况下路由挂载移到了 line 264（wss 之后）。

Hono 的路由匹配是**按注册顺序**的。如果 DB init 成功，`_harnessDb` 非 null，line 114 的 503 handler 不会被注册，line 264 的 `buildHarnessRouter` 会在 wss 之后正常注册——这没问题。

但是：`HARNESS_DISABLED=1` 时，line 119 注册的 `app.all("/api/harness/*")` 在 **wss 之前**（line ~120），而正常路由（line 264）只在 `_harnessDb` 非 null 时才注册。两条路径的行为不对称，但实际上是无害的——因为 `HARNESS_DISABLED` 时 `_harnessDb` 永远是 null，line 264 的 `if (_harnessDb)` 不会执行。

真正的问题是：注释说"routes are mounted after wss is ready"，但只有成功路径符合这个描述；失败路径（503）还是在 wss 之前挂的。注释会误导未来维护者。

**Why this is a major**: 不是 bug，但注释误导性强，维护者看到"after wss"可能误以为所有 harness 路由都在 wss 后，从而写出依赖这个顺序的代码，在失败路径下行为不符合预期。

**Suggested fix**: 把注释改为"正常路径在 wss 后挂；失败/disabled 路径仍在 wss 前挂 503，这是预期行为"。

---

### m1 [MINOR] `cwd: process.cwd()` 可能不在 ALLOWED_ROOTS 内

**Where**: `scheduler.ts:157`

**Lens**: 安全

**Issue**:
```ts
cwd: process.cwd(),
```
`process.cwd()` 是 launchd 或 tsx 启动时的工作目录，通常是 `/Users/yongqian/Desktop/claude-web` 或 `claude-web-prod`。如果 `CLAUDE_WEB_ALLOWED_ROOTS` 未包含这个路径，`verifyAllowedPath` 会抛出错误，导致整个 `spawnAgent()` 失败。

这不是严重安全漏洞（`verifyAllowedPath` 会正确拒绝），但会让 scheduler 在严格配置下静默失败（错误进 `.catch()` 回调，stage 被标为 `failed`，用户不知道原因是路径配置问题）。

**Suggested fix**: 把错误消息改得更明确，或在 scheduler 初始化时预验证 `process.cwd()` 是否在 allowlist 内，fail fast 而非 per-tick 失败。

---

### m2 [MINOR] `model` 字段用 `as any` 绕过 ModelId 类型约束

**Where**: `scheduler.ts:155`

**Lens**: 正确性

**Issue**:
```ts
model: model as any,
```
`ModelId` 是 `@claude-web/shared` 导出的类型。`scheduler.ts` 中硬编码了三个 model 字符串但通过 `as any` 绕过类型检查。如果 `ModelId` 枚举更新，scheduler 里的硬编码不会触发 TS 错误。

**Suggested fix**: 从 `@claude-web/shared` 导入 `ModelId`，或把硬编码 model 字符串提取为常量并加类型注释。

---

### m3 [MINOR] `resolveProfile` fallback 逻辑过于宽松，可能用错 profile

**Where**: `scheduler.ts:114-124`

**Lens**: 正确性

**Issue**:
```ts
config.agentProfiles.find((p) => p.stage === stageKind && p.enabled)
  ?? config.agentProfiles.find((p) => p.enabled) ?? null
```
fallback 会找"任意 enabled profile"，即使它的 `stage` 字段与当前 stageKind 完全不匹配。这意味着一个 `strategy` stage 可能被一个 `compliance` profile 去跑，systemPrompt / 工具白名单都不对。

**Suggested fix**: M1 宽松 fallback 可以接受，但加一行日志：`console.warn("[EvaScheduler] no profile for stage ${stageKind}, falling back to ${profile.id}")` 让问题可见。

---

### m4 [MINOR] tick 端点缺少身份验证

**Where**: `routes/harness.ts:46-49`

**Lens**: 安全

**Issue**:
```ts
app.post("/scheduler/tick", async (c) => {
  const projectId = c.req.query("projectId");
  const result = await scheduler.tick(projectId);
```
`buildHarnessRouter` 挂在 `/api/harness` 下，但没看到这个 router 有中间件做 auth 检查。`index.ts` 里全局 auth middleware 覆盖 `/api/*`——如果全局 middleware 已覆盖，此条是 false positive。

**Suggested fix**: 确认全局 auth middleware 确实覆盖 `/api/harness/scheduler/tick`，如是则此条为 false positive，不需要改。

---

## False-Positive Watch

- **m4（tick 端点 auth）**：很可能是 false positive——index.ts 里有全局 auth middleware，只要 `CLAUDE_WEB_TOKEN` 设了就会覆盖所有 `/api/*` 路由。需要 author 确认全局 middleware 注册顺序是否在 harness router 之前。

---

## What I Did Not Look At

- 未运行后端或实际触发 tick——仅静态读代码
- 未读 iOS `BackendClient.swift` 端对 `harness_event` 的实际解码逻辑（只读了 `protocol.ts` TS 端定义）
- 未检查 `harness-queries.ts` 中 `createStage` 的 DB 约束是否允许同一 issue 有多条同 kind 的 stage
- 未检查 `runSession()` 在 fire-and-forget 场景下的 AbortController / signal 行为
