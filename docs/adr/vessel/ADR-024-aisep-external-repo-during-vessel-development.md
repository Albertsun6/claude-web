# ADR-024: AISEP 拆出独立 repo 在 vessel 完善期独立演进（先拆后合）

- **Status**: Accepted
- **Date**: 2026-05-15
- **Deciders**: yongqian
- **Tags**: governance, scope-boundary, capability-app, repo-topology
- **Supersedes**: [ADR-018](ADR-018-aisep-vs-harness.md)（"短期物理隔离 / 长期不拆"主张）
- **Related**: ADR-022（AISEP v2 fan-in，单驻留 vessel-aisep）

## Context

ADR-018 决定的"短期同 monorepo 物理隔离"4 天后（2026-05-11 → 2026-05-15）发现流程层痛点：

- **git history 混**：vessel 主线 + AISEP 试点 commit 交错在 `dev` 分支
- **PR diff 视野混**：改 vessel 业务的 PR 偶尔带 aisep 文件改动
- **CI 共阻塞**：AISEP 测试挂 → vessel hotfix 也卡（`.github/workflows/ci.yml`）
- **dogfood commit 归属混**：AISEP 在 cwd=vessel 跑时，AISEP 自身代码改动 + 给 vessel 改的业务代码进同一 history
- **Steward V0 主 backlog 被稀释**：AISEP 任务进 `docs/BACKLOG.md`，违反 vessel I1 source-of-truth

代码层（dependency-cruiser R1/R2 强制 + grep 验证）从未有 import 耦合，ADR-018 物理隔离是成功的——但流程层是 ADR-018 没论证的角度。

同时确认：
1. AISEP 的 dogfood target 主要是 AISEP 自己（v3 self-host），不是 vessel
2. AISEP 长期归宿仍是作为 Capability 装回 VesselCore，但需 vessel 基本完善
3. 不为分发——vessel-aisep 仍 private，仅个人单机自用

## Decision

**先拆后合**：

