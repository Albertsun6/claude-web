# Proposal: L1-minimal evolution mechanism — `retrospectives` table + FTS5 + dual trigger

**Date**: 2026-05-10 04:20
**Status**: Pending B-级 review (1 architect + 1 cursor cross)
**Phase 0 spike**: [`docs/research/evolution-mechanism-2026-05-10.md`](../research/evolution-mechanism-2026-05-10.md)
**Spike 推荐**: 方案 B (单表 + tags + kind enum + FTS5 + manual+auto-post-closeout 双触发)

## 触发

ADR-015 DAR yes/no checklist:
- ✅ 引入新存储（memory.db 加 retrospectives 表 + FTS5 影子表 + 3 trigger）
- ✅ 影响隐私（lesson 文本可能含 sensitive info — 需 redact 在生成层）
- 共 2 项命中，需 Phase 0 spike + B-级 review

## 范围（守边界）

### ✅ 做

| 产物 | 内容 | LOC |
|---|---|---|
| `0002_m1_retrospectives.sql` | retrospectives 表 + retrospectives_fts 虚表 + 3 trigger | ~50 |
| `memory/retrospective-store.ts` | CRUD: addRetrospective / searchRetrospectives / getById / list | ~80 |
| CLI: `vessel-core retro add` | manual capture (`--kind=... --title=... --body=... --tags=... --milestone=... --refs=...`) | ~30 |
| CLI: `vessel-core retro search <query>` / `retro list` | FTS5 query + filter by kind/milestone/tags | ~30 |
| HTTP: `GET/POST /api/vessel/retro` | reviewer subagent 调用查 + closeout writer 调用追加 | ~30 |
| `closeout-writer.ts` integration hook | verify-gate report 跑完后 SQL INSERT 一条 `kind=review_closeout` | ~30 |
| `scripts/import-debate-log.ts` | 一次性 idempotent import 13 jsonl + 11 verdict | ~80 |
| `test-retrospectives.ts` | unit + integration test | ~60 |

**总计**: ~390 LOC（spike 估 200 但加上 closeout integration + import 脚本 + 测试合计；纯 backend feature 仍 ~150）

### ❌ 不做（defer）

- L2 (ContextBundle 自动注入) — 等 M1C+ 接 Memory full surface
- L3 (agent profile 自调) — 永远不做（plan 硬约束）
- vector embedding — 推 M1C-B sqlite-vec 时再加
- 中文 jieba tokenizer — 默认 unicode61 + LIKE fallback 够用
- Web UI — 推 M1A-γ 时一并
- backlinks graph — 当前 refs_json 单向链够用

## Schema (核心)

```sql
CREATE TABLE retrospectives (
  id              TEXT PRIMARY KEY,                  -- uuid v4
  kind            TEXT NOT NULL CHECK (kind IN (
                    'review_closeout',  -- 4-way review 跑完
                    'bug_lesson',       -- 修 bug 的教训
                    'decision',         -- ADR 配套
                    'risk',             -- 新发现风险
                    'spike'             -- spike report 摘要
                  )),
  milestone       TEXT,                              -- 'M0' / 'M1A-β' / NULL
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,                     -- already-redacted at write
  tags            TEXT,                              -- 逗号分隔自由 tag
  refs_json       TEXT,                              -- ['retro_id', 'docs/reviews/...md']
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','deprecated','contradicted')),
  importance      INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  contradicts_id  TEXT REFERENCES retrospectives(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_retro_kind     ON retrospectives(kind);
CREATE INDEX idx_retro_milestone ON retrospectives(milestone);
CREATE INDEX idx_retro_status   ON retrospectives(status);

-- FTS5 影子表（external content 模式）
CREATE VIRTUAL TABLE retrospectives_fts USING fts5(
  title, body, tags,
  content='retrospectives',
  content_rowid='rowid'   -- ⚠️ uncertainty #5: 用 SQLite 自动 rowid (INTEGER) 维护
);

-- 3 sync trigger (INSERT/UPDATE/DELETE)
-- 用 hidden rowid 而不是 id 列做 content_rowid
```

## Sub-acceptance

| 子验收 | 验证 |
|---|---|
| Schema migration 0002 可重跑（idempotent CHECK + IF NOT EXISTS） | `sqlite3 memory.db ".tables"` 含 retrospectives + retrospectives_fts |
| `vessel-core retro add --kind=bug_lesson --title=t --body=b --tags=a,b` 写入 + 返回 retro_id | sqlite SELECT 找到 |
| `vessel-core retro search "redaction"` 返回包含 M1A-β BLOCKER 教训的 row（FTS5 BM25 ranked） | grep "redaction" 命中 |
| `GET /api/vessel/retro?q=redaction&kind=review_closeout` 返 JSON 列表 | curl + jq |
| Closeout post-hook: 跑完 verify-gate 自动 INSERT 一条 review_closeout row | M1A-β verdict / log.jsonl 字段被结构化入库 |
| One-shot import 脚本: 13 jsonl + 11 verdict 全入库; 重跑 idempotent (复合 fingerprint dedup) | `SELECT count(*)` 第一次 = 24, 第二次 = 24 |
| body 字段过 redactor (path relativize at write) | 入库 body 不含 `/Users/yongqian/...` |

