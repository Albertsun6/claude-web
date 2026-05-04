# Phase 2 React — Architecture-fit lens
> Reviewer: harness-architecture-review · Date: 2026-05-03 · Phase 2 (cross-pollinate)

## 对 cross 每条 finding 表态

### Cross-F1 (pnpm symlink hand-wavy) — agree
**对方原文**: "A single root-level `ln -s ../main-cwd/node_modules` in a worktree therefore breaks: ... `packages/backend/node_modules/@claude-web/shared` symlink still points at the **main cwd's** `packages/shared`"
**我的表态**: agree
**理由**: 这是我 Phase 1 漏掉的具体技术细节。我只把 §9 Q3 当成"open question"处理，没意识到 pnpm workspace 的 sibling-package symlink 让"复用 node_modules"在静态意义上根本不成立——任何对 `packages/shared/*` 的修改都会让 worktree 的 backend 跑 main-cwd 的旧代码，这直接违反"worktree 物理隔离"的核心承诺，也加重我 F1 的"低不可逆"质疑（因为 Stage A 准入门槛得抬高）。对方建议把 §9 Q3 提升到 Stage A 准入是对的。

### Cross-F2 (Microsoft swarm 引用) — refine
**对方原文**: "'One spectacular crash' reads like a sub-heading or pulled quote, not the article title. ... If the actual conclusion is more nuanced ... the report's `MAX_PARALLEL hard cap = 4` (§6.2) loses its empirical backing."
**我的表态**: refine
**理由**: 我同意引用方式有问题，但不同意"loses its empirical backing"的强结论——MAX_PARALLEL=4 的依据是 §2.a 三方交叉验证（AddyOsmani + Claude Code 团队 + Microsoft），即使 Microsoft 那条权重砍半也仍有两方 sweet spot 证据支撑。
**新建议**: §3 row 1 的修复改成"paraphrase + 直接粘贴文章结论原段做 footnote"——cross 提的；但 §6.2 的硬上限不需要松动，理由改写为"基于 AddyOsmani + Claude Code 两方独立观察 + Microsoft 单点反例"。

### Cross-F3 (issue_dependencies 表过度建模) — refine
**对方原文**: "single nullable FK `issue.blocks_issue_id REFERENCES issue(id)` covers the common-case single upstream"
**我的表态**: refine（与我自己 F1 的 fallback 方案"Issue.metadata_json 存 depends_on"竞争）
**理由**: cross 的 single-FK 方案比我建议的 metadata_json 更结构化（可 join），但只能表达单上游依赖。Stage B 的真实场景里"等 X 完成才能做 Y"经常 N=1，N≥2 罕见——cross 估得对。但我的 metadata_json 方案对"未来如果出现 N≥2 不需要 schema migration"更友好。
**新建议**: 优先 cross 的 single-FK 方案，因为 (a) join 友好、(b) 引用完整性 DB 强制、(c) 真升级成 N-N 时 ALTER TABLE 加中间表本身就是 ADR-记录的迁移，不必避免。把我 F1 的 metadata_json 方案降级为 fallback。

### Cross-F4 (iOS picker 假设 Issue 存在 iOS) — agree
**对方原文**: "There is **no Issue model on iOS** ... A 'depends-on which Issue' picker requires: backend ... Swift `IssueDTO`, list view ... offline cache invalidation rules. None of this is scoped in §5.B's '1 周'."
**我的表态**: agree
**理由**: 这条直接强化我 Phase 1 F3（Stage 时序模糊）。我只看到"和 M2 抢预算"，cross 把"和 iOS 端跨端契约抢预算"也指出来了——Stage B 的 1 周估时是 backend-only 视角下的乐观估时，加上 iOS DTO + 列表 + 缓存失效逻辑很可能 ≥2 周。这让我 F3 的修正方案"拆 C1/C2"应同样适用于 Stage B：拆 B1（backend-only schema + CRUD）/ B2（iOS picker）。

### Cross-F5 (Worktree 路径 allowlist + path-traversal) — agree
**对方原文**: "Verify the **destination** path ... is **not** user-supplied — generate it server-side from a UUID ... Add `~/.claude-web-worktrees/` to the allowlist automatically ... `index.ts:343` calls `verifyAllowedPath(msg.cwd)` on every prompt"
**我的表态**: agree
**理由**: 这是纯安全维度的 finding，我 Phase 1 完全没覆盖（我聚焦 schema/milestone/vertical fit，没下沉到 verifyAllowedPath 调用链）。这条独立成立，强化我对 §10 跳 phase 2 论证不足的判断（F5）——本来就该让 cross-correctness lens 跑。"IDEAS P1 路径与 proposal 路径不一致"也是真矛盾，得 reconcile。

### Cross-F6 (Telegram fan-out 无 throttling) — agree
**对方原文**: "`sendSessionCompletion` does a synchronous `fetch` per call with **no batching, no throttle, no de-dup** ... Stage C's 'scheduler fan-out 4 worktree → 4 sessionEnded within seconds' produces 4 unbatched Telegram messages ... bursts of 10+ from a runaway DAG will hit `429`"
**我的表态**: agree
**理由**: 这是 §9 Q4 真实成本验证。我 Phase 1 把 Q4 当 open question 留给用户，cross 直接读 telegram.ts 验证了"现有 channel throw on non-2xx，index.ts swallow via void"——silent telemetry loss 是我没意识到的次生灾害。这条加强我 F4（vertical fit）的 Stage C 刹车主张：通知风暴本身就是"个人单用户场景下 fan-out 不划算"的实证。

