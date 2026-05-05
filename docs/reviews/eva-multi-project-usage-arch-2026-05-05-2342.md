# Architecture Review — EVA_MULTI_PROJECT_USAGE.md v0.1

**Reviewer**: harness-architecture-review
**Model**: claude-opus-4-7
**Date**: 2026-05-05 23:42
**Files reviewed**:
- docs/proposals/EVA_MULTI_PROJECT_USAGE.md
- packages/backend/src/cli-runner.ts (fact-check L60-156)
- packages/backend/src/migrations/0001_initial.sql (fact-check 全文)
- packages/backend/src/context-manager.ts (fact-check L1-220)
- packages/backend/src/harness-store.ts (fact-check L1-50)
- eva.json (fact-check 全文)
- WORKTREE_LOCK.md (fact-check L1-80)

## Summary
- Blockers: 2
- Majors: 6
- Minors: 4
- 总体判断：**必须先修**（修完 BLOCKER + 至少 4 条 MAJOR 后可合并 v0.2）

## 总体判断

方向正确，业界观察 + 失败模式映射做得到位，事实证据扎实（cli-runner.ts L80 / methodology.applies_to L108 / FK 链 L50-65 / harness.db L24 全部核对成立）。但 P0-1 / P0-2 / P0-4 的**实施细节**多处存在自相矛盾与可执行性缺口，把"短期可逆"夸大了——P0-1 一旦上线就有让所有 implement stage 全挂的回归风险，P0-4 同时改 methodology.applies_to enum 不是 additive，是 schema-rebuild。**不能直接进 phase 2**，需要 author 先收紧具体实施清单再走 cross-check。

---

## 必须先改

### [BLOCKER-1] P0-1 默认白名单与 §8 D1 选项 B 自相矛盾，且未验证不会断 npm/pnpm 工具链

**Where**：proposal §5 P0-1 vs §8 D1
**Lens**：架构可行性

**Issue**：
- §5 P0-1 默认 inheritEnv = `['PATH', 'HOME', 'CLAUDE_CONFIG_DIR', 'LANG', 'LC_*', 'TMPDIR']`
- §8 D1 选项 B（"推荐"）= `PATH HOME USER SHELL TMPDIR LANG LC_* TERM NVM_DIR PNPM_HOME`

两套清单不一致：(a) §5 含 `CLAUDE_CONFIG_DIR`，D1 没有；(b) D1 含 `NVM_DIR / PNPM_HOME / SHELL / USER / TERM`，§5 没有。**§5 默认白名单缺 NVM_DIR / PNPM_HOME**，意味着 spawn 出来的 claude CLI 跑 `pnpm install` / `node` / `tsx` 会因为 PNPM_HOME 没有而 fallback 到全局 install——若用户 Mac 没全局装这些，**M2 dogfood 已有的 implement stage 全挂**。

**Why blocker**：
- cli-runner.ts L77-81 是所有 agent spawn 的单点（K5 不变量），改这一行的回归面是"所有现存 dogfood Run"
- proposal §5 P0-1 退出条件第二条只测 `OPENAI_API_KEY=fake-leak-canary` 不可见，**完全没测正向通路**：spawn 后 `pnpm install / pnpm test / git diff / vitest` 等 implement stage 实际命令是否仍然可跑通
- learnings.md 第 1 条明说"M0 必须先固定 schema version + fallback 行为"——这条加白名单等价于一次 protocol 收紧，需要先列出所有现存 Run 用过的 env 子集

**Suggested fix**：
1. 二选一统一白名单（推荐 D1 选项 B + 加 `CLAUDE_CONFIG_DIR`）
2. 退出条件加"对最近 30 天 dogfood Run（git log + harness audit）的命令做 dry-run 回放，env 白名单后无 ENOENT / command not found 退化"
3. 加 escape hatch：`AgentProfile.inheritEnv` 为空数组时降级为 `process.env`（一键回滚 ＝ 改 fixture，不需重 spawn 进程）

---

### [BLOCKER-2] P0-2 prod-guard.mjs 与 permission-hook.mjs 同链路冲突语义未定义

**Where**：proposal §5 P0-2
**Lens**：风险遗漏 + 架构可行性

**Issue**：
- proposal 说 prod-guard 与 permission-hook 同 PreToolUse 链路（multiple hooks per matcher）
- 但**两个 hook 的语义在冲突时优先级未定义**：
  - permission-hook 给 `allow` + prod-guard 给 `deny` → 整体 allow 还是 deny？
  - permission-hook 是 **fail-open**（CLAUDE.md 明文：dead backend 不会全 deny）
  - prod-guard 必须 **fail-closed**（不可逆操作 fail-open = 安全事故）
  - 同链路两 hook 一个 fail-open 一个 fail-closed 在 Claude Code hooks 文档里的合并行为**未明示**

