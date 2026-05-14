# Architecture Review — AISEP v2 fan-in proposal (v1 DRAFT)

**Reviewer**: harness-architecture-review
**Model**: claude-opus-4-7 (1M ctx)
**Date**: 2026-05-13 17:50
**Files reviewed**:
- docs/proposals/aisep-v2-fan-in.md (v1 DRAFT)
- docs/proposals/aisep-v1-fan-out.md (precursor, for delta analysis)
- packages/aisep-protocol/src/stage.ts (current schema)
- packages/aisep-protocol/src/version.ts (current `0.3.0`)
- packages/aisep-protocol/package.json
- packages/aisep-core/src/runner.ts (`runFanOutParent` baseline)
- packages/aisep-core/src/scheduler.ts (`nextReady` pure function)
- packages/aisep-agents/src/claude-executor.ts (F3 timeout retry impl)
- packages/aisep-cli/src/commands/run.ts (CLI surface)
- docs/adr/vessel/ADR-006-schema-evolution.md (the *actual* schema migration ADR)
- docs/adr/vessel/ADR-010-docs-organization.md (mis-cited as schema-migration policy)
- docs/aisep/retrospectives/pilot-10-real-business-dogfood-2026-05-13.md (F3 rationale)

## Summary

- Blockers: **2**
- Majors: **4**
- Minors: **3**
- 总体判断：**ACCEPT-WITH-CHANGES** —— 方向、契约骨架、ADR-lite 决策本身都站得住，可以推进到 phase 2 / 实施；但 ADR 引用错位 + Q1/Q5 论据与现有代码不一致 + schema 适用范围扩张未显式落到 zod，这三处必须先修，否则 v0.2 仍然是 "DRAFT contradict reality"，无法直接进 implement gate。

## Required Review Dimensions (numeric)

| 维度 | 分 (1-5) | 说明 |
|---|---|---|
| 架构可行性 | 4 | β stage-pair + Candidate B 都是干净选择；schema 扩张面比作者描述大 1 圈 |
| 里程碑可执行性 | 3 | 出口条件是 outcome-based 但缺 "v0.3 ↔ v0.4 cross-version round-trip 测试" 这条硬门禁 |
| 垂直贴合度 | 5 | 1-人企业级 multi-module 并行 patch 是真实驱动；没有 SaaS / multi-user 漂移 |
| 风险控制 | 3 | 6 条 risk 抓住主要面；但漏 schema 校验扩张副作用 + retry 与 abort 信号的交互 |
| 当前开工成熟度 | 3 | 修完 2 个 BLOCKER + 4 个 MAJOR 即可进 phase 2 / implement |

---

## 必须先改

### [BLOCKER-1] ADR 引用错位 —— "ADR-0010" 不存在，schema 迁移策略实际是 ADR-006

- **Where**: aisep-v2-fan-in.md §Scope 第 4 条、§Q1、§7-anchor "Rollback"、§Dependencies、§ADR-lite Decision 3 —— 共 5 处引用 "ADR-0010 schema migration"。
- **Lens**: 架构可行性 / 风险遗漏
- **Issue**: 仓库里 ADR 编号是 3 位（`ADR-010-docs-organization.md`），而真正讲 schema 演进的是 `ADR-006-schema-evolution.md`。"ADR-0010" 这个标识在仓库里不存在。更要命的是 **ADR-006 的核心原则跟 v2 提案的 0.4.0 MAJOR-MINOR 论据不符** —— ADR-006 §"5 条原则" 第 5 条说 "breaking change 仅跨 major（v1.x → v2.0）+ 必须有 migration 脚本"，且 §禁止操作 明确 "❌ DROP COLUMN / DROP TABLE"。v2 提案的 "v0.4.0 binary refuses to read v0.3 state.json without `--accept-schema-bump`" 介于 ADR-006 的 MINOR 与 MAJOR 之间，**不是 ADR 已经背书的姿势**，需要在 ADR-lite 里显式说明这是个新增条款（schemaVersion 0.x ⇒ MINOR break 可接受单用户场景）或直接 supersede ADR-006 第 5 条。
- **Why blocker**: schema migration 是 ADR-006 §"4 类硬触发 #8" 显式监管的 4 大不可逆操作之一，引用错 ADR 会让 dogfood gate 和后续 reviewer 把 "0.4.0 bump 已经过 ADR 审批" 当既成事实，但实际上 ADR-006 还没承认这种姿势。在 1-binary-1-user 场景下决策本身可能合理，但**论据链断裂**会绕过 CLAUDE.md hard-constraint 检查。
- **Suggested fix**:
  1. 全文 `ADR-0010` → `ADR-006` 替换；
  2. §ADR-lite Decision 3 增加一句：``"ADR-006 §'breaking change 仅跨 major' 在单用户 0.x 阶段先 supersede —— v0.x 内允许 MINOR 级别 wire incompatibility（前 1.0 stabilization 期惯例），1.0 后回归 ADR-006 原文"``；或
  3. 起一个 supersede-light：`ADR-022-aisep-v2-fan-in.md` 提到的 promotion gate 里加 "本 ADR 在 schemaVersion < 1.0 范围内 supersede ADR-006 §5"。

