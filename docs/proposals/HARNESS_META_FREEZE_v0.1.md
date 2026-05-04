# Harness Meta-Freeze 修改计划 v0.2

> **Status**: proposal (fast-path), **post-arbitration** · **Date**: 2026-05-04 · **Author**: opus-4-7
> **Review depth**: phase 1 cross 单 reviewer + author arbitration（fast-path 分级首次 dogfood —— 中改：单 surface 治理决策，无 schema 演化、无不可逆代码改动）
> **Lineage**: v0.1 (initial) → v0.2 (post phase 1 cross arbitration; 1 BLOCKER + 4 MAJOR + 5 MINOR 全部 accept / partial accept). 详见 [cross verdict](../reviews/harness-meta-freeze-cross-2026-05-04.md).
> **不可逆度**: 极低 — 全部为文档 / 配置 / store 整治；任何一条都可单独 revert
> **Why**: 全局架构评审（2026-05-04）发现 R-meta 元工作螺旋 + R-engagement 用户审批疲劳两条结构性风险；元工作 / 真工作 ≈ 4:1。本计划落实 7 条修复（v0.2 调整后实际 9 条：P1-6 拆 a/b/c），其中 3 条 P0 + 6 条 P1。

---

## 0. Context

全局评审硬证据：
- harness 文档 + reviews ≈ **8,800 行** vs harness 真实代码 **< 2,000 行**
- `~/.claude-web/` 有 **8 个 store**，没有 source-of-truth 图
- 最近 20 commit **0 条**来自 IDEAS.md 的真业务功能
- 用户已 ≥2 次抗拒 ritual（M0-C 跳评审 / v0.5 PARALLEL 纠正"先评审再决策"）
- 18 条 RISKS 漏 R-meta + R-engagement

详见全局评审输出（本对话上文）。

## 1. 7 条修改（按优先级）

### P0-1. 元工作冻结 1 个里程碑

**做什么**：默认 `HARNESS_EVOLUTION_FROZEN=1`；冻结期内不写新 ADR / proposal / methodology / framework 升级。

**冻结启动批豁免**（v0.2 cross B1 修订）：以下 5 件元工作算"冻结启动批"，与 P0-1 同时 ship 后才进入冻结状态：
1. 本计划 v0.2 自身（docs/proposals/HARNESS_META_FREEZE_v0.2.md）
2. STORE_MAP.md（P0-2 产出）
3. fast-path 分级表（P0-3 产出，写进 .claude/skills/harness-review-workflow/SKILL.md）
4. RISKS R7 段（P1-7 产出）
5. ROADMAP §0 #21 / #22 升级（P1-7 产出）

冻结启动批 ship 之后，任何新 ADR / proposal / methodology / framework 升级都被视为违反冻结。

**为什么**：plan §0 #15「进化是副产物」原则正在被违反（debate-review → harness-review-workflow → reviewer-cross → cursor-agent 异质对 → review-mechanism v2 五代演化无停歇）。

**Entry**：P0-2 + P0-3 ship 之后立即生效（自指消解）。
**Exit**：M1 跑出 ≥1 个真 dogfood Issue（discovery → spec → awaiting_review → approve）后解冻。
**验收**：env var 已在 backend 启动脚本默认开；**冻结期开始后**（启动批 5 件 ship 之后）git log 不出现新 `docs/proposals/*.md` / `adr/ADR-*.md`。

### P0-2. 写 STORE_MAP.md + 合并 inbox.jsonl 进 harness.db

**做什么**：
- 写 `docs/STORE_MAP.md`（≤80 行）：每个 store 列 path / scope / source-of-truth / 写锁路径 / 跨设备语义
- **加"读侧引用"段**（v0.2 cross m1 修订）：列 iOS Application Support cache（projects.json + conversations.json + sessions/<convId>.json）+ `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` CLI transcript，标"不可写但跨边界"
- 把 inbox.jsonl 迁进 harness.db（FTS5 已就绪），消掉 1 个 store + 跨设备语义统一（jsonl 不像 SQLite WAL 跨设备同步友好）
- 加规则段："新增功能优先复用现有 store；新加 store 需写一行 ADR-lite 说明为什么不能复用"

**为什么**：8 个 store 已开始互相影响（PARALLEL §6.5 被迫写"work-registry 不存 cwd 避免双写漂移"是信号）。注：commit `3d95b37` 已修 inbox-store 写锁，OQ7 race 已闭环；P0-2 仍合并 inbox 是为消 store 数 + 跨设备一致性。

