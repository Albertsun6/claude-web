// pim-audit — append-only JSONL audit log for PIM mutations (ADR-020 §D)
//
// 设计要点：
// - Append-only JSONL, 永不 mutate / 截断（与 harness-audit.jsonl 同模式）
// - Failure 不阻塞业务写 (fire-and-forget; .catch(() => {}) 后续 batch 修复)
// - 每个 entry 含 source_device 由 routes 层从 X-Device-Id header 读
// - actor: 'user' | 'ai' | 'system' (migration / dual-write 等)
//
// File: $DATA_DIR/pim-audit.jsonl
//
// Schema (per ADR-020 §D):
//   { ts, op, pim_item_id, actor, source_device?, before?, after?, reason? }
//
// op enums:
//   - 'create'         — POST /api/pim 新建
//   - 'update'         — PATCH /api/pim/:id partial update
//   - 'set_commitment' — PATCH commitmentState (含 before/after state)
//   - 'delete'         — DELETE /api/pim/:id (soft delete)
//   - 'undelete'       — PATCH deletedAt = null
//   - 'attach_issue'   — POST /api/pim/:id/attach-issue
//   - 'ai_suggest'     — Week 2+ AI Level 1 写入建议

import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "./data-dir.js";

const PIM_AUDIT_PATH = join(DATA_DIR, "pim-audit.jsonl");

export type PimAuditOp =
  | "create"
  | "update"
  | "set_commitment"
  | "delete"
  | "undelete"
  | "attach_issue"
  | "ai_suggest";

export interface PimAuditEntry {
  /** Unix ms */
  ts: number;
  op: PimAuditOp;
  pim_item_id: string;
  /** 'user' | 'ai' | 'system' | actor identifier */
  actor: string;
  /** X-Device-Id HTTP header value, undefined when not provided */
  source_device?: string;
  /** Optional: pre-change snapshot of relevant fields */
  before?: Record<string, unknown>;
  /** Optional: post-change snapshot */
  after?: Record<string, unknown>;
  /** Optional: free-form reason / context */
  reason?: string;
  /** Optional: linked Issue id (op='attach_issue') */
  issue_id?: string;
}

/**
 * Audit context passed from routes layer to pim-queries layer.
 * Routes reads X-Device-Id header and constructs this for each request.
 */
export interface PimAuditContext {
  /** 'user' (default) | 'ai' | 'system' | actor identifier */
  actor?: string;
  /** X-Device-Id from HTTP header */
  sourceDevice?: string;
}

/** Append one audit entry. Fire-and-forget; failures swallowed. */
export function appendPimAudit(
  entry: Omit<PimAuditEntry, "ts"> & { ts?: number },
): void {
  const final: PimAuditEntry = {
    ts: entry.ts ?? Date.now(),
    op: entry.op,
    pim_item_id: entry.pim_item_id,
    actor: entry.actor,
    ...(entry.source_device != null ? { source_device: entry.source_device } : {}),
    ...(entry.before != null ? { before: entry.before } : {}),
    ...(entry.after != null ? { after: entry.after } : {}),
    ...(entry.reason != null ? { reason: entry.reason } : {}),
    ...(entry.issue_id != null ? { issue_id: entry.issue_id } : {}),
  };
  const line = JSON.stringify(final) + "\n";
  appendFile(PIM_AUDIT_PATH, line, "utf8").catch((err) => {
    console.warn(`[pim-audit] append failed (non-blocking): ${err.message}`);
  });
}

/** Convenience: derive {actor, source_device} fields from context. */
export function auditFields(ctx: PimAuditContext | undefined): {
  actor: string;
  source_device: string | undefined;
} {
  return {
    actor: ctx?.actor ?? "user",
    source_device: ctx?.sourceDevice,
  };
}

/** Test/maintenance: expose path for verify scripts. */
export function getPimAuditPath(): string {
  return PIM_AUDIT_PATH;
}
