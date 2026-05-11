# Cross Review — L1 lessons closeout

**Reviewer**: vessel-cross-reviewer  
**Model**: gpt-5.5 (Cursor)  
**Date**: 2026-05-10 05:00  

## Summary

- Blockers: 1
- Majors: 3
- Minors: 2
- Lens 5 findings: 2
- Overall verdict: **必须先修 B1，再 closeout**。`addLesson()` 已经把 title/body redaction 放到生成层，FTS5 trigger happy path 也被 21 assertions 覆盖；但 HTTP write surface 仍能制造 `review_closeout` lesson，绕过 `closeout finalize` 的原子 traceability，并且 FTS/search/import 还有几个 byte-level 边界没被测试压到。

## Numeric Score

| Lens | Score |
|---|---:|
| 正确性 | 3.7 |
| 跨端对齐 | 4.0 |
| Eva 改造 + Vessel 硬约束 | 4.1 |
| 安全 + 4 类硬触发 | 3.5 |
| 集体盲区检测 | 4.2 |

**Overall**: 3.8（有 BLOCKER，上限 3.9）

## 5 个具体问题结论

1. **addLesson redaction — PASS, with field caveat**: `lesson-store.ts:57-85` 对所有通过 store 的 caller 统一 redact `body` 和 `title`。CLI / HTTP / closeout finalize / import script 都调用 `addLesson()`，所以这两列是 single-source-of-truth。双重 redact git-tracked verdict 内容可接受，因为 source markdown 仍在 `refs_json`；但 `tags` / `refs_json` / `milestone` 不经过 redactor，HTTP 任意写入时仍可能存绝对路径或 token-like 字符串。
2. **HTTP POST /api/vessel/lessons — FAIL (BLOCKER)**: `vessel-intent.ts:150-177` 接受任意合法 `kind`，包括 `review_closeout`。这确实 bypass `vessel-core closeout finalize`，也不会 append `lesson_id` 到 report。
3. **FTS5 同步/性能 — PASS for 150, minor for 1000**: 150 行 import 触发 150 次 row-level trigger 没问题；未来 1000+ 更主要的成本不是 trigger pattern，而是 import script 每条 autocommit + `getLesson()`。需要 batch transaction，但不是 L1 blocker。
4. **MIGRATIONS 顺序 — PASS**: `session-store.ts:52-64` 旧 DB `user_version=1` 只跑 0002；全新 DB `user_version=0` 按数组顺序跑 0001→0002。0002 不依赖 0001，所以顺序和依赖都成立。
5. **最可能漏看 — 两类生成层错觉**: 第一，`closeout finalize` 被当成唯一入口，但 HTTP route 同样能生成 closeout lesson；第二，redaction 被放进 `addLesson()`，但只有 title/body 两列继承，refs/tags/milestone 没继承。

## Findings

### B1 [BLOCKER] HTTP lessons write surface bypasses `closeout finalize`

**Where**: `packages/backend/src/routes/vessel-intent.ts:150-177`, `packages/backend/src/cli/vessel-core.ts:218-269`, `docs/reviews/L1-retrospectives-arbiter-2026-05-10-0420.md:30-32`

**Issue**: Phase 3 决策说 `vessel-core closeout finalize` 是 closeout auto-INSERT 的唯一生成层入口，并且要原子完成 redact → INSERT → append `lesson_id` 到 report。但 HTTP `POST /api/vessel/lessons` 直接允许 `kind='review_closeout'`，只做 INSERT，不绑定 report，不 append `lesson_id`，也不强制 closeout tags / refs。

**Why blocker**: 这会让本次制度性修复回到“Claude 手 INSERT / 任意 caller INSERT”的状态。测试能证明 `addLesson()` 会写入，但不能证明 closeout 流程具有可追溯闭环。

**Suggested fix**: L1 先在 HTTP route 禁止 `kind === 'review_closeout'`，返回 400 并提示使用 `vessel-core closeout finalize`。如果以后需要远程 closeout，新增专门的 `POST /api/vessel/closeout/finalize`，复用同一 finalize function，并要求 `report` / `insight` / `milestone`。

### M1 [MAJOR] Raw FTS5 query string can throw on normal lesson text

**Where**: `packages/backend/src/memory/lesson-store.ts:97-110`, `packages/backend/src/routes/vessel-intent.ts:137-147`, `packages/backend/src/test-lessons.ts:101-103`

**Issue**: `searchLessons({ q })` 把 user query 直接传给 `lessons_fts MATCH @q`。FTS5 query language 对 `-`, `"`, `:`, `*`, path-like token 等有语法含义；搜索 `M1A-β`、`docs/reviews/foo.md`、`sk-ant-*` 一类真实 review 词可能抛 SQLite syntax error。现有测试只搜 `redaction`，覆盖不到 malformed query。

