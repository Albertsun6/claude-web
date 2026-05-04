# Cross Review — HARNESS_META_FREEZE_v0.1

**Reviewer**: reviewer-cross
**Model**: claude-opus-4-7（注：本 SKILL 偏好非 Claude 异质模型；本次 Claude 上跑，效果次之）
**Date**: 2026-05-04
**Files reviewed**:
- docs/proposals/HARNESS_META_FREEZE_v0.1.md（artifact）

**事实核对引用**（非 sibling verdict）：
- docs/HARNESS_RISKS.md / HARNESS_ROADMAP.md §0 / HARNESS_ARCHITECTURE.md §5
- docs/retrospectives/M0.md §4-§8
- docs/proposals/PARALLEL_WORK_ORCHESTRATOR.md §9 OQ7
- git log（最近 30 commit，含 `3d95b37 fix(inbox-store)`）
- ~/.claude-web/ ls 结果

---

## Summary

- Blockers: 1
- Majors: 4
- Minors: 5
- 总体判断：**建议小改后合并** — 1 BLOCKER + 4 MAJOR 修复后即可。不需要重做，但内部矛盾必须先解，否则计划字面执行会卡死。

## Numeric Score

| Lens | Score (0..5) |
|---|---|
| 正确性 | 2.8 |
| 跨端对齐 | N/A（治理决策，无跨端 schema）→ 4.0 占位 |
| 不可逆 | 3.5 |
| 安全 | 4.5 |
| 简化 | 3.0 |

**Overall**: 3.4（5 lens 加权平均；BLOCKER 上限 3.9）

---

## Findings

### B1 [BLOCKER] P0-1 冻结规则 vs P1-7 + §5 Q3 三方直接矛盾

**Where**: §1 P0-1 "做什么" + §1 P1-7 "Exit" + §5 Q3
**Lens**: 正确性 / 简化
**Issue**:
- P0-1 写："冻结期内不写新 ADR / proposal / methodology / framework 升级"
- P1-7 验收要求："RISKS.md 加段 + **ROADMAP §0 加对应原则编号（#21 / #22）**" — ROADMAP §0 是 framework 主原则文件，加新原则就是 framework 升级
- §5 Q3 提议："加 `~/.claude-web/methodology-debt.jsonl` append-only 收集" — 这违反 P0-2 不变量"新增 store 需写 ADR-lite"，但冻结期又不能写 ADR。形成死锁

**Why this is a blocker**: 计划字面执行会自我矛盾。Q3 的"methodology-debt.jsonl"在冻结期既不能创建（缺 ADR）又不能不创建（dogfood 暴露问题无登记处）。P1-7 的 ROADMAP §0 #21/#22 同样卡住。

**Suggested fix**:
1. P0-1 改加豁免段："本计划 7 条 ship 时形成的 ADR / RISKS / ROADMAP §0 升级算**冻结启动批**，与 P0-1 同时生效；之后才进入冻结状态。"
2. §5 Q3 改用现有 store：dogfood 中暴露的方法论缺陷直接 append 到 `~/.claude-web/telemetry.jsonl` 用 `event="methodology.debt"`（已有 schema），解冻时 jq 过滤即可。**避免新增 store**。
3. 或者把 P1-7 提到 P0 档（与 P0-1 同批 ship），这样 RISKS / ROADMAP 升级是冻结启动条件本身，不在冻结后发生。

---

### M1 [MAJOR] OQ7 inbox-store 无并发锁的事实已过时

**Where**: §1 P0-2 "做什么" 第 2 子弹 "+ 修 OQ7「inbox-store 无并发锁」"
**Lens**: 正确性
**Issue**: PARALLEL §9 OQ7 写于 2026-05-03。git log 在 2026-05-03 之后已有 commit `3d95b37 fix(inbox-store): 并发写锁 + atomic temp+rename，防 lost-update`。OQ7 提到的 race condition 已修复。

**Why**: 计划把"修 OQ7"作为合并 inbox.jsonl 的动机之一，但实际 OQ7 已被修。计划读起来像 P0-2 有 bugfix 价值，验证后发现只剩"消 1 个 store + 跨设备语义统一"——这本身仍合理但价值更低。

**Suggested fix**: P0-2 "为什么"段改：
- 删"+ 修 OQ7「inbox-store 无并发锁」"
- 保留"消 1 个 store + 跨设备语义统一（jsonl 不像 SQLite 跨设备同步友好）"
- 或加："`3d95b37` 已加 file-lock，但 jsonl 跨设备 sync 仍弱于 SQLite WAL；STORE_MAP 决策时一并复盘"

---

### M2 [MAJOR] P1-5 + P1-6 toy 仓库"是否可改"边界冲突

