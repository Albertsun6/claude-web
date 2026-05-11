# Phase 3 Author Arbitration — Steward V0

> Author: Albert (via Claude main session) · Date: 2026-05-12
> Reviews consumed:
> - Phase 1: `docs/reviews/steward-v0-arch-2026-05-12-0026.md` + `docs/reviews/steward-v0-cross-2026-05-12-0026.md`
> - Phase 2: `docs/reviews/steward-v0-react-arch-2026-05-12-0026.md` + `docs/reviews/steward-v0-react-cross-2026-05-12-0026.md`

## Decision matrix

按 finding 维度，跨两位 reviewer 合并。✅ 接受 / ⚠️ 部分接受 / 🚫 反驳 / 🟡 用户决定。

### BLOCKER 级

| Finding | Reviewers | Decision | 理由 / 落地 |
|---|---|---|---|
| **arch F1** id 命名空间 + harness_issue_id 缺失 / **cross 未直接对应**（cross 通过 m1/m3 侧面打到） | arch BLOCKER · cross react refine | ⚠️ **部分接受**（采纳 cross 的 refine） | 接受问题：schema 必须加 `harness_issue_id` 字段 + 锁 id 正则。**反驳** arch 的 `bl-` 前缀强制：增加机器味、人读累、价值不抵成本。落地：(1) 加正则 `^[a-z][a-z0-9-]{2,63}$`，与 eva.json `name` 对齐；(2) schema 加 `harness_issue_id: string?` 显式字段；(3) 加 invariant **I7**：BACKLOG.id 永不写入 harness.issue.id，两套命名空间隔离。 |
| **cross B1** G1 "零 CLI 负担" vs Claude auto-run 矛盾 / **arch 通过 F4/F7 侧面打到** | cross BLOCKER · arch react refine（提 3 层白名单） | ✅ **接受**（取 arch react 的 refine） | 真正问题是 G1 表述歧义——"用户从不在终端敲命令" vs "Claude 帮跑命令" 没区分。落地：(a) G1 改写为 **"用户从不在终端敲命令；Claude 代执行命令需明确归类 + 用户授权"**；(b) 加 invariant **I8 三层执行白名单**：read-only 默许自动跑 / write 需用户 ack / 永不执行（destructive 如 rm -rf / force-push）需显式肯定语 + 不可静默自动；(c) §7 dogfood gate 加 pass criterion "用户全程没敲终端命令，所有命令 Claude 执行并 echo 出来"。 |

### MAJOR 级

