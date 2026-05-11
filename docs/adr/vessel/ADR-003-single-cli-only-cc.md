# ADR-003: v0.1 仅支持 Claude Code CLI（不抽象多 CLI）

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: coding-driver, scope, m0.5
- **Tier**: 2（短决策；scope 收窄）
- **Depends on**: ADR-000 / ADR-016

## Context

Vessel 计划长期支持 CC / Cursor / Codex 多 CLI。但 v0.1 只有 owner 一个用户，他主用 CC（Pro/Max plan）。强行抽象多 CLI 是过早 abstraction（v5.4 dogfood B-P1 finding）。

## Decision

**v0.1 只 implement `ClaudeCodeDriver`（CC CLI）**。

- `packages/backend/src/drivers/coding/claude-code.ts` — 实现 CodingDriver interface（沿用 Eva cli-runner，按 ADR-016 C 路径不动内部）
- `packages/backend/src/drivers/coding/cursor-cli.ts` — **占位 + TODO**（v1+）
- `packages/backend/src/drivers/coding/codex-cli.ts` — **占位 + TODO**（v1+）
- `packages/backend/src/drivers/coding/fake.ts` — FakeCodingDriver（录制回放，单测用，避免烧 CC 订阅额度）

CodingDriver interface 设计要让 v1+ 加新 CLI 时 zero-touch claude-code.ts。

## Consequences

- ✅ M0.5 工作量受限（仅 1 driver 实现）
- ✅ Eva 已有 cli-runner.ts 集成挑战（5 坑）已解决
- ⚠️ v1+ 加 Cursor/Codex 时需重新做 5 集成挑战（每个 CLI 不同）—— 用 spike 验证
- ⚠️ owner 跑评审用的 cursor-agent 是**评审工具**（ADR-017），不是 production CodingDriver；此 ADR 不影响 cursor-agent 评审集成

## Prior Art

No direct prior art needed.