**Where**: §2 不变量 5 vs §1 P1-6 验收
**Lens**: 正确性
**Issue**:
- §2 不变量 5："toy 仓库不 dogfood 它...不让 PM agent 改它的代码（只读 / dry-run）"
- §1 P1-6 验收："M1 第一个真 spawn 可以选 toy 仓库一个微小 issue 跑"

PM agent 跑 discovery + spec **不写代码**，与不变量 5 兼容。但"M1 第一个真 spawn"措辞模糊——若读者理解为完整 Stage 链（含 implement / test / review 等改代码 Stage），就违反不变量 5。

**Suggested fix**: P1-6 显式约束："M1 第一次 spawn **仅跑 PM agent 的 discovery + spec 阶段在 toy 仓库**（产出 spec.md Artifact 即可）；implement / test / review 等需要写代码的 Stage 必须等用户对 toy 仓库使用边界拍板后再决定。"

---

### M3 [MAJOR] P0-3 fast-path 分级表"中改 = 单 surface schema"逻辑错位

**Where**: §1 P0-3 分级表第 2 行
**Lens**: 正确性 / 不可逆
**Issue**: "中改"档定义"单 surface schema / 跨文件但单层"。但 schema 演化（无论单端 / 跨端）一旦 ship 都是不可逆操作（老 client 装包后 schema 字段不能裸删）。M0 三次 minor bump（modelList / permissionModes / agentProfiles）每次都是**单 surface schema**，但都跑了完整 phase 1+2+3 并真 catch BLOCKER（M0 retro §4.2：iOS HarnessConfig 字段必须 optional 不是 required，否则 v1.1 client 收 v1.0 payload keyNotFound 崩溃）。

把"单 surface schema"放中改，会反向回退已被验证的安全实践。

**Why this matters**: 这是 fast-path 分级表最危险的一档错位。BLOCKER 直接发生在"看似单端的 schema 改动"里。

**Suggested fix**: 改分级表第 2-3 行：
- 中改：单 surface 治理 / 文档 / 配置 + **无 schema 演化** + 单层文件
- 大改：**任何 schema 演化** / cross-surface 协议 / 不可逆代码 / security

明确 schema 演化无论单端还是跨端都强制走完整三层。

---

### M4 [MAJOR] P1-6 scope 严重低估，伪装成"P1 单条修改"

**Where**: §1 P1-6 entry / Exit
**Lens**: 简化（实为 scope 隐藏）
**Issue**: P1-6 entry 只列"P0 三条 + P1-5 toy 仓库"，Exit 要求 scheduler.ts 5-state + spec.md Artifact 落库。但 PM agent 真 spawn 的依赖远不止 scheduler：

| 依赖 | 当前状态 | 计划是否提及 |
|---|---|---|
| scheduler.ts 5-state state machine | 未实现 | ✅ Exit 列出 |
| context-manager.ts + ContextBundle | 未实现 | ❌ 缺 |
| agents/profiles.ts + PM Profile 渲染 | 未实现（fallback config 只有元信息字符串）| ❌ 缺 |
| methodology-store.ts + 00-discovery.md ritual gate | 未实现 | ❌ 缺 |
| harness_event WS routing 对齐 stage_changed | 部分（commit `19eb2af`）| ❌ 缺 |

这是**整个 M1 后端骨架**，不是单条 P1。把它列在 P1 档 + entry 仅 2 条，会让用户误以为是小工作量，进入实施时发现深度。

**Suggested fix**: P1-6 拆 3 条：
- **P1-6a**: scheduler.ts 5-state state machine + 单元测 stub（≤ 200 行）
- **P1-6b**: context-manager.ts + 1 个 ContextBundle 真跑通（≤ 200 行）
- **P1-6c**: agents/profiles.ts + PM Profile 真 spawn（discovery 阶段产 1 条 Run / Artifact）

或者保留"P1-6 = 完整 M1 后端"但**改档为 P0/P2**（取决于用户认可的优先级），不要藏在 P1。

---

### m1 [MINOR] "8 个 store" 数字未含 iOS cache + CLI transcript

**Where**: §0 + §1 P0-2
**Lens**: 正确性
**Issue**: "~/.claude-web/ 8 个 store" 只算 backend。CLAUDE.md / HARNESS_ARCHITECTURE.md L5 列了 iOS Application Support cache（projects.json + conversations.json + sessions/<convId>.json）+ `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` CLI transcript。STORE_MAP.md 应不应该列读侧引用？计划没说。

**Suggested fix**: STORE_MAP.md 加一段"读侧引用（不可写但跨边界）"，列 iOS cache 路径 + CLI transcript 路径，避免后续读者误以为只有 backend store。

---

### m2 [MINOR] "TTS 50 行 diff 跑出 8 评审文件" 数字偏大