**Why blocker**：
- P0-2 的全部价值在不可逆操作的强阻断；语义不明确 = guard 形同虚设
- proposal §0 自称"不可逆度中等，单点行为切换可一键回滚"——但 prod-guard 一旦 fail-open，被绕过的命令已经执行（DB migrate / gh release / aws / kubectl），**不可逆**已发生，不存在回滚

**Suggested fix**：
1. 在 ship P0-2 之前先做一个 1 天的小 spike：跑一对冲突测试（permission-hook allow + prod-guard deny），证实 Claude CLI 取**最严格语义**（任一 deny 即拒）
2. 若 CLI 不保证最严格语义，则 prod-guard 必须**与 permission-hook 合并到同一 hook 进程**（chain-call，prod-guard 先跑，deny 即短路），不能两 hook 并行
3. 退出条件加"prod-guard 单元测试明确 fail-closed：hook 进程异常退出 / 超时 / 网络 fail，整体行为 = deny"

---

## 四维评审

### 架构可行性

整体方向（不引入 Docker / 走凭据显式建模 / 黑名单 hook 拒不可逆）符合 K1-K6 不变量。但**三处具体设计不可行或欠考虑**：

1. **P0-2 黑名单覆盖不全 + regex 不稳**（§5 P0-2）。proposal 列了 `db:migrate / gh release / aws / kubectl / stripe / --prod`——但缺 `rm -rf` / `git push --force` / `git push.*main` / `git checkout --` / `npm publish` / `pnpm publish` / `ssh.*rm` / `chmod -R` / `chown`。proposal 自己在 context-manager.ts L86-94 NEVER_ALLOWED 已列这些，prod-guard 黑名单与 NEVER_ALLOWED 应**同源**。另外 regex over command string 容易被 here-doc / 变量插值绕开（`CMD="aws s3 rm"; $CMD ...`），最低应在 cli-runner 拦的 argv 层做检查（拿到的是数组不是 raw shell），不是 string contains。

2. **P0-4 同时改 methodology.applies_to CHECK enum 是 schema-rebuild，不是 additive minor bump**（§5 P0-4 + harness-store.ts L43-49 注释 + ADR-0015）。CHECK constraint 修改在 SQLite 必须走 schema-rebuild mode（CREATE temp + COPY + DROP + RENAME），proposal 把这条与新加 column 一起放 0004 minor bump 文件里——`HARNESS_SCHEMA_VERSION = 102 → 103` 跑过的话会因 CHECK enum mismatch 失败。两件事必须分两个 migration（0004 加列 = additive minor，0005 改 enum = schema-rebuild major）。

3. **P1-2 iOS 改动被低估**（§5 P1-2 "不动 iOS 代码即可基础生效"）。push 通知前缀确实是后端字符串，但**顶栏切换器 + Inbox 按项目分组**是 ContentView.swift 渲染逻辑改动，不是纯 server-driven。proposal 不区分这两层 = 用户读完以为可以纯后端做，实际还要重装 iOS——破坏 K4 thin shell 假设。

### 里程碑裁剪

P0/P1 切的颗粒度对（spawn env / prod-guard / domainProfile = 必须前置；rate limit / iOS / backup / skill = 第一周补），**但风险预算偏乐观**。

- proposal §0 自称 P0-1 是"单点行为切换可一键回滚"——这只在没有 Run 跑挂时成立。一旦 30 天内的 dogfood Run 有 implement stage 因 NVM_DIR 缺失全跑挂，回滚 = 改一行代码 + **重跑所有挂掉的 stage**。后者不是一键。
- P0-2 退出条件"至少 1 个 dogfood Run 实测拒绝 `gh release create`"——单测试用例不够，需要 5-10 条业界已知绕开手法（变量插值 / here-doc / 别名 / `eval` / `bash -c`）全验。
- P1-2 退出条件"至少 2 个并行 active project 时 iOS 看板能按项目分组显示"——**M2 loop1 已 ship，loop2+ 还没起**，并行 active project 哪来的？这个退出条件需要先有 P0-4 落地后**真的注册一个非 dogfood project** 才能验。proposal 把这两条独立排时序，实际有依赖。
- 没有 M2 loop2+ 影响评估。proposal §0 说"并行进行"——但 P0-1 改 cli-runner.ts L80 这一行是 M2 loop2 必经路径。两 worktree 同改 cli-runner.ts 不是 owns 隔离能解决的（worktree-1 改 L80 加 env 白名单 / worktree-2 改 L75-77 加 stage-aware 拼 args）。proposal 没在 §6 K1-K9 不变量里加"P0-1 与 M2 loop2 串行 ship"或"先 ship P0-1 再 cherry-pick L80 改动到 loop2 分支"。

**没有诱导刷分指标**（learnings 第 4 条），符合个人自用语境。

