# Phase 1 Review — Cross-correctness lens (cursor-agent)
> Reviewer: reviewer-cross via cursor-agent · Date: 2026-05-03 · Phase 1 (independent, heterogeneous)
> Model: gpt-5.5-medium

## Summary verdict
REQUIRES-PHASE-2

## Findings

### F1. Work Registry “参 inbox-store.ts 模式：append + lockfile”与现有实现不符 — [MAJOR]
**Lens**: correctness / irreversibility  
**Where**: §5.A Work Registry 起步版；§6.5 数据层  
**Issue**: 提案说 `work.jsonl` 参考 `inbox-store.ts`，且“append + lockfile + rewrite-on-update”。但现有 `inbox-store.ts` 只有 `appendFileSync` 和整文件 `writeFileSync`，没有 lockfile、atomic rename 或并发队列（`packages/backend/src/inbox-store.ts:80-89`, `packages/backend/src/inbox-store.ts:116-128`）。  
**Why it matters**: Work Registry 一旦成为 Stage A baseline，多端 iOS/Web/WS 同时 create/finalize/refresh 时，JSONL rewrite 可能丢记录。  
**Suggested fix**: 不要写“参 inbox-store lockfile”。Stage A 最小版应明确：单进程同步写 + atomic temp rename + 读后改写；或复用 `projects-store.ts` 风格锁。append 点固定为 create/finalize/discard/refresh，不要每次 commit 热路径写。

### F2. Stage A Work Registry 范围偏大，应拆成“最小持久索引” — [MAJOR]
**Lens**: simplification / irreversibility  
**Where**: §5.A, §6 invariant #9  
**Issue**: 提案把 `POST /api/work`、`GET /api/work`、Dashboard、stale、commitCount、PR URL、finalize action 都列入 Stage A baseline（`docs/proposals/PARALLEL_WORK_ORCHESTRATOR.md:126-151`, `docs/proposals/PARALLEL_WORK_ORCHESTRATOR.md:263-285`）。“Stage B picker 需要 conversation 列表”这个理由成立，但不证明 Stage A 必须做完整工作台。现有 `run-registry.ts` 只是内存 active run map，不覆盖历史（`packages/backend/src/run-registry.ts:1-5`, `packages/backend/src/run-registry.ts:27-35`）。  
**Why it matters**: baseline 过大，会把 worktree MVP 变成 registry/dashboard 产品。  
**Suggested fix**: Stage A baseline 改成只存 `{id,cwd,worktreePath,branch,baseBranch,status,title,lastActivityAt,createdAt}` + `GET /api/work?cwd=`。`commitCount/prUrl/finalizeAction/stale UI` 放 A+ 或 U3 选项。

### F3. `cp -RL node_modules` 仍应降级为实验，不应出现在默认路径 — [MAJOR]
**Lens**: correctness / irreversibility  
**Where**: §5.A checklist #1/#2  
**Issue**: 本 repo 是 pnpm workspace（`pnpm-workspace.yaml:1-2`, `package.json:12`），`@claude-web/shared` 用 `workspace:*`（`packages/backend/package.json:16-18`, `packages/frontend/package.json:15-20`）。实测 `packages/*/node_modules` 内大量链接指向根 `node_modules/.pnpm`，workspace 包链接到 `../../../shared`。`cp -RL` 会解引用这些链接，可能复制完整 store、把 workspace link 变成普通目录、让 worktree 和主仓依赖状态分叉。  
**Why it matters**: 这是磁盘和依赖一致性风险，不只是性能指标。  
**Suggested fix**: Stage A 默认不 copy `node_modules`。优先创建 worktree 后提示“复用主仓安装状态未保证”；dogfood 分支可提供手动 `copy dependencies` 按钮并记录耗时/体积/测试结果。

### F4. `<cwd>/.claude-worktrees/<id>` 的安全前提缺少 id 规范 — [BLOCKER]
**Lens**: security / correctness  
**Where**: §5.A checklist #3, §10 specific path claim  
**Issue**: 现有 `verifyAllowedPath` 只校验 resolved path 是否在 allowed root 下（`packages/backend/src/auth.ts:114-132`）。如果未来 `/api/worktrees` 接受客户端传入 id/branch，`../` 或奇怪 branch 字符会在拼路径和 git branch 上出问题。提案说 server-generated `<convId>`，但没有写后端必须拒绝非 UUID/slug。  
**Why it matters**: worktree create/finalize/discard 会涉及 git 和删除目录，路径边界必须在设计期锁死。  
**Suggested fix**: 明确 `id = server randomUUID()`，不接受客户端 id；branch slug 只允许 `wt/<uuid>` 或 `[a-zA-Z0-9._/-]` 且禁止 `..`、绝对路径、空段；所有 destructive cleanup 先 `path.resolve` 并确认 prefix 是 `path.join(cwd,'.claude-worktrees')`。

