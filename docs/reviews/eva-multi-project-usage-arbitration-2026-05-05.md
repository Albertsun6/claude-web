# Phase 3 Arbitration — EVA_MULTI_PROJECT_USAGE.md v0.1 → v0.2

**Author**: Claude Sonnet 4.6
**Date**: 2026-05-05 23:55
**Phase**: 3 (author arbitration)
**Read**: phase 1 cross verdict + phase 1 arch verdict + phase 2 react-cross verdict + phase 2 react-arch verdict + 自身原 v0.1
**Output**: 仲裁矩阵 + v0.2 修订计划 + ≤3 条用户决定清单

按 [`harness-review-workflow` SKILL.md](../../.claude/skills/harness-review-workflow/SKILL.md) L240-256 author 仲裁规则。硬约束：用户决定 ≤ 3 条；超出回 phase 2。

---

## 0. 评审收敛信号统计

| 指标 | 数 | 说明 |
|---|---|---|
| 双向 BLOCKER agree | 2 | B1 (schema-rebuild) + B2 (跨端契约)，arch 在 react 中升级吸收为 BLOCKER-3/4 |
| 双向 BLOCKER 同 finding 不同级 | 1 | arch BLOCKER-1 + cross M1 → cross 在 react 中自升 BLOCKER |
| 双向 BLOCKER 互补 | 1 | arch BLOCKER-2 + cross react NF1 (hook deny spike) |
| 双向 MAJOR agree | 5 | M2 / M4 / M3 / M5(P1-2) / 备份范围 |
| 双向 MAJOR 互补 (各自盲区) | 4 | iOS K4 thin shell / 企业贴谱性 / ServerChan / .env.harness / F8 |
| MINOR agree | 3 | m1 / m2 / m3 |
| 反驳 (硬冲突) | 0 | 无 |
| 单向 refine | 3 | M1 升 BLOCKER / M3 + DRY 同源 / m3 + 完整性 |
| New-finding (phase 2) | 4 | NF1 hook deny / NF2 粗vs细 / NF3 跨channel / NEW-1 Swift unknown / NEW-2 单源真相文件 |

**判断**：phase 2 信号强，无硬冲突，可以收敛到 v0.2。

---

## 1. Arbitration Matrix（21 条 finding 全部仲裁）

