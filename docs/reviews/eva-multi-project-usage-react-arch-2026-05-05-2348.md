# Phase 2 React — Architecture lens

**Reviewer**: harness-architecture-review
**Model**: claude-opus-4-7
**Date**: 2026-05-05 23:48
**Phase**: 2 (cross-pollinate)
**Read**: own round 1 arch verdict + sibling round 1 cross verdict + proposal v0.1
**Not read**: author transcript / phase 3 author counter / 4 档分类草案

## 对 sibling (cross) 每条 finding 的逐条表态

### Sibling-B1 [BLOCKER] `domain_profile` 不是纯 additive，因为还要扩 `methodology.applies_to` CHECK enum — **agree**

**对方原文摘要**：proposal 把 P0-4 描述成 `harness_project` 加列 additive minor bump，但同一条又要扩 `methodology.applies_to` CHECK enum；SQLite CHECK 不能 ALTER 修改，必须 schema-rebuild 但 proposal 没写迁移模式 / 数据保留 / 回滚路径。

**我的表态**：agree

**理由**：
- 我 round 1 四维段 §架构可行性 §2 命中相同事实（"CHECK constraint 修改在 SQLite 必须走 schema-rebuild mode"），并已经在"建议下一版改动 §3"提议拆 0004 / 0005 两个 migration。但**我 round 1 把它放在四维段而不是 BLOCKER**——sibling 把它升级到 BLOCKER 是对的：
  - 一旦 0004 minor bump 跑过 ship，HARNESS_SCHEMA_VERSION 单调升（K7 不变量）被破坏后回滚 = 反向 schema-rebuild migration，**事实上不可逆**
  - learnings.md 第 1 条明说"M0 必须先固定 schema version + fallback 行为"，这条本质上违背了那条经验
- sibling 修复路径"P0-4 拆两部分 + 必须使用 MIGRATION_MODE=schema-rebuild + 写出保留 methodology rows 的迁移步骤和测试"完全可执行
- 自我修正：我会在自我修正段把这条升级为我自己的 **BLOCKER-3**

---

### Sibling-B2 [BLOCKER] `domain_profile` 缺少跨端契约：SQLite 字段 / iOS picker / 项目注册表之间没有数据流 — **agree（吸收为我 BLOCKER-4）**

**对方原文摘要**：proposal 在 `harness_project` 加 `domain_profile`，又要求 iOS picker，但没定义 `ProjectsAPI` / `ProjectDTO` / `projects.json` / Swift Codable 如何承载。当前 server-side `projects.json` 是 iOS canonical project registry，**不是 `harness_project`**——结果 iOS UI 显示设置成功、Scheduler / PM agent 实际读不到的 split-brain。

**我的表态**：agree（**完整盲区，sibling 揭示了我没看到的层级**）

**理由**：
- 我 round 1 完全没看到 `projects.json` 与 `harness_project` 是两个独立 store 这个事实——CLAUDE.md 明确写"`~/.claude-web/projects.json` 是 cross-device project registry，是 iOS canonical project registry"，而 `harness_project` 是 harness.db 里的 backend metadata。两者**没有自动同步**机制（M-1/M0 没 ship 同步）
- sibling 给的修复路径（`ProjectDTO.domainProfile?: DomainProfile` 或独立 harness project config API 二选一 + Swift Codable + TS Zod + fixture round-trip + unknown enum 行为）正好对接 K4 thin shell 假设
- 我 round 1 §风险遗漏 §2 只提到"老 iOS 装包 POST `/api/projects` 时不传 domain_profile 会被 default 兜"——但**那是 default 兜底问题，不是数据流缺失问题**。两个问题正交。sibling B2 是更根因的盲区
- 自我修正：吸收为我自己的 **BLOCKER-4**，与 m2 (default 不该是 software-enterprise) 合并讨论时分两层处理：(a) 数据流契约（B2，必须先定）→ (b) default 行为（m2，定 NOT NULL 不带 default）

---

### Sibling-M1 [MAJOR] P0-1 默认 env 白名单与 D1 推荐白名单互相矛盾 — **refine**