1. **现在**：把 AISEP 资产（6 个 `packages/aisep-*` + `docs/aisep/` + 8 份 proposal + 22 份 review + ADR-018 副本 + ADR-022）通过 `git filter-repo` 搬到独立 repo [github.com/Albertsun6/vessel-aisep](https://github.com/Albertsun6/vessel-aisep)，保留 48 条 AISEP commit + `aisep-protocol@0.3.0` tag
2. **独立演进期**：AISEP v0 → v1 → v2 → v3 self-host 在 vessel-aisep 内自管 backlog / CI / dogfood，零 import 引用 vessel
3. **vessel 主线优先**：vessel 继续推进 PIM / iOS UI / Capability runtime，不被 AISEP 节奏拉扯
4. **合回触发**：vessel 基本完善由用户判定（**不预先定义"完善"标准**——避免 6 个月前脑补未来），那时 AISEP 作为 Capability 装回 VesselCore
5. **合回方式**：候选 git submodule / git subtree --squash / Capability manifest only，**届时另写 ADR 决定**

### 物理边界（拆分后）

| 资产 | vessel mainline | vessel-aisep |
|------|----------------|--------------|
| 代码 | `packages/{backend,frontend,ios-native,shared}/` | `packages/aisep-*/`（6 个包） |
| 文档 | `docs/HARNESS_*.md`, `docs/USER_MANUAL.md`, vessel ADR | `docs/aisep/`（4 specs + USER_MANUAL + 12 retro + borrowed/research） |
| ADR-018 | 保留（Status=Superseded by ADR-024） | 保留副本（dual-residence note） |
| ADR-022 | **删**（单驻留 vessel-aisep） | 保留 |
| ADR-024（本文件） | 唯一驻留 | 不复制 |
| 跨项目记忆库 | 无 | `~/.aisep/`（git 外，两 repo 共享） |
| 决策档案 | `docs/research/unified-memory-abstraction-2026-05-11.md` | 不复制（README 加 cross-link） |

### 依赖红线（运行时）

- `vessel-aisep` 0 引用 vessel（v0/v1/v2 期间）
- `vessel` 0 引用 `@vessel/aisep-*`（dep-cruiser R2 已从 vessel 主线移除，因为不再有 aisep 包可禁；vessel-aisep 内保留 R6）
- ~/.aisep/ 跨项目共享（AlphaEvolve evolution_log + reference-library）

### Dogfood 操作流（v0/v1/v2）

AISEP 在 `cwd=~/Desktop/Vessel` 跑时：

| Commit 类型 | 落在哪个 repo |
|---|---|
| AISEP 自身代码改动 | vessel-aisep |
| AISEP 给 vessel 改的业务代码 | vessel（你 review 后 commit） |
| AISEP run trace / artifact | `~/.aisep/` |

v3 self-host 时 cwd=vessel-aisep，commits 全部落 vessel-aisep，自闭环。

## Consequences

### Positive

- vessel 主线视野彻底清空（git history / PR / CI / BACKLOG / README 全部）
- AISEP 演进不被 vessel 节奏拉扯，可独立 spiral
- v3 self-host 硬约束自动满足
- ~/.aisep/ 跨项目共享不变
- Steward V0 source-of-truth 不被 AISEP 任务稀释

### Negative

- 短期文档维护双轨（vessel-aisep README + vessel docs/research/unified-memory-abstraction）
- 合回时需要 subtree merge 或重新 import，需另写 ADR
- 改 `aisep-protocol` zod schema 时无法 pnpm workspace 联调到 vessel（直到 Capability 装回）—— v0/v1/v2 期间无影响，因为 vessel 0 引用 aisep

### Neutral

- AISEP 自己未来引入 Steward 协议、telemetry、deploy 链等是否照搬 vessel 模式，单独决定
- `~/.aisep/` 备份策略（Time Machine + 可选 cron 推 private GitHub backup）单议

## Rollback

如果半年后判断"先拆后合"路线失败（极小概率）：

1. vessel-aisep main 冻结 1 周（避免 race）
2. vessel 主线 `git subtree add --prefix=packages/aisep-{name} https://github.com/Albertsun6/vessel-aisep main --squash`（每包独立 prefix 更干净）
3. 写新 ADR 记录回滚理由
4. vessel-aisep repo 保留作为历史源（不删）

反悔成本：低（subtree merge 是 git 原生能力，无外部依赖）。

## Alternatives Considered

### A. 同 monorepo 拆 `apps/aisep/` 子目录

❌ 不解决 git history / PR diff / dogfood commit 归属——3 个流程层痛都没动。

### B. 完全保留同 monorepo + 工作流约束（PR 命名前缀 / conventional commit / CI path filter / 独立 release tag prefix）

❌ commit 归属仍混；v3 self-host 时 git log 仍分不清 AISEP 自我演进 vs vessel 业务。

### C. vessel 进 AISEP 当 workspace（AISEP 是元 repo，vessel 是被管理的 workspace）

❌ 时序错位（AISEP v0/v1 不成熟做 vessel 的唯一入口 = 拿生产做沙盒）+ 概念错位（vessel 是日用产品，不是 AISEP 的练习对象）。详细分析见架构对话记录。

### D. v3 启动前才拆（ADR-018 原意"6 个月后再定"）

❌ 流程层痛已经在累积，等到 v3 启动时（≥ 4 周后）vessel 主线 git history 会更乱；早拆成本低，晚拆只是延迟。

## References

- vessel-aisep repo: [github.com/Albertsun6/vessel-aisep](https://github.com/Albertsun6/vessel-aisep)
- 首次 split commit (vessel-aisep): `b351e08`（bootstrap configs）
- vessel mainline split source commit: `78c4f73`（PR #89）
- [docs/research/unified-memory-abstraction-2026-05-11.md](../../research/unified-memory-abstraction-2026-05-11.md)（支撑隔离决策的内存抽象研究，留 vessel 主线）
- [ADR-018](ADR-018-aisep-vs-harness.md)（原决策，Status=Superseded）
- 架构讨论：本次拆分前的完整对话记录（4 轮：能否分离 → vessel 进 AISEP 分析 → 制品管理 → 方案）
