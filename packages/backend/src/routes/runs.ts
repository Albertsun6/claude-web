// Run inspection + emergency intervention HTTP routes.
// Adapted from tiann/hapi@7d55bc14 (AGPL-3.0)
//   Original: hub/src/web/routes/permissions.ts — borrowed approve/deny + inspect pattern.
//   See third_party/NOTICES.md for full attribution.
//
// claude-web's existing PreToolUse permission flow handles approve/deny via
// the WS+token registry in routes/permission.ts. This file adds two new
// HTTP-only capabilities: list active runs and force-interrupt by runId.

import { Hono } from "hono";
import { listActive, interrupt, activeCount } from "../run-registry.js";

export const runsRouter = new Hono();

// GET /api/runs
runsRouter.get("/", (c) => {
  return c.json({
    active: listActive(),
    count: activeCount(),
  });
});

// POST /api/runs/:runId/interrupt
// Force SIGTERM on the run; backend will follow the 5s SIGKILL grace.
runsRouter.post("/:runId/interrupt", (c) => {
  const runId = c.req.param("runId");
  if (!runId) return c.json({ error: "runId required" }, 400);
  const ok = interrupt(runId);
  if (!ok) return c.json({ error: "run not found or already ended", runId }, 404);
  return c.json({ ok: true, runId });
});
