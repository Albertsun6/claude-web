# Steward V0 — 总管系统设计提案

**Status**: **Converged after Phase 1+2+3 review** · Version **v0.3** (amended in-place 2026-05-12 with §3.5 dispatch protocol + I11; lightweight refinement within v0.2 contract spirit — no new review)
**Review verdict**: ✅ accepted (with 5 partial-accepts + 1 rebuttal) — see [`steward-v0-arbitration-2026-05-12-0026.md`](../reviews/steward-v0-arbitration-2026-05-12-0026.md)
**Reviewers**: harness-architecture-review (Claude general-purpose) + reviewer-cross (cursor-agent gpt-5.5-medium)
**Author**: Albert (via Claude main session) · **Date**: 2026-05-12
**Scope**: Phase 0 MVP only. Phase 1/2 explicitly defer. **Contract — all future sessions bound.**

---

## 1. Problem

Vessel 项目目前的**任务追踪状态分散在 5 个地方**：

| Surface | 数据 | 状态 |
|---|---|---|
| `docs/IMPROVEMENTS.md` | P0-P3 技术债 | 滞后 |
| `docs/IDEAS.md` | P1-P9 想法库 | 滞后 |
| `docs/HARNESS_ROADMAP.md` | M-1 → M7 里程碑 | 跨度大 |
| Inbox (`~/.vessel/inbox.jsonl`) | 30 秒碎想 | 活跃 |
| `harness.db` issue 表 | M-1 spike 设计 | **空** |

操作层 4 个真实痛点：

1. 每个新 Claude session 不知道今日卡点（无启动仪式）
2. 跨 session 协调靠主用户脑记
3. 完成后没人收尾（PR merge 后 inbox / docs 待办没人 archive）
4. 决定"开不开新窗口"靠每次问 Claude（决策树没工具化）

## 2. Goals

**MVP（Phase 0）必须满足**：

- **(G1)** **用户从不在终端敲命令；Claude 代执行命令需明确归类 + 用户授权**（v0.2 改写——见 §4 I8 三层执行白名单）
- **(G2)** 单一 source of truth — 所有待办落在一个文件
- **(G3)** 跨 session 可见 — 任何窗口的 Claude 启动时都能读
- **(G4)** ≤ 9 个 prompt 短语 — 覆盖 80% 操作（v0.1 是 6 个，review 后扩 9）
- **(G5)** 可演化 — Phase 1 加 CLI / 自动同步 / Phase 2 升级到 harness Issue 表时不破坏 Phase 0 的人工编辑

**非目标**：REST API / 后端服务、DB schema 改动、iOS UI / 移动端总管、自动 tick scheduler、inbox auto-promote、自动 lesson 写入。这些都留给 Phase 1+。

## 3. Design

### 3.1 Single source of truth: `docs/BACKLOG.md`

人 + Claude 都读的**唯一**文件。结构（**v0.2 锁死**）：

````markdown
# Vessel Backlog

最近更新: 2026-05-12T...Z
Steward 启动仪式: 见 `docs/STEWARD_PROMPTS.md` (`/boot` 或 `看 backlog 推荐下一步`)

---

## Active (in_progress / planned)

```yaml
items:
  - id: testflight-encryption-compliance
    title: TestFlight Build 49 加密合规对话框
    priority: P1
    size: S
    status: in_progress
    assigned_kind: user-manual
    depends_on: []
    parallel_safe_files: []
    note: "App Store Connect → Seaidea → TestFlight → 编辑加密信息"
    refs: ["pr:#42"]

  - id: m2-voice-proposal
    title: M2-Voice Capability 设计提案
    priority: P2
    size: M
    status: planned
    assigned_kind: main           # 候选；任何一个 main 窗口可领
    parallel_safe_files: ["docs/proposals/"]
    refs: []
```

## Blocked / On Hold

```yaml
items:
  - id: m2-ops-mvp
    title: M2 OperationsDispatcher v0
    priority: P3
    size: L
    status: blocked
    blocked_reason: "用户 2026-05-11 决定先不做"
    note: "orchestrator.ts 已留 TODO(ops-mvp) 占位"
```

## Done

```yaml
items:
  - id: m2-ios-gamma-prep
    title: M2-iOS-γ prep
    status: done
    completed_at: 2026-05-11T13:09:00Z
    refs: ["pr:#42", "pr:#44", "pr:#45", "commit:8743fc5"]
```
````

**Schema 字段 v0.2 锁死**：

