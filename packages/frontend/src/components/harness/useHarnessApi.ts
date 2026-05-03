// Thin fetch wrapper for /api/harness/* endpoints.
import { authFetch } from "../../auth";

export interface Initiative {
  id: string;
  project_id: string;
  title: string;
  intent: string;
  status: "draft" | "active" | "paused" | "done";
  owner_human: string;
  created_at: number;
  updated_at: number;
}

export interface Issue {
  id: string;
  project_id: string;
  initiative_id: string | null;
  title: string;
  body: string;
  priority: string;
  status: string;
  created_at: number;
  updated_at: number;
  stages?: Stage[];
}

export interface Stage {
  id: string;
  issue_id: string;
  kind: string;
  status: string;
  weight: string;
  assigned_agent_profile: string;
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
}

export interface Decision {
  id: string;
  stage_id: string;
  requested_by: string;
  options_json: string;
  chosen_option: string | null;
  decided_by: string | null;
  rationale: string | null;
  decided_at: number | null;
  created_at: number;
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await authFetch(path, opts);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.data as T;
}

// Initiative
export const harnessApi = {
  listInitiatives: (projectId: string) =>
    api<Initiative[]>(`/api/harness/initiatives?projectId=${encodeURIComponent(projectId)}`),

  createInitiative: (projectId: string, title: string, intent?: string, cwd?: string) =>
    api<Initiative>("/api/harness/initiatives", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, cwd: cwd ?? projectId, title, intent }),
    }),

  // Issue
  listIssues: (opts: { projectId?: string; initiativeId?: string }) => {
    const q = new URLSearchParams();
    if (opts.projectId) q.set("projectId", opts.projectId);
    if (opts.initiativeId) q.set("initiativeId", opts.initiativeId);
    return api<Issue[]>(`/api/harness/issues?${q}`);
  },

  createIssue: (projectId: string, initiativeId: string | undefined, title: string, body?: string) =>
    api<Issue>("/api/harness/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, initiativeId, title, body }),
    }),

  getIssue: (id: string) => api<Issue>(`/api/harness/issues/${id}`),

  updateIssueStatus: (id: string, status: string) =>
    api<void>(`/api/harness/issues/${id}/status`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }),

  // Stage
  createStage: (issueId: string, kind: string) =>
    api<Stage>("/api/harness/stages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issueId, kind }),
    }),

  setStageStatus: (stageId: string, status: string) =>
    api<void>(`/api/harness/stages/${stageId}/status`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }),

  // Decision
  listDecisions: (stageId: string) =>
    api<Decision[]>(`/api/harness/decisions?stageId=${encodeURIComponent(stageId)}`),

  createDecision: (stageId: string, options: string[]) =>
    api<Decision>("/api/harness/decisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stageId, options }),
    }),

  resolveDecision: (id: string, chosenOption: string, rationale?: string) =>
    api<void>(`/api/harness/decisions/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chosenOption, decidedBy: "user", rationale }),
    }),
};
