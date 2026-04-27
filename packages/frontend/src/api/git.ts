import { authFetch } from "../auth";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export interface GitStatusFile {
  path: string;
  indexStatus: string;
  workingStatus: string;
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitStatusFile[];
}

export interface GitLogEntry {
  sha: string;
  author: string;
  relDate: string;
  subject: string;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

export interface GitBranches {
  current: string | null;
  branches: GitBranch[];
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export async function fetchGitStatus(cwd: string): Promise<GitStatus> {
  const url = `${API_BASE}/api/git/status?cwd=${encodeURIComponent(cwd)}`;
  return jsonOrThrow<GitStatus>(await authFetch(url));
}

export async function fetchGitDiff(
  cwd: string,
  path: string,
  staged = false,
): Promise<string> {
  const url = `${API_BASE}/api/git/diff?cwd=${encodeURIComponent(
    cwd,
  )}&path=${encodeURIComponent(path)}&staged=${staged ? 1 : 0}`;
  const res = await authFetch(url);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return await res.text();
}

export async function fetchGitLog(cwd: string, limit = 20): Promise<GitLogEntry[]> {
  const url = `${API_BASE}/api/git/log?cwd=${encodeURIComponent(cwd)}&limit=${limit}`;
  return jsonOrThrow<GitLogEntry[]>(await authFetch(url));
}

export async function fetchGitBranches(cwd: string): Promise<GitBranches> {
  const url = `${API_BASE}/api/git/branch?cwd=${encodeURIComponent(cwd)}`;
  return jsonOrThrow<GitBranches>(await authFetch(url));
}
