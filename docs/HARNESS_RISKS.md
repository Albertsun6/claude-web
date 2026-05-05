# Harness Risks — 风险清单与缓解

> **状态**：v0.1（2026-05-01，含外部 AI 评审第一轮反馈）。
>
> **导航**：[索引](HARNESS_INDEX.md) · [Architecture](HARNESS_ARCHITECTURE.md) · [Roadmap](HARNESS_ROADMAP.md)
>
> **同源**：本文是 [HARNESS_ROADMAP.md §7](HARNESS_ROADMAP.md) 的扩展版，按风险类别分组。

---

## 0. 总览

35 条风险（含 R8.3 拆 a/b 实际 36 条目），按主题分 8 组：
1. **Agent 行为** — agent 自由度过高、CLI 长链路稳定性、上下文失败、多 AI 分歧瘫痪
2. **流程与节奏** — 卡点过多、MVP 战线过长、奠基 ritual 不收敛、方法论无限拖延
3. **多 Agent 协作** — 资源争抢、Reviewer 被污染、集体盲区
4. **不可逆与生产** — 不可逆操作、dogfood 改坏自己
5. **演化与垂直** — 企业垂直贴谱、schema 演化失败
6. **运维** — 离线 fallback、成本失控/波动
7. **框架自身**（v0.2 2026-05-04 新增，Meta-Freeze P1-7）— 元工作螺旋、用户审批疲劳
8. **多项目使用**（v0.3 2026-05-05 新增，源自 [EVA_MULTI_PROJECT_USAGE.md v0.3](proposals/EVA_MULTI_PROJECT_USAGE.md)）— 凭据混杂、不可逆操作、方法论领域不贴（R8.3 拆 a 粗 enum + b 业务子领域 PM spec 缺失）、SQLite 并发、iOS 多项目混乱、备份缺失、skill 集体盲区跨项目、元数据归属、dogfood 自指、injectEnv 反向打洞、hook 链路冲突、Swift Codable unknown enum、M2 loop2+ 串行、ServerChan format 破坏、.env.harness 备份（**15 个主题，含 R8.3 拆 a/b 共 16 个条目**）

---

## 1. Agent 行为风险

### R1.1 Agent 自由度过高

**描述**：Coder 在 worktree 自由写代码可能 `rm -rf` / `git push -f` / 调危险命令。

**缓解**：
- toolAllowlist 限死（[HARNESS_AGENTS.md §6](HARNESS_AGENTS.md) 工具白名单）
- 写操作必走 PR；Reviewer 双重 gate（M2 risk-triggered / M3 全量）
- `git-guard.mjs` 禁 force push / `--no-verify`

### R1.2 CLI 子进程长链路稳定性

**描述**：一条全链路 spawn 8-10 个 claude 进程，cold start + 多轮可能被 stale-session / 超时打断。