**Where**: §1 P0-3 "为什么"段
**Lens**: 正确性
**Issue**: 实际 docs/reviews/ TTS 相关文件 3 个（cross / arch / arbitration）+ proposal v0.2 共 4 个产物，加上 v0.1 草稿可能多 1-2 个早期 verdict。"8 评审文件"夸大。

**Suggested fix**: 改"~5 个评审/proposal 产物"或直接删数字，保留"过度仪式典型"修辞。

---

### m3 [MINOR] P0-1 验收 grep 自指冲突

**Where**: §1 P0-1 验收第 2 句
**Lens**: 正确性
**Issue**: 验收写"冻结期内 git log 不出现新 `docs/proposals/*.md`"，但本计划自己就是 `docs/proposals/HARNESS_META_FREEZE_v0.1.md`，会让冻结 day-1 grep 命中。

**Suggested fix**: 改"冻结期**开始后**（本计划 + STORE_MAP merge 之后）git log 不出现新 `docs/proposals/*.md`"。

---

### m4 [MINOR] P0-1 entry 自指逻辑

**Where**: §1 P0-1 entry
**Lens**: 简化
**Issue**: "P0-1 entry: 本计划 P0 三条全 ship" — P0-1 是 P0 三条之一，自己 entry 等"自己 ship"是循环。

**Suggested fix**: P0-1 entry 改"无（P0-1 是冻结启动条件之一）"或"**P0-2 + P0-3** ship 之后立即生效"。

---

### m5 [MINOR] §6 评审深度选 cross lens 而非 architecture lens 不一定最优

**Where**: §6 Phase 2/3 skip rationale
**Lens**: 简化
**Issue**: 计划是治理决策 + 里程碑节奏调整，更对应 `harness-architecture-review` 的 4 维（架构 / 里程碑 / 垂直 / 风险）。reviewer-cross 5 lens 偏向 schema / protocol 正确性。本次跑 cross 是合规但非最优——多条 finding（M2 toy 边界 / M4 scope 隐藏）其实是 architecture lens 更对口。

**Suggested fix**: P0-3 fast-path 分级表加注："**作者选哪个 lens 跑**取决于 artifact 类型 — 协议/schema 跑 cross；治理/里程碑跑 architecture；二者重叠且 ≤50 行可单 lens；不可逆改动一律双 lens"。

---

## False-Positive Watch

- **F? B1 的"死锁"严重度**：B1 三条矛盾确实存在，但用户在 §4 U1/U2/U3 选择题里**已留出修订空间**。如果 author arbitration 时把 P1-7 与 P0 同批，B1 自然消解。我不确定该标 BLOCKER 还是 MAJOR，因为可被 author 一行 fix 解决。**保留 BLOCKER 标记**理由：计划字面状态自相矛盾，author 必须明确选择路径才能进；即使 fix 容易，未 fix 不能 ship。

- **F? M1 的 OQ7 已修事实**：我看了 git log `3d95b37`，但没读 commit diff 实际内容。如果 commit 只修了 inbox 写锁但没修 OQ7 提到的全部 race，M1 严重度需重评。author 可拿 commit 内容确认 / 反驳。

---

## What I Did Not Look At

- 没读 commit `3d95b37` 的实际 diff，只看 commit 标题 — M1 finding 可能需要 author 用 `git show 3d95b37` 验证完整 fix
- 没运行 backend / iOS 任何代码 — 7 条修改全部静态评估
- 没核对 IDEAS.md A1 / 子代理 trace / Plan 模式 UI 三个候选的具体描述 — 只信 P1-6 引用
- 没验证 `harnessEnabled` 字段在 projects.ts 的实际实现 — 仅信 CLAUDE.md 引用
- 没读 LEARNINGS.md 之外的过往 cross verdict 找模式 — 按 SKILL 约束只读 LEARNINGS.md 自身
- 没评估"冻结期解冻 ritual"细节 — 计划只写"M1 跑出 1 个 dogfood Issue"，但谁判定 Issue 真跑通 / 标准是什么没说，留作 author 决定

---

## 沉淀建议（追加到 LEARNINGS.md）

1. **治理 / 里程碑类 artifact 应跑 architecture lens 而非 cross lens** — 来源：本次 review。cross 5 lens 偏 schema / protocol；治理决策的 4 维度（依赖关系 / scope 隐藏 / 内部矛盾 / 不可逆度）更对应 architecture-review skill。
2. **fast-path 分级表的"中改"档不能含 schema 演化** — 来源：M3 finding。M0 三次 minor bump 真 catch BLOCKER 证明 schema 演化无论单端还是跨端都需要完整三层。
3. **元工作冻结类 artifact 必须显式列出"启动批"豁免** — 来源：B1 finding。否则字面规则与启动当时形成的 ADR / RISKS / ROADMAP 升级矛盾。

（仅供 author 参考；实际写入 LEARNINGS.md 由作者决定，避免冻结启动批冲突）
