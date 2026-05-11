# Phase 1 Verdict — vessel-pragmatist

- **Artifact**: 0B 工程改造产物（5 接口 stub / 2 内部契约 / observability trace stub / migration script / startup env check / REFERENCES + ADR README + ml-workers README）
- **Phase**: 1 (isolated)
- **Role**: vessel-pragmatist
- **Date**: 2026-05-10 00:33
- **Lens**: 工程可行 / 简洁 / YAGNI / 个人单机 / Eva 优先复用 / 不过度工程 / 不池化 ML worker
- **Files reviewed**: 11 文件 / 761 LOC

---

## Summary

0B 的 stub + 改造产物整体**克制得当**：5 接口签名都是必需字段（无明显未来字段堆砌）、Driver/ML worker 内部契约**正确放在 `drivers/` 和 `ml-worker/` 子目录而非 5 接口顶层**（符合 ADR-000 §3 "helper subprocess 不等于多服务"）、migration 默认 dry-run、startup env check 走"alert + exit"不留双名 fallback（已落 M-P1 owner 决议）。REFERENCES 14 条参考，每条都标了"是否依赖"和我们的判断，CrewAI 还专门作为反例提醒不做 multi-agent——pragmatist 视角满意。

主要发现集中在：(1) 5 接口里有几处 `unknown` placeholder 跟 `@vessel/shared` 导出耦合不清楚（注释里写"待 0B-7 + M0 落地"，但 0B 验收要求 `import` 成功 → 现状能 import 但导入的是 `unknown`），(2) `ToolRegistry.list()` 有 YAGNI 嫌疑（M0 EchoSkill 不需要列表能力），(3) 路径校验那段长达 17 行的注释能不能直接落 helper 而不是 prose——对个人单机 + 17 行容易飘。

**0 BLOCKER / 2 MAJOR / 5 MINOR**。可以推进 0A.1 → 0B 实施。

---

## BLOCKER（0 条）

无。0B 是工程改造（不是 M0 内核骨架），interface stub 只要"能 import"+ `tsc` 通过即满足验收（plan §645-657）。当前 stub 全部满足这个标准，且没有违反硬约束（没看到 LLM Driver / 多服务架构 / API SDK / ML worker pool 等过度工程）。

---

## MAJOR（2 条）

### M-P1: `@vessel/shared` placeholder 跟 0B 验收存在循环依赖

**Where**: 
- `packages/backend/src/interfaces/agent.ts:19-23`
- `packages/backend/src/interfaces/skill.ts:22-24`

**Issue**: 两处都有：
```ts
// import type { Intent, Artifact, SessionId } from '@vessel/shared';
// 注：以上 @vessel/shared 导出待 0B-7 + M0 落地；当前 stub 用 placeholder
type Intent = unknown;
type Artifact = unknown;
type SessionId = string;
```

YAGNI / 工程可行 视角的 3 个问题：
1. **0B 验收说 "`import { Agent, Skill, Tool, Memory, App } from '@vessel/core/interfaces'` 不报错"**——能 import，但 import 进来的 `Agent.run(intent)` 参数类型是 `unknown`。下游 M0 写 `EchoSkill.invoke(intent)` 时拿到 `unknown` 必须先 type-guard 才能用，等于推迟工作而不是消除工作。
2. `SessionId = string` 是真类型；`Intent = unknown` 和 `Artifact = unknown` 是 placeholder——同一个文件混两类，注释又只在 agent.ts 写一次（skill.ts 只写"临时 placeholders"，没说去哪找权威定义）。后续 owner 改 Intent schema 时容易漏改一个文件。
3. 0B 里没有"fail-loud TODO"——`unknown` 不会触发 lint warning。M0 实施时容易"忘了换"。

**Why MAJOR**: 直接拖累 M0 第一行 EchoSkill 实施（必须先决定 Intent schema 才能写 invoke），但不阻塞 0B `tsc --noEmit` 通过。

**Suggested fix**（最简）：
- 选 1：直接在 `interfaces/` 里落最小 Intent / Artifact / SessionId 类型（M0 只需要 `interface Intent { text: string }` + `type Artifact = { kind: string; payload: unknown }` 即可）。0B 验收要求"能 import"——能导出真类型 ≥ 能导出 placeholder。
- 选 2：保留 placeholder 但加 `// @ts-expect-error TODO(0B-7): replace with @vessel/shared.Intent` 一行，让 M0 一开始就 fail-loud。
- 加一句到 `interfaces/index.ts` 顶部 doc comment："Intent / Artifact / SessionId placeholder 见 agent.ts；M0 实施前先 land @vessel/shared 导出"。

---

### M-P2: `ToolRegistry.list()` 是 M0 不需要的 abstraction

**Where**: `packages/backend/src/interfaces/skill.ts:42-48`

```ts
export interface ToolRegistry {
  get(toolId: string): Tool | null;
  list(): Tool[];   // ← 真的需要吗？
}
```