**缓解**：
- 沿用现有 [packages/backend/src/cli-runner.ts:157-179](../packages/backend/src/cli-runner.ts#L157-L179) stale-session 重试
- Run 失败保留 transcript；Scheduler retry 一次后转 awaiting_review 等人

### R1.3 上下文管理失败导致 agent 撞墙

**描述**：ContextBundle 缺关键文件、agent 脑补乱写。

**缓解**：
- ContextBundle 必须显式列 artifactRefs
- Context Manager 单元测试覆盖典型 Stage 的输入边界
- agent 找不到所需上下文时**必须显式 fail 而非脑补**（methodology + system prompt 写明）

### R1.4 多 AI 分歧导致决策瘫痪

**描述**：两个 Reviewer 一直分歧 ≥ 2 分，Decision 队列堆积。

**缓解**：
- 分歧 ≥ 2 分一律升级人审 Decision，**不允许 agent 自动平均/投票**——独立判断的价值就在分歧本身
- Decision 支持 timeout 默认决策 + "本 Initiative 内同类决议自动沿用"
- iOS push 一键 approve

---

## 2. 流程与节奏风险

### R2.1 卡点过多负担过重

**描述**：每 Stage 都人审会让 dogfood 累；用户失去耐心切回手动模式。

**缓解**：
- Stage 重量分级（heavy / light / checklist），早期 strategy/compliance/observe 用 checklist
- Decision 支持 timeout 默认决策 + 同类决议沿用
- iOS push 一键 approve；30 秒内完成审批

### R2.2 MVP 战线过长

**描述**：10 Stage × N agent 容易做不完；卡在 M2 几个月。

**缓解**：
- M-1 范围 v4 收缩到 4 核心契约（窄腰）
- M1 不真跑 agent，用 stub 验证状态机骨架
- M2 才让真 agent 上；用例 #1 跑通即 ship，不追求全用例
- 每个 M 有 kill switch 可一键回滚

### R2.3 奠基 ritual 不收敛

**描述**：M-1 某契约连续多轮 ritual 三方过不了，无限期奠基。

**缓解**：
- M-1 范围已收缩（v4）
- 如果某契约连续 **3 轮 ritual** 仍无法三方通过，由用户拍板"暂用占位 + 标 TBD" 进 M0，进入对应 Stage 时再补——避免无限期奠基

### R2.4 方法论敲定无限拖延

**描述**：进 Stage 前 ritual 无限讨论方法论。

**缓解**：
- M-1 只敲两个（discovery + spec），其余进 Stage 时再敲
- 每次方法论讨论限 2 小时人时；超时由用户拍板暂用 v0.1

---

## 3. 多 Agent 协作风险

### R3.1 多 agent 资源争抢

**描述**：多个 agent 同时操作同一 cwd / sessionId / worktree / 端口 / 缓存文件互相污染。

**缓解**：
- [HARNESS_ROADMAP.md §0 #17 资源隔离原则](HARNESS_ROADMAP.md)
- `resource-lock.ts` 用 file-lock + DB 行锁双重防护
- 每 Issue 独立 worktree + 独立 sessionId 命名空间 + 独立临时目录
- 不同 agent profile 在 toolAllowlist 上互斥

### R3.2 Reviewer 被污染失独立性

**描述**：Reviewer 读了 Coder transcript / tool calls / 思考流后，会被 Coder 的判断带跑，失去独立验证价值。

**缓解**：
- [HARNESS_AGENTS.md §3.2 评审独立性约束](HARNESS_AGENTS.md)
- Reviewer 的 ContextBundle 严格只含 `spec.md + design_doc.md + patch + diff`
- **不读 Coder 的 transcript / tool calls / 思考流**
- Context Manager 强制 enforce；违反即 Run 失败
- 评分维度由 server-driven config 定义，Reviewer 不能自创维度

### R3.3 多模型集体盲区

**描述**：多 AI 评审默认全是 Claude 系列，对同类盲点会一致漏看（如对 Anthropic 风格的偏好、对特定 prompt 模式的过敏）。

**缓解**：
- [HARNESS_ROADMAP.md §0 #18 集体盲区防护](HARNESS_ROADMAP.md)
- 每个 Stage 至少有一个 reviewer 用**不同 prompt 视角**（如 ultrareview / 安全 / 性能 / 业务规则反推）
- M4 远期可选引入一个非 Claude 模型做 read-only 终审；个人自用不强制

---

## 4. 不可逆与生产风险

### R4.1 不可逆操作误触

**描述**：agent 误触发 DB migration / 真实三方 API / 部署 / 付费操作，造成不可恢复损失。

**缓解**：
- [HARNESS_ROADMAP.md §0 #16 不可逆操作沙箱](HARNESS_ROADMAP.md)
- agent 默认无生产凭据
- 任何 DB migration / 真实三方 API / 部署 / 付费操作必须满足：
  1. 显式 allowlist 命中
  2. dry-run 先跑且产 Artifact
  3. 强制人审 Decision
  4. 凭据走环境隔离（worktree 内独立 .env，不继承主进程）
- `prod-guard.mjs` 守第二道

### R4.2 dogfood 改坏自己

**描述**：harness 在 claude-web 自身上跑，改 backend 改坏 harness 进程；改 iOS 协议改坏 iOS。

**缓解**：
- Coder 强制 worktree（IDEAS.md P1）
- harness 自身 backend 进程不重启自身（worktree commit + 手动 release Stage 才合并 main）
- Releaser 对 claude-web 项目人审 release
- M2 准入条件强制 toy 企业后台仓库 dry-run（评审反馈：避免纯 dogfood 自指）

---

## 5. 演化与垂直风险

### R5.1 企业管理系统垂直不贴谱

**描述**：方法论模板太通用，企业后台特有的业务实体 / 权限矩阵 / 审批流 / 报表口径被吞掉。

**缓解**：
- M-1 spec 方法论企业字段为**必填段**（业务实体 / 权限矩阵 / 审批流 / 报表口径）
- M2 准入条件强制 toy 企业后台仓库 dry-run
- 每条 dogfood Issue 在 toy 仓库验证后回到 claude-web

### R5.2 schema 演化失败

**描述**：四端（SQLite / Artifact 文件 / Swift / TS Zod）不同步导致老 iOS 装包炸。

**缓解**：
- [HARNESS_DATA_MODEL.md §3 Schema 迁移策略](HARNESS_DATA_MODEL.md)
- ADR-0015
- Schema 加 `version`，老版本 + 兼容窗口 1 个 minor
- iOS 自带 fallback config + minClientVersion 检测
- CI 强制 fixtures round-trip（TS encode → Swift decode → Swift encode → TS decode 不丢字段）

### R5.3 进化体系反向恶化

**描述**：把错误的 pattern 提炼成 skill → agent 后续都犯同样错；把噪音 retrospective 喂回 methodology → 方法论越来越乱。

**缓解**：
- 每个 skill 提炼必须人审 + 双 reviewer 通过
- methodology 升级走完整 ritual gate
- skills 库定期 audit，N 个月未触发的 skill 自动归档（不删，移到 `_archive/`）
- `HARNESS_EVOLUTION_FROZEN=1` 环境变量冻结所有方法论 / skill 升级，只读模式跑 harness

---

## 6. 运维风险

### R6.1 iOS thin shell 协议演化

**描述**：协议 schema 加新字段，老 iOS 装包看不到导致界面崩。

**缓解**：
- schema 字段 additive
- 加 `minClientVersion`
- iOS 自带 fallback config（M0 强制要求）

### R6.2 Mac 离线手机不可用

**描述**：用户 Mac 关机 / Tailscale 断 / 网络抖动，iOS 完全没法用。

**缓解**：
- iOS fallback config **仅保老聊天功能**（用户敲定）
- Board / Decision 在离线时显示"未连接 Mac"占位 + 一键重试
- 不支持离线创建 / 离线审批（避免冲突解决复杂度）

### R6.3 成本波动剧烈

**描述**：Opus 默认 + 双 reviewer + 多 Stage 让单 Issue 成本无法预估，硬阈值会误杀任务。

**缓解**：
- v4 改 Coder **复杂度自适应**（不再无脑 Opus）
- 双 reviewer **risk-triggered**（M2 仅 high-risk）
- cost 仅观察落库不设硬上限（M2）
- M3 起 A1 自动选择 + 月度 cost 报表 + 超预期触发方法论调整 ritual
- reviewer 用 Opus 但 prompt 极短（结构化打分 + 摘要式 notes）

### R6.4 成本失控

**描述**：单 Issue cost 远超预期。

**缓解**：
- 每条 Run 落 cost
- Retrospective 强制汇总
- 超预算 30% 触发方法论调整 ritual

---

## 7. 框架自身风险（v0.2 2026-05-04 新增，Meta-Freeze P1-7）

### R7.1 元工作螺旋

**描述**：framework-of-framework 膨胀。评审 mechanism / ADR / proposal / methodology / harness landscape 这些"框架的框架"在反复改进，比真业务工作量大得多（debate-review → harness-review-workflow → reviewer-cross → cursor-agent 异质对 → review-mechanism v2 五代演化）。

**信号**：
- harness 文档 + reviews 行数 / harness 真实代码行数 ≥ 4
- 每个里程碑期间新增 framework 文档数 > 真业务功能数
- 单条小改（≤50 行 diff）的 review 产物 > 1 个

**缓解**（[HARNESS_ROADMAP.md §0 #21](HARNESS_ROADMAP.md)）：
- 默认开 `HARNESS_EVOLUTION_FROZEN=1`（自律性约束，参见 [docs/STORE_MAP.md §5](STORE_MAP.md)）
- 冻结期内不写新 ADR / proposal / methodology / framework 升级；启动批豁免
- 解冻条件硬卡：M1 跑出 ≥1 个真 dogfood Issue（不靠主观判断）
- 冻结期方法论缺陷登记到 `telemetry.jsonl` event=`methodology.debt`，**不新增 store**

### R7.2 用户审批疲劳

**描述**：plan §0 #14 强调"30 秒入口"保护输入侧低门槛，但**输出侧（评审 / 决策 / arbitration / phase 3 author）耗时无上限**。R1.4 多 AI 分歧是技术原因；用户主动跳过 ritual（M0-C 跳评审 / v0.5 PARALLEL "先评审再决策"纠正）是另一种瘫痪，但更隐蔽。

**信号**：
- 用户主动跳过自己定的 ritual ≥1 次
- Decision queue 堆积主因是"用户没看"而非"reviewer 真分歧"
- 用户对评审产物的 acceptance time 持续增长

**缓解**（[HARNESS_ROADMAP.md §0 #22](HARNESS_ROADMAP.md)）：
- fast-path 分级（[harness-review-workflow SKILL.md fast-path 表](../.claude/skills/harness-review-workflow/SKILL.md)）：≤50 行 / 治理 / 文档 类不必走完整三层
- Decision timeout 默认决策 + 同类决议沿用（参见 R1.4 / R2.1 缓解）
- **用户跳过 ritual 不视为失败而是信号**——记录到 telemetry，触发 R7.1 缓解

---

## 8. 多项目使用风险（v0.3 新增，M2+ 落地多项目时触发）

> **来源**：[EVA_MULTI_PROJECT_USAGE.md v0.3](proposals/EVA_MULTI_PROJECT_USAGE.md) §7.1 经 phase 1+2+3 评审收敛 + 用户拍板（2026-05-05）。
>
> **触发条件**：用户从 dogfood 单 Subject（Eva 自己）走到多 Subject（用 Eva 开发自己的工程项目）的相变。M2 master plan loop1 已 ship，loop2+ 期间是这些风险首次暴露的窗口。

### R8.1 凭据混杂（cli-runner 默认全继承 env）

**描述**：`cli-runner.ts` spawn 子进程时默认 `env: process.env`（[L80](../packages/backend/src/cli-runner.ts#L80) 事实证据），意味着 backend 主进程的所有敏感凭据（OPENAI_API_KEY / STRIPE_KEY / SERVERCHAN_KEY / TG token）会泄到 spawn 出来的 claude CLI 子进程，进而泄到 agent 跑的 `npm test` 等命令。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 P0-1 BLOCKER](proposals/EVA_MULTI_PROJECT_USAGE.md)
- AgentProfile 加 `inheritEnv: string[]` 白名单（默认 `['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_*', 'TERM', 'TMPDIR', 'NVM_DIR', 'PNPM_HOME', 'CLAUDE_CONFIG_DIR']`，与 [WORKTREE_LOCK.md L41](../WORKTREE_LOCK.md) H13 hook env strip 同源）
- 退出条件三层：negative canary + 30 天 dogfood Run 命令 dry-run 无 ENOENT + InjectEnv denylist 单元测试

### R8.2 不可逆操作误触

**描述**：agent 误触发 DB migration / 真实三方 API / 部署 / 付费操作。本风险是 R4.1 在多项目场景的扩展——dogfood 期间 agent 工具白名单较窄，多项目期间会跑各种工程项目的 deploy 命令，攻击面扩大。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 P0-2 BLOCKER](proposals/EVA_MULTI_PROJECT_USAGE.md)
- prod-guard.mjs 实施前必须做 1 天 spike 验证 hook deny 优先级（详见 R8.11）
- 黑名单单源真相 = `~/.claude-web/never-allowed-commands.json`（与 [context-manager.ts NEVER_ALLOWED](../packages/backend/src/context-manager.ts#L86-L94) 同源）
- Token-level 检测（用 shell-quote 包，纯 JS）+ wrapper 解析（`pnpm/npm/yarn run <script>` 必须 ResolveScript）+ allowlist override（`~/.claude-web/prod-guard-allowlist.json`）

### R8.3a 方法论领域不贴谱（schema 层粗 enum）

**描述**：当前 [methodology.applies_to](../packages/backend/src/migrations/0001_initial.sql#L108) enum 只有 3 选 `('claude-web','enterprise-admin','universal')`，但工程项目可能是 library / cli / infra / 数据科学等领域，PM agent 套企业管理系统模板会产出大段 N/A 字段。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 P0-4a](proposals/EVA_MULTI_PROJECT_USAGE.md)
- harness_project 加 `domain_profile` 字段，5 选 enum：`software-enterprise / software-library / software-cli / infra-script / dogfood-self`
- 0004 additive migration（minor bump v103）+ 0005 schema-rebuild migration（major bump v200）改 methodology.applies_to enum 同步对齐

### R8.3b 业务子领域 PM spec 缺失

**描述**：即使 P0-4a 把 domain_profile 拆 5 选，订单 / CRM / 财务 / 库存 / HR 等业务子领域的 PM spec 必填段完全不同，但都归到 `software-enterprise` 一档。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 PRT + U1-A 用户拍板](proposals/EVA_MULTI_PROJECT_USAGE.md)
- 用户拍板：业务子领域**进 PM spec 必填字段，不进 schema**（避免提前固化未知分类）
- 3-5 个真实企业项目实践后再考虑升 schema enum

### R8.4 单 SQLite 单进程并发瓶颈

**描述**：better-sqlite3 同步 API + Scheduler 全局 setInterval，多 active project 并行时 SQLite 写锁竞争 + tick 抖动。dogfood 期间 1-2 active 不暴露，多项目时显著。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 P1-1](proposals/EVA_MULTI_PROJECT_USAGE.md)
- Scheduler tick 按 `task.cwd → project_id` 分桶，每桶独立 `maxConcurrentRuns`（default 2）
- 不引入 Redis / NATS / BullMQ（§0 #11）

### R8.5 iOS Inbox 多项目混乱（30 秒入口反成 30 秒困惑）

**描述**：iOS BackendClient 是 per-conversation 不是 per-project，多项目时 push 通知 / Inbox / Decision 都混在一起，用户看到通知 30 秒内分不清是哪个项目。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 P1-2](proposals/EVA_MULTI_PROJECT_USAGE.md)
- 拆两步：P1-2a 后端通知 title 加 `[<projectName>]` prefix（payload 保留结构化字段保护 webhook）+ P1-2b iOS UI 项目切换器 + Inbox 分组（破坏 K4 thin shell 假设的 ack）

### R8.6 harness.db 单文件损坏 = 元数据归零

**描述**：`~/.claude-web/harness.db` 是单 SQLite 文件，无任何备份机制。损坏 = 所有 project 的 Initiative / Stage / Run / Artifact / Retrospective 全丢。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 P1-3](proposals/EVA_MULTI_PROJECT_USAGE.md)
- 三层退出条件：覆盖范围（备份 `~/.claude-web/` 整目录含 artifacts / audit / projects.json / telemetry）+ 完整性（`PRAGMA integrity_check` + `foreign_key_check`）+ 可恢复性（每月 1 号自动 dry-run 恢复演练）
- `.env.harness` 不混入普通快照（避免明文密钥进备份，单走 P2-3）

### R8.7 skill 集体盲区跨项目放大

**描述**：`.claude/skills/*/SKILL.md` 全局激活，dogfood 提炼的 anti-pattern 会喂到非 dogfood Project 的 agent，跨领域时变成误导。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 P1-4-spike](proposals/EVA_MULTI_PROJECT_USAGE.md)
- 1 小时 spike 验证 CLI skill 激活机制是否能拦
- spike 失败时三选一替代：symlink profile / 临时 skills dir（推荐）/ prompt-level 禁用声明

### R8.8 元数据归属（参考性，**降为低风险**）

**描述**：所有 spec / decision / retrospective 押在 `~/.claude-web/harness.db`，工程项目 git 仓库失去"为什么这样设计"的脉络。

**缓解**：用户愿景"思想留 Eva"反对镜像，**降为 P3 可选**——仅当某 Subject 真的要交付 / 转手 / 归档时按需手动导出（不自动）

### R8.9 dogfood 自指风险触发面被低估（F8 升级）

**描述**：R4.2 是基线，R8.9 是其升级——P0-1 / P0-2 第一批改动正是 backend 自指（cli-runner.ts spawn / hook 链路），第一个用 jarvis 之外项目的 Run 大概率改 P0-1 / P0-2 自己的实现。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 MAJ-9](proposals/EVA_MULTI_PROJECT_USAGE.md)
- P0-1 / P0-2 加 dogfood smoke gate：(a) backend health check (b) 一次 harmless prompt (c) 一次 Bash deny (d) 一次允许普通 git diff

### R8.10 injectEnv 反向打洞，绕过 inheritEnv 白名单

**描述**：P0-1 加 inheritEnv 白名单后，如果 injectEnv 没限制可覆盖 key，能通过 `injectEnv: { PATH: '/malicious/...' }` 反向覆盖白名单变量，绕过整个安全模型。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 MAJ-1](proposals/EVA_MULTI_PROJECT_USAGE.md)
- injectEnv denylist `['PATH', 'HOME', 'BASH_ENV', 'ENV', 'SHELLOPTS', 'CDPATH', 'IFS', 'PS1', 'PS4']`
- 与 [WORKTREE_LOCK.md L41](../WORKTREE_LOCK.md) H13 hook env strip 同源
- 违反即拒（throw `InjectEnvDenied`）

### R8.11 hook 链路 fail-open / fail-closed 冲突语义未定义

**描述**：permission-hook 是 fail-open（CLAUDE.md 明文）；prod-guard 必须 fail-closed；同 PreToolUse 链路两 hook 一个 allow 一个 deny 时 Claude CLI 合并行为未明示。如果取宽松语义"先收到的 allow 优先" = prod-guard 形同虚设。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 P0-2-spike + U3-defer 用户拍板](proposals/EVA_MULTI_PROJECT_USAGE.md)
- P0-2 第一步必做 1 天 spike：跑一对冲突测试 `permission-hook(allow) + prod-guard(deny)`
- spike 失败 → 默认走 U3-B（permission-hook 内置黑名单，单进程 fail-closed）