### 企业管理系统贴谱性

**P0-4 domain_profile 5 选与"企业管理系统"垂直严重脱节**——这是 proposal 最弱的一段。

5 选枚举（`software-enterprise / software-library / software-cli / infra-script / dogfood-self`）是按**软件类型**切的，不是按**业务领域**切的。但企业管理系统的真正区分维度是业务子领域：订单 / OMS / CRM / 财务 / 库存 / HR / 报表 / 审批流。PM agent 给"订单系统"产 spec 和给"CRM"产 spec 的必填段完全不同（订单要 SKU / 库存联动 / 退款流，CRM 要 lead 状态机 / 跟进时间 / 客户分层），但这两个项目在 proposal 的 enum 里都是 `software-enterprise`，PM 模板分支就一个——等于没分。

要么 (a) 给 `software-enterprise` 再切第二层 `business_domain` 字段（订单/CRM/财务/...），要么 (b) 让 PM agent prompt 把 business_domain 当 spec 的强制 input 字段在 spec 模板里问出来（不进 schema）。proposal 选的是"在 schema 加 domain_profile 让 PM 分支模板"——但 enum 太粗，分支模板与不分支没区别。

另外 `dogfood-self` 不该是 default 的反面——而是 **default 不该是 'software-enterprise'**，应该 NOT NULL 且强制创建时选择。default 'software-enterprise' 让 dogfood 期间 Eva 自己被自动归类为企业管理系统，PM agent 给 Eva 自己产的 spec 会按 OMS 词汇填字段。**OQ4 这条用户已经问出来，author 应当在 v0.2 给答案而不是留给 reviewer**。

最后 jarvis-vision worktree 自己的归类不在 5 选里——这个 worktree 只产 docs（eva.json `path: ~/Desktop/claude-web-jarvis` `note: doc-only worktree`），用任何一个 enum 都不贴。说明 enum 设计已知不完备但 proposal 不承认。

### 风险遗漏

R8.1-R8.8 列得不全。最少漏了以下 5 条（按严重性递减）：

1. **R8.x harness.db 备份覆盖不全**（§5 P1-3 仅备份 harness.db）。备份漏了：(a) `~/.claude-web/artifacts/<hash>.md`（artifact file storage，context_bundle.snapshot_path 也存这）；(b) `~/.claude-web/harness-audit.jsonl`；(c) `~/.claude-web/projects.json`；(d) `~/.claude-web/telemetry.jsonl`。备份只 harness.db = 灾难时还是丢一半数据。
2. **R8.x iOS 协议升级未识别**。P0-4 在 harness_project 加 domain_profile NOT NULL DEFAULT，老 iOS 装包 POST `/api/projects` 时不传该字段会被 default 兜——意味着**老 iOS 永远建不出非 software-enterprise project**。proposal §5 P0-4 不做项第 3 条 "iOS 老 build 的兼容性兜底"用一句话掩盖了，但这是 K4 / learnings.md 第 1 条明确警告的 schema 锁定问题，**必须在 v0.2 给出 minClientVersion bump 计划**。
3. **R8.x ServerChan / Telegram notification 格式破坏**（§5 P1-2）。M0.5 已 ship 的 ServerChan + Telegram 推送字符串是 contract——iOS push title 加 `[<projectName>]` 前缀同样会传到 ServerChan / Telegram。这两个 channel 的下游消费（手机锁屏 / TG 群 / 用户自己写的 webhook）会因为 prefix 改变 mis-parse。proposal 不在 R8 列。
4. **R8.x P2-3 worktree 内 .env.harness 备份策略**（§5 P2-3）。P1-3 备份的是 harness.db，没备份 .env.harness。.env.harness 损坏 = 工程项目密钥丢失（用户对 git 不可见 = 自己也找不回）。proposal 不提。
5. **R8.x F8 的实际触发面被低估**（§3 表格底部）。F8 "dogfood 改 Eva backend 改坏 harness 进程自身"——proposal 用"已有 release 流程托底"一笔带过，但既然 P0-1 / P0-2 都改 backend 进程行为，**第一个用 jarvis 之外项目的 Run 大概率是改 P0-1 / P0-2 自己的实现**。R4.2 的实际触发就在 v0.2 ship 的 0-30 天窗口，proposal 不能假装它在 release 流程之外。

---

## Open Questions 强意见

### OQ1（claude CLI skill 激活机制）—— 强意见：**必须先确认再设计 P1-4**

不是 reviewer 挑战项，是 author 必须先做 1 小时的 spike：实测 `~/.claude/skills/<x>/SKILL.md` frontmatter 加 `appliesTo` 字段后，CLI 是否会读这个字段（90% 概率不会，因为 SKILL.md schema 是 Anthropic 定义，appliesTo 不是其官方字段）。如果不会，P1-4 的整套设计直接作废，需要走 prompt 黑名单 / symlink swap 替代路径。**P1-4 不该 ship 直到 OQ1 落地**。

