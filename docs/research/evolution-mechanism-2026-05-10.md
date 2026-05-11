---
researched_at: 2026-05-10
review_after: 2026-08-08
sources_checked:
  - https://github.com/iAchilles/memento
  - https://github.com/TT-Wang/memem
  - https://github.com/studiomeyer-io/local-memory-mcp
  - https://glama.ai/mcp/servers/sosoyososo/lesson-mcp
  - https://docs.letta.com/advanced/memory-management/
  - https://docs.letta.com/concepts/memgpt/
  - https://www.letta.com/blog/agent-memory
  - https://python.langchain.com/api_reference/langchain/memory/langchain.memory.buffer.ConversationBufferMemory.html
  - https://python.langchain.com/api_reference/langchain/memory/langchain.memory.vectorstore.VectorStoreRetrieverMemory.html
  - https://docs.sentry.io/concepts/data-management/event-grouping/
  - https://docs.sentry.io/concepts/data-management/event-grouping/fingerprint-rules/
  - https://develop.sentry.dev/backend/application-domains/grouping/
  - https://www.honeycomb.io/blog/structured-events-basis-observability
  - https://docs.honeycomb.io/get-started/basics/observability/concepts/events-metrics-logs
  - https://linear.app/docs/labels
  - https://linear.app/changelog/2022-11-10-label-groups
  - https://www.atlassway.com/jira-project-management-best-practices-maximizing-labels-and-tags/
  - https://github.com/noahshinn/reflexion
  - https://arxiv.org/html/2603.07670v1   # Memory survey (towardsdatascience link)
  - https://towardsdatascience.com/a-practical-guide-to-memory-for-autonomous-llm-agents/
  - https://sqlite.org/fts5.html
  - https://github.com/asg017/sqlite-vec
  - https://diataxis.fr/
status: accepted
---

# Spike Report — 进化机制 L1-minimal 设计

> **触发**：用户要求决定"现在做哪种最小可行的 L1 进化机制 schema/工具"，让 4-way review 累积的 ≥10 条 lesson + 11 篇 verdict 文件可被结构化检索。按 ADR-015 §「DAR 触发条件」满足 2 项：
>
> - ✅ 引入新存储（memory.db 加表 / 可能引 FTS5 扩展）
> - ✅ 影响隐私（lesson 文本可能含 path / 命令 / 用户决策语义）
>
> **Resolves**: L1-minimal 进化机制选型，input 给后续 ADR + Phase 1 reviewer

---

## 1. 目标决策

要决定：**Vessel 现在做哪种最小可行的 L1 进化机制 schema/工具**，让 4-way review 累积的 lesson 在系统里**可结构化检索 + 长期存在**。具体要回答 6 个子问题：

1. 单表（retrospectives 通用）vs 多表（review / lesson / failure_pattern 拆分）？
2. FTS5 全文索引 vs 纯 grep + LIKE？
3. vector embedding 现在做 vs 推到 L2？
4. tags 自由文本 vs 结构化 enum？
5. 触发：纯 manual CLI 写入 vs auto post-closeout vs hybrid？
6. lesson 文本身份层（plaintext SQLite row）vs 双层（markdown source-of-truth + SQLite index）？

属于 ADR-015 DAR 检查表的：**引入新存储 + 影响隐私**。

L1-minimal 范围硬约束：≤ 200 LOC backend + 1 migration（编号待定，避开 0001 / ADR-006 §3 已 reserve 的 0004-0007）+ 2 CLI 子命令 + 1 HTTP route。**不做**：自动注入 ContextBundle / agent profile 自调 / 自重写。

---

## 2. 业界做法 (Prior Art)

> **复用规则**：[`0A-completion-sprint-prior-art-2026-05-09.md`](./0A-completion-sprint-prior-art-2026-05-09.md) 已深度调研 OpenClaw / SillyTavern / Letta / Goose / Aider / CrewAI / AutoGen / Open Interpreter / Pipecat。本节**不重写**这些项目，仅在适用时引用结论。

新调研 6 项目，按 fit 优先级排序：

### 类 A：直接可比 — Claude/MCP "lesson 持久化"项目（核心借鉴）

