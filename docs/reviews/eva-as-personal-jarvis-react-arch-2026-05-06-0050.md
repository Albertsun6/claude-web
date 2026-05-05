# Phase 2 React — Architecture lens

**Reviewer**: harness-architecture-review
**Model**: claude-opus-4-7
**Date**: 2026-05-06 00:50
**Phase**: 2 (cross-pollinate)
**Read**:
- own round 1 arch verdict: `docs/reviews/eva-as-personal-jarvis-arch-2026-05-06-0042.md`
- sibling round 1 cross verdict: `docs/reviews/eva-as-personal-jarvis-cross-2026-05-06-0042.md`
- proposal v0.1: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md`

---

## 对 sibling (cross) 每条 finding 的逐条表态

### Sibling-B1 [BLOCKER] M5 允许 health/finance domain 上线但加密 sidecar 仍是 J3 待拍板事项 — **agree**

**对方原文摘要**：M5 准入条件只要求 AI_ASSESSMENT 三条 P0，但没有要求 J3 加密 sidecar 已实现；M5 退出条件提到 health domain 血压 / 体重 UI hint。这条落地路径会导致敏感数据先进未加密 harness.db，再等 M7 / J3 后补加密 = 不可逆迁移。

**我的表态**：agree

**理由**：这是我 round 1 漏掉的真盲区。我把 M5 准入条件"AI_ASSESSMENT P0 三条"误读成了"敏感数据保护已就位"——但 P0 三条（fail-closed permission + safe startup + WS payload limit）只是网络层 / 启动层 / WS 层的安全 gate，不覆盖**存储层加密**。proposal §5 M5 退出条件 L138 明文提到 "至少 1 个 routine domain Subject 实测"、§5 §核心动作 L127 提到 "iOS server-driven schema 加 domain-specific UI hints（如 health domain 显示血压 / 体重 input 模板）"——只要 M5 准入不强制 J3 加密落地，按 proposal 文本任何 health Subject 都可以在 M5 期间创建并落 harness.db 主库。明文血压 / 体重 / 财务流水进未加密 .db = 后续迁移要做 backfill + 备份清理 + telemetry 清洗，等于把 v0.3 的 K7 ADR-0010 "schema migration additive only" 路线撕开一个不可逆的口子。这条与我 round 1 BLOCKER-3（M5 退出条件 routine domain 占位失败）属于不同维度：BLOCKER-3 是"退出条件不可执行"，sibling B1 是"落地路径触敏感数据不可逆"——两条独立成立，不冲突。

---

### Sibling-B2 [BLOCKER] K-jarvis 编号引用错位 — **agree**

**对方原文摘要**：proposal §6 表格定义 K-jarvis-1 = 主动性预算、K-jarvis-2 = Decision approve、K-jarvis-3 = 一键全关、K-jarvis-4 = 不做全屏感知；但 §5 M8 段 L200-L208 + §4 表格 L89 全部把"主动性预算硬上限"绑成 K-jarvis-2，与定义错位。

**我的表态**：agree

**理由**：我自己核对了 proposal 行号——L200 "M8 主动观察层（**严格在主动性预算约束内**）"、L202 "K-jarvis-2 主动性预算硬上限"、L206 "K-jarvis-2 主动性预算硬上限实现且 server-driven 可调"、L208 "K-jarvis-2 没被违反"，全部错绑。我 round 1 没抓到这条，因为只读了 §6 不变量定义没回头交叉核 §4 / §5 的 M8 段引用。同意 sibling 把这条提到 BLOCKER 级——proposal 一旦合入文档，下游 HARNESS_ROADMAP §0 #24-26 + iOS kill switch + push queue + telemetry acceptance-rate gate 都会按 K-jarvis-2 接线，错位会传染到 4 端，事后修复要走全文 grep + 改 4 端 + iOS server-driven config rev bump。不是普通 typo。

---

### Sibling-M1 [MAJOR] §4 表格把 v0.3 schema 计划写成已落地事实 — **agree**

**对方原文摘要**：proposal §4 表格用 ✅ 标 v0.3 P0-4a/b 已加 domain_profile + applies_to 扩展，但实际 migration 目录只有 0001-0003，0001 中 harness_project 没有 domain_profile，methodology.applies_to 仍是 3 选 (claude-web/enterprise-admin/universal)，0003 只加 failed_reason / failed_at。

**我的表态**：agree

**理由**：我 round 1 完全漏查 migration 文件实际状态——只读 proposal 文本和 docs/HARNESS_DATA_MODEL.md §1.1 / §1.6 / §2.5 (v0.3 sync 后 docs)，把"docs 已 sync"误推为"代码已落"。sibling 这条是真正的 cross-check 价值——arch reviewer 容易陷入"读 docs 论 docs"，cross reviewer 落到 git tracked artifact 抓事实漂移。这条还有一个我 round 1 没展开的连带影响：M5 准入条件 L120 "EVA_MULTI_PROJECT_USAGE v0.3 全 P0/P1 落地"如果 P0-4a/b migration 还没写代码，那 M5 启动门槛实际未达——proposal 整个时序假设受影响，不只是表格状态描述。建议 sibling M1 修复方案在"改 ✅ 为 ⏳"基础上加一句"M5 准入条件依赖 v0.3 migration 实际落地，需在 proposal v0.2 加一段 v0.3 implementation tracking 链回原 P0-4a/b PR"。

---

### Sibling-M2 [MAJOR] M5 exit condition 混入 M6/M8 能力 — **agree**

**对方原文摘要**：M5 明确"不引入 generic Memory 表"，但 M5 退出条件 L138 要求 routine domain "每天 push 1 条提醒 + 你回复 + 落 Memory 表"。push 属于 M8 主动层，Memory 表属于 M6。

**我的表态**：agree

**理由**：这条与我 round 1 BLOCKER-3 同根但侧面不同——BLOCKER-3 角度是 "retrospective issue-bound 不能占位 daily push（schema 约束）"，sibling M2 角度是 "M5 退出条件越界引用 M6/M8 能力（顺序约束）"。两个角度互补，问题真实。**唯一分歧**：sibling 评 MAJOR，我 round 1 评 BLOCKER。我倾向保持 BLOCKER 级——M5 outcome-based gate 失效是结构性问题，不只是退出条件文案改一改，必须与 BLOCKER-1（M5-M8 顺序重排）联动修，否则改完退出条件 routine 部分仍要等 M7。但 sibling 评 MAJOR 也可接受：如果 M5-M8 顺序保持不变，单改退出条件去掉 routine domain 也能局部 unblock。这分歧交给 phase 3 author 仲裁：要 unblock M5 退出条件 vs 要重排 M5-M8 顺序。

---

### Sibling-M3 [MAJOR] J3-A SQLCipher 与 §0 #11 冲突 — **agree**

**对方原文摘要**：J3-A 自称"SQLCipher 本质仍是 SQLite，不算新基础组件"，但 HARNESS_ROADMAP.md §0 #11 原文是 "SQLite + better-sqlite3 是除 Hono+WS 之外唯一允许的新依赖"。SQLCipher npm/native binding 至少是新依赖。

**我的表态**：agree

**理由**：sibling 这条的"边界由用户定，author 不能单方面宣称不冲突"判断对。我 round 1 在 BLOCKER-2 + 风险遗漏 FJ9 涉及 SQLCipher 但只评估了密钥丢失风险，没回头核查 §0 #11 边界——错过了这条。SQLCipher 不是 SQLite plugin 而是 fork（替换 sqlite3.so），better-sqlite3 必须重新编译 against libsqlcipher，部署链路（macOS launchd plist）要带新的 native dependency，与 §0 #11 "唯一允许的新依赖" 冲突明确。即使 author 仍想推 J3-A，必须显式触发 anchor gate（[HARNESS_ROADMAP.md §0.5](../HARNESS_ROADMAP.md) 7 问 anchor gate 第 5 条 "依赖增减"）+ 用户拍板例外，不能在 proposal 里就当事实接受。建议 sibling 修复方案的 J3-B（Node `crypto` application-level encryption）作为 default 推荐。

---

### Sibling-M4 [MAJOR] Memory kind 自由字符串缺最小注册 / 校验策略 — **refine**

**对方原文摘要**：proposal §5 M6 + OQ2 已识别 kind 命名漂移风险，但正文仍只给自由 dot-namespace。sibling 建议加 `memory_kind_registry`（kind_prefix / owner_domain / payload_schema_ref / deprecated_at）作为 minimum viable mitigation。

**我的表态**：refine

**理由**：sibling M4 是 author 坚持 schemaless 路线下的 minimum viable mitigation，方向对但**强度不够**——我 round 1 BLOCKER-2 的论证更彻底：kind 必须走 CHECK enum + 配套 0008+ additive migration，理由是 K7（schema additive 单源真相）+ ADR-0010/0015（enum 锁住四端）+ K12（跨端 enum graceful fallback）整套路线在 application-level registry 上失效。

**新建议**：sibling M4 的 registry 方案在 author 坚持 schemaless 时是最低安全网，但应当先回答两个 anchor 问题：
1. **K12 跨端 fallback 在 registry 上不成立**：K12 fallback 机制依赖 SQLite CHECK enum 边界（老 iOS 看到未识别 enum 值 → 走 fallback display），registry 是 application-level allowlist，老 iOS 没有 registry 同步机制 → 无法 fallback。如果 author 坚持 schemaless + registry，必须在 proposal v0.2 显式声明 "K12 在 Memory 表上不适用"。
2. **fact-extractor agent 自动生成新 kind 名时无 SQL-level 阻断**：registry 是事后维护，agent 在 retrospective 抽取时可以写入任意 kind（如 'fact.health.sleep.rem'），无 enum 时 INSERT 不会报错。如果 author 仍走 sibling registry 方案，必须配套：(a) fact-extractor 输出经 application gate 校验 against registry / (b) 不在 registry 内的 kind 走 quarantine_memory 表先隔离 / (c) 周期性 ritual review 决定是否升级到 registry。

我的强意见仍是 BLOCKER-2 的 CHECK enum 路线，sibling registry 方案作为 fallback 路径接受，但必须配套上面 (a)(b)(c) 三条 mitigation 才能算"最低安全网"。

---

### Sibling-m1 [MINOR] §0 说 5 条新风险但 §3 列 6 条 — **agree**

**对方原文摘要**：§0 L32 "5 条贾维斯专属新风险 R-K..R-P"，§3 L69 "失败模式清单（6 条贾维斯专属）"+ FJ1-FJ6。

**我的表态**：agree

**理由**：文本一致性 typo 实锤。R-K..R-P 字面是 6 条（K/L/M/N/O/P），但 §0 文案写"5 条"——内部数数都不对。修复改"6 条"即可。

---

### Sibling-m2 [MINOR] 一键全关边界 vs OQ3 author 倾向冲突 — **agree**

**对方原文摘要**：K-jarvis-3 表格 L235 "可一键全关 Observer / 主动 push / 跨 domain 跨 Subject 引用，degrade to v0.4.5"；OQ3 L319 "author 倾向 Observer / 主动 push 关，但 Memory 检索保留"。

**我的表态**：agree

**理由**：这条与我 round 1 OQ3 强意见同向——我 round 1 也认为 author 倾向（Memory 检索保留）是把"用户控制权回归"误读成"主动通道关停"。sibling 提的两档开关（`passiveMode` 只关 push / `strictLocalMode` 同时关跨 domain Memory 引用）是好 patch，比我 round 1 单档"完全 degrade"更友好——保留中间状态让用户分级控制。phase 3 author 仲裁应该接受 sibling 两档方案。

---

### Sibling-m3 [MINOR] 主动性预算缺计数口径 — **agree**

**对方原文摘要**："≤7 条 / 周"没定义计数维度（global / per-device / per-domain / per-Subject）和周边界（本机时区 vs UTC）。

**我的表态**：agree

**理由**：我 round 1 没列这条。落地时确实必须明确——M8 server-driven config 写入时这是 schema 字段语义，不能等 implementation 阶段再决定。sibling 默认推荐 "user-global, local timezone week, all devices combined" 合理，server 统一计数 + iOS 只显示状态也是 K4 thin shell 一致路线。

---

## 我自己 round 1 arch verdict 的自我修正

### 不撤回的 finding

- **BLOCKER-1（M5-M8 顺序错排）**：sibling 没有正面命中此问题（B1 是加密前置 / B2 是编号错位 / M2 是退出条件混入），保持 BLOCKER 级。
- **BLOCKER-2（Memory kind schemaless）**：sibling M4 给了 registry 中间方案，但我的 CHECK enum 路线立场更强且与 K7/K12/ADR-0010 整套 schema 严控路线更一致。保持 BLOCKER 级，但 ack sibling registry 方案是 fallback 安全网。
- **BLOCKER-3（M5 退出条件循环依赖）**：sibling M2 同根问题不同侧面，互补不替换。保持 BLOCKER 级。

### 加新维度（不撤回但补充）

- **新维度 1：M5 准入条件应加 J3 加密 sidecar 完成（sibling B1 触发）**。我 round 1 误把"AI_ASSESSMENT P0 三条"等同于"敏感 domain 保护就位"，错过了存储层加密前置。建议 phase 3 author 在 M5 准入条件加第 5 条：J3 加密决策已拍板且加密路径已实现 + 旧备份不含敏感明文。
- **新维度 2：proposal §4 表格状态与代码现实不符（sibling M1 触发）**。我 round 1 没查 migration 实际状态，只读 docs。修复时 §4 表格 ✅ 改 ⏳，并在 proposal v0.2 加 v0.3 implementation tracking 段。

### 不加新维度但回头看更精确

- **风险遗漏 FJ9 SQLCipher 密钥丢失**：sibling M3 让我看到 SQLCipher 还有"§0 #11 边界"问题（不只是密钥丢失）。如果走 J3-B（Node crypto application-level）则 FJ9 风险依然存在但范围小（密钥可以 Node crypto 自管），FJ9 修复方案应当与 J3 选项绑定——J3-A 走 Keychain + USB 二备份 + 月度演练；J3-B 走 Node crypto + 密钥轮转 ritual。

---

## 新发现（new-finding）

### NF1 [MAJOR] 加密 sidecar + 跨设备备份的密钥同步路径缺失

**Where**: §3 FJ1 跨设备备份 + §3 FJ4 加密 sidecar + J3-A SQLCipher 用 macOS Keychain（§8 J3）+ §9 OQ5 第二台设备

**Lens**: 风险遗漏 / 跨端对齐

**Issue**: sibling B1 + 我 round 1 OQ5 + FJ9 都涉及加密 + 跨设备备份，但**三者交叉处的密钥同步路径**没人评估：
- FJ1 缓解（每周 rsync 到第二台设备）—— 跨设备备份 .db
- FJ4 + J3-A —— health.db / finance.db 走 SQLCipher 用 macOS Keychain 存密钥
- OQ5 author 倾向 iPad + Tailscale rsync —— 备份目标 iPad

实际可达性：rsync 把 health.db 加密文件搬到 iPad 后，**iPad 没有该 Mac 的 Keychain**——iCloud Keychain 在 SQLCipher 路径下不一定可用（SQLCipher npm binding 在 iOS native app 上能否解密 macOS Keychain 原始密钥未知）。等于"备份恢复 ≠ 服务可用"——Mac 挂了 iPad 拿到加密 .db 但解密不了，等于 FJ1 缓解失效。

**Why this is a major**: 这是 sibling B1 +  我 round 1 OQ5 + FJ9 三者交叉的不可见漏洞，单独看每条都"有缓解"，但 cascading failure 时全部失效。proposal v0.2 必须正面回答密钥同步路径，否则 J3-A 推荐成立但 FJ1 缓解就失效。

**Suggested fix**: 在 proposal §8 J3 选项加第 4 个维度"密钥跨设备同步策略"：
- J3-A1: macOS Keychain + 1Password 二备份（密钥手动同步到 iPad 1Password）
- J3-A2: macOS Keychain + iCloud Keychain（依赖 iCloud Keychain 在 SQLCipher path 上可用——需 spike 验证）
- J3-A3: macOS Keychain + 加密 USB 物理传输（最保守）
- J3-B: Node crypto application-level + 密钥派生（passphrase + Argon2，跨设备共用 passphrase，无 Keychain 依赖）

J3-B 在跨设备同步维度上反而更友好——passphrase 不绑定 Keychain，只要用户记得 passphrase 就能在任何设备解密。再次为"不引入 SQLCipher 走 J3-B"加一条架构理由。

---

### NF2 [MINOR] SQLite FTS5 + Scheduler 并发写入的 race condition

**Where**: §5 M6 fact-extractor ritual + Scheduler

**Lens**: 风险遗漏 / 架构可行性

**Issue**: M6 fact-extractor 是"每次 retrospective 落库时自动跑"的轻量 ritual，但当前 Scheduler 设计是单进程 setInterval 跑（[scheduler.ts](../../packages/backend/src/scheduler.ts)）。如果 fact-extractor 与其他 ritual stage（如 reviewer / coder）并发跑，且都对 Memory 表 FTS5 索引写入，SQLite WAL 模式下 writer 互斥但 FTS5 trigger 触发的 index update 可能造成行锁延迟。

**Suggested fix**: M6 启动前做一次 spike：fact-extractor 与并发 stage runner 同时写入 Memory 表 + FTS5 索引的实测 p95 延迟。如果 > 100ms，考虑：(a) FTS5 索引 lazy build（写入只落 base table，FTS index 单独 cron 重建）/ (b) Memory 表使用单独 SQLite 文件 + WAL 模式独立。

---

## Phase 2 收敛信号

| 维度 | 数量 | finding 编号 |
|---|---:|---|
| 双向 agree | 8 | B1, B2, M1, M2, M3, m1, m2, m3 |
| 双向 disagree | 0 | （无显式反驳） |
| 单向 refine | 1 | M4（registry vs CHECK enum 强度差异） |
| 自我修正（不撤回，加新维度） | 2 | sibling B1 + sibling M1 触发 |
| New finding | 2 | NF1（密钥同步路径）+ NF2（FTS5 并发） |

**收敛度判断**：高度收敛。8 条 sibling finding 双向 agree（含 1 条 BLOCKER 升级 / 1 条本来就 BLOCKER），1 条 refine（不是 disagree，只是强度差异）。无显式 disagree 表示双 reviewer 在 jarvis 形态核心矛盾上判断方向一致，分歧只在"修法宽松 vs 严格"。

**Phase 3 author 仲裁建议优先级**：
1. **必收（双方均 BLOCKER）**：sibling B1 加密前置 + sibling B2 编号错位 + 我 BLOCKER-1 顺序重排 + 我 BLOCKER-3 退出条件 + sibling M3 SQLCipher 与 §0 #11 冲突。
2. **修法分歧**：sibling M4 registry vs 我 BLOCKER-2 CHECK enum——author 必须正面回答 schemaless 路线 vs enum 严格路线，不能两个都接受。
3. **优先采纳 sibling 给出更好 patch 的**：sibling m2 两档开关 vs 我 OQ3 单档 degrade——sibling 方案更友好，建议采纳 sibling。
4. **新发现优先级**：NF1 密钥同步路径 ≥ NF2 FTS5 并发——NF1 在 M5 启动前必须答，NF2 在 M6 启动前 spike 即可。

---

## What I Did Not Look At

- 没有读 author transcript / 思考流 / phase 3 author counter（phase 2 独立性约束）
- 没有做新的 fact-check 调研——只对 sibling 已有 finding 表态 + 自我修正 + new-finding（按用户工作流要求）
- 没有 cross-check sibling 在 cross verdict 中给出的 score（正确性 3.2 / 跨端对齐 3.4 / 不可逆 3.1 / 安全 2.7 / 简化 3.6）的具体打分依据
- 没有验证 SQLCipher native binding 在 macOS launchd plist 部署链路上的实际编译复杂度（M3 修复方案推 J3-B 但未 spike J3-A 实际成本）
- 没有验证 iCloud Keychain 在 SQLCipher 路径上的可用性（NF1 提到但未实测）
- 没有评估 sibling cross verdict 中 §False-Positive Watch 段（F? SQLCipher / F? routine exit condition）的判断
