-- harness 初始 schema (M-1 v1.0)
--
-- 同源：docs/HARNESS_DATA_MODEL.md §1
-- ADR：docs/adr/ADR-0010-sqlite-fts5.md, ADR-0015-schema-migration.md
--
-- 幂等：所有业务表 CREATE 用 IF NOT EXISTS。
-- TARGET_VERSION = 100  (major.minor 编码：1.0 → 100，1.2 → 102，2.0 → 200)
-- runner (harness-store.ts) 在事务内 exec 本文件，事务结束后才推进 user_version。
-- 不要在本文件设置 PRAGMA user_version！失败时事务回滚但 PRAGMA 已生效会留半成品状态。

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

--------------------------------------------------------------------------------
-- 1.1 Project (扩展，不动 ~/.claude-web/projects.json)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS harness_project (
  id              TEXT PRIMARY KEY,
  cwd             TEXT NOT NULL UNIQUE,                              -- Round 1 cross m2
  name            TEXT NOT NULL,
  default_branch  TEXT NOT NULL DEFAULT 'main',
  worktree_root   TEXT NOT NULL,
  harness_enabled INTEGER NOT NULL DEFAULT 0 CHECK (harness_enabled IN (0,1)),  -- Round 1 cross m1
  created_at      INTEGER NOT NULL
);

--------------------------------------------------------------------------------
-- 1.2 Initiative (战略目标)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS initiative (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES harness_project(id),
  title                 TEXT NOT NULL,
  intent                TEXT NOT NULL,
  kpis_json             TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('draft','active','paused','done')),
  owner_human           TEXT NOT NULL,
  methodology_version   TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_initiative_project ON initiative(project_id, status);