| 字段 | 必填 | 含义 | 约束 |
|---|---|---|---|
| `id` | ✓ | backlog-local 自然键，永久不变 | 正则 `^[a-z][a-z0-9-]{2,63}$`；与 eva.json `name` 对齐 |
| `title` | ✓ | 人可读简述 | ≤ 80 字 |
| `priority` | ✓ | `P0` 阻塞 / `P1` 重要 / `P2` 一般 / `P3` 可延 | 严格枚举 |
| `size` | ✓ | `S` ≤ 30min / `M` ≤ 半天 / `L` ≥ 1 天 | 严格枚举 |
| `status` | ✓ | `planned` / `in_progress` / `blocked` / `done` / `dropped` | **唯一权威** (I10); section header 仅作导航 |
| `depends_on` | — | 其他 id 列表；未 done 视为 computed-blocked | 数组，可空 |
| `conflicts_with` | — | 其他 id 列表；同时 in_progress 互斥 | 数组，可空 |
| `parallel_safe_files` | — | task-级冲突预测，路径前缀列表 | 与 eva.json `owns` 不同语义 (I7-comp) |
| `assigned_kind` | — | `main` / `worktree` / `user-manual` / `external` | 枚举 |
| `assigned_cwd` | — | 若 `assigned_kind=worktree` 必填，必须匹配 eva.json 某 worktree 的 `path` | 路径 |
| `blocked_reason` | — | `status=blocked` 时**必填**；computed-blocked (depends_on) 不需要 | 自由文本 |
| `note` | — | 自由文本上下文 | — |
| `completed_at` | — | `status=done` 时填 | **ISO-8601 UTC**, 带 `Z` 后缀 |
| `refs` | — | 相关引用，**格式 `<kind>:<id>`** | 例：`inbox:<uuid>` / `pr:#42` / `commit:<sha>` / `lesson:<id>` / `adr:<num>` |
| `harness_issue_id` | — | **Phase 0 留空**；Phase 2 promote 时填真 issue UUID | 字符串 |

**为什么 fenced YAML in markdown**：M1 信号 #1 教训——markdown 行级 merge 在 rebase 后语义漂移。YAML 有结构；wrap 在 fence 里人眼仍当文档。Headers (Active / Blocked / Done) 让人快速 scan，**但解析时只看 `status` 字段** (I10)。

### 3.2 用户面 phrasebook: `docs/STEWARD_PROMPTS.md` — **9 个短语**

| # | 操作 | Prompt 短语 |
|---|---|---|
| 1 | Boot ritual fallback | `/boot` 或 `看 backlog 推荐下一步` |
| 2 | 开始一项 | `开始干 <task-id>` |
| 3 | 收一项 | `<task-id> 收线` |
| 4 | 加一项 | `加待办: <title>; P<0-3>; <S/M/L>; [note]` |
| 5 | 标 blocked | `<task-id> blocked 因为 <reason>` |
| 6 | **改优先级**（新） | `<task-id> 改 P<0-3>` |
| 7 | **unblock**（新） | `<task-id> unblock` |
| 8 | **drop**（新） | `<task-id> drop 因为 <reason>` |
| 9 | 看活窗口 | `现在哪些窗口在干啥` |

**约定**：
- Claude 看见 1-8 → 读 BACKLOG.md + 写回（必要时） + commit (I9 守门)
- Claude 看见 9 → 跑 `pnpm eva:sessions`（lazy，不在 boot 时跑——F4 修订）
- Claude 改 BACKLOG 总以 `chore(backlog):` 前缀 commit；脏 working tree 须 ack（I9）

### 3.3 Session boot ritual — **lazy, fallback-first**

在 `CLAUDE.md` 加一节（**v0.2 lazy 化**）：

```markdown
## Session boot ritual (steward v0)

新 Claude 会话**应**在第一次回应用户前：

1. 读 `docs/BACKLOG.md`（必须）
2. 若顶部"最近更新"> **72h**（v0.2 改），提醒 "Backlog stale"
3. 简要 echo：「Backlog: N 项 in_progress · M 项 planned · K 项 blocked」

**Lazy**：`pnpm eva:sessions` 不在 boot 时跑——用户问"下一步"/"活窗口"再跑。

**Fallback**：若 Claude 没主动 echo，用户粘 `/boot` 或 `看 backlog 推荐下一步` 触发。预期 5 秒内响应。
```

**Reliability**：Cursor 没暴露 session-start hook 给 extension，靠 CLAUDE.md 约定 ≈ 80% 命中。Phase 0 不做 cold-boot gate；用户察觉漏时 `/boot` 手动触发即可（F7 partial-accept）。