### [BLOCKER-2] schema 扩张面比作者描述大 1 圈 —— `superRefine` 的 "implement-only" 限制必须被显式拆除

- **Where**: aisep-v2-fan-in.md §Scope 第 1 条（"verify (parent, 3 children) → review (parent, 3 children) → integrate (parent, 1 aggregation)"）vs packages/aisep-protocol/src/stage.ts:146-152 / 168-174 现在的 `superRefine`。
- **Lens**: 架构可行性
- **Issue**: 当前 zod schema 对 `fanOutRole === "parent"` 和 `fanOutRole === "child"` 都硬编码 `if (run.stage !== "implement")` 报错。v2 提案要让 verify / review / integrate 都能当 fan-out parent / fan-in parent，**必须删掉这 6 行 invariant 才能让 schema 通过验证**。但 §Q1 / §7-anchor "Data model" 只描述了 "added `affects: string[]`" + "`subStages` semantics extended on non-implement stages"，没有展示 schema diff、没有列出哪些 stage 进入 fan-out 白名单（是 verify+review+integrate 三个？还是除 retrospect 外全开？），更没有说 retract 这个 superRefine 之后怎么防止 plan / contract / intake 这些天然不适合 fan-out 的 stage 被误用 —— 这是 v1 当初保留 implement-only 限制的原因。
- **Why blocker**: 这块没说清楚，phase 2 / implement 阶段会被迫"边写边补 superRefine 白名单"，而 schema 决策在 1-binary 单用户 + 1 个 SDK 客户端的场景下属于 ADR-006 §"4 类硬触发 #8" 监管对象，**事后改 fanOutRole superRefine 等价于在 production 改 schema 验证规则**，违反 CLAUDE.md §"Layered Spiral Delivery" 阶梯层（schema 锁定）的硬约束。
- **Suggested fix**:
  在 §Q1 后新增 §Q1b "Fan-out / fan-in stage 白名单"：明确 v2 把 fanOutRole 白名单从 `{implement}` 扩到哪一组 stage（建议：`{implement, verify, review}`；integrate 因为 §Scope 写明 "1-child aggregation"，从语义上它是 fan-in 终点而非 fan-out 起点，应保持 `normal`）。给出新的 superRefine 伪码：

  ```ts
  const FAN_OUT_ALLOWED_STAGES = new Set<AisepStage>(["implement", "verify", "review"]);
  // ...
  if (run.fanOutRole === "parent" && !FAN_OUT_ALLOWED_STAGES.has(run.stage)) {
    ctx.addIssue({ ... "fanOutRole='parent' only allowed for stages in FAN_OUT_ALLOWED_STAGES" });
  }
  ```

  以及 §"Test matrix" 把 zod schema 测试从 ~12 case 加到 ~16（覆盖白名单 inside / outside / mismatch parent-child stage）。

---

## [MAJOR] findings

### [MAJOR-1] Q5 retry-child 语义 vs F3 timeout retry 的"一致性"论据反了

