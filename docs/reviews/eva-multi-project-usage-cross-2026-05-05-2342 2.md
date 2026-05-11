我已经核对了强制清单里的锚点：`env: process.env`、`harness_project` 7 字段、`methodology.applies_to` 三选、FK 链、ContextManager 的 selector/listArtifactsForIssue、`harness.db` 路径和 schema version、`eva.json` 注册行都与 proposal 的事实描述基本一致。接下来我会把问题集中在 proposal 自身的合同矛盾、迁移风险和实现退出条件上。# Cross Review — EVA_MULTI_PROJECT_USAGE.md v0.1

**Reviewer**: reviewer-cross  
**Model**: GPT-5.5  
**Date**: 2026-05-05 23:44  
**Files reviewed**:
- `/tmp/eva-multi-project-usage-cross-prompt.md`
- `packages/backend/src/cli-runner.ts`
- `packages/backend/src/migrations/0001_initial.sql`
- `packages/backend/src/context-manager.ts`
- `packages/backend/src/harness-store.ts`
- `WORKTREE_LOCK.md`
- `eva.json`

---

## Summary

- Blockers: 2
- Majors: 4
- Minors: 3
- 总体判断：必须先修

## Numeric Score

| Lens | Score (0..5) |
|---|---:|
| 正确性 | 3.0 |
| 跨端对齐 | 2.5 |
| 不可逆 | 3.0 |
| 安全 | 3.0 |
| 简化 | 3.5 |

**Overall score**：3.0（有 blocker，上限 3.9）

## Findings

### B1 [BLOCKER] `domain_profile` 不是纯 additive migration，因为还要扩 `methodology.applies_to` CHECK enum

**Where**: `docs/proposals/EVA_MULTI_PROJECT_USAGE.md §5 P0-4`; `packages/backend/src/migrations/0001_initial.sql:104-112`  
**Lens**: 正确性 / 不可逆  
**Issue**: proposal 把 P0-4 描述成 `harness_project` 加列的 additive minor bump，但同一条又要求扩展 `methodology.applies_to` enum。实际 SQL 里 `methodology.applies_to` 是 `CHECK (applies_to IN ('claude-web','enterprise-admin','universal'))`，SQLite 不能用简单 `ALTER TABLE ADD COLUMN` 修改这个 CHECK。  
**Why this is a blocker**: 如果按 proposal 当前描述实现，`software-library` / `software-cli` / `infra-script` 这些新值无法写入 `methodology`，或者需要 rebuild 表但 proposal 没写迁移模式、数据保留、回滚路径。这个 schema 一旦 ship，后续修复成本高。  
**Suggested fix**: 把 P0-4 拆成两部分：`harness_project.domain_profile` 是 additive；`methodology.applies_to` 扩 enum 是 schema-rebuild migration。明确 `0004_project_domain_profile.sql` 必须使用现有 `MIGRATION_MODE=schema-rebuild` 或等价 rebuild 流程，并写出保留现有 methodology rows 的迁移步骤和测试。

### B2 [BLOCKER] `domain_profile` 缺少跨端契约：SQLite 字段、iOS picker、项目注册表之间没有定义数据流

**Where**: `docs/proposals/EVA_MULTI_PROJECT_USAGE.md §5 P0-4`; `CLAUDE.md` iOS/Backend project registry invariants  
**Lens**: 跨端对齐 / 正确性  
**Issue**: proposal 要在 `harness_project` 加 `domain_profile`，又要求 iOS 项目创建表单加 picker，但没有定义 `ProjectsAPI` / `ProjectDTO` / `projects.json` / Swift Codable 如何承载这个字段。当前系统里 server-side `projects.json` 是 iOS canonical project registry，而不是 `harness_project`。  
**Why this is a blocker**: iOS 即使显示 picker，也没有明确 API 字段能把选择写进 harness metadata；backend 也没有定义从 `projects.json` project 到 `harness_project` row 的同步规则。结果会出现 UI 以为设置成功、Scheduler/PM agent 实际读不到的 split-brain。  
**Suggested fix**: P0-4 必须补一个最小 wire contract：`ProjectDTO.domainProfile?: DomainProfile` 或单独 harness project config API 二选一。写清楚新字段在 TS Zod、Swift Codable、SQLite、fixture round-trip 中的名字、默认值、unknown enum 行为，以及从老 `projects.json` 项目补齐 `harness_project` row 的时机。

### M1 [MAJOR] P0-1 默认 env 白名单和 D1 推荐白名单互相矛盾

**Where**: `docs/proposals/EVA_MULTI_PROJECT_USAGE.md §5 P0-1` and `§8 D1`  
**Lens**: 正确性 / 安全  
**Issue**: P0-1 核心里写默认 `inheritEnv` 包含 `CLAUDE_CONFIG_DIR`，但 D1 推荐 B 里没有 `CLAUDE_CONFIG_DIR`，反而加入 `USER` / `SHELL` / `TERM` / `NVM_DIR` / `PNPM_HOME`。  
**Why this matters**: 这是用户要拍板的关键安全默认值，proposal 内部不一致会导致实现者不知道哪个列表是合同。尤其 Claude CLI OAuth 路径、Node toolchain 路径、hook 运行环境都会被这个列表影响。  
**Suggested fix**: 合并成唯一推荐白名单，并明确三类变量：必须给 CLI 运行的、给 dev tooling 的、明确禁止的。若选择参考 `WORKTREE_LOCK.md` curated env，就说明 `CLAUDE_CONFIG_DIR` 是否加入，以及为什么。