### 3.4 "下一步推荐" 算法

Claude 读完 BACKLOG.md，对 `看下一步` 请求：

```
1. 过滤 status=planned 的项
2. 移除 depends_on 还有未 done 项的（computed-blocked）
3. 移除 conflicts_with 任何 in_progress 项的
4. 排序键：(priority asc, size asc)   # P0 优先，小任务先闭环
5. 跑 eva:sessions（lazy，此刻才跑）看活窗口的 cwd / branch
6. 对每个候选打标签：
   - "本窗口直接做"：当前 session 闲 + cwd 跟 parallel_safe_files 不冲突
   - "需开新窗口"：当前 session 忙 + parallel_safe_files 不跟现有窗口重叠
   - "等着"：跟现有 in_progress 项冲突
7. 输出 top 3 + 标签 + 给"开新窗口"的具体命令
```

### 3.5 "开始一项" 流程 (`开始干 <id>`) — Dispatch 协议（v0.3 amendment）

```
1. 读 BACKLOG 找 id
2. 检查 status=planned（否则报错）
3. 检查 depends_on 全 done（否则报错: "computed-blocked by X, Y"）
4. 跑 eva:sessions 看活窗口冲突

5. Claude **不直接动手**，先给 spawn 分析 + 推荐：

   echo:
     Task: <id>
       size=<S/M/L> · priority=<P0-3> · parallel_safe_files=[...]
       depends_on=[...] · assigned_kind 候选=<main|user-manual>

     Spawn 分析：
       • size 维度 → <SPAWN 倾向 | STAY 倾向 | 中性>
       • parallel_safe_files 跟主窗口最近改的文件 <重叠 / 零重叠>
       • 主窗口状态 <idle | busy | in-context>
       • eva:sessions：除我外 N 个活窗口

     建议：<SPAWN | STAY | USER-MANUAL>
     理由：<1-2 句>

     你的选择：ok spawn | ok stay | 用户做 | drop / blocked / 改 P<n>

6. 等用户回复 1 个短语 (I8 mid-tier ack):
   - `ok spawn` → 执行 spawn 流程 (a-e)，每步执行前再 echo 一次
       a. git worktree add -b feat/eva-<id> ~/Desktop/Vessel-<id> dev
       b. 编辑 eva.json（add worktree entry）
       c. open -a Cursor ~/Desktop/Vessel-<id>
       d. 给新窗口的 prompt 模板: "开始干 <id>，详情见 docs/BACKLOG.md"
       e. update BACKLOG (status: in_progress, assigned_kind: worktree, assigned_cwd: <path>)
   - `ok stay` → 更新 (status: in_progress, assigned_kind: main)
   - `用户做` → 更新 (status: in_progress, assigned_kind: user-manual)
   - drop / blocked / 改 P → 对应 prompt 处理

7. commit (I9 守门)：chore(backlog): start <id>
```

**关键不变量**（新增）：

- **I11**：所有 spawn / stay / user-manual 决策必须由用户显式拍板。Claude 给推荐 + 理由，但永远不静默选边。这是 I8 mid-tier "write needs ack" 在 dispatch 场景的细化体现。

**推荐启发式表** (Claude 给推荐时参考)：

| 场景 | Claude 建议 |
|---|---|
| `size=L` 任意 | SPAWN |
| `size=M` + parallel_safe_files 跟主窗口零重叠 | SPAWN |
| `size=M` + 主窗口刚 commit 完 idle | SPAWN |
| `size=M` + 主窗口在做相关工作 | STAY |
| `size=S` + docs / scripts 小作用域 | STAY |
| `size=S` + 改产品代码 | 中性（让用户拍） |
| `assigned_kind 候选=user-manual` | USER-MANUAL |
| 主窗口在等 (CI / Apple / review) + task 独立 | SPAWN |

启发式不是硬规则；Claude 可结合 parallel_safe_files、conflicts_with、主窗口最近 git activity 调整。

### 3.6 "收线" 流程 (`<id> 收线`)

```
1. 读 BACKLOG 找 id
2. 检查 status=in_progress
3. 询问用户 outcome: done | blocked | dropped
   - done: 标 completed_at (ISO-8601 UTC + Z) + refs (PR/commit)
   - blocked: 改 status=blocked + blocked_reason
   - dropped: 改 status=dropped + reason 进 note
4. 若 assigned_kind=worktree:
   - 跑 pnpm eva:hook pre-remove --dry-run → 用户 ack (I8)
   - pnpm eva:hook pre-remove --yes
   - eva.json 标 status=done
5. 移到 BACKLOG.md done 段落（手动 cut/paste；section 是人眼导航不是机器权威——I10）
6. **不自动写 lesson**（仍 defer，F5 部分接受）
7. commit (I9 守门)：chore(backlog): close <id>
```

