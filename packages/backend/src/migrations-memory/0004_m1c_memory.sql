-- M1C-B: long-term memory records + sqlite-vec virtual table.
--
-- memory_records   — canonical row store (user-visible content + metadata)
-- vec_memory       — sqlite-vec virtual table (float32[512] embeddings)
--
-- Row id alignment: memory_records.id ↔ vec_memory.rowid (same INTEGER PK).
-- This lets KNN over vec_memory return rowids; we then JOIN memory_records
-- to fetch content + metadata.
--
-- Embedding dim = 512 — fixed by bge-small-zh-v1.5 (per ADR-012 amendment
-- 2026-05-10). Changing model later requires migration 0005 + reindex.

CREATE TABLE IF NOT EXISTS memory_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('note', 'fact', 'episode', 'preference')),
  content     TEXT NOT NULL,
  source      TEXT,
  embedding_model TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memory_records_kind ON memory_records(kind);
CREATE INDEX IF NOT EXISTS idx_memory_records_created ON memory_records(created_at DESC);

-- Virtual table created at runtime (after sqlite-vec extension is loaded).
-- We can't put `CREATE VIRTUAL TABLE ... USING vec0(...)` here because
-- migrations run before sqlite-vec.load() and would fail. memory-store.ts
-- creates it post-load. The schema is documented here for archeology:
--
--   CREATE VIRTUAL TABLE vec_memory USING vec0(
--     embedding float[512]
--   );