| # | Finding | 来源 | 类别 | 处理 |
|---|---|---|---|---|
| BLK-1 | P0-1 默认白名单与 D1 选项 B 矛盾 + 缺 NVM_DIR/PNPM_HOME 会断 implement stage | arch BLK-1 + cross M1→BLK + react agree | ✅ accept BLOCKER | 升 BLOCKER + 统一白名单 + 加正向回归退出条件 |
| BLK-2 | P0-2 prod-guard vs permission-hook 同链路 fail-open/fail-closed 冲突语义未定义 | arch BLK-2 + cross react NF1 | ✅ accept BLOCKER | 加 1 天 spike 验证 hook deny 优先级，不通过则合并到单 hook chain-call |
| BLK-3 | P0-4 同时改 methodology.applies_to enum 是 schema-rebuild 不是 additive | cross B1 + arch react BLK-3 | ✅ accept BLOCKER | 拆 0004 (additive 加 domain_profile 列) + 0005 (schema-rebuild 改 methodology.applies_to enum) |
| BLK-4 | P0-4 缺 projects.json ↔ harness_project ↔ ProjectDTO 跨端契约 | cross B2 + arch react BLK-4 | ✅ accept BLOCKER | 补完整跨端契约链 (含 NEW-1 Swift Codable unknown enum fallback) |
| MAJ-1 | injectEnv 没 denylist 可绕过白名单 | cross M2 + arch react new-finding | ✅ accept MAJOR | 加 denylist (`PATH/HOME/BASH_ENV/ENV/SHELLOPTS/CDPATH`) 与 [WORKTREE_LOCK.md L41](../../WORKTREE_LOCK.md) H13 hook env strip 同源 |
| MAJ-2 | prod-guard 黑名单覆盖不全 + regex 易绕过 (alias/wrapper/npx/here-doc) | cross M3 + arch §架构可行性§1 | ✅ accept MAJOR | 黑名单与 NEVER_ALLOWED 同源 (单源真相 = NEW-2) + token-level 检测 + wrapper 解析 |
| MAJ-3 | P1-4 skill appliesTo 依赖未确认 CLI 激活机制 | cross M4 + arch OQ1 | ✅ accept MAJOR | 改 P1-4-spike：1 小时验证 CLI skill 加载机制；spike 出结果再决定路径 |
| MAJ-4 | P1-2 iOS 改动被低估 (顶栏切换器/Inbox 分组需要 SwiftUI 改动) | arch §架构可行性§3 + cross react agree | ✅ accept MAJOR | P1-2 拆两步：(a) 后端 push title prefix，(b) iOS UI 分组+切换器 |
| MAJ-5 | P1-3 备份范围 + 完整性 + 可恢复性三层缺失 | arch §风险遗漏§1 + cross m3 + cross react refine | ✅ accept MAJOR | 三层退出条件：备份 `~/.claude-web/` 整目录 / `PRAGMA integrity_check + foreign_key_check` / 每月 1 号自动恢复演练 |
| MAJ-6 | iOS minClientVersion + Swift Codable unknown enum fallback | arch §风险遗漏§2 + arch NEW-1 | ✅ accept MAJOR | 合并到 BLK-4 跨端契约段；fixture round-trip 测试加 `domainProfile: 'future-unknown-value'` 反例 |
| MAJ-7 | ServerChan / Telegram notification format 破坏 | arch §风险遗漏§3 + cross react NF3 | ✅ accept MAJOR | 通知 payload 保留结构化字段 `projectName/projectId`；iOS lockscreen 显示 prefix；ServerChan/TG 维持原 title 或追加末尾字段 |
| MAJ-8 | .env.harness 备份策略遗漏 | arch §风险遗漏§4 + cross react agree | ✅ accept MAJOR | P2-3 设计加密备份或显式排除策略；不混入普通快照 |
| MAJ-9 | F8 dogfood 自指风险触发面被低估 | arch §风险遗漏§5 + cross react agree | ✅ accept MAJOR | P0-1/P0-2 加 dogfood smoke gate (backend health + harmless prompt + Bash deny + 普通 git diff 允许) |
| MAJ-10 | K10：P0-1/P0-2 与 M2 loop2+ 改 cli-runner.ts 必须串行 | arch §里程碑裁剪 + cross react agree | ✅ accept MAJOR | 加 K10 不变量：P0-1/P0-2 与任何改 cli-runner.ts spawn/env/args 的 M2 loop 必须串行合并 (先 ship P0-1 后 cherry-pick) |
| MAJ-11 | dogfood-self enum 但 default 是 software-enterprise（升级 m2→MAJOR）| cross m2 + arch OQ4 + cross react refine | ✅ accept MAJOR | schema NOT NULL 不带 DEFAULT；migration 期 nullable + backfill (cwd 命中 dogfood-self / 其他默认值见 U2) |
| PRT-1 | domain_profile 5 选与企业管理系统垂直脱节 | arch §企业管理系统贴谱性 + cross react refine NF2 | ⚠️ partial accept | P0 schema 只固化粗类型 5 选；business_domain 进 PM spec 必填字段 (不进 schema)；3-5 个企业项目实践后再考虑升 schema (具体路径见 U1) |
| MIN-1 | P0 阶段编号跳过 P0-3 | cross m1 + arch react agree | ✅ accept MINOR | 保留 "P0-3 removed" placeholder + 显式说明 (不重编号，便于 audit trail) |
| MIN-2 | prod-guard 黑名单单源真相文件位置未指定 | arch NEW-2 | ✅ accept MINOR | 单源真相 = `~/.claude-web/never-allowed-commands.json`，prod-guard 与 backend 启动时 ContextManager 都读 |
| MIN-3 | P1-2 退出条件依赖 P0-4 落地 (无并行 active project 可验) | arch §里程碑裁剪 | ✅ accept MINOR | P1-2 退出条件改为 "P0-4 完成且至少 1 个非 dogfood project 创建后" |
| U1 | domain_profile enum 是否拆"粗+细"两层？ | arch §企业管理系统贴谱性 + cross react NF2 | 🟡 用户决定 | 见 §3 用户决定清单 |
| U2 | legacy harness_project backfill 策略？ | arch OQ4 + cross react refine | 🟡 用户决定 | 见 §3 用户决定清单 |
| U3 | P0-2 hook spike 失败时 fallback 路径？ | arch BLK-2 + cross react NF1 | 🟡 用户决定 | 见 §3 用户决定清单 |