## 4. Invariants

**v0.2 锁死的不变量**：

- **I1**：BACKLOG.md 是唯一的写入点。其他 doc 不复制 backlog 项。
- **I2**：id 是 kebab-case 且永久不变（rename 算新建一个）。
- **I3**：每次 status 转移**产出可审计 diff**；是否 commit + 提到哪个分支取决于 git status（见 I9）。
- **I4**：done 项不删除，永久 append。Dropped 也保留。
- **I5**：用户从不写 YAML；Claude 改完给用户看 diff，用户复核。
- **I6**：不复制 inbox.jsonl 或 docs/IMPROVEMENTS.md 内容到 backlog —— 引用即可（`refs: [...]`）。
- **I7 (新)**：BACKLOG.id 永不写入 harness.db `issue.id`。两套命名空间隔离；Phase 2 promote 时新建 issue.id (UUID) 并填 BACKLOG.harness_issue_id。
- **I7-comp (新)**：BACKLOG.parallel_safe_files 是 **task-级冲突预测**；eva.json `owns` 是 **worktree-级所有权声明**。两套语义独立，可以重叠不互替。
- **I8 (新)** **三层执行白名单**：
  - **read-only auto** — 默许 Claude 自动跑（`git status` / `ls` / `cat` / `pnpm eva:sessions`）
  - **write needs ack** — Claude 跑前显式 echo 命令 + 等用户肯定 `ok/yes/继续/上`（`git commit` / `gh pr edit` / 改文件）
  - **destructive needs explicit affirmative** — 不可静默自动；用户必须主动短语肯定（`rm -rf` / `git push --force` / `git worktree remove`）
- **I9 (新) commit 守门**：改 BACKLOG.md 后：
  - `git status --porcelain` 若**只有** BACKLOG.md → 自动 `git add docs/BACKLOG.md && git commit`
  - **有其它 dirty 文件** → 只 `git add docs/BACKLOG.md`，commit 前给用户 diff 摘要 + ack (I8)
  - 决不静默 stage 用户其它 dirty 文件
- **I10 (新)** `status` 字段是 backlog 状态的**唯一权威**。Section header (Active / Blocked / Done) 仅作人眼导航。Claude 解析 BACKLOG 时**只看 `status`**。
- **I11 (v0.3 amendment)** Dispatch 决策必经用户拍板。`开始干 <id>` 触发时 Claude 给 spawn 分析 + 推荐 + 等用户回 `ok spawn` / `ok stay` / `用户做`；永不静默选边。这是 I8 mid-tier "write needs ack" 在 dispatch 场景的细化。

### 4.5 不变量兼容性矩阵（F13 NEW）

I3 × I8 × I9 × I10 两两兼容性自查：

| 组合 | 兼容？ | 备注 |
|---|---|---|
| I3 + I8 | ✓ | I8 提供 commit 时的用户 ack；I3 不强制立即 push |
| I3 + I9 | ✓ | I9 解释了 I3 "commit 视情况" 的实际策略 |
| I8 + I9 | ✓ | I9 dirty 情况下 commit 触发 I8 ack |
| I3 + I10 | ✓ | status 变化 → diff 可审计（I3）；section 不参与（I10） |
| I7 + I10 | ✓ | id 唯一性独立于 status 语义 |
| I8 + I10 | ✓ | I10 是解析约定；不涉及命令执行 |

无冲突。F13 关切已闭。

## 5. ADR-lite

**核心决策**（详见 `docs/adr/vessel/ADR-019-steward-v0-contract.md`）：

