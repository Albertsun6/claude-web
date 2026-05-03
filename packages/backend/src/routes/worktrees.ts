// Worktree HTTP routes — create / finalize git worktrees per-conversation.
// Mounted at /api/worktrees + /api/work (list).
//
// Security (v0.5 cross-F4 BLOCKER收敛):
//   - id is server-generated randomUUID(); client-supplied id is rejected
//   - branch slug regex-validated (^[a-zA-Z0-9._/-]+$ + no .. / abs / empty seg)
//   - destructive paths re-validated via path.resolve + prefix assert before
//     any rm or git worktree remove
//   - cwd validated via verifyAllowedPath
//
// Boundary (v0.5 §6.5):
//   - work-registry never stores cwd; cwd is derived from worktreePath when
//     needed via worktreeCwd(record) helper

import { Hono } from "hono";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { verifyAllowedPath } from "../auth.js";
import {
  createWork,
  setStatus,
  findById,
  listByCwd,
  type WorkRecord,
} from "../work-registry.js";

const execFile = promisify(execFileCb);

export const worktreesRouter = new Hono();
export const workRouter = new Hono();

const VALID_FINALIZE_ACTIONS = ["merge", "push", "discard"] as const;
type FinalizeAction = (typeof VALID_FINALIZE_ACTIONS)[number];

const BRANCH_SAFE = /^[a-zA-Z0-9._/-]+$/;

function isValidBranch(slug: string): boolean {
  if (!BRANCH_SAFE.test(slug)) return false;
  if (slug.includes("..")) return false;
  if (slug.startsWith("/") || slug.endsWith("/")) return false;
  if (slug.split("/").some((seg) => seg.length === 0)) return false;
  return true;
}

/** Derive parent cwd from a worktreePath = `<cwd>/.claude-worktrees/<id>`. */
function worktreeCwd(record: WorkRecord): string {
  return path.resolve(record.worktreePath, "..", "..");
}

/** Defense-in-depth: assert path is under <cwd>/.claude-worktrees/ before destructive op. */
function assertWorktreePathSafe(cwd: string, worktreePath: string): void {
  const resolvedRoot = path.resolve(path.join(cwd, ".claude-worktrees")) + path.sep;
  const resolvedPath = path.resolve(worktreePath) + path.sep;
  if (!resolvedPath.startsWith(resolvedRoot)) {
    throw new Error(
      `worktreePath ${worktreePath} escapes ${resolvedRoot} — refusing to act`,
    );
  }
}

