// GET /api/context/git-diff?cwd=...
//
// Returns the full unified diff (working tree + index) of the cwd's git repo
// for the H4 "context attachment" panel. Capped at MAX_DIFF_BYTES so a giant
// blob diff can't blow up the iOS prompt buffer.

import { Hono } from "hono";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { verifyAllowedPath } from "../auth.js";

export const contextRouter = new Hono();

const MAX_DIFF_BYTES = 200 * 1024; // 200 KB

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
  truncated: boolean;
}

function runGit(cwd: string, args: string[], timeoutMs = 8000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`git timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      if (truncated) return;
      stdout += d.toString();
      if (stdout.length > MAX_DIFF_BYTES) {
        stdout = stdout.slice(0, MAX_DIFF_BYTES);
        truncated = true;
        // Don't kill — let it finish naturally so the pipe closes cleanly.
      }
    });
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1, truncated });
    });
  });
}

async function verifyRepo(cwd: string): Promise<{ status: 400 | 403; error: string } | null> {
  if (!cwd || !isAbsolute(cwd)) return { status: 400, error: "cwd must be an absolute path" };
  const allowErr = verifyAllowedPath(cwd);
  if (allowErr) return { status: 403, error: allowErr };
  try {
    const s = await stat(cwd);
    if (!s.isDirectory()) return { status: 400, error: "cwd is not a directory" };
  } catch {
    return { status: 400, error: "cwd does not exist" };
  }
  try {
    await stat(join(cwd, ".git"));
    return null;
  } catch {
    return { status: 400, error: "not a git repo" };
  }
}

contextRouter.get("/git-diff", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  const err = await verifyRepo(cwd);
  if (err) return c.json({ error: err.error }, err.status);

  try {
    // HEAD..worktree (working tree + staged combined, single coherent view).
    const r = await runGit(cwd, ["diff", "--no-color", "HEAD"]);
    if (r.code !== 0 && !r.stdout) {
      return c.json({ error: r.stderr || "git diff failed" }, 500);
    }
    return c.json({
      diff: r.stdout,
      bytes: Buffer.byteLength(r.stdout, "utf-8"),
      truncated: r.truncated,
      maxBytes: MAX_DIFF_BYTES,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