| 项目 | License | 活跃度 | 数据模型 | 捕获触发 | 检索 | Vessel 对照 |
|---|---|---|---|---|---|---|
| **sosoyososo/lessons-mcp** | 未声明（glama 不显） | 中（个人 MCP server） | **单表 + FTS5 影子表**；字段：category / tags / title / body；DB 路径 `~/.claude/lessons.db` | **纯 manual**：Claude 用 `record_lesson` tool 主动写入 + `suggest_metadata` 预览 tag/category 防 fragmentation | **FTS5 (tags/category/title)** + LIKE fallback for 中文 body | **几乎 1:1 对应 Vessel L1-minimal**。schema / 检索 / 触发 3 维度都对齐用户场景。强借鉴 |
| **TT-Wang/memem** | MIT | 中（Claude Code plugin） | **双层**：markdown 文件（source of truth，Obsidian vault `~/obsidian-brain/memem/memories/`）+ SQLite FTS5 (`~/.memem/search.db`) + graph (`~/.memem/graph.db`)。frontmatter: `id, schema_version, title, project, tags, related, created, updated, source_type, source_session, importance(1-5), status, valid_to, contradicts` | **Hybrid**：(a) 后台 daemon auto-mine session transcript 等 5 min "settle" 然后 Haiku call 抽 durable lesson；(b) `memory_save(content, title, tags, layer?)` 手动；(c) `memory_import` 批量 | FTS5 + graph relations | **memem 有用但偏重**：双层 markdown + 2 SQLite + Haiku auto-mining 超 Vessel L1 范围。**借鉴 frontmatter schema 字段（importance/status/contradicts/valid_to/source_session/related）**；**规避 auto-mine via LLM** 因 Vessel 个人单机 + 不上 LLM Driver（Haiku is API call） |
| **iAchilles/memento** | MIT | 中 | **Hybrid SQLite**：FTS5 + sqlite-vec（1024d BGE-M3 embedding）；entity / observation / relation 三类；importance enum: critical/important/normal/temporary/deprecated | 程序化 `create_entities` / `add_observations` / `create_relations`（manual） | **Hybrid**: FTS5 + 向量 + temporal/popularity/context/importance 加权 | **Memento 是 L1+L2 一体设计**：vector 部分超 Vessel L1。**借鉴 importance enum + temporal/importance 加权概念**，向量推到 L2（M1C-B sqlite-vec 引入时再做） |
| **studiomeyer-io/local-memory-mcp** | （需查） | 中 | SQLite + FTS5 + Knowledge Graph，13 MCP tools | 未深入查（已够 3 类 A 项目） | FTS5 | **不重复深入**，等 L2 决策时再看 KG 部分 |

### 类 B：通用 agent memory 方法学（架构参考）

| 项目 | License | 活跃度 | 数据模型 | Vessel 对照 |
|---|---|---|---|---|
| **Letta (MemGPT)** | Apache-2.0 | 高（已在 0A spike 中调研） | **三层**：Core Memory（in-context block 直接编辑）/ Recall Memory（conversation history search）/ Archival Memory（embedding 存储 via tool call） | Vessel L1 lesson **对应 Archival 一层**（"long running memory that does not fit context"）。Letta 用 typed block + agentic 自决定写入 ≈ Vessel L1 不要 — **Vessel L1 用 owner-explicit + reviewer-explicit 写入**（防 [自我反思污染] 风险，见 §10） |
| **Reflexion (NeurIPS 2023)** | MIT | 学术高引（noahshinn/reflexion） | **Episodic memory buffer**：actor 跑 trajectory → evaluator score → self-reflection LLM 输出 verbal feedback append → 后续 trial 取 buffer 作 context | 概念对照：Vessel 4-way review **就是** Reflexion 的 evaluator + self-reflection 工业版（人工 + AI subagent 多 lens 替代单 LLM 自评）。但 Reflexion 强调 "agent 自决定记什么" → Vessel 应**反过来**：retro 触发由 closeout milestone 强制（决策性 event），不让 agent 漂移决定 |
| **LangChain memory 5 backend** | MIT | 极高（LangChain JS/Python） | (a) ConversationBufferMemory（全保 raw）/ (b) ConversationSummaryMemory（LLM 压缩）/ (c) VectorStoreRetrieverMemory（向量 top-k）/ (d) EntityMemory（实体抽取）/ (e) CombinedMemory（叠加） | **多种 backend 是反模式**：LangChain 方法论 ≠ schema。Vessel **不抄 LangChain memory 类**，但 ConversationBufferMemory 对应"raw append-only"思路是 Vessel L1 起点 |

### 类 C：工业界错误聚合（schema 设计借鉴）