| 决策 | 选择 | 替代 (拒绝原因) |
|---|---|---|
| 单一文件 vs 多文件 | 单一 `docs/BACKLOG.md` | 多文件 = 认知负担 |
| YAML in fenced block vs 纯 JSON/TOML | YAML in fence | git diff 友好 + 人读舒服 |
| 文件位置 | `docs/BACKLOG.md` (in-repo) | out-of-repo `~/.vessel/backlog.yaml` — **拒**：换问题不解问题（path 发现 + 跨 session 知晓） |
| 是否带 CLI | **不带（Phase 0）** | YAGNI；Claude 直接读写文件够；Phase 1 再加 |
| 是否动 harness.db Issue 表 | **不动** | 留 `harness_issue_id` 字段做 Phase 2 桥接 (I7) |
| 用户接口 | **9 个 prompt 短语** | 自然语言任意 = 收敛操作范围；6 个不够（review F6） |
| 删除 done 项? | **200KB 阈值后 quarterly archive** | 永久保留 = 文件膨胀；季度 archive 平衡了审计与膨胀 |
| 并发写? | **single-session 假设 + I9 commit 守门** | 文件锁 / merge driver 太重；I9 用 git status 检查替代 |
| `bl-` 前缀 强制? | **拒** | review F1 反驳：`harness_issue_id` 字段 + I7 已够，prefix 是冗余 |
| priority+size 排序饿死? | **拒** | review m2 反驳：Phase 0 单用户无并发竞争，无饿死物理条件 |
| 5x cold-boot gate? | **拒** | review F7 反驳：Phase 0 过重；`/boot` fallback 短语足够 mitigation |

## 6. Risks + Mitigations

| 风险 | 概率 | 影响 | Mitigation |
|---|---|---|---|
| R1 BACKLOG.md merge 冲突 | 低 | 中 | 文档约定「只主窗口改 backlog」+ Phase 1 加 CLI 时引入软锁 |
| R2 Claude 解析 YAML 出错损坏数据 | 中 | 高 | (a) schema 锁死 + invariants (b) Claude 改完必显示 diff 待用户复核 + (c) `~/.vessel/backlog-mirror.jsonl` append-only mirror 兜底（**v0.2 新**） |
| R3 用户忘记短语 → free-text 指令 | 高 | 低 | STEWARD_PROMPTS.md 例丰富；Claude 看到 free-text 主动建议「你是说『看 backlog 推荐下一步』吗？」 |
| R4 done 项太多文件膨胀 | 低 | 中 | 200KB 阈值后 quarterly archive 到 `docs/BACKLOG-archive-YYYY-Q.md`（v0.2 改） |
| R5 Phase 2 升 Issue 表 schema 冲突 | — | — | I7 + `harness_issue_id` 字段已预留（v0.2 新） |
| R6 Claude 忘自动读 BACKLOG | 中 | 中 | CLAUDE.md boot ritual + `/boot` fallback（v0.2 新） |
| R7 Claude 静默执行 destructive 命令 | 低 | 高 | I8 三层执行白名单（v0.2 新） |
| R8 BACKLOG + eva.json 状态漂移 | 中 | 中 | invariant：同次认领 / 收线在同 commit 落两文件改动（§3.5 / §3.6） |

## 7. Verification (dogfood gate)

**实施完成后，执行下列 dogfood scenarios，全过才算 Phase 0 ship**。**全部 scenario 通用 pass criterion**：**用户全程未在终端敲命令**（验证 G1 + I8）。

1. **Scenario A — 看下一步**:
   - 新会话 → 用户粘 `/boot` → 期望 Claude echo backlog 摘要
   - 用户粘 `看下一步` → 期望 top 3 候选 + 标签 + 至少一个可立刻执行的建议
   - **Pass criterion**: 用户没敲任何命令；Claude 所有执行项 echo 出来

2. **Scenario B — 开始一项（同窗口）**:
   - 主窗口粘 `开始干 testflight-encryption-compliance`
   - 期望：status: planned → in_progress；commit (I9 触发) ack 后落；Claude 输出下一动作

3. **Scenario C — 开始一项（新窗口）**:
   - 主窗口忙时粘 `开始干 m2-voice-proposal`
   - 期望：Claude 自动建议开新窗口 + I8 ack 后执行 worktree/eva.json 准备 + 给新窗口的 prompt 模板

4. **Scenario D — 收线**:
   - 任意已 in_progress 项粘 `<id> 收线`
   - 期望：Claude 询问 outcome → 更新 BACKLOG → 如果有 worktree 调 eva:hook pre-remove (I8 ack)

5. **Scenario E — 加待办**:
   - 粘 `加待办: 修 inbox iOS 视图的滑动 lag; P2; M`
   - 期望：新条目加进 Active 段，分配新 id，commit (I9)

6. **Scenario F — Boot ritual auto-trigger**:
   - 新 Cursor 会话**完全不给任何指示**，看 Claude 启动行为
   - 期望（不是硬 gate）：根据 CLAUDE.md boot ritual，主动读 BACKLOG.md + echo 摘要
   - **Fallback 验证**：若没自动 echo，粘 `/boot` 应在 5 秒内得到 backlog 摘要

