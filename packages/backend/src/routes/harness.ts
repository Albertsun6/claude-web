// harness REST routes (M1 minimum slice)
//
// Endpoints:
//   POST /api/harness/scheduler/tick           trigger one scheduler step
//
//   GET  /api/harness/initiatives?projectId=  list initiatives
//   POST /api/harness/initiatives              create initiative
//   GET  /api/harness/initiatives/:id          get initiative
//
//   GET  /api/harness/issues?initiativeId=&projectId=  list issues
//   POST /api/harness/issues                            create issue
//   GET  /api/harness/issues/:id                        get issue + stages
//   PUT  /api/harness/issues/:id/status                 update status
//
//   GET  /api/harness/stages?issueId=   list stages for issue
//   POST /api/harness/stages            create stage
//   PUT  /api/harness/stages/:id/status set stage status
//
//   GET  /api/harness/decisions?stageId=  list pending decisions
//   POST /api/harness/decisions           create decision
//   PUT  /api/harness/decisions/:id       resolve decision
//
// All endpoints return { ok: true, data: ... } or { ok: false, error: ... }.

import { Hono } from "hono";
import type Database from "better-sqlite3";
import {
  createInitiative, listInitiatives, getInitiative,
  createIssue, listIssues, getIssue, updateIssueStatus,
  createStage, listStages, setStageStatus, skipFailedStage,
  createDecision, listPendingDecisions, resolveDecision,
} from "../harness-queries.js";
import { EvaScheduler } from "../scheduler.js";