| 项目 | License | 活跃度 | 数据模型 | Vessel 对照 |
|---|---|---|---|---|
| **Sentry error grouping** | BUSL-1.1 / 部分 Apache | 极高 | **Fingerprint** 优先 → stack_trace → exception → message 4 层 fallback 算法；事件含 `error.type / error.value / level / logger / message / stack.* / tags / app / family / transaction`；breadcrumbs = "issue 之前的事件 trail" | **Fingerprint 思想可借**：Vessel lesson 也需要 dedup（"同一类教训"应聚合到一个 retro，不每次 closeout 都新创）。但 Vessel 量级低（10 条/月级），可**手工 fingerprint = topic + first-encountered milestone**，不需 Sentry 那套自动算法。**Breadcrumbs 不借**（Trace 协议已经覆盖 trace event log） |
| **Honeycomb wide structured events** | 闭源（SaaS） | 极高 | "Wide event"：单条事件容纳所有 dimension；查询时聚合 not 写入时聚合；高 cardinality 是 feature | **核心借鉴**：Vessel retro 表保留 raw event-level fields（不预先聚合），查询时 grep / FTS / 后续 vector 做聚合。**反对**：早期 schema 不要预先归一到 enum failure_class，避免框定后无法回溯 |
| **JIRA labels vs Components vs CustomFields** | 闭源 | 极高 | (a) Labels 自由文本 case-sensitive flat / (b) Components 项目级 dropdown 受控 / (c) Custom Fields 显式 schema | **强 lesson**：自由 tag = "Bug / Bugs / bug" fragmentation 不可避免；个人项目尤其。Vessel **应在 schema 上预选少量受控 enum + 自由 tags 并行**（Linear label-groups 也是这思路） |
| **Linear label groups** | 闭源 | 高 | **Label Groups**：mutually-exclusive labels in group（如 Issue Type group: Bug/Feature/Chore 只能选 1）+ 跨 group 自由组合 | **直接借鉴**：Vessel `kind` 字段做 enum-in-group（review_closeout / bug_lesson / decision / risk / spike）；`tags` 字段做自由文本 |

### 类 D：底层 SQLite 能力（实施参考）

| 项目 | License | 活跃度 | 关键事实 | Vessel 对照 |
|---|---|---|---|---|
| **SQLite FTS5** | Public Domain (SQLite) | 极高 | 内置 SQLite 模块（**better-sqlite3 默认编译进**，无需额外 extension）；virtual table + 4 个影子表（_data / _idx / _content / _config）；BM25 ranking；LSM-tree 内部结构；支持外部 content（`content=` option，避免数据复制） | **L1 直接用 FTS5**：零新依赖，零编译复杂度，零跨平台问题。better-sqlite3 已是 Vessel 现有依赖 |
| **sqlite-vec** | Apache-2.0 / MIT (dual) | 中（asg017，渐主流） | 单文件 C 扩展，Eva 已在 REFERENCES.md §7 计划 M1C-B 引入；**目前 Vessel 还未引** | **L1 不引 sqlite-vec**：等 M1C-B 时一并做（embedding 还需 ML worker，超 L1 范围） |

### 类 E：知识结构化（治理参考）

| 项目 | License | 活跃度 | 关键事实 | Vessel 对照 |
|---|---|---|---|---|
| **Diátaxis** | CC-BY-SA | 极高 | 4 类文档：Tutorial / How-to / Reference / Explanation。retrospective 属 **Explanation** 类（"deeper understanding via examples, comparisons, histories"） | **概念归位**：Vessel `docs/retrospectives/` 的 markdown 是 Explanation；retrospectives **表是 Reference**（结构化检索）。两者并存不冲突，markdown 仍是 source-of-truth，表是 index |
| **Roam / Logseq backlinks** | Logseq AGPL-3.0 / Roam 闭源 | 极高 | block-level reference + outliner + markdown source；backlinks 自动维护 | **不借**：双向链接 graph 是 L2/L3 能力；Vessel L1 用 `references` 字段（review_id / lesson_id 数组）做单向引用即可 |

---

## 3. 学术 / 标准参考

### Reflexion (NeurIPS 2023, Shinn et al.)

- 形式化"agent 自反思 → episodic buffer → 后续 trial 用作 context"。
- **Vessel 含义**：4-way review **就是** Reflexion 的工业实施变体；进化机制是 Reflexion 的 episodic buffer 落地。但 Vessel 不让 agent 自决定写入（避免 [Reflexion 失败模式 §10] 中"错误结论一辈子绕路"），改由 milestone closeout 强制 + owner 评审 gate。

### Memory Survey 2026 (arxiv 2603.07670)

> "Quality gates—confidence scores, contradiction checking against other memories, and periodic expiration—are necessary but still underdeveloped. A single incorrect reflection in a short-lived agent causes limited damage, but the same incorrect reflection persisting in a long-running production agent can be catastrophic."

- **Vessel 含义**：L1 必须从 day 1 就有 `status: active|deprecated|contradicted` + `contradicts: [retro_id]` 字段（即使 L1 不自动维护，留好 schema 让 owner 手动标记）。memem 的 frontmatter 已经有这两个字段，直接借鉴。

