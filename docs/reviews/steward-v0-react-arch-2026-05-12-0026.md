# Phase 2 React — Architecture-fit lens
> Reviewer: harness-architecture-review · Date: 2026-05-12 · Phase 2 cross-pollinate
> Reacts to: `docs/reviews/steward-v0-cross-2026-05-12-0026.md` (vessel-cross-reviewer, GPT-5.5)
> Builds on: `docs/reviews/steward-v0-arch-2026-05-12-0026.md` (my Phase 1)

## Stance on each cross-reviewer finding

### B1 (cross BLOCKER) "零 CLI 负担" G1 vs auto-run/auto-commit 矛盾 — **refine**

**Cross 原文核心**:
> G1 写的是"用户从不在终端敲命令；纯文本 prompt 粘到 Claude 窗口里"，但后续 contract 要求 Claude 自动跑 `pnpm eva:sessions`、`git worktree add`、编辑 `eva.json`、`git commit`、`pnpm eva:hook pre-remove`。… 把 Phase 0 明确拆成两类操作：纯读 / 写入。

**Stance**: **refine** —— problem is real，但 cross 给的 fix 还没到位。

**Reason**:
- Cross 抓到的语义歧义是真的。G1 "零 CLI 负担"在提案里被同时解释为两件事："用户面无 CLI"（这是真意）和"系统内无 CLI 调用"（误读 G1 的衍生品）。提案 §3.5 步骤 5 让 Claude 跑 `git worktree add`、§3.6 步骤 4 让 Claude 跑 `pnpm eva:hook pre-remove`——这些都是 CLI 命令，只是由 Claude 代敲而非用户敲。
- Cross 的"纯读 / 写入"二分还不够细。真正的混淆来自**三层**而不是两层：
  1. 用户面操作（粘 prompt）—— 永远 0 CLI；
  2. Claude 代执行 repo 内只读命令（`pnpm eva:sessions`、`git status`、`git log`）—— 只读，幂等，失败重试无害；
  3. Claude 代执行 repo 内写入命令（`git worktree add`、`git commit`、`pnpm eva:hook pre-remove --yes`、`eva.json` 编辑）—— 副作用，需要审计 + 确认。
- Cross 把"纯读" prompt 和"写入" prompt 切开是对的，但**真正的 contract 缺口是 Claude 代执行层的 acceptance criteria**：哪些命令 Claude 可自动跑，哪些必须先 dry-run + 让用户 ack。

**这与我 Phase 1 的关系**：我的 F4 抓到了 eva:sessions 被悄悄提升成 API（"契约依赖但没标 minClientVersion"），但我没意识到这是 G1 矛盾的一个症状。Cross 把 G1 整段拎出来，让我看到我的 F4 是局部表象，B1 是根本病因。

**New suggested fix (extending cross)**:
- G1 改写："用户从不在终端敲命令；Claude 可以代为执行 repo 内命令，但写入类命令必须先展示 dry-run + 让用户 ack，写入完成后必须显示 commit hash / 改动摘要"。
- §3 加 §3.7 "Claude 代执行命令白名单"：
  - **可静默执行**（只读）：`git status / log / diff / branch`，`pnpm eva:sessions`，`pnpm eva:status`，`pnpm eva:hook pre-remove --dry-run`。
  - **需用户 ack 后执行**（写入）：`git worktree add`、`git commit`、`pnpm eva:hook pre-remove --yes`、`eva.json` / `BACKLOG.md` / `CLAUDE.md` 编辑。
  - **绝不执行**：`git push`、`pnpm release:*`、所有 `--force` flag。
- §7 dogfood 加一个 Scenario G："Claude 在 dirty working tree 下跑写入流程，必须先停下来让用户处理 unrelated changes"——这同时覆盖 M1。

**Severity**: 同意 BLOCKER。但 fix 需要更系统，不止是"分两类操作"。

---