**计数**：4 BLOCKER 接受 + 10 MAJOR 接受 + 1 partial + 3 MINOR 接受 + 3 用户决定 + 0 反驳 = 21 条处理。
**用户决定 = 3 条**（满足 SKILL.md L254 ≤ 3 硬约束）。

---

## 2. v0.2 修订计划（应用所有 ✅ accept + ⚠️ partial）

按 SKILL.md L260 应用顺序：先改 BLOCKER 再 MAJOR 再 MINOR。

### 2.1 修订 §0 Status / 不可逆度
- v0.1 → v0.2，bump version
- 不可逆度从 "中" 改为 "中-高"（因为 BLK-3 schema-rebuild 不可逆）

### 2.2 修订 §3 失败模式清单
- 加 F9 (injectEnv 反向打洞) / F10 (hook 链路冲突) / F11 (Swift Codable unknown enum) / F12 (M2 loop2+ 串行冲突) / F13 (ServerChan format) / F14 (.env.harness 备份) / F15 (F8 自指 backend 改坏)
- 拆 F3 (方法论领域不贴) 为 F3a (粗 enum) + F3b (业务子领域 PM spec 必填)
- 修订 F1 (env 白名单) 描述：升 BLOCKER + 加正向回归

### 2.3 修订 §4 对接现有 harness 数据模型 / 代码
- 加 ❌ 新缺口：projects.json ↔ harness_project 同步规则
- 加 ❌ Swift Codable unknown enum fallback 行为
- 加 ❌ inheritEnv ↔ injectEnv 对称安全模型
- 加 ❌ prod-guard 与 permission-hook 链路 deny 优先级合并语义

### 2.4 修订 §5 推荐方案

**P0-1 改写为 BLOCKER 级**：
- 统一白名单 = `['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_*', 'TERM', 'TMPDIR', 'NVM_DIR', 'PNPM_HOME', 'CLAUDE_CONFIG_DIR']`（合并 §5 + §8 D1）
- AgentProfile 加 `inheritEnv: string[]`（默认上述统一白名单）+ `injectEnv?: Record<string, string>`
- **新增**：`injectEnv` denylist `['PATH', 'HOME', 'BASH_ENV', 'ENV', 'SHELLOPTS', 'CDPATH', 'IFS', 'PS1', 'PS4']`，违反即拒（与 [WORKTREE_LOCK.md L41](../../WORKTREE_LOCK.md) H13 同源）
- **新增**：`inheritMode: "curated" | "full"`（默认 curated，full 必须本机 .env.local 显式配置 + 进 audit log）
- **退出条件升级**：(a) negative canary `OPENAI_API_KEY=fake-leak-canary` 不可见；(b) **正向通路**：对最近 30 天 dogfood Run 命令做 dry-run 回放，env 白名单后无 ENOENT / command not found 退化；(c) `pnpm/node/tsx/vitest/git` 5 条核心命令在新 env 下能 spawn 成功
- 加 escape hatch：`AgentProfile.inheritMode = 'full'` 时降级为 process.env（一键回滚 = 改 fixture 不重 spawn）