### Diátaxis Explanation 类型

- 4 类文档之一，"help user move from familiarity to deeper understanding"。
- **Vessel 含义**：retrospective markdown 文件归位 Explanation；表是 cross-cutting Reference index。这给"双层 vs 单层"决策一个 framework：**markdown 是叙事 source（Explanation），SQLite row 是结构化 fingerprint（Reference）**。

### W3C Activity Streams / OpenTelemetry resource attributes

- 调研搜索关键词覆盖但未深入：W3C Activity Streams 是 social actor/object/verb 模型，对 Vessel retrospective 价值低（不是 social）。OTEL resource attributes 已在 0A spike `gen_ai.*` 命名空间覆盖；retrospective 表字段不需要 OTEL 化（不是 trace/metric/log 任何一种）。

---

## 4. 对比表（按 Vessel 硬约束打分）

> 4 个候选方案：
>
> - **A**: 单 retrospectives 表 + 自由 tags + 纯 SQL LIKE/grep（最朴素）
> - **B**: 单 retrospectives 表 + tags + **FTS5 索引**（lessons-mcp 模式，**主推**）
> - **C**: 单表 + FTS5 + **sqlite-vec 向量**（memento 模式）
> - **D**: 双层 markdown source + FTS5 + graph（memem 模式）

| 维度 | A: 单表 + LIKE | **B: 单表 + FTS5** | C: 单表 + FTS5 + vector | D: 双层 markdown + FTS5 + graph |
|---|---|---|---|---|
| 个人单机 | ✅ | ✅ | ✅ | ✅ |
| 不上 LLM Driver | ✅ | ✅ | ⚠️ embedding 需 ML worker | ❌ memem auto-mine 走 Haiku API |
| TS 主栈 | ✅ better-sqlite3 现有 | ✅ better-sqlite3 默认带 FTS5 | ⚠️ 加 sqlite-vec C 扩展 | ✅ |
| Eva 复用 | ✅ memory.db 加 1 表 | ✅ memory.db 加 1 表 + 1 FTS5 影子表 | ✅ + sqlite-vec | ⚠️ 双 DB + Obsidian 假设（Vessel owner 未必用 Obsidian） |
| YAGNI | ✅ 最朴素 | ✅ FTS5 已存在零成本 | ❌ 向量是 L2 能力 | ❌ 双层 + auto-mine 是 L2/L3 能力 |
| 200 LOC backend 内 | ✅ ~80 LOC | ✅ ~150 LOC（FTS5 trigger + sync） | ❌ 估 ~400 LOC（embedder + vec query） | ❌ 估 ~600 LOC |
| 中文检索 | ⚠️ LIKE 通配中文 OK 但慢 | ⚠️ FTS5 默认 tokenizer 不分词中文（lessons-mcp 用 LIKE fallback）；可后续加 unicode61 + custom | ✅ vector 解中文最稳 | ⚠️ 同 B |
| 重复 fingerprint 控制 | ❌ 全靠 owner 自律 | ✅ FTS5 BM25 让重复 entry 互相曝光，便于人工合并 | ✅ vector 相似 dedup | ⚠️ markdown 文件名 + frontmatter id 但 owner 自管 |
| Phase 1 reviewer 接入 | ✅ grep 即可 | ✅ MATCH 查询 | ✅ MATCH + 向量 top-k | ⚠️ 双系统集成复杂 |
| 学习曲线 | 极低 | 低（FTS5 1 小时学完） | 中（向量 + embedding 模型选型） | 中（Obsidian 集成） |
| 维护成本 | 极低 | 低（FTS5 trigger 写一次） | 中（embedding worker 部署） | 高（双层一致性 / 文件系统监控） |

**结论**：B 在所有 Vessel 硬约束维度全 ✅，唯一灰是中文检索可降级为 LIKE（lessons-mcp 已验证）。

---

## 5. 成本估算

| 方案 | 实施工作量 | 后续维护 | 学习曲线 |
|---|---|---|---|
| A 单表 + LIKE | S（80 LOC） | 极低 | 零 |
| **B 单表 + FTS5** | **S+（150 LOC，1 migration + 2 CLI + 1 route + FTS5 trigger）** | **低（FTS5 trigger 自动同步）** | **低（FTS5 阅读 1 hr）** |
| C 加 vector | M（额外 250 LOC + ML worker 路径） | 中 | 中 |
| D 双层 markdown | L（双 DB + 文件 watcher + frontmatter parser） | 高（一致性 / Obsidian schema 漂移） | 中 |

