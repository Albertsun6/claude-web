# ADR-020: PIM 统一捕获入口（v2.1 个人 PIM 试点 backend 模块）

- **Status**: Proposed (2026-05-14，PIM M0 Day 0 草稿)
- **Date**: 2026-05-14
- **Deciders**: yongqian（待 review）
- **Tags**: pim, capture-entry, backend, eva-legacy-pattern, M0
- **Depends on**: [ADR-000 adopt-eva-codebase](ADR-000-adopt-eva-codebase-as-vessel-foundation.md), [ADR-006 schema-evolution](ADR-006-schema-evolution.md), [ADR-008 config-location](ADR-008-config-location.md), [ADR-013 rename-strategy](ADR-013-rename-strategy.md), [ADR-018 aisep-vs-harness](ADR-018-aisep-vs-harness.md)
- **Source**: 3 轮 /survey 调研 + 5 轮设计迭代 + Plan agent R1-R8 + cursor-agent 4 条 = 12 个独立审查点全 accept
- **Plan**: [`~/.claude/plans/mece-clever-wilkinson.md`](file:///Users/yongqian/.claude/plans/mece-clever-wilkinson.md)
- **v2.1 完整设计**: [`~/Desktop/HTMLvsMD/mece-final-v2.1.md`](file:///Users/yongqian/Desktop/HTMLvsMD/mece-final-v2.1.md)
- **Supersedes** (草稿状态): docs/adr/eva-legacy/ADR-0017-pim-minor-bump.md（在 Project/claude-web 上的同名 ADR——发现 Vessel 体系后弃用）

---

## Context

### 背景

经过 3 轮 /survey 调研得出的 v2.1 PIM 数据模型（扁平 Item + 5 桶 commitment_state + bounded/area 二分 + derived_from 多对多 + AI 三档授权），需要在 Vessel 落地。

### Vessel 体系定位（ADR-018 边界确认）

PIM **不属于** 现有 3 套并行 spiral：

| Spiral | 用途 | PIM 关系 |
|---|---|---|
| **HARNESS_*** (eva-legacy) | Eva 自身 SDLC 流程（Issue → Stage → Task）| 不是 PIM |
| **AISEP** (`packages/aisep-*/`) | AI 软件工程平台，开发各种软件 | 不是 PIM |
| **Steward V0** (`docs/BACKLOG.md` + 10 prompts) | Vessel 项目内部任务追踪 | 是 task subset，不是全 PIM |

PIM 是**用户自身的个人信息管理**（任务/笔记/灵感/通讯/日志/目标/项目），独立于 Vessel 项目自身 SDLC。

### 路径选择（用户评审 Round 3 决定）

**路径 = backend 加模块（eva-legacy pattern）**——快速 ship，接受未来推 capability 化时要重构。具体：
- 在 `packages/backend/src/` 加 `pim-*.ts` 模块
- 在 `packages/backend/src/routes/` 加 `pim.ts`
- migration 文件按 ADR-006 顺序加 `0008_pim_item.sql`
- 不强行做 `packages/capability-pim/` Capability App 封装（推迟到 v0.2+）

显式承认这是"试点代码"（参考 ADR-018 §"代码物理混合是 HARNESS_* 在 backend 散布的痛点"）——本 ADR 在 §Risk-Triggered Migration 列出推 capability 化的触发条件。

### 关键事实校准（Plan agent 调研 codebase 后）

🔴 **`idea_capture` SQLite 表实际是 dead schema**——除了 [migrations/0001_initial.sql:87](../../../packages/backend/src/migrations/0001_initial.sql#L87) DDL 和 [test-harness-schema.ts:28](../../../packages/backend/src/test-harness-schema.ts#L28) 存在性断言，**没有任何 backend 代码写入或读取这张表**。

🔴 **真实捕获流量走 [inbox-store.ts](../../../packages/backend/src/inbox-store.ts) 写入的 `~/.claude-web/inbox.jsonl` JSONL 文件**——iOS InboxAPI 调 `POST /api/inbox` 写 jsonl，Web 同样。

🔴 **scheduler.ts 完全不引用 idea_capture**——所谓"idea → Issue → Stage → Task 流程"在代码里**不存在**，只是 eva-legacy HARNESS_PROTOCOL.md 的纸面意图。

### 修正后的实施意图

用户"统一为 PIM"的核心意图 = 现在分散在 `inbox.jsonl + Issue` 的捕获语义，统一升级为 v2.1 PIM Item。

修正方案（避开 schema-rebuild + 触发 ADR-006 "4 类硬触发"红线）：
- 不去触碰 dead 的 idea_capture 表（留到 v2.2 集中处理，按 ADR-006 禁 DROP TABLE）
- **新建 pim_item 表 + 6 张关联表**（纯 additive，符合 ADR-006）
- **迁移 inbox.jsonl 数据**到 pim_item，并改 POST /api/inbox 为 dual-write（jsonl + pim_item）2 周缓冲
- Issue 表 ALTER 加 `pim_item_id` 字段（仅 ADD COLUMN，符合 ADR-006）

---

## Decision

### D1: schema 演进遵循 ADR-006，不引入 eva-legacy "minor bump" framing

按 [ADR-006 schema-evolution](ADR-006-schema-evolution.md) 的 **5 条原则 + 4 类硬触发**：
- ✅ 加 schemaVersion + migrations/ 顺序文件
- ✅ Eva v102 schema 沿用，本 milestone 加 `0008_pim_item.sql`（v103，见 D4）
- ✅ 每个 migration 一个 milestone（PIM = M0-PIM）
- ✅ deprecated 字段保留 ≥ 1 个 minor 版本（idea_capture 表本期不动）
- ❌ 不 DROP COLUMN / DROP TABLE / DROP INDEX（ADR-006 §"4 类硬触发"）

**版本号变更**：
- DB：`PRAGMA user_version 102 → 103`
- TS 接口：`schemaVersion` 字段加到 PimItemDto

### D2: 保留 idea_capture 表不动（ADR-006 §4 类硬触发）

不在本次迁移里 drop / rename / 改 idea_capture——它是 dead schema，零数据，零引用。按 ADR-006 禁 DROP TABLE 红线，**不允许 drop**。留待未来某次 owner 显式 escalation + 手动 review schema diff 时一次性处理（如果价值证明清理 > 保留成本）。

### D3: 迁移源是 inbox.jsonl，不是 idea_capture

Day 2 编写 `scripts/migrate-inbox-to-pim.ts`，源是 `~/.claude-web/inbox.jsonl`，目标是 pim_item 表。

字段映射：
- `body` → `content`
- `source` 保留（"ios"/"text"/"voice"/"web"）
- `capturedAt` → `captured_at`
- `triage.destination='archive'` → `commitment_state='archived'`
- 其余 → `commitment_state='inbox'`
- `processedIntoConversationId` → 记录到 derived_from edge

**POST /api/inbox 改为 dual-write**：继续写 inbox.jsonl + 同步写 pim_item，缓冲 2 周后（Week 3 末）标 inbox.jsonl 为 `.deprecated`，真正废弃推到下一个 milestone（涉及 DROP file，需 owner escalation）。

### D4: migration `0008_pim_item.sql`（避开 ADR-006 预留 0004-0007）

按 ADR-006 §"每个 migration 一个 milestone"，编号预留如下：

| Migration | Milestone | 状态 |
|---|---|---|
| 0004_workflow_state.sql | M1C-A | 未实施 |
| 0005_embedding.sql | M1C-B | 未实施 |
| 0006_soul_history.sql | M2-Soul | 未实施 |
| 0007_capability.sql | M2+ | 未实施 |
| **0008_pim_item.sql** | **M0-PIM**（本 ADR） | 本期实施 |

PIM 作为 M0 milestone 在 schedule 上是先于 M1C-A 的，但为避免占用预留号 + 让 schema_migrations 表的 timeline 反映实际实施顺序，**用 0008**。如果 owner 后续重排 milestone schedule（如把 PIM 改成 M0-PIM 占用 0004），需另起 ADR amend 本决策。

### D5: pim_item 表 schema（纯 additive，符合 ADR-006）

migration `packages/backend/src/migrations/0008_pim_item.sql` 包含：

1. `CREATE TABLE pim_item`（核心实体）
2. `CREATE TABLE pim_commitment_state_history`（commitment_state 历史快照，承认意图漂移）
3. `CREATE TABLE pim_domain_tags`（多对多 domain 关联）
4. `CREATE TABLE pim_people_refs`（多对多人物关联）
5. `CREATE TABLE pim_intent_snapshot`（意图向量快照表，Week 4+ 用，Week 1 先建表）
6. `CREATE TABLE pim_refs`（derived_from 多对多边）
7. `CREATE TABLE pim_audit_summary`（每日 sanity 报告聚合表）
8. `CREATE VIRTUAL TABLE pim_item_fts USING fts5(content, content='pim_item', content_rowid='rowid')` + INSERT/UPDATE/DELETE triggers（参考 [migrations/0001_initial.sql:67-80](../../../packages/backend/src/migrations/0001_initial.sql#L67) issue_fts 模式）
9. `CREATE INDEX idx_pim_commitment ON pim_item(commitment_state)`
10. `CREATE INDEX idx_pim_captured_at ON pim_item(captured_at DESC)`
11. `ALTER TABLE issue ADD COLUMN pim_item_id TEXT REFERENCES pim_item(id)` —— ADR-006 允许的 additive 操作
12. `PRAGMA user_version = 103`

**pim_item 关键字段**：
- `id TEXT PRIMARY KEY`
- `content TEXT NOT NULL`
- `captured_at INTEGER NOT NULL`（unix ms）
- `source TEXT NOT NULL`
- `commitment_state TEXT NOT NULL DEFAULT 'inbox'` —— **TEXT 无 CHECK**（见 D6）
- `modality TEXT NOT NULL DEFAULT 'text'` —— TEXT 无 CHECK
- `ai_status TEXT DEFAULT 'pending'` —— 状态机：pending / running / done / failed / timeout / disabled
- `visibility TEXT DEFAULT 'private'`
- `owner_user_id TEXT` —— 预留多用户字段（见 D7），本期 NULL

### D6: commitment_state / modality / ai_status 用 TEXT 无 CHECK enum 约束

不同于 [migrations/0001_initial.sql](../../../packages/backend/src/migrations/0001_initial.sql) 现有表（issue.source / status / priority 全用 CHECK enum），pim_item 的 commitment_state / modality / ai_status 字段**仅用 TEXT 类型，不加 CHECK 约束**。

**理由**：
- v2.1 红线 #10 "不要先建分类法"——commitment_state 取值在 14 天捕获后由真实数据决定，初期可能频繁调整
- ADR-006 §Consequences："enum CHECK 收窄需 schema-rebuild（避免）"——本期 commitment_state 是探索状态，收窄概率高
- 改用**应用层规范化 + 白名单 warn + 索引 + 每日 sanity 报告**兜底：
  - `pim-queries.ts` 写入前 `trim().toLowerCase()` + 白名单（`PIM_COMMITMENT_STATES` 在 shared 包定义）
  - 不在白名单的值打 audit warn 但允许写（保留弹性）
  - 每日日志输出 `SELECT commitment_state, count(*) FROM pim_item GROUP BY commitment_state`，typo 立刻可见

**反全表风格代价**：明知 0001 用 CHECK enum 而本表不用，code review 会被挑——本 ADR 显式声明此偏离 + 理由 + 兜底，规避代价。

### D7: owner_user_id 字段预留（不实现逻辑）

migration 0008 加 `owner_user_id TEXT NULL` 字段，**但本期所有 query / API / UI 不读不写**——本期是单用户，token 单一不区分。

**理由**：未来多用户场景需要 owner，**届时如果没有这个字段，需要 schema-rebuild**（ADR-006 §"DROP COLUMN 禁止"+"加 NOT NULL 字段需 rebuild"，万级数据量代价高）。零成本预留。

### D8: 5 接口契约不强行落地（M0 限定）

按 ADR-000 §2，Vessel 顶级抽象是 5 接口（agent / app / memory / skill / tool）。理论上 PIM 应该接 **Memory 接口** 或 **App 接口（Capability App）**。

**本期 D 决策**：不强行落 5 接口契约，走 eva-legacy backend 模块路径。理由：
- 5 接口契约文件 `packages/backend/src/interfaces/memory.ts` 等可能尚未稳定（按 ADR-000 是 0A 时落地）
- PIM 是 M0 试点，需要快速 ship 验证 v2.1 设计
- 推 capability 化的触发条件见 §Risk-Triggered Migration

未来 v0.2+ 推 capability 化时，将 PIM 重构为：
- `packages/capability-pim/manifest.yaml`
- `packages/capability-pim/src/` Memory 接口实现
- backend `routes/pim.ts` 改为 thin adapter

### D9: 数据目录暂用 `~/.claude-web/`，等 ADR-013 Stage 2 触发后迁移到 `~/.vessel/`

按 [ADR-008 config-location](ADR-008-config-location.md)，Vessel 目标数据目录是 `~/.vessel/`。但 [ADR-013 Stage 2](ADR-013-rename-strategy.md) 数据目录迁移尚未触发（`~/.claude-web/` 还有 harness.db / inbox.jsonl 真实数据，`~/.vessel/` 不存在）。

**本期 D 决策**：PIM 暂用 `~/.claude-web/`，避免本期同时触发 ADR-013 Stage 2（独立工作量）。等 ADR-013 Stage 2 触发后，PIM 数据**自然跟随**（harness.db 和 inbox.jsonl 一起迁）。

### D10: 四端同步（参考 eva-legacy ADR-0015 §"四端同步流程"）

ADR-006 没明确替代"四端同步"机制——这块仍参考 eva-legacy [ADR-0015](../eva-legacy/ADR-0015-schema-migration.md) §"四端同步流程"。本 ADR 显式申明继承该机制：

1. ① [migrations/0008_pim_item.sql](../../../packages/backend/src/migrations/) 新建
2. ② [packages/shared/src/harness-protocol.ts](../../../packages/shared/src/harness-protocol.ts) 加 `PimItemDtoSchema` Zod
3. ③ [packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift](../../../packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift) 加 `PimItemDto` struct —— **所有新字段 Swift 端必须 Optional**（eva-legacy ADR-0015 §F1 BLOCKER）
4. ④ [packages/shared/fixtures/harness/pim-item.json](../../../packages/shared/fixtures/) 加样例
5. ⑤ [packages/backend/src/test-harness-schema.ts](../../../packages/backend/src/test-harness-schema.ts) `EXPECTED_TABLES` 加 `pim_item` + 6 张关联表
6. ⑥ 跑 round-trip 测试：TS encode → Swift decode → Swift encode → TS decode 不丢字段

**iOS Sources 目录现状**：仍叫 `packages/ios-native/Sources/ClaudeWeb/`（ADR-013 Stage 1-3 渐进改名中，本期不触发 Swift 层 rename）。

**新增 server-driven config 字段（4 处同步）**：本 ADR 引入 `pim.commitmentStates: string[]`，按 eva-legacy [ADR-0011 §"server-driven thin-shell"](../eva-legacy/ADR-0011-server-driven-thin-shell.md)，必须 4 处同步：

1. [harness-protocol.ts:451-465 `HarnessConfigSchema`](../../../packages/shared/src/harness-protocol.ts) 加 optional `pim` 字段
2. backend `fallback-config.json` 加 `pim.commitmentStates` 默认值（["inbox", "action", "calendar", "waiting", "reference"]）
3. [HarnessProtocol.swift](../../../packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift) `HarnessConfig` struct 加 optional `pim`
4. config fixture + round-trip 测试

**否则**：[harness-config.ts:69-75 `HarnessConfigSchema.parse(fallback)`](../../../packages/backend/src/harness-config.ts#L69) 会 strip 掉 `pim.commitmentStates`（Zod 默认 strip unknown）。

### D11: rollback 用 better-sqlite3 在线一致性备份

[harness-store.ts runPendingMigrations()](../../../packages/backend/src/harness-store.ts) 中检测到将应用 0008 时，调用 `better-sqlite3` 的 `db.backup()` API 生成 `~/.claude-web/harness.db.before-0008.bak`。

**不用** `fs.copyFile`——避免 WAL 未 checkpoint 的竞态窗口（参考 cursor-agent Round 2 finding）。

**Rollback 步骤**（显式记录）：
1. `launchctl unload` backend（或停 tsx watch 进程）
2. 删 `~/.claude-web/harness.db` + `harness.db-wal` + `harness.db-shm`
3. `cp ~/.claude-web/harness.db.before-0008.bak ~/.claude-web/harness.db`
4. 删 `migrations/0008_pim_item.sql` 文件
5. 重启 backend；user_version 自动回退到 102

**演练**：Week 1 Day 7 + Week 2 Day 13 各演练一次（不演练 = 没有）。

### D12: AI Level 1 严格 fail-safe（独立 pim-ai-suggester）

新建 [pim-ai-suggester.ts](../../../packages/backend/src/pim-ai-suggester.ts)，**不复用** [cli-runner.ts](../../../packages/backend/src/cli-runner.ts)（后者是为 scheduler 长任务设计的流式接口）。

**契约**：
- `spawn claude --model haiku --output-format json -p "<short prompt>"` 短任务模式
- 30s `AbortController` 硬 timeout，超时 kill -9 child
- `pim_item.ai_status` 状态机：pending / running / done / failed / timeout / disabled
- orphan cleanup 抄 [scheduler.ts cleanupOrphanStages](../../../packages/backend/src/scheduler.ts) 模式
- 失败 24h 内不重试（退避）
- env var `PIM_AI_ENABLED=true|false`，AI 出问题手动关掉，pim_item 创建路径不受影响
- v2.1 红线："AI 永远 pending"——用户不点不生效

### D13: 本期 out-of-scope（明确不做）

3 周 MVP **不做**：
- ❌ intent_vector 生成 / derived_from 自动 semantic 推导（仅手动标 + Issue 联动）
- ❌ BoundedEndeavor / Maintenance 实体表（Week 4 数据出来后再决定）
- ❌ AI Level 2 / Level 3 自动化
- ❌ Telegram 任何通道（保留 [notifications/channels/telegram.ts](../../../packages/backend/src/notifications/channels/telegram.ts) 不动但 PIM 不接它）—— 用户评审决定
- ❌ Siri shortcut（推迟到 v2.2）—— 用户评审决定
- ❌ owner_user_id 多用户逻辑（字段预留，逻辑等 v2.2）
- ❌ CRDT / 乐观锁冲突解决（MVP 接受 last-write-wins + audit log + X-Device-Id）
- ❌ DROP idea_capture 表（D2，按 ADR-006 禁 DROP TABLE）
- ❌ Drop / rename inbox.jsonl 路径（Week 3 末标 .deprecated，真正废弃推到下次 milestone）
- ❌ Capability App 封装（D8，v0.2+ 触发 Risk-Triggered Migration 再做）
- ❌ 数据目录迁移 `~/.vessel/`（D9，等 ADR-013 Stage 2 触发）

---

## Consequences

**Pros**：
- ✅ 符合 ADR-006 5 条原则 + 4 类硬触发（纯 additive，零 DROP）
- ✅ harness Issue / Stage / Task 流程零破坏（D2 保留 idea_capture + D5 仅 ADD COLUMN）
- ✅ rollback 路径显式（D11）+ Week 1/2 演练
- ✅ commitment_state TEXT 弹性（D6）支持 v2.1 红线"14 天后再定 schema"
- ✅ AI fail-safe（D12）规避 Mem.ai 死法
- ✅ 与 Vessel kernel 哲学 partially aligned（D8 承认是试点，预留 v0.2+ capability 化路径）

**Cons**：
- ❌ migration 0008 加 7 张表 + 1 ALTER + 1 VIRTUAL TABLE + 2 INDEX，是 0001 之后最大的一次 schema 变更，迁移脚本复杂度高
- ❌ TEXT 无 CHECK enum 风格与 0001 不一致（D6 已声明偏离 + 兜底）
- ❌ dual-write 2 周缓冲期间 inbox.jsonl + pim_item 双写，一致性需要监控
- ❌ PIM 作为 backend 模块（不是 Capability App）违反 ADR-018 §"代码物理混合是 HARNESS_* 在 backend 散布的痛点"教训——本 ADR 显式承认是试点（D8）
- ❌ 引用 eva-legacy ADR-0011/0015 §"四端同步流程"和 §"server-driven thin-shell"（vessel/ 体系尚无对应抽象，D10 显式继承）

**不可逆度**：低（D2 + D3 + D11 三重防护）。回滚路径：db.backup() 恢复 + POST /api/inbox 回退 single-write，inbox.jsonl 数据完整无损。

---

## 替代方案及为何驳回

| 方案 | 驳回理由 |
|---|---|
| 在 docs/adr/eva-legacy/ 下加 ADR-0017 | 用户已选"Vessel 是新的，claude-web 是旧的"路线（评审 Round 3）；PIM 应该在 Vessel 体系下立 ADR |
| Capability App（packages/capability-pim/） | 5 接口契约文件可能尚未稳定；快 ship 优先（D8） |
| 扩展 Steward V0 BACKLOG.md 承载 PIM | BACKLOG.md 是 markdown 文件，不支持 v2.1 需要的 FTS5 / patch 语义 |
| 改造 idea_capture 表 + drop 老结构 | ADR-006 §4 类硬触发禁 DROP TABLE；idea_capture 零数据 drop 收益 = 0 |
| 把迁移源当作 idea_capture | idea_capture 是 dead schema，迁移会 0 行；真实数据在 inbox.jsonl |
| Telegram 双向 webhook + inline button 作主入口 | 用户已有 iOS + Web，不分散精力 |
| Siri shortcut Day 5 作第三入口 | iOS 工期已经紧；先聚焦 iOS + Web 两入口；Siri 推迟到 v2.2 |
| AI 自动 move（复用 cli-runner.ts） | cli-runner 是长任务设计；AI Level 1 应该短任务 + 30s timeout |
| commitment_state 加 CHECK enum | 改动要 schema-rebuild，违反 v2.1 红线"14 天后再调 schema"（D6） |
| 不预留 owner_user_id | v2.2 多用户场景需要 schema-rebuild（D7） |
| migration 用 0004 | ADR-006 把 0004 预留给 M1C-A workflow_state；改 0004 需另起 ADR amend |
| 数据目录直接用 `~/.vessel/` | ADR-013 Stage 2 数据目录迁移尚未触发；本期不触发它（独立工作量） |

---

## Risk-Triggered Migration

### 推 capability 化的触发条件（D8 延伸）

如果以下任一发生，**触发 PIM 重构为 `packages/capability-pim/` Capability App**：

1. **v0.2 release 后** 5 接口契约（特别是 Memory 接口）稳定落地
2. PIM 数据增长到万级，需要独立 schema namespace 避免与 backend 其他表混
3. 出现 PIM 之外的 capability 需要 reuse PIM 的 capture / search 能力（如 AISEP capability 集成）
4. 用户对 PIM 的隐私 / instance 隔离需求超出 backend 单 SQLite 文件能力（涉及 ADR-005 instance-isolation）

触发后：
- `packages/backend/src/pim-*.ts` 迁移到 `packages/capability-pim/src/`
- 实现 Memory 接口（`packages/backend/src/interfaces/memory.ts`）
- backend `routes/pim.ts` 改为 thin adapter
- migration 文件保留（数据不动）

### 其他 Risk-Triggered

- AI 建议成功率 < 50% → 关闭 PIM_AI_ENABLED，纯手动分类跑 14 天后再开
- dual-write 一致性出错 → 立即停 dual-write，inbox.jsonl 单写 + 离线 backfill pim_item
- commitment_state typo 比例 > 5%（每日 sanity 报告）→ 加 CHECK enum（走小型 schema-rebuild），需 owner escalation（ADR-006）
- Week 4 真实数据显示 5 桶不够 → 通过 server-driven config `pim.commitmentStates` 加值，schema 不改

---

## Review trail

- Plan agent R1-R8（8 个风险点）→ 全 accept 落地（详见 plan 文件 §Round 1）
- cursor-agent 异构终审 Round 1 4 条 → 全 accept 落地（HTTP 鉴权 / config 4 处同步 / db.backup / FTS 前置）
- 用户评审 Round 2 → 2 条变更（Siri 推迟 + Telegram 完全不要）落到 D13
- 用户评审 Round 3 → 发现项目体系实际是 Vessel 不是 claude-web，ADR 重 framing 为本 ADR-020
- 用户评审 Round 4 → 选"backend 加模块（eva-legacy pattern）"路径，本 ADR D8 落实

---

## 与其他 ADR 的关系

- [ADR-000](ADR-000-adopt-eva-codebase-as-vessel-foundation.md)：本 ADR 在 §2 "增量加 Vessel 特有"框架内，但**不强行落 5 接口契约**（D8）；推 capability 化路径见 Risk-Triggered Migration
- [ADR-006](ADR-006-schema-evolution.md)：本 ADR 严格遵循 ADR-006 5 条原则 + 4 类硬触发；migration 编号按 §"每个 migration 一个 milestone" 用 0008（D4）
- [ADR-008](ADR-008-config-location.md)：本 ADR D9 暂用 `~/.claude-web/`，等 ADR-013 Stage 2 触发后跟随迁移
- [ADR-013](ADR-013-rename-strategy.md)：本 ADR D10 承认 Sources/ClaudeWeb/ 命名空间仍保留（ADR-013 Stage 1-3 进行中）
- [ADR-018](ADR-018-aisep-vs-harness.md)：本 ADR §Context 明确 PIM 与 HARNESS_* / AISEP / Steward 三套 spiral **都不属于**，是第 4 条独立线
- [eva-legacy/ADR-0011](../eva-legacy/ADR-0011-server-driven-thin-shell.md)：D10 §"4 处同步" 继承该 ADR 的 server-driven 协议
- [eva-legacy/ADR-0015](../eva-legacy/ADR-0015-schema-migration.md)：D10 继承 §"四端同步流程"机制（vessel/ ADR-006 未替代该部分）

---

## 后续步骤（M0 Day 1+）

按 [plan 文件](file:///Users/yongqian/.claude/plans/mece-clever-wilkinson.md) 执行（**plan 文件 migration 编号需从 0004 改为 0008**）：

- Day 1: migration 0008 + db.backup() prestart hook + 四端同步起步
- Day 2: inbox.jsonl → pim_item 迁移脚本 + dual-write
- Day 3: pim-queries.ts + routes/pim.ts + server-driven config 4 处同步
- Day 4: iOS HTTP 鉴权修复 + PimCaptureView + Web /capture
- Day 5: buffer day
- Day 6: iOS 真机 deploy + 烟雾测试
- Day 7: rollback 演练 + Week 1 验收

本 ADR **升级为 Accepted** 的条件：Week 1 Day 7 验收通过（所有验收清单 ✅）。

---

## Open Questions（待 owner review 决定）

| # | 问题 | 默认选择 | 是否需要改 |
|---|---|---|---|
| Q1 | migration 编号 0008 vs 占用 0004（PIM 是 M0 优先于 M1C-A workflow_state） | 用 0008（避开 ADR-006 预留） | 取决于 milestone schedule 是否要重排 |
| Q2 | 数据目录 `~/.claude-web/` vs `~/.vessel/`（触发 ADR-013 Stage 2） | 暂用 `~/.claude-web/` | 取决于 ADR-013 Stage 2 是否本期一起做 |
| Q3 | ADR-022 已存在（aisep v2 fan-in），本 ADR 用 ADR-020 跳过 020/021 预留？ | 用 ADR-020 | 取决于 020/021 是否真有预留意图 |
| Q4 | 是否需要在 docs/adr/vessel/README.md（如有）登记本 ADR + supersede 矩阵？ | 是 | 看 vessel/ 是否有 README index |
