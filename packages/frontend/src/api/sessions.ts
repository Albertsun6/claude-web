import { authFetch } from "../auth";

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? "";

export interface SessionMeta {
  sessionId: string;
  preview: string;
  mtime: number;
  size: number;
}

export async function fetchSessions(cwd: string): Promise<SessionMeta[]> {
  const params = new URLSearchParams({ cwd });
  const res = await authFetch(`${API_BASE}/api/sessions/list?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body.sessions as SessionMeta[];
}

export async function fetchTranscript(cwd: string, sessionId: string): Promise<unknown[]> {
  const params = new URLSearchParams({ cwd, sessionId });
  const res = await authFetch(`${API_BASE}/api/sessions/transcript?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body.messages as unknown[];
}