**对方原文摘要**：P0-1 默认含 `CLAUDE_CONFIG_DIR`、D1 推荐 B 含 `USER/SHELL/TERM/NVM_DIR/PNPM_HOME`，两套清单不一致；这是用户要拍板的关键安全默认值。修复 = 合并唯一推荐白名单 + 明确三类变量。

**我的表态**：refine（**同意核心，但建议升级级别 + 加正向回归退出条件**）

**理由**：
- 我 round 1 把这条列为 **BLOCKER-1** 而非 MAJOR。sibling 降级我倾向反驳：
  - 不是仅仅"实现者不知道哪个列表是合同"的文档问题，**而是缺 NVM_DIR / PNPM_HOME 会让所有 implement stage 全挂**（spawn 的 claude CLI 跑 `pnpm install` / `node` / `tsx` 找不到 PNPM_HOME → fallback 到全局 install → 用户 Mac 没全局装这些 → ENOENT 退化）
  - cli-runner.ts L77-81 是所有 agent spawn 的单点（K5），改这一行的回归面是"所有现存 dogfood Run"
  - 不可逆度比 sibling 评估的高：一旦上线挂掉，回滚 = 改一行 + **重跑所有挂掉的 stage**，不是一键
- **新建议**（refine 部分）：
  1. **升级到 BLOCKER 级**（与 sibling B1 / B2 同级），因为缺 NVM_DIR / PNPM_HOME 直接 break implement stage
  2. 退出条件加 sibling 没提的"对最近 30 天 dogfood Run（git log + harness audit）的命令做 dry-run 回放，env 白名单后无 ENOENT / command not found 退化"——这是正向通路验证，不能只测 `OPENAI_API_KEY=fake-leak-canary` 不可见这种反向通路
  3. sibling 提的"三类变量分类"（必须给 CLI 运行的 / 给 dev tooling 的 / 明确禁止的）应当落到 D1 表头，且与 m2 sibling-finding 相关：`software-enterprise` / `software-cli` / `software-library` 不同 domain_profile 的最小 dev tooling 白名单可能不同（`infra-script` 不需要 NVM_DIR），但 v1 不分维度即可

---

### Sibling-M2 [MAJOR] `injectEnv` 没有限制可覆盖 key，可能把 env 白名单绕回去 — **agree（吸收为我 new-finding MAJOR）**

**对方原文摘要**：proposal 允许 `injectEnv?: Record<string, string>` 和 `.env.harness` 注入，但没规定不能覆盖 `PATH/HOME/BASH_ENV/ENV/SHELLOPTS/CDPATH` 等敏感变量。无限制注入 = P0-1 减少 ambient credential / shell injection 风险的目标白做。`WORKTREE_LOCK.md` 已明确 strip 这些 shell 注入变量。

**我的表态**：agree（**完整盲区**）

**理由**：
- 我 round 1 完全没思考 `injectEnv` 反向打洞这个角度——只覆盖了 inheritEnv 的具体清单（NVM_DIR / PNPM_HOME / CLAUDE_CONFIG_DIR）+ ContextManager NEVER_ALLOWED 同源原则
- sibling 引用 `WORKTREE_LOCK.md` curated env 已 strip 这些 shell startup 变量是关键证据——P0-1 与 H13 hook env 白名单原则不一致 = 同一不变量两套实现，明显反对称
- sibling 修复路径"定义 `injectEnv` denylist 或 allowlist；默认禁止覆盖运行时关键变量和 shell startup 变量；需要 override `PATH/HOME/CLAUDE_CONFIG_DIR` 时必须显式配置并有测试"完全可执行
- 自我修正：吸收为我自己的 **new-finding MAJOR**，并在自我修正段把它和 BLOCKER-1（升级后的 sibling-M1）放一起讨论——因为 inheritEnv 白名单 + injectEnv denylist 是同一安全模型的两个对称面

---

### Sibling-M3 [MAJOR] `prod-guard.mjs` 的 regex 黑名单只讨论误伤，没覆盖明显绕过路径 — **refine**

**对方原文摘要**：proposal 只把 `pnpm db:migrate:dev` 误伤列为 OQ，没处理 false negative：shell alias / package script 间接调用 / `env AWS_PROFILE=prod aws ...` / 换行拼接 / `npx` 包装命令等。最小版要规范化 Bash tool input、token-level 检测、覆盖直接命令和常见 wrapper、对 `pnpm/npm/yarn run <script>` 至少标需要人工确认。

