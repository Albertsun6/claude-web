# Harness Data Model

> **状态**：M-1 第 1 项核心契约 v1.0（2026-05-03）。完整 DDL + audit log + FTS5 触发器；与 [packages/backend/src/migrations/0001_initial.sql](../packages/backend/src/migrations/0001_initial.sql) 同源。
>
> **导航**：[索引](HARNESS_INDEX.md) · [Architecture](HARNESS_ARCHITECTURE.md) · [Roadmap](HARNESS_ROADMAP.md)
>
> **同源**：本文是 [HARNESS_ROADMAP.md §1](HARNESS_ROADMAP.md) 的扩展版，附完整 DDL、索引、约束、FTS5 触发器、audit log 格式。
>
> **配套 ADR**：[ADR-0010](adr/ADR-0010-sqlite-fts5.md)（SQLite + FTS5）· [ADR-0015](adr/ADR-0015-schema-migration.md)（schema 迁移策略）

---

## 0. 持久化总览

新增持久层 `~/.claude-web/harness.db`（better-sqlite3 + FTS5），现有 `~/.claude-web/projects.json` 不动（向后兼容）。

```
~/.claude-web/
├── harness.db                 # better-sqlite3 + FTS5 主表
├── harness-audit.jsonl        # append-only 审计日志（所有写操作）
├── artifacts/
│   └── <hash>.md              # content-addressed Artifact 内容（>8KB 落文件）
├── bundles/
│   └── <bundleId>.md          # ContextBundle markdown snapshot（可审计）
└── projects.json              # 旧项目注册表（保留兼容）

~/.claude/projects/
└── <encoded-cwd>/
    └── <sid>.jsonl            # Claude CLI 自带 transcript（DB 只存路径）
```