**P0-2 改写为 BLOCKER 级 + 加 spike 前置**：
- 第一步必做 1 天 spike：跑一对冲突测试 `permission-hook(allow) + prod-guard(deny)` → 验证 Claude CLI 取最严格语义（任一 deny 即拒）
- spike 结果 = chain-call short-circuit 可行 → 维持双 hook 并行（prod-guard 先跑）
- spike 结果 = 不可行 → 走 U3 用户决定的 fallback
- 黑名单单源真相 = `~/.claude-web/never-allowed-commands.json`（运行时配置；prod-guard.mjs 读 + backend 启动时同步注入到 ContextManager NEVER_ALLOWED）
- 黑名单内容继承 [context-manager.ts L86-94 NEVER_ALLOWED](../../packages/backend/src/context-manager.ts) + 加 `db:migrate / gh release / aws / kubectl / terraform / stripe / git push --force / npm publish / pnpm publish` 等
- 检测 token-level：先 shell tokenize（用 `shell-quote` npm 包，纯 JS 不引入新组件），再 argv[0] / argv[1] 完整词匹配（不是 substring）
- wrapper 解析：`pnpm/npm/yarn run <script>` 必须 ResolveScript 解析 package.json scripts 字段把脚本展开后再走黑名单
- allowlist override：`~/.claude-web/prod-guard-allowlist.json`，只允许用户手动编辑或 UI 确认写入；每条 allow 记录 matcher / reason / createdAt + 进 audit log
- 退出条件：(a) spike 结果落 verdict.md；(b) 5-10 条业界已知绕开手法 (`CMD="..."; $CMD` / here-doc / 别名 / `eval` / `bash -c` / `npx`) 全验拒；(c) 历史 30 天 dogfood Run 命令 dry-run 误伤率 < 5%；(d) hook 进程异常退出 / 超时 / 网络 fail 时整体行为 = deny (fail-closed 单元测试)

**P0-3 处理**：保留 placeholder + 显式说明
```
~~P0-3 ContextManager projectId 过滤~~（v0.2 删除）
事实推翻：[context-manager.ts L204](../../packages/backend/src/context-manager.ts) `listArtifactsForIssue(db, input.issue.id)` 已通过 stage→issue→project_id FK 链严格隔离。详见 §3 已修正的伪风险段。
```

**P0-4 拆为 P0-4a + P0-4b**：

**P0-4a (additive，0004 migration)**：
- `harness_project.domain_profile TEXT` (nullable for migration 安全)
- migration 阶段 backfill：cwd 命中 `~/Desktop/claude-web*` → `dogfood-self`，其他 legacy 见 U2
- 新建 API 强制必传，稳定后再考虑 NOT NULL
- enum：`software-enterprise / software-library / software-cli / infra-script / dogfood-self`（v0.2 5 选不变，business_domain 走 PM spec）

**P0-4b (schema-rebuild，0005 migration)**：
- `methodology.applies_to` enum 扩展：从 `(claude-web, enterprise-admin, universal)` 改为 `(software-enterprise, software-library, software-cli, infra-script, dogfood-self, universal)` (与 P0-4a 对齐 + 保留 universal)
- TARGET_VERSION = 200 (major bump，因为是 schema-rebuild)
- MIGRATION_MODE = schema-rebuild
- 数据 copy：legacy 'claude-web' → 'dogfood-self'，'enterprise-admin' → 'software-enterprise'，'universal' 不动
- migration 测试覆盖 rollback 路径

**P0-4 跨端契约（吸收 BLK-4 + MAJ-6）**：
- `ProjectDTO.domainProfile?: DomainProfile` 加入 [packages/shared/src/protocol.ts](../../packages/shared/src/protocol.ts) Zod schema
- Swift Codable 实现 `init(from:)` 自定义 decoding，unknown enum 值 fallback 到 'software-enterprise'（避免老 iOS 整个 ProjectDTO decode 失败）
- TS Zod 用 `z.enum([...]).catch('software-enterprise')` 同样 fallback
- fixture round-trip 测试加 `domainProfile: 'future-unknown-value'` 反例 → Swift / TS 都应当 decode 成功 + fallback
- `projects.json` ↔ `harness_project` 同步规则：iOS POST `/api/projects` 时 backend 同步 INSERT 一行到 `harness_project`（cwd UNIQUE 已保证幂等）；老 iOS 不传 domain_profile → backend log warning + INSERT 时 default 'software-enterprise' 同时设 `needs_user_review = 1` flag (对应 U2 选项 C)
- minClientVersion：iOS server-driven config 加 `minClientVersionForDomainProfile: "vX.Y.Z"`，低版本看到 picker 但不能创建非 default project + 弹升级提示