**我的表态**：refine（**同意核心，但补一条 DRY 约束**）

**理由**：
- 我 round 1 四维 §架构可行性 §1 命中相同问题角度（"regex over command string 容易被 here-doc / 变量插值绕开 `CMD="aws s3 rm"; $CMD ...`"，建议在 cli-runner 拦的 argv 层做检查），且 BLOCKER-2 也部分覆盖（fail-open 语义未定义）
- sibling 的 wrapper 角度（`npx` / `env AWS_PROFILE=prod aws ...` / package script 间接调用）比我更全，**完全应当吸收**
- **新建议**（refine 部分）：
  - **prod-guard 黑名单与 context-manager.ts L86-94 NEVER_ALLOWED 必须同源**（共享一个常量文件，例如 `packages/backend/src/shared/never-allowed-commands.ts`），不能两份漂移。我 round 1 已提，sibling 没提；建议合并到 phase 3 必修
  - sibling 提的"对 `pnpm/npm/yarn run <script>` 标需要人工确认"应当通过 ResolveScript 解析 `package.json` 的 scripts 字段，把脚本展开后再走黑名单检查（不是只看 `pnpm run xxx` 这行字符串）
  - 我 BLOCKER-2 关心的"fail-closed 语义"与 sibling M3 关心的"绕过路径"是同一问题的两个层级，**两条应当合并到 phase 3 一个 BLOCKER**：先定 fail-closed + chain-call 顺序（BLOCKER-2 我 round 1）→ 再定 token-level 检测 + 同源 NEVER_ALLOWED + wrapper 解析（M3 sibling）

---

### Sibling-M4 [MAJOR] P1-4 skill `appliesTo` 依赖未确认的 CLI 激活机制 — **agree**

**对方原文摘要**：proposal 自己承认不知道 Claude CLI skills 是内部 glob 读取还是可被 cli-runner 拦截，但 P1-4 已经写成"第一周必须补"。如果 CLI 内部直接读 `~/.claude/skills`，frontmatter 加 `appliesTo` 不会生效。修复 = 降级成 spike，确认可控后再进 P1，否则改成 symlink profile / 临时 skills dir / prompt-level 禁用声明三选一。

**我的表态**：agree

**理由**：
- 我 round 1 OQ1 强意见命中相同判断（"P1-4 不该 ship 直到 OQ1 落地"，理由"90% 概率不会，因为 SKILL.md schema 是 Anthropic 定义，appliesTo 不是其官方字段"）
- sibling 给的三选一替代路径（symlink profile / 临时 skills dir / prompt-level 禁用声明）比我提的"走 prompt 黑名单 / symlink swap 替代路径"更具体——尤其"临时 skills dir"是干净方案（spawn 时设 `CLAUDE_CONFIG_DIR` 指向 per-project 的 ephemeral skills 目录），不需要 hack
- 完全 agree，建议 phase 3 把 P1-4 改成 P1-spike：先 1 小时验证 CLI skill 激活机制（读源码 / strace / 新建带 appliesTo 的 skill 测是否生效），spike 出结果再决定走哪条路径

---

### Sibling-m1 [MINOR] P0 阶段编号跳过 P0-3 — **agree**

**对方原文摘要**：P0 列表写"3 条"，编号是 P0-1 / P0-2 / P0-4，缺 P0-3 增加引用成本。修复 = 收敛后重编号 或 保留 "P0-3 removed" 占位并在目录处显式说明。

**我的表态**：agree

**理由**：
- 我 round 1 漏了这个引用一致性的小问题，sibling 命中是对的
- 倾向 sibling 提的第二种修复（保留 placeholder + 显式说明 "P0-3 removed: ContextManager projectId 过滤；事实推翻见 §5 末尾 ~~P0-3~~"），便于 audit trail 与外部 reviewer / 未来 author 反向追溯——重编号反而会让 §3 失败模式表 / §7.2 IDEAS 引用 / §10 phase 评审 skip 原因段都要同步改

---

