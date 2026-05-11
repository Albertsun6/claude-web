# Steward — 详细使用说明

> Steward 是 Vessel 的"总管"：一个文件 + 9 个短语，跟你说**下一步该干啥**、**该不该开新窗口**、**做完了怎么收**。
>
> **关键**：你**从来不用敲 CLI 命令**——粘短语进任何 Cursor 窗口的 Claude，它跑、它问 ack、它收尾。
>
> **5 分钟读完，记住 3 个短语就开始用**。
>
> 数据契约：[`adr/vessel/ADR-019-steward-v0-contract.md`](adr/vessel/ADR-019-steward-v0-contract.md)
> 短语速查：[`STEWARD_PROMPTS.md`](STEWARD_PROMPTS.md)
> 当前 backlog：[`BACKLOG.md`](BACKLOG.md)

---

## 为什么需要 Steward

之前的问题：

1. **每个新 Claude session 不知道今日卡点** —— 你每次开新窗口都得重述"现在做到哪了"
2. **跨 session 协调靠脑记** —— 一个窗口在改 `scheduler.ts`，另一个窗口要改同文件不会知道
3. **PR 合完没人收尾** —— 相关 inbox / 待办漂着没人 archive
4. **"该不该开新窗口"靠每次问 Claude** —— 决策树没工具化

Steward 用一个文件 `docs/BACKLOG.md` 当中央协调点，9 个短语让你不用敲 CLI 就能驱动。

---

## 第一次用：5 分钟流程

### Step 1：你不用做任何 setup

文件已经在 repo 里。打开任意 Cursor 窗口（指向 `~/Desktop/Vessel`）→ 启 Claude Code（Cmd+Esc 或左下角图标）。

### Step 2：粘第一个短语

```
/boot
```

Claude 会回类似：

```
Backlog: 1 in_progress · 5 planned · 2 blocked · 4 done

最近更新 6h 前 (fresh).

需要我推荐下一步吗？
```

如果它没主动这么做（CLAUDE.md 约定命中率约 80%），就再粘一次或换：

```
看 backlog 推荐下一步
```

### Step 3：选一个开干

```
开始干 m2-voice-proposal
```

Claude 会判断"本窗口能做"还是"该开新窗口"：

- **本窗口** → 改 BACKLOG 状态 + commit (问你 ack) + 开始实施
- **开新窗口** → echo 5 步命令模板，让你 ack 后执行，开好新 Cursor 窗口

### Step 4：完了收线

```
m2-voice-proposal 收线
```

Claude 问 outcome → 改 BACKLOG done → 清理 worktree（如有）。

**就这 3 个短语**就能覆盖 80% 日常用法。其余 6 个偶尔用，看 [`STEWARD_PROMPTS.md`](STEWARD_PROMPTS.md)。

---

## 概念 6 个

理解这 6 个就懂了。

### 1. Task vs Issue vs Initiative

- **Task** = backlog 里一条记录 = 一件可独立交付的事 ≈ 一个 PR
- **Issue** = harness.db 里的（Phase 0 不用，Phase 2 升级）
- **Initiative** = 跨多 task 的战役（如 "ship M2"）

你日常只跟 Task 打交道。

### 2. 9 种状态

```
planned ─→ in_progress ─→ done
   ↓             ↓
blocked      blocked
   ↑             ↑
unblock      unblock

任意 ─→ dropped
```

- `planned`：等开始
- `in_progress`：进行中（assigned 给某窗口或 user-manual）
- `blocked`：**用户**主动暂停 + `blocked_reason` 必填
- `done`：完成，永久保留
- `dropped`：放弃，永久保留作审计

注意：**`depends_on` 未完成 ≠ status=blocked**。前者是"计算出的 blocked"（`status` 仍 `planned`），后者是"用户决定的 blocked"。Claude 不会自动把前者升级成后者。

### 3. 优先级 + 大小

- **priority**: `P0` 阻塞 / `P1` 重要 / `P2` 一般 / `P3` 可延
- **size**: `S` ≤ 30 分钟 / `M` ≤ 半天 / `L` ≥ 1 天

排序键：`priority asc, size asc`（P0 优先，小任务先闭环）。

### 4. 依赖 vs 冲突

- **depends_on**：必须先做完 X 才能做 Y。Y 不会自动开始；computed-blocked
- **conflicts_with**：X 和 Y 不能**同时** in_progress（典型：改同一文件区）

### 5. parallel_safe_files

主要改的目录前缀。决定能否**并行**做（开新窗口）。比如：

```yaml
parallel_safe_files: ["docs/proposals/"]
```

= 我只动 docs/proposals/ 下的文件，跟主线主窗口（改 backend/）零冲突 → 可以开新窗口并行。

### 6. assigned_kind

谁在做这个 task：