### 2.5 修订 §5 推荐方案 P1

**P1-1 (rate limit)**：保持，加可配置默认值 2

**P1-2 拆两步**：
- P1-2a (后端 push title prefix)：iOS 通知 title 加 `[<projectName>]`；保留**结构化字段** `projectName / projectId` 在 payload；ServerChan / Telegram 维持原 title 或追加末尾字段（avoid 破坏 webhook）
- P1-2b (iOS UI 分组 + 切换器)：ContentView.swift 顶栏增加项目切换器 + Inbox 按项目分组；**需要新 build + simulator + 真机验证**（破坏 K4 thin shell 假设的承认）
- P1-2 退出条件改为依赖 P0-4 完成（**至少 1 个非 dogfood project 创建后**才能验"并行 active project"分组）

**P1-3 三层退出条件**：
- 覆盖范围：备份 `~/.claude-web/` 整目录（含 artifacts/ + audit.jsonl + projects.json + telemetry.jsonl + harness.db），不只 harness.db
- 完整性：`sqlite3 backup.db "PRAGMA integrity_check"` + `PRAGMA foreign_key_check` 两条都通过
- 可恢复性：每月 1 号自动 dry-run 恢复演练（mv 主 db 到 .bak + 复制最新备份替代 + backend 启动健康检查 + 还原原 db），失败发 Telegram alert
- 加 P1-3 警告：`.env.harness` 不混入普通快照（避免明文密钥进备份），单独走 P2-3 加密备份策略

**P1-4 改 P1-4-spike**：
- 第一步 1 小时 spike：实测 `~/.claude/skills/<x>/SKILL.md` frontmatter 加 `appliesTo` 后 CLI 是否会读
- spike 结果 = CLI 读 → 直接走 frontmatter 路径
- spike 结果 = CLI 不读（90% 概率）→ 三选一替代：(a) symlink profile（per-project 切 ~/.claude/skills 子目录）；(b) **临时 skills dir**（spawn 时设 CLAUDE_CONFIG_DIR 指向 per-project ephemeral skills 目录，推荐）；(c) prompt-level 禁用声明（system prompt 写"本 Subject 不要调 skill X"）
- 退出条件：spike 结果落 verdict.md；至少 3 个核心 skill (harness-architecture-review / harness-review-workflow / borrow-open-source) 加 appliesTo 字段；非 dogfood Project Run 时这 3 个 skill 不被自动激活

### 2.6 加 §5 P0-2-spike / P1-4-spike 单独 stage

明确两个 spike 必须在主 P 实施前完成，spike 失败回 user 决定（U3 / 默认 fallback）。

### 2.7 修订 §6 关键不变量
加 K10 + K11 + K12：

- **K10**：P0-1 / P0-2 与任何改 [cli-runner.ts](../../packages/backend/src/cli-runner.ts) spawn / env / args / hook 链路的 M2 loop 必须**串行合并**（先 ship P0-1/P0-2，后 cherry-pick 到 loop branch；不允许两 worktree 同改 cli-runner.ts L77-L156 段）
- **K11**：所有备份必须 covered + integrity-checked + recoverable 三层；备份只 .db 不算
- **K12**：所有 Swift Codable enum 必须 graceful unknown-value fallback (init(from:) 自定义)；所有 TS Zod enum 用 .catch(default)；fixture round-trip 必含 future-unknown-value 反例

### 2.8 修订 §7 与现有 IDEAS / RISKS / ROADMAP 的合并建议