**Entry**：无。
**Exit**：STORE_MAP.md merge 到 main；inbox.jsonl 数据迁完，端点和 iOS 测试通过；旧 jsonl 改 `.deprecated` 保留 1 个月。
**验收**：`/api/harness/inbox` 端点行为零回归（手动 swipe + triage 跑一次）。

### P0-3. Review Mechanism v2 加 fast-path 分级

**做什么**：在 `.claude/skills/harness-review-workflow/SKILL.md` 顶部加分级表（v0.2 cross M3 修订：schema 演化无论单端还是跨端都强制走完整三层）：

| 改动规模 | 评审 |
|---|---|
| 微改：≤50 行 diff / 单 surface / 无 schema | 直接做，commit 描述写 rationale |
| 中改：**单 surface 治理 / 文档 / 配置 + 无 schema 演化 + 单层文件** | phase 1 单 reviewer + author arbitration（**本计划自身就是这一档**） |
| 大改：**任何 schema 演化** / cross-surface 协议 / 不可逆代码 / security | phase 1+2+3 完整三层 |

**lens 选择**（v0.2 cross m5 修订）：作者选 cross / architecture lens 取决于 artifact 类型——协议 / schema 跑 cross；治理 / 里程碑跑 architecture；二者重叠且 ≤50 行可单 lens；不可逆改动一律双 lens。

**为什么**：M0-C 用户已主动跳过；TTS ~5 个评审/proposal 产物对应 ≤50 行 diff 是过度仪式典型。M0 三次 minor bump（modelList / permissionModes / agentProfiles）证明 schema 演化即使单端也会真 catch BLOCKER（M0 retro §4.2 iOS optional vs required keyNotFound），不能放进中改档。

**Entry**：无。
**Exit**：SKILL.md 顶部加表 + 至少 1 个 anti-pattern 段（举 TTS 反例）。
**验收**：本计划自己就用 fast-path 跑（dogfood 自验）。

### P1-4. L4 折叠进 L3.AgentRuntime

**做什么**：`HARNESS_ARCHITECTURE.md` 6 层改 5 层。L4 段并入 L3 作为 `L3.AgentRuntime` 子模块。AgentProfile + spawn `claude` CLI 在 L3 模块图里标 7+1。

**为什么**：L4 没有独立接口面（不像 L1 有 WS/HTTP，L2 有 schema fixture，L5 有 SQLite/jsonl）。L4 = L3 内部 spawn 子模块，独立成层只是凑 SDLC × Runtime 对称——心智成本无收益。HARNESS_ARCHITECTURE §5.3 自己已列为 Open Question。

**Entry**：无。
**Exit**：HARNESS_ARCHITECTURE.md 改完；HARNESS_INDEX.md 跨文档约束段同步（如有引用）。
**验收**：grep "L4" 应只剩历史引用 / changelog。

### P1-5. M2 toy 企业仓库现在选

**做什么**：fork 一个开源 NestJS / Hono 后台模板（候选：NestJS RealWorld / vendure 子模块 / 自写 4 实体 CRUD：员工 + 部门 + 报销 + 审批），路径 `~/Desktop/harness-toy-erp`，注册到 projects.json，标 `harnessEnabled=false`（不让 dogfood 改它，仅作 M2 准入用）。

**为什么**：plan §6 M2 准入已要求"独立 toy 仓库 dry-run"。**§11 Q12 留 Open Question = 推迟 = M2 启动时再卡**。R4.2 「dogfood 改坏自己」+ R5.1「企业垂直不贴谱」当前并发触发。

**Entry**：P0 三条 ship。
**Exit**：toy 仓库选定 + clone 到本地 + projects.json 注册一行 + 写 50 字"为什么选这个"。
**验收**：M1 启动前完成；M1 第一个真 spawn 可以选 toy 仓库一个微小 issue 跑（避开 self-reflective）。

### P1-6. 进 M1 真 spawn 第一次（v0.2 cross M4 修订：拆 a/b/c 防 scope 隐藏）

**总目标**：M-1 + M0 所有奠基契约**第一次被真业务用到**。从 IDEAS.md 挑 1 个真功能（推荐 IDEAS A1 模型路由 / 子代理 trace 折叠 / Plan 模式 UI 三选一），让 PM agent 跑 discovery → spec → awaiting_review。

**约束**（v0.2 cross M2 修订，与 §2 不变量 5 cross-ref）：M1 第一次 spawn **仅跑 PM agent 的 discovery + spec 阶段在 toy 仓库**（产出 spec.md Artifact 即可）。implement / test / review 等需要写代码的 Stage 必须等用户对 toy 仓库使用边界拍板后再决定。