B 方案**直接落在 L1-minimal 范围内**（200 LOC backend + 1 migration + 2 CLI + 1 HTTP route 上限内）。

---

## 6. 迁移路径

### 当前状态

- `~/.claude/skills/debate-review/log.jsonl`：**13 条** ndjson 累积 lesson（M0/M0.5/M1A-α/M1A-β 等 v0A.1 之后 + Eva harness 时期）
- `docs/reviews/*verdict*.md` + `docs/reviews/*-arbiter-*.md`：**11 篇** verdict markdown（structured review verdict files）
- `docs/reviews/*-verify-gate-*.md`：5+ 篇 closeout gate 报告

### 选 B 方案后的迁移步骤

1. **Migration `0002_m1_retrospectives.sql`**（避开 ADR-006 §3 reserve 的 0004-0007；从 memory.db 序列起 0002）：
   - 主表 `retrospectives(id, kind, milestone, title, body, tags, refs_json, status, importance, contradicts_id, created_at, updated_at)` — 字段直接借鉴 memem frontmatter 子集 + Linear label-groups 思想
   - FTS5 影子虚表 `retrospectives_fts(title, body, tags, content='retrospectives', content_rowid='id')` — external content 模式避免数据复制
   - 3 个 trigger（INSERT / UPDATE / DELETE）保持 FTS 同步
2. **One-shot import 脚本**（不进 migration，写成独立 CLI subcommand `vessel retro import`）：
   - 读 `~/.claude/skills/debate-review/log.jsonl` 13 条，每条转换为 1 个 `kind='review_closeout'` retrospective row（用 `biggestInsight` 作 title，`biggestMistake` + counterChallenges + newPrinciplesAdded 拼成 body，`contract` 作 tag）
   - 读 `docs/reviews/*verdict*.md` 11 篇，提取 frontmatter（如 milestone）+ 第一段总结作 row
   - 不删源文件（idempotent；可重跑）
3. **2 个 CLI 子命令**：`vessel retro add ...` 手动追加 + `vessel retro search <query>` FTS5 查询
4. **1 个 HTTP route** `GET /api/retrospectives?q=...&kind=...&tags=...&limit=20` — 给 reviewer subagent 调用（Phase 1 reviewer 工具白名单加 fetch this）

### 风险点

- **R1 jsonl 格式变体**：13 条 ndjson 字段不完全一致（早期 4 条没 `mechVersion`，部分有 `contract`），import 脚本需要 forgiving parsing + 缺失字段为 NULL
- **R2 重复 import**：脚本跑两遍要 idempotent — 用 `(planFile + date)` 复合 fingerprint 做 ON CONFLICT 跳过
- **R3 markdown verdict 抽取**：11 篇 verdict 没统一 frontmatter，提取 milestone 字段需要文件名正则 match (e.g. `M1A-beta-review-...`)；abandon 自动提取，仅入 `id + kind='verdict' + filepath_ref`，body 留 NULL（让 owner 后续手填或 grep verdict 文件本身）

---

## 7. 回退方案

### 如果 B 选错（FTS5 中文检索效果差 / schema 字段被反复改）

- **R-1 退 A 方案**：把 FTS5 影子表 + trigger 删掉（ADR-006 §3 禁 DROP COLUMN/TABLE，但 **FTS5 影子表是虚表，DROP VIRTUAL TABLE 不算 schema breaking**）。LIKE 查询仍工作。损失：搜索慢，无 BM25 ranking。
- **R-2 升 C 方案**：M1C-B 加 sqlite-vec 时给 retrospectives 表加 `embedding BLOB` 列 + sqlite-vec virtual table。schema 兼容（ADD COLUMN）。
- **R-3 升 D 方案**：双层 markdown — 把 retrospectives 表的 `body` 字段改 `body_path` 指向 markdown 文件。**这是 breaking change**（需要 migration + ADR-006 §「跨 major」论证）。**当前 L1 不预留**这条路径，等 Phase 1 reviewer 挑战 §10 不确定点 #1 再说。

### 影响范围

- L1 体量小（200 LOC backend + 13 行迁移 jsonl + 11 篇 verdict ref），**回退成本 <S**。
- 唯一 sticky：CLI 命令名 `vessel retro` 一旦发布给 owner 用就是 muscle memory；改名要 deprecation period（ADR-006 §「deprecated 字段保留 ≥ 1 minor」）。

---

## 8. 与 Vessel 硬约束兼容性