- §7.1 R8.x 列从 8 条扩到 15 条（加 R8.9-R8.15 对应 MAJ-1 到 MAJ-10 中现有 RISKS 没覆盖的）
- §7.2 IDEAS H 列从 H18-H22 扩到 H18-H25（加 H23 hook spike / H24 跨端契约 / H25 备份三层）
- §7.4 HARNESS_DATA_MODEL.md 修订加 §1.1 Project domain_profile + Swift Codable unknown enum fallback 标准

### 2.9 修订 §8 用户决定（v0.1 D1/D2/D3 → v0.2 U1/U2/U3，见 §3）

### 2.10 修订 §9 Open Questions
- OQ1 / OQ3 / OQ4 已升级为 spike 或确定决议，删除
- OQ2 / OQ5 保留
- 加新 OQ6: P0-4b methodology.applies_to 老 row 数据 mapping 的边界 case（universal → universal 不动 vs unify with software-* 是否要二次审视）
- 加新 OQ7: P0-2 spike 1 天 vs 0.5 天的具体测试步数

### 2.11 修订 §10 Phase 2/3 评审 skip 原因
- 已不 skip，按当前进度更新："phase 1+2+3 全跑完，3 条用户决定待你拍板，定后进 v0.2 → v0.3 round 2 (仅 BLK-3/4 跨端契约段) 或直接收敛"

### 2.12 修订 §11 引用源
- 加 [WORKTREE_LOCK.md L41](../../WORKTREE_LOCK.md) 引用（被 MAJ-1 / BLK-1 广泛引用）
- 加 [context-manager.ts L86-94](../../packages/backend/src/context-manager.ts) NEVER_ALLOWED 引用（被 MAJ-2 引用）
- 加 [packages/shared/src/protocol.ts](../../packages/shared/src/protocol.ts) ProjectDTO 引用（被 BLK-4 引用）

---

## 3. 用户决定清单（≤3 条，硬约束满足）

### U1: domain_profile enum 是否拆"粗类型 + 业务子领域"两层？

**背景**：MAJ-11 + PRT-1 + cross react NF2。`software-enterprise` 5 选粗按软件类型切，但企业管理系统真正区分维度是业务子领域（订单 / OMS / CRM / 财务 / 库存 / HR / 报表 / 审批流）。PM agent 给"订单系统"产 spec 和给"CRM"产 spec 的必填段完全不同。

**选项**（按 author 推荐排序）：

| ID | 选项 | author 倾向 | 不可逆度 |
|---|---|---|---|
| U1-A | 仅保留 5 选粗类型；business_domain 进 PM spec 必填字段（不进 schema）。3-5 个企业项目实践后再考虑升 schema | **强推荐** | 低（可逆） |
| U1-B | schema 加第二层 `business_domain` enum（订单/CRM/财务/库存/HR/...）；同时进 0004 migration | 谨慎 | 高（enum 一旦 ship 难删） |
| U1-C | `domain_profile` 列改为 JSON object `{technical, businessDomain}` 二元组 | 不推荐 | 中（schema 不规范） |

**author 倾向 U1-A 理由**：
- 当前没有 3-5 个真实企业项目作样本，强 enum = 提前固化未知分类
- PM spec 必填字段比 schema enum 更灵活（spec 是 markdown，可用自由文本 + LLM 解析）
- cross react NF2 明确推荐 U1-A 同思路："P0 只保留粗粒度 domain_profile，business_domain 作 PM spec 必填或 project_profile_json.businessDomain 非约束字段"

### U2: legacy `harness_project` rows 的 domain_profile backfill 策略？

**背景**：MAJ-11 + arch react BLK-3 推论 + cross react refine OQ4。0004 migration 跑过来时，已存在的 `harness_project` rows 没有 domain_profile 字段，必须有 backfill 策略。

**选项**：

