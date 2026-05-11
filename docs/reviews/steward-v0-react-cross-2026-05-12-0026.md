已按 `/tmp/steward-v0-react-cross-prompt.md` 完成 Phase 2 cross-react 评审，并写入：

`docs/reviews/steward-v0-react-cross-2026-05-12-0026.md`

内容覆盖了 arch reviewer 的 F1-F12，包含多条 `refine`（满足硬约束），并补了自我修正、新发现和 top 5 收敛建议。未运行测试，因为这次只更新 review 文档。
2 promote 到 harness Issue 时会产生不可逆迁移债；建议 `id` 加 `bl-` 前缀，新增 `harness_issue_id`，并声明 BACKLOG id 永不写入 `issue.id`。

**表态**: refine

**理由**: 我同意问题存在，也同意必须把 Phase 0 id 与未来 harness Issue id 解耦。这里是 contract 级 schema 问题，比我 Phase 1 只提到的 "id 永久不变但生成规则不清" 更深。但我不完全同意把所有 Phase 0 id 立刻强制改成 `bl-` 前缀。原因有两个：

1. Proposal 当前已有示例和初始项都是人类可读任务 slug，例如 `m2-voice-proposal`、`testflight-encryption-compliance`。Phase 0 的核心价值是用户和 Claude 读得懂；硬塞 `bl-` 会让用户面多一个机器味较重的约束。
2. 真正的冲突不是 "slug 没前缀"，而是 "未来是否会把 slug 当成 `issue.id`"。只要 contract 明确 BACKLOG `id` 永远只是 local natural key，Phase 2 promote 时生成独立 `issue.id`，冲突就消失。

**新建议**: schema 加两条即可，不强制现有 id 统一 `bl-`：

- `id`：`^[a-z][a-z0-9-]{2,63}$`，在 BACKLOG 文件内唯一，永久不变，只作为 backlog-local id，不得写入 harness `issue.id`。
- `harness_issue_id: string?`：Phase 0 为空；Phase 2 promote 后填真实 Issue UUID / primary key。

再补 invariant：`BACKLOG.id` 与 `harness.issue.id` 是两套命名空间，唯一桥接字段是 `harness_issue_id`。

### F2 (arch MAJOR) eva.json `worktrees[].name` 与 BACKLOG `id` / `assigned_session` 关系未定义 — agree
**对方原文核心**: `assigned_session` 同时允许 cwd、worktree name、`user-manual`，而 eva.json 已有 `worktrees[].name` 和状态机；两边谁是 source of truth、谁先写、是否同 commit 都没定义。

**表态**: agree

**理由**: 这与我 Phase 1 的 M3 完全同向，但 arch reviewer 把 eva.json 现有 schema 纳入了判断，比我只从 identity 稳定性角度看得更完整。`assigned_session` 现在是三种身份混在一个字段里，既不能稳定判断活窗口，也不能和 eva.json 对齐。

**新建议**: 接受 arch 的拆字段方向，但字段名可以更贴 Phase 0：

- `assigned_kind: user-manual | worktree | current-window | external`
- `assigned_cwd: string?`
- `assigned_worktree: string?`，若填写，必须等于 eva.json `worktrees[].name`
- `assigned_note: string?`

同时加 invariant：同一次认领 / 收线如果触及 BACKLOG 和 eva.json，必须在用户确认后同一个 commit 落下，不能分两次提交。

### F3 (arch MAJOR) I3 每次 status 转移 commit 在并行 session 场景会反咬 — refine
**对方原文核心**: `每次 status 转移 commit 一次` 与多 worktree、dev 分支保护、跨窗口可见性互相冲突；建议 BACKLOG 走 main 直 push、或 out-of-repo，或把 commit 改成写一次 / 视情况 push。

**表态**: refine

**理由**: 我同意 I3 现在不可执行，也同意这是 contract 可执行性问题。我的 Phase 1 M1 只指出 dirty working tree 会污染 commit；arch 进一步指出 branch protection 和多 worktree 可见性，这个补充成立。

我不同意 Phase 0 直接改成 out-of-repo。Proposal 的 G3 是跨 session 可见，当前所有 Cursor 窗口都围绕 repo 工作；把 BACKLOG 移到 `~/.vessel` 会绕开 git review、也让新 session 是否知道读取路径更依赖 CLAUDE.md 约定。Phase 0 先保留 in-repo 更符合用户"打开项目就能看"的使用方式。

**新建议**:

- I3 改成：每次 status 转移必须生成一次可审计 diff；是否 commit 取决于当前 git 状态。
- 写入前必须检查 `git status --porcelain`：
  - 若只有 steward 相关文件改动，允许 stage/commit 这些文件。
  - 若存在 unrelated staged changes，停止并要求用户确认。
  - 若存在 unrelated unstaged changes，只 stage steward 文件，不碰其他文件。
- 不承诺自动 push；Phase 0 的审计单位是 local commit，不是 remote branch 可见性。

这样解决我 Phase 1 B1/M1 的"零 CLI 负担 vs 自动 commit"冲突，也避免把 Phase 0 扩成分支保护治理。

### F4 (arch MAJOR) `eva:sessions` 被接入 boot ritual 且无稳定 JSON contract — agree
**对方原文核心**: `pnpm eva:sessions` 是 ANSI / 自由格式派生视图，却被 boot ritual 和推荐算法当成 contract API；每次新 session 都跑会变重，也缺少 JSON schema。

**表态**: agree

**理由**: 这条我 Phase 1 没抓到，是重要盲区。Proposal 把 `eva:sessions` 从"人眼工具"提升成"Claude 决策输入"，但没有给机器可读输出契约。对 steward 来说，活窗口判断是核心行为之一，不能靠解析表格。

**新建议**: Phase 0 设计应拆成两步：

- Boot ritual 只读 BACKLOG 并 echo 摘要，不默认跑 `eva:sessions`。
- 用户触发"看下一步"或"开始干"时才 lazy run `pnpm eva:sessions`。
- Deferred list 加 `eva-sessions-json-output`，要求未来提供 `--format json`，并把 JSON 字段当作稳定 contract。

如果想在 Phase 0 就依赖活窗口判断，`--format json` 不能 defer，必须先补。

### F5 (arch MAJOR) 收线流程与 inbox / lesson-store 机制重叠 — agree
**对方原文核心**: BACKLOG 的 `refs`、`done/blocked/dropped` 与现有 inbox / lesson-store 边界不清；Phase 0 绕开 backend 可以，但必须约定引用格式和不直接互写。

**表态**: agree

**理由**: 我 Phase 1 m4 提到 rollback 会丢 backlog-only 信息，但没有把 inbox / lesson-store 的边界纳入。arch 的判断更接近 contract review：Phase 0 不接 backend 是合理的，但不能留下"以后到底复制还是引用"的灰区。

**新建议**: 接受 `refs` 格式化建议：

- `refs` 元素统一为 `<kind>:<id>`。
- 允许 kind：`pr`、`commit`、`tag`、`adr`、`inbox`、`lesson`、`doc`。
- BACKLOG 不直接写 inbox / memory.db；inbox / lesson 也不直接改 BACKLOG。互相只通过 `refs` 指认。

这也能修正 proposal 里 `refs: [PR #42, ...]` 这种不可解析格式。

### F6 (arch MAJOR) 6 个 prompt 覆盖不够 80% — refine
**对方原文核心**: 至少缺改优先级、看 done 历史、unblock、drop 等高频操作；建议调成 8 个，或复合化"加/改"。

**表态**: refine

**理由**: 我同意 6 个 prompt 的覆盖声明证据不足，但不建议 Phase 0 直接扩成 8 个或更多。G4 的重点是降低用户记忆负担，Phase 0 不是做完整 task manager。`drop` 已经在"收线"流程里出现，`unblock` 可以作为 `blocked 因为` 的反向补充，但"看 done 历史"更像回顾能力，不该卡 Phase 0。

**新建议**:

- 保持主手册 6 个短语，但把"标 blocked"改成"改状态"复合短语：
  - `<task-id> blocked 因为 <reason>`
  - `<task-id> 解锁`
  - `<task-id> 不做了 因为 <reason>`
- 增加一个非核心 fallback 规则：用户说"`<task-id>` 改 P1 / 改 M / 改 note"时，Claude 应 normalize 为 BACKLOG 字段修改并展示 diff。
- `看 done 历史` 放 Phase 1，不进入 Phase 0 必备 prompt。

这比直接增加 prompt 数更符合 MVP。

### F7 (arch MAJOR) CLAUDE.md boot ritual 在 Cursor 里靠约定，可靠性证据不足 — agree
**对方原文核心**: Proposal 假设新 session 会读 CLAUDE.md 并执行 boot ritual，但没有验证 Cursor / Claude Code CLI 的命中率；Scenario F 应提前作为 smoke test。

**表态**: agree