### R8.12 Swift Codable 老 iOS 遇 unknown enum 整 DTO decode 失败

**描述**：Swift Codable 默认对 unknown enum case 抛 `DecodingError.dataCorrupted`。一旦 backend 返回新加的 enum 值（如 `software-cli`）老 iOS 装包 ProjectDTO 整体 decode 失败 = 所有 project 列表显示空白。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §6 K12](proposals/EVA_MULTI_PROJECT_USAGE.md)
- Swift Codable 必须实现 `init(from:)` 自定义 decoding，unknown enum 值 fallback 到 default（如 `'software-enterprise'`）
- TS Zod 用 `z.enum([...]).catch('software-enterprise')` 同样 fallback
- Fixture round-trip 测试加 `'future-unknown-value'` 反例，TS / Swift 都应当 decode 成功

### R8.13 M2 loop2+ 与 P0-1 / P0-2 同改 cli-runner.ts 段冲突

**描述**：cli-runner.ts L77-156 是所有 spawn 的单点（K5），P0-1 改 env / P0-2 加 hook chain / M2 loop 可能改 args。worktree 隔离只能隔离文件系统，不能消除同一核心路径的语义冲突。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §6 K10](proposals/EVA_MULTI_PROJECT_USAGE.md)
- K10 不变量：P0-1 / P0-2 与任何改 cli-runner.ts spawn / env / args / hook 链路的 M2 loop 必须**串行合并**（先 ship P0-1/P0-2 后 cherry-pick 到 loop branch）

