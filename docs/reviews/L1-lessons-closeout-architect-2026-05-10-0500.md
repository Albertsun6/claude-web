# L1-minimal closeout — vessel-architect Phase 1 review

**Date**: 2026-05-10 05:00
**Reviewer**: vessel-architect (Claude, main session)
**Lens**: 5 接口契约 / 模块边界 / 长期演进
**Inputs**:
- arbiter: [L1-retrospectives-arbiter-2026-05-10-0420.md](L1-retrospectives-arbiter-2026-05-10-0420.md)
- migration: [migrations-memory/0002_m1_lessons.sql](../../packages/backend/src/migrations-memory/0002_m1_lessons.sql)
- redact-helpers: [observability/redact-helpers.ts](../../packages/backend/src/observability/redact-helpers.ts)
- lesson-store: [memory/lesson-store.ts](../../packages/backend/src/memory/lesson-store.ts)
- session-store delta: [memory/session-store.ts](../../packages/backend/src/memory/session-store.ts)
- CLI: [cli/vessel-core.ts](../../packages/backend/src/cli/vessel-core.ts)
- HTTP: [routes/vessel-intent.ts](../../packages/backend/src/routes/vessel-intent.ts)
- importer: [scripts/import-debate-log.ts](../../scripts/import-debate-log.ts)
- tests: [test-lessons.ts](../../packages/backend/src/test-lessons.ts) (21 assertions all pass)

---

## 0. TL;DR

总体 **PASS-WITH-FIXES**。BLOCKER 全部落地，FTS5 trigger 照搬 Eva pattern verbatim，redact-helpers 边界清晰，独立 module 决策合理。**1 BLOCKER**（closeout finalize 入口仍未真闭合 — CLI 存在但 skill / verify-gate 流程没强制调）。**2 MAJOR**（importer 跨 workspace import 路径 + searchLessons FTS path tag dedup 用 LIKE 不安全）。**3 MINOR**。

---

## 1. 4 question 直答（lens-aligned）

### Q1 — migration loader 改造 (session-store.ts MIGRATIONS array) 正确性

**判定**: ✅ 正确，**1 MINOR 边界提示**。

正面：
- `MIGRATIONS = [{version:1,file},{version:2,file}]` + `for (const m of MIGRATIONS) if (current < m.version) exec(file)` + 整个 loop 包在 `db.transaction(...)` 是教科书写法。
- `pragma user_version = MEMORY_SCHEMA_VERSION` 在事务尾部，CRASH 中断会回滚整个 0001+0002，重启时 `current` 仍是 0，再跑一次 — idempotent 保证靠 SQL 内 `CREATE … IF NOT EXISTS` 兜底。
- 文件头注释 `M0=1, M1=2` + arbiter 决策 `DB target memory.db (NOT harness.db)` 都写明。

**回退路径风险（旧 vessel-core 跑新 DB）**: ⚠️
- 如果用户在新 DB（`user_version=2`）上跑旧 vessel-core（只知道 `MEMORY_SCHEMA_VERSION=1`）：当前 loader 写法是 `if (current < MEMORY_SCHEMA_VERSION)` — 旧 binary 的 `current=2 > MEMORY_SCHEMA_VERSION=1` 直接 skip migration apply，DB 仍然有 `lessons` 表（旧 binary 不会 DROP），读写 sessions/intents 不受影响。**安全。**
- 但旧 binary 的 lessons CRUD 路径不存在，所以新 DB 里的 lessons 数据**对旧 binary 不可见但也不会被破坏** — 这是符合预期的 forward-compat 行为。

**MINOR-arch-1**: 建议在 session-store.ts 加一行 assertion：`if (current > MEMORY_SCHEMA_VERSION) console.warn('memory.db user_version=N exceeds binary KNOWN=M; older binary may miss new tables')` — 避免用户 silent downgrade 不察觉。LOC ~3。

### Q2 — closeout finalize 入口闭合（核心 BLOCKER 是否真修了）