| Finding | Reviewers | Decision | 理由 / 落地 |
|---|---|---|---|
| **arch F2** eva.json `worktrees[].name` ↔ BACKLOG `id` / `assigned_session` 关系未定义 / **cross M3** assigned_session 身份不稳 | 双方 agree | ⚠️ **部分接受**（拆 2 字段，不拆 4） | 接受问题：assigned_session 三值域是真歧义。**反驳** cross 的 4 字段版本（branch derive 自 worktree、note 是冗余）。落地：拆为 `assigned_kind` (枚举 main/worktree/user-manual/external) + `assigned_cwd` (string?，若 kind=worktree 必填且必须匹配 eva.json 某 worktree 的 path)；删 worktree-name + note 字段。Phase 1+ 若不够再加。 |
| **arch F3** I3 commit-per-transition 与 branch protection / 多 worktree 冲突 / **cross M1** dirty working tree 污染 commit | 双方 agree + react 拆出 2 维 | ✅ **接受**（拆 2 个独立 MAJOR） | arch react 拆分正确：F3 = commit **落在哪**问题；M1 = commit **包含什么**问题。落地：(1) 改 I3 措辞："每次 status 转移产出可审计 diff；是否 commit + 提到哪个分支取决于 git status"；(2) 加 invariant **I9 commit 守门**：Claude 改完 BACKLOG.md，先 `git status --porcelain` 看脏度——纯净则可立即 commit 到 current branch；存在无关 dirty 文件则只 stage BACKLOG 改动，commit 前向用户摘要 + ack；(3) **反驳** arch 提的 "out-of-repo backlog" —— Phase 0 G3 需要 in-repo 可见，移到 ~/.vessel 反而给新 session 增加 path 发现负担。 |
| **arch F4** eva:sessions 接入 boot ritual 但无 JSON contract / **cross 未直接对应** | arch MAJOR · cross react agree | ✅ **接受** | 落地：(1) §3.3 boot ritual lazy 化——boot 只做"读 BACKLOG + stale 检查"，**eva:sessions 推到用户问"下一步/活窗口"时再跑**；(2) 加 backlog item `eva-sessions-json-output` (P2, S)，给 [scripts/eva-sessions.mjs](scripts/eva-sessions.mjs) 加 `--format json` flag——这是 contract API 升级，单独 PR。 |
| **arch F5** 收线流程与 inbox/lesson-store 重叠 / **cross 未对应** | arch MAJOR · cross react agree | ✅ **接受** | 落地：(1) §3.1 schema `refs` 字段格式锁死 `<kind>:<id>` ——`inbox:<uuid>` / `pr:#42` / `commit:<sha>` / `lesson:<id>` / `adr:<num>`；(2) §3.6 收线步骤明确**不自动写 lesson**（仍 defer），仅在 refs 里引用相关 PR。 |
| **arch F6** 6 prompt 不够 80% / **cross 未直接** | arch MAJOR · cross react refine | ✅ **接受**（加 3 个） | arch react 列了 4 类缺失：change priority / unblock / drop / "看活窗口"。"看活窗口"可并入"看下一步"。落地：6 → **9** 个 prompt。补：**改优先级** / **unblock** / **drop**。 |
| **arch F7** boot ritual 靠约定无可靠性证据 / **cross 未对应** | arch MAJOR · cross react agree | ⚠️ **部分接受**（加 fallback，不做 5x cold-boot gate） | 接受问题：Cursor 没暴露 session-start hook，光靠 CLAUDE.md 约定 ~80% 命中是乐观假设。**反驳** arch 的"5 次冷启动 + 80% 命中作 gate"——Phase 0 过重。落地：(1) STEWARD_PROMPTS.md **首条短语就是 boot ritual fallback**：`/boot` 或 `看 backlog 推荐下一步`，用户察觉 Claude 没主动 echo 时手动触发；(2) §7 scenario F 改为 "若 Claude 未主动读，用户粘贴 `/boot`，应在 5 秒内得到 backlog 摘要"。 |
| **cross M2** status 与分区 dual SoT | cross MAJOR · arch react agree（标 false-positive watch 过保守） | ✅ **接受** | 落地：加 invariant **I10**：`status` 字段是唯一权威；section header (Active / Blocked / Done) 只作人眼导航；Claude 解析 BACKLOG 时**只看 status 字段**，不看 section。 |
| **F13 NEW (arch react)** invariant cross-product 兼容性 | 仅 arch react | ✅ **接受** | 落地：v0.2 加 §4.5 "Phase 0 不变量兼容性矩阵"，列出 I3-I10 两两组合下是否成立。 |

### MINOR 级