- **Where**: aisep-v2-fan-in.md §Q5 "**Recommendation**: α with a new attempt entry (consistent with F3)."
- **Lens**: 架构可行性 / 风险遗漏
- **Issue**: F3 timeout retry 的实际实现 (`packages/aisep-agents/src/claude-executor.ts:209-257`) 在 `while (true)` 循环里 retry，**整轮只 emit ONE `appendAttempt`**（成功 → 一条 succeeded 记录；失败 → 一条 failed 记录）。换言之 F3 retry 是 "transparent within a single attempt"，stage_run 的 `attempt[]` 长度不变。
  
  v2 提案 Q5 的 α 方案是"existing stage_run row's `status` flips `failed → running → succeeded`, attempt log grows" —— 这是 **append 一条新 attempt**，跟 F3 行为不一样。把这两件事用"consistent with F3"搭起来，要么 (a) implement 时会发现 F3 实际语义 ≠ Q5 α 想要的语义，导致 retry-child 跟 F3 走 2 套不同代码路径；要么 (b) reviewer 会被这条"一致性" 论据误导，下游 review 也按 transparent retry 推断。
- **Why**: 影响 §"Test matrix" 的 retry-child 测试设计（~8 个 runner case），以及 §Dogfood gate 第 2 条 "1 of 3 children retried via `--retry-child` ... and re-aggregated successfully" 的判定标准 —— 是看 `attempts.length` 是否 +1，还是看单个 attempt 的 retry counter。
- **Suggested fix**: §Q5 重写 recommendation 段，明确：

  > Q5 选 α（id-stable，single stage_run row），但 retry 语义是**显式 append 新 attempt**（attemptN+1），而非 F3-style transparent retry。理由：F3 解决"模型还在 reasoning，SIGTERM 误判"，retry 对用户透明；retry-child 是用户**显式发起**的 forensic 行动，必须留可审计的 attempt 痕迹。两者代码路径独立。

  并在 §7-anchor "Irreversibility" 加一句 "retry-child 不修改既有 attempt 记录，新 attempt 追加；既有 failure 不能 'unfail'"。

### [MAJOR-2] v1 proposal 预留的 `predecessorIds[]` 路径被静默放弃，需显式说明

- **Where**: packages/aisep-protocol/src/stage.ts:120-121 注释 ``"v0: single predecessor / single successor (linear). v2+ adds fan-in by lifting predecessorId to a separate predecessors[] field."`` + aisep-v1-fan-out.md L119-121 ``"verify stage takes parent implement stage_run as its **single `predecessorId`**（preserves current runner contract — no `predecessorIds[]` in v1）"``。
- **Lens**: 架构可行性
- **Issue**: v1 proposal 明确写过"v2 会引入 `predecessorIds[]`"，schema 注释也这么记录在案。但 v2 实际方案是**走 `subStages` 镜像** —— upstream parent 的 `subStages` 数组 + downstream parent 的 `subStages` 数组一一映射。这是一个**正确但与既有书面预期不符**的转向，需要在 §Scope 或 §Q3 显式说明：

  > v2 选 β stage-pair only，意味着 v0 stage.ts 注释里的 `predecessorIds[]` 计划在 v2 不实施 —— fan-in 通过 upstream/downstream 双方各自的 `subStages` 数组镜像表达，单方向 predecessor 链保持不变。`predecessorIds[]` deferred to v3 cycle（if cycle re-planning ever needs true N→1 incoming edges）。

- **Why**: 缺这条说明，下一个翻 schema 的 Claude 会试图加 `predecessorIds[]` 字段，结果跟 v2 设计冲突。这是 LEARNINGS.md §1 "M0 必须先固定 schema version" 的直接应用 —— **schema 是阶梯层，任何"以前写过、现在不做"的字段计划都必须显式 revoke**。
- **Suggested fix**: §Q3 recommendation 末尾加一段 "Implicit revocation"；同时 v2 实现 PR 里改 stage.ts:120-121 注释，把 ``"v2+ adds fan-in by lifting predecessorId to a separate predecessors[] field"`` 改成 ``"v2 fan-in uses subStages mirroring on both sides; predecessorIds[] is not introduced (revoked from v0 plan, see docs/proposals/aisep-v2-fan-in.md §Q3)"``。

### [MAJOR-3] R1 "retry races with parent settling" 的 mitigation 太单薄

