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

const API_BASE: string =
  (import.meta as any).env?.VITE_API_URL ??
  `http://${window.location.hostname}:3030`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function fetchTree(
  root: string,
  relPath: string,
): Promise<FsTreeResponse> {
  const params = new URLSearchParams({ root, path: relPath });
  return getJson<FsTreeResponse>(`${API_BASE}/api/fs/tree?${params.toString()}`);
}

export function fetchFile(
  root: string,
  relPath: string,
): Promise<FsFileResponse> {
  const params = new URLSearchParams({ root, path: relPath });
  return getJson<FsFileResponse>(`${API_BASE}/api/fs/file?${params.toString()}`);
}

export interface FsHomeResponse {
  home: string;
  cwd: string;
}

export function fetchHome(): Promise<FsHomeResponse> {
  return getJson<FsHomeResponse>(`${API_BASE}/api/fs/home`);
}

export interface FsMkdirResponse { ok: true; path: string }
export async function createDirectory(parent: string, name: string): Promise<FsMkdirResponse> {
  const res = await fetch(`${API_BASE}/api/fs/mkdir`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parent, name }),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return (await res.json()) as FsMkdirResponse;
}