**为什么**：M0 retrospective §8 自己说"M1 准入门槛全部就绪"。但之后又做了 10+ commit 微调 harness（worktree Stage A / Board UI / inbox 锁），还没真 spawn。奠基契约不被真业务用过 = 双盲测试。

**P1-6 entry**：P0 三条 + P1-5 toy 仓库选定 + P1-6a/6b/6c 全部完成。

#### P1-6a. scheduler.ts 5-state state machine + 单元测 stub

**做什么**：实现 Stage 状态机（pending → running → awaiting_review → approved/rejected → done/failed），≤200 行 + vitest 单元测 5 个 transition。

**Exit**：单元测全绿；scheduler 进程内 setInterval + 事件触发可 spawn dummy 子任务（不必真 spawn claude CLI）。

#### P1-6b. context-manager.ts + 1 个 ContextBundle 真跑通

**做什么**：实现 ContextBundle 编排（按 Stage 类型 + Issue 范围 + 显式 artifactRefs 挑选最小集；缺失即 fail），≤200 行 + 1 个端到端 fixture：discovery Stage 的 ContextBundle 包含 IDEAS.md + IMPROVEMENTS.md + git log 摘要。

**Exit**：fixture round-trip；Context Manager 单元测覆盖典型 Stage 输入边界。

#### P1-6c. agents/profiles.ts + PM Profile 真 spawn

**做什么**：AgentProfile 注册 + prompt 渲染落到 cli-runner.ts runSession；PM Profile 真 spawn 一次 claude CLI 子进程，cwd = toy 仓库，跑 discovery 阶段产 1 条 Run + 1 条 spec.md Artifact 落 harness.db。