- **Where**: aisep-v2-fan-in.md §Risk register R1。
- **Lens**: 风险遗漏
- **Issue**: 当前 mitigation 是 ``"retry-child refuses to start if parent.status === 'running'; lock via in-process mutex"``。问题是 v1 fan-out 的 cancel 设计 (runner.ts:294 `cancelController.abort()` + claude-executor.ts:222-225 abort 短路) 让"parent.status=running 但所有 in-flight children 都已收到 abort 信号"成为常态。如果用户在 `running + aborting` 窗口 (5-10 秒，SIGTERM → SIGKILL grace) 之间发起 `--retry-child`，in-process mutex 不能区分"父还在运行" vs "父在 abort 中"，会拒绝合法 retry；或者更糟 —— mutex 是 in-process，多个 `aisep run` 进程之间不互斥，跨进程 race 没堵。
- **Why**: combinatorial state space 是 R5 已经列出的高风险项，R1 这块没护住的话 R5 的"unit-test ≥ 25 cases" 也漏 cancel × retry × concurrency 三轴。
- **Suggested fix**:
  1. R1 mitigation 改为 "retry-child requires parent.status ∈ {`failed`, `succeeded`} 终态；`running` / `cancelling` 均拒绝并 echo 当前 in-flight child id 列表 + 建议等待 `aisep run --status` 显示 terminal"；
  2. 加一条 R7 "cross-process retry race: 第二个 `aisep run` 进程开 retry-child 时探测 workspace 锁文件 (`.aisep/.lock`，存 pid + 起始时间)，存在且 pid alive 即 refuse；增设 abandoned-lock 兜底（pid 不在）"；
  3. §"Test matrix" runner ~8 case 改 ~12，加 retry × cancel 交互的 3 个 case + 跨进程 fail-fast 1 个 case。

### [MAJOR-4] 出口条件缺 "v0.3 ↔ v0.4 cross-version round-trip" 硬门禁

- **Where**: aisep-v2-fan-in.md §Dogfood gate（6 条 ship 条件） + §Test matrix（aisep-protocol "~12 ... cross-version round-trip (0.3 ↔ 0.4)"）。
- **Lens**: 里程碑可执行性 / 风险遗漏
- **Issue**: §Test matrix 里写了 cross-version round-trip 的测试意图，但 §Dogfood gate 6 条 ship 条件**没把它列为硬门禁**。Ship 条件第 5 条只是 ``"`pnpm -r test` post-implementation ≥ current baseline (366 tests)"``，这条**不能保证** "v0.3 workspace + v0.4 binary"、"v0.4 workspace + v0.3 binary" 两个方向都被覆盖。ADR-006 §"5 条原则" 第 1 条要求 schemaVersion 顶部加版本号 → migration 必须 dry-run 可演练；v2 提案的 `--accept-schema-bump` flag 没有 dry-run 路径。
- **Why**: BLOCKER-1 提到 ADR-006 supersede 的前提是"单用户场景可以放宽 MAJOR break"，但放宽的代价是 dogfood gate 必须把 cross-version 行为机器验证一遍。否则用户事后被 "v0.4 binary 拒读 v0.3 state.json，但 v0.3 binary 静默忽略 v0.4 新增字段" 这类不对称坑坏。
- **Suggested fix**: §Dogfood gate 新增 2 条：
  - "v0.3 state.json 喂 v0.4 binary，首次 `aisep run` 不带 `--accept-schema-bump` → 必须以**清晰错误**而非崩溃退出（错误信息含 `aisep migrate --to 0.4` 提示）；带 flag → 进入 fan-in path"。
  - "v0.4 state.json 喂 v0.3 binary → 必须以 schema validation error 拒载（v0.3 zod superRefine 不识别 `affects` / 新 fanOutRole stage），不能静默 drop 字段"。

---

## [MINOR] findings

### [minor-1] 商品引用 commit SHA 全部对得上，但 §Context "v1 fan-out" 部分省略了 patch_set artifact kind 的 schema 改动

