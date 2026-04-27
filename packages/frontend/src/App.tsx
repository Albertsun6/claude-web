import { useEffect } from "react";
import { useStore } from "./store";
import { connect } from "./ws-client";
import { ConfigPanel } from "./components/ConfigPanel";
import { MessageStream } from "./components/MessageStream";
import { InputBox } from "./components/InputBox";
import { PermissionModal } from "./components/PermissionModal";

export function App() {
  const connected = useStore((s) => s.connected);
  const sessionId = useStore((s) => s.sessionId);
  const setSessionId = useStore((s) => s.setSessionId);
  const clearMessages = useStore((s) => s.clearMessages);

  useEffect(() => {
    connect();
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <h2 style={{ marginTop: 0, fontSize: 18 }}>claude-web</h2>
        <div
          className={`connection-status ${connected ? "connected" : "disconnected"}`}
        >
          {connected ? "● connected" : "● disconnected"}
        </div>

        <div style={{ marginTop: 16 }}>
          <ConfigPanel />
        </div>

        <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-dim)" }}>
          <div>
            <b>session:</b>{" "}
            {sessionId ? (
              <code style={{ fontSize: 10 }}>{sessionId.slice(0, 8)}…</code>
            ) : (
              "(new)"
            )}
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
      </aside>

      <main className="main">
        <MessageStream />
        <InputBox />
      </main>

      <PermissionModal />
    </div>
  );
}
