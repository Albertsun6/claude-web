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
  status: "live" | "pending" | "ready" | "failed";
}

export interface UsageStats {
  inputTokens: number;       // brand-new tokens this session paid for
  cacheCreationTokens: number; // tokens written into cache (one-time cost)
  cacheReadTokens: number;   // cache hits (≈ free)
  outputTokens: number;
  costUsd: number;           // nominal — not actually billed under subscription
  turns: number;
}

export interface ProjectSession {
  cwd: string;
  name: string;
  sessionId?: string;
  messages: RenderedMessage[];
  busy: boolean;
  currentRunId?: string;
  voiceDraft?: VoiceDraft;
  usage?: UsageStats;
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
  /** Replace all messages in one shot (used when loading a transcript). */
  replaceMessages: (cwd: string, list: any[]) => void;
  clearMessages: (cwd: string) => void;
  /** Drop messages whose `_runId` matches; used on stale-session restart. */
  removeRunMessages: (cwd: string, runId: string) => void;
  resetSession: (cwd: string) => void; // clear messages + sessionId + usage
  /** Accumulate token usage from a `type:"result"` SDK message. */
  addUsage: (cwd: string, result: unknown) => void;
  // helper: ensure cwd is open and active (used when adding a new project on the fly)
  ensureOpenAndActive: (project: Project) => void;

  // ws state
  connected: boolean;
  setConnected: (v: boolean) => void;

  // permission (one modal global)
  pendingPermission: PermissionRequest | undefined;
  setPendingPermission: (p: PermissionRequest | undefined) => void;
  // per-run "always allow" tools — cleared when run ends
  allowedToolsByRun: Record<string, Set<string>>;
  allowToolForRun: (runId: string, toolName: string) => void;
  isToolAllowedForRun: (runId: string, toolName: string) => boolean;
  forgetRunAllowlist: (runId: string) => void;
  // per-project persistent always-allow (survives reloads)
  allowedToolsByCwd: Record<string, string[]>;
  allowToolForProject: (cwd: string, toolName: string) => void;
  revokeToolForProject: (cwd: string, toolName: string) => void;
  isToolAllowedForProject: (cwd: string, toolName: string) => boolean;

  // voice cleanup pref
  voiceCleanupEnabled: boolean;
  setVoiceCleanupEnabled: (b: boolean) => void;

  // history-session list expanded?
  sessionListOpen: boolean;
  setSessionListOpen: (b: boolean) => void;

  // currently-previewed file (overlay in main column)
  previewFile: { cwd: string; relPath: string } | undefined;
  setPreviewFile: (p: { cwd: string; relPath: string } | undefined) => void;

  // panel layout (px) — persisted
  sidebarWidth: number;
  rightbarWidth: number;
  setSidebarWidth: (w: number) => void;
  setRightbarWidth: (w: number) => void;

  // which right-panel tab (files / git)
  rightTab: "files" | "git";
  setRightTab: (t: "files" | "git") => void;

  // latest rate-limit info from CLI (subscription bucket)
  rateLimit?: {
    status: string;
    rateLimitType: string;
    resetsAt: number; // unix seconds
    overageStatus?: string;
    isUsingOverage?: boolean;
  };
  setRateLimit: (r: AppState["rateLimit"]) => void;
}