### M1 (cross MAJOR) commit-per-transition vs dirty working tree — **agree（强烈同意 + 升级 fix）**

**Cross 原文核心**:
> contract 要求 backlog 状态转移自动 commit，但没有规定当前 repo 已有 unrelated dirty changes 时怎么办……自动 commit 很容易把用户其他改动一起提交。Suggested fix: Steward 只允许 stage/commit `docs/BACKLOG.md / STEWARD_PROMPTS.md / CLAUDE.md`，若 unrelated staged changes 存在必须停止。

**Stance**: **agree** —— 这是 I3 commit 约束的另一面，cross 这刀切得比我深。

**Reason**:
- 我的 F3 攻击了 I3 的"每次 status 转移 commit"约束，但**我盯的是分支 / branch-protection 层面**：BACKLOG 在哪个分支 commit、能不能直 push main。Cross 盯的是**工作树脏度层面**：当前 cwd 就 `M docs/architecture/CONCEPTS.md  M packages/ios-native/...`（git status snapshot 里写得清清楚楚）。Steward 改 BACKLOG 自动 commit 会**意外把 unrelated 修改一起拽进 commit**。
- 这两个攻击点是叠加的（不是替代）：F3 解决"commit 落到哪"，M1 解决"commit 包含什么"。两条都必须独立修。
- Cross 的 fix（白名单 path stage + 检测 unrelated staged → 停下来确认）正是 Phase 0 该有的版本。比我 F3 的"main 直 push 例外"更轻量、风险更小。

**Self-correction**: 我应该在 F3 里就同时讨论"commit 内容隔离"——我漏了。

**Refine on cross's fix**:
- Cross 提"unrelated staged changes 必须停止并让用户确认"。再加一条：**unstaged unrelated changes 也要先用 `git status -s` echo 给用户**——避免 Claude 看似只 stage BACKLOG，但用户后来 `git add -A` 时把 unrelated unstaged 也带进下一个 commit 还以为是 Steward 干的。
- 具体协议：Steward 写 BACKLOG 之前先跑 `git status --porcelain=v1`，如果有任何 `M ` 或 `A ` 或 `??` 涉及非白名单文件，要求用户先收拾或显式 `--allow-dirty`。
- 白名单建议 cross 列的三个文件不够：还应加 `eva.json`（因为 §3.5 步骤 5 同 commit 跨这两文件，我 F2 已经提了）。

**Severity**: 同意 MAJOR。

---

### M2 (cross MAJOR) `status` 字段 vs section 双重 source of truth — **agree（但 cross 没意识到 false-positive 标注本身偏弱）**

**Cross 原文核心**:
> 同一个任务状态同时由 section 位置（Active / Blocked / Done）和 YAML 字段 `status` 表示……明确优先级：`status` 是权威，section 只是展示……或者移除 section 语义。

**Stance**: **agree** —— 这是 contract 必须钉死的歧义，我 Phase 1 完全没看见。

**Reason**:
- 我在 F1-F12 里反复说"schema 是 contract"，但**没注意到提案 §3.1 同时用了 markdown headers 切 section + YAML `status` 字段**——两套状态语义重叠是真实的 bug 入口。
- Cross 在"False-Positive Watch"里把 M2 标成"可能 false positive，如果作者明确认为 section 是人眼导航、`status` 是唯一权威"——这个自我标注**太保守**。即使作者就是这么想的，**契约文档没写出来本身就是问题**，不是 false-positive。Contract review 的核心就是"未写出 = 未约束"。
- M1 retrospective 信号 #1（markdown 行级 merge 后语义漂移）正是这种双 source 的典型坑。Cross 没引这条历史教训，但结论是对的。

**New finding triggered**: cross 这条让我看见提案 §3.5/3.6 流程**没说改 status 之后是不是把整个 item 从 Active block 物理移到 Done block**。如果"section 是展示，status 是权威"，那 done 项可以**留在 Active 段**只要 `status: done`？这显然反直觉，但提案没写。

