// Inbox HTTP routes — capture & list "碎想" from mobile/web.
// Designed for "30秒内能存下一个想法" UX: the POST endpoint accepts
// minimal input and returns immediately.

import { Hono } from "hono";
import { appendInbox, listInbox, markProcessed, inboxStats, type AppendInput } from "../inbox-store.js";

export const inboxRouter = new Hono();

// POST /api/inbox  body: { body: string, source?: string, meta?: object }
// Lowest-friction capture endpoint. body is the only required field.
inboxRouter.post("/", async (c) => {
  let payload: AppendInput;
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
  const item = appendInbox({
    body: payload.body,
    source: payload.source ?? "unknown",
    meta: payload.meta,
  });
  return c.json({ item }, 201);
});

// GET /api/inbox/list?unprocessed=1&limit=50
inboxRouter.get("/list", (c) => {
  const unprocessed = c.req.query("unprocessed") === "1";
  const limitStr = c.req.query("limit");
  const limit = limitStr ? Math.max(1, Math.min(500, parseInt(limitStr, 10) || 50)) : 50;
  return c.json({
    items: listInbox({ unprocessedOnly: unprocessed, limit }),
    stats: inboxStats(),
  });
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