- `main`：主 Cursor 窗口的 Claude
- `worktree`：另一个 Cursor 窗口（在某个 git worktree 里）
- `user-manual`：你自己手操作（点 web UI / 真机点屏）
- `external`：第三方流程（如等 Apple 审核）

---

## 5 种典型工作流

### 流程 A：早上开工 + Dispatch 决策

1. 打开 Cursor，启 Claude
2. 粘 `/boot`
3. 看摘要 → 粘 `看 backlog 推荐下一步`
4. Claude 给 top 3 候选 → 选一个 → 粘 `开始干 <id>`
5. **Claude 不直接动手**，先给 spawn 分析 + 推荐：

   ```
   Task: m2-voice-proposal
     size=M · priority=P2 · parallel_safe_files=["docs/proposals/"]
     depends_on=[] · assigned_kind 候选=main

   Spawn 分析：
     • size=M  → 倾向 spawn（≤ 半天，单独 session 不算亏）
     • parallel_safe_files 跟主窗口最近改的文件零重叠 → spawn 安全
     • 主窗口状态：idle（刚 commit 完）
     • eva:sessions：除我外 0 个活窗口

   建议：SPAWN
   理由：M 级 + 主窗口干净，spawn 保证主线 context 不被实施细节冲刷。

   你的选择：ok spawn | ok stay | 用户做 | drop / blocked / 改 P<n>
   ```

6. 你回 1 个短语（如 `ok spawn`）→ Claude 跑下一步（见流程 B）

**关键原则**：所有 spawn / stay / 用户做决策都过你的眼。Claude 不静默选边。

### Dispatch 推荐规则速查

Claude 给推荐时按这套启发式（不是硬规则，会结合 parallel_safe_files / 主窗口状态调整）：

| 场景 | 建议 |
|---|---|
| `size=L` 任意 task | **SPAWN**（大任务必须独立 session） |
| `size=M` + `parallel_safe_files` 跟主窗口零重叠 | **SPAWN** |
| `size=M` + 主窗口刚 commit 完 idle | SPAWN（保主线干净） |
| `size=M` + 主窗口在做相关工作 | STAY（接着做） |
| `size=S` + 改 docs / scripts 小作用域 | STAY（spawn 不划算） |
| `size=S` + 改产品代码 | 主窗口决定（你拍） |
| `assigned_kind 候选=user-manual` | **USER-MANUAL**（你手做，主窗口跟踪） |
| 主窗口在等 (CI / Apple / review) + 有独立 task | SPAWN（充分利用并行）|

### 流程 B：开新窗口 spawn（接 A 的 `ok spawn`）

1. Claude echo 5 步命令模板：
   ```
   git worktree add -b feat/eva-m2-voice-proposal ~/Desktop/Vessel-voice dev
   编辑 eva.json 加 worktree 条目
   open -a Cursor ~/Desktop/Vessel-voice
   新窗口里粘：「开始干 m2-voice-proposal，详情见 docs/BACKLOG.md」
   ```
2. 等你再 `ok` (I8 mid-tier write ack) → Claude 执行
3. 新 Cursor 窗口弹出 → 启 Claude → 粘那条 prompt → 它接着干
4. 主窗口的 Claude 更新 BACKLOG：`status: in_progress` + `assigned_kind: worktree` + `assigned_cwd: ~/Desktop/Vessel-voice` → commit (I9 守门)

### 流程 C：完成一条

在做这条 task 的窗口里：

1. 粘 `<id> 收线`
2. Claude 问 outcome (`done` / `blocked` / `dropped`)
3. 你说 `done`，给 PR 号或 commit SHA
4. Claude 写 BACKLOG done 段 + 如果有 worktree，问 ack 后跑 `pnpm eva:hook pre-remove --yes <name>`
5. 主窗口下次 `/boot` 会看到这条已 done + 下一步候选刷新

### 流程 D：临时想到一件事

```
加待办: 修 inbox iOS 滑动 lag; P2; M; 影响录入体验
```

Claude 自动生成 id + 加进 BACKLOG Active 段 + 等 ack 后 commit。

之后想做时再 `开始干 inbox-ios-scroll-lag`。

### 流程 E：调整方向

不想做某事了：

```
m2-ops-mvp drop 因为 一年内不会用到
```

或者要先暂停等条件：

```
m2-voice-impl blocked 因为 等 ADR-020 评审
```

之后条件成熟：

```
m2-voice-impl unblock
```

---

## Boot ritual 详解

**理想路径**：Cursor 新窗口 → Claude 启动 → 自动读 `docs/BACKLOG.md` + echo 摘要 + 等你指令。

**现实**：Cursor 没暴露 session-start hook，Claude 是否主动读靠 CLAUDE.md 约定 ≈ 80% 命中。

**Fallback 有两条**（任挑一个）：

