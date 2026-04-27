import { create } from "zustand";
import type { ModelId, PermissionMode } from "@claude-web/shared";

export interface RenderedMessage {
  id: string;
  raw: any;
}

export interface PermissionRequest {
  runId: string;
  requestId: string;
  toolName: string;
  input: unknown;
}

export interface Project {
  name: string;
  cwd: string;
}

export interface VoiceDraft {
  original: string;
  cleaned: string;
  status: "pending" | "ready" | "failed";
}

export interface ProjectSession {
  cwd: string;
  name: string;
  sessionId?: string;
  messages: RenderedMessage[];
  busy: boolean;
  currentRunId?: string;
  voiceDraft?: VoiceDraft;
}

interface AppState {
  // global config
  model: ModelId;
  permissionMode: PermissionMode;
  setModel: (v: ModelId) => void;
  setPermissionMode: (v: PermissionMode) => void;

  // saved projects (sidebar list)
  projects: Project[];
  addProject: (p: Project) => void;
  removeProject: (cwd: string) => void;

  // open project tabs (separate from saved list)
  byCwd: Record<string, ProjectSession>;
  openCwds: string[];
  activeCwd: string | undefined;
  openProject: (p: Project) => void;
  closeProject: (cwd: string) => void;
  setActiveCwd: (cwd: string | undefined) => void;
  // mutate one project's session
  patchProject: (cwd: string, patch: Partial<ProjectSession>) => void;
  appendMessage: (cwd: string, raw: any) => void;
  clearMessages: (cwd: string) => void;
  resetSession: (cwd: string) => void; // clear messages + sessionId
  // helper: ensure cwd is open and active (used when adding a new project on the fly)
  ensureOpenAndActive: (project: Project) => void;

  // ws state
  connected: boolean;
  setConnected: (v: boolean) => void;

  // permission (one modal global)
  pendingPermission: PermissionRequest | undefined;
  setPendingPermission: (p: PermissionRequest | undefined) => void;

  // voice cleanup pref
  voiceCleanupEnabled: boolean;
  setVoiceCleanupEnabled: (b: boolean) => void;
}

const LS_CONFIG = "claude-web:config";
const LS_PROJECTS = "claude-web:projects";
const LS_SESSIONS = "claude-web:sessions";
const LS_OPEN = "claude-web:open-cwds";
const LS_VOICE_CLEANUP = "claude-web:voice-cleanup";

const persistedConfig = (() => {
  try { return JSON.parse(localStorage.getItem(LS_CONFIG) ?? "{}"); } catch { return {}; }
})();
const persistedProjects: Project[] = (() => {
  try { return JSON.parse(localStorage.getItem(LS_PROJECTS) ?? "[]"); } catch { return []; }
})();
const persistedSessions: Record<string, string> = (() => {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS) ?? "{}"); } catch { return {}; }
})();
const persistedOpen: string[] = (() => {
  try { return JSON.parse(localStorage.getItem(LS_OPEN) ?? "[]"); } catch { return []; }
})();

const persistConfig = (s: Partial<AppState>) => {
  const cur = JSON.parse(localStorage.getItem(LS_CONFIG) ?? "{}");
  localStorage.setItem(LS_CONFIG, JSON.stringify({ ...cur, ...s }));
};
const persistProjects = (projects: Project[]) =>
  localStorage.setItem(LS_PROJECTS, JSON.stringify(projects));
const persistSessions = (sessions: Record<string, string>) =>
  localStorage.setItem(LS_SESSIONS, JSON.stringify(sessions));
const persistOpen = (cwds: string[]) =>
  localStorage.setItem(LS_OPEN, JSON.stringify(cwds));

const updateSessionInLS = (cwd: string, sessionId: string | undefined) => {
  const cur: Record<string, string> = JSON.parse(localStorage.getItem(LS_SESSIONS) ?? "{}");
  if (sessionId) cur[cwd] = sessionId; else delete cur[cwd];
  persistSessions(cur);
};

let msgId = 0;

function makeSession(p: Project): ProjectSession {
  return {
    cwd: p.cwd,
    name: p.name,
    sessionId: persistedSessions[p.cwd],
    messages: [],
    busy: false,
  };
}