async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await execFile("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout.trim();
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execFile("git", ["-C", cwd, "rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/** Append .claude-worktrees/ to .git/info/exclude if not already there. Idempotent. */
async function ensureGitignoreExclude(cwd: string): Promise<void> {
  const excludePath = path.join(cwd, ".git", "info", "exclude");
  let existing = "";
  try {
    existing = fs.readFileSync(excludePath, "utf8");
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code !== "ENOENT") throw err;
  }
  if (existing.split("\n").some((line) => line.trim() === ".claude-worktrees/")) {
    return; // already excluded
  }
  const append = (existing.endsWith("\n") || existing.length === 0 ? "" : "\n") +
    ".claude-worktrees/\n";
  await fs.promises.appendFile(excludePath, append, "utf8");
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/worktrees
// body: { cwd, conversationId?, conversationTitle }
// id, worktreePath, branch are server-generated. Client may NOT supply them.
// ─────────────────────────────────────────────────────────────────────────
worktreesRouter.post("/", async (c) => {
  let payload: {
    cwd?: unknown;
    conversationId?: unknown;
    conversationTitle?: unknown;
    id?: unknown;
    worktreePath?: unknown;
    branch?: unknown;
  };
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  // Reject client-supplied server-managed fields
  if (
    payload.id !== undefined ||
    payload.worktreePath !== undefined ||
    payload.branch !== undefined
  ) {
    return c.json(
      {
        error: "fields 'id' / 'worktreePath' / 'branch' are server-managed; do not supply",
      },
      400,
    );
  }

  if (typeof payload.cwd !== "string" || !path.isAbsolute(payload.cwd)) {
    return c.json({ error: "field 'cwd' must be an absolute path string" }, 400);
  }
  const cwd = path.resolve(payload.cwd);
  const allowedErr = verifyAllowedPath(cwd);
  if (allowedErr) return c.json({ error: `cwd: ${allowedErr}` }, 403);

  if (typeof payload.conversationTitle !== "string" || payload.conversationTitle.trim().length === 0) {
    return c.json({ error: "field 'conversationTitle' is required" }, 400);
  }

  if (!(await isGitRepo(cwd))) {
    return c.json({ error: `cwd ${cwd} is not a git repository` }, 400);
  }

  const baseBranch = await getCurrentBranch(cwd);

  // Generate id ourselves up-front; everything else (branch, worktreePath) is derived.
  const id = randomUUID();
  const branch = `wt/${id}`;
  const worktreePath = path.resolve(path.join(cwd, ".claude-worktrees", id));

  if (!isValidBranch(branch)) {
    return c.json({ error: "internal: generated branch slug invalid" }, 500);
  }
  // Defense-in-depth path check
  try {
    assertWorktreePathSafe(cwd, worktreePath);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  // Actually create the worktree
  try {
    await execFile("git", [
      "-C", cwd,
      "worktree", "add",
      worktreePath,
      "-b", branch,
    ]);
  } catch (err: unknown) {
    return c.json(
      { error: `git worktree add failed: ${(err as Error).message}` },
      500,
    );
  }

  // Ensure .git/info/exclude has .claude-worktrees/ (best-effort; non-fatal)
  try {
    await ensureGitignoreExclude(cwd);
  } catch (err: unknown) {
    console.warn(`[worktree] failed to update .git/info/exclude:`, err);
  }

  const record = await createWork({
    id,
    worktreePath,
    branch,
    baseBranch,
    conversationTitle: payload.conversationTitle.trim(),
  });

  return c.json({ work: record }, 201);
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/worktrees/:id/finalize
// body: { action: "merge" | "push" | "discard" }
// ─────────────────────────────────────────────────────────────────────────
worktreesRouter.post("/:id/finalize", async (c) => {
  const id = c.req.param("id");
  let body: { action?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (
    typeof body.action !== "string" ||
    !VALID_FINALIZE_ACTIONS.includes(body.action as FinalizeAction)
  ) {
    return c.json(
      { error: `field 'action' must be one of: ${VALID_FINALIZE_ACTIONS.join(", ")}` },
      400,
    );
  }
  const action = body.action as FinalizeAction;

  const record = findById(id);
  if (!record) return c.json({ error: "not found" }, 404);
  if (record.status === "discarded" || record.status === "merged") {
    return c.json({ error: `work ${id} already finalized as ${record.status}` }, 409);
  }

  const cwd = worktreeCwd(record);
  // Re-validate path safety before any destructive op
  try {
    assertWorktreePathSafe(cwd, record.worktreePath);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  if (action === "merge") {
    try {
      await execFile("git", ["-C", cwd, "merge", "--no-ff", record.branch]);
    } catch (err: unknown) {
      // Conflict or other failure — leave worktree intact, return error so iOS
      // can show "merge failed (likely conflicts), 先丢回 worktree 处理"
      return c.json(
        {
          error: `git merge failed: ${(err as Error).message}`,
          hint: "likely merge conflict; worktree preserved for manual fix",
        },
        409,
      );
    }
    // Merge succeeded → remove worktree + delete branch (now merged)
    try {
      await execFile("git", ["-C", cwd, "worktree", "remove", "--force", record.worktreePath]);
      await execFile("git", ["-C", cwd, "branch", "-d", record.branch]);
    } catch (err: unknown) {
      console.warn(`[worktree] cleanup after merge failed:`, err);
    }
    const updated = await setStatus(id, "merged");
    return c.json({ work: updated });
  }

  if (action === "push") {
    try {
      await execFile("git", ["-C", cwd, "push", "-u", "origin", record.branch]);
    } catch (err: unknown) {
      return c.json(
        { error: `git push failed: ${(err as Error).message}` },
        500,
      );
    }
    const updated = await setStatus(id, "pushed-pending-pr");
    return c.json({
      work: updated,
      hint: "Branch pushed. Open PR via gh pr create or your remote provider.",
    });
  }

  if (action === "discard") {
    try {
      await execFile("git", ["-C", cwd, "worktree", "remove", "--force", record.worktreePath]);
    } catch (err: unknown) {
      console.warn(`[worktree] git worktree remove failed:`, err);
    }
    try {
      await execFile("git", ["-C", cwd, "branch", "-D", record.branch]);
    } catch (err: unknown) {
      console.warn(`[worktree] git branch -D failed:`, err);
    }
    // hint #1: mark discarded, do NOT delete the WorkRecord
    const updated = await setStatus(id, "discarded");
    return c.json({ work: updated });
  }

  return c.json({ error: "unreachable" }, 500);
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/work?cwd=<encoded-cwd>&include=all
// Returns WorkRecords whose worktreePath is under the given cwd.
// Default excludes status=discarded / merged; pass ?include=all to see them.
// ─────────────────────────────────────────────────────────────────────────
workRouter.get("/", (c) => {
  const cwdParam = c.req.query("cwd");
  if (!cwdParam || !path.isAbsolute(cwdParam)) {
    return c.json({ error: "query 'cwd' (absolute path) is required" }, 400);
  }
  const cwd = path.resolve(cwdParam);
  const allowedErr = verifyAllowedPath(cwd);
  if (allowedErr) return c.json({ error: `cwd: ${allowedErr}` }, 403);

  const includeAll = c.req.query("include") === "all";
  const items = listByCwd(cwd, { includeFinished: includeAll });
  return c.json({ items });
});