### M2 [MAJOR] `injectEnv` 没有限制可覆盖 key，可能把 env 白名单绕回去

**Where**: `docs/proposals/EVA_MULTI_PROJECT_USAGE.md §5 P0-1 / P2-3`  
**Lens**: 安全  
**Issue**: proposal 允许 `injectEnv?: Record<string, string>` 和未来 `.env.harness` 注入，但没有规定它不能覆盖 `PATH`、`HOME`、`BASH_ENV`、`ENV`、`SHELLOPTS`、`CDPATH` 等敏感变量。  
**Why this matters**: P0-1 的目标是减少 ambient credential / shell injection 风险；无限制注入会让每个 project 或 profile 重新打开同类风险。`WORKTREE_LOCK.md` 已明确 strip 这些 shell 注入变量，spawn env 应该沿用同一原则。  
**Suggested fix**: 定义 `injectEnv` denylist 或 allowlist：默认禁止覆盖运行时关键变量和 shell startup 变量；需要 override `PATH` / `HOME` / `CLAUDE_CONFIG_DIR` 时必须显式配置并有测试。

### M3 [MAJOR] `prod-guard.mjs` 的 regex 黑名单只讨论误伤，没覆盖明显绕过路径

**Where**: `docs/proposals/EVA_MULTI_PROJECT_USAGE.md §5 P0-2 / §9 OQ3`  
**Lens**: 安全 / 正确性  
**Issue**: proposal 只把 `pnpm db:migrate:dev` 误伤列为 OQ，但没有处理 false negative：比如 shell alias、package script 间接调用、`env AWS_PROFILE=prod aws ...`、换行拼接、`npx` 包装命令等。  
**Why this matters**: P0-2 是防不可逆操作的 P0 安全门；只靠简单 regex 容易给用户“已经拦住生产操作”的错觉。  
**Suggested fix**: 最小版也要先规范化 Bash tool input：记录原命令，做 token-level 检测，覆盖直接命令和常见 wrapper；对 package scripts 至少把 `pnpm/npm/yarn run <script>` 标成需要人工确认或 deny unknown prod-like scripts。

### M4 [MAJOR] P1-4 skill `appliesTo` 依赖未确认的 CLI 激活机制，不应进入可执行清单

**Where**: `docs/proposals/EVA_MULTI_PROJECT_USAGE.md §5 P1-4 / §9 OQ1`  
**Lens**: 正确性 / 简化  
**Issue**: proposal 自己承认不知道 Claude CLI skills 是内部 glob 读取还是可被 cli-runner 拦截，但 P1-4 已经写成“第一周必须补”的执行项。  
**Why this matters**: 如果 CLI 内部直接读 `~/.claude/skills`，frontmatter 加 `appliesTo` 不会生效，退出条件“非 dogfood Project Run 时 skill 不被自动激活”无法实现。  
**Suggested fix**: 把 P1-4 降级成 spike：先验证 CLI skill activation 控制面。只有确认可控后，再进入 P1；否则改成 symlink profile、临时 skills dir、或 prompt-level 禁用声明三选一。

### m1 [MINOR] P0 阶段编号跳过 P0-3，容易让后续 review / roadmap 引用混乱

**Where**: `docs/proposals/EVA_MULTI_PROJECT_USAGE.md §5`  
**Lens**: 简化  
**Issue**: P0 列表写“3 条”，编号是 P0-1 / P0-2 / P0-4。虽然后文解释 P0-3 被删除，但正式清单继续保留缺号会增加引用成本。  
**Suggested fix**: 收敛后重编号，或保留“P0-3 removed”占位并在目录处显式说明。

### m2 [MINOR] `dogfood-self` enum 存在，但默认值却是 `software-enterprise`

**Where**: `docs/proposals/EVA_MULTI_PROJECT_USAGE.md §5 P0-4 / §9 OQ4`  
**Lens**: 正确性  
**Issue**: proposal 提议 enum 含 `dogfood-self`，但 default 是 `software-enterprise`，并说“让 dogfood Project 自动归类”。这两个说法冲突。  
**Suggested fix**: 明确迁移时如何识别 Eva 自身项目：按 cwd / eva.json worktree / project id 手动 patch 为 `dogfood-self`，其他老项目才 default `software-enterprise`。

### m3 [MINOR] P1-3 备份退出条件只验证 7 天存在文件，没有验证备份完整性

**Where**: `docs/proposals/EVA_MULTI_PROJECT_USAGE.md §5 P1-3`  
**Lens**: 安全 / 正确性  
**Issue**: “每天有 1 个 .db 文件”只能证明 job 跑了，不能证明备份可恢复。  
**Suggested fix**: 退出条件加 `sqlite3 backup.db "PRAGMA integrity_check"`，并至少跑一次只读打开 + `PRAGMA foreign_key_check`。

## False-Positive Watch

- F? P0-2 multiple hooks 支持：proposal 引用 Claude Code hooks 文档说 multiple hooks per matcher 支持；我这轮没有打开外部文档核实，只按 proposal 自述评审。
- F? P1-4 CLI skills 激活机制：proposal 已把它列为 OQ1，所以我没有把“不可实现”直接判 blocker，只判当前不应进入可执行 P1。

## What I Did Not Look At

- 没有读取 author transcript、另一位 reviewer verdict 或任何 phase 2/3 材料。
- 没有运行 migration，只静态读取 SQL。
- 没有读取 TS Zod DTO / Swift Codable 源码，因此跨端问题基于 proposal 与项目已知架构约束判断。
- 没有联网核实 Devin / OpenHands / Mem0 / Paseo 等外部引用。