### Sibling-m2 [MINOR] `dogfood-self` enum 存在但默认值是 `software-enterprise` — **agree**

**对方原文摘要**：enum 含 `dogfood-self`，但 default 是 `software-enterprise`，并说"让 dogfood Project 自动归类"。两说法冲突。修复 = 明确迁移时如何识别 Eva 自身项目：按 cwd / eva.json worktree / project id 手动 patch 为 dogfood-self。

**我的表态**：agree

**理由**：
- 我 round 1 OQ4 强意见命中（"single enum + NOT NULL 不允许 default"），且四维 §企业管理系统贴谱性 段也展开过同样判断（"default 'software-enterprise' 让 dogfood 期间 Eva 自己被分错类，PM agent 给 Eva 自己产的 spec 会按 OMS 词汇填字段"）
- sibling 修复路径（按 cwd / eva.json worktree / project id 手动 patch 为 dogfood-self）是迁移层的具体执行细节；我 round 1 是 schema 层的"NOT NULL 不带 DEFAULT 强制创建时显式选择"，**两个角度互补**：
  - schema 层（我）：未来新建 project 强制选；fail-loud 符合 ADR-0014
  - 迁移层（sibling）：现有 dogfood project（Eva 自己）一次性手动 patch
  - 合并后的退出条件：(a) 0004 migration 跑完后 SELECT 验证 Eva 自身 project（cwd = `~/Desktop/claude-web` 或 `~/Desktop/claude-web-jarvis`）的 domain_profile = 'dogfood-self'；(b) 新建 project 不传 domain_profile 时 INSERT fail 而非 default 兜
- 完全 agree

---

### Sibling-m3 [MINOR] P1-3 备份退出条件只验证文件存在，没有验证完整性 — **refine**

**对方原文摘要**：P1-3 退出条件"每天有 1 个 .db 文件"只能证明 job 跑了，不能证明备份可恢复。修复 = 加 `sqlite3 backup.db "PRAGMA integrity_check"` + 至少跑一次只读打开 + `PRAGMA foreign_key_check`。

**我的表态**：refine（**同意完整性验证，但建议合并备份覆盖范围扩展**）

**理由**：
- sibling 命中"完整性验证"角度，我 round 1 完全没想到——只想到"覆盖范围"角度（§风险遗漏 §1：备份漏了 artifacts/audit.jsonl/projects.json/telemetry.jsonl）
- 两个角度正交且都对，**应当合并而非二选一**：
  - 备份了不完整的文件 = 灾难时还是恢复失败
  - 备份了完整的 harness.db 但漏了 artifacts/ = 灾难时 ContextBundle.snapshot_path 全空
- **新建议**（refine 部分）：P1-3 退出条件改为三层
  1. **覆盖范围**：备份 `~/.claude-web/` 整目录（含 artifacts/ + audit.jsonl + projects.json + telemetry.jsonl + harness.db），不只 harness.db（吸收我 round 1）
  2. **完整性验证**：`sqlite3 backup.db "PRAGMA integrity_check"` + `PRAGMA foreign_key_check` 两条都通过（吸收 sibling）
  3. **可恢复性验证**：每月 1 号自动 dry-run 恢复演练（mv 主 db 到 .bak + 复制最新备份替代 + backend 启动健康检查 + 还原原 db），失败发 Telegram alert（这是我 round 1 提的"模拟主 db 损坏场景"的自动化版本）

---

## 我自己 round 1 arch verdict 的自我修正

### 升级（保持 BLOCKER 但修订理由）

**我 round 1 BLOCKER-2（P0-2 prod-guard.mjs 与 permission-hook.mjs 同链路冲突语义未定义）—— 保持 BLOCKER 级，但与 sibling M3 合并讨论**

- sibling M3 命中相同问题但角度不同（M3 关心绕过路径 / 我 BLOCKER-2 关心 fail-closed 与 fail-open 冲突语义）
- 两条应当在 phase 3 合并到一个 BLOCKER：先定 fail-closed + chain-call 顺序（BLOCKER-2）→ 再定 token-level 检测 + 同源 NEVER_ALLOWED + wrapper 解析（M3）
- 不撤回，不降级

### 升级（从我 round 1 四维段升为 BLOCKER）