| 硬约束 | B 方案验证 |
|---|---|
| **个人单机** | ✅ 全在 `~/.vessel/memory.db` 一个文件；无网络；无 server-side service。唯一外部 dep 是 better-sqlite3（已有）+ FTS5（编译进 SQLite，零安装） |
| **不上 LLM Driver** | ✅ B 方案纯 schema + FTS5；不调 LLM。memem auto-mine 用 Haiku 的部分**显式不抄**。日后若 owner 想 auto-summarize 一条 lesson，用 Coding CLI（Claude Code 子进程，订阅复用）而非 SDK |
| **TS 主栈 + ML worker 边界** | ✅ B 方案不需要 ML worker；FTS5 在 better-sqlite3 主进程跑 |
| **Coding CLI not SDK** | ✅ 不涉及（不调 Coding） |
| **Eva 优先复用** | ✅ memory.db 是 Vessel 自家但沿用 Eva pattern：better-sqlite3 + migrations/ 目录 + WAL + atomic-rename。可直接复用 [`packages/backend/src/projects-store.ts`](../../packages/backend/src/projects-store.ts) 的 `withProjectsLock` 思路给 retrospective 写入做 mutex |
| **多端薄壳客户端** | ✅ HTTP route 暴露给 iOS/web/CLI 都能查；schema 与 client 无耦合 |
| **TS+ML worker 边界** | ✅ 完全不跨边界 |

**所有硬约束 ✅**。唯一边缘 trade-off：FTS5 中文 tokenizer 默认不分词，对中文 body 检索精度有限。Vessel reviewer / lesson 文本是中英混排为主（log.jsonl 13 条都是混合），LIKE fallback 已被 lessons-mcp 验证够用。**接受 trade-off**。

---

## 9. License / Security 风险

| 项目 | License | CVE 12 月内 | 维护者 | 借鉴方式 | 风险 |
|---|---|---|---|---|---|
| sosoyososo/lessons-mcp | 未声明（glama 列表） | 0 已知 | 个人开发者 | 思想借鉴（schema + 检索 pattern），不 fork 代码 | 低（思想不传染 license） |
| TT-Wang/memem | MIT | 0 已知 | 个人 Claude Code 插件 | 思想借鉴（frontmatter schema 字段） | 低 |
| iAchilles/memento | MIT | 0 已知 | 个人 MCP server | 思想借鉴（importance enum + 加权概念） | 低 |
| Letta | Apache-2.0 | 0 已知 | letta-ai 团队 | 思想借鉴（已在 0A spike § 类 1） | 低 |
| Reflexion | MIT | 0 已知 | 学术（NeurIPS 2023） | 概念引用 | 低 |
| Sentry | BUSL-1.1（部分 Apache） | Sentry 自己 publishes advisories；2026 内多个但都是 server-side 漏洞，与 fingerprint schema 概念借鉴无关 | Sentry team | 概念借鉴（fingerprint algorithm，不抄代码） | 低（BUSL 不影响概念借鉴） |
| Linear | 闭源 | N/A | Linear team | 概念借鉴（label group） | 低 |
| SQLite FTS5 | Public Domain | 0（FTS5 模块本身近年无 CVE）；SQLite 有 CVE 但 better-sqlite3 跟随 SQLite 主线 | hwaci / SQLite consortium | 直接调用（已 transitive dep） | 低 |
| Diátaxis | CC-BY-SA 4.0 | N/A | Daniele Procida | 概念框架引用 | 低 |

### 重点：lesson 文本 sensitive info redaction

**风险**：lesson body 来自 4-way review 闭包，可能含：
- 文件路径（如 `/Users/yongqian/Desktop/Vessel/...`） — 已被 trace-redaction-spec 在 trace-writer 层处理，但 retro body 不走 trace-writer
- 命令片段（如 `pnpm --filter ...`） — 一般无 secret
- log.jsonl 已有 13 条**都是 owner 自己产出 + 4-way review subagent 产出**，无 PII 风险，路径含 username 但属可公开（个人 GitHub 项目 owner 可识别）

**redaction 策略**（按 M1A-β verdict 制度性教训：「fix 必须放数据生成层」）：
- **生成层 = `vessel retro add` CLI 入口**：在写入 SQLite 前过 `redactor.redact(body)`（复用 [`packages/backend/src/observability/redactor.ts`](../../packages/backend/src/observability/redactor.ts) 的 forceMask 子树规则，**path 字段做 relativize**，避免 `/Users/yongqian` 入库）
- **消费层 = HTTP route + CLI search**：**不再做 redact**（已在生成层去过）。这与 trace-writer 的实施模式一致

---

## 10. 推荐 + 不确定的地方

### 推荐方案：**B — 单 retrospectives 表 + tags 自由文本 + kind enum + FTS5 索引 + manual + post-closeout 双触发**