**判定**: 🚨 **BLOCKER-arch-1: 入口存在但没强制 — 仍是声明在生成层，但消费层（Claude session）依然可以绕过。**

事实链：
1. `vessel-core closeout finalize` CLI 写得对（`cmdCloseoutFinalize` line 225-270，原子 redact→INSERT→appendFileSync）。
2. arbiter 决策 line 31: "closeout 跑完 verify-gate 后 owner 跑此命令；不允许靠 Claude session 手 INSERT；4-way review verdict markdown 必须含 `lesson_id: <returned-id>`"。
3. **但**：grep `closeout finalize` 只命中 arbiter / cross verdict 自身和这次 review，**没有 skill / verify-gate 模板 / hook 引用它**。
4. `~/.claude/skills/debate-review/SKILL.md` 第 5 步 "落改动 + 收尾" 只说 "用文本简短报告" — **完全没有提示要跑 `vessel-core closeout finalize`**。
5. Verify-gate markdown 现存样本（`*-verify-gate-*.md`）没一个含 `lesson_id:` 行。

**这就是 M1A-β 教训的复发**：声明 "fix 必须放生成层"，但生成层入口没真接到流水线，依然靠 Claude session 自律。L1-minimal arbiter 的 `biggestMistake` 已经写了 "声明在生成层但没真的入口" — 这次实施重复了一遍。

**强制方式（按风险递增）**:
- (A) 改 debate-review SKILL.md 第 5 步加显式条目："跑 `pnpm vessel-core closeout finalize --milestone=... --report=docs/reviews/<name>.md --insight=<biggestInsight from log entry> --mistake=<...>`，把返回的 `lesson_id` 验证已写到 report markdown 末尾"。**最低成本，零代码**。
- (B) 加 `scripts/verify-closeout-lesson.sh`：扫 `docs/reviews/*verify-gate*.md` 末尾，查每个 verify-gate 都有 `lesson_id:` 行；缺则 exit 1。CI gate / pre-push hook 调。**LOC ~30**。
- (C) verify-gate skill 跑完直接调 closeout finalize（programmatic），不靠人。**LOC ~50** + skill rewrite。

**Fix 推荐**: (A) + (B) 组合。skill prompt 先加显式 step（几行 markdown），再加 verify script 在 CI 里挡 — 双层防护，cost 极低。**这是 BLOCKER 不是 MAJOR**：L1 整套 mechanism 的核心价值就是 "review 跑完→自动沉淀" 闭环，闭环不闭等于这个 mechanism 形同虚设，下一次 closeout 还是 Claude 手写 markdown 完事。

### Q3 — import script 跨 workspace 边界 import

**判定**: ⚠️ **MAJOR-arch-1: 路径正确但脆弱**。

事实：`scripts/import-debate-log.ts` line 17:
```ts
import { addLesson, computeImportFingerprint, searchLessons }
  from '../packages/backend/src/memory/lesson-store.js';
```
- `.js` 扩展名（ESM 标准），TS 编译/tsx 转换时 resolve 到 `.ts`。
- 跑法是 `pnpm --filter @vessel/backend exec tsx ../../scripts/import-debate-log.ts`（README 注释里的命令）— 这意味着在 `packages/backend/` cwd 下跑 tsx，相对路径 `../packages/backend/src/...` 从 backend cwd 看是 `../../packages/backend/src/...`。**当前 README 命令写的相对路径前缀对 cwd 假设过窄**。

**验证**: 我没真跑（review-only），但读路径串可以推断：从 backend/ 跑 `../../scripts/import-debate-log.ts`，script 内部 `import '../packages/...'` 是从 script 文件位置（`/scripts/`）算的，应该 OK — tsx 用 file URL 解析。**实际问题不在路径解析，在 import policy**:

- Vessel 是 pnpm workspace。`scripts/` 目录**没有 package.json**，不算 workspace member。它直接跨 boundary import `@vessel/backend` 内部源文件而不是 published API。
- 这违反了 monorepo 模块边界：未来 backend refactor `lesson-store.ts` 内部签名（譬如 addLesson 改 typed args 或拆 helpers），scripts 的导入会 silent break；编译/lint 检查可能漏。
- 如果以后 lesson-store 加 internal-only helper，无 `export` 边界保护。

**回退/重跑安全性**: ✅ idempotency 靠 `import_fingerprint UNIQUE INDEX` 已保证，多跑无副作用。`searchLessons({tag: fp})` 用 `tags LIKE '%fp%'` 做 dedup pre-check 可能误命中（见 Q4 + MAJOR-arch-2），但 INSERT 后 UNIQUE 触发 throw 兜底。**dry-run flag 行为正确**，不写库。

**Fix 推荐**:
- 短期 MINOR 修：scripts/import-debate-log.ts 顶部加注释 "imports backend internals; coupled to lesson-store.ts API surface — break ARM if signatures change"。
- 长期：要么把 importer 升级成 backend 的一个 `tsx src/scripts/import-debate-log.ts` 入口（package.json `bin` 或 `scripts` entry），要么走 HTTP（POST `/api/vessel/lessons` with `import_fingerprint`）— 后者更干净，importer 完全脱离 backend 源码耦合。**M1C 起做 Memory full surface 时这个 importer 应迁移到 HTTP path**。

### Q4 — lessons.refs_json 弱 FK 与 schema 演进负担

**判定**: ⚠️ **MAJOR-arch-2 (FTS path 借用 tag LIKE '%fp%' 做 dedup) + MINOR forward-compat**.

事实：
- `lessons.refs_json` 是 JSON1 数组字段，可放 `[trace_id, run_id, session_id, "docs/reviews/...md"]` 任意混杂。**无 FK enforce, 无 schema validation, 无 GIN-style index**。
- arbiter MINOR architect m-4 已 defer 这个：proposal 加 note "升级 retro_refs join 表是 ALTER ADD TABLE 兼容操作"。

**M1C-B Memory full surface 时是否成为负担？**
- ⚠️ **会**，但不是 schema 演进负担（ALTER ADD TABLE 一直能加）；是**查询负担**:
  1. "找所有引用 trace_id=X 的 lessons" 现在只能 `SELECT … WHERE refs_json LIKE '%X%'` → 全表扫 + JSON 解析。lessons 表小时无所谓，N>10K 时慢。
  2. "trace_id=X 是否还活着" 没法 join 验证 — orphan reference 检测要写专门 script。
- ✅ 但不是阻断性，因为：
  - L1-minimal 单机 personal use, lessons 行数 N<1000 数年。
  - JSON1 generated column + index 是 SQLite 标准技术：未来 `ALTER TABLE lessons ADD COLUMN ref_trace_id TEXT GENERATED ALWAYS AS (json_extract(refs_json, '$[0]')) STORED` + index — 这就是 in-place 升级，不要 join 表。
  - retro_refs join 表方案（arbiter 提）也合法，迁移 SQL ≤30 行。

**MAJOR-arch-2 (separately, 同源)**: lesson-store.ts `searchLessons` 接受 `opts.tag` 时用 SQL `tags LIKE '%' || @tag || '%'`：
- 16-char hex fingerprint 被当 tag 存进去，搜索时 LIKE 匹配 — 会**误命中**任意包含该字符串的 tags 列。譬如两个 lesson tag 分别是 `abc123` 和 `prefix-abc123`，按 `tag=abc123` 搜返回两个都，importer dedup 路径会 false-positive 视作 dup 而 skip 不该 skip 的 entry。
- 实际触发概率：fingerprint 是 sha256 截 16 hex，碰撞极小，但**短 tag**（如 `'closeout'`）也走同一个 path 是真的会乱。
- 重要的是：importer 已用 `import_fingerprint UNIQUE INDEX` 做严格 dedup，**`searchLessons({tag: fp, limit: 1})` 只是 pre-check 优化**。即使 LIKE 误命中导致 false positive skip，也会丢实际应该新增的 entry。