**Refine on cross's fix**:
- Cross 给两选一（status 是权威 / 移除 section），我选**前者 + 移动语义显式化**：
  - `status` 是唯一权威；
  - 每次 Claude 写回 BACKLOG，**必须按 status 重新归类 item 到对应 section**（in_progress/planned → Active, blocked → Blocked/On Hold, done/dropped → Done）；
  - 这条进 invariants（提议为 I7 或 cross/我合并后重新编号）。
- 不选"移除 section"——失去人眼快速 scan 的好处，违反提案 §3.1 末尾"headers 让人 scan 快"的设计意图。

**Severity**: 同意 MAJOR。

---

### M3 (cross MAJOR) `assigned_session` 身份不稳定 — **agree（与我 F2 收敛同源，cross 提出更干净的拆分）**

**Cross 原文核心**:
> `assigned_session` 可写 cwd、worktree name、`user-manual`，但算法又要用它判断活窗口和冲突……cwd、branch、worktree name 是不同层级的身份。

**Stance**: **agree** —— 这条与我 F2 是同一个病灶，但 cross 的拆分方案比我细。

**Reason**:
- 我 F2 把 `assigned_session` 拆成 `assigned_worktree` + `assigned_window_label` 两字段。Cross 拆成 4 个：`assigned_kind` / `assigned_cwd` / `assigned_branch` / `assigned_note`。
- Cross 的拆分**更接近真实身份模型**：cwd 是绝对路径（机器可验证）、branch 是状态（会变）、worktree name 是 eva.json owner 标签（设计意图）、kind 是分类。我的两字段方案丢了 branch 信息，eva:sessions 在 §3.4 步骤 5 拿"活窗口的 cwd / branch"——branch 字段实质上需要。
- 但 cross 也偏了：4 字段对 Phase 0 个人单机太重。Phase 0 真正用得上的只有 `assigned_cwd`（用来 join eva.json + eva:sessions 输出）和 `assigned_kind`（区分 `user-manual` vs Claude session）。

**Refine on cross's fix** (合并我 F2 + cross M3):
- Phase 0 schema：
  - `assigned_kind: "cursor-session" | "user-manual" | "external"`（必填，当 status=in_progress 时）；
  - `assigned_cwd: string?`（绝对路径，cursor-session 时必填；user-manual / external 时可留空或写说明）；
  - **不要** `assigned_branch` —— branch 是 derived，可以从 cwd → git symbolic-ref 取，存进 schema 是耦合短期状态到长期 record。
  - **不要** `assigned_note` —— 已有 `note` 字段，重复。
- 我 F2 的 invariant"`assigned_cwd` 必须对应 eva.json status=active 一行 worktree.path"保留，作为 boot ritual 健康检查项。

**Severity**: 同意 MAJOR。

---

### m1 (cross MINOR) `status: blocked` vs `blocked_by_dependency` 混用 — **agree**

**Cross 原文核心**:
> 有些任务是显式 `status: blocked`，有些是 `planned` 但依赖未完成导致 blocked by dep。

**Stance**: **agree** —— 算法层面 cross 抓得对，我没注意。

**Reason**:
- 我 F6 表里把"unblock 一项"当成高频操作，但**没区分"unblock 显式 blocked"和"unblock by-dep"**。后者是依赖项 done 后自动 unblock，前者需要用户改 `blocked_reason`。
- §3.4 步骤 1-2 算法把"depends_on 未完成"和"status=blocked"都从推荐池移除——但这两类的 UX 不一样：planned-blocked-by-dep 等待时不需要用户做任何事（依赖完成自动解锁），explicit-blocked 需要用户解锁动作。
- 算法应该在推荐输出里给出"为什么没推这条"：是 explicit blocked 还是 dep blocked。