**Issue**: `list()` 没有当前 milestone 的 caller。检查 plan §659-697 的 M0 / M0.5 / M1A / M1B Acceptance：
- M0 EchoSkill 不调任何 Tool
- M0.5 CodingSkill 调 CodingDriver（不通过 ToolRegistry）
- M1B 加 MCP filesystem—Skill 直接 `tools.get('filesystem.read')`，不需要列出

什么时候需要 `list()`？只有"Skill 想自省'我能用哪些 Tool'再做选择"这种 LLM-driven tool dispatch 场景——但 Vessel 是 prompt-driven（CC CLI 内部自己做 tool dispatch），不是 vessel-core 主进程做 tool routing。这是典型的"假想未来需求"——v1+ Capability Composition 时如果真需要再加。

**Why MAJOR**: Eva 优先复用原则推论：Eva cli-runner / permission 没有 ToolRegistry.list() 类似 API；新增需要 ADR 论证；现在加进 stub 等于把假想需求 baked-in。

**Suggested fix**: 删 `list()`。如果真有"列出 Capability scope 内 Tool"的 Capability App 自我介绍场景，那是 `CapabilityApp.tools()`（已经有了在 `app.ts:34`）——重复抽象。

---

## MINOR（5 条）

### m-P1: tool.ts 里 17 行的 HARD RULES 注释应该是 doc/spec 而不是 source code

**Where**: `packages/backend/src/interfaces/tool.ts:38-56`

**Issue**: 第 38-53 行是一段长达 16 行的"路径白名单 HARD RULES"prose，紧跟着是一个 `VerifyAllowedPathFn` interface（55-56 行）签名。两个 pragmatist 担忧：
1. **代码阅读时干扰**：interface 文件应该聚焦签名；规范文字放 docs/。这种"在源码注释里写规范"长期会过期（M1B 实施 verifyAllowedPath 时改了行为没人会回来同步注释）。
2. **17 行注释 + 2 行 interface = 工程师看到的"密度倒挂"**——重要的是函数签名，但视觉占比 90% 是 prose。

**Suggested fix**: 把 38-53 行 HARD RULES 抽到 `docs/design/path-verification-spec.md`（或加进 trace-redaction-spec 同级），interface 注释只留 1 行 `// 路径白名单校验：见 docs/design/path-verification-spec.md`。

---

### m-P2: `interfaces/skill.ts` 的 `SkillContext.workspaceDir` 和 CodingDriver `workspace` 命名不一致

**Where**: 
- `interfaces/skill.ts:39` — `workspaceDir: string;  // instance/workspace/<run_id>/`
- `drivers/types.ts:35` — `workspace: string;  // instance/workspace/<runId>/`

**Issue**: 同一个概念（CodingDriver run 期 workspace）两处字段名不同（`workspaceDir` vs `workspace`）。M0.5 CodingSkill wrap CodingDriver 时会写 `driver.submit({ workspace: ctx.workspaceDir })` 这种 mapping，没必要——一致命名零成本。

**Suggested fix**: 统一为 `workspaceDir`（更明确：是个 dir 不是个 obj）或 `workspace`（沿用 Eva harness 习惯）。挑一个 replace 全部即可。

---

### m-P3: `ml-worker/types.ts` 的 streaming method 是 v0.1 之后才用的"未来字段"

**Where**: `packages/backend/src/ml-worker/types.ts:28-32, 43-47`

```ts
transcribeStream?( ... ): AsyncIterable<...>;   // M2-Voice 之后
synthesizeStream?( ... ): AsyncIterable<...>;   // low-latency TTS，M2-Voice 之后
```

**Issue**: 这两个 stream method 注释里写"M2-Voice 之后"（M2 = M2-Voice 之后又之后 = v1+）。0B stub 里就放进 interface，等于"假想未来需求"。`?:` optional 让它好像不是问题，但有 3 个微弱代价：
1. ASR/TTS client 实现者看到 stream method 会以为 v0.1 也要支持
2. 测试 fixture 要决定 streaming case 怎么 mock
3. M2-Voice 实施时如果发现 fastapi 流式跟 OpenAI Audio API 兼容点不一样，要改 interface signature——还不如那时再加

**Why MINOR**（不是 MAJOR）: optional method 不阻塞当前实现；只是 stub 早期污染。

**Suggested fix**: 删两个 stream method。M2-Voice 实施时再加（那时已知道 fastapi streaming 实际签名是什么）。

---

### m-P4: migration script 用 emoji status 标记，跟 startup-env-check 风格不一致

**Where**: 
- `scripts/migrate-eva-to-vessel.ts:95-149` — 大量 ✓ ⊘ ⚠ ⚡ ◯ 🔍
- `packages/backend/src/startup-env-check.ts:39-55` — 仅 ⚠️ + ━ 边框

**Issue**: migration script 用了 6 种 emoji（✓ ⊘ ⚠ ⚡ ◯ 🔍 ✅），加上 `🔍 DRY-RUN` / `⚡ APPLY` mode 标记。pragmatist 视角：
- 个人单机 owner 一年跑这个脚本一次（改名时），不需要 6 种状态符号
- terminal 里 emoji 渲染不稳（特别是 launchd 拉起时 stdout 进 logs 文件）
- 跟其他 Vessel 工具脚本风格不一致