**Fix 推荐**:
- 短期 (MAJOR fix): importer 不要走 `searchLessons({tag: fp})` 做 dedup，直接用 `db.prepare('SELECT id FROM lessons WHERE import_fingerprint = ?').get(fp)` — 1 行精确查询 + 已有 UNIQUE INDEX 加速。**LOC ~3 改动**。importer 应该认识到 tag LIKE 是**模糊**而 import_fingerprint 是**精确**字段，dedup 必须精确。
- 长期 (MINOR forward-compat): refs_json 加 ADR-006-style 注释 "future M1C-B may add `lesson_refs` join table or generated columns; refs_json values format is `[<id>|docs/path|trace_id|run_id]` — keep entries as opaque strings to ease migration"。

---

## 2. Severity 表

| ID | Severity | Where | What | Fix LOC |
|---|---|---|---|---|
| BLOCKER-arch-1 | 🚨 BLOCKER | debate-review SKILL.md + verify-gate workflow | closeout finalize CLI 存在但没强制调；skill 第 5 步无提示，无 CI gate 检查 lesson_id；M1A-β "声明 vs 真入口" 教训复发 | (A) ~10 行 SKILL 修订 + (B) ~30 行 verify-closeout-lesson.sh |
| MAJOR-arch-1 | 🚨 MAJOR | scripts/import-debate-log.ts | 跨 workspace boundary import 内部 src 文件，无 package.json 边界保护，签名变化静默 break | 短期注释 ~3；长期迁 HTTP /api/vessel/lessons (M1C) |
| MAJOR-arch-2 | 🚨 MAJOR | lesson-store.ts searchLessons + importer dedup pre-check | importer 用 `searchLessons({tag: fp})` LIKE 模糊匹配做精确 dedup，false-positive skip 风险；应直接 SELECT WHERE import_fingerprint = ? | ~3 行改 importer |
| MINOR-arch-1 | MINOR | session-store.ts | 缺 `current > KNOWN` warn，silent forward-incompat | ~3 行 |
| MINOR-arch-2 | MINOR | scripts/import-debate-log.ts | 跨 workspace import 应加 "coupled to internal API surface" 注释 | ~2 行 |
| MINOR-arch-3 | MINOR | migrations-memory/0002_m1_lessons.sql | refs_json forward-compat 注释建议 + "values are opaque strings" | ~2 行 |

---

## 3. 不变量审查（5 接口契约 lens）

✅ **保持得好**:
1. **lesson-store 是独立 module 不进 Memory interface** — 边界清晰：storage backend (SQL CRUD vs Memory.short/sessionKv 的 KV) / writer driver (closeout-driven vs runtime-driven) / sessionId boundary (跨 session vs per-session)。这是正确决策，arbiter 加 ROADMAP note "M1C-B 落 LongTerm 时 re-evaluate" 也合理。
2. **redactFreeformText 与 trace-redactor 边界文档化** — redact-helpers.ts 文件头明确 "trace-redactor: structured trace events; redactFreeformText: free-form string"。两个 redactor 共享 PATTERN_RULES 但各自 owned 的 surface — 这就是 single source of truth 但分领域消费的好范式。
3. **Generation-layer pattern 真落地** — addLesson 内部强制 redact，**caller 不能传 already-redacted 干扰**（双 redact 是 idempotent，因为 mask 出来的 `***-redacted-<6hex>***` 不再匹配 PATTERN_RULES）。
4. **HTTP / CLI parity** — POST /api/vessel/lessons 和 `vessel-core lesson add` 走同一个 addLesson()，body cap + kind validation 在两层都有。
5. **migration 0002 idempotency** — `CREATE … IF NOT EXISTS` 兜底，事务包裹整个 apply loop，user_version 在 commit 内更新 — 标准 pattern。