### R8.14 ServerChan / Telegram notification format 破坏

**描述**：M0.5 已 ship 的 ServerChan + Telegram 推送字符串是 contract，下游有用户 webhook / TG 群解析。iOS push title 加 `[<projectName>]` 前缀同样会传到这两个 channel，可能破坏现有解析。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 MAJ-7](proposals/EVA_MULTI_PROJECT_USAGE.md)
- 通知 payload 保留结构化字段 `projectName / projectId`
- iOS lockscreen 显示 prefix
- ServerChan / Telegram 维持原 title 或追加末尾字段（不破坏现有外部 contract）

### R8.15 .env.harness 备份策略遗漏

**描述**：P2-3 引入 worktree 内独立 `.env.harness` 后，如果不专门处理，损坏 = 工程项目密钥永久丢失（用户对 git 不可见 = 自己也找不回）。简单混入 P1-3 普通备份会导致明文密钥进备份。

**缓解**：[EVA_MULTI_PROJECT_USAGE.md §5 P2-3 + MAJ-8](proposals/EVA_MULTI_PROJECT_USAGE.md)
- 不混入 P1-3 普通快照
- 三选一：加密备份（age / gpg）/ 显式排除用户自管 / 不备份接受丢失风险（在文档明确说明）

---

## 9. 风险按里程碑分布

