-- M0 minimal schema (vessel-core 内核骨架)
--
-- TARGET_VERSION = 1  (memory.db 独立版本序列，从 1 开始)
-- 同源：FRAMEWORK §2 Session/Intent/Artifact + §5 Trace
-- 范围：sessions + intents + skill_invocations，仅支撑 echo 闭环
-- **重要**：本文件作用于 memory.db，存放在 `migrations-memory/` 独立目录；
--          Eva harness.db migration 在 `migrations/` 目录，两个 runner 互不干扰
--          （v0A.1 M0 4-way review BLOCKER fix：避免 harness-store glob 误吞）
-- ADR-006 §3：harness.db 0004/0005/0006/0007 编号保持 reserved（M1C-A 起填）

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,                          -- session_id (uuid v4)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  meta_json    TEXT                                       -- 自由 JSON（reserved）
);

CREATE TABLE IF NOT EXISTS intents (
  id          TEXT PRIMARY KEY,                           -- intent_id (uuid v4)
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  trace_id    TEXT NOT NULL,                              -- 32 hex (OTEL)
  text        TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skill_invocations (
  id              TEXT PRIMARY KEY,                       -- run_id (uuid v4)
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  intent_id       TEXT NOT NULL REFERENCES intents(id),
  trace_id        TEXT NOT NULL,
  span_id         TEXT NOT NULL,                          -- 16 hex (OTEL)
  skill_id        TEXT NOT NULL,                          -- 'echo' / 'coding' / etc.
  status          TEXT NOT NULL CHECK (status IN ('success','error','paused','cancelled')),
  artifact_json   TEXT,                                   -- AgentResult artifact (JSON)
  error_json      TEXT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_intents_session  ON intents(session_id);
CREATE INDEX IF NOT EXISTS idx_skinv_session    ON skill_invocations(session_id);
CREATE INDEX IF NOT EXISTS idx_skinv_intent     ON skill_invocations(intent_id);