| Finding | Decision | 落地 |
|---|---|---|
| **arch F8** parallel_safe_files 与 eva.json `owns` 歧义 | ✅ 接受 | schema 字段注释明确：BACKLOG.parallel_safe_files 是 **task-级冲突预测**；eva.json `owns` 是 **worktree-级所有权声明**。两套不同语义，可以重叠但不互替。 |
| **arch F9** 初始填充与 IMPROVEMENTS/IDEAS 重复 | ⚠️ 部分接受 | 初始 backlog 只放**不在** IMPROVEMENTS/IDEAS 的新项 + 当前对话流活跃项；既有 P0-P3 项不复制，等 Phase 1 单向同步。 |
| **arch F10** stale > 24h 太短 | ✅ 接受 | 改 **72h**。|
| **arch F11** 永久保留 vs 1MB 冲突 | ⚠️ 部分接受 | 改：当前文件保留 done 项直到**总文件 > 200KB**（比 1MB 早触发），到阈值后 quarterly archive 到 `docs/BACKLOG-archive-YYYY-Q.md`。 |
| **arch F12** STEWARD_PROMPTS.md 提到但未提供 | ✅ 接受 | 实施时一并产出。|
| **cross m1** explicit-blocked vs blocked-by-dep 混用 | ✅ 接受 | `status=blocked` 表"用户决定暂停 + blocked_reason"；`depends_on 未 done` 是"computed-blocked"，status 留 planned，Claude 读时 compute。 |
| **cross m2** priority+size 饿死大任务 | 🚫 **反驳** | Phase 0 单用户单机助理无并发竞争，无饿死物理条件。Phase 2 多 agent 时再回头评估。理由记进 v0.2 §5 ADR-lite。 |
| **cross m3** completed_at 时间格式 | ✅ 接受 | 锁定 **ISO-8601 UTC + Z 后缀**（如 `2026-05-11T13:09:00Z`）。 |
| **cross m4** rollback 低估 BACKLOG 新增价值 / **arch react** 加 mirror jsonl | ✅ 接受（采纳 refine） | 加 `~/.vessel/backlog-mirror.jsonl` append-only mirror，每次 status 变迁同步追加一行；rollback 失败时可从 mirror 复原。 |
| **F14 NEW (arch react)** G1 二义性污染 §7 pass criteria | ✅ 接受 | 已并入 cross B1 → 加 dogfood pass criterion。 |

### 用户决定（🟡）

**0 条**。所有 finding 作者层面就能仲裁，没有需要用户偏好的真分歧。

---

## 收敛 verdict

| | Count |
|---|---|
| ✅ 接受 | 12 |
| ⚠️ 部分接受 | 5 |
| 🚫 反驳 | 1 (cross m2 starvation) |
| 🟡 用户决定 | 0 |

**收敛**——v0.2 修订全部 ✅ + ⚠️ 项，反驳的写进 ADR 理由库。

## 反驳条理由（防止后人翻案）

**cross m2 反驳**：starvation problem 假设并发 worker fleet 同时抢任务才会形成。Phase 0 是个人单用户 + 单 Claude session（虽然可开多 Cursor 窗口，但单一时刻只有一个 session 真在跑任务）。优先级 + size 升序排序在这个语境下是"先做 P0、小任务先闭环"的合理产品偏好。Phase 2 multi-agent 时再加 aging / fair-share。

**arch F1 mandatory `bl-` 前缀反驳**：`bl-testflight-encryption-compliance` 比 `testflight-encryption-compliance` 多 3 字符、可读性下降。真正的契约护栏是 `harness_issue_id` 字段 + I7 invariant，prefix 是冗余约束。

**arch F3 out-of-repo 反驳**：把 BACKLOG 移到 `~/.vessel/backlog.yaml` 解决了 branch protection 冲突，但引入了"新 session 怎么知道路径"问题——CLAUDE.md 里写约定一样不可靠。换问题不解问题。Stay in-repo + smart commit。

**arch F7 5x cold-boot gate 反驳**：Phase 0 没有合适的自动化 cold-boot 仪器；让用户手动跑 5 次 + 收集命中率，过度工程。Fallback 短语 `/boot` 是更便宜的 mitigation。

---

## 下一步

1. 写 v0.2 proposal（覆盖 v0.1）—— Claude 现做
2. 写 ADR-019 (Vessel-namespace) for Steward V0 contract lock
3. 设计 dogfood gate 验证脚本（contract mode 要求）—— 或显式 defer 到实施时
4. 收敛 → 交用户审最终版
