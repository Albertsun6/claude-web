# Eva Architecture / Framework Assessment (2026-05-05)

## Executive Summary

当前 Eva 的主要问题不是技术栈选错，而是产品已经从“Claude CLI 手机/网页壳”扩展成“个人 AI 软件工程 Harness”，但若干边界仍沿用早期形态：

- `cli-runner.ts` 仍是 Claude-only 深耦合。
- worktree / lock / backend port 仍有手工和 markdown 过渡痕迹。
- ContextBundle 契约里有理想态 `fs-as-context`，但当前 CLI 架构只能务实走 `prompt-as-context`。
- CI / release / iOS gate 仍偏轻，不能完全覆盖 harness 复杂度。

结论：**不建议换大框架，不建议重写为通用 agent 平台。建议保留 Hono + Vite + SwiftUI + SQLite + Claude CLI 主链路，优先加结构化配置、状态机、provider 能力矩阵和 release gate。**

## Current Architecture

```text
iOS SwiftUI / Web React
        ↓ HTTP + WS
Hono backend
        ↓
cli-runner.ts → spawn claude CLI
        ↓
Claude CLI tools / hooks / jsonl transcript

Harness side:
harness.db + Scheduler + ContextManager + worktree + PR flow
```

当前稳定判断：

- `packages/backend`: Hono + ws 适合个人本地 tool proxy。
- `packages/frontend`: React/Vite 适合轻 Web 控制台。
- `packages/ios-native`: SwiftUI 原生路线正确，继续作为移动端主线。
- `packages/shared`: TS 协议 + fixtures 是跨端稳定性的关键。
- `harness.db`: SQLite + FTS5 对个人单机足够。

## Reasonable Choices To Keep

### Keep `claude` CLI subprocess as primary runtime

理由：

- 复用 Claude Pro/Max 订阅。
- 避免 Anthropic API key billing。
- 已经接入 stream-json、permission hook、resume、MCP。

不要改成 Anthropic Agent SDK。

### Keep Hono, do not migrate to NestJS

NestJS 不会自动解决当前核心问题：

- runId routing
- permission hook
- Scheduler 状态机
- ContextBundle
- worktree / PR / release

建议只把 `index.ts` 继续拆薄，不迁大框架。

### Keep Vite + React, do not migrate to Next.js

Eva 是本地控制台，不需要 SSR / RSC / SEO。Next.js 会打破后端单端口 serving 模型。

### Keep SwiftUI native iOS

Seaidea 依赖录音、TTS、本地缓存、WebSocket、权限生命周期。SwiftUI 直接处理系统能力，优于 Capacitor/PWA/RN/Flutter。

### Keep SQLite / local files

个人单机规模不需要 Postgres / Redis / NATS。未来如做多人或云端，再单独立项。

## Main Architecture Problems

### P0. Free-form worktree coordination is not enough

Evidence:

- M1 parallel-tracks retrospective 发现 `WORKTREE_LOCK.md` 语义漂移。
- Git rebase 0 conflict 不等于 lock 语义正确。

Fix direction:

- H12: `eva.json` + JSON Schema.
- 不做 DSL，不做标准化协议；先做小 JSON config。

### P0. ContextBundle spec is ahead of executable reality

`HARNESS_CONTEXT_PROTOCOL.md §6` 的 `BundleDir read-only + worktree write` 当前不可直接实现：

- Claude CLI 当前是单 `cwd` 模型。
- 读 A 写 B 需要 OS sandbox / ACL / tool proxy。

Fix direction:

- M2 采用 `prompt-as-context`。
- `fs-as-context` 留到 M3+ sandbox research。
- 新 ADR: `prompt-as-context before fs-isolation`。

### P1. Scheduler task lifecycle lacks observable middle states

当前状态不足以区分：

- queued but not claimed
- scheduler claimed but not spawned
- CLI process running
- waiting permission / tool use / thinking

Fix direction:

- H14: add `dispatched`.
- H16: agent state heuristics.
- Longer term: task record `queued → dispatched → running → completed/failed/cancelled`.

### P1. Provider model is implicit

Eva 当前实际是 Claude-only，但现实已出现：

- Cursor CLI 用于 cross review。
- Codex CLI 也可复用订阅，适合 review/research。

Fix direction:

- H18: Provider Runtime Matrix.
- Claude remains primary executor.
- Cursor/Codex first enter as reviewer-only runtimes.
- Do not expose provider-specific events to iOS/Web.

### P1. Release gate is too light for native/mobile + harness

