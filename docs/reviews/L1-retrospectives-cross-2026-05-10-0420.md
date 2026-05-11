# Cross Review — L1-minimal evolution mechanism

**Reviewer**: cursor-cross-reviewer (ADR-017 heterogeneity lens)
**Date**: 2026-05-10 16:31
**Verdict**: **FAIL / NOT-YET-PASS**

## Files Reviewed

- `docs/reviews/L1-retrospectives-proposal-2026-05-10-0420.md`
- `docs/research/evolution-mechanism-2026-05-10.md`
- `docs/adr/vessel/ADR-006-schema-evolution.md`
- `packages/backend/src/migrations-memory/0001_m0_sessions.sql`
- `packages/backend/src/observability/trace-redactor.ts`
- `packages/backend/src/memory/session-store.ts`
- `~/.claude/skills/debate-review/log.jsonl`
- `docs/reviews/M1A-beta-review-p3-arbiter-2026-05-10-0320.md`

## PASS/FAIL

方向 PASS：单表 + FTS5 + manual/closeout 双入口符合 L1-minimal。

当前提案 FAIL：不是因为 FTS5 不能做，而是 **redact-at-write 和 closeout auto INSERT 的生成层责任没有落到真实入口**。这正好踩中 M1A-β 制度性 lesson：fix 必须放生成层，不能靠后续消费层或人脑补流程。

## 4 Questions

### 1. FTS5 trigger byte-level 正确性

`content_rowid='rowid'` + SQLite hidden rowid 在技术上可行。`AFTER INSERT` trigger 里 `NEW.rowid` 可用；better-sqlite3 是同步 API，不改变 SQLite trigger 在同一 statement/transaction 内执行的语义，所以这里没有 JS async race。

真正风险在 trigger 写法和 rowid 稳定性：

- INSERT 应写入 FTS hidden `rowid`：`INSERT INTO retrospectives_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags)`.
- DELETE 不能普通 delete，应使用 FTS5 external-content delete command：`INSERT INTO retrospectives_fts(retrospectives_fts, rowid, title, body, tags) VALUES('delete', old.rowid, old.title, old.body, old.tags)`.
- UPDATE 应先 delete old，再 insert new。
- hidden rowid 不是业务 id；如果未来做 VACUUM/表重建/导入导出，未显式 alias 的 rowid 有稳定性风险。L1 可接受，但 migration 必须有 FTS rebuild 测试。

结论：无 better-sqlite3 race；有 byte-level trigger correctness 风险，必须在 `0002` 里写完整 3 trigger + rebuild/UPDATE/DELETE 测试。

### 2. redact-at-write false-negative

现有 `trace-redactor.ts` 对自由文本“部分适合”：

- `/Users/yongqian/.ssh/...` 会被 `/\/Users\/[^/\s]+\/[^\s]*/` 命中，但带空格路径会在空格处截断，`~/...`、`$HOME/...`、相对 secret path 不会命中。
- `sk-ant-test-fake-deadbeef-12345` 不满足专门的 `sk-ant-...{40,}`，但会被 generic 20+ token pattern 命中；短 token、分段 token、带中文标点拆开的 token 会漏。
- UUID v4 和纯 hex 16+ 被显式 whitelist，不会 mask。若某系统把 UUID 当 bearer secret，这会 false-negative；若只是 trace/session id，这是合理选择。
- trace redactor 的 field-path force-mask 对 retro body 无意义，因为 retro body 是单个 free-form string，没有 JSON path 语义。

结论：`redactRetroBody` 不能只写“path relativize”。它至少要复用 `redactString` 级 pattern，并新增 `~`/`$HOME`/空格路径测试。验收不能只查“不含 `/Users/yongqian`”，还要查 token-like、home shorthand、UUID policy。

### 3. closeout 集成路径

提案说 “closeout writer 主动 INSERT”，但当前 closeout/verify-gate doc 是 Claude session 用 Write tool 手写 markdown，不存在程序化 writer。按现状无法真 auto INSERT。

两个可行路径：