**Refine**:
- §3.4 步骤 7 输出"top 3"时，**同时输出"被 filter 掉的 top 3 + 原因"**——让用户看见"为什么没推这些"，能发现 explicit-blocked 的解锁机会。
- Section 归类（M2 的后果）：planned-with-unmet-deps 留在 Active 段（因为 `status: planned`），不要因为"现在做不了"就移到 Blocked 段。Blocked 段只放 `status: blocked`。

**Severity**: 同意 MINOR。

---

### m2 (cross MINOR) `priority asc, size asc` 饿死大任务 — **disagree**

**Cross 原文核心**:
> 小任务优先容易闭环，但如果一直按 size asc，L 任务会持续排后。Suggested fix: 加 aging 规则，`planned_at` 超过 7 天后提升推荐权重。

**Stance**: **disagree** —— 这是 cross 在 Phase 0 引入了不必要的算法复杂度。

**Reason**（counterexample）:
- "饿死大任务"在企业 backlog（千项级、多人争资源）是真问题。Phase 0 是个人单机助理，BACKLOG 项总数 §10 列了不到 10 条，"饿死"的物理条件不存在。
- 现实场景：用户有 5-15 项 active backlog 同时存在，任意一项排第 3 后还是会被看到——因为 §3.4 输出 top 3 + 用户每次粘`看下一步`都会重排。L 任务排第 4-5 也只是延迟 1-2 个 session 被看见，不是"饿死"。
- §6 风险表已经识别了实际的高频/高影响风险（R2 YAML 解析错误、R3 用户忘短语、R6 boot ritual 忘读）。**m2 不在 top 10 里**，加 aging 规则反而给 Claude 推荐算法增加 surface 出错点（"为啥 7d 不 8d？"）。
- 用户记忆里有 [feedback_vessel_personal_use](~/.claude/projects/-Users-yongqian-Desktop-Vessel/memory/MEMORY.md)："按个人单机助理构建，不要按企业级部署形态过度工程化"——cross m2 违反这条精神。
- 真正的 mitigation：用户用`<id> 改 P0`手动调权（我 F6 提议加的短语就足以解决"我现在要做大的"）。

**Counter-suggestion**: m2 不修，把"避免饿死大任务"以**用户操作而非算法**解决——加`<id> 改 P<n>`短语就够了。如果真的发生饿死，加 priority bump 比 aging 简单 10 倍。

**Severity**: cross 标 MINOR，我**改成 DROP**。

---

### m3 (cross MINOR) `completed_at` 时间格式未明确 — **agree**

**Cross 原文核心**:
> 示例里有 ISO 字符串，但 schema 只写"done 时填"。明确使用 UTC ISO-8601。

**Stance**: **agree** —— 这是契约的最小钉死项，我漏了。

**Reason**:
- §3.1 schema 表 `completed_at` 只写"done 时填"，类型未明示。§10 例子`completed_at: 2026-05-11T13:09:00Z`是 UTC ISO-8601。
- Phase 2 进 harness.db 时（HARNESS_DATA_MODEL.md ADR-0010 字段加法）需要明确的时间类型映射——TEXT 存 ISO-8601 是 sqlite 标准。
- 这就是个一行修复，没理由不接。

**Refine**: 顺便规定其他时间字段（首行的"最近更新: 2026-05-12T..."）也用同样格式，避免文档头一个格式 / item 内另一格式。

**Severity**: 同意 MINOR。

---

### m4 (cross MINOR) rollback 低估了 BACKLOG 新增信息价值 — **agree**

**Cross 原文核心**:
> rollback 写"没数据丢失"，但如果用户在 Phase 0 期间新增了 backlog-only 的任务，删除文件后只剩 git history。

**Stance**: **agree** —— cross 抓到了 §9 的盲点。

**Reason**:
- §9 Rollback 写"删 docs/BACKLOG.md → 没数据丢失（done 项的信息在 git history + tags + PR）"——但这只考虑了 done 项。Phase 0 期间新加的 planned/blocked 项 git history 也有，但用户 rollback 之后**没工具读 git history 找回 backlog**，等于实际丢失。
- 这条与我 F9（重复登记 IDEAS.md/IMPROVEMENTS.md）有间接关联：如果 rollback 后回到 IDEAS.md/IMPROVEMENTS.md 流程，那些 backlog-only 新条目应该回流到 IDEAS.md。

