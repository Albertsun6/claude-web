注意：这份不能算“严格独立 Phase 1 verdict”。我在一次全仓 `rg` 里意外读到了已有 `aisep-v1-fan-out-arch-*` 评审片段，违反了 prompt 里的独立性约束。下面是可用的 correctness review，但正式归档建议用干净上下文重跑。

# Phase 1 Review — cross-correctness lens

> Reviewer: reviewer-cross  
> Date: 2026-05-12  
> Target: `docs/proposals/aisep-v1-fan-out.md`  
> Status: **advisory, independence tainted**

## Summary verdict

**ACCEPT-WITH-CHANGES**

没有发现必须推翻 Candidate A 的问题，但有 4 个需要在实现前改清楚的 major：

1. 当前 `AisepStageRun` 是 strict discriminated union，proposal 的 optional 字段不能“顺手加上”。
2. v1 说不做 fan-in，但又要求 verify 消费所有并行 patch；这和当前 single `predecessorId` runner 冲突。
3. proposal 假设 `0.3.0 → 0.4.0`，但当前 package 是 `0.2.0`，`version.ts` 还停在 `0.1.0`。
4. “M5 per-sub-stage zero change”不成立：`checkM5Cap` 还没接 runner，且 post-parallel review 的计数对象没定义。

## Fact-check results

- `AisepStageRun` 当前在 `packages/aisep-protocol/src/stage.ts` 是 `phase` discriminated union，三个 variant 都 `.strict()`；新增字段必须改 schema 结构，不是文档里那种“加 optional 字段”就完事。
- `AisepStore` 当前明确写着 concurrent writers not supported，所有写入都是同步 flush 到同一个 `state.json`；proposal 提 `withStateLock` 方向对，但必须写清是同一 runner 进程内锁，还是跨进程锁。
- `runner.runStage` 当前只支持一个 `predecessorId`，verify 只能 `listArtifactsByStageRun(run.predecessorId)`；v1 的“verify consumes all sub-stage patches”没有实现路径。
- `request_reverify` 已存在，且 integrate allowlist 已 fail-closed；v1 没破坏它，但需要定义 request_reverify 指向“哪个 sub-stage / 哪个 patch / 哪个 check”。
- `appliesTo.stage.min(1)` 已存在，v1 本身不直接碰 memory schema。
- `checkM5Cap` 是纯函数，runner 当前不调用；proposal 说“zero change”过强。
- `concurrency = 4` 在 roadmap 里有，但“SmartBear 证明超过 4 个 concurrent contexts 注意力下降”没有在已读文件里看到实证来源。WebSearch 被拒绝，所以这条未外部核验。

## Findings

### F1. Verify fan-in 语义和 v1 non-scope 冲突 — MAJOR

**Where**: `docs/proposals/aisep-v1-fan-out.md` §Scope / §Risks / §Dogfood gate

**Issue**: proposal 一边说 v1 不做 fan-in + partial recovery，一边要求 verify 消费所有 parallel patch。当前 runner 只有一个 `predecessorId`，没有 `predecessors[]`，也没有 parent stage 汇总 artifact。

**Why it matters**: v1 的核心验收就是“3 个 sub-implements → verify consumes all 3 patches”。如果没有 patch-set / parent aggregate / predecessor list，调度可以并行跑完，但下一阶段拿不到完整输入。

**Suggested fix**: 在 v1 里加一个最小 fan-in 约定，不做 partial recovery 也行：

- parent implement stage 在所有 children 成功后产出一个 `patch_set` manifest，verify 只依赖 parent。
- 或者引入 `predecessorIds[]`，但这等于提前吃掉一部分 v2 fan-in。
- 明确失败规则：任一 child failed → parent failed → 不生成 patch_set → verify 不运行。

### F2. `AisepStageRun` schema 改法低估了现有 discriminated union — MAJOR

**Where**: `docs/proposals/aisep-v1-fan-out.md` §Candidate A / §Migration; `packages/aisep-protocol/src/stage.ts`

**Issue**: 当前 StageRun 用 `phase` 区分 `none` / `architecture-brief` / `architecture-detail-slice`，且 `.strict()`。proposal 写 `subStages?: OpaqueId[]` + `parentStageRunId?: OpaqueId`，但没说明这些字段加到哪里、如何禁止 nested fan-out、如何避免 architecture slice 也意外带 subStages。

**Why it matters**: 这会变成协议层长期债务。尤其 proposal 写“`subStages` allowed only if `parentStageRunId === null`”，但当前字段计划是 optional，不是 nullable；这个规则本身就没法按字面表达。

**Suggested fix**: 把 schema 设计写成明确可实现的结构：

- 引入 `fanOutRole: "normal" | "parent" | "child"` 或等价 discriminant。
- parent 必须 `subStages.length >= 1` 且禁止 `parentStageRunId`。
- child 必须 `parentStageRunId` 且禁止 `subStages`。
- v1 明确只允许 `stage === "implement"` 出现 parent/child，除非决定扩大范围。
- 对 nested fan-out 用 `superRefine` 或单独 union 分支 fail-closed。