**Why MINOR**: 不影响功能。

**Suggested fix**: 统一为 `[OK]` / `[SKIP]` / `[WARN]` / `[DRY]` ASCII 标记。或者保留 emoji 但删一半（只留 ✓ / ⚠ / 删除 ⊘ ◯ ⚡ 🔍 等）。

---

### m-P5: `interfaces/index.ts` re-export `CapabilityApp as App` 是潜在 confusion

**Where**: `packages/backend/src/interfaces/index.ts:17`

```ts
export type { CapabilityApp as App, ... } from './app.js';
```

**Issue**: 文件叫 `app.ts`、interface 叫 `CapabilityApp`、re-export 重命名为 `App`。下游 `import { App } from '@vessel/core/interfaces'` 看上去像是 application root（"the Eva app"），但其实是 Capability plugin。命名歧义。

**Why MINOR**: 不影响 0B 验收。

**Suggested fix**: 选 1：直接 export `CapabilityApp`（不 alias），让 `import { CapabilityApp }` 一目了然。选 2：interface 改名为 `App`（跟文件名一致），但要在 doc 里清楚 App = Capability。我倾向选 1（CapabilityApp 已经是 FRAMEWORK §2.5 + ADR-007 / ADR-009 的术语；用别名只是文件层面缩写没有收益）。

---

## Positive observations

1. **5 接口 stub 体量克制**：5 个接口文件加起来 264 LOC（含 doc comment），单接口最大 92 LOC（`app.ts`）。没有出现"先把 v1+ 字段都列上"的常见过度工程模式。
2. **AgentResult 是 discriminated union**（agent.ts:49-53）：每个 status 必带对应字段，避免 caller 漏分支——比 v0A 修订前的 optional fields 工程上严密很多。这是 cursor M3 finding 落地的好例子。
3. **Driver / ML worker 契约正确放在子目录**（不在 5 接口顶层），`interfaces/index.ts:7-8` 还专门用注释说明分层——直接对应 ADR-000 §3 "helper subprocess ≠ 多服务架构"硬约束的工程落地。
4. **migration script 默认 `--dry-run`**（migrate-eva-to-vessel.ts:26）+ `--force-overwrite` 才覆盖 + 不删源（"按 0-pre E1 owner 决议"）—— 个人单机背景下"安全 default"做得到位。
5. **startup-env-check 走 alert + exit(1)**（不留双名 fallback）—— 直接落 0-pre M-P1 决议，未来不会有"两套 env 命名永远删不掉"的维护债。
6. **REFERENCES.md 14 条**，CrewAI 列为反例（"v0.1 不做 multi-agent，避免过度工程化"）—— 不仅列借鉴，还显式标"什么不做"，对未来防止 scope creep 有用。
7. **ml-workers/README.md 明确 v0.1 留空**："M0–M1B 不依赖 ML，先把 vessel-core 骨架跑通"—— 跟 plan §704-721 推迟 M1C-B 的策略一致；不会出现 0B 阶段就提前花精力搭 Python 环境。
8. **trace.ts 用 OTEL hex 格式**（trace_id 32 hex / span_id 16 hex）+ W3C TRACEPARENT —— 直接采用工业标准，未来加 exporter 不需要重新映射。stub 阶段就做对，避免 v1+ 大迁移。
9. **CodingDriver `model` 字段沿用 Eva model-registry 的 `'opus' | 'sonnet' | 'haiku'`** literal 类型（types.ts:38）—— Eva 已验证的范畴，不重新发明 string-based model selector。
10. **ADR README supersede 矩阵**（adr/README.md:60-69）—— 6 条 Eva legacy ADR 跟 Vessel ADR 的关系全部标清楚（部分 superseded / 互补 / 巧合编号）—— 防止后续"Eva ADR 还有效吗"的反复 debate。

---

## Pragmatist 提醒（不计入 Findings）

0B 的 stub 阶段 over-engineering 风险**已经控制住**了，但 0B → M0 → M0.5 这条线上有 3 个雷区要 owner 留心，免得 stub 时干净 / 实施时膨胀：

1. **M0 EchoSkill 实施时不要让 Skill 接口"长大"**——当前 `Skill.invoke(intent, ctx)` 两参足够。如果有人想加 `Skill.preflight()` / `Skill.postcheck()` lifecycle hook，要 ADR 论证不能直接加。
2. **M0.5 CodingDriver wrap Eva cli-runner.ts 时要走 adapter**（ADR-016 路径 C 已锁定）—— 不要"顺手优化" cli-runner 内部。Eva 已踩过的坑（permission hook fail-open / SIGTERM 5s / stale-session retry）一行不动。
3. **M1B 加 MCP 时不要"为了 Tool 接口完整"反向改 5 接口**—— `Tool` interface 现在是干净的；M1B 实施 MCP client 应该是 wrap Tool（而不是改 Tool 让它 MCP-aware）。

这 3 条不是当前 0B 的 finding，是给 owner 实施 M0 / M0.5 / M1B 时的 reminder。