| M | 主要风险 | 关键缓解 |
|---|---|---|
| M-1 | R2.3 奠基不收敛 | 4 契约窄腰；3 轮 ritual 上限 |
| M0 | R5.2 schema 演化、R6.1 协议演化 | minClientVersion + fallback |
| M1 | R1.3 上下文失败 | ContextBundle 单测；缺失即失败 |
| M2 | R3.1 资源争抢、R3.2 Reviewer 污染、R6.3 成本波动、R5.1 垂直不贴谱 | resource-lock；评审独立性；cost 观察阈值；toy 仓库 dry-run |
| M3 | R5.3 进化反向恶化、R3.3 集体盲区 | 多 AI 评审 + ritual gate；HARNESS_EVOLUTION_FROZEN |
| M4 | R5.3 持续 | audit 报表月度跑 |
| M4 远期 | R3.3 集体盲区（可选） | 引入非 Claude 终审；个人自用不强制 |
| **跨 M（贯穿）** | **R7.1 元工作螺旋、R7.2 用户审批疲劳** | **fast-path 分级 + HARNESS_EVOLUTION_FROZEN + telemetry methodology.debt** |
| **M2+ 多项目首发** | **R8.1-R8.15 多项目使用风险（15 主题 / 16 条目，含 R8.3 拆 a/b）** | **EVA_MULTI_PROJECT_USAGE v0.3 P0/P1/P2 落地 + K10/K11/K12 三条不变量** |

---

## 10. 维护规则

### 10.1 何时更新

- 新增风险（dogfood 暴露 / 评审反馈）→ 加到对应主题段
- 缓解策略升级 → 更新缓解段
- 风险消除 → 标 ✅ deprecated（不删）

### 10.2 与其他文档同步

- 每条风险必须对应 [HARNESS_ROADMAP.md §0](HARNESS_ROADMAP.md) 的某条原则
- 缓解涉及代码模块的，必须在 [HARNESS_ARCHITECTURE.md](HARNESS_ARCHITECTURE.md) 的 L7 横切段提及