- **Where**: aisep-v2-fan-in.md §Context "What v1 fan-out gave us"。
- **Lens**: 架构可行性
- **Issue**: 描述 patch_set 时只提"manifest aggregation"，没说明 patch_set 在 v1 已经作为 `AisepArtifactKindSchema` enum value 落库。v2 是否扩展 `patch_set` 的 manifest schema（加 `affects` 回流？加 per-child status 元信息？）是 implement 阶段会遇到的问题，§Scope 没明确。
- **Suggested fix**: §Scope 第 1 条尾巴加："`patch_set` artifact manifest 结构在 v2 不变；fan-in 侧的 per-child status 来自 stage_run 行而非 manifest"。

### [minor-2] §Q1 中 "any new required field is a MAJOR.MINOR bump" 是空气引文

- **Where**: aisep-v2-fan-in.md §Q1 引述 "ADR-0010 says: '**any new required field is a MAJOR.MINOR bump**'"。
- **Lens**: 架构可行性
- **Issue**: 我 grep 了整个 `docs/adr/vessel/` 没找到这句原文。ADR-006 §"5 条原则" 接近但不完全等价，且 ADR-006 5 项原则**不区分 MAJOR vs MINOR** 这么细 —— 只说 "breaking change 仅跨 major"。BLOCKER-1 已经覆盖 ADR 编号错位；这里追加：v0.2 在补 ADR-006 引用时，**这条空气引文要么找到真出处，要么换成"per ADR-006 §禁止操作 + §"5 条原则" 第 5 条"**。
- **Suggested fix**: 与 BLOCKER-1 一起处理；引用 ADR-006 时不要造原文，复读其实际条款。

### [minor-3] §"Open issues" 第 4 条 "report.html size budget — 850 cells" 算式可能低估

- **Where**: aisep-v2-fan-in.md §"Open issues post-DRAFT" 第 4 条 "5 children × 10 stages × 17 contract_grep checks = 850 cells"。
- **Lens**: 风险遗漏
- **Issue**: §Scope 第 1 条说 implement/verify/review 都 fan-out（3 个 stage 各有 5 child），不是 10 个 stage 都 fan-out。17 contract_grep × 3 fan-out stages × 5 children = 255，加上其他 stage 的非 fan-out timeline ≈ 7 行 × 1 = 7，总 ≈ 262 cell。如果 fan-out 默认 4 children（plan-roadmap cap），数字更小。R6 mitigation "report-builder pre-truncates" 还是对的，但算式本身**虚高 3 倍**，应作为非 blocking 校正。
- **Suggested fix**: §"Open issues" 第 4 条改成 "最坏估计 3 fan-out stage × 5 children × 17 contract_grep ≈ 255 cell + 7 个非 fan-out stage 各 1 行 timeline"；bench 数据 phase 2 实测后补。

---

## 四维评审

### 架构可行性 (4/5)

整体抓住了 fan-in 的核心 —— β stage-pair only + Candidate B (`nextReadyFanInDispatch` 独立纯函数) 是当前 R6 boundary 下的干净选择，不破坏 runner / scheduler 已有的 pure-function 边界。`subStages` 镜像方案（upstream parent 的 `subStages` 数组 + downstream parent 自己的 `subStages` 数组）比 v0 stage.ts 注释里预设的 `predecessorIds[]` 方案更轻 —— 不引入新的关系字段，复用已有 fanOutRole 三态枚举。

但有两块抽象空缺会变成债务（BLOCKER-2 + MAJOR-2）：(a) `superRefine` 的 implement-only 限制要被拆除而提案没把它落到 schema diff，(b) `predecessorIds[]` 这条 v0 注释 + v1 proposal 共同预设的路径需要被显式 revoke，不然下一个 Claude 会按注释加字段。两者都是 CLAUDE.md §"Layered Spiral Delivery" 阶梯层的硬约束 —— schema 决策必须 up-front lock。

Q4 grep-time `affects` 冲突检测的位置选得对 —— 落在 runner 而非 executor，跟 R6 boundary 一致；且选了 fail-terminal (α) 而非 apply-time (β)，跟 v1 plan-roadmap "force terminal user decision on schema-validator failure" 的姿势一致。

### 里程碑可执行性 (3/5)