**Refine on cross's fix**:
- 不是 "rollback 前导出到 IDEAS.md"——这要求 rollback 时机点用户手动操作，容易漏。
- 更稳：**Phase 0 期间每次 Steward 写 BACKLOG 时，同步追加一行到 `~/.vessel/backlog-mirror.jsonl`**（out-of-repo，append-only，per-machine）。Rollback 时这个 mirror 文件还在，Phase 1 vessel-cli 加 `vessel backlog import-mirror`。这条 mirror 还能间接做 audit log（即使 git commit 失败也有痕迹）。

**Severity**: 同意 MINOR。

---

### Lens-5 (cross "集体盲区检测" Score 3.0) — 隐含发现 — **agree-as-meta**

**Stance**: cross 在 Numeric Score 里给 Lens-5（集体盲区检测）打了 3.0，是 5 个维度里**最低的**。这是 cross 的 meta-signal——不是单点 finding，但反映了"两个 reviewer 可能都没抓到的盲区"。

**My read**: cross 在 B1 / M1 抓到了"两个看似无关的设计决策叠加产生用户面矛盾"——这种"两条都看似合理的 contract 一起出现就崩"的盲区，我 Phase 1 完全没意识到。我把每条 invariant / 字段 / 算法分别评估，没做 **invariant 之间的 cross-product 检查**。

这是真盲区。

---

## Self-correction of my Phase 1 verdict

### Downgrade

- **F3 → 部分被 cross M1 替代**：我 F3 的核心攻击点（branch-protection 冲突）保留，但 "commit 隔离"那一半被 cross M1 更准地讲了。**F3 保持 MAJOR**，但 Phase 2 final 应该把 F3 重组成"commit 落到哪"+ M1 重组成"commit 包含什么"两条独立 MAJOR，不要混。

### Withdraw

- 没有完全 withdraw 的。所有 F1-F12 在 cross 的镜照下都还成立。

### Add (cross 让我看见的新点)

- **F13（新）—— Invariant 之间的 cross-product 检查缺失**：I3（每次 status 转移 commit）+ §3.5 "git worktree add + eva.json edit + commit"+ §5 ADR-lite "single-session 假设"——这三条单独看都合理，三条放一起就矛盾（多窗口需要 commit BACKLOG，但 single-session 假设下没有 merge 协议；新窗口需要 worktree，但主窗口正在 commit BACKLOG）。**契约文档 ship 前必须做一次"任两条 invariant 同时为真时是否合法"的 ×× 校验**。这是方法论层 finding，进 STEWARD-V0 的 §4 invariants 节"Cross-invariant compatibility check"小段。
- **F14（新）—— B1 揭示的 G1 二义性是连锁性的**：cross B1 让我看见"零 CLI 负担"的 user-面 vs system-面歧义不只影响 §3.5/3.6，**还污染 §7 dogfood scenarios 的 acceptance criteria**——Scenario C "Claude 自动建议开新窗口 + 执行 worktree/eva.json 准备" 里的"执行"在 user-面解读下是 0 CLI（Claude 给指令），在 system-面解读下是 Claude 直接 spawn `git worktree add`。Dogfood pass 标准不同。Scenario 必须基于 §3.7 白名单（B1 的 refine fix）重写。

### Severity 变更总览

