// Inbox HTTP routes — capture & list "碎想" from mobile/web.
// Designed for "30秒内能存下一个想法" UX: the POST endpoint accepts
// minimal input and returns immediately.

import { Hono } from "hono";
import {
  appendInbox,
  listInbox,
  markProcessed,
  setTriage,
  inboxStats,
  type AppendInput,
  type TriageDestination,
} from "../inbox-store.js";

export const inboxRouter = new Hono();

const VALID_TRIAGE_DESTINATIONS: TriageDestination[] = ["ideas", "archive"];

// POST /api/inbox  body: { body: string, source?: string, meta?: object }
// Lowest-friction capture endpoint. body is the only required field.
// Backend is the sole writer of `status` / `triage` — clients supplying
// these fields are rejected to prevent round-trip data loss when an old
// client decodes-then-re-POSTs.
inboxRouter.post("/", async (c) => {
  let payload: AppendInput & { status?: unknown; triage?: unknown };
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!payload || typeof payload.body !== "string" || payload.body.trim().length === 0) {
    return c.json({ error: "field 'body' is required and must be non-empty string" }, 400);
  }
  if (payload.body.length > 10_000) {
    return c.json({ error: "body too long (max 10000 chars)" }, 400);
  }
  if (payload.status !== undefined || payload.triage !== undefined) {
    return c.json(
      { error: "fields 'status' / 'triage' are server-managed; do not supply them on POST" },
      400,
    );
  }
  const item = appendInbox({
    body: payload.body,
    source: payload.source ?? "unknown",
    meta: payload.meta,
  });
  return c.json({ item }, 201);
});

// GET /api/inbox/list?unprocessed=1&includeArchived=1&limit=50
inboxRouter.get("/list", (c) => {
  const unprocessed = c.req.query("unprocessed") === "1";
  const includeArchived = c.req.query("includeArchived") === "1";
  const limitStr = c.req.query("limit");
  const limit = limitStr ? Math.max(1, Math.min(500, parseInt(limitStr, 10) || 50)) : 50;
  return c.json({
    items: listInbox({ unprocessedOnly: unprocessed, includeArchived, limit }),
    stats: inboxStats(),
  });
});

// POST /api/inbox/:id/triage   body: { destination: "ideas" | "archive", note?: string }
//   destination=archive → item.status = "archived" (hidden from default list)
//   destination=ideas   → triage label only; UI copies body to clipboard for
//                         manual paste into docs/IDEAS.md. Backend never
//                         writes harness docs (§16.3 #1).
inboxRouter.post("/:id/triage", async (c) => {
  const id = c.req.param("id");
  let body: { destination?: unknown; note?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (
    !body ||
    typeof body.destination !== "string" ||
    !VALID_TRIAGE_DESTINATIONS.includes(body.destination as TriageDestination)
  ) {
    return c.json(
      { error: `field 'destination' must be one of: ${VALID_TRIAGE_DESTINATIONS.join(", ")}` },
      400,
    );
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    return c.json({ error: "field 'note' must be a string if provided" }, 400);
  }
  const updated = setTriage(id, {
    destination: body.destination as TriageDestination,
    note: body.note as string | undefined,
  });
  if (!updated) return c.json({ error: "not found" }, 404);
  return c.json({ item: updated });
});

// POST /api/inbox/:id/processed   body: { conversationId: string }
// Called by iOS when a 碎想 is converted into a real conversation.
inboxRouter.post("/:id/processed", async (c) => {
  const id = c.req.param("id");
  let body: { conversationId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body?.conversationId || typeof body.conversationId !== "string") {
    return c.json({ error: "field 'conversationId' is required" }, 400);
  }
  const updated = markProcessed(id, body.conversationId);
  if (!updated) return c.json({ error: "not found" }, 404);
  return c.json({ item: updated });
});

// GET /api/inbox/stats
inboxRouter.get("/stats", (c) => {
  return c.json(inboxStats());
});