| ID | 选项 | 行为 | 影响 |
|---|---|---|---|
| U2-A | 按 cwd 命中手动 patch：`~/Desktop/claude-web*` cwd → `dogfood-self`；其他 legacy → `unknown` 标待确认 | fail-loud（unknown 强制创建时弹 picker 改） | 用户每个老 project 第一次开时被打扰 1 次 |
| U2-B | 全 legacy → `software-enterprise`；新建强制选 | silent default | dogfood Eva 自身被分错类（Eva ≠ enterprise system） |
| U2-C | `software-enterprise` + 加 `needs_user_review` flag；下次开 project 时弹 picker 让用户改 | hybrid（先 default，再延迟交互） | **author 推荐** — 实施简单 + 用户可控 + 不打扰 |

**author 倾向 U2-C 理由**：
- 与 cross react refine OQ4 思路一致："已知 Eva cwd 写 dogfood-self，其余 legacy 项目标 unknown 或 software-enterprise 并打待确认标记"
- `needs_user_review` flag 让 iOS 顶栏在用户下次打开该 project 时显示一个 badge（"该项目领域待确认"），用户点 picker 改完后清 flag
- 不阻塞用户工作流（不像 fail-loud 第一次开时强制弹窗）

### U3: P0-2 hook spike 失败时 fallback 路径？

**背景**：BLK-2 + cross react NF1。P0-2 第一步必做 1 天 spike 验证 Claude CLI hook deny 优先级（多 hook per matcher 时 `permission-hook(allow) + prod-guard(deny)` 是否取最严格语义）。spike 失败 = CLI 不保证 deny 优先级时怎么办？

**选项**：

| ID | 选项 | 实施成本 | 风险 |
|---|---|---|---|
| U3-A | 合并 prod-guard 进 permission-hook chain-call：prod-guard 检查在 permission-hook 内联第一步执行，命中 deny 直接短路 | 中（permission-hook 改造）| 低（单 hook 进程，行为可控）|
| U3-B | 不做 prod-guard 独立 hook，转用 permission-hook 内置黑名单（黑名单数据来自 `never-allowed-commands.json`）| 低（permission-hook 加配置文件读取）| **author 推荐** — 简单一致 |
| U3-C | 升级 Claude CLI 要求支持显式 deny 优先级 | 高（依赖 Anthropic）| 不现实 |

**author 倾向 U3-B 理由**：
- spike 失败已经证明双 hook 并行不可控，最简方案是合并到 permission-hook 一个进程
- permission-hook 已是 fail-open（dead backend 不全 deny），但**对黑名单匹配项可独立 fail-closed**（fail-open 只针对 backend 不可达，黑名单逻辑独立）
- 不引入新 hook 进程 = 一致性最好 + audit 链路简单
- U3-A 与 U3-B 的本质差异：U3-A 保留 prod-guard 独立文件（文件分离）；U3-B prod-guard 检查作为 permission-hook 子函数（代码合并）。功能等价，U3-B 实施更简单

---

## 4. v0.X+1 收敛判断

按 SKILL.md L262-268：

| 条件 | 状态 |
|---|---|
| v0.2 修订完所有 ✅ accept + ⚠️ partial | 待执行（§2 计划清晰可实施）|
| v0.2 是否还有未解 BLOCKER？ | 否（4 BLOCKER 全部 §2 计划吸收）|
| 用户决定 ≤ 3 条？ | ✅ 是（U1/U2/U3 三条）|
| 是否引入新 BLOCKER 维度？ | 否（修订是 author 仲裁后的 deterministic edits，不引入新维度）|

**判定**：v0.2 写完后**不需要 round 2 phase 1**，直接交用户拍板 U1/U2/U3。

**例外**：U1/U2/U3 任一被用户拍板为非 author 推荐选项时，相应段落需要重新跑 phase 1 局部评审（对修订段落跑 round 2，按 SKILL.md L268）。

---

## 5. 下一步

1. **执行 §2 v0.2 修订计划**：edit `docs/proposals/EVA_MULTI_PROJECT_USAGE.md` v0.1 → v0.2，应用所有 §2.1-§2.12 改动
2. **commit v0.2** + commit arbitration log
3. **交用户**：v0.2 + 本仲裁 log + U1/U2/U3 三条决定清单

完成 5 步后 Phase B (短期 proposal) 收敛，进 Phase C 用户拍板。