| 我的 Finding | Phase 1 sev | Phase 2 改 | 理由 |
|---|---|---|---|
| F1 id namespace | BLOCKER | BLOCKER 保留 | cross 没攻击这点，但仍是真问题 |
| F2 assigned_session | MAJOR | **收敛进 cross M3** | cross 的 4 字段拆分更好，但需 refine 到 2 字段 |
| F3 commit/branch | MAJOR | MAJOR 保留 + **拆出 cross M1** | F3 = "落到哪"，M1 = "包含什么"；两条都必须独立修 |
| F4 eva:sessions 接口 | MAJOR | MAJOR 保留 | cross B1 让 F4 升级为 G1 矛盾的症状，但 stable JSON output 修复仍独立有效 |
| F5 inbox/lesson 边界 | MAJOR | MAJOR 保留 | cross 没攻击这点 |
| F6 6 prompts 不够 | MAJOR | MAJOR 保留 | cross m1 补强了"unblock 子类" |
| F7 boot ritual 可靠性 | MAJOR | MAJOR 保留 | cross 没触及，这是真盲区 |
| F8 parallel_safe_files 命名 | MINOR | MINOR 保留 | cross 没触及 |
| F9 重复登记 IDEAS/IMPROVEMENTS | MINOR | MINOR 保留 | cross m4 间接相关 |
| F10 stale 24h 阈值 | MINOR | MINOR 保留 | 同上 |
| F11 done 项保留矛盾 | MINOR | MINOR 保留 | 同上 |
| F12 STEWARD_PROMPTS.md 未给 | MINOR | MINOR 保留 | 同上 |
| **F13 新 — invariant cross-product** | — | **MAJOR** | cross 触发 |
| **F14 新 — G1 污染 dogfood criteria** | — | **MINOR** | cross 触发 |

---

## New findings (after cross-pollinate)

### F13 [MAJOR-new] Invariants 之间缺 cross-product 兼容性检查

**Where**: §4 I1-I6 整段

**Issue**: I3 "每次 status 转移 commit" + §3.5 "Claude 自动 git worktree add + eva.json edit + commit" + §5 ADR-lite "single-session 假设" 三条 invariants/约定单独看都合理，**两两交叉则崩**：
- (I3) × (single-session 假设)：主窗口忙时新窗口要改 BACKLOG 怎么办？没 merge 协议。
- (I3) × (worktree edit)：跨两文件 commit，谁先谁后失败回滚？
- (single-session) × (§3.5 开新窗口流程)：流程本身要求多窗口。

**Why MAJOR**: Phase 0 ship 后 第一周必撞，且每个 invariant 独立修都不够，需要联合 redesign。

**Fix**: §4 加 §4.X "Invariants compatibility matrix" —— 列出 I1-I7（cross + 我加的新 invariant）的两两组合是否有冲突或前置约束。这是 contract review 模式应该有的自检表。

### F14 [MINOR-new] G1 二义性污染 §7 dogfood scenarios pass 标准

**Where**: §7 Scenarios C / D / E

**Issue**: 在 G1 二义未澄清前（B1），Scenarios C "执行 worktree/eva.json 准备"、D "调 eva:hook pre-remove"、E "新条目加进 BACKLOG.md 并 commit" 的 pass criteria 都依赖 Claude **实际执行**而非"给指令"。如果 B1 fix 选了"Claude 不代执行 CLI"路线，这些 scenarios 全过不了——但提案没说 dogfood criteria 在两种 B1 fix 路线下如何调整。

**Fix**: §7 引言加一句"以下 scenarios 的 pass criteria 取决于 §3.7（B1 fix 引入的）Claude 代执行白名单——见 §3.7 表"。

---

## Convergence recommendation

合并 cross + 我两份 verdict，作者应优先修复的 top 5：

### 1. [BLOCKER] G1 "零 CLI 负担"二义性 + Claude 代执行白名单 (cross B1 + 我 F4 + F14 + F7)
**核心改动**：
- §2 G1 rewrite：用户面 0 CLI ≠ 系统内 0 CLI；
- 新增 §3.7 Claude 代执行白名单（只读默许 / 写入需 ack / 永不执行）；
- §3.3 boot ritual 改 lazy（只读默许的命令也不要在 boot 阶段串行跑全套），把 eva:sessions 从 boot 移到 lazy；
- §3.7 同时给 eva:sessions 加 `--format json` 稳定输出（我 F4）。
- 这一条同时解决 cross B1、我 F4、F7（boot 流程稳定性）、F14。

