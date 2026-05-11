# L1-retrospectives — vessel-architect verdict — 2026-05-10 04:20

**Reviewer**: vessel-architect (B-级)
**Lens**: 5 接口契约 / 模块边界 / 长期演进
**Artifacts**: [proposal](./L1-retrospectives-proposal-2026-05-10-0420.md) + [spike](../research/evolution-mechanism-2026-05-10.md)
**Verdict**: **NOT-YET-PASS** — 1 BLOCKER（命名冲突+概念双重定义） + 2 MAJOR + 4 MINOR。BLOCKER 须在 Phase 3 之前 owner 拍板，其余 MAJOR/MINOR 可 fix 后通过。

---

## BLOCKER

### B-1. `retrospectives` 表与 harness.db 已存在的 `retrospective` 表概念双重定义 / 命名冲突

**位置**: 提案 §Schema；spike §10 推荐方案。

**事实**：
- harness.db `migrations/0001_initial.sql:293` 已有 `retrospective` 表（单数），字段为 `(id, issue_id FK, what_went_well, what_to_improve, methodology_feedback, cost_summary_json, created_by, created_at)`。它是 [HARNESS_DATA_MODEL.md §1.13] 的 Issue 级 retro，由 Stage 流水线的 `review` / `observe` stage 产出。
- 同一 0001_initial.sql:211 的 `Artifact.kind` enum 还把 `'retrospective'` 列为 artifact 类型之一。
- 提案的新表 `retrospectives`（复数） 在 memory.db，schema 完全不同（kind/milestone/title/body/tags/...），两表语义有交集（都是"评审/复盘"）但不同源。

**架构后果**：
1. **5 接口契约失稳**：harness 的 retrospective 走 Memory 不存在的"harness 项目数据"通道（属 L5 Persistence harness.db），而 L1-minimal 的 retrospectives 又开第三条通道（memory.db 但不走 Memory 接口三层）。同一个名字、两份 schema、两个 DB、两条访问路径，将来 reviewer subagent 查"过去经验"时必须知道去哪个 DB 查 —— 长期演进黑洞。
2. **migration 编号风险**：ADR-006 §3 说"每个 migration 一个 milestone"，但只覆盖 harness.db 的 0004-0007。memory.db 自己的 0002 编号没有跨 DB 保留区，未来 M1C-A 的 workflow_state 进 harness.db 0004，但 retrospectives 进 memory.db 0002，**两个独立序列容易让人误读**。
3. **Vessel 跟 Eva 的合并迟早要做**（ADR-000 把 Eva 当 foundation）；`retrospective` 单数表是 harness 那条线的，`retrospectives` 复数表是 Vessel 这条线的，二者最后一定要有一个统一查询面。现在多生一个名字就锁死了未来的 join/迁移路径。

**owner 必决策三选一**（或提出第四方案）：
- **R-A 改名**：把 memory.db 新表改叫 `lessons`（或 `evolution_log` / `retro_log`），与 harness.db `retrospective` 区分。kind enum 的 `'review_closeout'` 值保持不变。CLI `vessel-core retro …` 改为 `vessel-core lesson …` 或保留 `retro` 别名但内部映射到 `lessons`。
- **R-B 合并到 harness.db `retrospective`**：在 0001_initial.sql 上加 ADD COLUMN（kind/milestone/tags/refs_json/status/importance/contradicts_id），把 issue_id 改为 nullable（因为 review_closeout 不一定挂某 Issue）。FTS5 影子表加在 harness.db。这条路最优雅但触及 harness.db schema 演进，需走 ADR-006 增订；harness.db 的 issue_id NOT NULL 还要 relaxation。
- **R-C 接受双表 + 显式 ADR**：写一份 ADR 明确"memory.db retrospectives 是跨 Issue 的'方法论/经验'层；harness.db retrospective 是 Issue 级"，并给出两表查询指引。最少改动但概念债务明确登记。

**架构推荐**：**R-A** 短期最低破坏。R-B 是长期最干净但 BLOCKER 应该独立处理；R-C 接受技术债务必须显式 ADR。**禁止**未做决策就直接落 0002_m1_retrospectives.sql。