## 7 个 spike uncertainty 的 proposal 立场

| # | spike 不确定点 | proposal 决定 |
|---|---|---|
| 1 | kind 5 个值是否过早 | **5 enum 锁死**：CHECK 收窄不兼容 (ADR-006)，加值兼容；forward-looking 5 比 future schema-rebuild 安全 |
| 2 | post-closeout auto-trigger 位置 | **closeout report writer 主动 INSERT**（生成层）；不在 verify-gate 加 hook（消费层），避免 M1A-β 同形 leak |
| 3 | refs_json JSON array vs 子表 | **JSON array**（SQLite JSON1 already built-in）；子表升级是兼容操作，留 L2 |
| 4 | 中文 FTS5 tokenizer | **默认 unicode61 + LIKE fallback**；jieba/simple 留 v1+ |
| 5 | id TEXT vs FTS5 rowid INTEGER 冲突 | **content_rowid='rowid'** 用 SQLite 自动维护的 hidden rowid；id 仍 TEXT uuid。Phase 1 reviewer 必须验 trigger 写法 |
| 6 | redactor 复用 | **加轻版 `redactRetroBody(text)`** in retrospective-store: 仅做 path relativize（home dir → `$VESSEL_DATA_DIR`）+ token pattern；不复用 trace redactor 子树 force-mask 逻辑（自由文本不需要） |
| 7 | Web UI 是否 day 1 | **不加**；CLI `retro search --format=table` 输出格式化 ASCII 表 |

## 不破坏的硬约束

- ✅ 个人单机 — 全在 `~/.vessel/memory.db` 一个文件
- ✅ 不上 LLM Driver — closeout post-hook 是字段级 SQL INSERT，不调 LLM
- ✅ TS 主栈 — 全 backend TS
- ✅ Coding CLI not SDK — 不涉及
- ✅ Eva 复用 — 复用 better-sqlite3 + migrations 模式 + redactor 思路
- ✅ 5 接口契约 — retrospective 是 internal feature；不在 Memory 接口表面（Memory short/sessionKv/longTerm 三层与 retro 概念正交；retro 走独立 module）

## 4 关键问题供 reviewer 评判

### 给 vessel-architect 的问题

1. **5 接口契约边界**: retrospective 是否应该走 Memory 接口的某一层（short/sessionKv/longTerm）？还是独立 module 合理？
2. **closeout writer 位置**: 谁来写 review_closeout row — 是 verify-gate 报告生成时（Claude session 内手写）还是 4-way arbiter doc 生成时？
3. **rowid trigger 写法的实际可行性**: `content_rowid='rowid'` + 3 trigger (INSERT/UPDATE/DELETE) 在 better-sqlite3 上真能工作吗？还是要 INTEGER id 折中？
4. **import 脚本 idempotent fingerprint**: `(date + planFile)` 复合 hash 够 dedup 吗？同一天多个 closeout 怎么办？

### 给 cursor 异质 cross 的问题

1. **FTS5 trigger 的 byte-level 正确性**: 看 lessons-mcp / SQLite docs 实际写法。M1A-β 的"消费层 fix"陷阱在 trigger 设计上有没有同形 risk？
2. **redact-at-write 真覆盖**: lessons body 是自由文本，token 模式 + path relativize 在 freeform 中文+英文 body 上 false-negative 多少？比如用户写 "记得 ~/.vessel/secrets 那个 API key sk-ant-..." 是否真被 mask？
3. **closeout 集成路径**: 我提议 closeout writer 主动 INSERT；但实际 closeout report 是 Claude 手写 markdown，不是程序输出 — 真能可靠 trigger 吗？
4. **基于 log.jsonl 10 次 cursor catch，本提案最可能漏看的是**？

## 估算

| 阶段 | 预期 | 是否 fit "先不做复杂的" |
|---|---|---|
| Proposal + B-级 review | small (current step) | ✅ |
| Implement migration + store + CLI + HTTP | M (~390 LOC + tests) | ⚠️ 边界状态：比 M1A-β 小，比 M0.5 同量级；fit |
| Import script + 一次性入库 13+11 | S | ✅ |
| Closeout 4-way + Verify Gate | small | ✅ |

**总体 fit "先不做复杂的"原则**。明确退路：方案 A (单表无 FTS5 + LIKE only) 是 fallback，FTS5 trigger 写得不顺直接退 A。

## 后续 milestone 顺序

1. L1-minimal （现在）
2. M1B (MCP + permission) — 解锁 Tool 工具箱
3. M1C-A (Workflow Engine) — 解锁长跑 workflow
4. M1A-γ — 永远 backlog（M2-iOS 一并）
