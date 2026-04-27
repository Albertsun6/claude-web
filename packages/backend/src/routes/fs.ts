import { Hono } from "hono";
import path from "node:path";
import fs from "node:fs/promises";
import { verifyAllowedPath } from "../auth.js";

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB

export interface FsTreeEntry {
  name: string;
  type: "dir" | "file";
  size?: number;
}

export interface FsTreeResponse {
  entries: FsTreeEntry[];
}

export interface FsFileResponse {
  content: string;
  size: number;
  encoding: "utf-8";
}

/**
 * Verify that `resolved` lives at or below `root`. Returns true when safe.
 */
function isInsideRoot(root: string, resolved: string): boolean {
  const rel = path.relative(root, resolved);
  if (rel === "") return true;
  if (rel.startsWith("..")) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

export const fsRouter = new Hono();

fsRouter.get("/home", (c) =>
  c.json({ home: process.env.HOME ?? "/", cwd: process.cwd() }),
);

fsRouter.get("/tree", async (c) => {
  const root = c.req.query("root");
  const relPath = c.req.query("path") ?? "";
  const showHidden = c.req.query("hidden") !== "0"; // default: show hidden
  const showNodeModules = c.req.query("showNodeModules") === "1";

  if (!root || !path.isAbsolute(root)) {
    return c.json({ error: "root must be an absolute path" }, 400);
  }
  const rootErr = verifyAllowedPath(root);
  if (rootErr) return c.json({ error: rootErr }, 403);

  const resolved = path.resolve(root, relPath);
  if (!isInsideRoot(root, resolved)) {
    return c.json({ error: "path escapes root" }, 403);
  }

  let dirents;
  try {
    dirents = await fs.readdir(resolved, { withFileTypes: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 404);
  }

  const entries: FsTreeEntry[] = [];
  for (const d of dirents) {
    if (!showHidden && d.name.startsWith(".")) continue;
    if (!showNodeModules && d.name === "node_modules") continue;

    const isDir = d.isDirectory();
    const isFile = d.isFile();
    if (!isDir && !isFile) continue; // skip symlinks/sockets/etc for safety

    let size: number | undefined;
    if (isFile) {
      try {
        const st = await fs.stat(path.join(resolved, d.name));
        size = st.size;
      } catch {
        // ignore stat errors, leave size undefined
      }
    }

    entries.push({
      name: d.name,
      type: isDir ? "dir" : "file",
      ...(size !== undefined ? { size } : {}),
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const body: FsTreeResponse = { entries };
  return c.json(body);
});

fsRouter.post("/mkdir", async (c) => {
  let body: { parent?: unknown; name?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const parent = typeof body.parent === "string" ? body.parent : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!parent || !path.isAbsolute(parent)) {
    return c.json({ error: "parent must be an absolute path" }, 400);
  }
  const parentErr = verifyAllowedPath(parent);
  if (parentErr) return c.json({ error: parentErr }, 403);
  if (!name) return c.json({ error: "name is required" }, 400);
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    return c.json({ error: "invalid folder name" }, 400);
  }

  // verify parent exists and is a directory
  try {
    const st = await fs.stat(parent);
    if (!st.isDirectory()) return c.json({ error: "parent is not a directory" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 404);
  }

  const target = path.join(parent, name);
  if (!isInsideRoot(parent, target)) {
    return c.json({ error: "name escapes parent" }, 403);
  }

  try {
    await fs.mkdir(target, { recursive: false });
    return c.json({ ok: true, path: target });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EEXIST") return c.json({ error: "目录已存在" }, 409);
    return c.json({ error: e.message ?? String(err) }, 500);
  }
});

fsRouter.get("/file", async (c) => {
  const root = c.req.query("root");
  const relPath = c.req.query("path") ?? "";

  if (!root || !path.isAbsolute(root)) {
    return c.json({ error: "root must be an absolute path" }, 400);
  }
  const rootErr = verifyAllowedPath(root);
  if (rootErr) return c.json({ error: rootErr }, 403);

  const resolved = path.resolve(root, relPath);
  if (!isInsideRoot(root, resolved)) {
    return c.json({ error: "path escapes root" }, 403);
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 404);
  }

  if (!stat.isFile()) {
    return c.json({ error: "not a file" }, 400);
  }

  if (stat.size > MAX_FILE_BYTES) {
    return c.json(
      { error: `file too large (${stat.size} bytes, max ${MAX_FILE_BYTES})` },
      413,
    );
  }

  let content: string;
  try {
    content = await fs.readFile(resolved, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }

  const body: FsFileResponse = {
    content,
    size: stat.size,
    encoding: "utf-8",
  };
  return c.json(body);
});
