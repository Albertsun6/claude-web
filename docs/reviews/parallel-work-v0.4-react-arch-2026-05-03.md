# Phase 2 React — Architecture-fit lens (Claude)
> Reviewer: harness-architecture-review · Date: 2026-05-03 · Phase 2 (cross-pollinate)
> Sibling read: parallel-work-v0.4-cross-2026-05-03.md (cursor-agent / gpt-5.5-medium)

## 对 cross 每条 finding 表态

### Cross-F1 (Work Registry "参 inbox-store lockfile" 实现不符 MAJOR) — **agree**
**对方原文摘要**: 提案声称 work.jsonl 参 inbox-store "append + lockfile + rewrite-on-update"，但 inbox-store.ts 只有 `appendFileSync` + 整文件 `writeFileSync`，**无 lockfile / atomic rename / 队列**。多端并发 rewrite 会丢记录。
**我的表态**: agree
**理由**: 已 fact-check `packages/backend/src/inbox-store.ts:80-89,116-128` —— 完全无锁、整文件覆写。我 Phase 1 F2 提了"projects.json 已踩过并发坑（CLAUDE.md pitfall #9）"，但没翻译成 inbox-store 实现层证据。cross 这一条**强化我 F2 的根**：work-registry 不只是边界没划清，连参考实现都不靠谱。
**新建议**: 提案 §6.5 "数据层"必须 (a) 不要写"参 inbox-store 模式"——因为 inbox-store 自己就还没加锁；(b) 明确 work-registry 用 `projects-store.ts` 风格（atomic-rename + promise-queue + .bak），与 CLAUDE.md pitfall #9 的修复保持一致；(c) 顺手把 inbox-store 自己的并发裸跑列入 IDEAS 后续修复。

### Cross-F2 (Stage A baseline 范围偏大 MAJOR) — **agree**
**对方原文摘要**: 提案把 `POST/GET /api/work` + Dashboard tab 2 + stale + commitCount + PR URL + finalize action 全列 Stage A baseline。"Stage B picker 需端点"成立，但不证明 Stage A 必须做完整工作台。
**我的表态**: agree
**理由**: 与我 F1 BLOCKER 完全同向，cross 给了具体的"最小持久索引"切割方案（只存 8 字段 + `GET /api/work?cwd=`），比我 F1 的"≤50 行 store 不加 UI"更可执行。**两条合并后我 F1 BLOCKER 应升格为强证据 BLOCKER**——双 reviewer 异质独立同向命中，几乎确定要砍。
**新建议**: 把我 F1 + cross-F2 合并为单一指令："Stage A 仅 ship `{id,cwd,worktreePath,branch,baseBranch,status,title,lastActivityAt,createdAt}` + `GET /api/work?cwd=`；commitCount/prUrl/finalizeAction/stale UI/Tab 2 全部移到 Stage A.5（Stage A dogfood ≥3 feature 后再决定）。"

### Cross-F3 (`cp -RL node_modules` 应降级实验 MAJOR) — **agree**
**对方原文摘要**: pnpm workspace（已 fact-check `pnpm-workspace.yaml:1-2`）+ `workspace:*` 用 symlink/hardlink，`cp -RL` 解引用 → 复制完整 store / workspace link 变普通目录 / 依赖状态分叉。这是依赖一致性风险，不只性能。
**我的表态**: agree
**理由**: 我 Phase 1 没碰 §5.A checklist #1（默认值我误以为已经 v0.3 收窄到位），cross 这条暴露 v0.3 GPT 收窄不彻底——proposal 仍把"第一版尝试 `cp -RL`"写成默认路径。这是我 Phase 1 漏审，cross-F3 是**新发现给我**。
**新建议**: §5.A checklist #1 改成"Stage A 默认 **不** copy node_modules，worktree 创建时弹 toast '复用主仓 node_modules 未保证；改 package.json 必须回主 cwd'；'copy dependencies' 作为可选实验按钮，仅 dogfood 分支启用并必须落 telemetry"。