- 轻量路径：在 closeout 生成层 skill 中强制调用 `vessel-core retro add --kind=review_closeout ...`，并把返回 id 写回 markdown。这个是“Claude 手触发 CLI”，不是完全自动，但责任在生成层。
- 稳定路径：新增 `vessel-core closeout finalize --review-log-entry ... --report ...`，由它同时写 markdown/校验 report path/INSERT retrospective row。这样才配叫 auto closeout。

不能走的路径：事后扫 `docs/reviews/*verify-gate*.md` 或 HTTP/CLI search 时补 redact/补 insert。这是消费层修复，会复现 M1A-β 的 leak 模式。

### 4. 基于 log.jsonl 10 次 cursor catch + “fix 放生成层”，最可能漏看的是

最可能漏看的是 **“生成层”被口头指定了，但没有变成唯一入口**。

历史上 cursor 多次抓到的是这种类型：文件写了但 entry 没调用、migration 放错目录、HTTP 修了但 WS 绕过、文档估算没读真实代码。这里同形问题是：retro store/redactor/FTS 都可以写对，但 closeout 实际仍由 Claude 手写 markdown 完成；只要没有强制 CLI/wrapper，retro row 就会漏写，或写入未脱敏正文。

## Findings

### B1 [BLOCKER] closeout auto INSERT 没有真实生成层入口

**Where**: `docs/reviews/L1-retrospectives-proposal-2026-05-10-0420.md` §范围、§Sub-acceptance、§7 个 uncertainty #2；`docs/reviews/M1A-beta-review-p3-arbiter-2026-05-10-0320.md` 制度性教训

**Issue**: 提案把 closeout writer 当成已有程序组件，但真实 closeout 是 Claude 手写 markdown。

**Why blocker**: 这会导致 review_closeout row 漏写，或后续靠 import/扫描补写；一旦补写发生在消费层，就违反 M1A-β “redaction/sanitization fix 必须放生成层”。

**Fix**: 在 implementation 前选定一种生成层入口：`retro add` 写入作为 closeout skill 的强制步骤，或新增 `closeout finalize` wrapper。验收项改成“closeout 命令返回 retro_id，并写回 markdown refs”。

### B2 [BLOCKER] redactRetroBody 规格不足，验收只覆盖 home path

**Where**: `docs/reviews/L1-retrospectives-proposal-2026-05-10-0420.md` §Sub-acceptance、§7 uncertainty #6；`packages/backend/src/observability/trace-redactor.ts`

**Issue**: 提案说轻版 redactor “path relativize + token pattern”，但验收只要求不含 `/Users/yongqian/...`。free-form retro body 没有 trace JSON path，不能受益于 force-mask subtree。

**Why blocker**: retrospective body 会长期存入 memory.db；false-negative 不是显示层问题，是持久化泄漏。

**Fix**: 抽出并导出 string-level redactor，例如 `redactFreeformText(text, { relativizeHome: true })`；测试覆盖 `/Users/yongqian/.ssh/...`、`~/...`、`$HOME/...`、带空格路径、`sk-ant-*`、`sk-*`、AWS key、email、UUID whitelist policy。

### M1 [MAJOR] FTS5 trigger 方案可行但必须锁死 exact SQL

**Where**: `docs/reviews/L1-retrospectives-proposal-2026-05-10-0420.md` Schema；`docs/research/evolution-mechanism-2026-05-10.md` §10 uncertainty #5

**Issue**: 提案只说 “3 sync trigger”，没有给 external-content 的 delete/update 特殊写法。spike 里还出现过 `content_rowid='id'`，与提案的 `rowid` 立场不一致。

**Why major**: INSERT happy path 会过，但 UPDATE/DELETE 可能留下 ghost FTS row；未来实现者容易按普通 table trigger 写错。

**Fix**: 在 proposal 或 ADR 中直接写出 3 trigger 模板；测试必须覆盖 insert search、update old term no longer hits、delete term no longer hits、rebuild after migration。

### M2 [MAJOR] hidden rowid 作为 FTS key 需要声明边界

