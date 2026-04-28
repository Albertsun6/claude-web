import type { ClientMessage, ImageAttachment, ServerMessage } from "@claude-web/shared";
import { useStore } from "./store";
import { withAuthQuery } from "./auth";

const RAW_WS_URL =
  import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;

let ws: WebSocket | undefined;
let reconnectTimer: number | undefined;

// Voice integration — App registers a sink that receives streamed assistant text.
type VoiceSink = {
  feedAssistantChunk: (text: string) => void;
  flushAssistantBuffer: () => void;
  /** Optional: re-arm continuous mic after a turn ends (conversation mode). */
  resumeConversation?: () => void;
};
let voiceSink: VoiceSink | undefined;
export function setVoiceSink(sink: VoiceSink | undefined): void {
  voiceSink = sink;
}

// runId → cwd mapping (one in-flight prompt per cwd; runIds are unique)
const runToCwd = new Map<string, string>();

function genRunId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function connect(): void {
  if (ws && ws.readyState !== WebSocket.CLOSED) return;
  ws = new WebSocket(withAuthQuery(RAW_WS_URL));

  ws.onopen = () => {
    console.log("[ws] connected");
    useStore.getState().setConnected(true);
  };

  ws.onclose = () => {
    console.log("[ws] disconnected");
    useStore.getState().setConnected(false);
    const { byCwd, patchProject } = useStore.getState();
    for (const cwd of Object.keys(byCwd)) {
      if (byCwd[cwd]!.busy) patchProject(cwd, { busy: false, currentRunId: undefined });
    }
    runToCwd.clear();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, 2000);
  };

  ws.onerror = (e) => console.error("[ws] error", e);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as ServerMessage;
    handleServerMessage(msg);
  };
}

function handleServerMessage(msg: ServerMessage): void {
  const store = useStore.getState();

  if (msg.type === "sdk_message") {
    const cwd = runToCwd.get(msg.runId);
    if (!cwd) return;
    const sdkMsg = msg.message as any;
    // ignore partial-token chunks (we render complete assistant messages instead)
    if (sdkMsg?.type === "stream_event") return;
    // capture subscription bucket info — show in StatusBar / /usage
    if (sdkMsg?.type === "rate_limit_event" && sdkMsg.rate_limit_info) {
      const i = sdkMsg.rate_limit_info;
      store.setRateLimit({
        status: i.status,
        rateLimitType: i.rateLimitType,
        resetsAt: i.resetsAt,
        overageStatus: i.overageStatus,
        isUsingOverage: i.isUsingOverage,
      });
      return;
    }
    if (sdkMsg?.type === "system" && sdkMsg.subtype === "init" && sdkMsg.session_id) {
      store.patchProject(cwd, { sessionId: sdkMsg.session_id });
    }
    if (sdkMsg?.type === "system" && sdkMsg.subtype === "stale_session_recovered") {
      store.patchProject(cwd, { sessionId: undefined });
      return;
    }
    // accumulate token usage from result events
    if (sdkMsg?.type === "result" && sdkMsg.usage) {
      store.addUsage(cwd, sdkMsg);
    }
    if (
      voiceSink &&
      cwd === store.activeCwd &&
      sdkMsg?.type === "assistant" &&
      sdkMsg.message?.content
    ) {
      for (const block of sdkMsg.message.content) {
        if (block?.type === "text" && typeof block.text === "string") {
          voiceSink.feedAssistantChunk(block.text);
        }
      }
    }
    // Tag the message with its runId so we can selectively wipe it on stale-session restart.
    store.appendMessage(cwd, { ...sdkMsg, _runId: msg.runId });
    return;
  }

  if (msg.type === "permission_request") {
    // Auto-allow if user opted in for this run+tool, OR for this project+tool.
    const cwd = runToCwd.get(msg.runId);
    if (store.isToolAllowedForRun(msg.runId, msg.toolName)
      || (cwd && store.isToolAllowedForProject(cwd, msg.toolName))) {
      send({ type: "permission_reply", requestId: msg.requestId, decision: "allow", runId: msg.runId });
      return;
    }
    store.setPendingPermission({
      runId: msg.runId,
      requestId: msg.requestId,
      toolName: msg.toolName,
      input: msg.input,
    });
    return;
  }

  if (msg.type === "clear_run_messages") {
    const cwd = runToCwd.get(msg.runId);
    if (cwd) store.removeRunMessages(cwd, msg.runId);
    return;
  }

  if (msg.type === "error") {
    const cwd = msg.runId ? runToCwd.get(msg.runId) : undefined;
    if (cwd) {
      store.appendMessage(cwd, { type: "_error", error: msg.error, _runId: msg.runId });
    }
    return;
  }

  if (msg.type === "session_ended") {
    const cwd = runToCwd.get(msg.runId);
    runToCwd.delete(msg.runId);
    store.forgetRunAllowlist(msg.runId);
    if (cwd) {
      const sess = store.byCwd[cwd];
      if (sess && sess.currentRunId === msg.runId) {
        store.patchProject(cwd, { busy: false, currentRunId: undefined });
      }
      if (cwd === store.activeCwd) {
        voiceSink?.flushAssistantBuffer();
        // give summary fetch+playback a head start, then re-arm conversation mic
        if (voiceSink?.resumeConversation) {
          setTimeout(() => voiceSink?.resumeConversation?.(), 1500);
        }
      }
    }
    return;
  }
}

function send(msg: ClientMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("[ws] not open, dropping message", msg);
    return;
  }
  ws.send(JSON.stringify(msg));
}

export function sendPrompt(prompt: string, attachments?: ImageAttachment[]): void {
  const s = useStore.getState();
  const cwd = s.activeCwd;
  if (!cwd) {
    alert("请先打开一个项目");
    return;
  }
  const sess = s.byCwd[cwd];
  if (!sess) return;
  if (sess.busy) {
    alert("当前项目还在执行，请等完成或先停止");
    return;
  }
  const runId = genRunId();
  runToCwd.set(runId, cwd);
  s.patchProject(cwd, { busy: true, currentRunId: runId });
  s.appendMessage(cwd, {
    type: "_user_input",
    text: prompt,
    _runId: runId,
    attachments: attachments?.map((a) => ({ mediaType: a.mediaType, dataBase64: a.dataBase64 })),
  });
  send({
    type: "user_prompt",
    runId,
    prompt,
    cwd,
    model: s.model,
    permissionMode: s.permissionMode,
    resumeSessionId: sess.sessionId,
    attachments,
  });
}

export function replyPermission(
  requestId: string,
  decision: "allow" | "deny",
  runId?: string,
): void {
  send({ type: "permission_reply", requestId, decision, runId });
  useStore.getState().setPendingPermission(undefined);
}

export function interrupt(runId?: string): void {
  send({ type: "interrupt", runId });
}

/** Force reconnect — used after token change so new auth takes effect. */
export function reconnect(): void {
  if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
}
