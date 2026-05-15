// pim-queries — PIM v2.1 CRUD + 视图查询 (M0-PIM Day 3)
//
// 同源：
// - DDL: packages/backend/src/migrations/0008_pim_item.sql
// - Zod: packages/shared/src/pim-protocol.ts
// - ADR: docs/adr/vessel/ADR-020-pim-capture-entry.md
//
// 设计要点（ADR-020 D5/D6/D9）：
// - DB 用 snake_case (commitment_state)，wire 用 camelCase (commitmentState) — 转换在 route 层做
// - 写入前应用层规范化: trim() + toLowerCase() + 白名单 warn (D6, TEXT 无 CHECK 兜底)
// - PATCH 只接 dirty 字段 (R5 多设备 last-write-wins 缓解)
// - commitment_state 变化时 INSERT pim_commitment_state_history (承认意图漂移, D5)

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { appendPimAudit, auditFields, type PimAuditContext } from "./pim-audit.js";

export type { PimAuditContext } from "./pim-audit.js";

// ============================================================================
// Row types (snake_case, mirrors DB schema)
// ============================================================================

export interface PimItemRow {
  id: string;
  content: string;
  captured_at: number;
  source: string;
  commitment_state: string;
  modality: string;
  ai_status: string;
  ai_suggested_at: number | null;
  visibility: string;
  owner_user_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface PimCommitmentHistoryRow {
  id: string;
  pim_item_id: string;
  old_state: string | null;
  new_state: string;
  changed_at: number;
  changed_by: string;
  reason: string | null;
}

export interface PimDomainTagRow {
  pim_item_id: string;
  domain: string;
  created_at: number;
}

export interface PimPersonRefRow {
  pim_item_id: string;
  person_ref: string;
  confidence: number;
  created_at: number;
}

// ============================================================================
// 应用层白名单（D6 — TEXT 无 CHECK enum 的兜底）
// 不在白名单的值不会被拒绝，但会 console.warn —— 让 typo 立刻可见。
// 与 packages/shared/src/pim-protocol.ts PIM_COMMITMENT_STATES 同源。
// ============================================================================

const KNOWN_COMMITMENT_STATES = new Set([
  "inbox",
  "action",
  "calendar",
  "waiting",
  "reference",
  "archived",
]);
const KNOWN_MODALITIES = new Set([
  "text",
  "link",
  "image",
  "audio",
  "file",
  "structured",
]);
const KNOWN_AI_STATUSES = new Set([
  "pending",
  "running",
  "done",
  "failed",
  "timeout",
  "disabled",
]);

function normalize(s: string | undefined): string | undefined {
  if (s == null) return undefined;
  return s.trim().toLowerCase();
}

function warnIfUnknown(field: string, value: string, knownSet: Set<string>): void {
  if (!knownSet.has(value)) {
    console.warn(
      `[pim-queries] non-whitelist ${field}='${value}' — accepted but flagged for sanity report`,
    );
  }
}

// ============================================================================
// 1. createPimItem
// ============================================================================

export interface CreatePimItemInput {
  /** If omitted, randomUUID() is used */
  id?: string;
  content: string;
  source: string;
  commitmentState?: string; // default 'inbox'
  modality?: string; // default 'text'
  aiStatus?: string; // default 'pending'
  visibility?: string; // default 'private'
  ownerUserId?: string | null;
  /** Optional facets to insert in same transaction */
  domainTags?: string[];
  peopleRefs?: Array<{ personRef: string; confidence?: number }>;
}

export function createPimItem(
  db: Database.Database,
  input: CreatePimItemInput,
  ctx?: PimAuditContext,
): PimItemRow {
  const id = input.id ?? `pim-${randomUUID()}`;
  const now = Date.now();
  const commitment = normalize(input.commitmentState) ?? "inbox";
  const modality = normalize(input.modality) ?? "text";
  const aiStatus = normalize(input.aiStatus) ?? "pending";
  const visibility = normalize(input.visibility) ?? "private";

  warnIfUnknown("commitment_state", commitment, KNOWN_COMMITMENT_STATES);
  warnIfUnknown("modality", modality, KNOWN_MODALITIES);
  warnIfUnknown("ai_status", aiStatus, KNOWN_AI_STATUSES);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO pim_item
         (id, content, captured_at, source, commitment_state, modality, ai_status, visibility, owner_user_id, created_at, updated_at)
       VALUES
         (@id, @content, @capturedAt, @source, @commitmentState, @modality, @aiStatus, @visibility, @ownerUserId, @createdAt, @updatedAt)`,
    ).run({
      id,
      content: input.content,
      capturedAt: now,
      source: input.source,
      commitmentState: commitment,
      modality,
      aiStatus,
      visibility,
      ownerUserId: input.ownerUserId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    // 历史快照：第一次写入也算一次 state 变化（old=null → new）
    db.prepare(
      `INSERT INTO pim_commitment_state_history
         (id, pim_item_id, old_state, new_state, changed_at, changed_by)
       VALUES (?, ?, NULL, ?, ?, 'system')`,
    ).run(`pcsh-${randomUUID()}`, id, commitment, now);

    // L2 facets (optional)
    if (input.domainTags && input.domainTags.length > 0) {
      const ins = db.prepare(
        `INSERT OR IGNORE INTO pim_domain_tags (pim_item_id, domain, created_at) VALUES (?, ?, ?)`,
      );
      for (const d of input.domainTags) {
        const norm = normalize(d);
        if (norm) ins.run(id, norm, now);
      }
    }
    if (input.peopleRefs && input.peopleRefs.length > 0) {
      const ins = db.prepare(
        `INSERT OR IGNORE INTO pim_people_refs (pim_item_id, person_ref, confidence, created_at) VALUES (?, ?, ?, ?)`,
      );
      for (const p of input.peopleRefs) {
        if (p.personRef) ins.run(id, p.personRef, p.confidence ?? 1.0, now);
      }
    }
  });
  tx();

  // Audit: create entry
  const af = auditFields(ctx);
  appendPimAudit({
    op: "create",
    pim_item_id: id,
    actor: af.actor,
    source_device: af.source_device,
    after: {
      commitment_state: commitment,
      modality,
      source: input.source,
      visibility,
    },
  });

  return getPimItem(db, id)!;
}

// ============================================================================
// 2. getPimItem
// ============================================================================

export function getPimItem(db: Database.Database, id: string): PimItemRow | null {
  return (db
    .prepare(`SELECT * FROM pim_item WHERE id = ?`)
    .get(id) as PimItemRow | undefined) ?? null;
}

// ============================================================================
// 3. listPimItems (主 SELECT，可按 commitment / source / time / cwd 过滤)
// ============================================================================

export interface ListPimItemsOpts {
  commitmentState?: string;
  source?: string;
  /** Only items with captured_at >= this (unix ms) */
  sinceMs?: number;
  /** Latest first, default 50, max 500 */
  limit?: number;
  /** Include soft-deleted (deleted_at NOT NULL). Default false */
  includeDeleted?: boolean;
  /** FTS5 query string against pim_item.content (Week 3 Day 15). Tokenized
   *  per SQLite FTS5 default rules; multiple terms = AND; supports phrase
   *  search "term1 term2" + prefix "vessel*" etc.
   *  Empty / undefined → no FTS filter. */
  query?: string;
}

export function listPimItems(db: Database.Database, opts: ListPimItemsOpts = {}): PimItemRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (!opts.includeDeleted) where.push("p.deleted_at IS NULL");
  if (opts.commitmentState) {
    where.push("p.commitment_state = @commitment");
    params.commitment = normalize(opts.commitmentState);
  }
  if (opts.source) {
    where.push("p.source = @source");
    params.source = opts.source;
  }
  if (opts.sinceMs != null) {
    where.push("p.captured_at >= @sinceMs");
    params.sinceMs = opts.sinceMs;
  }
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50));

  // FTS5 query path: JOIN pim_item_fts; results ordered by rank (most relevant)
  // then captured_at. Without FTS, plain table query ORDER BY captured_at.
  if (opts.query && opts.query.trim().length > 0) {
    where.push("p.rowid = f.rowid");
    where.push("f.content MATCH @ftsQuery");
    params.ftsQuery = opts.query.trim();
    const whereClause = `WHERE ${where.join(" AND ")}`;
    const sql = `SELECT p.* FROM pim_item p, pim_item_fts f
                 ${whereClause}
                 ORDER BY rank, p.captured_at DESC LIMIT ${limit}`;
    return db.prepare(sql).all(params) as PimItemRow[];
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `SELECT p.* FROM pim_item p ${whereClause}
               ORDER BY p.captured_at DESC LIMIT ${limit}`;
  return db.prepare(sql).all(params) as PimItemRow[];
}

// ============================================================================
// 4. updatePimItem (partial UPDATE — R5 多设备 last-write-wins 缓解)
// ============================================================================

export interface UpdatePimItemPatch {
  content?: string;
  modality?: string;
  visibility?: string;
  aiStatus?: string;
  aiSuggestedAt?: number;
  /** Set null to undelete; set number to soft-delete */
  deletedAt?: number | null;
}

/**
 * Patch update — only writes provided fields. Returns true if a row was updated.
 *
 * To change commitment_state, use {@link setCommitmentState} (writes history row).
 */
export function updatePimItem(
  db: Database.Database,
  id: string,
  patch: UpdatePimItemPatch,
  ctx?: PimAuditContext,
): boolean {
  // Capture before-state for audit (only fields being modified to minimize JSONL bloat)
  const beforeFields: string[] = [];
  if (patch.content !== undefined) beforeFields.push("content");
  if (patch.modality !== undefined) beforeFields.push("modality");
  if (patch.visibility !== undefined) beforeFields.push("visibility");
  if (patch.aiStatus !== undefined) beforeFields.push("ai_status");
  if (patch.deletedAt !== undefined) beforeFields.push("deleted_at");
  let beforeSnapshot: Record<string, unknown> | undefined;
  if (beforeFields.length > 0) {
    beforeSnapshot = db
      .prepare(`SELECT ${beforeFields.join(", ")} FROM pim_item WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
  }

  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  if (patch.content !== undefined) {
    fields.push("content = @content");
    params.content = patch.content;
  }
  if (patch.modality !== undefined) {
    const m = normalize(patch.modality)!;
    warnIfUnknown("modality", m, KNOWN_MODALITIES);
    fields.push("modality = @modality");
    params.modality = m;
  }
  if (patch.visibility !== undefined) {
    fields.push("visibility = @visibility");
    params.visibility = normalize(patch.visibility);
  }
  if (patch.aiStatus !== undefined) {
    const s = normalize(patch.aiStatus)!;
    warnIfUnknown("ai_status", s, KNOWN_AI_STATUSES);
    fields.push("ai_status = @aiStatus");
    params.aiStatus = s;
  }
  if (patch.aiSuggestedAt !== undefined) {
    fields.push("ai_suggested_at = @aiSuggestedAt");
    params.aiSuggestedAt = patch.aiSuggestedAt;
  }
  if (patch.deletedAt !== undefined) {
    fields.push("deleted_at = @deletedAt");
    params.deletedAt = patch.deletedAt;
  }
  if (fields.length === 0) return false;
  fields.push("updated_at = @updatedAt");
  params.updatedAt = Date.now();
  const result = db
    .prepare(`UPDATE pim_item SET ${fields.join(", ")} WHERE id = @id`)
    .run(params);