**Suggested fix**: 对普通搜索走 quoted phrase escape，例如把 `"` double 成 `""` 后传 `"${escaped}"`；或 catch SQLite FTS syntax error fallback 到 `LIKE`。补测试：`q='M1A-β'`, `q='docs/reviews/L1-retrospectives-*'`, `q='foo:bar'` 不应 500。

### M2 [MAJOR] `addLesson()` redacts title/body, but writable metadata can still persist raw secrets/paths

**Where**: `packages/backend/src/memory/lesson-store.ts:57-83`, `packages/backend/src/routes/vessel-intent.ts:155-175`

**Issue**: `title` 和 `body` 已在生成层 redact；但 `tags`, `refs`, `milestone` 直接进入 `tags` / `refs_json` / `milestone`。CLI/import 的 caller 基本传 safe docs refs；HTTP POST 是 generic write surface，外部 caller 可以提交 `refs: ["/Users/alice/.ssh/id_rsa"]` 或 token-like tags，并被原样持久化。

**Suggested fix**: 对 `refs` 和 `milestone` 也调用 `redactFreeformText()`；`tags` 更适合严格 schema：只允许 `[A-Za-z0-9_.:-]{1,64}`，拒绝包含 slash / whitespace / token-like 长串的 tag。

### M3 [MAJOR] Import dedup check does not use the unique column it relies on

**Where**: `scripts/import-debate-log.ts:98-107`, `scripts/import-debate-log.ts:149-156`, `packages/backend/src/migrations-memory/0002_m1_lessons.sql:40-41`

**Issue**: migration 的真实 dedup invariant 是 `import_fingerprint` UNIQUE INDEX；import script 预查却用 `searchLessons({ tag: fp })`。只要 DB 里已有同 fingerprint 但 tags 缺 fp 的 row，预查会 miss，随后 `addLesson()` 触发 UNIQUE violation 并让整个 import 中断。这个边界类似 M1A-β “单 caller 漏看”：脚本假设所有历史 row 都由当前脚本形状生成。

**Suggested fix**: 给 lesson-store 增加 `getLessonByImportFingerprint(fp)`，import script 用它预查；或者捕获 SQLITE_CONSTRAINT_UNIQUE 并按 skipped 处理。

### m1 [MINOR] Bulk import should wrap writes in one transaction before 1000+ rows

**Where**: `scripts/import-debate-log.ts:175-200`, `packages/backend/src/memory/lesson-store.ts:57-85`

**Issue**: 150 条 row-level FTS trigger 成本 OK；1000+ 时更慢的是每条 `addLesson()` 单独 INSERT + `getLesson()`，处在 SQLite autocommit 边界。FTS trigger pattern 本身没问题。

**Suggested fix**: 后续导入量变大时加 `addLessonsBatch()` 或在 script 层开 `db.transaction()`，并在批量路径返回 inserted/skipped 计数而不是每条 `getLesson()`。

### m2 [MINOR] `importance` validation relies on SQLite error instead of route-level 400

**Where**: `packages/backend/src/routes/vessel-intent.ts:155-175`, `packages/backend/src/migrations-memory/0002_m1_lessons.sql:29`

**Issue**: HTTP route 没校验 `importance` 范围和类型，非法值会穿到 SQLite CHECK constraint，表现为 500 而不是 client-facing 400。CLI `parseInt()` 也允许 `--importance=abc` 变成 `NaN` 传入。

**Suggested fix**: 在 CLI/HTTP 入参层要求 integer 1..5；非法直接 400 / exit 2。

## False-Positive Watch

- B1 如果 owner 明确把 HTTP POST 定义为“非 closeout 的手动 lesson add”也仍需代码 enforce，因为当前 route 没排除 `review_closeout`。
- M2 的 refs/tags 泄漏需要恶意或错误 caller；但 HTTP route 已是 generic write surface，所以不能只按当前 import script 的 safe caller 判断。
- M1 需要用具体 FTS5 tokenizer 实跑确认 exact bad query 集合；但 raw MATCH user input 抛 syntax error 是 FTS5 已知行为，现有测试没有覆盖。

## What I Did Not Look At

- 没有重审 B-级 review 已修项：rename、FTS trigger 基本 pattern、fingerprint 公式、redactFreeformText pattern spec。
- 没有运行 `pnpm --filter @vessel/backend test:lessons`；本次按要求做静态 byte-level review，并采信 21 assertions 已 pass。
- 没有审 Swift/iOS 或前端展示，因为 L1 lessons closeout 范围是 backend memory + CLI + HTTP + import。

## Lens 5 — Claude 集体盲区判断

这次最可能漏看的是 **“唯一生成层入口”的实现范围被口头收窄了**：大家会看见 `closeout finalize` 已存在，于是默认制度闭环成立；但实际代码还有一个 generic HTTP writer，且允许同一 `review_closeout` kind。第二个盲区是 **“redaction 在 addLesson”被等同于“整条 lesson row 都安全”**：title/body 是安全的，metadata columns 不是。