### 2. [BLOCKER + MAJOR] BACKLOG ↔ harness.db ↔ eva.json 三方身份契约 (我 F1 + F2 + cross M3 + F13)
**核心改动**：
- §3.1 schema：`id` 加 `bl-` 前缀约束（我 F1）+ `harness_issue_id?` 字段（我 F1）+ `assigned_kind` / `assigned_cwd` 拆分（cross M3 + 我 F2 合并）；
- §4 新增 invariants：BACKLOG id ↔ harness.db id 命名空间隔离 / `assigned_cwd` 必须 join eva.json `worktrees[].path` / status=权威 section=展示（cross M2）；
- §4 新增 invariant cross-product matrix（我 F13）。

### 3. [MAJOR] BACKLOG commit 协议 (cross M1 + 我 F3)
**核心改动**：
- 拆成两个独立问题：
  - **commit 内容隔离** (cross M1)：Steward 只 stage 白名单文件，unrelated dirty → 停下确认；
  - **commit 落到哪** (我 F3)：BACKLOG 走 `main` 直 push 例外 (branch protection 加 path exception) **或** out-of-repo `~/.vessel/backlog.yaml`。Phase 0 推荐后者，Phase 1 进 repo（推翻提案 §5 ADR-lite 此条）。
- I3 改写："每次 status 转移**写一次** + commit 内容隔离 + push 视分支策略"。

### 4. [MAJOR] Section vs status 双 source + 6 prompts 不够 + status 子分类 (cross M2 + m1 + 我 F6)
**核心改动**：
- §4 新增 invariant："status 字段是唯一权威；section 是展示，写回时按 status 重新归类"（cross M2）；
- §3.4 算法区分 explicit-blocked vs blocked-by-dep，输出"被 filter 掉的 + 原因"（cross m1）；
- §3.2 改为 8 prompts：去掉"看活窗口"（并入"看下一步"），加`<id> 改 P<n>` / `<id> 解锁` / `<id> 不做了 <reason>`（我 F6）。

### 5. [MAJOR] inbox/lesson/IDEAS/IMPROVEMENTS 边界 + STEWARD_PROMPTS.md 交付物 + rollback 数据保护 (我 F5 + F9 + F12 + cross m4)
**核心改动**：
- §3.1 `refs` 字段格式锁死 `<kind>:<id>`（我 F5）；
- §4 新增 invariant：BACKLOG 与 inbox/memory.db 只通过 refs 互引（我 F5）；
- §10 初始填充的项加 `refs:` 引用 IDEAS.md（我 F9 dogfood）；
- §9 Migration in 加 STEWARD_PROMPTS.md 内容大纲（我 F12）；
- §9 Rollback 加 mirror.jsonl 机制（cross m4 refined）。

---

### 不在 top 5 的剩余项（可一并修但优先级低）
- m3 时间格式 ISO-8601（一行修），同 commit 修
- F8 `parallel_safe_files` → `touches_paths` 改名 + 与 eva.json `owns` pattern 对齐
- F10 stale 24h → 7d
- F11 §5 ADR + R4 一致化
- cross m2 **不修**（disagree，单机助理无饿死风险）

---

## Independence note

我 Phase 1 在"What I Did Not Look At"里声明没读 cross verdict，本 Phase 2 react 是合规的二阶段工作。cross 显式声明"没有读取实际 STEWARD-V0-DESIGN.md，只审了 /tmp/steward-v0-cross-prompt.md 中包含的 artifact 内容"——也就是说 cross 是基于注入 prompt 的内容审的，没 fresh-read 原文件。这点对其 Lens-2 跨端对齐（3.5）的可信度有影响，但因为 prompt 是从原文件抽的，B1/M1/M2/M3 的认定不受影响。
