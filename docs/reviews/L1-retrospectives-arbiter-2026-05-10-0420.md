# L1-minimal evolution mechanism — B-级 review arbiter verdict

**Date**: 2026-05-10 04:20
**Phase 2 react skipped**: 两位 reviewer 一致 NOT-YET-PASS，无 contested finding
**B-级 review inputs**:
- [vessel-architect](L1-retrospectives-architect-2026-05-10-0420.md) — 1 BLOCKER + 2 MAJOR + 4 MINOR
- [cursor cross](L1-retrospectives-cross-2026-05-10-0420.md) — 2 BLOCKER + 3 MAJOR + 2 MINOR

## 收敛

**两位 reviewer convergent (≥ 2 lens)**:
- 🚨 BLOCKER: closeout auto INSERT 路径不闭合 (architect M-2 + cursor B1)
- 🚨 MAJOR: import fingerprint 弱 (architect m-3 + cursor M3)
- 🚨 MAJOR: FTS5 trigger 写法不完整 (cursor M1 + architect m-2 提示)

**Architect 独家**:
- 🚨 BLOCKER: `retrospectives` table name 与 harness.db 现有 `retrospective` 表（Eva HARNESS_DATA_MODEL §1.13）冲突 — 已 grep 确认
- MAJOR: 独立 module 定位与 LongTermMemory 概念重叠

**Cursor 独家**:
- 🚨 BLOCKER: `redactRetroBody` 规格只覆盖 home path，遗漏 `~`/`$HOME`/sk-ant-*/AWS/邮箱 等 pattern
- MAJOR: hidden rowid VACUUM/rebuild 后 FTS 漂移风险

## 4 档分类

### ✅ 接受（已应用 fix to proposal）

| Finding | Source | Fix |
|---|---|---|
| **BLOCKER B-1**: table name 与 harness.db 冲突 | architect | **rename `retrospectives` → `lessons`**；CLI 改 `vessel-core lesson add/search`；HTTP 改 `/api/vessel/lessons`；migration 文件名 `0002_m1_lessons.sql` |
| **BLOCKER cursor B1 / architect M-2**: closeout writer 入口不存在 | both | **新增 `vessel-core closeout finalize` CLI**（cursor Counter-proposal #2）：原子操作 redact body → INSERT row → 写 markdown refs。closeout 跑完 verify-gate 后 owner 跑此命令；不允许靠 Claude session 手 INSERT；4-way review verdict markdown 必须含 `lesson_id: <returned-id>` |
| **BLOCKER cursor B2**: redactRetroBody 规格不足 | cursor | 抽 `redactFreeformText(text, opts)` 到 `observability/redact-helpers.ts`，复用 `redactString` 全 PATTERN_RULES (sk-ant/sk-/AWS/email/path/token + UUID whitelist) + 加 `~/`、`$HOME/`、相对路径 pattern；测试矩阵覆盖所有 spike B2 列出的 case |
| **MAJOR cursor M1**: FTS5 trigger 缺 exact SQL | cursor | **照搬 Eva harness.db `issue_fts` proven pattern verbatim**（[migrations/0001_initial.sql:67-81](../../packages/backend/src/migrations/0001_initial.sql)）：`*_fts_ai` (INSERT) / `*_fts_ad` (DELETE 用 external-content delete command) / `*_fts_au` (UPDATE = delete + insert) |
| **MAJOR architect m-2**: FTS5 pattern 已 proven，downgrade uncertainty #5 | architect | proposal §「7 个 spike uncertainty」#5 改: "validated by Eva issue_fts pattern; not BLOCKER" |
| **MAJOR architect m-3 + cursor M3**: import fingerprint 弱 | both | fingerprint = `sha256(date + planFile + contract + biggestInsight).slice(0, 16)`；存 lessons.import_fingerprint UNIQUE INDEX |
| **MAJOR cursor M2**: hidden rowid VACUUM 风险 | cursor | migration 注释加 "FTS rowid is internal; rebuild FTS after VACUUM/rebuild"；不强求 INTEGER PK 改造 |
| **MAJOR cursor m2**: body NOT NULL 与 metadata-only verdict 冲突 | cursor | **保留 body NOT NULL**；metadata-only verdict 入库时 body = 短摘要文本（如 verdict file 第一段）或 placeholder `(metadata-only; see refs_json)` |