---

## MAJOR

### M-1. retrospective 是否走 Memory 接口（独立 module 立场缺架构论证）

**位置**: 提案 §「不破坏的硬约束」第 6 条："retrospective 是 internal feature；不在 Memory 接口表面"。

**事实**：[`memory.ts:17`](../../packages/backend/src/interfaces/memory.ts#L17) 的 Memory 接口是 `{ short, sessionKv, longTerm }` 三层；`MemoryRecord = { id, sessionId, text, metadata, createdAt }`。retrospective row 的字段（kind/milestone/tags/refs_json/status/importance/contradicts_id）在概念上**完全可以**塞进 `LongTermMemory.write({ sessionId: 'GLOBAL', text: body, metadata: { kind, milestone, tags, ... } })`。spike §2 类 B Letta 把 lesson 归到 Archival memory 一层，正是这种映射。

**架构后果**：
- 立场写"独立 module"，但论据是"Memory short/sessionKv/longTerm 三层与 retro 概念正交"。**这个论据不成立**：longTerm 的语义就是"agent 跨 session 沉淀的事实"，与 retrospective 的"经验/lesson"高度重合。Letta、memem、memento 的对应都印证这点。
- 真要"独立 module"，必须有架构理由：(a) longTerm 走 sqlite-vec，retrospective 走 FTS5，存储后端不同；(b) longTerm 由 EmbeddingClient ML worker 写入，retrospective 由 owner/closeout writer 直接 SQL 写入；(c) longTerm sessionId 必填，retrospective 跨 session。这三条**有道理但提案没写**。
- 如果不写论证，将来 M1C-B 引入 sqlite-vec + LongTermMemory 实施时，会撞上"为什么这两个东西不同 module"的疑问，反向破坏 5 接口契约的稳定性。

**fix**：proposal §「不破坏的硬约束」第 6 条扩成一段话，论证三点（存储后端不同 / 写入方不同 / sessionId 语义不同），并标注："**当 M1C-B 落 LongTermMemory 时重新评估**：若两者真能用同一接口表达，retrospectives 是否合并进 LongTermMemory 实现的 metadata 层。" 这把当前独立 module 的决策打成"显式 reversible bet"而非永久边界。

### M-2. closeout writer 位置 — proposal 立场的 trigger 路径不闭环

**位置**: 提案 §「Sub-acceptance」第 5 行 + §「7 个 spike uncertainty 的 proposal 立场」#2。

**事实**：proposal 说"closeout report writer 主动 INSERT（生成层）；不在 verify-gate 加 hook（消费层），避免 M1A-β 同形 leak"。但 closeout report 是 Claude session 在主会话里手写的 markdown（参见 `M1A-beta-verify-gate-2026-05-10-0320.md`、`M0.5-verify-gate-...md` 等 11 篇都是这个形态），不是程序输出。**没有"writer"程序可以"主动 INSERT"**。

实际可行的三条 trigger 路径：
- **T-A**: Claude session 在写完 verify-gate markdown 后，**额外**调一次 `vessel-core retro add --kind=review_closeout --milestone=... --title=... --body=... --refs=...`。这是 manual + convention，不能保证不漏。
- **T-B**: ADR-014 verify-gate skill / debate-review skill 自动跑完后**调 CLI**（比如 SKILL.md 内补一段"Phase 4: SQL ingest"），这是把 trigger 落进 skill workflow，是程序化但仍由 Claude 触发。
- **T-C**: 让 `~/.claude/skills/debate-review/log.jsonl` 的 append 触发一个独立 watcher 进程把 row 倒进 retrospectives 表。这是 daemon 路径，违反"个人单机最简"。

proposal 论证"避免 M1A-β 同形 leak"的逻辑成立 —— path leak 的教训是"fix 放数据生成层而非消费层"。但这里的数据生成层是 **Claude session 的人工 markdown**，不是程序输出，**proposal 把消费层 vs 生成层的概念错位映射了**。

**架构后果**：proposal 说的"closeout writer 主动 INSERT"如果不指明谁是 writer，CLI subcommand 写完没有任何 caller，integration hook（~30 LOC）失去落点。Sub-acceptance 第 5 条无法验证。

**fix**：明确路径选 T-A 或 T-B。推荐 **T-B**：在 `~/.claude/skills/debate-review/SKILL.md` 末尾加 "Phase 4: 把仲裁 verdict 写入 retrospectives 表 via `vessel-core retro add`"。这把 skill 当成生成层（每个 Phase 3 仲裁都对应一次 SQL INSERT），消费层是 reviewer subagent 查 retrospectives；与 trace-redaction 的 fix-at-write 思路一致。proposal §Sub-acceptance 第 5 条改写成"Phase 3 arbiter SKILL 跑完后，retrospectives 表里有对应 milestone + biggestInsight 的 row"。

---

## MINOR

### m-1. migration 编号合法性

ADR-006 §3 明确 0004-0007 是 harness.db reserved。proposal 写的是 memory.db 的 0002（继 0001_m0_sessions.sql 之后），**这是合法的** — 两个 DB 各自序列。但 proposal §Sub-acceptance 第 1 行只写 "0002_m1_retrospectives.sql 可重跑"，没显式说"在 memory.db 的序列里"。建议在 SQL 文件头注释加 `-- TARGET DB = memory.db (与 harness.db 0004 reserved 区分)`，与 0001_m0_sessions.sql 头注释风格一致。

### m-2. FTS5 trigger + content_rowid='rowid' 的可行性

proposal 标这是 BLOCKER candidate（uncertainty #5）。**事实**：[`migrations/0001_initial.sql:67-81`](../../packages/backend/src/migrations/0001_initial.sql#L67-L81) 的 `issue` 表已使用**完全相同**的 pattern（TEXT id PRIMARY KEY + `content_rowid='rowid'` + 3 trigger INSERT/DELETE/UPDATE 用 SQLite 自动 rowid），并由 [`test-harness-schema.ts:101-107`](../../packages/backend/src/test-harness-schema.ts#L101-L107) 跑通验证。这是 better-sqlite3 + SQLite 内置 FTS5 的成熟用法。

**结论**：**不是 BLOCKER**。proposal 应直接 cite issue 表的 pattern（"沿用 `migrations/0001_initial.sql` 的 issue/issue_fts pattern"），把 uncertainty #5 降级为"已被现有实现验证"。Phase 1 reviewer 不需要再验 trigger 写法。

### m-3. import script idempotent fingerprint = (date + planFile) 不够

proposal §Sub-acceptance 第 6 行 + uncertainty #4。

**事实**：log.jsonl 13 条里 `date` 全是 `YYYY-MM-DD`（粒度天），`planFile` 是绝对路径。同一天有多个 closeout 在 v0A.1 / v0-pre 期间已发生（look at 0-pre-review / 0A-review / 0A.1-completion-sprint 全都 2026-05-09 ~ 2026-05-10）。**(date, planFile) 复合不够**：planFile 在 jsonl 里有时缺失（早期 4 条没 mechVersion 也可能没 planFile），且同一天对同一 planFile 跑两轮 review（manual + cross 各一次）就会冲撞。

**架构 fix**：用 `(date, planFile, biggestInsight 前 50 字符 hash)` 三元复合，或直接用 jsonl 行内容 sha256 的前 12 hex 作 `import_fingerprint` 列 + UNIQUE INDEX。这是 spike §「附录 A」附录里 13 条字段稳定性观察的自然推论，proposal 没接进 schema。建议 schema 加 `import_fingerprint TEXT UNIQUE`（nullable，import 时填，manual add 不填）。

### m-4. refs_json JSON array 单向链 — 长期演进路径需写 ADR-lite

proposal uncertainty #3 说"JSON array 在 SQLite 里 query 不便（需 JSON1 extension，已 built-in），ALTER 加子表是兼容操作，留作 L2 升级路径"。这句话**架构上正确**但应该在 proposal 里写一句"L2 升级到 retro_refs(retro_id, ref_kind, ref_value) 子表是 ADD TABLE + 数据搬迁，与 ADR-006 §3 兼容（不动 retrospectives 表本身）"。否则将来谁想加 backlinks，要重新论证一次"为什么不破 schema"。建议 proposal §「不破坏的硬约束」段加一行 "refs_json JSON array → 子表 retro_refs 是 forward-compatible 升级路径（ADR-006 §3 不动主表）"。

### m-5. redactor 选型 — proposal §uncertainty #6 立场可行但要写明 trace-redactor 不复用的理由

[`trace-redactor.ts`](../../packages/backend/src/observability/trace-redactor.ts) 是为 trace event 的**结构化 payload**（field-path blacklist + suffix list + force-mask 子树）设计的；retrospective body 是**自由文本 markdown**，没有 JSON path 概念。proposal #6 倾向"加轻版 `redactRetroBody`"，**架构上正确**：force-mask 子树逻辑对自由文本没意义，直接用 trace-redactor 会把整段 body 当一个字符串过 `redactString`（PATTERN_RULES 那部分），可以工作但不需要 path/prefix/suffix 那部分代码。

**fix**：proposal 显式写"复用 `trace-redactor.ts` 的 PATTERN_RULES + redactString 函数（export），但**不复用** redactValue 的 path 遍历。在 retrospective-store.ts 直接 `redactString(body)`。" 这把"复用什么不复用什么"写死，避免后续 reviewer 误以为不该复用。

---

## PASS-WITH-FIXES 给出的修复清单（如 owner 决策 R-A 改名）

| # | 类型 | 修复 |
|---|---|---|
| B-1 | BLOCKER | owner 决策 R-A/R-B/R-C；R-A 时把 memory.db 新表改名 `lessons`，CLI/HTTP/import 全链路同步改名 |
| M-1 | MAJOR | 提案 §「不破坏的硬约束」第 6 条扩成完整论证段（存储后端 / 写入方 / sessionId 三点不同），并标 "M1C-B LongTermMemory 落地时重新评估" |
| M-2 | MAJOR | 选 T-B 路径：debate-review SKILL.md 加 "Phase 4: 写入 retrospectives via vessel-core retro add"；proposal §Sub-acceptance 第 5 条相应改写 |
| m-1 | MINOR | SQL 文件头注释加 TARGET DB 标识 |
| m-2 | MINOR | uncertainty #5 降级为"已被 issue/issue_fts pattern 验证"，cite 文件路径 |
| m-3 | MINOR | schema 加 `import_fingerprint TEXT UNIQUE`，import 脚本用 sha256(jsonl line)[0:12] |
| m-4 | MINOR | proposal §「不破坏的硬约束」加 forward-compat 一句话 |
| m-5 | MINOR | redactor 复用边界写明（复用 PATTERN_RULES + redactString，不复用 redactValue 的 path 遍历） |

---

## 不在我 lens 内（留给 cursor / pragmatist / risk-officer）

- 中文 FTS5 tokenizer 精度（uncertainty #4）— pragmatist
- redactor 在中英混排 freeform 自由文本中 false-negative 率 — risk-officer
- 13 条 jsonl 字段变体的 forgiving parser 实现工作量 — pragmatist
- log.jsonl 第 10 次 cursor catch / 集体盲区识别 — cross reviewer
- 200/390 LOC 估算合理性 — pragmatist
- web UI 是否 day 1（uncertainty #7）— pragmatist

---

## 总结（≤ 200 字）

L1-retrospectives 整体方向正确（B 方案技术选型成熟，FTS5 trigger 已被 issue 表 pattern 验证可用），**但 1 BLOCKER 必须 owner 拍板**：memory.db 新表 `retrospectives` 与 harness.db 已有 `retrospective` 表（HARNESS_DATA_MODEL §1.13）命名冲突 + 概念双重定义，长期破坏 5 接口契约稳定性。owner 三选一：改名 (R-A) / 合并到 harness.db (R-B) / 显式 ADR 接受双表债务 (R-C)。2 MAJOR：(a) "独立 module" 不走 Memory 接口的论证缺失，应明确"M1C-B LongTermMemory 时重新评估"；(b) closeout writer "主动 INSERT" 没指明谁是 writer，应改为 debate-review SKILL Phase 4 调 CLI。4 MINOR 是局部 polish。BLOCKER 解决后 PASS-WITH-FIXES。
