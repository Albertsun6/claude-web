# Phase 2 React — Cross lens

**Reviewer**: reviewer-cross  
**Model**: gpt-5.5-medium  
**Date**: 2026-05-05 23:48  
**Phase**: 2 (cross-pollinate)  
**Read**: own round 1 cross verdict + sibling round 1 arch verdict + proposal v0.1

## 对 sibling (arch) 每条 finding 的逐条表态

### Sibling-B1 [BLOCKER] P0-1 env 白名单矛盾且未验证 pnpm/npm 工具链 — refine

**对方原文摘要**: §5 与 §8 D1 的 env 白名单不一致，且缺 `NVM_DIR` / `PNPM_HOME` 可能让 dogfood implement stage 全挂。  
**我的表态**: refine  
**理由**: 我 round 1 把它判为 Major，sibling 提供了更强的回归面证据：`cli-runner.ts` 是所有 spawn 单点，且退出条件只测负向 canary，不测正向工具链。这足够升级为 blocker。  
**新建议**: 统一白名单为 D1-B + `CLAUDE_CONFIG_DIR`；退出条件加 `pnpm/node/tsx/vitest/git` 正向 dry-run；escape hatch 不建议用“空数组回退 process.env”，容易把安全默认绕掉，应改为显式 `inheritMode: "curated" | "full"`，默认 curated，full 只能本机配置开启并打审计日志。

### Sibling-B2 [BLOCKER] prod-guard 与 permission-hook 同链路冲突语义未定义 — agree

**对方原文摘要**: permission-hook fail-open，prod-guard 必须 fail-closed；如果 Claude hooks 多 hook 合并语义不保证任一 deny 即拒，P0-2 安全门可能失效。  
**我的表态**: agree  
**理由**: 这是我 round 1 没抓到的更底层问题。我只指出 regex 绕过，sibling 指出 hook 冲突语义本身未验证；如果 allow/deny 合并行为不确定，regex 质量再好也不能 ship。  
**新建议**: P0-2 先做 spike，验证 `allow + deny`、hook timeout、hook crash 三种行为；验证失败则合并为单 hook：prod-guard 先执行，命中 deny 直接短路，再进入 permission ask。

### Sibling-M1 [MAJOR] P0-2 黑名单覆盖不全且应与 NEVER_ALLOWED 同源 — refine

**对方原文摘要**: 黑名单漏 `rm -rf`、force push、publish、ssh rm 等，且 regex raw string 容易被 here-doc / 变量插值绕过。  
**我的表态**: refine  
**理由**: 我同意“与 `context-manager.ts` NEVER_ALLOWED 同源”的方向，也同意 raw regex 不够。但“在 cli-runner argv 层拦”需要谨慎：Claude Bash tool 给 hook 的通常是 shell command string，不一定天然有 argv 数组。  
**新建议**: v0.2 写成“两层”：hook 层做 shell tokenization + deny/fail-closed；cli-runner 层只负责强制注入 guard，不假设能拿到 argv。后续如果工具 payload 有结构化 argv，再升级。

### Sibling-M2 [MAJOR] P0-4 schema rebuild 不是 additive — agree

**对方原文摘要**: `harness_project.domain_profile` 加列是 additive，但扩 `methodology.applies_to` CHECK enum 必须 schema-rebuild。  
**我的表态**: agree  
**理由**: 与我 round 1 B1 完全一致。SQLite CHECK enum 不能简单 `ALTER TABLE` 修改，proposal 当前把两件事混成 `0004` minor bump 是 blocker。  
**新建议**: 拆成 `0004` additive 加列与 `0005` schema-rebuild 改 enum，并明确数据 copy、rollback、migration test。

### Sibling-M3 [MAJOR] P1-2 iOS 改动被低估 — agree

**对方原文摘要**: 通知 title 前缀可后端改，但顶栏切换器和 Inbox 分组必须改 SwiftUI，不是“不动 iOS 代码”。  
**我的表态**: agree  
**理由**: 我 round 1 B2 提到 iOS picker / DTO / registry split-brain，但没指出 P1-2 的“server-driven”描述过度乐观。这个会影响用户对是否需要重装 iOS 的预期。  
**新建议**: v0.2 把 P1-2 拆成后端通知 prefix 与 iOS UI 分组两步，后者明确需要新 build / simulator + 真机验证。

