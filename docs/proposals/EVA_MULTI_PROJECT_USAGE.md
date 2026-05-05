# Eva 多项目使用与短期调整建议 — 调研报告 v0.3 (final)

> **Status**: ✅ **用户拍板收敛** · **Date**: 2026-05-05 · **Author**: Claude Sonnet 4.6
> **Review depth**: Phase 1+2+3 完整三相评审完成（[arch verdict](../reviews/eva-multi-project-usage-arch-2026-05-05-2342.md) + [cross verdict](../reviews/eva-multi-project-usage-cross-2026-05-05-2342.md) + [react-arch](../reviews/eva-multi-project-usage-react-arch-2026-05-05-2348.md) + [react-cross](../reviews/eva-multi-project-usage-react-cross-2026-05-05-2348.md) + [arbitration log](../reviews/eva-multi-project-usage-arbitration-2026-05-05.md)）
> **不可逆度**: **中-高** — P0-1 spawn env 改动是单点行为切换可一键回滚；P0-2 加 PreToolUse hook 进程可下线；**P0-4b methodology.applies_to schema-rebuild migration 不可逆（一旦 ship，回滚 = 反向 schema-rebuild）**；P0-4 跨端契约（ProjectDTO + Swift Codable + TS Zod）一旦 ship 进 iOS 装包对老客户端长期兼容
> **范围边界**：本 proposal 只覆盖**短期 / 即将做**的多项目使用 + 风险 + P0/P1/P2 调整。**长期"Eva 演化为私人贾维斯"愿景**走独立 proposal `EVA_AS_PERSONAL_JARVIS.md`（Phase D）。两份 proposal 必须分别评审分别收敛。
> **v0.1 → v0.2 收敛信号**：4 BLOCKER 全部接受（含 sibling 升级 2 + sibling 揭示完整盲区 2）+ 10 MAJOR + 1 partial + 3 MINOR + 0 反驳 + 3 用户决定（满足 ≤3 硬约束）。详见 [arbitration log](../reviews/eva-multi-project-usage-arbitration-2026-05-05.md)。
>
> **v0.2 → v0.3 用户拍板**（2026-05-05 23:58）：U1-A（5 选粗类型 + business_domain 进 PM spec）+ U2-C（software-enterprise + needs_user_review flag）+ U3-defer（等 spike 跑完看结果，默认 author 推荐 U3-B = permission-hook 内置黑名单）。3 个拍板与 author 推荐 / 默认一致，**不触发 round 2**。详见 §12 用户拍板记录。

---

## 0. Context

用户在 4 轮对话中提出 multi-stage 问题：

