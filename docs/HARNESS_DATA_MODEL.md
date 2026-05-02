# Harness Data Model

> **状态**：M-1 第 1 项核心契约首版（v0.1，2026-05-01）。详细 DDL 待 M-1 真正动手时补全。
>
> **导航**：[索引](HARNESS_INDEX.md) · [Architecture](HARNESS_ARCHITECTURE.md) · [Roadmap](HARNESS_ROADMAP.md)
>
> **同源**：本文是 [HARNESS_ROADMAP.md §1](HARNESS_ROADMAP.md) 的扩展版，加入了 DDL 占位与索引设计。

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

-- FTS5 全文索引
CREATE VIRTUAL TABLE issue_fts USING fts5(title, body, content='issue', content_rowid='rowid');
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
  content_ref       TEXT,              -- 内容 inline (短) 或 ~/.claude-web/artifacts/<hash>.md (>8KB)
  superseded_by     TEXT REFERENCES artifact(id),  -- 修改产生 superseded link，永不修改原内容
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_artifact_stage ON artifact(stage_id, kind);

-- FTS5 索引 Artifact 内容
CREATE VIRTUAL TABLE artifact_fts USING fts5(content_text, content='artifact', content_rowid='rowid');
```

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

CI 应该跑：
- `pnpm --filter @claude-web/shared build`：Zod 编译
- iOS Xcode build：Swift 协议编译
- fixtures round-trip：TS encode → Swift decode → Swift encode → TS decode 不丢字段

---

## 4. ADR

### ADR-0010 — SQLite + FTS5 作为 harness 持久层

**状态**：Accepted（M-1 启动前敲定）

**Context**：harness 引入 13 个核心实体，引用密集；现有 `~/.claude-web/projects.json` 单文件无法承担。

**Decision**：用 better-sqlite3 + FTS5 在 `~/.claude-web/harness.db`；保留旧 `projects.json` 兼容。

**Consequences**：
- ✅ 引用密集查询性能好
- ✅ 全文搜索内置
- ✅ 同步零网络依赖适合 Tailscale 单 Mac 部署
- ❌ 不支持高并发写（个人自用足够；本项目永不商业化、永不团队化，详见 [HARNESS_ROADMAP.md §Context #13](HARNESS_ROADMAP.md)）
- ❌ 永不需要迁移到 Postgres（个人自用规模 SQLite 足够）

### ADR-0015 — Schema 迁移策略

**状态**：Accepted（M-1 启动前敲定）

**Decision**：四端（SQLite / Artifact 文件 / Swift / TS Zod）同步迁移；major / minor / patch 三档；老版本 + 兼容窗口 1 个 minor。

**Consequences**：
- ✅ 协议演化可控
- ✅ 老 iOS 装包不至于一夜炸（fallback config 兜底）
- ❌ 迁移流程繁琐（4 端必须手动同步，CI 强制 round-trip 检查）
- ❌ 大改时所有端同时升级，难以分批

---

## 5. 待 M-1 真正动手时补的内容

- [ ] 完整 DDL（所有表的 CREATE 语句 + 索引 + 约束 + 外键）
- [ ] 0001_initial.sql 迁移文件
- [ ] `packages/shared/src/harness-protocol.ts` 完整 Zod schema
- [ ] `packages/shared/fixtures/harness/*.json` 每实体的样例
- [ ] `packages/ios-native/Sources/ClaudeWeb/Protocol.swift` 加 harness 协议骨架
- [ ] FTS5 触发器（INSERT/UPDATE/DELETE 同步内容到 FTS 表）
- [ ] audit log 写入封装（在 harness-store.ts 内）
- [ ] Artifact 内容寻址：>8KB 落 `~/.claude-web/artifacts/<hash>.md`，去重逻辑
- [ ] ContextBundle markdown snapshot 写入封装