**理由**: 这条成立，而且直接影响 G3。Phase 0 的"跨 session 可见"不是只要文件存在就成立，还要求新 session 真的读它。Proposal 当前把 Scenario F 放在最后，确实倒置了风险。

**新建议**:

- Dogfood gate 第一个 scenario 改成"boot ritual 冷启动可靠性"。
- 分 Cursor agent 与 Claude Code CLI 各跑 5 次冷启动。
- 如果自动读 BACKLOG 命中率 < 80%，Phase 0 文案必须降级：不承诺自动启动，只承诺用户粘 `看 backlog 推荐下一步` 后进入 steward 流程。

### F8 (arch MINOR) `parallel_safe_files` 与 eva.json `owns` 语义歧义 — agree
**对方原文核心**: `parallel_safe_files` 名字像"安全并行的文件"，描述却是"主要改的路径前缀"；与 eva.json `owns` 语义不一致。建议改名为 `touches_paths`。

**表态**: agree

**理由**: 这条与我 Phase 1 对 assigned identity 的担忧同类，属于字段语义会误导 Claude 的问题。`parallel_safe_files: ["docs/proposals/"]` 的确无法判断是"我会碰这里"还是"别人可以碰这里"。

**新建议**: 改名为 `touches_paths`，并定义：

- 空数组 = 不触碰 repo 文件，或纯外部/manual 操作。
- 两个 active / in_progress 项的 `touches_paths` 有前缀重叠时，默认不建议并行。
- `conflicts_with` 比 path 派生判断优先级更高。

### F9 (arch MINOR) 初始填充与 IMPROVEMENTS.md / IDEAS.md 重复 — agree
**对方原文核心**: §10 初始项复制了 IDEAS / IMPROVEMENTS 的内容，但 I6 又说不复制；需要 refs 和 decommission 规则。

**表态**: agree

**理由**: 成立。Proposal 的 Problem 正是"5 个 surface 分散"，如果 Phase 0 新建 BACKLOG 后继续让 IDEAS / IMPROVEMENTS 接收活跃任务，就变成第 6 个 source of truth。

**新建议**:

- 初始填充每项必须带 `refs` 指回来源文档或 PR / tag。
- Ship 后新增 actionable work 只进 BACKLOG；IDEAS 保留产品想法池，IMPROVEMENTS 保留历史审计 / 技术债归档，不能再作为执行队列。
- Phase 1 决定是否迁移 IDEAS / IMPROVEMENTS 的剩余活跃项，而不是 Phase 0 一次性全搬。

### F10 (arch MINOR) boot ritual stale > 24h 阈值太短 — agree
**对方原文核心**: 个人项目 24h 不更新很正常，stale warning 会变成噪音；建议改 7d 或去掉。

**表态**: agree

**理由**: 这条虽小，但会影响用户是否愿意遵守 boot ritual。24h 阈值把"项目今天没推进"误判成"backlog 不可信"，噪音太高。

**新建议**: 改成 7d，并且文案从警告降级为提示：`Backlog 7 天未更新，先确认是否仍代表当前优先级。`

### F11 (arch MINOR) "永久保留 done" 与 1MB archive 阈值冲突 — agree
**对方原文核心**: "永久保留 done" 与 ">1MB 手工 archive" 表面矛盾；应说明永久保留是不删除审计记录，不等于永远留在主 BACKLOG 文件。

**表态**: agree

**理由**: 成立。这个不影响 Phase 0 行为，但会影响后续 Claude 对"done 是否能移动"的解释。

**新建议**: I4 改成：done / dropped 永不删除；主 `docs/BACKLOG.md` 可只保留近 180 天或当前 quarter，历史移入 `docs/BACKLOG-archive-YYYY-Q.md`，并在主文件保留 archive index。

### F12 (arch MINOR) `STEWARD_PROMPTS.md` 提到但提案中未给出 — agree
**对方原文核心**: Proposal 多次引用 `docs/STEWARD_PROMPTS.md`，但没有把它列为完整 deliverable，也没有给内容大纲。

**表态**: agree

**理由**: 成立。既然 Phase 0 的用户接口就是 prompt 短语，`STEWARD_PROMPTS.md` 是 contract 的一部分，不是实施时顺手写的附属文档。

**新建议**: §9 deliverables 明确三份文件：

- `docs/BACKLOG.md`
- `docs/STEWARD_PROMPTS.md`
- `CLAUDE.md` steward boot ritual section

并在 proposal 里给 `STEWARD_PROMPTS.md` 半页大纲：6 个主短语、字段修改 fallback、每个短语的 expected diff / commit 行为、失败时如何报错。