§Dogfood gate 6 条 ship 条件是 outcome-based，没有 calendar-based 的"按时间窗发布"陷阱（这是 LEARNINGS.md §4 "防 agent 刷通过率" 的体现）。3-child 实测 + retry-child 实测 + 冲突检测 trigger 测 + report.html 渲染测 + test baseline 不退 + 0 dep-cruiser，覆盖了 happy / failure / governance / regression 四个面。

主要 gap：(a) MAJOR-4 提的 cross-version round-trip 没进 ship 条件硬门禁；(b) Pilot-12 没说样本数 / 任务难度 —— 跟 LEARNINGS.md §4 "成功率必须绑定任务难度" 冲突，需要至少声明 "Pilot-12 是 ≥ 3 文件、≥ 2 包跨边界的真业务任务，不是 toy / mock"；(c) 没说 `aisep migrate --to 0.4` 是 v2-blocking 还是 deferred —— §Migration path 第 4 条 + §Open issues 第 2 条措辞矛盾，前者写 "deferred to first user request"，后者列为 open issue。

### 企业管理系统贴谱性 (5/5)

§Why now 第 3 条 "1-人企业级 multi-module 多包并行 patch (backend + ios + admin-UI)" 是真实场景驱动，跟用户 MEMORY.md "用户=超级个体做企业级系统" 的定位贴合 —— v2 不是为多人协作做，而是为单用户**单次提交大幅度跨包 patch** 做。这正好是 enterprise-admin vertical 高频出现的 workload（一个 CRUD 改动要同时改 schema + backend route + ios view + 表单 + 报表）。

§Out 部分主动排除"cross-child memory sharing during execution"和"自动 merge 冲突"两个看起来吸引人的功能 —— 这是正确的克制，二者都是企业级垂直**用不到**的多 agent 协同特性。proposal 也明确写"single-binary-single-user remains assumed"，没向 SaaS / multi-tenant 漂移，符合 CLAUDE.md hard constraint。

唯一可补：§Scope 没提到 vector-memory (M1C-B spike) 跟 fan-in 的交互 —— 5 个 child 同时 retrieve memoryProvider 会不会撞 sqlite WAL 锁 / fastembed worker pool。这块可放到 v3 cycle 评估，不阻塞 v2。

### 风险遗漏 (3/5)

6 条 risk 抓住了 schema bump (R4) / 状态空间爆炸 (R5) / 资源开销 (R3) 三个主线。但 MAJOR-3 提到 R1 mitigation 太薄，且漏掉两条风险：

- **R7 (proposed)**: retry × cancel × concurrency 三轴交互（见 MAJOR-3）。
- **R8 (proposed)**: schemaVersion 校验扩张副作用 —— 当前 zod superRefine 改动一旦 ship 0.4，v0.3 workspace 即使没用 fan-in、单纯 load 老 state.json 都会被新 zod refuse（因为 default fanOutRole + subStages 在新 superRefine 下要走新分支）。§7-anchor "Compatibility" 写了"v0.3 workspaces continue to load"，但需要测试证明，不能口头保证。

R6 (report.html bloat) 算式虚高 (minor-3)，整体 severity 应从 LOW 维持 LOW 但 mitigation 文案要改。

---

## Strong points (不要在 v0.2 丢失)

1. **β stage-pair only 的克制** —— Q3 决策正确地避免了 α 的状态机爆炸。phase 2 reviewer 可能会推 α "更通用"，请坚持 β。
2. **`affects: string[]` required, no default `[".*"]`** —— Decision 2 是单用户场景下罕见的 strict-by-default 选择，跟 LEARNINGS.md §1 "schema 锁定" 一致。Q1 答辩里这条要保住，别在 phase 2 retreat 到 optional。
3. **冲突检测 grep-time 落 runner** —— R6 boundary 没破。
4. **out-of-scope 显式列 4 条** (nested fan-out / cross-child memory / auto-merge / dynamic re-plan) —— 把"以后可能想做"的诱惑物显式钉死，符合 CLAUDE.md hard constraint 文风。
5. **`patch_set` artifact 不动** (minor-1 的弦外之音) —— 不重写既有 manifest 结构，向后兼容性强。

---

## Open Questions 强意见（只回有强判断的）