const LS_CONFIG = "claude-web:config";
const LS_PROJECTS = "claude-web:projects";
const LS_SESSIONS = "claude-web:sessions";
const LS_TOOLS_BY_CWD = "claude-web:allowed-tools-by-cwd";
const LS_LAYOUT = "claude-web:layout";
const LS_RIGHT_TAB = "claude-web:right-tab";
const LS_OPEN = "claude-web:open-cwds";
const LS_VOICE_CLEANUP = "claude-web:voice-cleanup";
const LS_SESSION_LIST_OPEN = "claude-web:session-list-open";

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
const persistedAllowedTools: Record<string, string[]> = (() => {
  try { return JSON.parse(localStorage.getItem(LS_TOOLS_BY_CWD) ?? "{}"); } catch { return {}; }
})();
const persistedLayout: { sidebarWidth?: number; rightbarWidth?: number } = (() => {
  try { return JSON.parse(localStorage.getItem(LS_LAYOUT) ?? "{}"); } catch { return {}; }
})();
const persistedRightTab: "files" | "git" = (() => {
  try {
    const v = localStorage.getItem(LS_RIGHT_TAB);
    return v === "git" ? "git" : "files";
  } catch { return "files"; }
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
  model: persistedConfig.model ?? "claude-haiku-4-5",
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
  replaceMessages: (cwd, list) => {
    const { byCwd } = get();
    const cur = byCwd[cwd];
    if (!cur) return;
    const messages: RenderedMessage[] = list.map((raw) => ({ id: `m${++msgId}`, raw }));
    set({ byCwd: { ...byCwd, [cwd]: { ...cur, messages } } });
  },
  clearMessages: (cwd) => {
    const { byCwd } = get();
    const cur = byCwd[cwd];
    if (!cur) return;
    set({ byCwd: { ...byCwd, [cwd]: { ...cur, messages: [] } } });
  },
  removeRunMessages: (cwd, runId) => {
    const { byCwd } = get();
    const cur = byCwd[cwd];
    if (!cur) return;
    const filtered = cur.messages.filter((m) => m.raw?._runId !== runId);
    if (filtered.length === cur.messages.length) return;
    set({ byCwd: { ...byCwd, [cwd]: { ...cur, messages: filtered } } });
  },
  resetSession: (cwd) => {
    const { byCwd } = get();
    const cur = byCwd[cwd];
    if (!cur) return;
    updateSessionInLS(cwd, undefined);
    set({
      byCwd: { ...byCwd, [cwd]: { ...cur, messages: [], sessionId: undefined, usage: undefined } },
    });
  },
  addUsage: (cwd, result) => {
    const { byCwd } = get();
    const cur = byCwd[cwd];
    if (!cur) return;
    // result message shape: { type: "result", usage, total_cost_usd, num_turns }
    const u: any = (result as any)?.usage ?? {};
    const cur_u: UsageStats = cur.usage ?? {
      inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
      outputTokens: 0, costUsd: 0, turns: 0,
    };
    const next: UsageStats = {
      inputTokens: cur_u.inputTokens + (u.input_tokens ?? 0),
      cacheCreationTokens: cur_u.cacheCreationTokens + (u.cache_creation_input_tokens ?? 0),
      cacheReadTokens: cur_u.cacheReadTokens + (u.cache_read_input_tokens ?? 0),
      outputTokens: cur_u.outputTokens + (u.output_tokens ?? 0),
      costUsd: cur_u.costUsd + ((result as any)?.total_cost_usd ?? 0),
      turns: cur_u.turns + ((result as any)?.num_turns ?? 1),
    };
    set({ byCwd: { ...byCwd, [cwd]: { ...cur, usage: next } } });
  },
  ensureOpenAndActive: (p) => get().openProject(p),

  connected: false,
  setConnected: (connected) => set({ connected }),

  pendingPermission: undefined,
  setPendingPermission: (pendingPermission) => set({ pendingPermission }),

  allowedToolsByRun: {},
  allowToolForRun: (runId, toolName) => {
    const cur = get().allowedToolsByRun;
    const set0 = new Set(cur[runId] ?? []);
    set0.add(toolName);
    set({ allowedToolsByRun: { ...cur, [runId]: set0 } });
  },
  isToolAllowedForRun: (runId, toolName) =>
    !!get().allowedToolsByRun[runId]?.has(toolName),
  forgetRunAllowlist: (runId) => {
    const cur = get().allowedToolsByRun;
    if (!(runId in cur)) return;
    const next = { ...cur };
    delete next[runId];
    set({ allowedToolsByRun: next });
  },

  allowedToolsByCwd: persistedAllowedTools,
  allowToolForProject: (cwd, toolName) => {
    const cur = get().allowedToolsByCwd;
    const list = cur[cwd] ?? [];
    if (list.includes(toolName)) return;
    const next = { ...cur, [cwd]: [...list, toolName] };
    try { localStorage.setItem(LS_TOOLS_BY_CWD, JSON.stringify(next)); } catch { /* ignore */ }
    set({ allowedToolsByCwd: next });
  },
  revokeToolForProject: (cwd, toolName) => {
    const cur = get().allowedToolsByCwd;
    const list = cur[cwd];
    if (!list || !list.includes(toolName)) return;
    const next = { ...cur, [cwd]: list.filter((t) => t !== toolName) };
    try { localStorage.setItem(LS_TOOLS_BY_CWD, JSON.stringify(next)); } catch { /* ignore */ }
    set({ allowedToolsByCwd: next });
  },
  isToolAllowedForProject: (cwd, toolName) =>
    !!get().allowedToolsByCwd[cwd]?.includes(toolName),

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

  sessionListOpen: (() => {
    try {
      const v = localStorage.getItem(LS_SESSION_LIST_OPEN);
      return v === null ? true : v === "1";
    } catch { return true; }
  })(),
  setSessionListOpen: (b) => {
    try { localStorage.setItem(LS_SESSION_LIST_OPEN, b ? "1" : "0"); } catch { /* ignore */ }
    set({ sessionListOpen: b });
  },

  previewFile: undefined,
  setPreviewFile: (p) => set({ previewFile: p }),

  sidebarWidth: persistedLayout.sidebarWidth ?? 280,
  rightbarWidth: persistedLayout.rightbarWidth ?? 320,
  setSidebarWidth: (sidebarWidth) => {
    const cur = get();
    try {
      localStorage.setItem(LS_LAYOUT, JSON.stringify({
        sidebarWidth, rightbarWidth: cur.rightbarWidth,
      }));
    } catch { /* ignore */ }
    set({ sidebarWidth });
  },
  setRightbarWidth: (rightbarWidth) => {
    const cur = get();
    try {
      localStorage.setItem(LS_LAYOUT, JSON.stringify({
        sidebarWidth: cur.sidebarWidth, rightbarWidth,
      }));
    } catch { /* ignore */ }
    set({ rightbarWidth });
  },

  rightTab: persistedRightTab,
  setRightTab: (rightTab) => {
    try { localStorage.setItem(LS_RIGHT_TAB, rightTab); } catch { /* ignore */ }
    set({ rightTab });
  },

  rateLimit: undefined,
  setRateLimit: (rateLimit) => set({ rateLimit }),
}));

// derived selector helpers
export function useActiveSession(): ProjectSession | undefined {
  return useStore((s) => (s.activeCwd ? s.byCwd[s.activeCwd] : undefined));
}