1. **Slash command**：`/boot` —— 对应 [`.claude/skills/boot/SKILL.md`](../.claude/skills/boot/SKILL.md)。Cursor 启动时把 skill 列表注入 Claude；如果 skill 未被索引到（罕见），slash command 不会触发。
2. **自然语言（永远可用）**：`看 backlog 推荐下一步` 或更短 `看 backlog`。不依赖任何 skill，靠 Claude 读了 CLAUDE.md 后理解。

**实操建议**：先试 `/boot`，没反应就换 `看 backlog`。后者跨所有 session 状态可靠。

**Lazy 化**：boot 时只读 BACKLOG.md + 检查 stale，**不**自动跑 `pnpm eva:sessions`（避免 boot 慢）。等你问"下一步"或"活窗口"时才跑。

---

## 三层执行白名单（I8）—— 关于 Claude 该跑啥

Claude 跑命令的归类：

| 层 | 含义 | 例子 | Claude 怎么做 |
|---|---|---|---|
| **read-only auto** | 只读，无副作用 | `git status` `ls` `cat` `pnpm eva:sessions` | 默许自动跑 |
| **write needs ack** | 写文件 / commit / 远端写 | 改 BACKLOG.md / `git commit` / `gh pr edit` | echo 命令 → 等你 `ok` / `yes` / `继续` |
| **destructive needs explicit affirmative** | 不可逆 | `rm -rf` / `git push --force` / `git worktree remove` | echo → **必须**你主动短语肯定（不接受默认 yes） |

**你的责任**：看 Claude echo 的命令时，瞄一眼是不是你想的。脑子里有疑虑就拒绝。

**Claude 的责任**：destructive 永不静默执行；write 永不省 ack 步骤；read-only 不烦你。

---

## 错误恢复

### 1. BACKLOG.md 解析挂了（YAML 坏）

Claude 会主动告诉你解析失败 + 显示有问题的行号。**不要**靠 Claude 自动 fix——它可能继续坏下去。

修复路径：
1. 从 `~/.vessel/backlog-mirror.jsonl` 找上一次健康状态（append-only mirror，每次 status 变迁追加一行）
2. 手动恢复 BACKLOG.md 到那个状态
3. 提一个 chore commit "fix(backlog): restore from mirror"

### 2. Claude 没主动跑 boot ritual

试 `/boot`（slash command，依赖 [`.claude/skills/boot/SKILL.md`](../.claude/skills/boot/SKILL.md)）。如果没反应（skill 未被 Cursor 索引到等），用自然语言兜底：`看 backlog 推荐下一步` 或更短 `看 backlog`。

### 3. 两个 Cursor 窗口同时改 BACKLOG.md

**约定**：BACKLOG.md 只在**主窗口**（你定义哪个是主）改。其它窗口只读。

如果撞了 git merge 冲突，按时间晚的为准，手动 resolve YAML（`status` 字段以晚的为准）。

### 4. Phase 2 想升 BACKLOG → harness Issue 表

预留好了：BACKLOG 的 `harness_issue_id` 字段 Phase 0 留空，Phase 2 实施时 promote 流程会 (1) `INSERT INTO issue VALUES (...)` (2) 回填 `harness_issue_id` 到 BACKLOG。详见 ADR-019 不变量 I7。

---

## 进阶：什么时候**不**用 Steward

Steward 是**工作分发 + 跟踪 + 收尾**，不是万能工具。下列场景**不**经过它：

| 场景 | 走哪 |
|---|---|
| 30 秒碎想 / 灵感 | iOS Inbox 视图 → 之后 triage 决定要不要进 BACKLOG |
| 架构决策 | 写 proposal → `harness-review-workflow` 评审 |
| schema / 协议变更 | 同上 + contract mode + ADR |
| 写 PR 提交代码 | 正常 git/gh，**不**走 BACKLOG（PR 是 task 实施手段，task 已经在 BACKLOG 跟踪） |
| 调研别人怎么做 | `survey` 或 `borrow-open-source` skill |
| 真机测试 / 装 app | `ios-install` / `ios-e2e-test` skill |
| 评审已有提案 | `harness-review-workflow` (proposal / contract / patch mode) |

---

## 跟其它系统的边界

