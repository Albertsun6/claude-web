# ADR-018: AISEP 作为独立 Capability 体系 vs 现有 HARNESS_* 试点的边界

- **Status**: Accepted
- **Date**: 2026-05-11
- **Deciders**: yongqian
- **Tags**: governance, scope-boundary, capability-app, methodology
- **Resolves**: 用户提案"借助 AI 能力开发各种软件的工程化体系，vessel 作为 pilot"——明确为全新概念，与现有 [docs/HARNESS_*.md](../../HARNESS_INDEX.md) 系列无关
- **Depends on**: [ADR-000 adopt-eva-codebase](ADR-000-adopt-eva-codebase-as-vessel-foundation.md), [ADR-013 rename-strategy](ADR-013-rename-strategy.md), [ADR-017 cursor-cli-cross-reviewer](ADR-017-cursor-cli-cross-reviewer.md)
- **Source**: `~/.claude/plans/ai-vessel-vessel-bubbly-noodle.md`（完整调研 + plan）

## Context

用户提案 bootstrap 一个全新工程化体系 **AISEP（AI Software Engineering Platform）**——借助 Claude CLI 子进程开发各种软件（含大型系统），个人单机自用，TS 全栈，后期作为 vessel 的核心 Capability App。

关键张力：vessel 仓库内已经有 **HARNESS_*** 系列试点代码：
- `docs/HARNESS_INDEX/ARCHITECTURE/ROADMAP/DATA_MODEL/AGENTS/RISKS/LANDSCAPE.md` 7 份核心文档
- `packages/backend/src/{harness-store.ts,scheduler.ts,context-manager.ts,routes/harness.ts}` 已落地代码（M-1/M0/M1C-B+）
- 当前活跃分支 `feat/eva-M2-loop7-ci-e2e` 仍在跑 M2 Loop 7 CI/E2E

用户明确指出 AISEP 是**全新概念**，与 HARNESS_* 系列**无关**——必须给两套体系明确边界，防止：
1. 代码物理混合（已是 HARNESS_* 在 backend 散布的痛点）
2. 文档语义冲突
3. 维护精力分裂
4. M2 Loop 8+ 进度被打断

## Decision

**AISEP 与 HARNESS_* 长期独立并行**，短期通过物理隔离 + 命名空间 + 红线清单保证零干扰，长期归宿留待 v0 6 个月后再决定。

### 1. 物理边界

| 资产 | HARNESS_* | AISEP |
|------|-----------|-------|
| 代码目录 | `packages/backend/src/{harness-*.ts, scheduler.ts, context-manager.ts, routes/harness.ts}` | `packages/aisep-{protocol,core,workspace,agents,memory,context,cli}/` |
| 文档 | `docs/HARNESS_*.md` | `docs/aisep/*.md` + `docs/adr/vessel/ADR-018+` |
| 记忆库 | vessel git 内 retrospective | `~/.aisep/governance-log/`（外部，不入 git） |
| 分支基线 | `feat/eva-M2-loop*` 系列 | `feat/aisep-bootstrap`（从 dev 开） |

### 2. 命名空间隔离

- AISEP 包前缀统一 `aisep-`（npm 规范），**不**复用 `harness` 命名空间
- 文档目录 `docs/aisep/`（不写入 `docs/HARNESS_INDEX.md`，不在 HARNESS_* 内交叉引用）
- 数据库表名 / SQLite 文件名前缀 `aisep_`（避免与 HARNESS_* `harness_run/stage/...` 表冲突）

### 3. 依赖红线（dependency-cruiser CI 强制）

- ❌ `aisep-*` 包不允许 import `packages/backend/`（含 HARNESS_* 代码）
- ❌ `backend` 不允许 import `aisep-*`（v0 阶段；等 Capability 装回时另起 ADR）
- ❌ 文档：`docs/HARNESS_*.md` 不引用 `docs/aisep/`，反向亦然

### 4. 维护策略