### Cross-F7 (P8 stacked diffs 与 A3 重复) — agree
**对方原文**: "P8 ... solves dependency-chain UX **only for the linear sub-case** ... 3 overlapping anchors (P1 / A3 / P8)"
**我的表态**: agree
**理由**: 与我 Phase 1 F7 同方向，cross 给出更精确的归并位置（合并到 A3 follow-up note 而非合并到 P7）。我接受 cross 方案——把我 F7 的"合并 P7+P8"改为"P8 drop，作为 A3 的一行 follow-up note"。

### Cross-F8 (harness_enabled=0 阻挡 Stage A worktree) — new-finding（对我而言）
**对方原文**: "`harness_project.worktree_root TEXT NOT NULL` (line 51) requires every harness row to commit a worktree root ... Stage A creates a `harness_project` row 还是 bypasses it"
**我的表态**: new-finding
**理由**: 我 Phase 1 完全没看 harness_project schema 和 Stage A worktree 的耦合面。这条对我的 F1（M-1 时序冲突）反而是反驳证据：harness_project 已经把 worktree_root 作为 NOT NULL，说明 schema 早就预期 worktree 进 harness 数据模型，所以 Stage A 不写 harness_project、Stage C 写——这种"双 registry 双注册"才是真不可逆负债。我 F1 的修正方向应吸收这条：Stage A 不仅要"等 M-1 freeze"，还要显式声明它走 `~/.claude-web/projects.json` 还是 `harness_project`。

## 我自己 Phase 1 verdict 的自我修正

### F1 (Stage B 数据模型契约时序冲突 BLOCKER) — keep + 强化
**修正后等级**: BLOCKER（保持）
**理由**: cross-F8 让我看到 Stage A 也碰 schema（harness_project worktree_root 字段），不只是 Stage B。F1 的范围扩大而不是缩小。修正建议：把 cross 的 single-FK 方案吸收为我 F1 的首选 fix，metadata_json 降为 fallback。

### F2 (双依赖体系 ContextBundle vs issue_dependencies MAJOR) — downgrade
**修正后等级**: MINOR
**理由**: cross-F3 提了更好的 fix（single-FK），让"双体系"的复杂度从"两张表"降到"一列 FK + 一个 JSON 数组"，长期负债变小。我原 F2 的"为什么 ContextBundle 不够用"问题仍要作者答，但严重性从 MAJOR 降到 MINOR。

### F3 (Stage C M2 时序模糊 MAJOR) — keep
**修正后等级**: MAJOR（保持）
**理由**: cross 没直接打这条，但 cross-F4（iOS picker 跨端契约）让我意识到同类问题在 Stage B 也存在——所以 fix 方案要扩展为"Stage B 也拆 B1/B2"。

### F4 (个人单用户 DAG fan-out 价值未论证 MAJOR) — keep + cross-F6 强化
**修正后等级**: MAJOR（保持）
**理由**: cross-F6 的 Telegram 风暴风险是我 F4 vertical-fit 论证的实证补充，反而强化了。

### F5 (§10 phase 2/3 skip 论证不足 MAJOR) — keep
**修正后等级**: MAJOR（保持）
**理由**: cross-F5（安全 finding 我没看到）+ cross-F1（pnpm 技术细节我没看到）正好是"为什么需要 cross-correctness lens"的实证。这条不动，反而是它推动了 phase 2 真的跑起来。

### F6 (MAX_PARALLEL 与 backend per-cwd run 模型耦合 MINOR) — keep
**修正后等级**: MINOR（保持）

### F7 (P8 stacked PR 与 P7 重叠 MINOR) — refine
**修正后等级**: MINOR（保持，但 fix 改向）
**理由**: 采用 cross-F7 的方案：P8 drop 而非合并到 P7，作为 A3 follow-up note。我原 fix"合并 P7+P8"撤回。

## 新发现 (new-finding)

- **N1（吸收 cross-F8）**：Stage A 与 `harness_project.worktree_root NOT NULL` schema 的注册路径冲突。**等级 MAJOR**。Stage A 必须显式声明 worktree 是写到 `~/.claude-web/projects.json` 还是 `harness_project` 表，否则 Stage A → Stage C 升级会变成 "双 registry reconcile"，与我 F1 的"M-1 后用 ADR 迁移"原则冲突。

- **N2（cross-F1 触发的盲区）**：proposal 整段没有 "Stage A 准入门槛清单" 这个概念。pnpm workspace、worktree 路径 allowlist、harness_project schema reconcile 这三个都是 Stage A 一启动就立刻撞上的具体障碍。**等级 MINOR-toward-MAJOR**。Suggested fix：在 §5 Stage A 末尾加一段"准入门槛 checklist"，含 (a) pnpm install 策略明确、(b) `~/.claude-web-worktrees/` 自动入 allowlist、(c) `harness_project` 注册路径决策。

## Convergence summary

- 对方共 8 条 finding，我表态：**5 agree / 0 disagree / 2 refine / 1 new-finding（cross-F8 让我看到的盲区）**
- 我自己 7 条 finding，我修正：**5 keep / 1 downgrade（F2 → MINOR）/ 0 withdraw**；F7 fix 方向改用 cross 方案
- 真正未收敛 finding：
  - **Cross-F2 (Microsoft 引用)**: 我同意改引用方式，但不同意"MAX_PARALLEL=4 失去 empirical backing"——硬上限保留，引用 footnote 强化
  - **Cross-F3 vs 我 F1 的 fallback**: 都是 refine，方向一致（不再做 N-N 中间表），仅在"single-FK 还是 metadata_json 优先"上有偏好差，但作者可二选一，不算未收敛
- 总体收敛度高，独立性约束满足（2 refine + 1 new-finding ≥ 1 非 agree 硬底线）。