### ⚠️ 部分接受（defer with reasoning）

| Finding | Source | 决策 |
|---|---|---|
| **MAJOR architect M-1**: 独立 module vs Memory interface 论证弱 | architect | 改 proposal 加 3 点论证: storage backend (SQL CRUD vs short/sessionKv 的 KV/longTerm 的 vector) / writer (closeout-driven vs runtime-driven) / sessionId boundary (跨 session vs per-session)。**不进 Memory interface — 但加 ROADMAP note: M1C-B 落 LongTerm 时 re-evaluate** |
| **MINOR architect m-1**: SQL header DB-target comment | architect | 0002 文件头加 "DB target: ~/.vessel/memory.db (NOT harness.db)" |
| **MINOR architect m-4**: refs_json forward-compat 注释 | architect | proposal 加 note: "JSON1 array; 升级 retro_refs join 表是 ALTER ADD TABLE 兼容操作" |
| **MINOR architect m-5**: redactor 复用边界显式 | architect | redact-helpers.ts 文件头说明: "trace-redactor for structured trace events; redactFreeformText for free-form text persistence" |
| **MINOR cursor m1**: kind enum 加值策略写入 ADR-006 | cursor | 0002 注释 "kind CHECK may only widen; never shrink" |

### 🚫 反驳

无（reviewer findings 全部站得住脚）。

### 🟡 挂起

无。

## 关键决策汇总

1. **`retrospectives` → `lessons`** (避 harness.db naming collision；语义上 "lesson" 更直接对应 "教训/经验")
2. **`vessel-core closeout finalize`** 是闭合 auto-INSERT 的唯一生成层入口；不允许 Claude 手 INSERT 或后续扫文件补
3. **`redactFreeformText`** 抽到 `redact-helpers.ts`，覆盖完整 PATTERN_RULES + `~`/`$HOME`/相对路径
4. **FTS5 trigger 照搬 Eva `issue_fts` pattern verbatim**（已工业验证）
5. **fingerprint = sha256(date+planFile+contract+biggestInsight).slice(0, 16)**
6. **migration 0002，DB target memory.db**

## 修订后的 LOC 估算

| 产物 | 修订 LOC |
|---|---|
| `0002_m1_lessons.sql` (含 3 trigger) | ~70 |
| `memory/lesson-store.ts` | ~80 |
| `observability/redact-helpers.ts` (新；redactFreeformText) | ~30 |
| CLI: `vessel-core lesson add/search/list` | ~40 |
| CLI: `vessel-core closeout finalize` | ~50 |
| HTTP: `GET/POST /api/vessel/lessons` | ~30 |
| `scripts/import-debate-log.ts` | ~80 |
| `test-lessons.ts` (含 redact + FTS5 + import idempotent) | ~80 |
| **总计** | **~460** |

仍 fit 在 "先不做复杂的"（M0.5 量级）。

## 决策

✅ **PASS-WITH-FIXES applied** — 可以进 implementation。所有 3 BLOCKER + 4 MAJOR + 5 MINOR 已落到 proposal patches。

## debate-review log entry

```json
{"date":"2026-05-10","planFile":"docs/reviews/L1-retrospectives-*","totalClaims":13,"accepted":13,"partial":1,"rejected":0,"hung":0,"biggestInsight":"第 11 次 cursor + Claude 互补：architect 抓 table name 与 Eva harness.db 冲突 (要 grep 验证) — Claude 视角看 'memory.db vs harness.db 分库 = 名字独立空间' 但实际语义命名空间是项目级。Cursor 抓 'closeout auto INSERT 没有生成层入口' — 把 M1A-β 'fix 必须放生成层' 教训直接套到本次提案，发现声明在生成层但没真的入口","biggestMistake":"提案设计时把 closeout writer 当现成程序组件，但 closeout markdown 是 Claude 手写。生成层 vs 消费层规则需要 'real entry point check'，不能口头声明","newPrinciplesAdded":1,"newRisksAdded":0,"reviewerSkippedQuestions":[],"counterChallenges":[],"contract":"L1-retrospectives B-level review (architect + cursor cross)","mechVersion":"v2-lite-B"}
```
