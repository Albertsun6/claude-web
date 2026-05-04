# Parallel Work Orchestrator — 调研报告 v0.5

> **Status**: research / proposal · **Date**: 2026-05-03 · **Author**: Claude (Opus 4.7)
> **Review depth**: Phase 1 (Claude arch + **cursor-agent gpt-5.5 cross**, 异质对) + Phase 2 cross-pollinate + Phase 3 author arbitration · **Round**: 收敛
> **Iteration log**:
> - v0.1 双 Claude reviewer 集体盲区
> - v0.2 (15 ✅ / 1 ⚠️ / 0 🚫 / 1 🟡 看似收敛) — 基于 v0.1 schema 事实错误
> - v0.3 用户用 GPT-5.5 跑 evidence-fact，4 finding 应用
> - v0.4 用户反馈架构错位 → 加 conversation = feature train + 总管家 Work Registry
> - **v0.5 跑完整 phase 1+2+3**（首次 cursor-agent 异质评审），13 ✅ / 1 ⚠️ / 0 🚫 / 2 🟡，Round 1 收敛
> **不可逆度**: 低 — schema 改动量 = 1 行 ALTER TABLE（Stage B1 才上）；Stage A 只动文件 / 路由，全部可逆

## 0. Context

用户目标：**多需求并行做，不冲突**，最好"统一调度，避免前后依赖的需求同时做"。设备多端（iOS + Web + Mac terminal），主体是个人单用户场景。

之前的对话流：worktree → 1 PR per conv 错位 → conversation = feature train + 总管家 → cursor-agent 抓出"Stage A scope creep + path traversal + lockfile confabulation + cp-RL 风险"。本报告 v0.5 是评审收敛后版本。

## 1. 业界 5 种典型架构（从轻到重）

| # | 架构 | 代表 | 隔离层 | 调度层 | 依赖建模 | 适合 |
|---|---|---|---|---|---|---|
| 1 | **裸并行 + git 纪律** | AddyOsmani 的实际工作流 | 无（同 cwd） | 无 | 无 | 1-2 个并行任务 |
| 2 | **Worktree per-feature** | Claude Code worktree guide / AddyOsmani | git worktree | 无 | 无 | 3-4 并行，sweet spot |
| 3 | **Worktree + shared task list** | Claude Code agent teams | git worktree | status flags 锁工作 | implicit markers | 3-5 subagent |
| 4 | **DAG planner + 并行 fan-out** | Nova OS BrainTask | 容器或 worktree | 拓扑排序 | 显式 `depends_on` | LLM 可拆 50-100 子任务 |
| 5 | **Container + DAG + quality gates** | Microsoft swarm / Devin Manage Devins | Docker / VM | Azure DTS / Cognition orchestrator | DAG + checkpoint | 企业级 |