  if (result.changes > 0) {
    const af = auditFields(ctx);
    // Detect undelete (deletedAt set to null)
    let op: "update" | "delete" | "undelete" = "update";
    if (patch.deletedAt === null) op = "undelete";
    else if (patch.deletedAt != null) op = "delete";

    // after-snapshot: only fields that were patched
    const afterSnapshot: Record<string, unknown> = {};
    if (patch.content !== undefined) afterSnapshot.content = params.content;
    if (patch.modality !== undefined) afterSnapshot.modality = params.modality;
    if (patch.visibility !== undefined) afterSnapshot.visibility = params.visibility;
    if (patch.aiStatus !== undefined) afterSnapshot.ai_status = params.aiStatus;
    if (patch.deletedAt !== undefined) afterSnapshot.deleted_at = patch.deletedAt;

    appendPimAudit({
      op,
      pim_item_id: id,
      actor: af.actor,
      source_device: af.source_device,
      before: beforeSnapshot,
      after: afterSnapshot,
    });
  }

  return result.changes > 0;
}

// ============================================================================
// 5. setCommitmentState (专用 — 自动 INSERT 历史快照)
// ============================================================================

export interface SetCommitmentStateInput {
  newState: string;
  changedBy: string; // 'user' | 'ai' | actor identifier
  reason?: string;
}

