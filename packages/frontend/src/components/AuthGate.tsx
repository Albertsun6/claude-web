// Probes /api/auth/info on mount; if backend says authRequired and we don't
// have a token (or the saved one is rejected by /health), shows a modal asking
// the user for one. After save, forces a WS reconnect so the new token kicks in.

import { useEffect, useState } from "react";
import { authFetch, getAuthToken, setAuthToken, clearAuthToken } from "../auth";
import { reconnect } from "../ws-client";

type Status = "checking" | "ok" | "needs-token" | "bad-token";

export function AuthGate() {
  const [status, setStatus] = useState<Status>("checking");
  const [authRequired, setAuthRequired] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const probe = async () => {
    try {
      const info = await fetch("/api/auth/info").then((r) => r.json());
      setAuthRequired(!!info.authRequired);
      if (!info.authRequired) {
        setStatus("ok");
        return;
      }
      // Auth required — verify our token via an authenticated probe.
      const token = getAuthToken();
      if (!token) {
        setStatus("needs-token");
        return;
      }
      const probeRes = await authFetch("/api/auth/info");
      // /api/auth/info itself is auth-protected (under /api/*); 200 = good token.
      if (probeRes.ok) {
        setStatus("ok");
      } else {
        setStatus("bad-token");
      }
    } catch (err) {
      // Network failure (e.g. Mac unreachable from iOS app) — DON'T pop the
      // token modal, that's a misleading dead end. The OfflineBanner / WS
      // reconnect already surface the connectivity issue properly.
      console.warn("[auth] probe failed, assuming no auth:", err);
      setError(err instanceof Error ? err.message : String(err));
      setStatus("ok");
    }
  };

  useEffect(() => {
    void probe();
  }, []);

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    setAuthToken(t);
    setDraft("");
    setError(null);
    setStatus("checking");
    reconnect();
    void probe();
  };

  if (status === "ok" || status === "checking") return null;

  return (
    <div className="modal-backdrop" style={{ zIndex: 300 }}>
      <div className="modal" style={{ width: "min(420px, 90vw)" }}>
        <h3>{status === "bad-token" ? "Token 无效" : "需要 Token"}</h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13, lineHeight: 1.5 }}>
          后端启用了认证。把 <code>CLAUDE_WEB_TOKEN</code> 粘进来：
        </p>
        <input
          type="password"
          autoFocus
          placeholder="paste token..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          style={{
            width: "100%",
            background: "var(--panel-2)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 10px",
            fontFamily: "ui-monospace, monospace",
            fontSize: 13,
            marginTop: 8,
          }}
        />
        {error && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 6 }}>{error}</div>}
        <div className="modal-actions">
          {status === "bad-token" && (
            <button
              className="secondary"
              onClick={() => { clearAuthToken(); setStatus("needs-token"); setError(null); }}
            >
              清除并重输
            </button>
          )}
          <button onClick={submit} disabled={!draft.trim()}>
            保存
          </button>
        </div>
        <p style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 12 }}>
          这个 token 是你 Mac 上 <code>~/Library/LaunchAgents/com.claude-web.backend.plist</code> 里设的环境变量；忘了就 <code>plutil -p</code> 看一下。
        </p>
      </div>
    </div>
  );
}