**核心设计要点**：

1. **schema = 单表 + 6 字段必填 + 4 字段可空**（直接借 memem frontmatter 子集）：
   ```sql
   CREATE TABLE retrospectives (
     id          TEXT PRIMARY KEY,                          -- uuid v4
     kind        TEXT NOT NULL CHECK (kind IN (
                    'review_closeout',  -- 4-way review 完成
                    'bug_lesson',       -- 个别修 bug 时手动
                    'decision',         -- ADR 配套
                    'risk',             -- 新发现风险
                    'spike'             -- spike report 摘要
                 )),
     milestone   TEXT,                                      -- 'M0' / 'M1A-β' / NULL
     title       TEXT NOT NULL,                             -- biggestInsight 作 title
     body        TEXT NOT NULL,                             -- 已 redact 过的正文
     tags        TEXT,                                      -- 逗号分隔自由 tag
     refs_json   TEXT,                                      -- ['retro_id_1','verdict_path_1',...] 单向引用
     status      TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','deprecated','contradicted')),
     importance  INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
     contradicts_id TEXT REFERENCES retrospectives(id),
     created_at  TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
   );

   CREATE VIRTUAL TABLE retrospectives_fts USING fts5(
     title, body, tags,
     content='retrospectives',
     content_rowid='id'   -- 注：FTS5 content_rowid 需 INTEGER；字段类型上要么改 id 为 INTEGER 自增，要么写 trigger 维护 rowid map。Phase 1 BLOCKER candidate — 见 §10 不确定点 #5
   );

   -- 3 个 trigger 保持 FTS 同步（INSERT/UPDATE/DELETE 同步 fts 表）
   ```

2. **kind enum 借 Linear label-group 思想**：5 个互斥 kind 一个 entry 只能选 1，避免 JIRA 自由 tag fragmentation。**tags 自由文本并行**（覆盖 enum 覆盖不到的维度，如 "redaction" / "concurrency-cap" / "schema-evolution"）。

3. **触发：hybrid manual + auto post-closeout**：
   - **Manual**：owner 跑 `vessel retro add --kind=bug_lesson --title="..." --body="..." --tags="..."` 在任何时机
   - **Auto post-closeout**：closeout verify-gate 跑完自动 append 一条 `kind='review_closeout'` row（从 verify-gate report 抽 milestone / 从 debate-review log entry 抽 biggestInsight 作 title / 抽 biggestMistake 作 body）。**不需要 LLM** — 都是已结构化的字段直接 SQL INSERT
   - 这两个共存：closeout 是骨干，manual 是补充

4. **referer 为单向 retro_id list**（不做 backlinks graph）：JSON array `["retro_xxx", "docs/reviews/M1A-beta-...md"]`。L2/L3 决定要 graph 时再加 join 表（不破 L1 schema）

5. **import 现有 13 条 jsonl + 11 篇 verdict** 作 one-shot CLI 脚本（非 migration），跑完即弃。idempotent：`(date + planFile)` 作 dedup key

### 借鉴的具体代码片段 / 概念

- **lessons-mcp**：单表 + FTS5 影子表的 pattern；`suggest_metadata` 概念可后续加（show 已有 tags 给 owner 防 fragmentation，L2 enhancement）
- **memem frontmatter**：`status / importance / contradicts / valid_to` 这 4 字段（valid_to 这一版不进 schema，但留作 ROADMAP）
- **Sentry fingerprint**：dedup key = `(milestone, kind, fingerprint=hash(title))`；不上 fingerprint 自动算法，但 schema 留 INDEX
- **Linear label groups**：kind enum (mutually exclusive) + tags (free) 二分
- **Reflexion**：episodic buffer 是 retrospective 的 conceptual ancestor，但 Vessel **不让 agent 自决定 append**

### 避免的具体坑

- ❌ memem 的 auto-mine via Haiku：违反 [不上 LLM Driver]
- ❌ Letta 的 agentic write：违反 [memory survey 失败模式 §3]，错误结论会持续污染
- ❌ memento 的 vector 一上来：违反 YAGNI / 超 L1 范围
- ❌ Roam/Logseq backlinks graph：超 L1
- ❌ 双层 markdown source-of-truth：memem 的复杂度直接放弃
- ❌ 自由 tag-only schema (JIRA labels) 没有 kind enum：fragmentation 必然
- ❌ 把 redact 放 HTTP route 消费层（M1A-β 教训）

### 留给 Phase 1 reviewer 挑战的不确定点