**Exit**：harness.db Issue/Stage/Run/Artifact 各 ≥1 行；Run.transcript 指向 ~/.claude/projects/*/<sid>.jsonl；用户主观满意（不要求 Stage 全跑通，spec 阶段过即可）。

**P1-6 整体验收**：6a + 6b + 6c 全部 Exit 满足；M1 retrospective 起草完成（必须复盘"奠基契约真用一次后哪些是负债"）。

### P1-7. HARNESS_RISKS.md 补 R-meta + R-engagement

**做什么**：加第 7 主题"框架自身风险"：
- **R7.1 元工作螺旋**：framework-of-framework 膨胀；缓解 = `HARNESS_EVOLUTION_FROZEN` + 冻结期触发条件 + 解冻 ritual。
- **R7.2 用户审批疲劳**：输入侧 30s 入口保护住，输出侧（评审 / 决策 / arbitration）耗时无上限；缓解 = fast-path 分级 + Decision timeout 默认 + 跳过 ritual 不视为失败而是信号。

**Entry**：无。
**Exit**：RISKS.md 加段 + ROADMAP §0 加对应原则编号（#21 元工作冻结 / #22 输出侧仪式预算）。
**验收**：grep "R-meta" / "R-engagement" 在 RISKS.md 命中。

## 2. 关键不变量（防过度修复）

1. **冻结期 ≠ 停手**：冻结的是 framework 升级，不是真业务。P1-6 真 spawn 必须在冻结期进行才有意义。
2. **fast-path 不削弱 reviewer-cross 异质性**：大改仍跑完整三层 + cursor-agent 异质对（PARALLEL v0.5 教训保留）。
3. **STORE_MAP 不重写 store**：只画图 + 合并 inbox。harness.db / projects.json / work.jsonl / telemetry.jsonl 各自职责保留。
4. **L4 折叠不改代码**：纯文档重组。如果未来真 spawn 出现独立接口面（如远程 agent 池），再升回独立层。
5. **toy 仓库不 dogfood 它**：M2 准入唯一用途；不让 PM agent 改它的代码（只读 / dry-run）。
6. **冻结期不是无限期**：解冻条件硬卡（≥1 真 dogfood Issue 跑通），不靠主观判断。

## 3. 与现有 IDEAS / IMPROVEMENTS 合并

- 不新增 IDEAS 条目（本计划是治理决策，不是功能）
- IMPROVEMENTS.md 收敛后记一行已闭环（连同 commit）
- M1 retrospective（P1-6 完工时写）必须复盘"奠基契约真用一次后哪些是负债"

## 4. 待用户拍板

| 决策 | 选项 |
|---|---|
| **U1. 推进范围** | (a) 只 P0 三条 / (b) P0 + P1-5 toy 仓库 / (c) 全 7 条 |
| **U2. 冻结期长度** | (a) 1 个里程碑（M1）/ (b) 至 M2 / (c) 由 R-meta 复发触发解冻 |
| **U3. P1-6 真 spawn 选哪个 IDEAS** | A1 模型路由 / 子代理 trace 折叠 / Plan 模式 UI（或你指定其他） |

我推荐 **U1=c 全 7 条 + U2=a M1 / U3 = A1 模型路由**——A1 是真垂直 dogfood，跨 backend prompt 决策 + iOS 显示，跑得通能验证 ≥3 个奠基契约。

## 5. Open Questions（≤3，留 dogfood 验证）

- **Q1**：fast-path 分级表里"中改"和"大改"的边界靠主观判断（"unreversible? security?"）。dogfood 期监控 false-fast-path 率，>10% 时收紧。
- **Q2**：STORE_MAP.md 写完后是否反向触发 harness.db schema 简化（把 work.jsonl 也并进 harness.db）？v0.1 不做，避免 scope creep。
- **Q3**：HARNESS_EVOLUTION_FROZEN=1 默认开后，dogfood 中暴露的方法论缺陷如何登记？（v0.2 cross B1 修订：避免新增 store 与 P0-2 冲突）**直接 append 到现有 `~/.claude-web/telemetry.jsonl`，event=`methodology.debt`，props={stage, issue_id, problem, suggested_fix}**。解冻时 jq 过滤即可。不新增 store。

## 6. Phase 2/3 评审 skip rationale

按 P0-3 fast-path 分级：本计划属"中改"（单 surface 治理决策 + 无 schema 演化 + 无代码 diff）。决策路径：

- skip phase 2 cross-pollinate：本计划是"减少元工作"目标本身，跑完整三层会反向证明判断错误（dogfood 矛盾）
- 跑 phase 1 单 reviewer（cross 视角）：抓事实错误 / 漏掉的风险
- 跑 phase 3 author arbitration：给最终判断

**Escalate condition**：reviewer 抛 ≥1 BLOCKER + 涉及不可逆/security → 升级跑 phase 2。

**实际 phase 1 结果**：cross 抛 1 BLOCKER（计划自身死锁，非不可逆/security）+ 4 MAJOR + 5 MINOR；无 escalate 触发，全部走 phase 3 author arbitration 解决。详见 §7。

**lens 选择反思**（v0.2 cross m5 修订）：本计划是治理决策更对应 architecture lens，但 phase 1 跑了 cross lens。事后看 cross 仍抓到核心问题（B1 内部矛盾 / M4 scope 隐藏），证明 lens 选择不绝对——但已把规则落进 P0-3，未来治理类 artifact 默认 architecture lens。

---

## 7. Arbitration Log（v0.2，post phase 1 cross）

| # | Severity | Lens | 决策 | 落实位置 |
|---|---|---|---|---|
| B1 | BLOCKER | 正确性/简化 | ✅ accept partial（启动批豁免段 + Q3 改用 telemetry.jsonl）| §1 P0-1 + §5 Q3 |
| M1 | MAJOR | 正确性 | ✅ accept（删 OQ7 引用 + 改"消 store 数 + 跨设备语义"）| §1 P0-2 |
| M2 | MAJOR | 正确性 | ✅ accept（P1-6 显式约束 discovery+spec only）| §1 P1-6 约束段 |
| M3 | MAJOR | 正确性/不可逆 | ✅ accept（中改剔除 schema 演化）| §1 P0-3 表 |
| M4 | MAJOR | 简化 | ✅ accept（拆 P1-6a/6b/6c）| §1 P1-6a/6b/6c |
| m1 | MINOR | 正确性 | ✅ accept（STORE_MAP 加读侧引用段）| §1 P0-2 |
| m2 | MINOR | 正确性 | ✅ accept（数字"8" → "~5 评审/proposal 产物"）| §1 P0-3 为什么段 |
| m3 | MINOR | 正确性 | ✅ accept（grep 限定"冻结期开始后"）| §1 P0-1 验收 |
| m4 | MINOR | 简化 | ✅ accept（entry 改 "P0-2 + P0-3 ship 之后"）| §1 P0-1 entry |
| m5 | MINOR | 简化 | ✅ accept partial（lens 选择规则进 P0-3，不强求双 lens）| §1 P0-3 lens 段 |

**反驳 0 条**。所有 finding 是事实/边界问题，无主观空间。

**未落实但记录**（reviewer F? 提示）：
- F? B1 严重度（事实是否 BLOCKER）：保留 BLOCKER 标——计划字面状态自相矛盾，未 fix 不能 ship 是 hard requirement
- F? M1 OQ7 commit 范围：未 `git show 3d95b37` 验证 diff 完整内容；P0-2 实施时由 author 一并核对