### Sibling-M4 [MAJOR] P0/P1 风险预算偏乐观，P0-1 与 M2 loop2 应串行 — agree

**对方原文摘要**: P0-1 改 `cli-runner.ts` 与 M2 loop2 可能同改 spawn 路径，不应简单说并行。  
**我的表态**: agree  
**理由**: 这是工程排期层面的真实冲突。worktree 隔离只能隔离文件系统，不能消除同一核心路径的语义冲突。  
**新建议**: 加 K10：P0-1 与任何改 `cli-runner.ts` spawn/env/args 的 M2 loop 必须串行合并，或者先落 P0-1 后让 loop2 rebase/cherry-pick。

### Sibling-M5 [MAJOR] domain_profile 5 选与企业管理系统垂直脱节 — refine

**对方原文摘要**: `software-enterprise` 太粗，订单/CRM/财务/库存等业务领域模板差异很大。  
**我的表态**: refine  
**理由**: 我同意当前 enum 太粗，不能支撑 PM 模板深分支。但我不建议 P0 schema 直接加完整 `business_domain` enum，因为这会把更多未来不稳定分类固化进 SQLite。  
**新建议**: P0 只保留粗粒度 `domain_profile`，并把 enterprise 子领域作为 PM spec 的必填输入字段或 `project_profile_json.businessDomain` 非约束字段。等真实跑 3-5 个企业项目后再决定是否升为强 schema。

### Sibling-M6 [MAJOR] 备份范围不应只备 harness.db — agree

**对方原文摘要**: 只备 `harness.db` 会漏 artifacts、audit、projects、telemetry，灾难恢复仍然缺半边数据。  
**我的表态**: agree  
**理由**: 我 round 1 只指出备份完整性校验不足，sibling 补上了备份对象范围，这是更前置的问题。  
**新建议**: P1-3 改为备份 `~/.claude-web/` 的一致性快照，至少包含 `harness.db`、`artifacts/`、`harness-audit.jsonl`、`projects.json`；退出条件加 `integrity_check` 和一次恢复演练。

### Sibling-M7 [MAJOR] iOS 协议升级 / minClientVersion 未识别 — agree

**对方原文摘要**: 老 iOS 不传 `domain_profile` 会被 default 兜底，永远建不出非 enterprise project，需要 minClientVersion 计划。  
**我的表态**: agree  
**理由**: 这加强了我 round 1 B2 的跨端契约问题。只靠默认值会制造静默错误，不符合 fail-loud。  
**新建议**: `ProjectDTO` 明确 `domainProfile` 可选读取、创建时新客户端必传；服务端对老客户端创建项目给出可见 warning 或要求升级，而不是静默 default。

### Sibling-M8 [MAJOR] ServerChan / Telegram notification prefix 是外部 contract — refine

**对方原文摘要**: 给通知 title 加 `[projectName]` 也会影响 ServerChan / Telegram 下游解析。  
**我的表态**: refine  
**理由**: 风险成立，但严重度取决于现有消息是否承诺稳定格式。当前更稳妥做法不是禁止 prefix，而是把 channel-specific 格式拆开。  
**新建议**: v0.2 要求通知 payload 保留结构化字段 `projectName/projectId`，iOS lockscreen 可显示 prefix；ServerChan / Telegram 先保持原 title 或追加末尾字段，避免破坏用户 webhook。

### Sibling-M9 [MAJOR] .env.harness 备份策略遗漏 — agree

**对方原文摘要**: P2-3 引入 `.env.harness` 后，如果不备份，损坏会导致本地私有配置丢失。  
**我的表态**: agree  
**理由**: 这是 P2 但属于不可恢复风险。即使 `.env.harness` 可能含密钥，也必须至少定义“不自动备份 / 用户自行备份 / 加密备份”三选一。  
**新建议**: 不把 `.env.harness` 混入普通快照；P2 设计时单独给加密备份或显式排除策略，并在 UI/文档里提示。

### Sibling-M10 [MAJOR] F8 自指风险触发面被低估 — agree

**对方原文摘要**: P0-1/P0-2 自身会改 backend spawn/hook，正好可能触发“改坏 harness 进程自身”。  
**我的表态**: agree  
**理由**: proposal 把 F8 放到已有 release 流程托底，但本 proposal 的第一批改动就是高风险 backend 自指改动。  
**新建议**: P0-1/P0-2 加 dogfood 前的本地 smoke gate：backend health、一次 harmless prompt、一次 Bash deny、一次允许普通 `git diff`。