**为什么选 SQLite + FTS5**：
- 实体引用密集（Issue → Stage → Task → Run → Artifact）→ JSONL 二级索引难做
- better-sqlite3 同步、零网络依赖、原生支持 Tailscale 单 Mac 部署
- FTS5 提供 Issue 全文搜索（title + body + Artifact 内容）
- 后期升 Postgres 用 Drizzle 迁移面小（[ADR-0010](#adr-0010)）

---

## 1. 核心实体

### 1.1 Project（沿用现有，扩展不改）

```sql
-- 复用 ~/.claude-web/projects.json 中现有字段；本表只对 harness 启用的项目建一行
CREATE TABLE harness_project (
  id              TEXT PRIMARY KEY,    -- 复用 projects.json 的 id
  cwd             TEXT NOT NULL,
  name            TEXT NOT NULL,
  default_branch  TEXT NOT NULL DEFAULT 'main',
  worktree_root   TEXT NOT NULL,        -- 例：<cwd>/.worktrees
  harness_enabled INTEGER DEFAULT 0,    -- 是否启用 harness 流水线
  created_at      INTEGER NOT NULL
);
```

### 1.2 Initiative（战略目标）

```sql
CREATE TABLE initiative (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES harness_project(id),
  title                 TEXT NOT NULL,
  intent                TEXT NOT NULL,
  kpis_json             TEXT NOT NULL,       -- KPI 候选 + 选定项的 JSON
  status                TEXT NOT NULL,        -- draft|active|paused|done
  owner_human           TEXT NOT NULL,
  methodology_version   TEXT NOT NULL,        -- 绑定一组方法论版本（v1, v2, ...）
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX idx_initiative_project ON initiative(project_id, status);
```

### 1.3 Issue（原子需求/反馈/bug）

```sql
CREATE TABLE issue (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES harness_project(id),
  initiative_id     TEXT REFERENCES initiative(id),    -- 可空：未挂 Initiative 的散 Issue
  source            TEXT NOT NULL,                      -- ideas_md|user_feedback|git_log|telemetry|inbox|manual
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  labels_json       TEXT NOT NULL,                      -- ["security", "migration", "cross-package", ...]
  priority          TEXT NOT NULL,                      -- low|normal|high|critical
  status            TEXT NOT NULL,                      -- inbox|triaged|planned|in_progress|blocked|done|wont_fix
  retrospective_id  TEXT REFERENCES retrospective(id),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_issue_project_status ON issue(project_id, status);
CREATE INDEX idx_issue_initiative ON issue(initiative_id);

-- FTS5 external-content 模式（content='issue' → FTS 不复制内容，靠触发器同步索引）
CREATE VIRTUAL TABLE issue_fts USING fts5(title, body, content='issue', content_rowid='rowid');

CREATE TRIGGER issue_fts_ai AFTER INSERT ON issue BEGIN
  INSERT INTO issue_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER issue_fts_ad AFTER DELETE ON issue BEGIN
  INSERT INTO issue_fts(issue_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER issue_fts_au AFTER UPDATE ON issue BEGIN
  INSERT INTO issue_fts(issue_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO issue_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
```

`status` 包含 `inbox`——碎想未分类状态（[HARNESS_ROADMAP.md §0 #14](HARNESS_ROADMAP.md)）。

### 1.4 IdeaCapture（碎想入口）★ 新增

```sql
-- 30 秒内能存一条想法的入口，不强制立即变 Issue，可批量 triage
CREATE TABLE idea_capture (
  id                       TEXT PRIMARY KEY,
  project_id               TEXT REFERENCES harness_project(id),  -- 可空
  body                     TEXT NOT NULL,                         -- 文本（语音转写后落这里）
  audio_path               TEXT,                                  -- 原始录音路径，可选
  transcript               TEXT,                                  -- STT 转写结果，可选
  source                   TEXT NOT NULL,                         -- voice|text|web
  captured_at              INTEGER NOT NULL,
  processed_into_issue_id  TEXT REFERENCES issue(id)              -- triage 后填
);
CREATE INDEX idx_idea_unprocessed ON idea_capture(processed_into_issue_id) WHERE processed_into_issue_id IS NULL;
```

### 1.5 Stage（SDLC 流水线节点）

```sql
CREATE TABLE stage (
  id                       TEXT PRIMARY KEY,
  issue_id                 TEXT NOT NULL REFERENCES issue(id),
  kind                     TEXT NOT NULL,    -- strategy|discovery|spec|compliance|design|implement|test|review|release|observe
  status                   TEXT NOT NULL,    -- pending|running|awaiting_review|approved|rejected|skipped|failed
  weight                   TEXT NOT NULL,    -- heavy|light|checklist (v4 重量分级)
  gate_required            INTEGER NOT NULL, -- 是否需要 Decision 卡点
  assigned_agent_profile   TEXT NOT NULL,
  methodology_id           TEXT NOT NULL REFERENCES methodology(id),
  input_artifact_ids_json  TEXT NOT NULL,    -- ["art1", "art2", ...]
  output_artifact_ids_json TEXT NOT NULL,
  review_verdict_ids_json  TEXT NOT NULL,
  started_at               INTEGER,
  ended_at                 INTEGER,
  created_at               INTEGER NOT NULL
);
CREATE INDEX idx_stage_issue_kind ON stage(issue_id, kind);
CREATE INDEX idx_stage_running ON stage(status) WHERE status = 'running';
```

`kind` 的 10 个值固定顺序：`strategy → discovery → spec → compliance → design → implement → test → review → release → observe`。

`weight` 分级：
- **heavy**（独立 agent + worktree + 完整产 Artifact）：design / implement / test / review / release
- **light**（一个 agent run，简化产出）：discovery / spec / observe
- **checklist**（一段 prompt + 人勾选确认）：strategy / compliance（默认）

### 1.6 Methodology ★ 新增

```sql
-- 每 Stage 的方法论文档；[stage_kind, version] 唯一
CREATE TABLE methodology (
  id            TEXT PRIMARY KEY,
  stage_kind    TEXT NOT NULL,
  version       TEXT NOT NULL,    -- semver
  applies_to    TEXT NOT NULL,    -- claude-web|enterprise-admin|universal
  content_ref   TEXT NOT NULL,    -- 指向 methodologies/<stage>-v<version>.md
  approved_by   TEXT NOT NULL,    -- "user, reviewer-cross, reviewer-architecture"
  approved_at   INTEGER NOT NULL,
  UNIQUE(stage_kind, version)
);
CREATE INDEX idx_methodology_stage ON methodology(stage_kind, version DESC);
```

### 1.7 Task（一次 agent 工作单元）

```sql
CREATE TABLE task (
  id                  TEXT PRIMARY KEY,
  stage_id            TEXT NOT NULL REFERENCES stage(id),
  agent_profile_id    TEXT NOT NULL,
  model               TEXT NOT NULL,    -- opus|sonnet|haiku
  cwd                 TEXT NOT NULL,
  worktree_path       TEXT,             -- 仅 Coder 等 requiresWorktree 的 profile 有值
  prompt              TEXT NOT NULL,
  skill_set_json      TEXT NOT NULL,
  permission_mode     TEXT NOT NULL,
  context_bundle_id   TEXT NOT NULL REFERENCES context_bundle(id),
  run_ids_json        TEXT NOT NULL,    -- 可重试，多次 spawn 的 Run id 列表
  status              TEXT NOT NULL,    -- pending|running|completed|failed|cancelled
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_task_stage ON task(stage_id);
```

### 1.8 ContextBundle ★ 新增（Context Manager 核心）

```sql
-- Context Manager 编排出的输入 snapshot；agent 看到的输入 = 这个 bundle
CREATE TABLE context_bundle (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES task(id),
  artifact_refs_json  TEXT NOT NULL,    -- ["artifact1", "artifact2", ...]
  max_tokens          INTEGER NOT NULL,
  pruned_files_json   TEXT NOT NULL,    -- budget 削掉的文件列表
  summary             TEXT NOT NULL,    -- 一段 markdown 摘要
  snapshot_path       TEXT NOT NULL,    -- ~/.claude-web/bundles/<bundleId>.md
  created_at          INTEGER NOT NULL
);
```

**关键不变量**：agent 只能读 ContextBundle 列出的内容；找不到必需 Artifact 时必须 fail，**不允许脑补**（[HARNESS_ROADMAP.md §0 #9](HARNESS_ROADMAP.md)）。

### 1.9 Run（一次 `claude` CLI 子进程实例化）

```sql
CREATE TABLE run (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL REFERENCES task(id),
  session_id        TEXT,             -- Claude CLI 自带的 sessionId
  exit_code         INTEGER,
  model             TEXT NOT NULL,
  tokens_in         INTEGER,
  tokens_out        INTEGER,
  cost              REAL,             -- USD
  transcript_path   TEXT NOT NULL,    -- ~/.claude/projects/<encoded-cwd>/<sid>.jsonl
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER
);
CREATE INDEX idx_run_task ON run(task_id);
```

`transcript_path` 仍指向 Claude CLI 自带的 jsonl，DB 不重复写入。

### 1.10 Artifact（content-addressed 产出）

```sql
CREATE TABLE artifact (
  id                TEXT PRIMARY KEY,
  stage_id          TEXT NOT NULL REFERENCES stage(id),
  kind              TEXT NOT NULL,    -- methodology|spec|design_doc|architecture_doc|adr|patch|pr_url|test_report|coverage_report|review_notes|review_verdict|decision_note|metric_snapshot|retrospective|changelog_entry
  ref               TEXT,              -- URL / PR # / commit hash 等外部引用
  hash              TEXT NOT NULL,     -- SHA-256 content hash（content-addressed）
  storage           TEXT NOT NULL,     -- 'inline' (内容在 content_text) | 'file' (内容在 ~/.claude-web/artifacts/<hash>.md)
  content_text      TEXT,              -- inline 模式下保存内容（≤ 8KB）；同时被 FTS5 索引
  content_path      TEXT,              -- file 模式下绝对路径
  size_bytes        INTEGER NOT NULL,  -- 原始内容字节数（用于 8KB 阈值判断 + 报表）
  metadata_json     TEXT NOT NULL DEFAULT '{}',         -- 企业字段等可选 typed metadata（Round 1 arch 垂直#8 部分接受）；结构由 methodologies/<stage>.md 约定
  superseded_by     TEXT REFERENCES artifact(id),       -- 旧 row.superseded_by = 新 row.id（"我被谁替代"，Round 1 cross M4 修正方向）
  created_at        INTEGER NOT NULL,
  CHECK (
    (storage = 'inline' AND content_text IS NOT NULL AND content_path IS NULL) OR
    (storage = 'file'   AND content_path IS NOT NULL AND content_text IS NULL)
  )
);
CREATE INDEX idx_artifact_stage ON artifact(stage_id, kind);
CREATE INDEX idx_artifact_hash  ON artifact(hash);  -- **非 UNIQUE**：多 row 可指向同 hash（同源内容跨 stage 共享文件存储）

-- FTS5 external-content 模式覆盖 inline 内容；file 模式的 Artifact 通过 hash 在 ~/.claude-web/artifacts/ 检索
CREATE VIRTUAL TABLE artifact_fts USING fts5(content_text, content='artifact', content_rowid='rowid');

CREATE TRIGGER artifact_fts_ai AFTER INSERT ON artifact WHEN new.content_text IS NOT NULL BEGIN
  INSERT INTO artifact_fts(rowid, content_text) VALUES (new.rowid, new.content_text);
END;
CREATE TRIGGER artifact_fts_ad AFTER DELETE ON artifact WHEN old.content_text IS NOT NULL BEGIN
  INSERT INTO artifact_fts(artifact_fts, rowid, content_text) VALUES ('delete', old.rowid, old.content_text);
END;
-- Artifact 是 immutable，理论上不会 UPDATE；为保险加 UPDATE 触发器
CREATE TRIGGER artifact_fts_au AFTER UPDATE ON artifact BEGIN
  INSERT INTO artifact_fts(artifact_fts, rowid, content_text) VALUES ('delete', old.rowid, old.content_text);
  INSERT INTO artifact_fts(rowid, content_text) SELECT new.rowid, new.content_text WHERE new.content_text IS NOT NULL;
END;
```

**存储规则**（≤ 8KB inline，> 8KB 落文件）：
- 写 Artifact 时计算 `size_bytes`：≤ 8192 → `storage='inline'` 直接落 `content_text`；否则 `storage='file'` 写 `~/.claude-web/artifacts/<hash>.md`。
- `hash` 用 SHA-256：标识 **file content 的存储 key**，**不是 row dedupe 的 key**。多个 stage 写同一段长内容时，文件只写一份（按 hash 命中复用），但 **row 不去重，每个 stage 一行**（保留 stage_id NOT NULL）。
- Artifact **永不修改**——内容变了产生新 row。**superseded_by 方向**：旧 row.superseded_by = 新 row.id（"我被谁替代"，与字段名自然语义一致）；新 row.superseded_by = NULL。
- `metadata_json` 字段 M-1 加列但不约束 schema；spec/design 类 Artifact 由 methodologies/01-spec.md 等约定塞 `{businessEntities, permissionMatrix, approvalSteps, reportSchemas}`。

### 1.11 ReviewVerdict ★ 新增

```sql
-- 多 AI 评审打分记录
CREATE TABLE review_verdict (
  id                  TEXT PRIMARY KEY,
  stage_id            TEXT NOT NULL REFERENCES stage(id),
  reviewer_profile_id TEXT NOT NULL,
  model               TEXT NOT NULL,
  score               REAL NOT NULL,           -- 0-5 综合分
  dimensions_json     TEXT NOT NULL,            -- {correctness:4.5, completeness:4, security:3, ...}
  notes               TEXT NOT NULL,
  agrees_with_prior   INTEGER,                  -- 与另一 reviewer 是否一致；NULL = 第一个评审者
  created_at          INTEGER NOT NULL
);
CREATE INDEX idx_verdict_stage ON review_verdict(stage_id);
```

### 1.12 Decision（人审决议）

```sql
CREATE TABLE decision (
  id                TEXT PRIMARY KEY,
  stage_id          TEXT NOT NULL REFERENCES stage(id),
  requested_by      TEXT NOT NULL,    -- AgentProfile id
  options_json      TEXT NOT NULL,    -- [{"label":"approve", "value":"approve"}, ...]
  chosen_option     TEXT,
  decided_by        TEXT,             -- "user" 或 "auto_timeout"
  rationale         TEXT,
  decided_at        INTEGER,
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_decision_pending ON decision(stage_id) WHERE chosen_option IS NULL;
```

### 1.13 Retrospective ★ 新增

```sql
CREATE TABLE retrospective (
  id                       TEXT PRIMARY KEY,
  issue_id                 TEXT NOT NULL REFERENCES issue(id),
  what_went_well           TEXT NOT NULL,
  what_to_improve          TEXT NOT NULL,
  methodology_feedback     TEXT NOT NULL,    -- 喂回方法论 v2 的输入
  cost_summary_json        TEXT NOT NULL,    -- {total_usd, by_stage, by_model, ...}
  created_by               TEXT NOT NULL,    -- "Documentor" 或 "user"
  created_at               INTEGER NOT NULL
);
```

### 1.14 Audit Log（系统表，非业务实体）

审计日志走 **JSONL append-only**（`~/.claude-web/harness-audit.jsonl`），**不进 SQLite**。

**写入语义：fail-open**（Round 1 arch 风险#11 / cross M7 修复）——audit append 失败时，业务事务**不阻塞**，仅 `console.warn` 一条。理由：
- 与 [`packages/backend/scripts/permission-hook.mjs`](../packages/backend/scripts/permission-hook.mjs) 的 fail-open 一致
- audit 是事后查询用，断电 / 磁盘满时业务可用性优先
- 真正的强一致审计需求（如合规审计）当前不存在（个人自用）

理由（不进 SQLite）：
- append-only 写入用 `fs.appendFile` 比 DB 事务快、无锁竞争
- 审计需求是 grep / jq / tail，jsonl 工具链更顺
- DB 损坏时审计日志可独立救活
- 个人自用规模下 10MB 轮转一次（同 telemetry-store.ts 现有机制）即可

每条 audit entry 字段固定（[harness-protocol.ts](../packages/shared/src/harness-protocol.ts) 同源 Zod 定义）：

```jsonc
{
  "ts": 1746151234567,                  // epoch ms
  "actor": "user|agent:<profileId>|system|migration",
  "op": "insert|update|delete|migrate", // 写操作类型
  "table": "issue|stage|task|run|...",  // 受影响的表
  "id": "<entity-id>",
  "before": null | { /* row 修改前 */ },
  "after":  null | { /* row 修改后 */ },
  "rationale": "可选人审注释（Decision 通过时填）"
}
```

**写入规则**：
- 所有 INSERT / UPDATE / DELETE 经 `harness-store.ts` 时同步 append 一条 entry
- migration 也写一条 `op="migrate"` 标记 schema 跳变
- 文件 ≥ 10MB 时滚到 `harness-audit.jsonl.1`（保留 1 份历史）
- 个人自用规模下永不归档到云

---

## 2. 实体关系图

```
                                 Project
                                    │
                          ┌─────────┼──────────┐
                          ▼         ▼          ▼
                     Initiative   (旧 jsonl     IdeaCapture
                          │       transcript)        │
                          │                          │ triage
                          ▼                          ▼
                        Issue ◄────────────────────────
                          │
                          ▼ (创建 10 个 Stage)
                        Stage [strategy, ..., observe]
                       /  │   \                \
                      ▼   ▼    ▼                 ▼
                   Methodology Task ◄── ContextBundle
                                │
                                ▼
                              Run (n 次重试)
                                │
                                ▼
                         Artifact (content-addressed)
                       /     |      \
                      ▼      ▼       ▼
              ReviewVerdict  Decision  Retrospective
                                         │
                                         └─→ 喂回 Methodology v2 ritual
```

---

## 3. Schema 迁移策略（ADR-0015）

> **关键：四端必须同步迁移** —— SQLite schema、Artifact 文件格式、Swift Protocol、TS Zod schema。

### 3.1 版本约定

每个表加 `schema_version` 字段（或 DB 全局 PRAGMA `user_version`）。

迁移策略：
- **major bump**（如 v1 → v2）：必须有兼容窗口 1 个 minor，老客户端可以用 minClientVersion 检测后回退打包内 fallback
- **minor bump**（如 v1.2 → v1.3）：只允许 additive 字段（加列、加 enum 值），老客户端 graceful skip
- **patch bump**：只改 index / 文档，不改字段

### 3.2 迁移文件

```
packages/backend/src/migrations/
├── 0001_initial.sql            # 创建所有表 (M-1 完工时)
├── 0002_add_xxx.sql            # 后续增量
└── ...
```

每个 migration 必须：
1. 是幂等的（`CREATE TABLE IF NOT EXISTS` 等）
2. 同时更新 `packages/shared/src/harness-protocol.ts` 的 Zod schema
3. 同时更新 `packages/ios-native/Sources/ClaudeWeb/Protocol.swift`
4. 同时更新 `packages/shared/fixtures/harness/*.json` 测试样例
5. 在 commit message 注明 "schema migration N → N+1"

### 3.3 兼容性检查

**M-1 阶段**（手动验）：
- `pnpm --filter @claude-web/backend test:harness-schema` — DDL 跑通 + 重启回归
- `node scripts/verify-m1-deliverables.mjs` — 文件存在性自动守门

**M1+ 引入 CI**（Round 1 arch 里程碑#7 修正措辞）：
- `pnpm --filter @claude-web/shared build`：Zod 编译
- iOS Xcode build：Swift 协议编译
- fixtures round-trip：TS encode → Swift decode → Swift encode → TS decode 不丢字段
- enum 字符串完全匹配测试（防语义漂移，arch 风险#14）

---

## 4. 配套 ADR

ADR 抽到 [docs/adr/](adr/) 单独维护：

- [ADR-0010 — SQLite + FTS5 作为 harness 持久层](adr/ADR-0010-sqlite-fts5.md)
- [ADR-0015 — Schema 迁移策略](adr/ADR-0015-schema-migration.md)

---

## 5. M-1 完工状态

**v1.0（本文）已交付**：
- [x] 完整 DDL（13 业务表 + audit log JSONL + FTS5 虚拟表 + 触发器 + 约束 + 外键）
- [x] [packages/backend/src/migrations/0001_initial.sql](../packages/backend/src/migrations/0001_initial.sql) 迁移文件（与本文 DDL 同源）
- [x] FTS5 触发器（issue / artifact 各 3 个）
- [x] Artifact 内容寻址规则（≤ 8KB inline / > 8KB 落 `~/.claude-web/artifacts/<hash>.md`）
- [x] audit log JSONL 格式定义（[harness-protocol.ts](../packages/shared/src/harness-protocol.ts) Zod 同源）
- [x] ADR-0010 + ADR-0015 抽到 [docs/adr/](adr/)

**留给 M1+**（不进 M-1 准入）：
- [ ] `harness-store.ts` 真业务封装（CRUD / audit append / Artifact storage 路由）—— M-1 只验证 DDL 能跑
- [ ] ContextBundle markdown snapshot 写入封装 —— M1
- [ ] `harness-protocol.ts` 完整 Zod —— **本契约下游**，由"契约 #2 协议"产出
- [ ] `Protocol.swift` 加 harness 骨架 —— **本契约下游**，由"契约 #2 协议"产出
- [ ] fixtures round-trip 测试 —— **本契约下游**，由"契约 #2 协议"产出

**Round 1 评审挂起项**（[HARNESS_REVIEW_LOG.md](HARNESS_REVIEW_LOG.md)）：
- [ ] FTS5 大批写入性能（M2 Retrospective 加观察项；M3 视情况换 `content` 内嵌）
- [ ] `stage_artifact` 中间表（替代 `stage.{input,output,review_verdict}_artifact_ids_json` 三 JSON 列）—— M2 dogfood 报表查询频率信号决定
- [ ] `Artifact.metadata_json` 是否升级为 typed schema —— M2 dogfood toy 企业仓库后再敲