### F5. “1 conversation = 1 feature train”基本可行，但不要说切换对话会杀进程 — [MINOR]
**Lens**: cross-end / correctness  
**Where**: §6 invariant #8  
**Issue**: iOS `sendPrompt` 确实按 conversation 取 `cwd` 和 `resumeSessionId`（`packages/ios-native/Sources/ClaudeWeb/BackendClient.swift:238-287`），后端每个 prompt 在传入 cwd spawn CLI（`packages/backend/src/cli-runner.ts:72-79`）。切换 `currentConversationId` 不会中断后台 run；只有显式 interrupt 或 WS close 才 abort（`packages/backend/src/index.ts:280-285`, `packages/backend/src/index.ts:422-428`）。  
**Why it matters**: train 模型成立，但用户切焦点不是生命周期边界。  
**Suggested fix**: invariant 加一句：“conversation switch only changes UI focus; run continues until session_ended/interrupt/WS close。”

### F6. Token caching “省 30-50%”证据不足 — [MINOR]
**Lens**: correctness  
**Where**: §5 核心模型；§6 invariant #8；§6.5 token-saving  
**Issue**: 30-50% 在提案中出现为确定数字（`docs/proposals/PARALLEL_WORK_ORCHESTRATOR.md:109-113`, `docs/proposals/PARALLEL_WORK_ORCHESTRATOR.md:302-309`），但没有来源或本项目 telemetry。  
**Why it matters**: 会把产品决策建立在不可验证收益上。  
**Suggested fix**: 改成“基于 Claude prompt caching 机制，预计同对话连续 prompt 更省；具体比例 dogfood 后用 tokens/cost 验证”，删除百分比。

### F7. Dashboard “依赖图”在手机端风险被低估 — [MAJOR]
**Lens**: cross-end / simplification  
**Where**: §5.B2, §6.5 UI  
**Issue**: 当前 iOS `RunsDashboardSheet` 是简单 List（`packages/ios-native/Sources/ClaudeWeb/Views/RunsDashboardSheet.swift:17-60`），提案直接跳到 conversation × Issue 联合拓扑图（`docs/proposals/PARALLEL_WORK_ORCHESTRATOR.md:207-217`, `docs/proposals/PARALLEL_WORK_ORCHESTRATOR.md:287-300`）。  
**Why it matters**: 小屏拓扑图很容易变成装饰功能，退出条件“被日常打开”也难证明图比列表有效。  
**Suggested fix**: B2 改为默认列表：每个 work 显示 `blocked by X` / `blocks Y,Z`，拓扑图只作为后续可选实验。

### F8. IDEAS P7 与 A3/P1/H7 边界仍重叠 — [MINOR]
**Lens**: simplification  
**Where**: §7  
**Issue**: 现有 IDEAS 已有 P1 worktree（`docs/IDEAS.md:77-88`）、H7 launcher（`docs/IDEAS.md:673-690`）、A3 PR 驱动调度（`docs/IDEAS.md:792-805`）。新增 P7 如果写成“依赖感知调度器 + Work Registry + Dashboard”，会和 A3 的 schedule-task 工作流重叠。  
**Why it matters**: 后续 roadmap 会出现两个“调度”入口。  
**Suggested fix**: P7 只定义“依赖感知 Work Registry / Dashboard / scheduler recommendation”；A3 保留“从 issue/PR 描述启动 agent 并产出 PR”。

## Strong points
- v0.4 已纠正 `issue.metadata_json` 不存在这一关键事实，和 migration SQL 一致（`packages/backend/src/migrations/0001_initial.sql:50-63`）。
- Stage A 不注册 `harness_project` 是对的，避免撞上 `worktree_root NOT NULL` 和 harness schema 生命周期（`packages/backend/src/migrations/0001_initial.sql:18-26`）。
- “不做 file-overlap detection”“human-in-the-loop merge”“C2 vertical-fit gate”都是合理收窄。

## Cross-end concerns
- Stage A 需要同时定义 TS DTO、Swift Codable、Web/iOS 展示字段，否则 WorkRecord 很快会出现字段漂移。
- `lastActivityAt` 应明确由后端 server time 写入；不要让 iOS/Web 各自写本地时间。
- `commitCount` 可由 `GET /api/work/:id/refresh` 动态计算，不建议作为 Stage A 持久真相。