1. Eva 当前是 dogfood "对自己跑 harness"——以 Eva 自己为 L6 Subject Project（参见 [docs/HARNESS_ARCHITECTURE.md §L6](../HARNESS_ARCHITECTURE.md)）
2. 用户的真实工作目标：**M2-M4 把 harness 跑通后，用 Eva 来开发自己的工程项目**（订单系统 / CRM / 等企业管理系统）。这是从 dogfood 单 Subject 走到多 Subject 的相变
3. 这次相变的"独立性"是分层的：物理仓库独立 / 数据元数据耦合 / 运行时强依赖 / 方法论共享池 / 法律边界假设破裂
4. 用户后续追加：长期方向是**私人贾维斯**（"我的而不是别人的"），所以法律商业边界假设保留为"个人自用、永不分发"，对应 [docs/HARNESS_INDEX.md §跨文档关键约束 #5](../HARNESS_INDEX.md)

**用户拍板的硬约束（不再讨论）**：

- 并行进行：本 proposal 与 M2 loop2+ 同时推进（M2 loop1 已 ship dev `c4c08a6`，进入 loop1→loop2 空窗期）
- 不引入新基础组件：保留 [docs/HARNESS_ROADMAP.md §0 #11](../HARNESS_ROADMAP.md)
- 不调用 SDK：保留 §0 #2
- worktree 隔离：本 proposal 在 `~/Desktop/claude-web-jarvis` 独立 worktree 起草，与 M2 主工作树物理隔离

本 proposal 的目标：把"用 Eva 做工程项目"从模糊愿望落到**4 条 BLOCKER + 4 条 MAJOR P1 + 2 条 P2 的具体清单**，每条带事实证据 + spike 前置 + outcome-based 退出条件。

---

## 1. 业界 N 种典型架构（从轻到重）

| # | 架构 | 代表项目 | 隔离层 | 调度层 | 凭据建模 | Subject 形态 | 适合场景 |
|---|---|---|---|---|---|---|---|
| 1 | 单进程 + per-Subject worktree + cwd 隔离 | [Paseo](https://paseo.sh) / Eva 当前 | git worktree | 单进程 setInterval | 默认全继承 env | git 仓库 | 个人自用 1-3 active Subject |
| 2 | 单进程 + worktree + 显式凭据继承模型 | OpenHands [#13268](https://github.com/OpenHands/OpenHands/issues/13268) + [#13506](https://github.com/OpenHands/OpenHands/issues/13506) | Sandbox + worktree | SDK control plane | SaaS settings 继承显式建模 | git 仓库 | 个人/小团队 ≤5 Subject |
| 3 | Pod 容器隔离 + multi-repo fan-out | [Kelos](https://github.com/kelos-dev/kelos) | K8s Pod per agent run | Kubernetes-native | K8s Secret + ServiceAccount | git 仓库 + 多 LLM provider | 团队多 repo |
| 4 | 物理 VM 隔离 + 主子任务分层 | [Devin 2026 managed Devins](https://www.cognition-labs.com/blog/devin-can-now-manage-devins) | VM per child task | 主 Devin 调度子 Devin + ACU | VM 自带凭据 | 任意 | 商业 SaaS |
| 5 | 声明式 manifest + label-driven promotion | [harnext](https://www.flowhunt.io/harnext/) / [Lex](https://project-lex.co.uk/) | GitHub Actions runner | YAML 工作流 | Actions secrets | GitHub PR | 团队 CI |

**Eva 的位置**：第 1 档，紧贴 Paseo。**升级方向**：往第 2 档移动（保留单进程，但**显式凭据建模**），不抄第 3-5 档（违反 §0 #11）。

升级到第 2 档不是抄 OpenHands 实现，而是**抄"凭据继承显式建模"这个识别问题的角度**——这是 Eva 当前最薄弱的一环。

---

## 2. 共识规律（5 篇深读交叉验证）

| 共识 | 出处 | 在 Eva 的对应 |
|---|---|---|
| 项目身份必须是第一类公民 | Devin managed Devins / Kelos multi-repo fan-out | Eva 已有 `harness_project.id` 但 Inbox / Decision / Skills / iOS BackendClient 都没贯穿 |
| 凭据必须显式继承模型，默认全继承是 SDK 时代的反模式 | OpenHands #13268 | Eva [cli-runner.ts:80](../../packages/backend/src/cli-runner.ts#L80) 默认 `env: process.env`——典型反模式 |
| 不可逆操作必须有 sandbox 层 + audit log | OpenHands #13506 | Eva `prod-guard.mjs` 是路线图项，未实现 |
| 凭据 inheritance 与 injection 是同一安全模型的两面（白名单 + denylist 必须同步） | [WORKTREE_LOCK.md L41](../../WORKTREE_LOCK.md) H13 hook env 已 strip `BASH_ENV/ENV/SHELLOPTS/CDPATH` | Eva spawn env 设计若只做 inheritEnv 白名单不做 injectEnv denylist = 反向打洞 (phase 1 cross M2 命中) |
| 多 hook per matcher 时 deny 优先级合并语义需独立验证（Claude CLI 文档未明示）| 业界普遍未文档化 | Eva P0-2 prod-guard 与 permission-hook 同链路前必须 spike (phase 1 arch BLOCKER-2 命中) |
| 长期记忆比扩 context window 性价比高 90% 量级 | Mem0 benchmark 91% 延迟降 / 90% token 省 | 长期 proposal 范围 |
| 主子任务分层 + 子任务读全 trajectory 学习 | Devin reading full trajectories | 长期 proposal 范围 |

---

## 3. 失败模式清单（v0.2 扩到 15 个主题 / 16 个条目，含 F3 拆 a/b 业务子领域 + phase 2 揭示的 7 条新盲区）

| # | 失败模式 | 出处 / 事实证据 | 缓解（对应 §5 P0/P1/P2） |
|---|---|---|---|
| F1 | spawn 子进程默认全继承 env 且白名单缺 NVM_DIR/PNPM_HOME 会断 implement stage | [cli-runner.ts:80](../../packages/backend/src/cli-runner.ts#L80) `env: process.env`；缺 NVM_DIR → `pnpm install` ENOENT | **P0-1 BLOCKER**（v0.2 升级，原 v0.1 P0 级）|
| F2 | agent 误触不可逆操作 | OpenHands #13506；prod-guard.mjs 未上线 | **P0-2 BLOCKER**（v0.2 升级）|
| F3a | 方法论领域不贴谱 — schema 层粗 enum | [migrations/0001_initial.sql:108](../../packages/backend/src/migrations/0001_initial.sql#L108) methodology.applies_to enum 只 3 选 | **P0-4a**（粗 enum 5 选）|
| F3b | 方法论领域不贴谱 — 业务子领域 PM spec 缺失 | "订单系统" vs "CRM" spec 必填段完全不同，但都是 'software-enterprise' | **PRT (partial)**：business_domain 进 PM spec 必填字段（不进 schema，详见 U1）|
| F4 | 单 SQLite 单进程并发瓶颈 | better-sqlite3 + Scheduler 全局 setInterval | P1-1 |
| F5 | iOS Inbox 多 Subject 混乱 | iOS BackendClient per-conversation 不 per-project | P1-2 |
| F6 | harness.db 单文件损坏 = 元数据归零 | 当前无任何备份机制 | P1-3 |
| F7 | skill 全局激活，dogfood 提炼的 anti-pattern 喂到非 dogfood | `.claude/skills/*/SKILL.md` 无 appliesTo | **P1-4-spike** |
| F8 | dogfood 改 Eva backend 改坏 harness 进程自身（v0.2 触发面被低估升级） | [docs/HARNESS_RISKS.md](../HARNESS_RISKS.md) R4.2；P0-1/P0-2 第一批改动就是 backend 自指 | **MAJ-9**：dogfood smoke gate（backend health + harmless prompt + Bash deny + git diff 允许） |
| F9 | injectEnv 反向打洞，绕过 inheritEnv 白名单 | proposal 允许 `Record<string, string>` 但没规定不能覆盖 PATH/HOME/BASH_ENV/ENV/SHELLOPTS/CDPATH | **MAJ-1**：injectEnv denylist + 与 [WORKTREE_LOCK.md L41](../../WORKTREE_LOCK.md) H13 同源 |
| F10 | prod-guard vs permission-hook 同链路 fail-open / fail-closed 冲突 | permission-hook 是 fail-open（[CLAUDE.md](../../CLAUDE.md)）；prod-guard 必须 fail-closed；Claude CLI 多 hook 合并行为未明示 | **P0-2 内含 spike**（详见 §5 P0-2-spike + U3 fallback）|
| F11 | Swift Codable 老 iOS 遇 unknown enum throw → 整个 ProjectDTO decode 失败 = 所有 project 列表空白 | Swift Codable 默认对 unknown case 抛 `DecodingError.dataCorrupted` | **MAJ-6**：Swift `init(from:)` 自定义 + TS `z.enum().catch()` + fixture round-trip 加 `'future-unknown-value'` 反例 |
| F12 | M2 loop2+ 与 P0-1/P0-2 同改 cli-runner.ts 段冲突，worktree 隔离不能消除语义冲突 | cli-runner.ts L77-156 是 spawn 单点 (K5)，P0-1 改 env / M2 loop 可能改 args | **MAJ-10**：K10 不变量串行 ship |
| F13 | iOS push title 加 `[<projectName>]` 同时影响 ServerChan / Telegram 下游消费（webhook 解析破坏） | M0.5 已 ship 的 ServerChan + Telegram 推送字符串是 contract | **MAJ-7**：通知 payload 保留结构化字段；iOS lockscreen 显示 prefix；ServerChan/TG 维持原 title 或追加末尾字段 |
| F14 | .env.harness 备份策略遗漏，损坏 = 工程项目密钥永久丢失 | P2-3 引入 .env.harness 但 P1-3 备份不含；用户对 git 不可见 | **MAJ-8**：P2-3 设计加密备份或显式排除策略，不混入普通快照 |
| F15 | projects.json ↔ harness_project ↔ ProjectDTO 三方未定义同步规则 | [CLAUDE.md](../../CLAUDE.md) "projects.json 是 cross-device project registry"；harness_project 是 backend metadata；两者无自动同步 | **P0-4 BLK-4**：补完整跨端契约链 + minClientVersion |

**已修正的伪风险**（事实核对推翻）：

- ~~"ContextBundle 跨项目串导致 agent 误读别项目 spec"~~ — `artifact.stage_id NOT NULL REFERENCES stage(id)` + `stage.issue_id NOT NULL REFERENCES issue(id)` + `issue.project_id NOT NULL REFERENCES harness_project(id)` 的 FK 链严格隔离。`listArtifactsForIssue(db, input.issue.id)`（[context-manager.ts:204](../../packages/backend/src/context-manager.ts#L204)）已经间接 by-projectId
- ~~"商业项目用 AGPL 搬运代码触发 license 红线"~~ — 用户拍板"私人贾维斯，永不分发"，整条排除

---

## 4. 对接现有 harness 数据模型 / 代码

| 维度 | 状态 | 文件证据 |
|---|---|---|
| ✅ Project 已有 schema | `harness_project(id, cwd, name, default_branch, worktree_root, harness_enabled, created_at)` | [migrations/0001_initial.sql:18-26](../../packages/backend/src/migrations/0001_initial.sql#L18-L26) |
| ✅ FK 链严格按 projectId 隔离 | stage→issue→project_id NOT NULL REFERENCES 全链 | [migrations/0001_initial.sql:50-237](../../packages/backend/src/migrations/0001_initial.sql) |
| ✅ methodology 有 applies_to enum 雏形 | `applies_to TEXT NOT NULL CHECK (applies_to IN ('claude-web','enterprise-admin','universal'))` | [migrations/0001_initial.sql:108](../../packages/backend/src/migrations/0001_initial.sql#L108) |
| ✅ ContextManager fail-loud + budget pruning | mustHave 缺 throw、mayHave budget 削、prunedFiles 记录 | [context-manager.ts:124-198](../../packages/backend/src/context-manager.ts) |
| ✅ ContextManager NEVER_ALLOWED 黑名单已存在 | 7 条危险模式（rm/git clean/chmod/chown/find -delete/cd 出 cwd/.git 读写/范围外文件读写）| [context-manager.ts:86-94](../../packages/backend/src/context-manager.ts#L86-L94) |
| ✅ schema migration runner 支持 additive + schema-rebuild | schema_migrations 表 + transaction 包装 + MIGRATION_MODE | [harness-store.ts:108-200](../../packages/backend/src/harness-store.ts) |
| ✅ eva.json + worktree lifecycle hooks | H12 v1 + H13 v1 已 ship；H13 hook 用 curated env 白名单 | [eva.json](../../eva.json) + [WORKTREE_LOCK.md L41](../../WORKTREE_LOCK.md) |
| ✅ projects.json 已是 iOS canonical project registry | `~/.claude-web/projects.json` 由 [projects-store.ts](../../packages/backend/src/projects-store.ts) atomic-rename 写 | [CLAUDE.md](../../CLAUDE.md) |
| ✅ M2 loop1 已 ship，schema v102 | HARNESS_SCHEMA_VERSION = 102 | [harness-store.ts:31](../../packages/backend/src/harness-store.ts#L31) |
| ❌ cli-runner spawn env 白名单 | 当前 `env: process.env` 默认全继承 | [cli-runner.ts:77-81](../../packages/backend/src/cli-runner.ts#L77-L81) |
| ❌ inheritEnv ↔ injectEnv 对称安全模型 | 同一 H13 已 strip 的 shell 注入变量必须在 spawn env 也 strip | [WORKTREE_LOCK.md L41](../../WORKTREE_LOCK.md) |
| ❌ harness_project 缺 domain_profile 字段 | methodology.applies_to 概念已存在但 Project 层缺 | 同 schema |
| ❌ projects.json ↔ harness_project ↔ ProjectDTO 同步规则 | 两个独立 store 无自动同步机制 | — |
| ❌ Swift Codable / TS Zod unknown enum graceful fallback 行为 | [packages/shared/src/protocol.ts](../../packages/shared/src/protocol.ts) Zod schema 现有 enum 没 `.catch(default)`；Swift Codable 未实现自定义 decoding | — |
| ❌ prod-guard.mjs 未实现 | [docs/HARNESS_ROADMAP.md §0 #16](../HARNESS_ROADMAP.md) 计划项 | — |
| ❌ prod-guard 与 permission-hook 链路 deny 优先级合并语义未文档化 | Claude CLI hooks 文档对 multiple hooks per matcher 合并行为未明示 | — |
| ❌ Scheduler 全局单 tick，无 per-project 信号量 | [scheduler.ts](../../packages/backend/src/scheduler.ts) 全局 setInterval | — |
| ❌ iOS 数据模型 per-conversation 不 per-project | BackendClient `stateByConversation` | [BackendClient.swift](../../packages/ios-native/Sources/ClaudeWeb/BackendClient.swift) |
| ❌ harness.db 无备份机制（且只 .db 不够，需 ~/.claude-web/ 整目录 + 完整性 + 可恢复性三层）| launchd plist 无 backup job | [`~/Library/LaunchAgents/com.claude-web.backend.plist`](../../README.md) |
| ❌ skill frontmatter 无 appliesTo + CLI 激活机制未验证 | `.claude/skills/*/SKILL.md` 当前只有 name + description | — |

---

## 5. 推荐方案：分阶段渐进（4 BLOCKER P0 + 4 P1 + 1 P2，含 2 个 spike 前置）

每条带 **核心 + 不做 + 退出条件**，按 [docs/HARNESS_ROADMAP.md §0 #13](../HARNESS_ROADMAP.md) outcome-based 退出条件。

### 阶段 P0：开做工程项目之前必须落（4 BLOCKER）

#### P0-1 [BLOCKER] cli-runner spawn env 白名单 + injectEnv denylist 对称安全模型

**核心**：在 [cli-runner.ts:77-81](../../packages/backend/src/cli-runner.ts#L77-L81) 改 `env: process.env` 为 env 白名单 + denylist 双层防护：

- `AgentProfile` 加：
  ```ts
  inheritEnv: string[];          // 默认见下方"统一白名单"
  injectEnv?: Record<string, string>;
  inheritMode: "curated" | "full"; // 默认 curated
  ```
- **统一白名单**（合并原 §5 + §8 D1，删 v0.1 不一致）：
  ```ts
  ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_*', 'TERM', 'TMPDIR', 'NVM_DIR', 'PNPM_HOME', 'CLAUDE_CONFIG_DIR']
  ```
  - **对 v0.1 修订**：补 `NVM_DIR / PNPM_HOME / CLAUDE_CONFIG_DIR / USER / SHELL / TERM`，避免 spawn 出来的 claude CLI 跑 `pnpm install` / `node` / `tsx` 因 PNPM_HOME 缺失 fallback 到全局 install → ENOENT 退化（phase 1 arch BLOCKER-1 命中）
- **injectEnv denylist**（与 [WORKTREE_LOCK.md L41](../../WORKTREE_LOCK.md) H13 hook env strip 同源）：
  ```ts
  ['PATH', 'HOME', 'BASH_ENV', 'ENV', 'SHELLOPTS', 'CDPATH', 'IFS', 'PS1', 'PS4']
  ```
  违反即拒（throw `InjectEnvDenied`）
- `inheritMode = 'full'` 时降级为 `process.env`（一键回滚 escape hatch；必须本机 `.env.local` 显式配置 + 进 audit log）

**不做**：

- 不引入 Docker Sandbox（违反 §0 #11）
- 不抄 OpenHands SaaS-credentials-inheritance 完整实现
- 不强制注入 dummy env 防止 agent 探测——只默认拒绝 unsafe 凭据

**退出条件**（v0.2 升级三层）：

1. **Negative canary**：cli-runner.ts 测试覆盖 set `OPENAI_API_KEY=fake-leak-canary`，spawn 后子进程读不到此变量
2. **Positive regression**：对最近 30 天 dogfood Run（git log + harness audit）的命令做 dry-run 回放，env 白名单后无 ENOENT / command not found 退化（核心命令清单：`pnpm install / pnpm test / node / tsx / vitest / git diff / git log` 7 条全 spawn 成功）
3. **InjectEnv denylist** 单元测试覆盖 9 条 denylist 变量都被拒绝
4. **AgentProfile fixture** 更新所有现有 profile 加 `inheritEnv` + `inheritMode` 字段（M0 引入的 5 个 profile + M1 mini2 stage-aware 默认 profile）

#### P0-2 [BLOCKER] prod-guard.mjs + spike 前置 + token-level 检测 + 黑名单单源真相

**核心**：实现 [docs/HARNESS_ROADMAP.md §0 #16](../HARNESS_ROADMAP.md) `prod-guard.mjs`，但**第一步必须做 spike**（详见 P0-2-spike 段）。

**P0-2-spike（前置 1 天）**：跑一对冲突测试：`permission-hook(allow) + prod-guard(deny)` → 验证 Claude CLI 取**最严格语义**（任一 deny 即拒）。

- **spike 通过** → 维持双 hook 并行（prod-guard 先跑），按下面"主实施"段
- **spike 不通过** → 走 §8 U3 用户决定的 fallback 路径（推荐 U3-B：合并 prod-guard 检查到 permission-hook 内联）

**主实施**：

- **黑名单单源真相文件**：`~/.claude-web/never-allowed-commands.json`（运行时配置；prod-guard.mjs 读 + backend 启动时同步注入到 [context-manager.ts NEVER_ALLOWED](../../packages/backend/src/context-manager.ts#L86-L94)，避免两份漂移）
- 黑名单内容继承 ContextManager NEVER_ALLOWED 7 条 + 加：
  - `db:migrate` / `prisma migrate deploy` / `alembic upgrade head` / `flyway migrate`
  - `gh release create` / `gh release upload`
  - `aws ` / `gcloud ` / `kubectl apply` / `terraform apply`
  - `stripe ` / `paypal `
  - `git push --force` / `git push.*main` / `npm publish` / `pnpm publish`
  - 任何带 `--prod` / `--production` flag 的命令
- **Token-level 检测**：用 [`shell-quote`](https://www.npmjs.com/package/shell-quote) npm 包（纯 JS 不引入新组件）shell tokenize 后，argv[0] / argv[1] 完整词匹配（不是 substring，避免 here-doc / 变量插值绕过）
- **Wrapper 解析**：`pnpm/npm/yarn run <script>` 必须 ResolveScript 解析 package.json scripts 字段把脚本展开后再走黑名单检查
- **Allowlist override**：`~/.claude-web/prod-guard-allowlist.json`（运行时配置，只允许用户手动编辑或 UI 确认写入；每条 allow 记录 `{matcher, reason, createdAt}` 进 audit log）

**不做**：

- 不写复杂 policy DSL（Lex 风格 enforceable policies 个人自用过重）
- 不接 OPA / Rego / HashiCorp Sentinel
- 不把 allowlist 放项目内文件（避免恶意 / 误改 `.allowlist` 绕过安全门，必须放 `~/.claude-web/`）

**退出条件**：

1. **spike verdict** 落 `docs/reviews/p0-2-hook-deny-priority-spike-YYYY-MM-DD.md`，结果明确（通过 / 失败 → fallback 路径）
2. **绕开手法测试**：5-10 条业界已知绕开手法（`CMD="aws s3 rm"; $CMD` / here-doc / 别名 / `eval` / `bash -c -c` / `npx aws-cli` / 换行拼接 / `env AWS_PROFILE=prod aws ...` / `pnpm run my-deploy` 实际调 `kubectl apply`）全验拒
3. **历史 dry-run**：harness audit 最近 30 天 dogfood Run 命令对新 prod-guard 跑 dry-run，误伤率 < 5%；命中误伤的写进 allowlist
4. **Fail-closed 单元测试**：hook 进程异常退出 / 超时 / 网络 fail / panic 时整体行为 = deny
5. 至少 1 个 dogfood Run 实测：spawn agent 时 prompt 含 "请帮我跑 `gh release create v0.5.0`"，agent 调 Bash 时被 hook 拒绝并显示 deny 消息

#### P0-3（v0.1 删除项 placeholder）

~~P0-3 ContextManager projectId 过滤~~ — 事实推翻：[context-manager.ts L204](../../packages/backend/src/context-manager.ts#L204) `listArtifactsForIssue(db, input.issue.id)` 已通过 stage→issue→project_id FK 链严格隔离。详见 §3 已修正的伪风险段。

**编号保留 P0-3 placeholder** 不重排（便于 audit trail + 外部 reviewer 反向追溯）。

#### P0-4 [BLOCKER] harness_project domain_profile 字段 + 跨端契约（拆 P0-4a + P0-4b + 跨端契约段）

**P0-4a（additive minor bump，0004 migration）**：

- migration 文件 `0004_project_domain_profile.sql`，TARGET_VERSION = 103，MIGRATION_MODE = default
- `harness_project.domain_profile TEXT`（**nullable for migration 安全**，新建 API 强制必传）
- enum：`software-enterprise / software-library / software-cli / infra-script / dogfood-self`（v0.2 5 选不变；business_domain 走 PM spec 必填字段不进 schema，详见 §8 U1）
- migration 阶段 backfill 策略见 §8 U2 用户决定（author 推荐 U2-C：`software-enterprise` + `needs_user_review` flag）

**P0-4b（schema-rebuild major bump，0005 migration）**：

- migration 文件 `0005_methodology_applies_to_enum.sql`，TARGET_VERSION = 200（major bump，因为 schema-rebuild 不可逆）
- MIGRATION_MODE = schema-rebuild
- `methodology.applies_to` enum 从 `(claude-web, enterprise-admin, universal)` 改为 `(software-enterprise, software-library, software-cli, infra-script, dogfood-self, universal)` (与 P0-4a 对齐 + 保留 universal)
- 数据 copy（在 schema-rebuild transaction 内）：
  - `'claude-web'` → `'dogfood-self'`
  - `'enterprise-admin'` → `'software-enterprise'`
  - `'universal'` 不动
- migration 测试覆盖：(a) 28/28 现有 harness-store 测试仍绿；(b) 反例 — 注入一条 `applies_to='claude-web'` 的 methodology row 后 migration 跑通且数据被改成 `'dogfood-self'`；(c) rollback 路径（手工 schema-rebuild 反向）

**跨端契约段（吸收 BLK-4 + MAJ-6）**：

- `ProjectDTO.domainProfile?: DomainProfile` 加入 [packages/shared/src/protocol.ts](../../packages/shared/src/protocol.ts) Zod schema：
  ```ts
  export const DomainProfile = z.enum([
    'software-enterprise', 'software-library', 'software-cli',
    'infra-script', 'dogfood-self'
  ]).catch('software-enterprise');  // graceful fallback
  ```
- **Swift Codable 自定义 decoding**：[packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift](../../packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift) 实现 `init(from:)`，unknown enum 值 fallback 到 `.softwareEnterprise`（避免老 iOS 整个 ProjectDTO decode 失败 → 所有 project 列表空白）
- **TS Zod 同样 fallback**：用上述 `.catch('software-enterprise')`
- **Fixture round-trip 测试**：`packages/shared/fixtures/harness/project-with-future-unknown-domain.json` 含 `domainProfile: 'future-unknown-value'` → Swift / TS 都应当 decode 成功 + fallback
- **`projects.json` ↔ `harness_project` 同步规则**：
  - iOS POST `/api/projects` 时 backend 同步 INSERT 一行到 `harness_project`（cwd UNIQUE 已保证幂等）
  - 老 iOS 不传 domain_profile → backend log warning + INSERT 时 default `'software-enterprise'` 同时设 `needs_user_review = 1` flag (对应 §8 U2-C)
- **minClientVersion**：iOS server-driven config 加 `minClientVersionForDomainProfile: "vX.Y.Z"`，低版本看到 picker 但不能创建非 default project + 弹升级提示

**不做**：

- 不在 v0.2 加业务子领域 enum（订单/CRM/财务/库存/HR）—— 进 PM spec 必填字段，详见 §8 U1
- 不引入 schema 层 inheritance / mixin（M5+ 议题）
- 不强制立即 NOT NULL（migration 期 nullable，3-5 个非 dogfood project 落地后再升 NOT NULL）

**退出条件**：

1. 0004 + 0005 migration 跑通 + harness-store 测试 28/28 仍绿
2. methodology.applies_to enum 数据 copy 验证：注入 `claude-web` row → migration 跑完后是 `dogfood-self`
3. Fixture round-trip TS↔Swift 通过 + `'future-unknown-value'` fallback 通过
4. 至少 1 个非 dogfood Project 实测创建（如 `~/code/test-cli-tool` 用 `software-cli` profile）+ PM agent 跑 spec 阶段产出按对应模板（包含 business_domain 必填字段）
5. 老 iOS 装包测试：装老 build → POST `/api/projects` 不传 domain_profile → backend log warning + project 列表正常显示（fallback `'software-enterprise'`）+ `needs_user_review` flag 设置成功
6. 新 iOS 装包测试：装新 build → 必须选 picker 才能创建 project

### 阶段 P1：跑工程项目第一周必须补（4 条 + 2 个 spike）

#### P1-1 Scheduler per-project rate limit

**核心**：

- Scheduler [scheduler.ts](../../packages/backend/src/scheduler.ts) tick 时按 `task.cwd → project_id` 分桶
- 每桶有独立 `maxConcurrentRuns`（**default 2**，可在 server-driven config 覆盖）
- 全局上限保留，per-project 上限叠加

**不做**：

- 不引入 Redis / NATS / BullMQ（§0 #11）
- 不引入 priority queue（v1 FIFO 即可）
- 不引入跨 backend 进程的分布式锁

**退出条件**：

- scheduler 单元测试覆盖"3 个 active project 各 5 个 pending Run，并发 ≤ 6（=3×2）"
- 至少 1 个并发 dogfood + 非 dogfood Run 不互相饿死的实测

#### P1-2 拆两步：P1-2a 后端 push title prefix + P1-2b iOS UI 分组

**P1-2a（后端，无 iOS 改动）**：

- iOS push 通知 title 加 `[<projectName>]` 前缀（修改 backend 推送字符串）
- 通知 payload **保留结构化字段** `projectName / projectId`（保护 ServerChan / Telegram 下游 webhook 解析，详见 MAJ-7 / F13）
- ServerChan / Telegram 维持原 title 或追加末尾字段（**不破坏现有外部 contract**），只在 iOS lockscreen 显示 prefix
- server-driven `decisionForms[]` 增加 `applicableProjectIds: ['*']` 字段（默认通配）

**P1-2b（iOS UI，需要新 build）**：

- 顶栏增加项目切换器（沿用 [ProjectRegistry.swift](../../packages/ios-native/Sources/ClaudeWeb/ProjectRegistry.swift)），项目维度优先于对话维度
- iOS Inbox 按项目分组显示
- **承认破坏 K4 thin shell**（这是 SwiftUI 渲染逻辑改动，不是纯 server-driven）
- 需要 simulator + 真机验证（参考 ios-install + ios-sim-e2e skill）

**不做**：

- 不为 iOS 引入新 stateByProject 顶层（保留 BackendClient 现有 stateByConversation 模型，只在 UI 层做 group-by）
- 不动 iOS 协议 schema（向后兼容，老 iOS 装包看到 [<name>] prefix 仍能用）

**退出条件**：

- **依赖 P0-4 落地**（必须先有至少 1 个非 dogfood project 才能验"并行 active project"分组）
- P1-2a 后端单测覆盖：通知字符串带 `[<projectName>]` prefix + payload 含结构化 `projectName/projectId`
- P1-2a ServerChan / Telegram 兼容性测试：发一条带 prefix 的通知，外部 webhook 能识别新 payload schema
- P1-2b iOS 测试覆盖：切换项目时不丢失另一个项目的 pending Decision；至少 2 个 active project 时 iOS 看板能按项目分组显示

#### P1-3 harness.db 三层备份（覆盖范围 + 完整性 + 可恢复性）

**核心**：

- **覆盖范围**：launchd plist 加 daily job，备份 `~/.claude-web/` 整目录（含 `harness.db` + `artifacts/` + `harness-audit.jsonl` + `projects.json` + `telemetry.jsonl`），不只 .db
  ```bash
  rsync -a --delete ~/.claude-web/ ~/.claude-web/backups/$(date +%Y%m%d)/
  sqlite3 ~/.claude-web/backups/$(date +%Y%m%d)/harness.db ".backup ~/.claude-web/backups/$(date +%Y%m%d)/harness.db.snapshot"
  ```
- **完整性**：每天备份后跑 `sqlite3 backup.db.snapshot "PRAGMA integrity_check"` + `PRAGMA foreign_key_check`，两条都通过
- **可恢复性**：每月 1 号自动 dry-run 恢复演练（mv 主 db 到 .bak + 复制最新备份替代 + backend 启动健康检查 + 还原原 db），失败发 Telegram alert
- 保留 30 天 daily（每天清理 30+ 天前），月初 snapshot 永久留存

**不做**：

- 不引入 SQLite WAL 流式 replication（§0 #11 灰色地带）
- 不引入 PITR
- **不混入 `.env.harness`**（避免明文密钥进备份；走 P2-3 加密备份策略）
- 不上传到云

**退出条件**：

- launchd plist 在生产 Mac 跑通至少 7 天，每天有 1 个完整 backup 目录
- `PRAGMA integrity_check` + `PRAGMA foreign_key_check` 两条全过
- 每月 1 号恢复演练自动跑通（首次手动触发验证 launchd 配置正确）

#### P1-4-spike → P1-4 skill appliesTo

**P1-4-spike（前置 1 小时）**：

实测 `~/.claude/skills/<x>/SKILL.md` frontmatter 加 `appliesTo` 字段后，CLI 是否会读：

- 新建测试 skill `~/.claude/skills/test-applies-to/SKILL.md`，frontmatter 写：
  ```yaml
  appliesTo:
    domainProfiles: [non-existent-domain]
  ```
- 在不同 domainProfile 的 cwd 下触发该 skill 的 trigger phrase，看是否激活
- 同时跑 `strace` / `dtrace` 观察 CLI 是否真的读 frontmatter 字段

**spike 结果分支**：

- **CLI 读 frontmatter**（10% 概率）→ 走原 P1-4 设计：所有 skill 加 `appliesTo` frontmatter
- **CLI 不读 frontmatter**（90% 概率）→ 三选一替代路径：
  - **(a) Symlink profile**：per-project 切 `~/.claude/skills` 子目录（spawn 时用 symlink swap）
  - **(b) 临时 skills dir（推荐）**：spawn 时设 `CLAUDE_CONFIG_DIR` 指向 per-project ephemeral skills 目录（per-domain 装载不同 skill 子集）
  - **(c) Prompt-level 禁用声明**：system prompt 写"本 Subject 不要调 skill X"（最 hack，但兜底）

**核心 P1-4（spike 后实施）**：

- 至少 3 个核心 skill (`harness-architecture-review` / `harness-review-workflow` / `borrow-open-source`) 按 spike 结果加 appliesTo 配置
- 实施路径根据 spike 结果选定（不在 v0.2 预设）

**退出条件**：

- spike verdict 落 `docs/reviews/p1-4-skill-activation-spike-YYYY-MM-DD.md`
- 至少 3 个核心 skill 配置完成
- dogfood 实测：在非 dogfood Project Run 时这 3 个 skill 不被自动激活

### 阶段 P2：长期演进（1 条）

#### P2-3 Worktree spawn 完全独立 .env + .env.harness 加密备份策略

**核心**：

- P0-1 的强化版。每个 worktree 内放 `.env.harness`（gitignore），cli-runner spawn 时优先加载 `<cwd>/.env.harness` 注入子进程 env
- **加密备份策略**（吸收 MAJ-8）：
  - **不混入 P1-3 普通快照**（避免明文密钥进备份）
  - 三选一（P2-3 设计阶段决定）：
    - 加密备份（用 `age` / `gpg` 加密 .env.harness 后单独存）
    - 显式排除 + 用户手动备份（在文档明确说明 .env.harness 用户自管）
    - 不备份（接受丢失风险，工程项目密钥从源头取回）

**不做**：

- 不抄 [OpenHands SANDBOX_WORKING_DIR](https://github.com/OpenHands/OpenHands/pull/12660) 硬编码替换
- 不强制每个 Project 必须有 .env.harness（可选）

**退出条件**：

- 至少 1 个 worktree 实测：`.env.harness` 内 `STRIPE_TEST_KEY` 仅在该 worktree spawn 的 agent 内可见，其他 worktree 不可见
- 加密备份策略文档化（在 [docs/HARNESS_RISKS.md](../HARNESS_RISKS.md) §6 加 R6.x）

### 移到长期 proposal / 删除的项

- ~~P0-3 ContextManager projectId 过滤~~ — 事实推翻：FK 链已隔离（保留 placeholder 见 P0-3 段）
- ~~P0-5 元数据镜像到工程项目仓库~~ — 用户愿景修正"思想留 Eva"，**降为 P3 可选**：仅当某 Subject 真的要交付 / 转手 / 归档时按需手动导出
- ~~P2-1 商业项目模式~~ — 用户拍板"私人贾维斯永不分发"排除
- ~~P2-2 跨项目 trajectory learning~~ — 移到长期 proposal（贾维斯记忆层范围）

---

## 6. 关键不变量（v0.2 扩到 12 条）

| # | 不变量 | 防什么失败 |
|---|---|---|
| K1 | 不引入新基础组件（[§0 #11](../HARNESS_ROADMAP.md)） | Kelos K8s 路径过重；§4 拒绝 Redis/NATS |
| K2 | 不调 Anthropic SDK（[§0 #2](../HARNESS_ROADMAP.md)） | OpenHands 自建 runtime 路径 |
| K3 | 不引入 Docker / VM 隔离 | Devin VM 个人成本天文数字 |
| K4 | iOS thin shell + server-driven（[§0 #1](../HARNESS_ROADMAP.md)） | iOS 改一次锁死；P1-2b 是已知例外（必须 ack）|
| K5 | 所有 cli spawn 走 cli-runner.ts 单点 | 防 P0-1 凭据白名单被绕过 |
| K6 | 所有 unsafe 命令走 PreToolUse hook | 防 P0-2 prod-guard 被绕过 |
| K7 | schema migration additive 优先（PRAGMA user_version 单调升） | [docs/HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md) ADR-0015 |
| K8 | per-project rate limit 不引入分布式锁 | P1-1 个人自用单进程足够 |
| K9 | iOS 协议字段 additive + 加 minClientVersion | P1-2 老 iOS 装包看到不识别字段 graceful skip |
| **K10** | **P0-1 / P0-2 与任何改 [cli-runner.ts](../../packages/backend/src/cli-runner.ts) spawn / env / args / hook 链路的 M2 loop 必须串行合并**（先 ship P0-1/P0-2，后 cherry-pick 到 loop branch；不允许两 worktree 同改 cli-runner.ts L77-L156 段） | F12 worktree 隔离不能消除语义冲突 |
| **K11** | **所有备份必须 covered + integrity-checked + recoverable 三层；备份只 .db 不算** | F6 灾难恢复假阳性 |
| **K12** | **所有 Swift Codable enum 必须 graceful unknown-value fallback (init(from:) 自定义)；所有 TS Zod enum 用 `.catch(default)`；fixture round-trip 必含 future-unknown-value 反例** | F11 老 iOS 看 unknown enum 整 DTO decode 失败 |

---

## 7. 与现有 IDEAS / RISKS / ROADMAP 的合并建议

### 7.1 在 [docs/HARNESS_RISKS.md](../HARNESS_RISKS.md) 新增

加 §8 "多项目使用风险"组，含 **15 个主题 / 16 个条目**（v0.1 8 条扩到 v0.2 含 R8.3 拆 a/b）：

- R8.1 凭据混杂（cli-runner.ts:80 `env: process.env`）→ P0-1
- R8.2 不可逆操作误触 → P0-2
- R8.3a 方法论领域不贴谱（粗 enum）→ P0-4a
- R8.3b 业务子领域 PM spec 缺失 → PRT (PM spec 必填字段，待 U1)
- R8.4 单 SQLite 并发瓶颈 → P1-1
- R8.5 iOS 多项目混乱 → P1-2
- R8.6 harness.db 单文件 = 元数据归零 → P1-3 (三层)
- R8.7 skill 集体盲区跨项目放大 → P1-4-spike
- R8.8 元数据归属（参考性，**降为低风险**因用户愿景"思想留 Eva"）→ P3 可选
- **R8.9 dogfood 自指风险触发面被低估**（F8 升级）→ MAJ-9 dogfood smoke gate
- **R8.10 injectEnv 反向打洞**（F9）→ MAJ-1 denylist
- **R8.11 hook 链路 fail-open / fail-closed 冲突**（F10）→ P0-2-spike
- **R8.12 Swift Codable unknown enum 整 DTO 失败**（F11）→ K12 + MAJ-6
- **R8.13 M2 loop2+ 与 P0-1/P0-2 语义冲突**（F12）→ K10 串行
- **R8.14 ServerChan / Telegram format 破坏**（F13）→ MAJ-7
- **R8.15 .env.harness 备份策略遗漏**（F14）→ MAJ-8

### 7.2 在 [docs/IDEAS.md](../IDEAS.md) 新增

在 Borrow 池 H 段后新增 **H19-H26**（H18 已被 Provider Runtime Matrix 占用）：

- **H19** spawn env 白名单 + injectEnv denylist → P0-1（⭐⭐⭐ 必做）
- **H20** prod-guard.mjs + spike 前置 + 黑名单单源真相 → P0-2（⭐⭐⭐ 必做）
- **H21** harness_project domain_profile + projects.json 同步规则 → P0-4
- **H22** Scheduler per-project rate limit → P1-1
- **H23** iOS 项目维度抽象（拆 P1-2a + P1-2b）→ P1-2
- **H24** PreToolUse hook deny 优先级 spike → P0-2-spike（前置 1 天）
- **H25** Swift Codable / TS Zod 跨端 enum graceful fallback → K12
- **H26** harness.db 三层备份（覆盖范围 + 完整性 + 可恢复性）→ P1-3

### 7.3 在 [docs/HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md) 修订

- §0 #16 不可逆操作沙箱 段加注："P0-2 prod-guard.mjs 落地状态见 EVA_MULTI_PROJECT_USAGE proposal §5；spike 前置必做（F10 链路冲突）"
- §0 #17 资源隔离原则 段加注："P0-1 spawn env 白名单是该原则在凭据维度的具体落地；K10 串行约束扩展该原则到 cli-runner.ts 单点保护"
- §0 加新原则 #23：所有跨端 wire enum 必须有 graceful unknown-value fallback（K12）
- 不新增 M5+ 段（留给长期 proposal）

### 7.4 在 [docs/HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md) 修订

- §1.1 Project 段加 `domain_profile` 字段说明（含 backfill 策略 + needs_user_review flag）
- §1.6 Methodology 段更新 applies_to enum（5 + universal）
- §2 加新段 "Cross-end enum graceful fallback contract"（K12 标准）

---

## 8. 待用户拍板的决策（≤3 条，硬约束满足）

按 [`harness-review-workflow` SKILL.md](../../.claude/skills/harness-review-workflow/SKILL.md) L309-317 真正需要用户偏好的事项。

### U1: domain_profile enum 是否拆"粗类型 + 业务子领域"两层？

**背景**：MAJ-11 + PRT-1 + cross react NF2。`software-enterprise` 5 选粗按软件类型切，但企业管理系统真正区分维度是业务子领域（订单 / OMS / CRM / 财务 / 库存 / HR / 报表 / 审批流）。PM agent 给"订单系统"产 spec 和给"CRM"产 spec 的必填段完全不同。

| ID | 选项 | author 倾向 | 不可逆度 |
|---|---|---|---|
| U1-A | 仅保留 5 选粗类型；business_domain 进 PM spec 必填字段（不进 schema）。3-5 个企业项目实践后再考虑升 schema | **强推荐** | 低（可逆） |
| U1-B | schema 加第二层 `business_domain` enum（订单/CRM/财务/库存/HR/...）；同时进 0004 migration | 谨慎 | 高（enum ship 后难删） |
| U1-C | `domain_profile` 列改为 JSON object `{technical, businessDomain}` 二元组 | 不推荐 | 中（schema 不规范） |

**author 倾向 U1-A 理由**：当前没有 3-5 个真实企业项目作样本，强 enum = 提前固化未知分类；PM spec 必填字段比 schema enum 更灵活；cross react NF2 同思路。

### U2: legacy `harness_project` rows 的 domain_profile backfill 策略？

**背景**：MAJ-11 + arch react BLK-3 推论 + cross react refine OQ4。0004 migration 跑过来时已存在的 `harness_project` rows 没有 domain_profile 字段。

| ID | 选项 | 行为 | 影响 |
|---|---|---|---|
| U2-A | 按 cwd 命中手动 patch：`~/Desktop/claude-web*` → `dogfood-self`；其他 legacy → `unknown` 标待确认 | fail-loud（unknown 强制创建时弹 picker 改） | 用户每个老 project 第一次开时被打扰 1 次 |
| U2-B | 全 legacy → `software-enterprise`；新建强制选 | silent default | dogfood Eva 自身被分错类（Eva ≠ enterprise system） |
| U2-C | `software-enterprise` + 加 `needs_user_review` flag；下次开 project 时弹 picker 让用户改 | hybrid（先 default，再延迟交互） | **author 推荐** — 实施简单 + 用户可控 + 不打扰 |

**author 倾向 U2-C 理由**：与 cross react refine 思路一致；不阻塞工作流；iOS 顶栏可显示 badge 提示用户改。

### U3: P0-2 hook spike 失败时 fallback 路径？

**背景**：BLK-2 + cross react NF1。P0-2-spike 验证 hook deny 优先级，失败时怎么办？

| ID | 选项 | 实施成本 | 风险 |
|---|---|---|---|
| U3-A | 合并 prod-guard 进 permission-hook chain-call：prod-guard 检查在 permission-hook 内联第一步执行，命中 deny 直接短路 | 中（permission-hook 改造）| 低（单 hook 进程，行为可控）|
| U3-B | 不做 prod-guard 独立 hook，转用 permission-hook 内置黑名单（黑名单数据来自 `never-allowed-commands.json`）| 低（permission-hook 加配置文件读取）| **author 推荐** — 简单一致 |
| U3-C | 升级 Claude CLI 要求支持显式 deny 优先级 | 高（依赖 Anthropic）| 不现实 |

**author 倾向 U3-B 理由**：spike 失败已证明双 hook 并行不可控；permission-hook 已是 fail-open 但对黑名单匹配项可独立 fail-closed；不引入新 hook 进程 = 一致性最好；U3-A 与 U3-B 功能等价 U3-B 实施更简单。

---

## 9. 关键 Open Questions

留给 phase 1 reviewer 挑战的开放问题（v0.2 删除已升级为 spike 的 OQ1/OQ3/OQ4）：

- **OQ2**：P0-1 inheritEnv 白名单与 `--add-dir` / `--include-cwd` 这类 CLI 参数交互如何？是否 cli-runner 还需要传 `cwd` 之外的额外环境提示？
- **OQ5**：P1-1 per-project rate limit 上限 2 是否过低？（弱意见接受 v0.1 评估，M2/M3 实测后调）
- **OQ6**：P0-4b methodology.applies_to 老 row 数据 mapping 的边界 case：`'universal'` → `'universal'` 不动 vs unify with `'software-*'` 是否要二次审视？
- **OQ7**：P0-2 spike 1 天 vs 0.5 天的具体测试步数：5-10 条绕开手法是否能在 0.5 天跑完，还是必须 1 天？

---

## 10. Phase 2/3 评审 skip 原因（v0.2 已不 skip）

**v0.1 → v0.2 进度**：

- ✅ Phase 1 双独立评审完成（[arch verdict](../reviews/eva-multi-project-usage-arch-2026-05-05-2342.md) + [cross verdict](../reviews/eva-multi-project-usage-cross-2026-05-05-2342.md)）
- ✅ Phase 2 cross-pollinate 完成（[react-arch](../reviews/eva-multi-project-usage-react-arch-2026-05-05-2348.md) + [react-cross](../reviews/eva-multi-project-usage-react-cross-2026-05-05-2348.md)），无硬冲突
- ✅ Phase 3 author 仲裁完成（[arbitration log](../reviews/eva-multi-project-usage-arbitration-2026-05-05.md)），21 条 finding 全部分类，3 条用户决定 ≤3 硬约束满足

**v0.2 收敛判断**（按 SKILL.md L262-268）：

- ✅ 修订完所有 ✅ accept + ⚠️ partial（本文件即修订后版本）
- ✅ 无未解 BLOCKER（4 BLOCKER 全部 §5 吸收）
- ✅ 用户决定 ≤ 3 条（U1/U2/U3 三条）
- ✅ 不引入新 BLOCKER 维度（修订是 author 仲裁后的 deterministic edits）

**判定**：v0.2 **不需要 round 2 phase 1**，直接交用户拍板 U1/U2/U3。

**例外触发条件**：U1/U2/U3 任一被用户拍板为非 author 推荐选项时，相应段落需要重新跑 phase 1 局部评审（对修订段落跑 round 2）。

---

## 11. 引用源

外部参照（按出现顺序）：

- [Devin 2026 Release Notes](https://docs.devin.ai/release-notes/2026)
- [Cognition: Devin can now Manage Devins](https://www.cognition-labs.com/blog/devin-can-now-manage-devins)
- [OpenHands #13268 — SDK credential inheritance](https://github.com/OpenHands/OpenHands/issues/13268)
- [OpenHands #13506 — Audit log + agent-scoped identity](https://github.com/OpenHands/OpenHands/issues/13506)
- [OpenHands #12660 — SANDBOX_WORKING_DIR env](https://github.com/OpenHands/OpenHands/pull/12660)
- [Mem0 — State of AI Agent Memory 2026](https://mem0.dev/blog/blog/state-of-ai-agent-memory-2026)
- [Kelos — K8s-native AI agent orchestration](https://github.com/kelos-dev/kelos)
- [harnext — CI harness for issue-to-PR](https://www.flowhunt.io/harnext/)
- [Lex — AI orchestration for engineering teams](https://project-lex.co.uk/)
- [Paseo — Developer-first agent platform](https://paseo.sh)
- [shell-quote npm package](https://www.npmjs.com/package/shell-quote) — P0-2 token-level 检测用

内部 Eva 代码引用（已 fact-check 锚点）：

- [packages/backend/src/cli-runner.ts L77-81](../../packages/backend/src/cli-runner.ts#L77-L81) — spawn `env: process.env` 现状
- [packages/backend/src/migrations/0001_initial.sql L18-26](../../packages/backend/src/migrations/0001_initial.sql#L18-L26) — harness_project schema
- [packages/backend/src/migrations/0001_initial.sql L108](../../packages/backend/src/migrations/0001_initial.sql#L108) — methodology.applies_to enum
- [packages/backend/src/migrations/0001_initial.sql L50-65, 120-142, 205-237](../../packages/backend/src/migrations/0001_initial.sql) — Issue/Stage/Artifact FK 链
- [packages/backend/src/context-manager.ts L45-57](../../packages/backend/src/context-manager.ts#L45-L57) — STAGE_SELECTORS 当前形态
- [packages/backend/src/context-manager.ts L86-94](../../packages/backend/src/context-manager.ts#L86-L94) — **NEVER_ALLOWED 黑名单（被 P0-2 引用，v0.2 新加）**
- [packages/backend/src/context-manager.ts L204](../../packages/backend/src/context-manager.ts#L204) — listArtifactsForIssue 已按 issue→project 隔离
- [packages/backend/src/harness-store.ts L24, L31](../../packages/backend/src/harness-store.ts) — harness.db 单文件路径 + HARNESS_SCHEMA_VERSION = 102
- [packages/backend/src/harness-store.ts L43-49](../../packages/backend/src/harness-store.ts#L43-L49) — MIGRATION_MODE schema-rebuild 支持（被 P0-4b 引用）
- [packages/shared/src/protocol.ts](../../packages/shared/src/protocol.ts) — **ProjectDTO（被 BLK-4 引用，v0.2 新加）**
- [packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift](../../packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift) — **Swift Codable（被 K12 引用，v0.2 新加）**
- [packages/ios-native/Sources/ClaudeWeb/BackendClient.swift](../../packages/ios-native/Sources/ClaudeWeb/BackendClient.swift) — iOS per-conversation 状态模型
- [packages/backend/src/projects-store.ts](../../packages/backend/src/projects-store.ts) — projects.json atomic-rename writes
- [eva.json](../../eva.json) — H12 v1 worktree 注册表（含本 proposal jarvis-vision 行）
- [WORKTREE_LOCK.md L41](../../WORKTREE_LOCK.md) — H13 hook curated env 白名单（被 P0-1 / MAJ-1 引用）

内部文档引用：

- [docs/HARNESS_ARCHITECTURE.md](../HARNESS_ARCHITECTURE.md)
- [docs/HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md)
- [docs/HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md)
- [docs/HARNESS_RISKS.md](../HARNESS_RISKS.md)
- [docs/HARNESS_LANDSCAPE.md](../HARNESS_LANDSCAPE.md)
- [docs/HARNESS_INDEX.md](../HARNESS_INDEX.md)
- [docs/IDEAS.md](../IDEAS.md)
- [CLAUDE.md](../../CLAUDE.md) — projects.json 是 iOS canonical project registry 引用
- [.claude/skills/harness-review-workflow/SKILL.md](../../.claude/skills/harness-review-workflow/SKILL.md)
- [.claude/skills/reviewer-cross/SKILL.md](../../.claude/skills/reviewer-cross/SKILL.md)
- [.claude/skills/harness-architecture-review/SKILL.md](../../.claude/skills/harness-architecture-review/SKILL.md)

Phase 1+2+3 review trail：

- [docs/reviews/eva-multi-project-usage-arch-2026-05-05-2342.md](../reviews/eva-multi-project-usage-arch-2026-05-05-2342.md) — phase 1 arch verdict (Claude Opus 4.7)
- [docs/reviews/eva-multi-project-usage-cross-2026-05-05-2342.md](../reviews/eva-multi-project-usage-cross-2026-05-05-2342.md) — phase 1 cross verdict (cursor-agent GPT-5.5)
- [docs/reviews/eva-multi-project-usage-react-arch-2026-05-05-2348.md](../reviews/eva-multi-project-usage-react-arch-2026-05-05-2348.md) — phase 2 react arch
- [docs/reviews/eva-multi-project-usage-react-cross-2026-05-05-2348.md](../reviews/eva-multi-project-usage-react-cross-2026-05-05-2348.md) — phase 2 react cross
- [docs/reviews/eva-multi-project-usage-arbitration-2026-05-05.md](../reviews/eva-multi-project-usage-arbitration-2026-05-05.md) — phase 3 author arbitration

---

## 12. 用户拍板记录 (v0.2 → v0.3)

**Date**: 2026-05-05 23:58
**Decision**: 用户对 §8 三条决定全部拍板

| ID | 决定 | author 推荐 | 用户拍板 | 是否一致 |
|---|---|---|---|---|
| U1 | domain_profile enum 是否拆"粗类型 + 业务子领域"两层？ | U1-A | **U1-A** | ✅ 一致 |
| U2 | legacy harness_project rows 的 domain_profile backfill 策略？ | U2-C | **U2-C** | ✅ 一致 |
| U3 | P0-2 hook spike 失败时 fallback 路径？ | U3-B | **U3-defer**（等 spike 跑完看结果，默认 U3-B） | ✅ 兼容 |

**3 拍板与 author 推荐 / 默认一致，按 SKILL.md L262-268 不触发 round 2 phase 1。v0.3 = 收敛 final**。

### 落地实施约束

按 §10 v0.X+1 收敛判断的"例外触发条件"：U1-A / U2-C / U3-defer 都未触发 round 2 局部评审。可直接进 §13 落地（不在本 proposal 范围，由后续 plan 跑 P0-1 / P0-2 / P0-4 实施）。

**U3-defer 特别说明**：

- P0-2-spike 实施时（前置 1 天），跑完后必须立即决定走 U3-A / U3-B / U3-C
- 如果 spike 通过（CLI 取严格语义"任一 deny 即拒"）→ 不需要 fallback，直接走 §5 P0-2 主实施
- 如果 spike 失败 → 默认走 U3-B（permission-hook 内置黑名单），与 author 推荐一致
- U3 真正需要用户重新拍板的时机：spike 失败 + 用户希望走 U3-A 而非 U3-B（极小概率）

---

## 13. 后续落地（不在本 proposal 范围）

本 proposal 收敛 final 后，后续工作分两条线，**不在本文范围**：

### 13.1 短期 P0/P1/P2 落地实施（独立 plan）

按 §5 优先级顺序：

1. **P0-1** spawn env 白名单 + injectEnv denylist（cli-runner.ts 改 + AgentProfile fixture 升级）
2. **P0-2-spike**（1 天）→ 根据结果走 §5 P0-2 主实施 或 U3 fallback
3. **P0-4a + P0-4b** migration（0004 additive + 0005 schema-rebuild）
4. **P0-4 跨端契约段**（ProjectDTO + Swift Codable + TS Zod + projects.json 同步规则）
5. **P1-4-spike**（1 小时）→ skill activation 三选一路径
6. **P1-1 / P1-2a / P1-2b / P1-3** P1 一周内补
7. **P2-3** 长期演进

每条 P0 / P0-spike 独立走 contract mode 评审（schema 改动 + ADR-lite + dogfood gate）；P1 走 patch mode（按 [HARNESS_PR_GUIDE.md](../HARNESS_PR_GUIDE.md)）。

### 13.2 同步修订其他文档（独立 PR）

按 §7 合并建议：

- [docs/HARNESS_RISKS.md](../HARNESS_RISKS.md) 加 §8（R8.1-R8.15 共 15 个主题 / 16 个条目，含 R8.3 拆 a/b）
- [docs/IDEAS.md](../IDEAS.md) 加 H19-H26 共 8 条（H18 已被 Provider Runtime Matrix 占用）
- [docs/HARNESS_ROADMAP.md](../HARNESS_ROADMAP.md) §0 #16 / #17 加注 + §0 加新原则 #23
- [docs/HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md) §1.1 / §1.6 / §2 修订
- [docs/HARNESS_INDEX.md](../HARNESS_INDEX.md) 加本 proposal 入口

每个文档修订独立 PR 进 dev，避免单 PR 改动面过大。