### Cross-F4 (id 必须 server-generated UUID + branch slug 白名单 BLOCKER) — **refine**
**对方原文摘要**: `verifyAllowedPath` 只校验 resolved path 在 allowed root 下（`auth.ts:114-132` 已 fact-check）。如果 `/api/worktrees` 接受客户端 id/branch，`../` 或奇怪字符在拼路径 + git branch 都会出问题。提案说 server-generated 但没强制。
**我的表态**: refine
**理由**: 大方向 agree（id 必须 server-generated），但 BLOCKER 等级 **过重**。`verifyAllowedPath` 已经做 `path.resolve` + prefix 检查，纯 server-generated UUID 是常规防御；这是"实现细节注解 + 安全 review checklist"，不是"架构错位"。提级 BLOCKER 与 #1 human-in-the-loop on merge 同档不匹配。
**新建议**: 降为 MAJOR，写法改成"§5.A checklist 加第 7 条：worktree id = server `randomUUID()`；branch slug 白名单 `^wt/[a-f0-9-]{36}$` 或自定义 slug `^[a-zA-Z0-9._-]{1,40}$`，禁止 `..` / 绝对路径 / 空段；destructive cleanup 前必须 `path.resolve` + 验证 prefix 是 `path.join(cwd, '.claude-worktrees')`。"

### Cross-F5 (切换对话不杀进程 MINOR) — **agree**
**对方原文摘要**: iOS sendPrompt 按 conversation 取 cwd / resumeSessionId；切 currentConversationId 不中断后台 run；只有 interrupt / WS close 才 abort。提案 §6 invariant #8 应注一句"conversation switch only changes UI focus"。
**我的表态**: agree
**理由**: 这是我 Phase 1 没看的层面（CLAUDE.md "iOS BackendClient 是 per-conversation" pitfall 我提了但没串到 train 不变量上）。cross-F5 把 train 抽象的生命周期边界讲清楚，**强化我 F7 false-positive 判定的 fit**——即 train 不变量本身正确，只是 wording 需要补 run lifecycle 注。
**新建议**: §6 invariant #8 末尾加："切 conversation 仅改 UI 焦点；run 持续到 sessionEnded / interrupt / WS close。"

### Cross-F6 (token caching "30-50%" 证据不足 MINOR) — **agree**
**对方原文摘要**: 30-50% 在提案出现为确定数字但无来源 / 无本项目 telemetry。
**我的表态**: agree
**理由**: 这条我 Phase 1 完全漏了——我把 §6.5 token-saving 启发当 "Strong points" 没挑数据。cross-F6 准确，**新发现给我**。
**新建议**: §5 / §6.5 删掉 "30-50%"；改为"基于 Claude prompt caching 机制（前缀 5min TTL，命中 1/10 价格），同对话连续 prompt 期望更省；具体比例待 dogfood 后用 telemetry tokens/cost 字段验证（Q5 列入）"。

### Cross-F7 (Dashboard 依赖图手机端风险 MAJOR) — **agree**
**对方原文摘要**: iOS RunsDashboardSheet 当前是简单 List，提案直接跳 conversation × Issue 联合拓扑图，小屏拓扑容易装饰化。
**我的表态**: agree
**理由**: 与我 F4 (B2 Tab 4 越权) 完全同向，cross 给了更具体的降级方案（默认列表 `blocked by X / blocks Y,Z`，拓扑图作为后续可选实验）。**合并后我 F4 应升 MAJOR**——独立异质双 reviewer 同向命中。
**新建议**: B2 默认 ship 列表式依赖展示（每行 `blocked by [link] / blocks [link,link]`），拓扑图渲染独立为 B3 dogfood 决定。

### Cross-F8 (P7 与 A3/P1/H7 边界重叠 MINOR) — **agree**
**对方原文摘要**: IDEAS 已有 P1 worktree / H7 launcher / A3 PR 驱动调度。新增 P7 写"调度器+Registry+Dashboard"会和 A3 重叠。
**我的表态**: agree
**理由**: 与我 F2 边界划分同源——本条是 IDEAS 文档层的对应。提案 §7 IDEAS 合并段没解决 A3 / P7 的语义切割。cross 的切割方案（"P7 = Registry+Dashboard+scheduler 推荐；A3 = 从 issue/PR 描述启动 agent 并产出 PR"）干净。
**新建议**: §7 加一行明确 P7 ↔ A3 边界："P7 管 work history + 推荐；A3 管 issue → agent → PR 这条入口流。"