7. **Scenario G — 三层执行白名单**:
   - 粘 `m2-voice-proposal drop 因为 改方向`
   - 期望 Claude 视为 write 操作 (I8 mid-tier)，echo 出要写入的 diff + 等 ack 后落
   - 进一步：让 Claude 跑 `git push --force`（destructive）→ 期望 Claude 拒绝静默执行 + 要求用户主动短语肯定

**全过** → ship。**任一失败** → 修设计。**Scenario F 不通过不阻塞 ship** —— `/boot` fallback 是兜底。

## 8. Out of scope (defer to Phase 1+)

- `scripts/vessel-cli.mjs` — CLI 调用 Phase 0 不要；Phase 1 再加
- Inbox auto-promote 到 backlog
- IMPROVEMENTS.md / IDEAS.md 单向同步
- harness Issue 表自动激活
- 完成自动写 lesson
- iOS Inbox 视图加 "promote to backlog" 按钮
- 并发写 conflict 严格处理（M1 信号 #1 类问题）
- `pnpm eva:sessions --format json` —— 列为 backlog 项 `eva-sessions-json-output` (P2, S)，单独 PR

## 9. Migration / Rollback

**Migration in**:
- 把当前对话流活跃项填充 BACKLOG.md（约 8-10 条；**不**复制 IMPROVEMENTS/IDEAS 的 P0-P3）
- 改 CLAUDE.md 加 boot ritual + I8/I9 引用
- 加 `docs/STEWARD_PROMPTS.md`
- 加 `docs/adr/vessel/ADR-019-steward-v0-contract.md`
- 一个 PR 一起合 dev → main

**Rollback**:
- 删 docs/BACKLOG.md + docs/STEWARD_PROMPTS.md + ADR-019 + CLAUDE.md 那一节
- 在 Phase 0 期间新增的 backlog-only 任务（未进 IMPROVEMENTS/IDEAS）从 `~/.vessel/backlog-mirror.jsonl` 复原（**v0.2 新**）

## 10. 当前 backlog 项 — 初始填充

ship 时 BACKLOG.md 应包含的初始条目（**只放对话流活跃的，不复制 IMPROVEMENTS/IDEAS 已有的 P0-P3**——F9 部分接受）：

**Active**:
- `testflight-encryption-compliance` (P1, S, in_progress, user-manual)
- `testflight-install-verify` (P1, S, planned, user-manual, depends_on=testflight-encryption-compliance)
- `voice-roundtrip-measure` (P2, M, planned, user-manual, depends_on=testflight-install-verify)
- `offline-checklist-verify` (P2, S, planned, user-manual, depends_on=testflight-install-verify)
- `m2-voice-proposal` (P2, M, planned, docs only — 并行候选)
- `eva-sessions-json-output` (P2, S, planned, parallel_safe_files=["scripts/"])

**Blocked**:
- `m2-ops-mvp` (P3, L, blocked: 用户 2026-05-11 决定先不做)
- `cross-session-messaging` (P3, M, blocked: 无具体场景)

**Done (历史佐证)**:
- `intent-classifier-v1` (refs: pr:#39, tag:v0.7.0-M2)
- `eva-sessions-derived-view` (refs: pr:#40)
- `m2-ios-gamma-prep` (refs: pr:#42, pr:#44, pr:#45, tag:v0.7.1-M2gamma, tag:v0.7.2)
- `galaxy-telecom-team-fix` (refs: pr:#44, pr:#45, tag:v0.7.2)

---

## Review trail

- Proposal v0.1: 原稿（已被本 v0.2 覆盖）
- Phase 1 verdicts:
  - arch: `docs/reviews/steward-v0-arch-2026-05-12-0026.md`
  - cross: `docs/reviews/steward-v0-cross-2026-05-12-0026.md`
- Phase 2 react verdicts:
  - arch react: `docs/reviews/steward-v0-react-arch-2026-05-12-0026.md`
  - cross react: `docs/reviews/steward-v0-react-cross-2026-05-12-0026.md`
- Phase 3 arbitration: `docs/reviews/steward-v0-arbitration-2026-05-12-0026.md`
- ADR-lite: `docs/adr/vessel/ADR-019-steward-v0-contract.md` (待写)

**收敛 verdict**: ✅ 12 accept · ⚠️ 5 partial · 🚫 1 rebut (cross m2) · 🟡 0 user-decision
