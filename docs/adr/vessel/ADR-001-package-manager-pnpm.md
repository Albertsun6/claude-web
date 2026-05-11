# ADR-001: Package Manager = pnpm（沿用 Eva）

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: tooling, monorepo
- **Tier**: 2（短决策，无需 Phase 0 调研）
- **Depends on**: ADR-000（Eva fork-rename）

## Context

Vessel = Eva fork。Eva 已用 pnpm 9.0.0 workspace。换 npm/yarn/bun 没有产品价值，只增迁移成本。

## Decision

**沿用 Eva pnpm 9.0.0** workspace。`pnpm-workspace.yaml` 不动，路径未变。Vessel 改名时仅改 root + workspace `package.json` `name` 字段（按 ADR-013 §2 Stage 1）。

## Consequences

- ✅ 0 学习成本；Eva 已有所有 lock file
- ✅ workspace `protocol:` syntax 沿用
- ⚠️ 命令固化为 `pnpm dev:backend` / `pnpm test:cli` / 等
- ⚠️ 升级到 pnpm 10+ 时由 owner 触发（v1+ 议题）

## Prior Art

No direct prior art research needed. Eva 已有 production usage 证明可行。
