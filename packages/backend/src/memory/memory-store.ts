/**
 * memory-store — long-term memory CRUD + sqlite-vec KNN.
 *
 * Schema: migrations-memory/0004_m1c_memory.sql
 *   - memory_records (id INT PK, kind, content, source, embedding_model, ts)
 *   - vec_memory (rowid alias for memory_records.id; embedding float[512])
 *
 * sqlite-vec virtual table is created here at first use rather than in the SQL
 * migration because it requires the extension to be loaded — which happens
 * lazily.
 *
 * @see ADR-012 amendment 2026-05-10 (in-process embedding decision)
 * @see docs/research/embedding-and-vector-store-2026-05-10.md
 */

import * as sqliteVec from 'sqlite-vec';
import { openMemoryDb } from './session-store.js';
import { embed, embedOne, getEmbedModel, DEFAULT_EMBED_DIM } from './embedder.js';

export type MemoryKind = 'note' | 'fact' | 'episode' | 'preference';

export interface MemoryRow {
  id: number;
  kind: MemoryKind;
  content: string;
  source: string | null;
  embedding_model: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryAddInput {
  kind: MemoryKind;
  content: string;
  source?: string;
}

export interface MemorySearchHit extends MemoryRow {
  /** Cosine distance from query (0 = identical). sqlite-vec returns L2-style; for
   *  L2-normalized vectors, distance ≈ 2*(1 - cosine). Lower is closer. */
  distance: number;
}

let extensionLoaded = false;
let virtualTableCreated = false;

/**
 * Load sqlite-vec into the memory.db connection (idempotent) and create the
 * vec_memory virtual table on first call.
 */
function ensureVecReady(): void {
  const db = openMemoryDb();
  if (!extensionLoaded) {
    sqliteVec.load(db);
    extensionLoaded = true;
  }
  if (!virtualTableCreated) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory USING vec0(
        embedding float[${DEFAULT_EMBED_DIM}]
      )
    `);
    virtualTableCreated = true;
  }
}

/**
 * Insert a memory record + its embedding. Returns the assigned id.
 *
 * `embed()` is awaited inline — caller provides one embedding budget per
 * addMemory call. For batch insert, prefer `addMemoryBatch` (TODO M1C-B+).
 */
export async function addMemory(input: MemoryAddInput): Promise<MemoryRow> {
  ensureVecReady();
  const db = openMemoryDb();

  const vector = await embedOne(input.content);
  if (vector.length !== DEFAULT_EMBED_DIM) {
    throw new Error(`embedding dim mismatch: expected ${DEFAULT_EMBED_DIM}, got ${vector.length}`);
  }

  const model = getEmbedModel();
  const insertRow = db.prepare(`
    INSERT INTO memory_records (kind, content, source, embedding_model)
    VALUES (@kind, @content, @source, @model)
  `).run({
    kind: input.kind,
    content: input.content,
    source: input.source ?? null,
    model,
  });
  const id = insertRow.lastInsertRowid as number | bigint;
  const numericId = typeof id === 'bigint' ? Number(id) : id;

  // Insert into vec_memory using same rowid for joining. sqlite-vec is strict
  // about rowid type: pass as BigInt so better-sqlite3 binds it as INTEGER
  // unambiguously (number-bound 1 was rejected with "Only integers are allowed").
  db.prepare('INSERT INTO vec_memory (rowid, embedding) VALUES (?, ?)').run(BigInt(numericId), Buffer.from(vector.buffer));

  return getMemoryById(numericId)!;
}

export function getMemoryById(id: number): MemoryRow | undefined {
  const db = openMemoryDb();
  return db.prepare('SELECT * FROM memory_records WHERE id = ?').get(id) as MemoryRow | undefined;
}

export interface ListFilter {
  kind?: MemoryKind;
  limit?: number;
}

export function listMemory(filter?: ListFilter): MemoryRow[] {
  const db = openMemoryDb();
  const limit = Math.min(filter?.limit ?? 50, 200);
  if (filter?.kind) {
    return db.prepare('SELECT * FROM memory_records WHERE kind = ? ORDER BY created_at DESC LIMIT ?').all(filter.kind, limit) as MemoryRow[];
  }
  return db.prepare('SELECT * FROM memory_records ORDER BY created_at DESC LIMIT ?').all(limit) as MemoryRow[];
}

/**
 * KNN search: embed the query → vec_memory MATCH → JOIN memory_records.
 * Returns top `limit` hits ordered by distance ascending.
 */
export async function searchMemory(query: string, limit = 5): Promise<MemorySearchHit[]> {
  ensureVecReady();
  const db = openMemoryDb();

  const queryVec = await embedOne(query);
  const buf = Buffer.from(queryVec.buffer);

  // sqlite-vec MATCH operator returns (rowid, distance) ordered by distance asc.
  const rows = db.prepare(`
    SELECT v.rowid AS id, v.distance AS distance,
           m.kind, m.content, m.source, m.embedding_model, m.created_at, m.updated_at
      FROM vec_memory v
      JOIN memory_records m ON m.id = v.rowid
     WHERE v.embedding MATCH ?
       AND k = ?
     ORDER BY v.distance
  `).all(buf, limit) as MemorySearchHit[];

  return rows;
}

/**
 * Delete a memory record + its embedding. Idempotent — silently no-ops if
 * the row doesn't exist.
 */
export function deleteMemory(id: number): void {
  ensureVecReady();
  const db = openMemoryDb();
  db.prepare('DELETE FROM memory_records WHERE id = ?').run(id);
  db.prepare('DELETE FROM vec_memory WHERE rowid = ?').run(BigInt(id));
}

/**
 * Total count of stored memory records. Convenience for `vessel-core memory status`.
 */
export function memoryCount(): number {
  const db = openMemoryDb();
  return (db.prepare('SELECT count(*) AS n FROM memory_records').get() as { n: number }).n;
}

/** Test-only — reset module-level state without touching the DB. */
export function _resetForTest(): void {
  extensionLoaded = false;
  virtualTableCreated = false;
}
