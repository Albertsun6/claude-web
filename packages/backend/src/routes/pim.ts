// PIM HTTP routes — POST /api/pim, GET /api/pim/list, PATCH /api/pim/:id (M0-PIM Day 3).
//
// 同源：
// - DDL: packages/backend/src/migrations/0008_pim_item.sql
// - Zod: packages/shared/src/pim-protocol.ts
// - Queries: packages/backend/src/pim-queries.ts
// - ADR: docs/adr/vessel/ADR-020-pim-capture-entry.md
//
// HTTP 形态参考 routes/inbox.ts。DB instance 通过 setPimDbForRoutes() 注入
// (避免 router signature 改 + 与 inbox-store.ts dual-write 一致的注入模式)。

import { Hono } from "hono";
import type { HarnessDb } from "../harness-store.js";
import {
  createPimItem,
  getPimItem,
  listPimItems,
  updatePimItem,
  setCommitmentState,
  attachIssueRef,
  sanityReport,
  softDeletePimItem,
  type PimItemRow,
} from "../pim-queries.js";

// ============================================================================
// DB instance injection (mirrors inbox-store.setPimDbForInbox pattern)
// ============================================================================

let _db: HarnessDb | null = null;

export function setPimDbForRoutes(db: HarnessDb | null): void {
  _db = db;
}

function requireDb(): HarnessDb {
  if (_db == null) {
    throw new Error("[pim routes] no harness DB injected — call setPimDbForRoutes() first");
  }
  return _db;
}

// ============================================================================
// Row → wire (snake_case → camelCase)
// ============================================================================

interface PimItemWireDto {
  id: string;
  content: string;
  capturedAt: number;
  source: string;
  commitmentState: string;
  modality: string;
  aiStatus: string;
  aiSuggestedAt?: number;
  visibility: string;
  ownerUserId?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

function rowToWire(row: PimItemRow): PimItemWireDto {
  const wire: PimItemWireDto = {
    id: row.id,
    content: row.content,
    capturedAt: row.captured_at,
    source: row.source,
    commitmentState: row.commitment_state,
    modality: row.modality,
    aiStatus: row.ai_status,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.ai_suggested_at != null) wire.aiSuggestedAt = row.ai_suggested_at;
  if (row.owner_user_id != null) wire.ownerUserId = row.owner_user_id;
  if (row.deleted_at != null) wire.deletedAt = row.deleted_at;
  return wire;
}

// ============================================================================
// Router
// ============================================================================

export const pimRouter = new Hono();

// ----------------------------------------------------------------------------
// POST /api/pim
// body: { content, source?, commitmentState?, modality?, visibility?, domainTags?, peopleRefs?, derivedFromIds? }
// ----------------------------------------------------------------------------

pimRouter.post("/", async (c) => {
  let payload: Record<string, unknown>;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (typeof payload.content !== "string" || payload.content.trim().length === 0) {
    return c.json({ error: "field 'content' is required and must be non-empty string" }, 400);
  }
  if (payload.content.length > 50_000) {
    return c.json({ error: "content too long (max 50000 chars)" }, 400);
  }

  // 推导默认 source：from user-agent / route hint / fallback 'manual'
  const ua = c.req.header("user-agent") ?? "";
  const inferredSource =
    typeof payload.source === "string" && payload.source.trim().length > 0
      ? payload.source.trim()
      : ua.toLowerCase().includes("ios") || ua.toLowerCase().includes("seaidea") || ua.toLowerCase().includes("vessel")
        ? "ios"
        : ua.toLowerCase().includes("mozilla")
          ? "web"
          : "manual";

  const peopleRefs = Array.isArray(payload.peopleRefs)
    ? (payload.peopleRefs as unknown[])
        .map((p) =>
          typeof p === "string" ? { personRef: p } : (p as { personRef?: string }),
        )
        .filter((p): p is { personRef: string } => typeof p.personRef === "string")
    : undefined;

  const row = createPimItem(requireDb().db, {
    content: payload.content,
    source: inferredSource,
    commitmentState: typeof payload.commitmentState === "string" ? payload.commitmentState : undefined,
    modality: typeof payload.modality === "string" ? payload.modality : undefined,
    visibility: typeof payload.visibility === "string" ? payload.visibility : undefined,
    domainTags: Array.isArray(payload.domainTags)
      ? (payload.domainTags as string[]).filter((d) => typeof d === "string")
      : undefined,
    peopleRefs,
  });

  return c.json({ item: rowToWire(row) }, 201);
});

// ----------------------------------------------------------------------------
// GET /api/pim/list?commitment=inbox&source=ios&limit=50&sinceMs=...&includeDeleted=1
// ----------------------------------------------------------------------------

pimRouter.get("/list", (c) => {
  const commitment = c.req.query("commitment") || undefined;
  const source = c.req.query("source") || undefined;
  const limitStr = c.req.query("limit");
  const limit = limitStr ? Math.max(1, Math.min(500, parseInt(limitStr, 10) || 50)) : 50;
  const sinceMsStr = c.req.query("sinceMs");
  const sinceMs = sinceMsStr ? parseInt(sinceMsStr, 10) : undefined;
  const includeDeleted = c.req.query("includeDeleted") === "1";

  const rows = listPimItems(requireDb().db, {
    commitmentState: commitment,
    source,
    limit,
    sinceMs,
    includeDeleted,
  });
  return c.json({ items: rows.map(rowToWire), total: rows.length });
});

// ----------------------------------------------------------------------------
// GET /api/pim/sanity-report  (D6 应用层兜底报告 — typo 候选)
//
// 必须注册在 /:id 之前，否则 Hono 把 sanity-report 当 :id 匹配（路由顺序敏感）。
// ----------------------------------------------------------------------------

pimRouter.get("/sanity-report", (c) => {
  const report = sanityReport(requireDb().db);
  return c.json(report);
});

// ----------------------------------------------------------------------------
// GET /api/pim/:id
// ----------------------------------------------------------------------------

pimRouter.get("/:id", (c) => {
  const id = c.req.param("id");
  const row = getPimItem(requireDb().db, id);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ item: rowToWire(row) });
});