1. **kind 5 个值是否够 / 是否过早**：现在 13 条 jsonl 里全是 `review_closeout` 类。剩 4 个 enum (`bug_lesson` / `decision` / `risk` / `spike`) 是预测性设计；reviewer 可能挑战"YAGNI — 先一个 kind，需要时 ADD CHECK"。**反驳**：CHECK 收窄不兼容（ADR-006 §「enum CHECK 收窄需 schema-rebuild」），enum 加值才兼容；先 5 个 forward-looking 比后续收窄安全。
2. **post-closeout auto-trigger 该是 verify-gate hook 还是 closeout report writer 主动 INSERT**：关系到耦合方向。架构上后者更好（closeout 作为生成层），但前者实现更简单。
3. **`refs_json` 用 JSON array vs 子表 `retro_refs(retro_id, ref_kind, ref_value)`**：sub-table 更规范但 L1 用不上 join。一致 lesson：JSON array 在 SQLite 里 query 不便（需 JSON1 extension，已 built-in），ALTER 加子表是兼容操作，留作 L2 升级路径。
4. **中文 FTS5 tokenizer**：默认 unicode61 不分词中文，13 条 lesson 中文比例约 40%。LIKE fallback OK 但慢。是否 day 1 就上 simple/jieba tokenizer？**倾向**：先默认 + LIKE fallback，等检索精度真不够时再加 — 否则又是过早优化。
5. **id 字段类型 TEXT 与 FTS5 content_rowid INTEGER 冲突**：FTS5 external content 要求 content_rowid 是 rowid（INTEGER）。两条解：(a) 改 retrospectives.id 为 INTEGER 自增（破"uuid v4 跨设备"假设，但 L1 单机也能接受）；(b) 加 hidden `rowid` 列让 SQLite 自动维护，retrospectives.id 仍 TEXT uuid。**倾向 (b)** — Phase 1 reviewer 验证 trigger 写法。
6. **redactor 复用是否真适用**：当前 [`redactor.ts`](../../packages/backend/src/observability/redactor.ts) 是为 trace event 设计（`agent.input` / `agent.output` 等命名空间）；retrospective body 是自由文本。可能需要 path-relativize-only 的轻版 redactor。Phase 1 risk-officer lens 应挑战。
7. **owner 是否需要 web UI**：HTTP route 1 个 `GET /api/retrospectives?q=` 够 reviewer subagent 用，但 owner 自己看时 CLI 输出一长串 JSON 不友好。是否 L1 加最简 HTML 表格 view？倾向"L1 不加，CLI `vessel retro search --format=table` 即可，UI 推 L2"。

---

## 11. 引用规则（ADR-015 §「引用规则」对齐）

本调研覆盖**重大外部选型**：DAR 检查表第 3 项「引入新存储（memory.db 加表 + FTS5 影子表 + 触发器）」+ 第 7 项「影响隐私」。**有 prior art**（lessons-mcp / memem / memento / Letta / Reflexion 直接对位），不需写 "No direct prior art found"。

**Vessel 特有部分**（4-way review log → retrospective 的整合方式 / kind enum 5 值的 Vessel 词汇）：在 §10 留作 Phase 1 reviewer 挑战不确定点 #1。**不需要写** "No direct prior art" 段，因为整体设计有 prior art，仅个别字段是 Vessel 特有 framing。

---

## 附录 A — 13 条 jsonl + 11 篇 verdict 真实数据形态摘要（已读 §0 真实数据形态）

- jsonl 13 条字段一致性中等：稳定字段 `date / planFile / totalClaims / accepted / partial / rejected / hung / biggestInsight / biggestMistake`；变体字段 `newPrinciplesAdded / newRisksAdded / reviewerSkippedQuestions / counterChallenges / contract / mechVersion`
- verdict 11 篇 markdown 没统一 frontmatter（部分有 `# Phase 3 Arbiter — ...` heading 含 milestone，部分仅靠文件名）
- import 路径推荐：jsonl 全量结构化转入；verdict 仅 metadata（id / kind='verdict_ref' / filepath / milestone derived from filename），body 留给 owner 按需 grep 文件本身

## 附录 B — 引用 spike report 链接清单（给 ADR / plan 用）

```
docs/research/evolution-mechanism-2026-05-10.md
```

ADR / plan 引用建议格式：

```markdown
## Prior Art

参见 [evolution-mechanism-2026-05-10 spike](../research/evolution-mechanism-2026-05-10.md)：
比较 4 方案（A/B/C/D），按 Vessel 硬约束选 B = 单表 + FTS5 + tags +
post-closeout auto-trigger。直接借鉴 lessons-mcp + memem + Linear label-group
模式，规避 memem auto-mine via LLM 与 Letta agentic write。
```