Current CI mainly covers:

- pnpm install
- protocol tests
- frontend build
- protocol sync check

Missing conditional gates:

- backend typecheck / harness schema smoke
- iOS Swift build when `packages/ios-native/**` or Swift protocol changes
- promote native binding rebuild checks
- runtime health smoke after tag/promote

Fix direction:

- H11 release mobile conditional gate.
- Keep manual checklist first; automate path-aware jobs later.

## External References And What To Borrow

### Paseo

Borrow:

- repo-level declarative config (`paseo.json` style)
- setup / teardown / service definitions
- worktree lifecycle thinking

Do not borrow now:

- reverse proxy + automatic port abstraction
- full desktop workflow

### Worktrunk

Borrow:

- lifecycle hooks (`pre-start`, `post-start`, `pre-merge`, `pre-remove`)
- blocking vs background hooks

### Multica

Borrow:

- task lifecycle: `queued → dispatched → running → completed/failed/cancelled`
- provider capability matrix
- heartbeat / timeout / retry concepts

Do not borrow now:

- server / daemon / runtime split
- team SaaS architecture

### Daintree

Borrow:

- agent state via output heuristics
- dashboard ideas

Do not borrow now:

- drag-and-drop desktop-first UI as M2 core

### Cursor CLI / Codex CLI

Borrow:

- reviewer-only runtime first
- capability probing
- cross-model sanity checks

Do not do now:

- full multi-provider executor abstraction before spike evidence

### OpenHands

Borrow later:

- sandbox/workspace separation ideas

Do not do now:

- full SDK/server/sandbox rewrite

## Recommended Execution Order

### Wave 1: Stabilize orchestration substrate

1. H12 `eva.json` + JSON Schema
   - Replace free markdown locks with structured config.
   - Keep fields minimal: tracks, branch, path, port, dataDir, owns, status.

2. H14 `dispatched` stage state
   - Add schema migration + protocol fixtures.
   - Make scheduler transition observable.

3. H16 agent state heuristics
   - Derive `thinking/tool_use/waiting_permission/running` from stream-json and permission events.

### Wave 2: Make ContextManager real but not overbuilt

4. ContextManager 3.2-A'
   - Prompt-as-context.
   - Inline selected artifact content into prompt and snapshot.
   - Store stage outputs like `spec` as artifact.
   - Do not add `issue_body` artifact kind unless separate schema PR.

5. ADR for prompt-as-context vs fs-as-context
   - M2 prompt-as-context.
   - M3+ fs isolation / sandbox research.

### Wave 3: Provider and review expansion

6. H18 Provider Runtime Matrix
   - Static capabilities only first.
   - Claude primary executor.
   - Cursor/Codex reviewer-only spikes.

7. Standard review output format
   - Cursor/Codex/Claude review all output BLOCKER/MAJOR/MINOR markdown.
   - No endless multi-agent debate loop.

### Wave 4: Release and mobile gates

8. H11 conditional release gates
   - Path-aware iOS checks.
   - backend/harness smoke after promote.
   - Manual checklist before full automation.

## Explicit Non-Goals

- No NestJS migration.
- No Next.js migration.
- No Redux migration just for structure.
- No Postgres / Redis / NATS for personal mode.
- No Anthropic Agent SDK.
- No full OpenHands-style sandbox in M2.
- No full Multica daemon/server split in M2.
- No Cursor/Codex as default code-writing runtime before reviewer spike.

## Guidance For Execution Agents

When implementing changes from this report:

1. Prefer additive, small PRs to `dev`.
2. Keep Claude CLI main path green after every PR.
3. Do not change iOS/Web protocol for provider-specific details; normalize in backend first.
4. If a change touches schema, add migration + fixture + Swift/TS alignment.
5. If a change is an ideal future state, write ADR/IDEA first; do not smuggle it into M2 implementation.
6. Treat `eva.json` as local single-user orchestration config first, not a public DSL or standard.

## Short Decision Matrix

| Question | Decision |
|---|---|
| Should Eva become multi-provider? | Yes, later. Start with capability matrix and reviewer-only Cursor/Codex. |
| Should Claude stop being primary? | No. Claude CLI remains primary executor. |
| Should we switch frameworks? | No. Current stack is appropriate. |
| Should ContextManager enforce fs isolation now? | No. Use prompt-as-context in M2; sandbox research M3+. |
| Should worktree lock stay markdown? | No. H12 `eva.json` first. |
| Should release pipeline include iOS gates? | Yes, conditionally by changed paths. |