⚠️ **薄弱处**:
- **Closeout entry 闭环未真接通**（BLOCKER-arch-1）— 见 Q2。
- **lessons API surface 半隔离**：HTTP 有 GET/POST，CLI 有 add/search/closeout — 但**没有 GET /lessons/:id**（CLI 也没 `lesson get`）。这意味着 closeout finalize 返回的 lesson_id，外部 reviewer 想验证只能 `pnpm vessel-core lesson search --tag=closeout` 模糊找。MINOR 但影响 BLOCKER-arch-1 的 verify script 实现。

---

## 4. 长期演进 lens（M1C-B Memory full surface 视角）

- **lesson-store 进 Memory interface 时机**: 当 Memory 真正落 LongTerm（向量检索 / 嵌入 / RAG），lessons 应作为 LongTerm 的一类 backed-by-SQL provider 暴露 search 接口，但**不 collapse 表结构** — 因为 lessons schema 的 metadata 字段（kind / milestone / status / contradicts_id）比通用 LongTerm 富很多。
- **Schema 演进策略**: ADR-006 的 "kind CHECK may only widen; never shrink" 注释已写。建议 M1C 起追加：
  - `status='contradicted'` 触发的 contradicts_id 验证（外键 ON DELETE SET NULL）— 现在是 `REFERENCES lessons(id)` 但未指定 ON DELETE，默认 NO ACTION，可能 dangling。
  - `refs_json` JSON1 generated column + index（trace_id / run_id 高频查询用）。
- **跨 DB 演进负担**: harness.db `retrospective` 表 vs memory.db `lessons` 表是 by-design 分隔。arbiter 已确认。但**未来 M1C 如果 harness 也想搜 lessons**，HTTP /api/vessel/lessons 已是边界，不要让 harness 直接 attach memory.db。

---

## 5. 总结（≤200 字）

L1 实施基本到位：FTS5 trigger 照搬 Eva pattern 工业验证、redact-helpers 边界清晰、独立 module 决策合理、21 assertions 通过。但**核心闭环未真闭** — `closeout finalize` CLI 已存在却没强制接到 debate-review skill 第 5 步或 verify-gate CI，重复 M1A-β "声明 vs 真入口" 教训（BLOCKER-arch-1）。importer 的 LIKE-based dedup pre-check 与精确 fingerprint 字段错配会 false-positive skip（MAJOR-arch-2），跨 workspace src import 缺边界保护（MAJOR-arch-1）。3 MINOR 关于 forward-compat 注释。**修复推荐**: SKILL.md 加显式调 `vessel-core closeout finalize` 步骤 + 加 verify-closeout-lesson.sh CI gate（共 ~40 LOC），importer dedup 改 `WHERE import_fingerprint = ?`（3 LOC），其余 MINOR 注释化。整体 PASS-WITH-FIXES。

---

## debate-review log entry (suggested)

```json
{"date":"2026-05-10","planFile":"docs/reviews/L1-lessons-closeout-*","totalClaims":4,"accepted":4,"partial":0,"rejected":0,"hung":0,"biggestInsight":"实施 review 抓出 'closeout finalize CLI 写完 ≠ 闭环闭合' — arbiter 强制 'verdict markdown 必须含 lesson_id' 但没人查这条线，复发 M1A-β 教训。BLOCKER-arch-1 提的 (A)+(B) 组合最便宜 ~40 LOC","biggestMistake":"L1 arbiter 已经把 'fix 必须放生成层' 写进决策但仍然忘了把 SKILL.md 第 5 步同步更新 — 流程文档 + 实施 = 两个生成层 surface，缺一不可","newPrinciplesAdded":0,"newRisksAdded":1,"reviewerSkippedQuestions":[],"counterChallenges":["importer 走 HTTP 是更彻底的边界 fix，但要等 M1C — 现在打注释 stop-gap 即可"],"contract":"L1-lessons-closeout architect Phase 1","mechVersion":"v2-lite-closeout"}
```