// ----------------------------------------------------------------------------
// PATCH /api/pim/:id
// body: any subset of { content, commitmentState, modality, visibility, aiStatus, deletedAt }
//
// partial update only — must contain ≥ 1 field (ADR-020 R5 多设备 last-write-wins
// 缓解：避免 PUT 整对象互相覆盖)。commitmentState 改动会写 pim_commitment_state_history。
// ----------------------------------------------------------------------------

pimRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  let payload: Record<string, unknown>;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (Object.keys(payload).length === 0) {
    return c.json({ error: "PATCH body must contain at least one field" }, 400);
  }

  const db = requireDb().db;
  const existing = getPimItem(db, id);
  if (!existing) return c.json({ error: "not found" }, 404);

  // commitmentState change → 走专门 helper（写 history）
  if (typeof payload.commitmentState === "string") {
    const deviceId = c.req.header("x-device-id") || "unknown";
    const changedBy = typeof payload.changedBy === "string" ? payload.changedBy : `user:${deviceId}`;
    setCommitmentState(db, id, {
      newState: payload.commitmentState,
      changedBy,
      reason: typeof payload.reason === "string" ? payload.reason : undefined,
    });
  }

  // 其他字段 partial update
  const otherPatch: Parameters<typeof updatePimItem>[2] = {};
  if (typeof payload.content === "string") otherPatch.content = payload.content;
  if (typeof payload.modality === "string") otherPatch.modality = payload.modality;
  if (typeof payload.visibility === "string") otherPatch.visibility = payload.visibility;
  if (typeof payload.aiStatus === "string") otherPatch.aiStatus = payload.aiStatus;
  if (payload.deletedAt === null) otherPatch.deletedAt = null;
  else if (typeof payload.deletedAt === "number") otherPatch.deletedAt = payload.deletedAt;
  if (Object.keys(otherPatch).length > 0) updatePimItem(db, id, otherPatch);

  const updated = getPimItem(db, id);
  return c.json({ item: rowToWire(updated!) });
});

// ----------------------------------------------------------------------------
// DELETE /api/pim/:id  (soft delete)
// ----------------------------------------------------------------------------

pimRouter.delete("/:id", (c) => {
  const id = c.req.param("id");
  const db = requireDb().db;
  const ok = softDeletePimItem(db, id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ----------------------------------------------------------------------------
// POST /api/pim/:id/attach-issue   body: { issueId }
// 把 PimItem 升级为 Issue（写 issue.pim_item_id —— derived_from 入口到 harness 流程）
// ----------------------------------------------------------------------------

pimRouter.post("/:id/attach-issue", async (c) => {
  const id = c.req.param("id");
  let body: { issueId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.issueId || typeof body.issueId !== "string") {
    return c.json({ error: "field 'issueId' is required" }, 400);
  }
  const ok = attachIssueRef(requireDb().db, id, body.issueId);
  if (!ok) return c.json({ error: "pim_item not found or issue update failed" }, 404);
  return c.json({ ok: true });
});