### OQ3（黑名单 regex 误伤）—— 强意见：**必须加 allowlist override 机制**

`pnpm db:migrate:dev` 这种 dev 别名会被命中是 false-positive 灾难。fix：(a) 黑名单严格匹配 argv[0] / argv[1] 完整词（不是 substring），(b) 加 `~/.claude-web/prod-guard-allowlist.txt` 让用户手动加 dev 别名。**ship P0-2 之前必须把现有 dogfood Run 历史命令（harness audit）跑一遍 dry-run 看误伤率**。

### OQ4（dogfood-self 默认还是 enum）—— 强意见：**single enum + NOT NULL 不允许 default**

`dogfood-self` 应当是单独枚举值（不是 default 兜底），且整个 `domain_profile` 列 NOT NULL **不带 DEFAULT**——强制创建时显式选择。理由：(a) default 'software-enterprise' 让 dogfood 期间 Eva 自己被分错类，PM agent 模板分支选错；(b) 不带 default 会 fail-loud（创建时漏字段就报错），符合 ADR-0014 fail-loud 原则。proposal §5 P0-4 当前设计违背项目自身原则。

### OQ5（per-project rate limit 上限 2）—— 弱意见

dogfood 期间 strategy → discovery → spec 是串行（同一 issue 上一个 stage 出 artifact 才能进下一个 stage），并发 2 完全够用。多 Subject 时希望并发 = 不同 issue 的并行——这个由 issue 维度的 fan-out 决定，不是 project 上限决定。**上限 2 偏保守但不影响实施**，可接受，M2 loop2+ 实测后再调。

OQ2 没有强意见。

---

## 建议的下一版改动

1. **统一 P0-1 inheritEnv 默认白名单**（§5 + §8 D1 任选其一），加 NVM_DIR / PNPM_HOME / CLAUDE_CONFIG_DIR；退出条件加正向回归"30 天 dogfood Run 命令 dry-run 不退化"
2. **P0-2 黑名单与 context-manager.ts NEVER_ALLOWED 同源**；先做 1 天 spike 实测 prod-guard + permission-hook 同链路冲突语义；fail-closed 写进退出条件；regex 改 argv 词级匹配
3. **P0-4 拆两个 migration**：0004 加 domain_profile 列（additive minor → 103），0005 改 methodology.applies_to enum（schema-rebuild major → 200 / 或独立 minor 加注 mode='schema-rebuild'）
4. **P0-4 把 dogfood-self 改成 NOT NULL + 不带 DEFAULT**；加 minClientVersion bump 字段；列出老 iOS 装包 graceful skip 行为
5. **P1-2 区分"后端字符串改"vs"iOS UI 改"两阶段**；ServerChan / Telegram 的 prefix 兼容性写进退出条件
6. **P1-3 备份范围扩**到 `~/.claude-web/` 整目录（含 artifacts/ + audit.jsonl + projects.json + telemetry.jsonl），不只 harness.db
7. **加 R8.9-R8.11**：iOS 协议升级未识别（漏报 minClientVersion） / ServerChan format 破坏 / .env.harness 备份缺失；P0-1 / P0-2 与 M2 loop2+ 串行 ship 写进 K10 不变量

---

## What I Did Not Look At

- proposal §1 业界 5 档表对应的外部 URL 是否真实可达（仅信任 author 说法）
- proposal §11 引用的 OpenHands #13268 / #13506 / #12660 三个 issue 实际内容（仅信任 author 摘要）
- packages/ios-native/Sources/ClaudeWeb/BackendClient.swift 当前 stateByConversation 的真实代码（proposal 引用未核对）
- packages/backend/src/scheduler.ts 实际单 setInterval 实现（proposal §3 F4 引用未核对）
- launchd plist 现状（`~/Library/LaunchAgents/com.claude-web.backend.plist`）
- docs/HARNESS_RISKS.md §8 当前是否已存在（proposal §7.1 假设是新增段）
- docs/HARNESS_DATA_MODEL.md §1.1 当前 Project 段措辞（proposal §7.4 修订建议未对原文）
- docs/IDEAS.md 现有 H 段编号是否真到 H17（proposal §7.2 假设 H18-H22 可新增）
- 长期 proposal `EVA_AS_PERSONAL_JARVIS.md` 是否存在 / 与本 proposal 的边界是否清晰
- M2 loop1 已 ship 的 `c4c08a6` 实际改了什么 / 与 P0-1 是否冲突（仅信任 author 声明 §0）
- claude CLI hooks 文档对 multiple hooks per matcher 的合并语义（BLOCKER-2 必须独立验证）
- claude CLI skill 加载机制是否会读 frontmatter 自定义字段（OQ1 必须独立验证）
