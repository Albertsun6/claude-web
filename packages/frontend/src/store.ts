import { create } from "zustand";
import type { ModelId, PermissionMode } from "@claude-web/shared";

export interface RenderedMessage {
  id: string;
  raw: any;
}

export interface PermissionRequest {
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

interface AppState {
  // config
  cwd: string;
  model: ModelId;
  permissionMode: PermissionMode;
  setCwd: (v: string) => void;
  setModel: (v: ModelId) => void;
  setPermissionMode: (v: PermissionMode) => void;

  // projects
  projects: Project[];
  addProject: (p: Project) => void;
  removeProject: (cwd: string) => void;
  switchToProject: (cwd: string) => void;

  // session
  sessionId: string | undefined;
  setSessionId: (id: string | undefined) => void;

  // ws state
  connected: boolean;
  setConnected: (v: boolean) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;

  // messages
  messages: RenderedMessage[];
  addMessage: (raw: any) => void;
  clearMessages: () => void;

  // permission
  pendingPermission: PermissionRequest | undefined;
  setPendingPermission: (p: PermissionRequest | undefined) => void;

  // voice draft (raw → cleanup preview before send)
  voiceDraft: VoiceDraft | undefined;
  setVoiceDraft: (v: VoiceDraft | undefined) => void;
  voiceCleanupEnabled: boolean;
  setVoiceCleanupEnabled: (b: boolean) => void;
}

const LS_KEY = "claude-web:config";
const LS_PROJECTS = "claude-web:projects";
const LS_SESSIONS = "claude-web:sessions"; // { [cwd]: sessionId }

const persisted = (() => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
})();

const persistedProjects: Project[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(LS_PROJECTS) ?? "[]");
  } catch {
    return [];
  }
})();

const persistedSessions: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(LS_SESSIONS) ?? "{}");
  } catch {
    return {};
  }
})();

const persist = (s: Partial<AppState>) => {
  const cur = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...s }));
};

const persistProjects = (projects: Project[]) =>
  localStorage.setItem(LS_PROJECTS, JSON.stringify(projects));

const persistSessions = (sessions: Record<string, string>) =>
  localStorage.setItem(LS_SESSIONS, JSON.stringify(sessions));

let msgId = 0;

const initialCwd: string = persisted.cwd ?? "";
const initialSessionId: string | undefined =
  initialCwd && persistedSessions[initialCwd] ? persistedSessions[initialCwd] : persisted.sessionId;

export const useStore = create<AppState>((set, get) => ({
  cwd: initialCwd,
  model: persisted.model ?? "claude-sonnet-4-6",
  permissionMode: persisted.permissionMode ?? "default",
  setCwd: (cwd) => {
    persist({ cwd });
    set({ cwd });
  },
  setModel: (model) => {
    persist({ model });
    set({ model });
  },
  setPermissionMode: (permissionMode) => {
    persist({ permissionMode });
    set({ permissionMode });
  },

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
    const sessions = { ...persistedSessions };
    delete sessions[cwd];
    persistSessions(sessions);
    set({ projects: next });
  },
  switchToProject: (cwd) => {
    const sessions: Record<string, string> = JSON.parse(
      localStorage.getItem(LS_SESSIONS) ?? "{}",
    );
    const sessionId = sessions[cwd];
    persist({ cwd });
    set({ cwd, sessionId, messages: [] });
  },

  sessionId: initialSessionId,
  setSessionId: (sessionId) => {
    persist({ sessionId });
    const cwd = get().cwd;
    if (cwd) {
      const sessions: Record<string, string> = JSON.parse(
        localStorage.getItem(LS_SESSIONS) ?? "{}",
      );
      if (sessionId) sessions[cwd] = sessionId;
      else delete sessions[cwd];
      persistSessions(sessions);
    }
    set({ sessionId });
  },

  connected: false,
  setConnected: (connected) => set({ connected }),
  busy: false,
  setBusy: (busy) => set({ busy }),

  messages: [],
  addMessage: (raw) =>
    set((s) => ({ messages: [...s.messages, { id: `m${++msgId}`, raw }] })),
  clearMessages: () => set({ messages: [] }),

  pendingPermission: undefined,
  setPendingPermission: (pendingPermission) => set({ pendingPermission }),

  voiceDraft: undefined,
  setVoiceDraft: (voiceDraft) => set({ voiceDraft }),
  voiceCleanupEnabled: (() => {
    try {
      const v = localStorage.getItem("claude-web:voice-cleanup");
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  })(),
  setVoiceCleanupEnabled: (b) => {
    try { localStorage.setItem("claude-web:voice-cleanup", b ? "1" : "0"); } catch { /* ignore */ }
    set({ voiceCleanupEnabled: b });
  },
}));