- **HARNESS_*** 系列**保留**，继续走 M2 Loop 8+ 进度，不受 AISEP 影响
- AISEP v0/v1 作为独立 spiral 演进
- 长期归宿（v0 6 个月后再定）三种可能：
  - (a) 两套并存：HARNESS_* 服务 vessel 自身 SDLC，AISEP 服务跨项目通用开发
  - (b) AISEP 吃掉 HARNESS_*：HARNESS_* 代码逐步迁移到 aisep-* 包
  - (c) HARNESS_* 主动废弃：M2-M4 结束后判断价值，正式 sunset

### 5. 不可逆决策清单

| 决策 | 不可逆性 | 迁移成本 |
|------|--------|--------|
| `aisep-*` 包前缀命名 | 中 | 重命名涉及 N 处 import，但可批量 |
| `~/.aisep/` 跨项目记忆库路径 | 高 | 一旦累积数据，迁移路径需 migration 脚本 |
| stage 切分 10-stage（含独立 architecture） | 高 | 改 stage 数 = 改 SQLite schema + 重跑历史 workspaces |
| TypeScript 全栈 | 极高 | 全栈语言切换 = 完全重写 |
| protocol 包 schema（zod 定义） | 高 | 协议变更影响所有 stage executor + workspace artifact |

以上决策**必须**在 architecture stage Phase A 完成 7 问 anchor gate 后才能落地（详见 [docs/aisep/03_architecture-stage-spec.md](../../aisep/03_architecture-stage-spec.md)）。

## Consequences

### Positive

- HARNESS_* M2 Loop 不受打断，按既定节奏推进
- AISEP 从 day 1 物理隔离，避免 packages/backend "harness 试点代码与 Eva 业务混合"的历史重演
- 两条 spiral 各自独立 retrospective，可并行学习
- 长期合并/废弃决策延后到信息充分时再做

### Negative

- 短期文档维护双轨（HARNESS_*.md + docs/aisep/）
- 用户切换语境时需明确"我现在在哪条轨道"
- 跨项目记忆库 `~/.aisep/governance-log/` 与 vessel 内 `docs/retrospectives/` 长期冗余

### Rollback

如果 6 个月后判断 AISEP 路线失败：
- 删除 `packages/aisep-*` + `docs/aisep/` + `~/.aisep/`
- vessel 主线零影响（红线 R1/R2 已保证）
- HARNESS_* M2-M4 继续

## Alternatives Considered

### A. AISEP 吃掉 HARNESS_*（v0 day 1 合并）

❌ **拒绝**——HARNESS_* M2 Loop 7 CI/E2E 正在跑，强行合并会打断既有进度；且 AISEP 自身设计未稳定（10-stage 才刚定型），现在合并等于在沙地上盖楼。

### B. AISEP 作为 HARNESS_* 的下一版（重命名 HARNESS_* → AISEP）

❌ **拒绝**——HARNESS_* 已经有 M-1/M0/M1C-B+ 沉淀，用户认知里"HARNESS"和"AISEP"是不同概念；强行重命名会丢失既有约定和检索锚点。

### C. 独立 git repo（vessel-aisep）

❌ **拒绝**（[plan 候选方案 #2](../../../plans/ai-vessel-vessel-bubbly-noodle.md)）——dogfood 摩擦大、pnpm workspace 联调断、个人自用不需要分发；同 monorepo 独立 packages 即可达到 ≈90% 物理隔离效果。

## References

- [Plan 完整文档](`~/.claude/plans/ai-vessel-vessel-bubbly-noodle.md`)
- [ADR-000 adopt-eva-codebase-as-vessel-foundation](ADR-000-adopt-eva-codebase-as-vessel-foundation.md)
- [HARNESS_INDEX](../../HARNESS_INDEX.md)（保留，不引用 AISEP）
- [docs/aisep/01_vision_scope.md](../../aisep/01_vision_scope.md)
- [docs/aisep/02_methodology-v0.1.md](../../aisep/02_methodology-v0.1.md)
- 调研依据：4 路 /survey 调研（DAG topology + 经典 SDLC + TOGAF/ArchiMate + architecture review readability）
