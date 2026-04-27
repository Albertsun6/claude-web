import { Hono } from "hono";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export const gitRouter = new Hono();

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runGit(cwd: string, args: string[], timeoutMs = 5000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`git timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

async function verifyRepo(cwd: string): Promise<string | null> {
  if (!cwd || !isAbsolute(cwd)) return "cwd must be an absolute path";
  try {
    const s = await stat(cwd);
    if (!s.isDirectory()) return "cwd is not a directory";
  } catch {
    return "cwd does not exist";
  }
  try {
    // .git can be a directory (regular repo) or a file (worktree/submodule)
    await stat(join(cwd, ".git"));
    return null;
  } catch {
    return "not a git repo";
  }
}

function isSafeRelPath(p: string): boolean {
  if (!p) return false;
  if (p.includes("\0")) return false;
  if (p.includes(";")) return false;
  if (isAbsolute(p)) return false;
  // disallow any traversal
  const parts = p.split(/[\\/]+/);
  for (const part of parts) {
    if (part === "..") return false;
  }
  // disallow leading dash so it isn't interpreted as a flag
  if (p.startsWith("-")) return false;
  return true;
}

interface StatusFile {
  path: string;
  indexStatus: string;
  workingStatus: string;
}

interface StatusResponse {
  branch: string | null;
  ahead: number;
  behind: number;
  files: StatusFile[];
}

function parseStatus(stdout: string): StatusResponse {
  const out: StatusResponse = { branch: null, ahead: 0, behind: 0, files: [] };
  const lines = stdout.split("\n");
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("##")) {
      // ## main...origin/main [ahead 1, behind 2]
      const rest = line.slice(3);
      const branchPart = rest.split(/\s+\[/)[0];
      const branch = branchPart.split("...")[0];
      out.branch = branch || null;
      const bracket = rest.match(/\[(.+)\]/);
      if (bracket) {
        const aheadM = bracket[1].match(/ahead (\d+)/);
        const behindM = bracket[1].match(/behind (\d+)/);
        if (aheadM) out.ahead = Number(aheadM[1]);
        if (behindM) out.behind = Number(behindM[1]);
      }
      continue;
    }
    // XY <path>  (porcelain v1)
    const indexStatus = line[0] ?? " ";
    const workingStatus = line[1] ?? " ";
    const path = line.slice(3);
    if (path) out.files.push({ path, indexStatus, workingStatus });
  }
  return out;
}

gitRouter.get("/status", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  const err = await verifyRepo(cwd);
  if (err) return c.json({ error: err }, 400);
  try {
    const r = await runGit(cwd, ["status", "--porcelain=v1", "-b"]);
    if (r.code !== 0) return c.json({ error: r.stderr || "git status failed" }, 500);
    return c.json(parseStatus(r.stdout));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

gitRouter.get("/diff", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  const path = c.req.query("path") ?? "";
  const staged = c.req.query("staged") === "1";
  const err = await verifyRepo(cwd);
  if (err) return c.json({ error: err }, 400);
  if (!isSafeRelPath(path)) return c.json({ error: "invalid path" }, 400);
  const args = ["diff"];
  if (staged) args.push("--cached");
  args.push("--", path);
  try {
    const r = await runGit(cwd, args);
    if (r.code !== 0) return c.json({ error: r.stderr || "git diff failed" }, 500);
    return c.text(r.stdout);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

interface LogEntry {
  sha: string;
  author: string;
  relDate: string;
  subject: string;
}

gitRouter.get("/log", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  const limitRaw = Number(c.req.query("limit") ?? 20);
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 20));
  const err = await verifyRepo(cwd);
  if (err) return c.json({ error: err }, 400);
  try {
    const r = await runGit(cwd, [
      "log",
      `-${limit}`,
      "--pretty=format:%h%x09%an%x09%ar%x09%s",
    ]);
    if (r.code !== 0) return c.json({ error: r.stderr || "git log failed" }, 500);
    const entries: LogEntry[] = r.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", author = "", relDate = "", ...rest] = line.split("\t");
        return { sha, author, relDate, subject: rest.join("\t") };
      });
    return c.json(entries);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

interface BranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

interface BranchResponse {
  current: string | null;
  branches: BranchInfo[];
}

gitRouter.get("/branch", async (c) => {
  const cwd = c.req.query("cwd") ?? "";
  const err = await verifyRepo(cwd);
  if (err) return c.json({ error: err }, 400);
  try {
    const r = await runGit(cwd, [
      "branch",
      "--list",
      "-a",
      "--format=%(refname:short)\t%(HEAD)",
    ]);
    if (r.code !== 0) return c.json({ error: r.stderr || "git branch failed" }, 500);
    const branches: BranchInfo[] = [];
    let current: string | null = null;
    for (const line of r.stdout.split("\n")) {
      if (!line) continue;
      const [name = "", headMark = ""] = line.split("\t");
      if (!name) continue;
      // skip `origin/HEAD -> origin/main` style entries
      if (name.includes("->")) continue;
      const isCurrent = headMark.trim() === "*";
      // `git branch -a --format=%(refname:short)` returns local branches as-is and
      // remotes as e.g. "origin/main" (no "remotes/" prefix). Remote-tracking branches
      // always contain a "/". Local branches with slashes (e.g. "feature/foo") would
      // collide; to disambiguate we mark `isCurrent=false` entries with a "/" as remote
      // only if no local branch with the same name was already recorded — but git
      // never lists a remote-tracking branch as current via HEAD, so isCurrent implies
      // local. We treat any non-current branch with a "/" as remote heuristically.
      const isRemote = !isCurrent && name.includes("/");
      branches.push({ name, isCurrent, isRemote });
      if (isCurrent) current = name;
    }
    const resp: BranchResponse = { current, branches };
    return c.json(resp);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