数据来源：[shared task list](https://www.mindstudio.ai/blog/claude-code-agent-teams-shared-task-list) · [worktree guide](https://claudefa.st/blog/guide/development/worktree-guide) · [AddyOsmani workflow](https://addyosmani.com/blog/ai-coding-workflow/) · [Microsoft swarm](https://techcommunity.microsoft.com/blog/appsonazureblog/the-swarm-diaries-what-happens-when-you-let-ai-agents-loose-on-a-codebase/4501393) · [Nova OS DAG](https://blog.meganova.ai/parallel-task-execution-in-ai-how-nova-os-uses-dag-based-planning/) · [Devin Manage Devins](https://cognition.ai/blog/devin-can-now-manage-devins) · [OpenHands SDK](https://arxiv.org/html/2511.03690v1)

## 2. 共识规律（5 篇深读交叉验证）

**a. Sweet spot 是 2-4 并行，不是越多越好**
- AddyOsmani: "3-4 agents at once on separate features" + "mentally taxing to monitor"
- Claude Code 团队: "two to four subagents tends to be the sweet spot"
- Microsoft 5-agent swarm 实际结论：*"distributing subtask execution is easy; coordinating subtask outputs remains hard"*

**b. 文件冲突的工业级答案是 worktree（不是文件锁 / 不是 detection）**
- Claude Code: "Each subagent gets its own working directory backed by a separate git worktree"
- Nova OS / OpenHands: 容器或 worktree 二选一
- **没有任何主流方案试图做"file-overlap detection"**——直接物理隔离

**c. 依赖建模的真实使用是 `depends_on: [task_id]` 列表 + 拓扑排序**
- Nova OS BrainTask: 显式 `depends_on` + Kahn 算法
- Claude Code 有 implicit dependency markers 但不是 schema
- DAG 设计本身没解决"独立实现的 API 不兼容"

**d. 真正难的不是"分发"是"集成"**
- Microsoft swarm 关键洞察："coordinating subtask outputs remains hard"
- Claude Code 团队：merge 阶段需要 "a final review pass"
- AddyOsmani：单 agent 顺序 + 偶尔 worktree 实验比 swarm 务实

**e. Stacked PR / Diff 是依赖管理的工业方案**
- Graphite / Sapling / git-stack 适合人 + 1 agent 串行
- 不直接适合多 agent 并行（stack 是线性不是 DAG）
- 见 §7 — A3 follow-up 复用此模式

## 3. 失败模式清单（从 5 篇交叉提取）

| 失败 | 出处 | 原因 | 缓解 |
|---|---|---|---|
| 集成时 API 不兼容 | Microsoft swarm | 各 agent 独立猜接口签名 | 上游契约文档 / shared schema |
| 错假设级联 | Claude Code 文章 | A 假错的 utility，B/C 在错基础建 | 集成前 review pass |
| 上游变更级联无人管 | Nova OS 没回答 | DAG 没定义 invalidation 语义 | §9 Q1 留 dogfood 验证 |
| 监控负担 | AddyOsmani | 同时盯 3+ agent 心智成本高 | dashboard + 完成时通知 |
| 通知风暴 | Telegram channel 无 throttle | 4 worktree 同时完成触发 429 | §6 不变量 #6 batched + 429 backoff |
| 工作锁失效 | Claude Code 文章 | "edge cases in conflict resolution" | worktree 物理隔离做兜底 |

## 4. 对接现有 harness 数据模型

[HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md) 已有 `Issue → Initiative → Stage → Task → Run` 五层。

✅ **已就绪可用**：
- Issue.status 7 状态：`inbox / triaged / planned / in_progress / blocked / done / wont_fix`（v0.2 漏 `wont_fix`，v0.3 起修正）
- Issue.initiative_id 提供分组
- ContextBundle.artifact_refs_json 是工件级依赖（**与本提案要加的 Issue 级 depends_on 职责正交不重叠**）
- harness-store.ts 是 better-sqlite3 + migration 框架（[0001_initial.sql](packages/backend/src/migrations/0001_initial.sql) 已落第一份）
- [projects.json](packages/backend/src/projects-store.ts) 提供 cwd 注册（lock + atomic rename + .bak）—— work-registry 复用此模式

❌ **缺口**：
- **`issue` 表无 `metadata_json` 字段**（v0.1+v0.2 双 Claude reviewer confabulation；v0.3 GPT-5.5 抓到；本 round 验证 [0001_initial.sql:50-63](packages/backend/src/migrations/0001_initial.sql) 11 列，无 metadata_json）
- **修正方案**：Stage B1 加 migration `0002_issue_metadata.sql`（1 行 ALTER TABLE，向前兼容默认 '{}'，向后回滚 DROP COLUMN）
- file-scope 字段 / scheduler.ts / review-orchestrator.ts 都在 §5 后续 stage 解决

## 5. 推荐方案：5 阶段（A / A.5 / B1 / B2 / C1+C2）

### 核心模型

```
1 conversation  ←→  1 worktree  ←→  1 branch  ←→  1~N PR (默认 1)
     ↑                                                       
     └─ 1 feature train（含相关联前后制约的 N 个 commit）    

独立 feature → 必须开新对话（防上下文污染 + 防 token 浪费）
相关联 feature → 同对话续写（共享设计判断 + prompt cache 命中省 token）
```

详见 [§6.5 总管家与 token-saving 启发](#65-总管家-work-registry--dashboard)。

### Stage 拆分 rationale（不进 §6 不变量）

v0.4 把"总管家是 Stage A baseline 不是后期附加"写成 §6 不变量 #9，被评审指出"stage 拆分决定不该提级到不变量"。v0.5 把它降级到本段说明：

- Stage A 只 ship **最小 work.jsonl 写入** + `GET /api/work?cwd=` 端点（≤50 行），仅为支持 §5.A 冲突 toast 数据源
- Dashboard tab / stale 检测 / commitCount / prUrl 推到 **Stage A.5**（Stage A dogfood 通过 + 用户主动反馈"看不清状态了"才起）
- 这样 Stage A 不背"独立组件"包袱（守 §0 Invariant #15），又不让 Stage B 起步时缺端点

### Stage A — Worktree opt-in + 冲突 warning + 最小 work.jsonl

**核心**：worktree 物理隔离 + 最弱冲突检测。

**功能**：
- iOS / Web 新建对话表单加 `[ ] 隔离 worktree` checkbox（默认关）
- 表单底部 token-saving 提示：
  ```
  💡 当前 cwd 在过去 24h 有 [N] 个未完成对话。如果新需求与现有对话相关，
     续写省 token；独立需求才新开对话。
  ```
- backend `POST /api/worktrees` create + finalize 三按钮 `[合到 main] [push + 提示开 PR] [丢弃]`（自动开 PR 留 C2）
- backend `POST /api/work` 写最小 WorkRecord + `GET /api/work?cwd=` 列表
- **冲突 toast**：cwd X 已有 active 或 idle worktree → 弹建议"开新 worktree"

**最小 WorkRecord**（v0.5 收窄，phase 2 cross react 给出的中间路径）：

```ts
interface WorkRecord {
  id: string;                      // server-side randomUUID() — 不接受客户端传入
  worktreePath: string;            // <cwd>/.claude-worktrees/<id> server-generated
  branch: string;                  // wt/<id>，slug 仅允许 [a-zA-Z0-9._/-]，禁 ../ 绝对路径 空段
  baseBranch: string;              // 通常 "main"
  status: "active" | "idle" | "merged" | "discarded" | "pushed-pending-pr";
  conversationTitle: string;
  lastActivityAt: number;          // server time，不接受客户端写入
  createdAt: number;
}
// 注意：NOT 存 cwd —— 永远从 conversationId → projects.json join 得，避免双写漂移
// commitCount / prUrl / finalizeAction / dependsOn 推到 Stage A.5/B1
```

**存储**：`~/.claude-web/work.jsonl`，参 [projects-store.ts](packages/backend/src/projects-store.ts) 模式（atomic temp rename + read-modify-write + promise-queue 写锁），**不**参 inbox-store.ts（cross-F1 验证 inbox-store 实际无 lockfile，并发 rewrite 会丢记录——是 inbox-store 自己的 bug，记 §9 Q）。

**Stage A 准入 checklist**（v0.5 修订）：

1. **node_modules 默认不 copy**（v0.4 错把 `cp -RL` 当 dogfood 候选；cross-F3 验证 pnpm workspace 链接 cp 会断 / 膨胀）：
   - 创建 worktree 后弹 toast："worktree 内未装依赖，跑测试 / build 前请回主 cwd `pnpm install`"
   - "复用主仓 node_modules（symlink）"作为后续实验，不在 Stage A 默认
2. **路径**：server-generated `<cwd>/.claude-worktrees/<convId>`（自动满足 CLAUDE_WEB_ALLOWED_ROOTS）
3. **id 规范**（cross-F4 修订）：
   - id = server `randomUUID()`，**不**接受客户端传入
   - branch slug 限定 `^[a-zA-Z0-9._/-]+$` 且禁 `..` / 绝对路径 / 空段
   - destructive cleanup 先 `path.resolve()` 并 `assert prefix === path.join(cwd, '.claude-worktrees')`
4. **路径配套 ignore + 排除**：
   - 创建时自动写 `.git/info/exclude` 加 `.claude-worktrees/`
   - [packages/backend/src/routes/fs.ts](packages/backend/src/routes/fs.ts) tree 端点默认排除 `.claude-worktrees/`
   - finalize discard 必须 `git worktree remove --force` 后再 `rm -rf`，失败则 toast 让用户手动 `git worktree prune`
5. **不注册 harness_project**：仅更 projects.json，避免 `worktree_root NOT NULL` 冲突
6. **finalize**：默认 fast-forward；squash 选项；丢弃需双确认

**不做**：依赖图、自动调度、文件 overlap detection、自动 PR 创建、Dashboard tab 工作台、stacked PR 拆分。

**退出条件**：连续做完 ≥3 个真实 feature 用 worktree 不出事故；work.jsonl 持续 2 周无并发 race 数据丢失。

### Stage A.5 — Dashboard 工作台 + stale + commit/PR 元数据

**核心**：Stage A 跑稳后再加可见性。

**功能**：
- WorkRecord 加字段：`commitCount`（动态 git rev-list --count 算）/ `prUrl?` / `finalizeAction?` / `finalizedAt?`
- iOS [RunsDashboardSheet](packages/ios-native/Sources/ClaudeWeb/Views/RunsDashboardSheet.swift) 加 Tab 2 "工作台"：
  - 按 cwd 分组列出 active / idle / stale work
  - 每行：💎 conversationTitle / 📂 wt/<branch> · N commits · X 前 / 状态 badge / [→ 切到] / [finalize…] / [discard]
  - stale 检测：lastActivityAt > 7 天 → ⚠ 黄 badge（7 天是经验值，dogfood 后微调）

**A.5 准入条件**：Stage A 退出 + 用户主动反馈"我看不清当前在跑什么 / 哪些 worktree 死活" 至少 3 次。

**A.5 退出条件**：Dashboard 被用户日常打开（每周 ≥ 3 次主动查询）。

### Stage B1 — backend：issue.metadata_json migration + work-registry 加 dependsOn

**核心**：在 Issue 模型加显式依赖标记 + work-registry 加 conversation 间依赖关系。

**Migration** `packages/backend/src/migrations/0002_issue_metadata.sql`:
```sql
ALTER TABLE issue ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
-- 回滚: ALTER TABLE issue DROP COLUMN metadata_json;
-- 注: better-sqlite3 ≥3.35 / SQLite ≥3.35.0 原生支持 DROP COLUMN
```

typed key 约定（方法论 markdown 描述，等 ≥10 案例后升 first-class schema）:
```json
{
  "depends_on": ["issue_id_1"],
  "related_to": ["issue_id_3"]
}
```

WorkRecord 加 `dependsOn?: string[]`（指向上游 conversationId 列表，Stage B2 picker 写入）。

**B1 准入**：Stage A.5 退出（Dashboard 被日常使用证明可见性需求真实）。
**B1 退出**：用户用 curl 手动标 ≥10 个 dep；migration 在副本 DB dry-run 通过；写 ADR-lite 记录字段引入的不可逆度。

### Stage B2 — iOS dependency picker（Dashboard 显示降级为 list view）

**核心**：B1 的 UI surfacing。

- Inbox triage UI 加"依赖于 ⨯⨯" picker（从 backend Issue 列表选）
- iOS / Web Issue 列表显示：blocked-on-X 的 Issue 灰掉
- **Dashboard 显示依赖用 list view 不用拓扑图**（cross-F7 + arch-F4：手机端拓扑图 UX 历史性差）：
  - WorkRecord 行下方加 list："📵 blocked by X" 或 "⛓ blocks Y, Z"
  - 拓扑图渲染留作 dogfood 实验（IDEAS 候选，不是 B2 主线）

**B2 准入**：B1 退出 + 用户用 curl/手动标过 ≥10 个 dep + 80%+ 标记正确率。
**B2 退出**：用 picker 标依赖的 Issue 数比 curl 多。

### Stage C1 — scheduler.ts 基础设施 + day-1 vertical-fit gate 数据收集

**核心**：M2 review-orchestrator + scheduler 上线，但保持手动模式 + 收集 vertical-fit gate 数据。

- scheduler.ts 周期性扫 `Issue.status='planned' AND no unmet dependencies`，按 priority 排出"下一个推荐"列表，**不**自动跑
- 用户在 Dashboard 看推荐 → 手动点"跑这个" → 后端起 worktree + conversation
- 注册 harness_project 实体（C1 才做，Stage A 推迟）

**Day-1 起记录 4 项 vertical-fit gate 数据**（arch-F3 修订）：
- (a) scheduler 推荐接受率 = 用户接受推荐 / 总推荐
- (b) 用户跳过推荐的原因（自由文本 telemetry）
- (c) 用户在 Dashboard 主动找"下一个跑"频次（**不**用 tab 4 打开次数 — 那个 tab 已降级为 list）
- (d) 过去 30 天用户是否反馈"手动模式不够"

**C1 准入**：Stage B1+B2 上线 + harness Issue 真实存量 ≥20 个 + M2 已 ship review-orchestrator.ts。
**C1 退出**：scheduler 推荐命中率 ≥70% + 4 项 gate 数据稳定收集 ≥6 个月。

### Stage C2 — DAG 自动 fan-out（vertical-fit gate 决定做不做）

**核心**：Nova OS 风格自动并行 fan-out。

**vertical-fit gate ADR 模板硬要求**：
- 4 项 C1 数据全部达标
- 用户主动评估"手动模式真不够"（≥3 次反馈或量化"卡住的 Issue 数 ≥ 5/月"）
- gate fail → C2 永不上，存档 IDEAS

通过后 C2 实施：
- scheduler 扫到 N 个无依赖 Issue → 同时开 N 个 worktree + conversation 并行跑
- `MAX_PARALLEL=2` 默认 per-cwd（不是 per-connection），上限 4
- 完成跑 quality gate（verify-m1-deliverables 风格）+ batched 通知（每 cwd 30s 1 条 + 429 backoff）
- **永不**自动 merge——human-in-the-loop 强制

**C2 退出**：fan-out 集成成功率 ≥80%（M2 dogfood 验证）。

## 6. 关键不变量（防止抄成 Microsoft swarm 那种崩盘）

1. **永远 human-in-the-loop on merge**——再多自动化，merge 到 main 必须人审，符合现有 §16.3 第 1 条精神
2. **MAX_PARALLEL 默认 2，硬上限 4，per-cwd 而非 per-connection**——不要被 sweet spot 之外的 swarm 文章诱惑
3. **不做 file-overlap detection**——成本不划算，worktree 物理隔离覆盖 99%
4. **依赖只做 blocks/related 两类**——不做 PMP 全集
5. **DAG 失败时 fail loud**——upstream 改了 downstream 怎么办？**全停 + 通知用户**，不要 silent re-run
6. **fan-out 通知 batched**——每 cwd 30s 内最多 1 条；外部 channel (Telegram) 加 429 exponential backoff
7. **Stage C2 vertical-fit gate**——若 6 个月手动模式够用，永不上自动 fan-out。Gate 必须用 §5.C1 4 项量化数据
8. **对话粒度 = feature train，不是 PR**——1 conversation = 1 train（含相关联前后制约的 N 个 commit，可拆 N 个 stacked PR）。独立 feature 必须开新对话。**conversation switch only changes UI focus; run continues until session_ended / interrupt / WS close**（[index.ts:280-285,422-428](packages/backend/src/index.ts) + [BackendClient.swift:238-287](packages/ios-native/Sources/ClaudeWeb/BackendClient.swift)）。**推论**：worktree 1:1 绑定 conversation（不是 PR），work-registry 也按 conversationId 索引。

## 6.5 总管家 (Work Registry + Dashboard)

### 设计动机

5 条 train 跑 3 周后，没总管家用户自己都不知道哪些 worktree 死活、哪个对话停哪、哪些 PR 等审。run-registry（实时心跳）+ projects.json（cwd 注册）都不覆盖"work history + cross-conversation 关系"。

### 三 store 边界声明（v0.5 修订，arch-F2 + cross react N1 双锁）

**单一真相源原则**：

| Store | 范围 | 生命周期 | 跨设备 |
|---|---|---|---|
| `~/.claude-web/projects.json` ([projects-store.ts](packages/backend/src/projects-store.ts))| **cwd 级** — 哪个 cwd 是项目 | 用户 + 项目存活期 | 跨设备共享 |
| `RunRegistry` ([run-registry.ts](packages/backend/src/run-registry.ts))| **实时 in-flight** — 当前在跑的 run | 进程级（重启清空） | 单进程 |
| `~/.claude-web/work.jsonl`（v0.5 新）| **conversation × worktree 级**历史 | 用户 + worktree 存活期 | 跨设备共享 |

**关键约束**：work-registry **不存 cwd**——cwd 永远从 `conversationId → projects.json` join 得。避免双写漂移（CLAUDE.md pitfall #9 已经吃过 projects.json 并发写错的亏）。

### 数据层

[work-registry.ts](packages/backend/src/work-registry.ts) 新建，参 [projects-store.ts](packages/backend/src/projects-store.ts) 模式：

- 存储：`~/.claude-web/work.jsonl`（atomic temp rename + read-modify-write + promise-queue 写锁）
- Schema：见 §5.A WorkRecord 定义（Stage A 7 字段，A.5 加 4 字段）
- 写入触发：worktree create / commit hash refresh / finalize / discard
- 读取：iOS Dashboard / Stage C1 scheduler 都从此读

### 路由

- `GET /api/work?cwd=` — Stage A 列表（按 cwd 过滤）
- `GET /api/work/:id` — 单条详情 + 实时跑 git status / git log（A.5）
- `POST /api/work/:id/refresh` — 重扫 git 状态（A.5）
- 内部：`/api/worktrees` finalize / 创建时同步写

### UI（A.5 起扩展 RunsDashboardSheet）

```
RunsDashboardSheet（Stage A.5 起重命名为 工作台）
├─ Tab 1: 进行中 (现有)
├─ Tab 2: 工作台 (Stage A.5 新增)
│   分组: cwd
│   每行: 💎 conversationTitle / 📂 wt/<branch> · N commits · X 前
│         状态 badge / [→ 切到] / [finalize…] / [discard]
└─ Tab 3: 当前队列 (现有)

依赖关系（Stage B2）显示在 Tab 2 行下方，list 形式：
   📵 blocked by ⨯⨯
   ⛓ blocks YYY, ZZZ
拓扑图渲染留作 IDEAS 候选实验，不进主线
```

### Token-saving 启发段（v0.5 修订，cross-F6 + arch react N2）

claude-web 走 Claude CLI subprocess，CLI 内部用 Anthropic prompt caching：

| 场景 | 第 1 prompt | 第 2+ prompt |
|---|---|---|
| **同对话连续** | 全价（建立 cache） | **缓存命中**：前缀按低费率 + 新增内容全价 |
| **新对话每个 PR** | 全价（cache 没了） | 全价 |

**预期效果**：基于 Claude prompt caching 机制，同对话连续 prompt 显著省。具体比例取决于"重复读的文件数 + 新增内容比例"，**dogfood 后用 telemetry 验证**（v0.4 写"省 30-50%"无来源，v0.5 删除该数字）。

**何时开新对话**（30 秒决定）：

| 信号 | 决策 |
|---|---|
| "这事 Claude 不读现有对话也能做对" | 开新 |
| "我得跟 Claude 解释前面发生了啥" | 续写 |
| 当前对话 > 100 turns 或上下文逼近 200k | checkpoint + 新开 |
| 当前对话偏题 | fresh start |
| 不确定相关性 | 续写（成本是 token，节省的是错位风险）|

**UI 提醒**（Stage A 加）：新建对话表单底部一行小字："当前 cwd 在过去 24h 有 [N] 个未完成对话。如果新需求与现有对话相关，续写省 token。"

## 7. 与现有 IDEAS 的合并建议

完成评审 + 用户认可后：

- **修订 IDEAS P1**：从"per-conversation 自动 worktree"改为"opt-in checkbox + 同 cwd 冲突 warning + 路径 `<cwd>/.claude-worktrees/<id>` server-generated + **conversation = feature train 不是 PR**"，对接本报告 Stage A
- **新增 IDEAS P7**：依赖感知 Work Registry / Dashboard / scheduler recommendation（**仅** Work Registry / Dashboard / scheduler；从 issue/PR 描述启动 agent 留 A3 范围）
- **修订 IDEAS A3**：保留"从 issue/PR 描述启动 agent 并产出 PR"。**附 follow-up note**：stacked diffs (Graphite / Sapling) 是 stacked PR 拆分的实现参考——v0.5 不独立条目
- **CLAUDE.md "Common pitfalls" 加第 11 条**：不要把"1 PR = 1 conversation"当 ground truth；conversation 粒度 = feature train（依赖单元）

## 8. 待用户决定（v0.5 收敛后仅 2 条）

### U1. 推进范围

| 选项 | 范围 |
|---|---|
| **a. 只 Stage A**（最稳） | worktree opt-in + 最小 work.jsonl + 冲突 toast + .claude-worktrees ignore checklist |
| **b. A + A.5 + B1 + B2** | 加 Dashboard 工作台 + issue.metadata_json migration + dependency picker + list-view 依赖显示 |
| **c. A + A.5 + B + C 全做（vertical-fit gate 决定 C2）** | scheduler 推荐 + DAG fan-out（C2 必须过 4 项数据 gate） |

### U2. Stacked PR 拆分

| 选项 | 含义 |
|---|---|
| **不做（推荐）** | 1 conversation = 1 PR；想 stacked 用户用 Graphite |
| Stage B+ 才上 | finalize 时按 commit 拆 stacked branches |
| 永远不做 | 锁死 |

**arch reviewer phase 1 建议 "推荐不做"**（claude-web 单用户 stacked 收益低）。

### 已收敛不需要你拍

- ~~U3 Dashboard 范围~~ → Stage A 最小 + Stage A.5 Dashboard，自动解决
- ~~q2 依赖建模 schema vs json~~ → metadata_json + 1 行 migration
- ~~q3 MAX_PARALLEL 数值~~ → 默认 2，per-cwd
- ~~q4 GitHub 集成时机~~ → Stage A `[push branch + 提示开 PR]`，自动 PR 留 C2

## 9. 关键 Open Questions（评审后剩余，留 dogfood 验证）

- Q1: 个人单机场景 vertical-fit gate 6 个月手动模式真能搞定吗？答：v0.5 §5.C1 4 项数据收集解决"靠什么数据决断"问题
- Q2: Stage B 用户标 depends_on 的认知盲区会不会让调度反而更糟？答：B1+B2 不做自动调度，仅 surface 给用户判断，盲区影响有限
- Q3: Stage A.5 7 天 stale 阈值是经验值，dogfood 后微调
- Q4: Telegram batched 通知策略是否影响"任务完成立即提醒"用户体验？需要在 30s 窗口和及时性间找平衡
- Q5: Work Registry 和 RunRegistry / projects.json 的边界——v0.5 §6.5 三 store 边界声明 + work-registry 不存 cwd 解决，但实施期需 cross-check
- Q6: stacked PR 拆分时机—— B+ 真做时再决定（U2 默认 "不做"）
- Q7（本 round 新加，cross-F1 旁路）：**inbox-store.ts 自身没有并发锁** ([inbox-store.ts:80-89](packages/backend/src/inbox-store.ts) `appendFileSync` + `writeFileSync` 裸跑)。本 proposal 不动 inbox-store，但记录"未来需要 ADR 修补"
- Q8（本 round 新加）：异质评审矩阵（Claude + cursor-agent）首次跑成功，是否应固化为所有 phase 1 cross 必跑 cursor-agent？v0.5 倾向 **是**，已落 [.claude/skills/harness-review-workflow/SKILL.md](../../.claude/skills/harness-review-workflow/SKILL.md) anti-pattern 段（双 Claude reviewer = 集体盲区）

## 10. 评审过程记录（meta）

### Round 表

| Round | Reviewer 矩阵 | 抓到的关键 finding | 漏掉的 |
|---|---|---|---|
| v0.1 → v0.2 | 双 Claude (arch + cross) | 14 ✅ / 1 ⚠️ / 0 🚫 / 1 🟡 → "看似收敛" | **schema 事实错误**（Issue.metadata_json 不存在）/ pnpm cp -RL 风险 / .claude-worktrees ignore |
| v0.3 | 用户外接 GPT-5.5 | 4 finding 应用：schema migration / status 7 状态 / pnpm 降级 / .claude-worktrees ignore | 架构错位（conversation = train） |
| v0.4 | 用户反馈架构 + 加总管家 | conversation = feature train / Work Registry / token-saving 启发 | Work Registry scope creep / lockfile confabulation / path traversal id 规范 |
| **v0.5（本 round）** | **Claude arch + cursor-agent gpt-5.5 cross**（异质对）| 14 finding 全部消化：scope 收窄 / 三 store 边界 / lockfile / cp -RL 翻案 / id 规范 / 30-50% 删 / 拓扑图降级 list / vertical-fit gate 量化 / Invariant #9 删除 | （收敛，本 round 没漏） |

### 异质评审性能

- 双 Claude phase 1 在 v0.1-v0.2 漏掉的 schema 事实错误 / cp -RL / lockfile，cursor-agent 首次 phase 1 全部抓到（grep 直觉强于 Claude self-fact-check）
- cursor-agent 独家发现 1 BLOCKER（path traversal id 规范）
- Claude arch 独家发现 1 BLOCKER（Invariant #15 violation Stage A scope creep）
- 双方 phase 2 cross-pollinate 后强收敛，0 真正未解 finding

### 方法论教训（同步到 [`.claude/skills/harness-review-workflow/SKILL.md`](../../.claude/skills/harness-review-workflow/SKILL.md)）

1. **v0.1 §10 "Phase 2/3 skip rationale" 错误前提** — phase 2/3 改成默认必跑，phase 1-only 列为 anti-pattern
2. **双 Claude reviewer = 集体盲区** — phase 1 reviewer-cross 必须 cursor-agent（非 Claude）
3. **Fact-check 必须读 migration SQL 原文** — Anti-pattern：声称"schema 字段 X 存在"没读 `packages/backend/src/migrations/*.sql`
4. **skill 改名 + mode 参数化** — `propose-with-review` → `harness-review-workflow`（proposal/contract/patch 三 mode）
5. **作者不能跳过评审直接交用户拍板**（v0.3 → v0.4 教训）—— 用户纠正"先把规划方案写好，评审一下，再来给我决策"
6. **架构错位**（v0.3 → v0.4 教训）—— "1 conversation = 1 PR" 被用户纠正为"1 conversation = 1 feature train"。当前 reviewer 矩阵（arch + cross）漏抓"用户工作流匹配度"维度。Open Q：3rd lens "user-workflow fit" 是否需要？arch reviewer phase 2 react 倾向"先看后续 3 个 proposal 是否再次复发再加"
7. **异质评审首次 cursor-agent 跑成（v0.5 教训）** — 抓到双 Claude 漏掉的 lockfile / cp -RL / path traversal / 30-50% 数字。**强支持**保留 cursor-agent 为 phase 1 reviewer-cross 硬要求。已强化进 skill anti-pattern 段。

## 11. 引用源

- [Inside Claude Code's Shared Task List](https://www.mindstudio.ai/blog/claude-code-agent-teams-shared-task-list)
- [Claude Code Worktrees: Parallel Sessions Without Conflicts](https://claudefa.st/blog/guide/development/worktree-guide)
- [AddyOsmani — My LLM coding workflow going into 2026](https://addyosmani.com/blog/ai-coding-workflow/)
- [Microsoft Swarm Diaries](https://techcommunity.microsoft.com/blog/appsonazureblog/the-swarm-diaries-what-happens-when-you-let-ai-agents-loose-on-a-codebase/4501393)
- [Nova OS DAG-Based Planning](https://blog.meganova.ai/parallel-task-execution-in-ai-how-nova-os-uses-dag-based-planning/)
- [Cognition — Devin can now Manage Devins](https://cognition.ai/blog/devin-can-now-manage-devins)
- [OpenHands Software Agent SDK](https://arxiv.org/html/2511.03690v1)
- [Pragmatic Engineer — Stacked Diffs](https://newsletter.pragmaticengineer.com/p/stacked-diffs)
- [Graphite Stacked Diffs Guide](https://graphite.com/guides/stacked-diffs)
- [Beyond Vibe Coding — 200 Autonomous Agents](https://agentfield.ai/blog/beyond-vibe-coding)
