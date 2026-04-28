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
import { UsageMeter } from "./components/UsageMeter";
import { ClaudeMdBanner } from "./components/ClaudeMdBanner";
import { StatusBar } from "./components/StatusBar";
import { FilePreviewPane } from "./components/FilePreviewPane";
import { Resizer } from "./components/Resizer";
import { CallMode } from "./components/CallMode";
import { VoiceProvider, useVoiceCtx } from "./hooks/VoiceContext";
import { useWakeLock } from "./hooks/useWakeLock";

// Heavy: CodeMirror is ~250KB. Lazy-load when files panel actually opens.
const FilesPanel = lazy(() => import("./components/FilesPanel").then((m) => ({ default: m.FilesPanel })));
const GitPanel = lazy(() => import("./components/GitPanel").then((m) => ({ default: m.GitPanel })));

const PanelFallback = () => (
  <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>加载中…</div>
);

type DrawerSide = "left" | "right" | null;

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
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const rightbarWidth = useStore((s) => s.rightbarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const setRightbarWidth = useStore((s) => s.setRightbarWidth);
  const rightTab = useStore((s) => s.rightTab);
  const setRightTab = useStore((s) => s.setRightTab);
  const [drawer, setDrawer] = useState<DrawerSide>(null);
  const [callMode, setCallMode] = useState(false);
  const voice = useVoiceCtx();
  // keep screen awake during a hands-free conversation
  useWakeLock(voice.conversationMode || callMode);

  useEffect(() => {
    connect();
  }, []);

  useEffect(() => {
    setVoiceSink({
      feedAssistantChunk: voice.feedAssistantChunk,
      flushAssistantBuffer: voice.flushAssistantBuffer,
      resumeConversation: voice.resumeConversation,
    });
    return () => setVoiceSink(undefined);
  }, [voice.feedAssistantChunk, voice.flushAssistantBuffer, voice.resumeConversation]);

  // Mirror live convo transcript into the active project's voiceDraft so the
  // input box shows it in real time. Cleared when convo stops or after submit.
  useEffect(() => {
    if (!session) return;
    if (!voice.conversationMode) return;
    const live = voice.liveTranscript;
    if (live && session.voiceDraft?.status !== "pending" && session.voiceDraft?.status !== "ready") {
      patchProject(session.cwd, {
        voiceDraft: { original: live, cleaned: live, status: "live" },
      });
    } else if (!live && session.voiceDraft?.status === "live") {
      patchProject(session.cwd, { voiceDraft: undefined });
    }
  }, [voice.liveTranscript, voice.conversationMode, session?.cwd]);

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
    // In conversation mode, "发送" is the explicit submit gesture — don't make
    // the user click again. Bypass cleanup so the prompt fires immediately.
    if (voice.conversationMode) {
      patchProject(session.cwd, { voiceDraft: undefined });
      sendPrompt(text);
      return;
    }
    if (!cleanupEnabled) {
      sendPrompt(text);
      return;
    }
    // Smart-skip: short or visually-clean transcripts don't need a Haiku roundtrip.
    // Heuristic: ≤ 12 chars OR no obvious filler words.
    const FILLER = /嗯+|啊+|那个那个|就是就是|就是说|呢这个|呃+|额+|那么那么/;
    if (text.length <= 12 || !FILLER.test(text)) {
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
            <UsageMeter />
          </div>
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
    <div
      className="app"
      style={{
        ["--sidebar-w" as any]: `${sidebarWidth}px`,
        ["--rightbar-w" as any]: `${rightbarWidth}px`,
      }}
    >
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
      <Resizer side="left" initial={sidebarWidth} min={220} max={520} onChange={setSidebarWidth} />

      <main className="main">
        <ProjectTabs />
        <ClaudeMdBanner />
        <MessageStream />
        <InputBox />
        <StatusBar />
        <FilePreviewPane />
      </main>

      <Resizer side="right" initial={rightbarWidth} min={240} max={720} onChange={setRightbarWidth} />
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
      <CallMode active={callMode} onClose={() => setCallMode(false)} />

      {/* Floating hands-free trigger — visible only when convo mode is on */}
      {voice.conversationMode && !callMode && (
        <button
          className="callmode-trigger"
          onClick={() => setCallMode(true)}
          title="进入通话模式（全屏）"
          aria-label="进入通话模式"
        >
          📞
        </button>
      )}
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
