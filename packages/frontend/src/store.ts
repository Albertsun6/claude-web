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

interface AppState {
  // config
  cwd: string;
  model: ModelId;
  permissionMode: PermissionMode;
  setCwd: (v: string) => void;
  setModel: (v: ModelId) => void;
  setPermissionMode: (v: PermissionMode) => void;

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
}

const LS_KEY = "claude-web:config";
const persisted = (() => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
})();

const persist = (s: Partial<AppState>) => {
  const cur = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...s }));
};

let msgId = 0;

export const useStore = create<AppState>((set) => ({
  cwd: persisted.cwd ?? "",
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

  sessionId: persisted.sessionId,
  setSessionId: (sessionId) => {
    persist({ sessionId });
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
}));
