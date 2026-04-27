import { useEffect, useState } from "react";
import { useStore } from "./store";
import { connect, sendPrompt, setVoiceSink } from "./ws-client";
import { ConfigPanel } from "./components/ConfigPanel";
import { ProjectPicker } from "./components/ProjectPicker";
import { MessageStream } from "./components/MessageStream";
import { InputBox } from "./components/InputBox";
import { PermissionModal } from "./components/PermissionModal";
import { VoiceBar } from "./components/VoiceBar";
import { FilesPanel } from "./components/FilesPanel";
import { GitPanel } from "./components/GitPanel";
import { VoiceProvider, useVoiceCtx } from "./hooks/VoiceContext";

type DrawerSide = "left" | "right" | null;
type RightTab = "files" | "git";

function AppInner() {
  const connected = useStore((s) => s.connected);
  const sessionId = useStore((s) => s.sessionId);
  const setSessionId = useStore((s) => s.setSessionId);
  const clearMessages = useStore((s) => s.clearMessages);
  const [drawer, setDrawer] = useState<DrawerSide>(null);
  const [rightTab, setRightTab] = useState<RightTab>("files");
  const voice = useVoiceCtx();

  useEffect(() => {
    connect();
  }, []);

  // wire voice to streamed assistant text
  useEffect(() => {
    setVoiceSink({
      feedAssistantChunk: voice.feedAssistantChunk,
      flushAssistantBuffer: voice.flushAssistantBuffer,
    });
    return () => setVoiceSink(undefined);
  }, [voice.feedAssistantChunk, voice.flushAssistantBuffer]);

  // visualViewport: keep input above mobile keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      document.body.style.setProperty("--keyboard-inset", `${Math.max(0, inset)}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  const cleanupEnabled = useStore((s) => s.voiceCleanupEnabled);
  const setVoiceDraft = useStore((s) => s.setVoiceDraft);

  const handleVoiceTranscript = async (text: string) => {
    voice.cancelSpeak();
    if (!cleanupEnabled) {
      sendPrompt(text);
      return;
    }
    setVoiceDraft({ original: text, cleaned: text, status: "pending" });
    try {
      const apiBase =
        (import.meta as any).env?.VITE_API_URL ??
        `http://${window.location.hostname}:3030`;
      const res = await fetch(`${apiBase}/api/voice/cleanup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body: { original?: string; cleaned?: string; fallback?: boolean } = await res.json();
      const cleaned = body.cleaned?.trim() || text;
      setVoiceDraft({
        original: text,
        cleaned,
        status: body.fallback ? "failed" : "ready",
      });
    } catch (err) {
      console.warn("[voice] cleanup failed", err);
      setVoiceDraft({ original: text, cleaned: text, status: "failed" });
    }
  };

  const sidebar = (
    <>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>claude-web</h2>
      <div className={`connection-status ${connected ? "connected" : "disconnected"}`}>
        {connected ? "● connected" : "● disconnected"}
      </div>

      <div style={{ marginTop: 16 }}>
        <ProjectPicker />
      </div>

      <div style={{ marginTop: 16 }}>
        <ConfigPanel />
      </div>

      <div style={{ marginTop: 16 }}>
        <VoiceBar onTranscript={handleVoiceTranscript} />
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-dim)" }}>
        <div>
          <b>session:</b>{" "}
          {sessionId ? <code style={{ fontSize: 10 }}>{sessionId.slice(0, 8)}…</code> : "(new)"}
        </div>
        <button
          className="secondary"
          style={{ marginTop: 8, fontSize: 11, padding: "4px 8px" }}
          onClick={() => {
            setSessionId(undefined);
            clearMessages();
          }}
        >
          new session
        </button>
      </div>
    </>
  );

  const rightPanel = (
    <div className="rightbar-inner">
      <div className="rightbar-tabs">
        <button
          className={`rightbar-tab ${rightTab === "files" ? "active" : ""}`}
          onClick={() => setRightTab("files")}
        >
          📁 文件
        </button>
        <button
          className={`rightbar-tab ${rightTab === "git" ? "active" : ""}`}
          onClick={() => setRightTab("git")}
        >
          ⎇ Git
        </button>
      </div>
      <div className="rightbar-body">
        {rightTab === "files" ? <FilesPanel /> : <GitPanel />}
      </div>
    </div>
  );

  return (
    <div className="app">
      <div className="topbar">
        <button className="icon-btn" onClick={() => setDrawer(drawer === "left" ? null : "left")} aria-label="menu">
          ☰
        </button>
        <div className="topbar-title">claude-web</div>
        <button className="icon-btn" onClick={() => setDrawer(drawer === "right" ? null : "right")} aria-label="files">
          📁
        </button>
      </div>

      <aside className="sidebar">{sidebar}</aside>

      <main className="main">
        <MessageStream />
        <InputBox />
      </main>

      <aside className="rightbar">{rightPanel}</aside>

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <div
            className={`drawer drawer-${drawer}`}
            onClick={(e) => e.stopPropagation()}
          >
            {drawer === "left" ? sidebar : rightPanel}
          </div>
        </div>
      )}

      <PermissionModal />
    </div>
  );
}

export function App() {
  return (
    <VoiceProvider>
      <AppInner />
    </VoiceProvider>
  );
}
