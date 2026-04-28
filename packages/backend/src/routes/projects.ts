// Project registry endpoints. Backed by ~/.claude-web/projects.json via the
// projects-store module (which serializes mutations through a promise queue
// so concurrent POSTs can't race).

import { Hono } from "hono";
import { verifyAllowedPath } from "../auth.js";
import {
  listProjects,
  createProject,
  renameProject,
  forgetProject,
  findMissingProjects,
} from "../projects-store.js";

export const projectsRouter = new Hono();

projectsRouter.get("/", async (c) => {
  const projects = await listProjects();
  return c.json({ projects });
});

projectsRouter.post("/", async (c) => {
  let body: { name?: unknown; cwd?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON body required" }, 400);
  }
  const name = typeof body.name === "string" ? body.name : "";
  const cwd = typeof body.cwd === "string" ? body.cwd : "";
  if (!cwd) return c.json({ error: "cwd required" }, 400);
  const allowErr = verifyAllowedPath(cwd);
  if (allowErr) return c.json({ error: allowErr }, 403);
  const project = await createProject(name, cwd);
  return c.json({ project });
});

projectsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  let body: { name?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON body required" }, 400);
  }
  const name = typeof body.name === "string" ? body.name : "";
  if (!name.trim()) return c.json({ error: "name required" }, 400);
  const updated = await renameProject(id, name);
  if (!updated) return c.json({ error: "not found" }, 404);
  return c.json({ project: updated });
});

projectsRouter.post("/cleanup", async (c) => {
  const missing = await findMissingProjects();
  return c.json({ missing });
});

projectsRouter.post("/:id/forget", async (c) => {
  const id = c.req.param("id");
  const ok = await forgetProject(id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