**Where**: `docs/reviews/L1-retrospectives-proposal-2026-05-10-0420.md` Schema

**Issue**: `id TEXT PRIMARY KEY` 不是 rowid alias；FTS rowid 与业务 id 分离。正常 INSERT/UPDATE/DELETE 没问题，但表 rebuild/VACUUM/导入导出时要么 rebuild FTS，要么保证 rowid 不变。

**Fix**: L1 可继续用 hidden rowid，但 migration 注释写明“FTS rowid is internal; rebuild FTS after table rebuild/VACUUM-like maintenance”。更稳的替代是显式 `rowid INTEGER PRIMARY KEY` + `id TEXT UNIQUE NOT NULL`，但这会改变 schema 美观度，不必强求。

### M3 [MAJOR] import dedup fingerprint 仍可能误合并

**Where**: `docs/research/evolution-mechanism-2026-05-10.md` §6 R2、附录 A；`~/.claude/skills/debate-review/log.jsonl`

**Issue**: `(date + planFile)` 对 glob planFile 如 `M1A-beta-*`、同日多轮 closeout、同一 planFile 二次仲裁不够稳。

**Fix**: fingerprint 至少用 `sha256(date + planFile + contract + biggestInsight)`，并加 `source_kind/source_path/source_line` 唯一索引或唯一字段。

### m1 [MINOR] kind enum 加值策略应写入 ADR-006 兼容性说明

**Where**: `docs/adr/vessel/ADR-006-schema-evolution.md` §Consequences；proposal §7 uncertainty #1

**Issue**: 提案正确指出 enum 收窄不兼容、加值兼容，但 implementation 需要说明未来加 kind 是 migration，不是直接改代码 enum。

**Fix**: `0002` 注释里写 “kind CHECK may only widen in later migrations”。

### m2 [MINOR] `body NOT NULL` 与 verdict metadata-only import 冲突

**Where**: proposal Schema；spike 附录 A

**Issue**: spike 说 verdict markdown 可只入 metadata/body 留 NULL，但 proposal schema `body TEXT NOT NULL`。

**Fix**: 要么 verdict_ref 不入 retrospectives 表；要么 body 存短摘要/空字符串并明确 `body` 不能 NULL；要么允许 `body TEXT` nullable。

## Counter-Proposals

1. **最小修正版**：保留当前 schema，但在 proposal 中补 3 trigger SQL、`redactFreeformText` 规格、`retro add` closeout 强制步骤。

2. **更稳生成层版**：新增 `vessel-core closeout finalize`，输入 review log jsonl entry + markdown report path，一次性执行：redact body → INSERT row → 返回 retro_id → append/verify markdown refs。这样 closeout 和 retro row 不会分叉。

3. **FTS fallback 版**：如果 implementation 中 FTS trigger 测试卡住，按提案退 A：先 LIKE-only ship。不要半写 FTS trigger 后靠人工 rebuild。

## Positive Observations

- 方向上正确吸收了 lessons-mcp/memem/Reflexion 的最小子集，没有过早引 vector/LLM auto-mine。
- 把 redact 放 write path 的意识是对的；问题只在具体入口和测试矩阵不够硬。
- `migrations-memory/` 独立目录与 single better-sqlite3 connection pattern符合 M0 以来的边界修复。
- 将 `status/importance/contradicts_id` 放进 L1 schema 是合理的低成本未来兼容点。

## 异质性确认

本次 cross lens 的主要异质信号不是反对方案 B，而是抓 **“声明在生成层”与“真实系统入口”之间的断裂**。这与历史 cursor catch 类型一致：entry 未调用、surface-specific fix 被新 surface 绕过、migration namespace 误吞。当前提案最需要修的是让 closeout/retro 写入成为可验证的唯一生成路径。

## What I Did Not Run

- 未运行 `sqlite3 :memory:` FTS trigger 实测：本次工具执行被拒。
- 未联网核对 lessons-mcp 源码和 SQLite docs 页面：网页抓取被拒。
- 未审 ADR-016 / Eva 复用 / 5 接口 / D' 路线，按用户要求跳过。
