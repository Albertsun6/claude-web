import { useCallback, useEffect, useState } from "react";
import { useStore, useActiveSession } from "../store";
import { fetchSessions, fetchTranscript, type SessionMeta } from "../api/sessions";

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const sec = diff / 1000;
  if (sec < 60) return "刚刚";
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.round(sec / 3600)} 小时前`;
  if (sec < 30 * 86400) return `${Math.round(sec / 86400)} 天前`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function SessionList() {
  const session = useActiveSession();
  const patchProject = useStore((s) => s.patchProject);
  const clearMessages = useStore((s) => s.clearMessages);
  const appendMessage = useStore((s) => s.appendMessage);

  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchSessions(session.cwd);
      setSessions(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [session]);

  // refresh when panel opens or active project changes
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // also refresh when the current session id changes (e.g., a new turn started)
  useEffect(() => {
    if (open && session?.sessionId) {
      const t = window.setTimeout(refresh, 1500);
      return () => window.clearTimeout(t);
    }
  }, [session?.sessionId, open, refresh]);

  const switchTo = async (sid: string) => {
    if (!session) return;
    if (session.busy) {
      alert("当前会话还在执行，请先停止");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const transcript = await fetchTranscript(session.cwd, sid);
      patchProject(session.cwd, { sessionId: sid });
      clearMessages(session.cwd);
      for (const m of transcript) appendMessage(session.cwd, m);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!session) return null;

  return (
    <div className="session-list">
      <button
        className="secondary session-list-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▼" : "▶"} 历史会话{sessions.length ? ` (${sessions.length})` : ""}
      </button>

      {open && (
        <div className="session-list-body">
          {loading && <div className="session-empty">加载中…</div>}
          {error && <div className="session-empty session-error">{error}</div>}
          {!loading && !error && sessions.length === 0 && (
            <div className="session-empty">还没有历史</div>
          )}
          {sessions.map((s) => {
            const active = s.sessionId === session.sessionId;
            return (
              <div
                key={s.sessionId}
                className={`session-item ${active ? "active" : ""}`}
                onClick={() => !active && switchTo(s.sessionId)}
                title={s.sessionId}
              >
                <div className="session-preview">{s.preview || "(无预览)"}</div>
                <div className="session-meta">
                  <code>{s.sessionId.slice(0, 8)}</code>
                  <span>· {formatRelative(s.mtime)}</span>
                  {active && <span className="session-active-tag">当前</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