const initialByCwd: Record<string, ProjectSession> = {};
for (const cwd of persistedOpen) {
  const proj = persistedProjects.find((p) => p.cwd === cwd);
  if (proj) initialByCwd[cwd] = makeSession(proj);
}

export const useStore = create<AppState>((set, get) => ({
  model: persistedConfig.model ?? "claude-sonnet-4-6",
  permissionMode: persistedConfig.permissionMode ?? "default",
  setModel: (model) => { persistConfig({ model }); set({ model }); },
  setPermissionMode: (permissionMode) => { persistConfig({ permissionMode }); set({ permissionMode }); },

  projects: persistedProjects,
  addProject: (p) => {
    const cur = get().projects;
    if (cur.some((x) => x.cwd === p.cwd)) return;
    const next = [...cur, p];
    persistProjects(next);
    set({ projects: next });
  },
  removeProject: (cwd) => {
    const next = get().projects.filter((p) => p.cwd !== cwd);
    persistProjects(next);
    updateSessionInLS(cwd, undefined);
    // also close it if open
    get().closeProject(cwd);
    set({ projects: next });
  },

  byCwd: initialByCwd,
  openCwds: persistedOpen.filter((c) => initialByCwd[c]),
  activeCwd: persistedOpen.find((c) => initialByCwd[c]),

  openProject: (p) => {
    const { openCwds, byCwd } = get();
    if (!byCwd[p.cwd]) {
      byCwd[p.cwd] = makeSession(p);
    }
    let next = openCwds;
    if (!openCwds.includes(p.cwd)) {
      next = [...openCwds, p.cwd];
      persistOpen(next);
    }
    set({ byCwd: { ...byCwd }, openCwds: next, activeCwd: p.cwd });
  },
  closeProject: (cwd) => {
    const { openCwds, byCwd, activeCwd } = get();
    const next = openCwds.filter((c) => c !== cwd);
    persistOpen(next);
    const nextByCwd = { ...byCwd };
    delete nextByCwd[cwd];
    const nextActive = activeCwd === cwd ? next[next.length - 1] : activeCwd;
    set({ openCwds: next, byCwd: nextByCwd, activeCwd: nextActive });
  },
  setActiveCwd: (activeCwd) => set({ activeCwd }),
  patchProject: (cwd, patch) => {
    const { byCwd } = get();
    const cur = byCwd[cwd];
    if (!cur) return;
    if (patch.sessionId !== undefined) updateSessionInLS(cwd, patch.sessionId);
    set({ byCwd: { ...byCwd, [cwd]: { ...cur, ...patch } } });
  },
  appendMessage: (cwd, raw) => {
    const { byCwd } = get();
    const cur = byCwd[cwd];
    if (!cur) return;
    set({
      byCwd: {
        ...byCwd,
        [cwd]: { ...cur, messages: [...cur.messages, { id: `m${++msgId}`, raw }] },
      },
    });
  },
  clearMessages: (cwd) => {
    const { byCwd } = get();
    const cur = byCwd[cwd];
    if (!cur) return;
    set({ byCwd: { ...byCwd, [cwd]: { ...cur, messages: [] } } });
  },
  resetSession: (cwd) => {
    const { byCwd } = get();
    const cur = byCwd[cwd];
    if (!cur) return;
    updateSessionInLS(cwd, undefined);
    set({
      byCwd: { ...byCwd, [cwd]: { ...cur, messages: [], sessionId: undefined } },
    });
  },
  ensureOpenAndActive: (p) => get().openProject(p),

  connected: false,
  setConnected: (connected) => set({ connected }),

  pendingPermission: undefined,
  setPendingPermission: (pendingPermission) => set({ pendingPermission }),

  voiceCleanupEnabled: (() => {
    try {
      const v = localStorage.getItem(LS_VOICE_CLEANUP);
      return v === null ? true : v === "1";
    } catch { return true; }
  })(),
  setVoiceCleanupEnabled: (b) => {
    try { localStorage.setItem(LS_VOICE_CLEANUP, b ? "1" : "0"); } catch { /* ignore */ }
    set({ voiceCleanupEnabled: b });
  },
}));

// derived selector helpers
export function useActiveSession(): ProjectSession | undefined {
  return useStore((s) => (s.activeCwd ? s.byCwd[s.activeCwd] : undefined));
}
