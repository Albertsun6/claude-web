import { useEffect, useState } from "react";
import { useStore } from "./store";
import { connect } from "./ws-client";
import { ConfigPanel } from "./components/ConfigPanel";
import { MessageStream } from "./components/MessageStream";
import { InputBox } from "./components/InputBox";
import { PermissionModal } from "./components/PermissionModal";

type DrawerSide = "left" | "right" | null;

export function App() {
  const connected = useStore((s) => s.connected);
  const sessionId = useStore((s) => s.sessionId);
  const setSessionId = useStore((s) => s.setSessionId);
  const clearMessages = useStore((s) => s.clearMessages);
  const [drawer, setDrawer] = useState<DrawerSide>(null);

  useEffect(() => {
    connect();
  }, []);

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

  const sidebar = (
    <>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>claude-web</h2>
      <div className={`connection-status ${connected ? "connected" : "disconnected"}`}>
        {connected ? "● connected" : "● disconnected"}
      </div>

      <div style={{ marginTop: 16 }}>
        <ConfigPanel />
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

      <aside className="rightbar">
        <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>
          (files / git panel — populated in later phases)
        </div>
      </aside>

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <div
            className={`drawer drawer-${drawer}`}
            onClick={(e) => e.stopPropagation()}
          >
            {drawer === "left" ? sidebar : (
              <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>
                (files / git panel — populated in later phases)
              </div>
            )}
          </div>
        </div>
      )}

      <PermissionModal />
    </div>
  );
}