**新增 BLOCKER-3（吸收 sibling B1）：P0-4 同时改 methodology.applies_to enum 是 schema-rebuild 不是 additive，必须拆 0004 + 0005**

- 我 round 1 把这条放在四维 §架构可行性 §2 + 建议下一版改动 §3——sibling 把它升级到 BLOCKER 是对的
- 失误点：低估了 K7 schema migration additive 不变量被破坏后的回滚成本（一旦 ship，HARNESS_SCHEMA_VERSION = 102 → 103 跑过去后回滚 = 反向 schema-rebuild migration，**事实上不可逆**）
- 反例：learnings.md 第 1 条"M0 必须先固定 schema version + fallback 行为"已明确警告同类问题，本应当被识别为 BLOCKER

### 新增（吸收 sibling B2，完整盲区）

**新增 BLOCKER-4（吸收 sibling B2）：P0-4 缺 projects.json ↔ harness_project 跨端契约**

- 我 round 1 完全没看到 `projects.json`（iOS canonical project registry）vs `harness_project`（backend metadata）是两个独立 store + 两者没有自动同步机制这个事实
- CLAUDE.md 明确写"`~/.claude-web/projects.json` 是 cross-device project registry"，sibling B2 引用同一证据
- 失误点：我 round 1 §风险遗漏 §2 只关心了"老 iOS 装包 POST `/api/projects` 时不传 domain_profile 会被 default 兜"这个 default 行为问题，**没看到根因是数据流契约缺失**——default 兜是 B2 split-brain 的一个症状
- 修复路径接受 sibling 提议，并在 phase 3 与我 round 1 §风险遗漏 §2 的"minClientVersion bump"合并

### 新增（吸收 sibling M2，完整盲区）

**新增 MAJOR new-finding（吸收 sibling M2）：injectEnv 缺 denylist 反向打洞**

- 我 round 1 完全没思考 `injectEnv?: Record<string, string>` 默认无限制 = P0-1 inheritEnv 白名单白做这个角度
- 失误点：只覆盖了 inheritEnv 的具体清单（NVM_DIR / PNPM_HOME / CLAUDE_CONFIG_DIR）+ ContextManager NEVER_ALLOWED 同源原则两个维度，没覆盖 inheritEnv ↔ injectEnv 的对称安全模型
- 修复路径接受 sibling 提议（denylist `PATH/HOME/BASH_ENV/ENV/SHELLOPTS/CDPATH` + 与 WORKTREE_LOCK.md H13 hook env strip 同源）

### 不撤回（保持 round 1 verdict）

- BLOCKER-1（P0-1 默认白名单 vs D1 选项 B 矛盾 + 缺 NVM_DIR/PNPM_HOME）：保持 BLOCKER 级，**反驳 sibling M1 的 MAJOR 降级**——理由见 Sibling-M1 表态段
- 四维 §架构可行性 §3（P1-2 iOS 改动被低估，破坏 K4 thin shell 假设）：sibling 完全没命中，保持
- 四维 §企业管理系统贴谱性（domain_profile 5 选按软件类型而非业务领域切，建议加 business_domain 第二层 或 让 PM agent prompt 把 business_domain 当 spec 强制 input 字段）：sibling 完全没命中这个垂直贴谱性维度，保持——这是我 round 1 与 sibling 的最大差异化价值
- §风险遗漏 §3（ServerChan / Telegram notification 格式破坏）：sibling 完全没命中，保持
- §风险遗漏 §4（.env.harness 备份缺失）：sibling 完全没命中，保持
- §风险遗漏 §5（F8 dogfood 改 Eva backend 改坏 harness 进程自身的实际触发面）：sibling 完全没命中，保持

---

## 新发现（new-finding）

对方角度让我看到的盲区，自己 round 1 没列的：

### NEW-1 [MAJOR] sibling B2 衍生：Swift Codable unknown enum 行为未定义

**Where**: P0-4 + K4 / K9 不变量

**Lens**: 跨端对齐 / 架构可行性

**Issue**: sibling B2 揭示 `projects.json` ↔ `harness_project` 数据流缺失后，进一步推论：即使补上 `ProjectDTO.domainProfile?: DomainProfile` 字段，**老 iOS 装包遇到 backend 推送的 unknown enum 值（如 `software-cli` / `infra-script`）时的 graceful fallback 行为也未定义**。

