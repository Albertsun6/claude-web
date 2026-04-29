// POST /api/telemetry — accept event batches from clients (currently iOS only).
// Body schema:
//   { events: [{ timestamp, level, event, conversationId?, runId?, props?, ... }] }
//
// We tolerate / ignore malformed entries to avoid losing the whole batch when
// one event is broken (e.g. an old client uploading after a schema change).

import { Hono } from "hono";
import { appendEvents, type TelemetryEvent } from "../telemetry-store.js";

export const telemetryRouter = new Hono();

const MAX_BATCH = 500;
const KNOWN_LEVELS = new Set(["info", "warn", "error", "crash"]);

function coerceEvent(raw: unknown): TelemetryEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const event = typeof o.event === "string" ? o.event : null;
  if (!event) return null;
  const level = typeof o.level === "string" && KNOWN_LEVELS.has(o.level) ? o.level : "info";
  const timestamp = typeof o.timestamp === "string" ? o.timestamp : new Date().toISOString();
  const ev: TelemetryEvent = {
    timestamp,
    level: level as TelemetryEvent["level"],
    event,
  };
  if (typeof o.conversationId === "string") ev.conversationId = o.conversationId;
  if (typeof o.runId === "string") ev.runId = o.runId;
  if (o.props && typeof o.props === "object") ev.props = o.props as Record<string, unknown>;
  if (typeof o.appVersion === "string") ev.appVersion = o.appVersion;
  if (typeof o.buildVersion === "string") ev.buildVersion = o.buildVersion;
  if (typeof o.deviceModel === "string") ev.deviceModel = o.deviceModel;
  if (typeof o.source === "string") ev.source = o.source;
  return ev;
}

telemetryRouter.post("/", async (c) => {
  let body: { events?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON body required" }, 400);
  }
  const raw = Array.isArray(body.events) ? body.events : [];
  if (raw.length > MAX_BATCH) {
    return c.json({ error: `batch too large (>${MAX_BATCH})` }, 413);
  }
  const events: TelemetryEvent[] = [];
  let dropped = 0;
  for (const r of raw) {
    const ev = coerceEvent(r);
    if (ev) events.push(ev);
    else dropped++;
  }
  // Default source = ios (the only client wiring this for now).
  const written = await appendEvents(events, "ios");
  return c.json({ ok: true, written, dropped });
});
