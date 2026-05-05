// Eva harness 看板 — 实验性，给 1 次双轨并行实验做 cockpit。
//
// **不是** stable harness UI contract。路径前缀 `experiments/`、HTML 文件名
// `experiments-parallel-board.html`、env gate `EVA_PARALLEL_EXPERIMENT=1` 三层
// 都在标"throwaway"。M2 web harness UI 不继承本 schema。
//
// 退出规则（plan 阶段已敲定）：实验后 retrospective 决定保留还是删除。
//   - 保留 → rename 到 stable 路径（如 /api/harness/board）+ 开 M2 contract redesign
//   - 删除 → cleanup PR 删 route file + html file + env gate 代码
//
// scope（cross M1/M2/M4 + 用户 manual #2 缩 scope 后）：
//   - 4 段：worktrees / backends / prs / locks（不返回 commits / dbStats）
//   - 路径 redact：HOME 目录替换为 `<HOME>`
//   - auth 继承现有 authMiddleware（CLAUDE_WEB_TOKEN）
//   - 5s 缓存

import { Hono } from "hono";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const experimentsParallelBoardRouter = new Hono();

type StatusKind = "ok" | "warn" | "error";

interface Section<T> {
  status: StatusKind;
  items: T[];
  errorMessage?: string;
}

interface WorktreeItem {
  /** Path with $HOME redacted to `<HOME>` */
  path: string;
  branch: string;
  /** True if `git status --porcelain` returns non-empty */
  dirty: boolean;
}

interface BackendItem {
  port: number;
  /** "stable" / "track-1-dev" / "track-2-dev" — implementation labels for the experiment */
  role: string;
  /** True if /health returned 200 */
  alive: boolean;
  /** True if /api/harness/initiatives returned 200 (i.e. harness DB ok) */
  harnessOk: boolean;
}

interface PRItem {
  number: number;
  title: string;
  branch: string;
  baseBranch: string;
  /** Latest CI run status: "success" / "failure" / "pending" / "unknown" */
  ciStatus: string;
  url: string;
}

interface LockItem {
  track: string;
  files: string[];
  state: "active" | "done" | "released";
  since: string;
}

interface BoardResponse {
  generatedAt: string;
  worktrees: Section<WorktreeItem>;
  backends: Section<BackendItem>;
  prs: Section<PRItem>;
  locks: Section<LockItem>;
}

const HOME = homedir();
const CACHE_TTL_MS = 5_000;
let cache: { at: number; payload: BoardResponse } | null = null;

function redact(s: string): string {
  if (!s) return s;
  return s.startsWith(HOME) ? "<HOME>" + s.slice(HOME.length) : s;
}

function runCmd(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd });
    let stdout = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 5000);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", () => undefined);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ stdout: "", code: -1 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, code: code ?? -1 });
    });
  });
}

async function loadWorktrees(): Promise<Section<WorktreeItem>> {
  try {
    const { stdout, code } = await runCmd("git", ["worktree", "list", "--porcelain"], { cwd: process.cwd() });
    if (code !== 0) return { status: "error", items: [], errorMessage: "git worktree list failed" };

    const items: WorktreeItem[] = [];
    let cur: Partial<WorktreeItem> = {};
    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (cur.path) items.push({ path: cur.path, branch: cur.branch ?? "(detached)", dirty: cur.dirty ?? false });
        cur = { path: redact(line.slice("worktree ".length)) };
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length);
        cur.branch = ref.replace(/^refs\/heads\//, "");
      } else if (line === "detached") {
        cur.branch = "(detached)";
      }
    }
    if (cur.path) items.push({ path: cur.path, branch: cur.branch ?? "(detached)", dirty: false });

    // 顺手查每个 worktree 的 dirty 状态
    for (const item of items) {
      const realPath = item.path.replace("<HOME>", HOME);
      const status = await runCmd("git", ["-C", realPath, "status", "--porcelain"], { timeoutMs: 3000 });
      item.dirty = status.code === 0 && status.stdout.trim().length > 0;
    }

    return { status: "ok", items };
  } catch (err: any) {
    return { status: "error", items: [], errorMessage: String(err?.message ?? err) };
  }
}