| 系统 | 角色 | Steward 怎么互动 |
|---|---|---|
| `docs/IMPROVEMENTS.md` | P0-P3 技术债库 | Steward 不复制 P0-P3；你想做时 `加待办` 单独建 Task + `refs: ["doc:IMPROVEMENTS.md#L42"]` |
| `docs/IDEAS.md` | P1-P9 想法库 | 同上 |
| `docs/HARNESS_ROADMAP.md` | M-1 → M7 里程碑 | 同上 |
| `~/.vessel/inbox.jsonl` | 30 秒碎想 | Phase 0 不自动 promote；Phase 1 加自动 triage → backlog |
| `harness.db issue` 表 | M-1 spike schema | Phase 0 不动；Phase 2 用 `harness_issue_id` 字段桥 |
| `eva.json` | worktree 注册表 | Steward 改 BACKLOG 同时改 eva.json（同 commit）；`assigned_cwd` 必须对应 eva.json 某 worktree 的 path |
| `pnpm eva:sessions` | 派生视图（活窗口）| Steward "看下一步" 算法的输入；lazy。Claude 机器消费走 `--format json`（契约见 ADR-019 §eva:sessions JSON contract），人眼看走默认 ASCII 表 |
| `pnpm eva:hook` | worktree lifecycle | Steward 收线时调 `pre-remove` |
| `lesson-store.ts` (memory.db) | 知识沉淀 | Phase 0 不写；Phase 1 收线时可选自动添加 |

---

## 11 个不变量（I1-I11）快速参考

| ID | 含义 | 你需要注意 |
|---|---|---|
| **I1** | BACKLOG.md 是唯一写入点 | 其他 doc 不复制 backlog 项 |
| **I2** | id 永久不变 | rename 算新建一项 |
| **I3** | 每次 status 转移产生可审计 diff | commit 视 git state 而定 (I9) |
| **I4** | done / dropped 永久保留 | 200KB 阈值后季度 archive 到 `BACKLOG-archive-YYYY-Q.md` |
| **I5** | 你不写 YAML | Claude 改完显示 diff，你复核 |
| **I6** | 不复制 inbox / IMPROVEMENTS 内容 | 引用即可：`refs: ["inbox:<uuid>"]` |
| **I7** | BACKLOG.id ↔ harness.issue.id 命名空间隔离 | Phase 2 promote 桥靠 `harness_issue_id` 字段 |
| **I8** | 三层执行白名单 | read-only auto / write needs ack / destructive needs explicit affirmative |
| **I9** | commit 守门 | 脏 working tree 触发 ack；不静默 stage 其它文件 |
| **I10** | `status` 字段是状态唯一权威 | section header 仅人眼导航；Claude 解析只看 status |
| **I11** | Dispatch 决策必经用户拍板 | `开始干 <id>` 时 Claude 给 spawn 分析 + 推荐 + 等你 `ok spawn / ok stay / 用户做`；永不静默选边 |

---

## FAQ

**Q: 为什么不直接用 GitHub Issues？**
A: Steward 跟 git/PR 一起 in-repo，跨 Cursor 窗口 / 跨机器同步零摩擦。GitHub Issues 需要登 web 看 + iOS 没原生入口 + 跟 PR 标号系统耦合。Phase 1+ 可加双向 sync。

**Q: 为什么是 markdown 文件不是 SQLite？**
A: Phase 0 KISS。文件可读、可手改、可 review、可 git diff。Phase 1+ 加 CLI 时考虑加 DB。

**Q: 多窗口同时改 BACKLOG 会撞吗？**
A: 实践约定"只主窗口改 backlog"。git merge 时 YAML 行级冲突解就行，按时间晚的为准。

**Q: 我手改 BACKLOG.md 不通过 Claude 行吗？**
A: 行，但你得**手动**遵守 schema（参 [ADR-019](adr/vessel/ADR-019-steward-v0-contract.md) §Schema）+ 不忘 commit。Steward 设计是 "Claude 改你看"（I5），但绝不强制只能 Claude 改。

**Q: 我已经记得 9 个短语，能不能省 boot ritual？**
A: 能。`/boot` 只是 fallback，不是强制。任何时候粘 1-9 任一短语，Claude 都能干活。

**Q: 我没把 task 进 backlog，直接让 Claude 干活算啥？**
A: 算"未跟踪工作"。能干，但完了没人记得，下次新 session 看不到这段历史。建议干之前先 `加待办` 5 秒钟登记。

**Q: 改 ADR-019 / schema 要走啥流程？**
A: 走 `harness-review-workflow` contract mode → 评审收敛 → 新 ADR (ADR-020 ...)。**不能**直接改 BACKLOG schema 不评审——会破坏所有未来 session 的 contract 兼容性。

---

## 一句话总结

```
不知道下一步      →  /boot                      或      看 backlog 推荐下一步
要开始一项       →  开始干 <id>
完成一项         →  <id> 收线
临时想到一件事    →  加待办: <title>; P<n>; <S/M/L>
其它              →  STEWARD_PROMPTS.md 速查
```

5 个能记下就够日常用。

---

**版本**：v0.2 (Phase 0)
**契约 ADR**：[ADR-019](adr/vessel/ADR-019-steward-v0-contract.md)
**反馈**：粘 `加待办: 改 steward usage manual / <你的反馈>; P2; S` 即可