- **Q1 (schema bump)**: **0.4.0 正确**。`affects: [".*"]` default 会让冲突检测变成"功能在但无人用"，跟 §Why now 第 3 条 "1-人企业级 multi-module" 真实需求冲突。但 **BLOCKER-1 必须先修**（ADR 引用错位）。
- **Q2 (scheduler API)**: **Candidate B 正确**。`nextReady` 当前 70 行 pure-function 已经在试图同时表达 "ready batch + currentlyRunning + allChildrenTerminal + succeededCount + failedCount"，再加 fan-in dispatch 会让返回值结构爆炸。分函数 + cli 层 dispatcher 决定调哪个，比 mode flag 干净。
- **Q3 (per-stage vs stage-pair)**: **β 正确**。α "verify alone 也能 fan-in" 看起来通用但实际把 v3 cycle 的 dynamic-replan 问题提前到 v2，违反阶梯层 "anchor gate 前不开工" 原则。
- **Q4 (conflict detection)**: **α 正确**。fail-terminal + 用户改 plan.md 跟 v1 plan-validator failure 姿势一致；但 mitigation 要补"如果 affects 写错怎么 escape"（见 §"Open issues" 第 5 条）。
- **Q5 (retry semantics)**: **α 正确，但论据要重写**（见 MAJOR-1）。
- **Q6 (report.html viz)**: 没强意见，stacked-timeline 是合理的最小扰动选择。

---

## 建议的下一版改动 (v0.2 实施清单)

1. **[BLOCKER-1]** 全文 5 处 ADR-0010 → ADR-006；§ADR-lite Decision 3 加 supersede 说明（schemaVersion < 1.0 阶段允许 MINOR break）。
2. **[BLOCKER-2]** 新增 §Q1b "Fan-out / fan-in stage 白名单"，给出 superRefine 伪码 + 白名单集合（建议 `{implement, verify, review}`）；§Test matrix protocol case 从 ~12 升 ~16。
3. **[MAJOR-1]** §Q5 recommendation 段重写：retry-child 是 user-explicit 行动，attemptN+1；F3 是 transparent retry，single attempt。两套独立。
4. **[MAJOR-2]** §Q3 末尾加 "Implicit revocation"；实施 PR 改 stage.ts:120-121 注释。
5. **[MAJOR-3]** R1 mitigation 重写为 "parent.status ∈ {failed, succeeded} 终态才允许 retry-child"；加 R7 跨进程锁；§Test matrix runner case 从 ~8 升 ~12。
6. **[MAJOR-4]** §Dogfood gate 加 2 条 cross-version round-trip 硬门禁。
7. **[minor-2]** Q1 引文不要造原文，复述 ADR-006 实际条款。
8. **(non-finding 但建议)** §Pilot-12 描述加 "≥ 3 文件、≥ 2 包跨边界的真业务任务"，跟 LEARNINGS.md §4 "成功率绑定任务难度" 闭环。

---

## What I Did Not Look At

- **Reviewer B (reviewer-cross / cursor-agent gpt-5.5-medium) 的 verdict**（`docs/reviews/aisep-v2-fan-in-cross-2026-05-13-1750.md` 已存在但按 SKILL.md independence 规则未读）。
- **packages/aisep-cli/src/parse-plan-parallel.ts** —— plan.md 解析逻辑（v2 是否复用 v1 解析器 / 改 schema 未覆盖）。
- **packages/aisep-cli/src/report/builder.ts** —— Option E HTML 模板的实际 cell 渲染（minor-3 算式 250 vs 850 没实测）。
- **packages/aisep-agents/templates/{verify,review,integrate}.hbs** —— fan-in 后这些模板是否需要改（每 child 一次渲染 vs 一次性 N child 上下文）。
- **packages/aisep-memory/** —— vector-memory 与 fan-in 并发 retrieve 的交互（前已说明放 v3 cycle）。
- **`aisep migrate --to 0.4` 工具的实际可行性** —— §Open issues 第 2 条留作 phase 2 决定。
- **真实 Pilot-12 任务候选** —— 用户侧任务画像未读。
- **跨 worktree 并发 `aisep run` 行为** —— 单用户但多 worktree 时 R1 / R7 mitigation 是否撑得住。