export function setCommitmentState(
  db: Database.Database,
  id: string,
  input: SetCommitmentStateInput,
  ctx?: PimAuditContext,
): boolean {
  const newState = normalize(input.newState)!;
  warnIfUnknown("commitment_state", newState, KNOWN_COMMITMENT_STATES);

  let oldState: string | null = null;
  const tx = db.transaction(() => {
    const current = db
      .prepare(`SELECT commitment_state FROM pim_item WHERE id = ?`)
      .get(id) as { commitment_state: string } | undefined;
    if (!current) return false;
    if (current.commitment_state === newState) return false;
    oldState = current.commitment_state;

    const now = Date.now();
    db.prepare(
      `INSERT INTO pim_commitment_state_history
         (id, pim_item_id, old_state, new_state, changed_at, changed_by, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `pcsh-${randomUUID()}`,
      id,
      current.commitment_state,
      newState,
      now,
      input.changedBy,
      input.reason ?? null,
    );
    db.prepare(
      `UPDATE pim_item SET commitment_state = ?, updated_at = ? WHERE id = ?`,
    ).run(newState, now, id);
    return true;
  });
  const ok = tx() as boolean;

  if (ok) {
    const af = auditFields(ctx);
    appendPimAudit({
      op: "set_commitment",
      pim_item_id: id,
      actor: input.changedBy || af.actor,
      source_device: af.source_device,
      before: { commitment_state: oldState },
      after: { commitment_state: newState },
      reason: input.reason,
    });
  }
  return ok;
}

// ============================================================================
// 6. attachIssueRef (一条 PimItem 升级为 Issue → 写 issue.pim_item_id)
// ============================================================================

export function attachIssueRef(
  db: Database.Database,
  pimItemId: string,
  issueId: string,
  ctx?: PimAuditContext,
): boolean {
  // Verify pim_item exists
  const item = db.prepare(`SELECT id FROM pim_item WHERE id = ?`).get(pimItemId);
  if (!item) return false;
  const result = db
    .prepare(`UPDATE issue SET pim_item_id = ? WHERE id = ?`)
    .run(pimItemId, issueId);
  if (result.changes > 0) {
    const af = auditFields(ctx);
    appendPimAudit({
      op: "attach_issue",
      pim_item_id: pimItemId,
      actor: af.actor,
      source_device: af.source_device,
      issue_id: issueId,
    });
  }
  return result.changes > 0;
}

// ============================================================================
// 7. listByCommitment (常用快捷查询)
// ============================================================================

export function listByCommitment(
  db: Database.Database,
  commitment: string,
  limit = 50,
): PimItemRow[] {
  return listPimItems(db, { commitmentState: commitment, limit });
}

// ============================================================================
// 8. listByDomain (JOIN pim_domain_tags)
// ============================================================================

export function listByDomain(
  db: Database.Database,
  domain: string,
  limit = 50,
): PimItemRow[] {
  const norm = normalize(domain)!;
  return db
    .prepare(
      `SELECT p.* FROM pim_item p
         JOIN pim_domain_tags d ON d.pim_item_id = p.id
         WHERE d.domain = @domain AND p.deleted_at IS NULL
         ORDER BY p.captured_at DESC
         LIMIT ${Math.max(1, Math.min(500, limit))}`,
    )
    .all({ domain: norm }) as PimItemRow[];
}

// ============================================================================
// 9. sanityReport (D6 兜底 — 每日 GROUP BY 看 typo)
// ============================================================================

export interface SanityReport {
  commitment: Array<{ value: string; count: number; whitelisted: boolean }>;
  modality: Array<{ value: string; count: number; whitelisted: boolean }>;
  aiStatus: Array<{ value: string; count: number; whitelisted: boolean }>;
}

export function sanityReport(db: Database.Database): SanityReport {
  function group(
    column: string,
    whitelist: Set<string>,
  ): Array<{ value: string; count: number; whitelisted: boolean }> {
    const rows = db
      .prepare(
        `SELECT ${column} as value, COUNT(*) as count
           FROM pim_item
           WHERE deleted_at IS NULL
           GROUP BY ${column}
           ORDER BY count DESC`,
      )
      .all() as Array<{ value: string; count: number }>;
    return rows.map((r) => ({
      value: r.value,
      count: r.count,
      whitelisted: whitelist.has(r.value),
    }));
  }
  return {
    commitment: group("commitment_state", KNOWN_COMMITMENT_STATES),
    modality: group("modality", KNOWN_MODALITIES),
    aiStatus: group("ai_status", KNOWN_AI_STATUSES),
  };
}

// ============================================================================
// 10. softDeletePimItem
// ============================================================================

export function softDeletePimItem(
  db: Database.Database,
  id: string,
  ctx?: PimAuditContext,
): boolean {
  // updatePimItem will emit op='delete' audit because patch.deletedAt != null
  return updatePimItem(db, id, { deletedAt: Date.now() }, ctx);
}

// ============================================================================
// 11. exportPimItems — markdown / csv (Week 3 Day 18, portability red line)
// ============================================================================
//
// v2.1 红线 #4 portability: 用户能 export 全部 PIM 数据为 plain text 格式，
// 不被工具锁定。markdown 给人读 / Obsidian 兼容; csv 给 Excel/scripts 处理.
// 包含 deleted (用户决定要不要看)，但默认 includeDeleted=false.

export interface ExportOpts {
  format: "markdown" | "csv";
  includeDeleted?: boolean;
}

/** Returns export payload as a string ready for HTTP response body. */
export function exportPimItems(db: Database.Database, opts: ExportOpts): string {
  const where: string[] = [];
  if (!opts.includeDeleted) where.push("deleted_at IS NULL");
  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  // Pull domain_tags + people_refs alongside main row for export richness
  const items = db
    .prepare(
      `SELECT id, content, captured_at, source, commitment_state, modality, ai_status,
              visibility, owner_user_id, created_at, updated_at, deleted_at
         FROM pim_item ${whereClause} ORDER BY captured_at DESC`,
    )
    .all() as PimItemRow[];

  const domainsByItem = new Map<string, string[]>();
  const domainRows = db
    .prepare(`SELECT pim_item_id, domain FROM pim_domain_tags`)
    .all() as Array<{ pim_item_id: string; domain: string }>;
  for (const r of domainRows) {
    const arr = domainsByItem.get(r.pim_item_id) ?? [];
    arr.push(r.domain);
    domainsByItem.set(r.pim_item_id, arr);
  }

  const peopleByItem = new Map<string, string[]>();
  const peopleRows = db
    .prepare(`SELECT pim_item_id, person_ref FROM pim_people_refs`)
    .all() as Array<{ pim_item_id: string; person_ref: string }>;
  for (const r of peopleRows) {
    const arr = peopleByItem.get(r.pim_item_id) ?? [];
    arr.push(r.person_ref);
    peopleByItem.set(r.pim_item_id, arr);
  }

  if (opts.format === "csv") return toCsv(items, domainsByItem, peopleByItem);
  return toMarkdown(items, domainsByItem, peopleByItem);
}

function isoDate(epochMs: number | null): string {
  if (epochMs == null) return "";
  return new Date(epochMs).toISOString();
}

function csvEscape(s: string | null | undefined): string {
  if (s == null) return "";
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(
  items: PimItemRow[],
  domains: Map<string, string[]>,
  people: Map<string, string[]>,
): string {
  const header = [
    "id",
    "captured_at_iso",
    "source",
    "commitment_state",
    "modality",
    "ai_status",
    "visibility",
    "content",
    "domains",
    "people",
    "created_at_iso",
    "updated_at_iso",
    "deleted_at_iso",
  ].join(",");
  const rows = items.map((it) =>
    [
      it.id,
      isoDate(it.captured_at),
      it.source,
      it.commitment_state,
      it.modality,
      it.ai_status,
      it.visibility,
      csvEscape(it.content),
      csvEscape((domains.get(it.id) ?? []).join("|")),
      csvEscape((people.get(it.id) ?? []).join("|")),
      isoDate(it.created_at),
      isoDate(it.updated_at),
      isoDate(it.deleted_at),
    ].join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

function toMarkdown(
  items: PimItemRow[],
  domains: Map<string, string[]>,
  people: Map<string, string[]>,
): string {
  const lines: string[] = [
    `# PIM Export`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `Total items: ${items.length}`,
    ``,
    `---`,
    ``,
  ];
  for (const it of items) {
    const d = domains.get(it.id) ?? [];
    const p = people.get(it.id) ?? [];
    lines.push(
      `## ${it.id}`,
      ``,
      `- **captured**: ${isoDate(it.captured_at)}`,
      `- **source**: ${it.source}`,
      `- **commitment**: ${it.commitment_state}`,
      `- **modality**: ${it.modality}`,
      `- **ai_status**: ${it.ai_status}`,
      `- **visibility**: ${it.visibility}`,
      ...(d.length > 0 ? [`- **domains**: ${d.join(", ")}`] : []),
      ...(p.length > 0 ? [`- **people**: ${p.join(", ")}`] : []),
      ...(it.deleted_at ? [`- **deleted**: ${isoDate(it.deleted_at)}`] : []),
      ``,
      it.content,
      ``,
      `---`,
      ``,
    );
  }
  return lines.join("\n");
}
