-- M1 evolution mechanism L1-minimal: lessons table + FTS5
--
-- TARGET_VERSION = 2  (memory.db 独立版本序列；M0=1, M1=2)
-- DB target: ~/.vessel/memory.db (NOT harness.db) — see migrations-memory/ dir.
-- 同源：B-级 review arbiter docs/reviews/L1-retrospectives-arbiter-2026-05-10-0420.md
-- Spike: docs/research/evolution-mechanism-2026-05-10.md
-- Renamed retrospectives → lessons (避 harness.db retrospective table 命名冲突；BLOCKER B-1 fix)
-- FTS5 trigger pattern: 照搬 Eva harness.db issue_fts (migrations/0001_initial.sql:67-81，已工业验证)
-- kind CHECK enum may only widen in later migrations (ADR-006 §「enum 收窄需 schema-rebuild」)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lessons (
  id              TEXT PRIMARY KEY,                       -- uuid v4
  kind            TEXT NOT NULL CHECK (kind IN (
                    'review_closeout',  -- 4-way review 跑完
                    'bug_lesson',       -- 修 bug 的教训
                    'decision',         -- ADR 配套
                    'risk',             -- 新发现风险
                    'spike'             -- spike report 摘要
                  )),
  milestone       TEXT,                                   -- 'M0' / 'M1A-β' / NULL
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,                          -- already-redacted at write
  tags            TEXT,                                   -- 逗号分隔自由 tag
  refs_json       TEXT,                                   -- ['lesson_id', 'docs/reviews/...md']; JSON1 in-place升级 retro_refs join 表是 ALTER ADD TABLE 兼容操作
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','deprecated','contradicted')),
  importance      INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  contradicts_id  TEXT REFERENCES lessons(id),
  -- M1A-β review fingerprint dedup (sha256(date+planFile+contract+biggestInsight).slice(0,16))
  import_fingerprint TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lessons_kind        ON lessons(kind);
CREATE INDEX IF NOT EXISTS idx_lessons_milestone   ON lessons(milestone);
CREATE INDEX IF NOT EXISTS idx_lessons_status      ON lessons(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lessons_fingerprint ON lessons(import_fingerprint)
  WHERE import_fingerprint IS NOT NULL;

-- FTS5 影子虚表（external content 模式，content_rowid='rowid' = SQLite 自动 hidden rowid）
-- ⚠️ FTS rowid is internal; rebuild FTS after VACUUM/table-rebuild maintenance.
CREATE VIRTUAL TABLE IF NOT EXISTS lessons_fts USING fts5(
  title, body, tags,
  content='lessons',
  content_rowid='rowid'
);

-- 3 trigger 保持 FTS 同步；照搬 Eva issue_fts pattern (issue_fts_ai/ad/au)
CREATE TRIGGER IF NOT EXISTS lessons_fts_ai AFTER INSERT ON lessons BEGIN
  INSERT INTO lessons_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS lessons_fts_ad AFTER DELETE ON lessons BEGIN
  INSERT INTO lessons_fts(lessons_fts, rowid, title, body, tags) VALUES ('delete', old.rowid, old.title, old.body, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS lessons_fts_au AFTER UPDATE ON lessons BEGIN
  INSERT INTO lessons_fts(lessons_fts, rowid, title, body, tags) VALUES ('delete', old.rowid, old.title, old.body, old.tags);
  INSERT INTO lessons_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
END;