--------------------------------------------------------------------------------
-- 1.3 Issue (原子需求/反馈/bug) + FTS5
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS issue (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES harness_project(id),
  initiative_id     TEXT REFERENCES initiative(id),
  source            TEXT NOT NULL CHECK (source IN ('ideas_md','user_feedback','git_log','telemetry','inbox','manual')),
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  labels_json       TEXT NOT NULL,
  priority          TEXT NOT NULL CHECK (priority IN ('low','normal','high','critical')),
  status            TEXT NOT NULL CHECK (status IN ('inbox','triaged','planned','in_progress','blocked','done','wont_fix')),
  retrospective_id  TEXT REFERENCES retrospective(id),  -- Round 1 cross M5：SQLite 允许引用后定义的表，FK 还原
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issue_project_status ON issue(project_id, status);
CREATE INDEX IF NOT EXISTS idx_issue_initiative ON issue(initiative_id);

CREATE VIRTUAL TABLE IF NOT EXISTS issue_fts USING fts5(
  title, body,
  content='issue', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS issue_fts_ai AFTER INSERT ON issue BEGIN
  INSERT INTO issue_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS issue_fts_ad AFTER DELETE ON issue BEGIN
  INSERT INTO issue_fts(issue_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS issue_fts_au AFTER UPDATE ON issue BEGIN
  INSERT INTO issue_fts(issue_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO issue_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

--------------------------------------------------------------------------------
-- 1.4 IdeaCapture (碎想入口)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS idea_capture (
  id                       TEXT PRIMARY KEY,
  project_id               TEXT REFERENCES harness_project(id),
  body                     TEXT NOT NULL,
  audio_path               TEXT,
  transcript               TEXT,
  source                   TEXT NOT NULL CHECK (source IN ('voice','text','web')),
  captured_at              INTEGER NOT NULL,
  processed_into_issue_id  TEXT REFERENCES issue(id)
);
CREATE INDEX IF NOT EXISTS idx_idea_unprocessed
  ON idea_capture(processed_into_issue_id) WHERE processed_into_issue_id IS NULL;

--------------------------------------------------------------------------------
-- 1.6 Methodology (先于 Stage 创建，因 Stage 引用)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS methodology (
  id            TEXT PRIMARY KEY,
  stage_kind    TEXT NOT NULL,
  version       TEXT NOT NULL,
  applies_to    TEXT NOT NULL CHECK (applies_to IN ('claude-web','enterprise-admin','universal')),
  content_ref   TEXT NOT NULL,
  approved_by   TEXT NOT NULL,
  approved_at   INTEGER NOT NULL,
  UNIQUE(stage_kind, version)
);
CREATE INDEX IF NOT EXISTS idx_methodology_stage ON methodology(stage_kind, version DESC);

--------------------------------------------------------------------------------
-- 1.5 Stage (SDLC 流水线节点)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stage (
  id                       TEXT PRIMARY KEY,
  issue_id                 TEXT NOT NULL REFERENCES issue(id),
  kind                     TEXT NOT NULL CHECK (kind IN (
    'strategy','discovery','spec','compliance','design','implement','test','review','release','observe'
  )),
  status                   TEXT NOT NULL CHECK (status IN (
    'pending','running','awaiting_review','approved','rejected','skipped','failed'
  )),
  weight                   TEXT NOT NULL CHECK (weight IN ('heavy','light','checklist')),
  gate_required            INTEGER NOT NULL DEFAULT 1 CHECK (gate_required IN (0,1)),  -- Round 1 cross m1
  assigned_agent_profile   TEXT NOT NULL,
  methodology_id           TEXT NOT NULL REFERENCES methodology(id),
  input_artifact_ids_json  TEXT NOT NULL DEFAULT '[]',
  output_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  review_verdict_ids_json  TEXT NOT NULL DEFAULT '[]',
  started_at               INTEGER,
  ended_at                 INTEGER,
  created_at               INTEGER NOT NULL
);
-- Round 1 cross M2: 每个 Issue 一个 kind 唯一（10 stage 固定顺序，不允许同 kind 重复 row）
CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_issue_kind ON stage(issue_id, kind);
CREATE INDEX IF NOT EXISTS idx_stage_running ON stage(status) WHERE status = 'running';

--------------------------------------------------------------------------------
-- 1.8 ContextBundle (先于 Task 创建，因 Task 引用)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS context_bundle (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL,  -- 外键回指 Task；环依赖通过应用层 enforce
  artifact_refs_json  TEXT NOT NULL DEFAULT '[]',
  max_tokens          INTEGER NOT NULL,
  pruned_files_json   TEXT NOT NULL DEFAULT '[]',
  summary             TEXT NOT NULL,
  snapshot_path       TEXT NOT NULL,
  created_at          INTEGER NOT NULL
);

--------------------------------------------------------------------------------
-- 1.7 Task (一次 agent 工作单元)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS task (
  id                  TEXT PRIMARY KEY,
  stage_id            TEXT NOT NULL REFERENCES stage(id),
  agent_profile_id    TEXT NOT NULL,
  model               TEXT NOT NULL CHECK (model IN ('opus','sonnet','haiku')),
  cwd                 TEXT NOT NULL,
  worktree_path       TEXT,
  prompt              TEXT NOT NULL,
  skill_set_json      TEXT NOT NULL DEFAULT '[]',
  permission_mode     TEXT NOT NULL,
  context_bundle_id   TEXT NOT NULL REFERENCES context_bundle(id),
  run_ids_json        TEXT NOT NULL DEFAULT '[]',
  status              TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_stage ON task(stage_id);

--------------------------------------------------------------------------------
-- 1.9 Run (一次 claude CLI 子进程实例化)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS run (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL REFERENCES task(id),
  session_id        TEXT,
  exit_code         INTEGER,
  model             TEXT NOT NULL,
  tokens_in         INTEGER,
  tokens_out        INTEGER,
  cost              REAL,
  transcript_path   TEXT NOT NULL,
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_run_task ON run(task_id);
CREATE INDEX IF NOT EXISTS idx_run_session ON run(session_id) WHERE session_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 1.10 Artifact (content-addressed 产出) + FTS5
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS artifact (
  id                TEXT PRIMARY KEY,
  stage_id          TEXT NOT NULL REFERENCES stage(id),
  kind              TEXT NOT NULL CHECK (kind IN (
    'methodology','spec','design_doc','architecture_doc','adr','patch','pr_url',
    'test_report','coverage_report','review_notes','review_verdict','decision_note',
    'metric_snapshot','retrospective','changelog_entry'
  )),
  ref               TEXT,
  hash              TEXT NOT NULL,
  storage           TEXT NOT NULL CHECK (storage IN ('inline','file')),
  content_text      TEXT,
  content_path      TEXT,
  size_bytes        INTEGER NOT NULL,
  -- Round 1 arch 垂直#8: 加 metadata_json 列（minor bump 行为：可选，default '{}'）
  -- 结构由 methodologies/<stage>.md 约定，schema 不强制 typed（M2 dogfood 后视情况升级）
  metadata_json     TEXT NOT NULL DEFAULT '{}',
  -- Round 1 cross M4: superseded_by 方向语义敲定
  -- 旧 row.superseded_by = 新 row.id；新 row.superseded_by = NULL
  -- 即"我被谁替代"，与字段名自然语义一致
  superseded_by     TEXT REFERENCES artifact(id),
  created_at        INTEGER NOT NULL,
  CHECK (
    (storage = 'inline' AND content_text IS NOT NULL AND content_path IS NULL) OR
    (storage = 'file'   AND content_path IS NOT NULL AND content_text IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_artifact_stage ON artifact(stage_id, kind);
-- Round 1 cross M3: hash 索引非 UNIQUE = 故意。
-- 语义：file content 通过 hash 共享存储（多 row 可指向同 ~/.claude-web/artifacts/<hash>.md），
-- 但 row 不去重——每个 stage 产出 = 1 row，stage_id NOT NULL。
CREATE INDEX IF NOT EXISTS idx_artifact_hash  ON artifact(hash);

CREATE VIRTUAL TABLE IF NOT EXISTS artifact_fts USING fts5(
  content_text,
  content='artifact', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS artifact_fts_ai AFTER INSERT ON artifact WHEN new.content_text IS NOT NULL BEGIN
  INSERT INTO artifact_fts(rowid, content_text) VALUES (new.rowid, new.content_text);
END;
CREATE TRIGGER IF NOT EXISTS artifact_fts_ad AFTER DELETE ON artifact WHEN old.content_text IS NOT NULL BEGIN
  INSERT INTO artifact_fts(artifact_fts, rowid, content_text) VALUES ('delete', old.rowid, old.content_text);
END;
CREATE TRIGGER IF NOT EXISTS artifact_fts_au AFTER UPDATE ON artifact BEGIN
  INSERT INTO artifact_fts(artifact_fts, rowid, content_text) SELECT 'delete', old.rowid, old.content_text WHERE old.content_text IS NOT NULL;
  INSERT INTO artifact_fts(rowid, content_text) SELECT new.rowid, new.content_text WHERE new.content_text IS NOT NULL;
END;

--------------------------------------------------------------------------------
-- 1.11 ReviewVerdict (多 AI 评审打分)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS review_verdict (
  id                  TEXT PRIMARY KEY,
  stage_id            TEXT NOT NULL REFERENCES stage(id),
  reviewer_profile_id TEXT NOT NULL,
  model               TEXT NOT NULL,
  score               REAL NOT NULL CHECK (score >= 0 AND score <= 5),
  dimensions_json     TEXT NOT NULL,
  notes               TEXT NOT NULL,
  agrees_with_prior   INTEGER CHECK (agrees_with_prior IS NULL OR agrees_with_prior IN (0,1)),  -- Round 1 cross m1
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verdict_stage ON review_verdict(stage_id);

--------------------------------------------------------------------------------
-- 1.12 Decision (人审决议)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS decision (
  id                TEXT PRIMARY KEY,
  stage_id          TEXT NOT NULL REFERENCES stage(id),
  requested_by      TEXT NOT NULL,
  options_json      TEXT NOT NULL,
  chosen_option     TEXT,
  decided_by        TEXT,
  rationale         TEXT,
  decided_at        INTEGER,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decision_pending ON decision(stage_id) WHERE chosen_option IS NULL;

--------------------------------------------------------------------------------
-- 1.13 Retrospective
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS retrospective (
  id                       TEXT PRIMARY KEY,
  issue_id                 TEXT NOT NULL REFERENCES issue(id),
  what_went_well           TEXT NOT NULL,
  what_to_improve          TEXT NOT NULL,
  methodology_feedback     TEXT NOT NULL,
  cost_summary_json        TEXT NOT NULL,
  created_by               TEXT NOT NULL,
  created_at               INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retrospective_issue ON retrospective(issue_id);

--------------------------------------------------------------------------------
-- 完成
--------------------------------------------------------------------------------
-- audit log 走 ~/.claude-web/harness-audit.jsonl，独立 JSONL，不进 SQLite
-- 见 HARNESS_DATA_MODEL.md §1.14