- 我 round 1 §风险遗漏 §2 提到"加 minClientVersion bump 字段"——但 minClientVersion bump 是**主动通知**（强制升级），不解决"用户拖延升级"的窗口期
- Swift Codable 默认对 unknown enum case 是 throw（`DecodingError.dataCorrupted`）——一旦 backend 返回 unknown enum 值，老 iOS 整个 ProjectDTO decode 失败 = **所有 project 列表显示空白**

**Suggested fix**:
1. Swift Codable 必须实现 `init(from:)` 自定义 decoding，unknown enum 值 fallback 到 `software-enterprise` 或新增的 `unknown` case（不 throw）
2. TS Zod schema 用 `z.enum([...]).catch('software-enterprise')` 同样 fallback
3. 退出条件加 fixture round-trip 测试：手动构造 `domainProfile: 'future-unknown-value'` 的 ProjectDTO → Swift / TS 都应当 decode 成功 + fallback 到 default

### NEW-2 [MINOR] sibling M3 衍生：prod-guard 黑名单单源真相文件位置未指定

**Where**: P0-2 + 我 round 1 提议的 "prod-guard 黑名单与 context-manager.ts L86-94 NEVER_ALLOWED 同源"

**Lens**: 简化

**Issue**: 我 round 1 提议两份黑名单同源，但**没指定单源真相文件应该放哪**。如果放在 backend 的 `packages/backend/src/shared/never-allowed-commands.ts`，prod-guard.mjs 是独立 hook 进程不能 import TS 文件——必须通过文件读取或 JSON。

**Suggested fix**: 单源真相文件用 `~/.claude-web/never-allowed-commands.json`（运行时配置，prod-guard.mjs 读，backend 启动时也读 + 注入到 ContextManager NEVER_ALLOWED）；或者 prod-guard.mjs 改成 backend 启动时 spawn 的子进程（共享 require cache，能 import TS）。**v0.2 必须给出文件位置 + 加载机制**。

---

## Phase 2 收敛信号

- **双向 agree 的 finding 数：6**（B1 / B2 / M2 / M4 / m1 / m2）
  - 这些可直接进 phase 3 accept
  - B1 / B2 是 sibling 升级我 round 1 没列 BLOCKER 的两条，author 应当在 phase 3 直接吸收为 BLOCKER
  - M2 是我完整盲区，author 应当在 phase 3 直接吸收为 MAJOR
  - M4 / m1 / m2 是我 round 1 已命中的一致 finding，phase 3 直接合并表述

- **双向 disagree 的 finding 数：0**
  - 没有需要 author 真仲裁的硬冲突
  - **但有 1 条级别分歧**：sibling-M1 我反驳降级，建议保留 BLOCKER 级——这条 author 在 phase 3 需要决定级别（接受我反驳 / 接受 sibling 降级 / 拆成两条）

- **单向 refine 的 finding 数：3**（M1 / M3 / m3）
  - M1：我反驳 sibling 降级 + 加正向回归退出条件
  - M3：同意 sibling + 补 DRY 同源 NEVER_ALLOWED 约束 + 与我 BLOCKER-2 合并
  - m3：同意 sibling + 合并我 round 1 的覆盖范围扩展 + 加可恢复性验证

- **新发现 new-finding 数：2**（NEW-1 Swift Codable unknown enum / NEW-2 prod-guard 黑名单单源真相文件位置）
  - 都是从 sibling 角度衍生出来的具体落地缺口，phase 3 author 决定接受度

**总结**：sibling 命中我 2 条完整盲区（B2 / M2）+ 1 条级别低估（B1，我 round 1 没列 BLOCKER）；我反驳 1 条 sibling 降级（M1）+ 保留 4 条 sibling 完全没覆盖的差异化 finding（iOS K4 thin shell / 企业管理系统贴谱性 / ServerChan format / .env.harness 备份 / F8 触发面）。两位 reviewer 视角互补 ≈ 60%，重叠 ≈ 40%，没有互捧也没有硬冲突，phase 2 信号质量良好。