export function buildHarnessRouter(
  db: Database.Database,
  broadcast: (msg: unknown) => void,
): Hono {
  const app = new Hono();

  // M2 Loop 6: explicit boot ordering. Constructor is pure (no DB mutation);
  // initialize() runs orphan-stage cleanup (active stages left over by crashed
  // backend runs get marked failed). Must complete before routes mount below
  // — otherwise tick calls could race with cleanup. Single-instance assumption
  // makes synchronous initialize() sufficient.
  const scheduler = new EvaScheduler(db, broadcast);
  scheduler.initialize();

  // -------------------------------------------------------------------------
  // Scheduler
  // -------------------------------------------------------------------------

  app.post("/scheduler/tick", async (c) => {
    const projectId = c.req.query("projectId");
    const result = await scheduler.tick(projectId);
    return c.json({ ok: true, data: result });
  });

  // -------------------------------------------------------------------------
  // Initiative
  // -------------------------------------------------------------------------

  app.get("/initiatives", (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ ok: false, error: "projectId required" }, 400);
    return c.json({ ok: true, data: listInitiatives(db, projectId) });
  });

  app.post("/initiatives", async (c) => {
    let body: { projectId?: string; cwd?: string; title?: string; intent?: string; ownerHuman?: string };
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: "invalid JSON" }, 400); }
    if (!body.projectId || !body.title) return c.json({ ok: false, error: "projectId + title required" }, 400);
    const row = createInitiative(db, { projectId: body.projectId, cwd: body.cwd, title: body.title, intent: body.intent, ownerHuman: body.ownerHuman });
    return c.json({ ok: true, data: row }, 201);
  });

  app.get("/initiatives/:id", (c) => {
    const row = getInitiative(db, c.req.param("id"));
    if (!row) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, data: row });
  });

  // -------------------------------------------------------------------------
  // Issue
  // -------------------------------------------------------------------------

  app.get("/issues", (c) => {
    const initiativeId = c.req.query("initiativeId");
    const projectId = c.req.query("projectId");
    return c.json({ ok: true, data: listIssues(db, { initiativeId, projectId }) });
  });

  app.post("/issues", async (c) => {
    let body: { projectId?: string; initiativeId?: string; title?: string; body?: string; priority?: string; source?: string };
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: "invalid JSON" }, 400); }
    if (!body.projectId || !body.title) return c.json({ ok: false, error: "projectId + title required" }, 400);
    const row = createIssue(db, {
      projectId: body.projectId,
      initiativeId: body.initiativeId,
      title: body.title,
      body: body.body,
      priority: body.priority as any,
      source: body.source,
    });
    return c.json({ ok: true, data: row }, 201);
  });

  app.get("/issues/:id", (c) => {
    const row = getIssue(db, c.req.param("id"));
    if (!row) return c.json({ ok: false, error: "not found" }, 404);
    const stages = listStages(db, row.id);
    return c.json({ ok: true, data: { ...row, stages } });
  });

  app.put("/issues/:id/status", async (c) => {
    let body: { status?: string };
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: "invalid JSON" }, 400); }
    if (!body.status) return c.json({ ok: false, error: "status required" }, 400);
    const ok = updateIssueStatus(db, c.req.param("id"), body.status);
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: "not found" }, 404);
  });

  // -------------------------------------------------------------------------
  // Stage
  // -------------------------------------------------------------------------

  app.get("/stages", (c) => {
    const issueId = c.req.query("issueId");
    if (!issueId) return c.json({ ok: false, error: "issueId required" }, 400);
    return c.json({ ok: true, data: listStages(db, issueId) });
  });

  app.post("/stages", async (c) => {
    let body: { issueId?: string; kind?: string; weight?: string; agentProfileId?: string };
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: "invalid JSON" }, 400); }
    if (!body.issueId || !body.kind) return c.json({ ok: false, error: "issueId + kind required" }, 400);
    const row = createStage(db, { issueId: body.issueId, kind: body.kind, weight: body.weight as any, agentProfileId: body.agentProfileId });
    return c.json({ ok: true, data: row }, 201);
  });

  app.put("/stages/:id/status", async (c) => {
    let body: { status?: string };
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: "invalid JSON" }, 400); }
    if (!body.status) return c.json({ ok: false, error: "status required" }, 400);
    const ok = setStageStatus(db, c.req.param("id"), body.status);
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: "not found" }, 404);
  });

  // M2 Loop 3 — minimal skip API：operator unblock failed stage
  // 严格语义：仅 failed → skipped 单向（plan v2 OQ-G）；其他 status 返回 409。
  // 已 skipped 视为 idempotent no-op。**不**自动触发 tick — operator 须显式调
  // POST /scheduler/tick 推进。
  // 全局 authMiddleware 已强制 VESSEL_TOKEN bearer auth（cross m3 from plan v2）。
  app.post("/stages/:id/skip", (c) => {
    const result = skipFailedStage(db, c.req.param("id"));
    if (result.ok) {
      return c.json({ ok: true, alreadySkipped: result.alreadySkipped ?? false });
    }
    if (result.error === "not_found") {
      return c.json({ ok: false, error: "stage not found" }, 404);
    }
    // invalid_state
    return c.json({
      ok: false,
      error: `cannot skip stage in status='${result.currentStatus}' (only 'failed' allowed)`,
      currentStatus: result.currentStatus,
    }, 409);
  });

  // -------------------------------------------------------------------------
  // Decision
  // -------------------------------------------------------------------------

  app.get("/decisions", (c) => {
    const stageId = c.req.query("stageId");
    if (!stageId) return c.json({ ok: false, error: "stageId required" }, 400);
    return c.json({ ok: true, data: listPendingDecisions(db, stageId) });
  });

  app.post("/decisions", async (c) => {
    let body: { stageId?: string; requestedBy?: string; options?: string[] };
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: "invalid JSON" }, 400); }
    if (!body.stageId || !body.options?.length) return c.json({ ok: false, error: "stageId + options required" }, 400);
    const row = createDecision(db, { stageId: body.stageId, requestedBy: body.requestedBy, options: body.options });
    return c.json({ ok: true, data: row }, 201);
  });

  app.put("/decisions/:id", async (c) => {
    let body: { chosenOption?: string; decidedBy?: string; rationale?: string };
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: "invalid JSON" }, 400); }
    if (!body.chosenOption) return c.json({ ok: false, error: "chosenOption required" }, 400);
    const ok = resolveDecision(db, c.req.param("id"), body.chosenOption, body.decidedBy ?? "user", body.rationale);
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: "not found or already resolved" }, 404);
  });

  return app;
}
