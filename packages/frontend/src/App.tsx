import { lazy, Suspense, useEffect, useState } from "react";
import { useStore, useActiveSession } from "./store";
import { connect, sendPrompt, setVoiceSink } from "./ws-client";
import { ConfigPanel } from "./components/ConfigPanel";
import { ProjectPicker } from "./components/ProjectPicker";
import { MessageStream } from "./components/MessageStream";
import { InputBox } from "./components/InputBox";
import { PermissionModal } from "./components/PermissionModal";
import { VoiceBar } from "./components/VoiceBar";
import { OfflineBanner } from "./components/OfflineBanner";
import { SessionList } from "./components/SessionList";
import { AuthGate } from "./components/AuthGate";
import { VoiceProvider, useVoiceCtx } from "./hooks/VoiceContext";

// Heavy: CodeMirror is ~250KB. Lazy-load when files panel actually opens.
const FilesPanel = lazy(() => import("./components/FilesPanel").then((m) => ({ default: m.FilesPanel })));
const GitPanel = lazy(() => import("./components/GitPanel").then((m) => ({ default: m.GitPanel })));

const PanelFallback = () => (
  <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>加载中…</div>
);

type DrawerSide = "left" | "right" | null;
type RightTab = "files" | "git";

function ProjectTabs() {
  const openCwds = useStore((s) => s.openCwds);
  const activeCwd = useStore((s) => s.activeCwd);
  const byCwd = useStore((s) => s.byCwd);
  const setActiveCwd = useStore((s) => s.setActiveCwd);
  const closeProject = useStore((s) => s.closeProject);

  if (openCwds.length === 0) return null;

  return (
    <div className="proj-tabs">
      {openCwds.map((cwd) => {
        const sess = byCwd[cwd];
        if (!sess) return null;
        const active = cwd === activeCwd;
        return (
          <div
            key={cwd}
            className={`proj-tab ${active ? "active" : ""}`}
            onClick={() => setActiveCwd(cwd)}
            title={cwd}
          >
            <span className="proj-tab-name">{sess.name}</span>
            {sess.busy && <span className="proj-tab-busy">⏳</span>}
            <button
              className="proj-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                if (sess.busy && !confirm(`「${sess.name}」还在执行，确定关闭吗？`)) return;
                closeProject(cwd);
              }}
              aria-label="关闭"
              title="关闭"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

function AppInner() {
  const connected = useStore((s) => s.connected);
  const session = useActiveSession();
  const resetSession = useStore((s) => s.resetSession);
  const patchProject = useStore((s) => s.patchProject);
  const cleanupEnabled = useStore((s) => s.voiceCleanupEnabled);
  const [drawer, setDrawer] = useState<DrawerSide>(null);
  const [rightTab, setRightTab] = useState<RightTab>("files");
  const voice = useVoiceCtx();

  useEffect(() => {
    connect();
  }, []);

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

  const handleVoiceTranscript = async (text: string) => {
    voice.cancelSpeak();
    if (!session) return;
    if (!cleanupEnabled) {
      sendPrompt(text);
      return;
    }
    patchProject(session.cwd, {
      voiceDraft: { original: text, cleaned: text, status: "pending" },
    });
    try {
      const apiBase = (import.meta as any).env?.VITE_API_URL ?? "";
      const { authFetch } = await import("./auth");
      const res = await authFetch(`${apiBase}/api/voice/cleanup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body: { original?: string; cleaned?: string; fallback?: boolean } = await res.json();
      const cleaned = body.cleaned?.trim() || text;
      patchProject(session.cwd, {
        voiceDraft: {
          original: text,
          cleaned,
          status: body.fallback ? "failed" : "ready",
        },
      });
    } catch (err) {
      console.warn("[voice] cleanup failed", err);
      patchProject(session.cwd, {
        voiceDraft: { original: text, cleaned: text, status: "failed" },
      });
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

      {session && (
        <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-dim)" }}>
          <div>
            <b>session:</b>{" "}
            {session.sessionId
              ? <code style={{ fontSize: 10 }}>{session.sessionId.slice(0, 8)}…</code>
              : "(new)"}
          </div>
          <button
            className="secondary"
            style={{ marginTop: 8, fontSize: 11, padding: "4px 8px" }}
            onClick={() => resetSession(session.cwd)}
          >
            new session ({session.name})
          </button>
          <div style={{ marginTop: 12 }}>
            <SessionList />
          </div>
        </div>
      )}
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
        <Suspense fallback={<PanelFallback />}>
          {rightTab === "files" ? <FilesPanel /> : <GitPanel />}
        </Suspense>
      </div>
    </div>
  );

  return (
    <div className="app">
      <div className="topbar">
        <button className="icon-btn" onClick={() => setDrawer(drawer === "left" ? null : "left")} aria-label="menu">
          ☰
        </button>
        <div className="topbar-title">{session?.name ?? "claude-web"}</div>
        <button className="icon-btn" onClick={() => setDrawer(drawer === "right" ? null : "right")} aria-label="files">
          📁
        </button>
      </div>

      <aside className="sidebar">{sidebar}</aside>

      <main className="main">
        <ProjectTabs />
        <MessageStream />
        <InputBox />
      </main>

      <aside className="rightbar">{rightPanel}</aside>

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <div className={`drawer drawer-${drawer}`} onClick={(e) => e.stopPropagation()}>
            {drawer === "left" ? sidebar : rightPanel}
          </div>
        </div>
      )}

      <PermissionModal />
      <OfflineBanner />
      <AuthGate />
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