async function probeBackend(port: number, role: string): Promise<BackendItem> {
  const probe = async (path: string): Promise<boolean> => {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: ctrl.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  };
  const alive = await probe("/health");
  // /api/harness/initiatives requires ?projectId — pass dummy. Real DB will
  // reply 200 with empty list; broken harness DB will reply 503.
  const harnessOk = alive ? await probe("/api/harness/initiatives?projectId=__board_probe__") : false;
  return { port, role, alive, harnessOk };
}

async function loadBackends(): Promise<Section<BackendItem>> {
  try {
    const items = await Promise.all([
      probeBackend(3030, "stable"),
      probeBackend(3031, "track-1-dev"),
      probeBackend(3032, "track-2-dev"),
    ]);
    const status: StatusKind = items.every((b) => b.alive) ? "ok" : items.some((b) => b.alive) ? "warn" : "error";
    return { status, items };
  } catch (err: any) {
    return { status: "error", items: [], errorMessage: String(err?.message ?? err) };
  }
}

async function loadPRs(): Promise<Section<PRItem>> {
  try {
    const { stdout, code } = await runCmd("gh", ["pr", "list", "--state", "open", "--json", "number,title,headRefName,baseRefName,statusCheckRollup,url", "--limit", "20"], { timeoutMs: 8000 });
    if (code !== 0) return { status: "error", items: [], errorMessage: "gh pr list failed (gh not authed?)" };

    const raw = JSON.parse(stdout) as Array<{
      number: number;
      title: string;
      headRefName: string;
      baseRefName: string;
      url: string;
      statusCheckRollup?: Array<{ conclusion?: string; status?: string }>;
    }>;

    const items: PRItem[] = raw.map((pr) => {
      const checks = pr.statusCheckRollup ?? [];
      let ciStatus = "unknown";
      if (checks.length > 0) {
        const failure = checks.find((c) => c.conclusion === "FAILURE");
        const pending = checks.find((c) => c.status !== "COMPLETED");
        if (failure) ciStatus = "failure";
        else if (pending) ciStatus = "pending";
        else ciStatus = "success";
      }
      return {
        number: pr.number,
        title: pr.title,
        branch: pr.headRefName,
        baseBranch: pr.baseRefName,
        ciStatus,
        url: pr.url,
      };
    });
    return { status: "ok", items };
  } catch (err: any) {
    return { status: "error", items: [], errorMessage: String(err?.message ?? err) };
  }
}

async function loadLocks(): Promise<Section<LockItem>> {
  try {
    // Repo root via git rev-parse — backend cwd is packages/backend, not repo root.
    const repoRoot = await runCmd("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() });
    if (repoRoot.code !== 0 || !repoRoot.stdout.trim()) {
      return { status: "warn", items: [], errorMessage: "git rev-parse failed" };
    }
    const lockPath = join(repoRoot.stdout.trim(), "WORKTREE_LOCK.md");
    const exists = await stat(lockPath).then(() => true).catch(() => false);
    if (!exists) return { status: "warn", items: [], errorMessage: "WORKTREE_LOCK.md not found at repo root" };

    const content = await readFile(lockPath, "utf-8");
    // 极简解析：找形如 `| Track X | files... | state | timestamp |` 的行
    const items: LockItem[] = [];
    for (const line of content.split("\n")) {
      const m = line.match(/^\|\s*(Track\s+[\w-]+)\s*\|\s*([^|]+)\s*\|\s*(active|done|released)\s*\|\s*([^|]+)\s*\|/i);
      if (m) {
        items.push({
          track: m[1].trim(),
          files: m[2].split(",").map((s) => s.trim()).filter(Boolean),
          state: m[3].toLowerCase() as LockItem["state"],
          since: m[4].trim(),
        });
      }
    }
    return { status: "ok", items };
  } catch (err: any) {
    return { status: "error", items: [], errorMessage: String(err?.message ?? err) };
  }
}

async function buildBoard(): Promise<BoardResponse> {
  const [worktrees, backends, prs, locks] = await Promise.all([
    loadWorktrees(),
    loadBackends(),
    loadPRs(),
    loadLocks(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    worktrees,
    backends,
    prs,
    locks,
  };
}

experimentsParallelBoardRouter.get("/", async (c) => {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return c.json(cache.payload, 200, { "X-Board-Cache": "hit" });
  }
  const payload = await buildBoard();
  cache = { at: now, payload };
  return c.json(payload, 200, { "X-Board-Cache": "miss" });
});
