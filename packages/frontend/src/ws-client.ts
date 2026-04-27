import type { ClientMessage, ServerMessage } from "@claude-web/shared";
import { useStore } from "./store";

const WS_URL =
  import.meta.env.VITE_WS_URL ?? `ws://${window.location.hostname}:3030/ws`;

let ws: WebSocket | undefined;
let reconnectTimer: number | undefined;

// Voice integration — App registers a sink that receives streamed assistant text.
type VoiceSink = {
  feedAssistantChunk: (text: string) => void;
  flushAssistantBuffer: () => void;
};
let voiceSink: VoiceSink | undefined;
export function setVoiceSink(sink: VoiceSink | undefined): void {
  voiceSink = sink;
}

export function connect(): void {
  if (ws && ws.readyState !== WebSocket.CLOSED) return;
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[ws] connected");
    useStore.getState().setConnected(true);
  };

  ws.onclose = () => {
    console.log("[ws] disconnected");
    useStore.getState().setConnected(false);
    useStore.getState().setBusy(false);
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
    const sdkMsg = msg.message as any;
    // capture sessionId from system:init
    if (sdkMsg?.type === "system" && sdkMsg.subtype === "init" && sdkMsg.session_id) {
      store.setSessionId(sdkMsg.session_id);
    }
    // feed assistant text chunks to voice sink for streaming TTS
    if (voiceSink && sdkMsg?.type === "assistant" && sdkMsg.message?.content) {
      for (const block of sdkMsg.message.content) {
        if (block?.type === "text" && typeof block.text === "string") {
          voiceSink.feedAssistantChunk(block.text);
        }
      }
    }
    store.addMessage(sdkMsg);
    return;
  }

  if (msg.type === "permission_request") {
    store.setPendingPermission({
      requestId: msg.requestId,
      toolName: msg.toolName,
      input: msg.input,
    });
    return;
  }

  if (msg.type === "error") {
    store.addMessage({ type: "_error", error: msg.error });
    store.setBusy(false);
    return;
  }

  if (msg.type === "session_ended") {
    voiceSink?.flushAssistantBuffer();
    store.setBusy(false);
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

export function sendPrompt(prompt: string): void {
  const s = useStore.getState();
  if (!s.cwd.trim()) {
    alert("请先在左侧填写工作目录");
    return;
  }
  s.setBusy(true);
  s.addMessage({ type: "_user_input", text: prompt });
  send({
    type: "user_prompt",
    prompt,
    cwd: s.cwd,
    model: s.model,
    permissionMode: s.permissionMode,
    resumeSessionId: s.sessionId,
  });
}

export function replyPermission(requestId: string, decision: "allow" | "deny"): void {
  send({ type: "permission_reply", requestId, decision });
  useStore.getState().setPendingPermission(undefined);
}

export function interrupt(): void {
  send({ type: "interrupt" });
}