### Sibling-OQ1 [MAJOR] skill 激活机制必须先 spike — agree

**对方原文摘要**: `appliesTo` 不是 Claude CLI 官方 skill schema 字段，P1-4 不能在未验证前进入执行清单。  
**我的表态**: agree  
**理由**: 与我 round 1 M4 一致。  
**新建议**: P1-4 改为 spike，产出“CLI 是否读取自定义 frontmatter / 可否隔离 skill dir / prompt 禁用是否有效”三项结论后再设计。

### Sibling-OQ3 [MAJOR] prod-guard 需要 allowlist override 和历史 dry-run — refine

**对方原文摘要**: `pnpm db:migrate:dev` 误伤会很痛，需词级匹配、allowlist、历史命令 dry-run。  
**我的表态**: refine  
**理由**: allowlist 有必要，但不能让项目内文件随便覆盖 prod guard，否则恶意或误改 `.allowlist` 会绕过安全门。  
**新建议**: allowlist 放 `~/.claude-web/prod-guard-allowlist.json`，只允许用户手工编辑或 UI 确认写入；每条 allow 记录 matcher、reason、createdAt，并出现在 audit log。

### Sibling-OQ4 [MAJOR] domain_profile NOT NULL 不带 DEFAULT — refine

**对方原文摘要**: `domain_profile` 应强制创建时显式选择，不能 default `software-enterprise`。  
**我的表态**: refine  
**理由**: 对新项目我同意 fail-loud；但对 migration 中已有 `harness_project` rows，SQLite 加 NOT NULL 无 DEFAULT 不现实，需要一次 backfill 策略。  
**新建议**: migration 阶段先 nullable/backfill：已知 Eva cwd 写 `dogfood-self`，其余 legacy 项目标 `unknown` 或 `software-enterprise` 并打待确认标记；新创建 API 强制必传，稳定后再考虑 NOT NULL。

### Sibling-OQ5 [MINOR] per-project rate limit 上限 2 可接受 — agree

**对方原文摘要**: dogfood stage 多数串行，上限 2 偏保守但不影响实施。  
**我的表态**: agree  
**理由**: 这不是 blocker。M2/M3 先保守，真实多 Subject 后再调更合适。  
**新建议**: 加可配置默认值即可，先不为调度策略扩复杂模型。

## 我自己 round 1 verdict 的自我修正

我会把自己的 M1 升级为 blocker：env 白名单矛盾不只是文档一致性问题，而是 `cli-runner.ts` 单点改动可能让现有 dogfood implement stage 大面积 ENOENT / command not found。我的原 verdict 低估了正向工具链验证的重要性。

我会新增一个 blocker：prod-guard 与 permission-hook 的多 hook 合并语义未验证。我的 round 1 M3 只看了 regex false negative，没有先确认“deny 是否一定压过 allow”这个前置条件，这是遗漏。

我会扩展自己的 B2：跨端契约不只需要 `ProjectDTO.domainProfile` / Swift Codable，还需要 minClientVersion 或老 iOS 创建项目的 fail-loud 策略，否则 default 会制造静默分错类。

我会调整自己的 m3：备份问题从“缺完整性校验”升级为“备份范围不完整 + 缺恢复演练”。只校验 `.db` 不够。

## 新发现（new-finding）

### NF1 [BLOCKER] prod-guard 必须先证明 hook deny 优先级，否则所有黑名单讨论都没有安全基础

sibling 的 BLOCKER-2 是这轮最重要的新盲区。v0.2 应把 hook 冲突 spike 放到 P0-2 的第一步，不通过就合并 hook，不允许继续设计双 hook 并行。

### NF2 [MAJOR] `domain_profile` 应区分“粗技术类型”和“业务子领域”

`software-enterprise` 对订单/CRM/财务都太粗，但把业务子领域立即做成强 enum 也太早。建议 P0 schema 只固化粗类型，PM spec 里强制采集 business domain；等真实样本足够后再迁移成正式字段。

### NF3 [MAJOR] 通知 prefix 是跨 channel contract，不是单纯 iOS 文案

P1-2 需要把 iOS lockscreen、ServerChan、Telegram 分 channel 定义格式，避免为了 iOS 多项目可读性破坏已有外部通知消费。