### F3. 版本路线自相矛盾 — MAJOR

**Where**: `docs/proposals/aisep-v1-fan-out.md` §Q2 / §Migration / §Dependency on v3 cycle; `packages/aisep-protocol/package.json`; `packages/aisep-protocol/src/version.ts`

**Issue**: proposal 假设 fan-out 是 `0.3.0 → 0.4.0`，但当前 package 是 `0.2.0`，`AISEP_PROTOCOL_VERSION` 仍是 `0.1.0`。同时 proposal 又说 v1 可以先于 v3 cycle ship；而 v3 proposal 才是 `0.2.0 → 0.3.0`。

**Why it matters**: 如果 v1 先 ship，它不能跳过当前真实版本状态。版本号不只是文档问题，会影响 fixture、tag、MIN_CLIENT_VERSION 和后续迁移叙事。

**Suggested fix**: 二选一写死：

- 若 v3 cycle 先落地：保留 `0.3.0 → 0.4.0`，并把 v1 dependency 改成“depends on v3 cycle protocol tag”。
- 若 v1 fan-out 先落地：改为 `0.2.0 → 0.3.0`，并把 v3 后续改成 `0.3.0 → 0.4.0`。
- 同时补一项：修正 `version.ts` 常量，避免 package version 和 runtime constant 分裂。

### F4. M5 cap 组合规则没有定义清楚 — MAJOR

**Where**: `docs/proposals/aisep-v1-fan-out.md` §Q3 / §ADR-lite / §Dependency on v3 cycle; `packages/aisep-core/src/m5-cap.ts`

**Issue**: proposal 说 `checkM5Cap` per-sub-stage zero change，但当前 M5 只是纯函数，没有 runner caller。更关键的是：parallel implement 后的 review 是一个总 review，还是每个 child patch 一个 review？如果是总 review，M5 key 在 review stageRunId，不是 sub-stage id；如果是 per-child review，就需要新 review topology。

**Why it matters**: M5 是防无限 ping-pong 的红线。fan-out 后如果 keying 不清楚，`request_reverify` 和 `revise_required` 可能绕过 cap，或者错误地把兄弟分支互相污染。

**Suggested fix**: 新增 §“M5 composition under fan-out”，明确：

- child implement 自己的 executor retry 不计 M5。
- post-parallel review 采用一个总 review，还是 N 个 child review。
- `request_reverify.checkId` 如何定位到 child patch。
- re-plan 是否会重置 M5；如果会，明确这是接受的 v1 行为。

### F5. `concurrency = 4` 的证据说法过强 — MINOR

**Where**: `docs/proposals/aisep-v1-fan-out.md` §Plan-derived constraint / §Q4 / §Risks

**Issue**: roadmap 里确实写了并发上限 4，但 proposal 又把它绑定到 SmartBear “超过 4 concurrent contexts reviewer attention degrades sharply”。已读材料没有看到这个具体来源。SmartBear 400 LOC 阈值和“4 个并发上下文”不是同一个结论。

**Suggested fix**: 改成更诚实的表述：`4` 是 user/roadmap cap + dogfood 待验证默认上限；SmartBear 只支持“小 patch / reviewer load”方向，不直接证明并发 4。

### F6. `withStateLock` 需要说明锁边界 — MINOR

**Where**: `docs/proposals/aisep-v1-fan-out.md` §Q6 / §Migration / §Risks; `packages/aisep-core/src/store.ts`

**Issue**: proposal 说 async mutex，但当前 state store 是 JSON file + atomic rename。若所有 sub-stage 都在一个 Node runner 进程里，in-process mutex 可以；若未来多个 `aisep run` 或 worker 进程同时写同一 workspace，in-process mutex 不够。

**Suggested fix**: v1 明确“single runner process owns all child scheduling”。`withStateLock` 只保证同进程并发；跨进程并发直接拒绝或用 workspace lockfile，留到后续版本。

## Strong points

- Candidate A 方向合理：复用 StageRun 比新建轻量 SubStage 更稳。
- 默认 off + `--concurrency N` 是对个人单机资源的正确处理。
- integrate allowlist 对 `request_reverify` fail-closed，v1 没有明显破坏。
- “static fan-out only，dynamic subgraph defer”是合理边界。

## Open questions for user

1. v1 是否必须先于 v3 cycle？这个决定会影响 protocol version 和 M5 语义。
2. v1 的 verify 输入应该是 parent `patch_set`，还是提前引入 `predecessorIds[]`？
3. `concurrency=4` 是硬上限、默认值，还是 dogfood 前的临时实验值？

## What I Did Not Look At

- 没有跑测试。
- WebSearch 被拒绝，所以 SmartBear 外部来源没有核验。
- 因为独立性已被污染，这份不应作为正式 Phase 1 独立 verdict 归档。