## 我自己 Phase 1 verdict 的自我修正

### F1 (Work Registry BLOCKER) — **keep + 强化**
**修正后等级**: BLOCKER（升级证据）
**理由**: cross-F2 异质独立同向命中"Stage A 范围偏大"，且 cross-F1 暴露参考实现也有问题。两条合并使 F1 从单一 lens 变成异质双证据，决心砍 baseline 更硬。

### F2 (Work Registry vs projects.json vs RunRegistry 边界 MAJOR) — **keep**
**修正后等级**: MAJOR
**理由**: cross 没直接挑这条，但 F1 揭示连参考实现都没锁——边界划清比我原版还更紧迫。保留。

### F3 (vertical-fit gate 缺判定抓手 MAJOR) — **keep**
**修正后等级**: MAJOR
**理由**: cross 完全没碰 vertical-fit gate（其 lens 不到这层），保留我原 finding 不变。

### F4 (B2 Tab 4 越权 MINOR) — **upgrade to MAJOR**
**修正后等级**: MAJOR
**理由**: cross-F7 同向并升级关注点（手机屏拓扑装饰化是真风险），双 reviewer 同向命中提级。

### F5 (Invariant #9 与 #15 wording 冲突 MINOR) — **keep**
**修正后等级**: MINOR
**理由**: cross 没碰，保留。F1 砍掉 baseline 后这条自然消解一半。

### F6 (第 3 lens MINOR / FALSE-POSITIVE-CANDIDATE) — **keep as FP**
**修正后等级**: FALSE-POSITIVE-CANDIDATE
**理由**: cross 也没碰，维持原判。

### F7 (CLAUDE.md pitfall #11 FALSE-POSITIVE-CANDIDATE) — **keep as FP**
**修正后等级**: FALSE-POSITIVE-CANDIDATE
**理由**: cross 没异议，维持。

## 新发现 (new-finding)

### N1. node_modules 默认 cp 路径需翻案（来自 cross-F3）— [MAJOR]
我 Phase 1 把 §5.A checklist #1 当 v0.3 已收敛，没复审。cross-F3 在 pnpm workspace + symlink 现实下证明默认路径不安全。**Stage A checklist #1 必须翻案为"默认 不 copy"**，把 cp 降级为 dogfood opt-in 实验。

### N2. token caching 30-50% 数字需删（来自 cross-F6）— [MINOR]
§5 / §6.5 出现的 "30-50%" 必须改为"待 dogfood telemetry 验证"。我 Phase 1 把 §6.5 当 strong point，漏了证据基础——补救。

### N3. inbox-store 自己的并发裸跑（cross-F1 副产物）— [MINOR / 后续 IDEAS]
cross-F1 间接揭示 inbox-store.ts 也无锁。本 proposal 不涉及，但应在 IDEAS 单独立条："inbox-store 升级为 atomic-rename + queue（参 projects-store.ts）"，避免后续踩坑。

## Convergence summary

- **对方 8 条**：agree 6 / refine 1 (F4 降 BLOCKER → MAJOR) / disagree 0 / new-finding 0 给我增加 3 条 (N1/N2/N3)
- **我 7 条**：keep 5 / upgrade 1 (F4 MINOR→MAJOR) / withdraw 0 / FP-confirmed 2
- **真正未收敛 finding**：
  - cross-F4 BLOCKER vs 我 refine 为 MAJOR（路径安全等级分歧；author phase 3 仲裁）
  - 我 F2 (三 store 边界) / F3 (vertical-fit gate 量化) cross 未触达——单 lens 待 author 接纳
  - 我 F5 / F6 (wording / 第 3 lens)：cross 未触达，作者可低优先级处理
- **强证据已锁**：F1+cross-F2（Stage A baseline 砍）/ F4+cross-F7（B2 拓扑降级列表）— 双异质 reviewer 同向，author 应直接接受