## 我自己 Phase 1 verdict 的自我修正

看完 arch verdict 后，我会这样修正自己的 Phase 1 findings：

- **B1 保持 BLOCKER，但措辞收窄**：问题不是"Claude 绝对不能跑命令"，而是 proposal 没定义"用户零 CLI 负担"与"Claude 代执行命令 / commit"之间的权限边界。修法应写成：用户不手敲 CLI；Claude 可以代跑 repo 内命令，但写入 / commit 前必须展示 diff 并等待确认。
- **M1 升级为 BLOCKER 子项，合并进 arch F3**：dirty working tree 不是孤立问题，而是 I3 commit contract 不可执行的一部分。应和 branch / worktree 可见性一起处理。
- **M2 保持 MAJOR**：`status` 与 section 双 source of truth 仍然存在，arch 没单独点，但 F11 / archive 与 F8 / path 命名都说明 schema 语义需要更严格。建议加 invariant：`status` 是权威，section 只是渲染；每次写回按 status 重新归类。
- **M3 保持 MAJOR，合并进 arch F2**：我原先的 `assigned_session` 身份稳定性问题被 arch 的 eva.json 对齐问题强化了。
- **m1 保持 MINOR**：`blocked` 与 `blocked_by_dependency` 仍需区分；这可在 §3.4 推荐算法中修，不必提升。
- **m2 保持 MINOR，但 defer**：aging 规则可以放 Phase 1。Phase 0 推荐算法保持简单可以接受。
- **m3 保持 MINOR**：`completed_at` 应明确 UTC ISO-8601。
- **m4 提升为 MAJOR 的一部分，合并进 arch F5/F9**：rollback 不只是"删文件是否丢数据"，而是 BACKLOG 与 IDEAS / inbox / lesson 的引用边界。应通过 refs 规范和 archive / decommission 规则修。

新增我之前没看到、现在会加入的 findings：

- `eva:sessions` 输出契约不足是 MAJOR。
- boot ritual 冷启动可靠性是 MAJOR。
- `refs` 格式必须结构化，否则 Phase 1 bridge 会再次靠自然语言猜。

## 新发现 (new-finding)

arch 角度让我看到的盲区主要有三类：

1. **工具脚本被隐式提升为 API**：`pnpm eva:sessions` 原本只是人眼状态表，但 proposal 把它当成推荐算法输入。只要 Claude 要解析它，它就需要 JSON contract 或至少稳定输出声明。
2. **Phase 0 虽然不动 DB，但仍然在写未来迁移契约**：`id`、`refs`、`harness_issue_id`、`assigned_worktree` 这些字段决定 Phase 2 promote 是否顺滑。不能因为"不动 harness.db"就跳过 schema anchor。
3. **"single source of truth" 不是只建一个新文件**：还要定义旧 surface 的降级方式。IDEAS / IMPROVEMENTS / inbox / lesson-store 都必须有"引用而非复制"的边界，否则 BACKLOG 会变成第 6 个 surface。

## 收敛建议

两份 verdict 合并后，建议作者优先修这 5 个：

1. **先修写入 / commit contract**：澄清"用户零 CLI 负担"、Claude 代执行权限、dirty tree 处理、status 转移是否必须 commit。合并 cross B1/M1 + arch F3。
2. **修 schema anchor**：明确 `id` 是 backlog-local natural key，新增 `harness_issue_id`，结构化 `refs`，明确 `completed_at` UTC ISO-8601，声明 `status` 是权威。合并 arch F1/F5 + cross M2/m3。
3. **修 session / worktree 身份模型**：拆 `assigned_session`，对齐 eva.json `worktrees[].name`，定义 BACKLOG + eva.json 同 commit 的规则。合并 arch F2 + cross M3。
4. **降低 boot ritual 重量并验证可靠性**：boot 只读 BACKLOG；`eva:sessions` lazy run；Scenario F 提到第一位，做 Cursor / Claude Code 冷启动命中率验证。合并 arch F4/F7。
5. **收紧用户面 prompt 和旧 surface 边界**：保留 6 个主短语但补 fallback / unblock / drop 规则；`STEWARD_PROMPTS.md` 列为 deliverable；IDEAS / IMPROVEMENTS / inbox / lesson 只通过 refs 连接。合并 arch F6/F9/F12。

如果这 5 项修完，剩余 F8/F10/F11 和 cross m1/m2/m4 都可以作为同一轮文档 polish 处理，不应阻塞进入修订版 proposal。
