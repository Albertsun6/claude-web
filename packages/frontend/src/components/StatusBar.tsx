// Bottom status strip: model · cwd · branch · turns · cache hit %.
// Pulls model from store (config), cwd from active session, branch from git API.

import { useEffect, useState } from "react";
import { useStore, useActiveSession } from "../store";
import { fetchGitStatus } from "../api/git";

const MODEL_LABEL: Record<string, string> = {
  "claude-opus-4-7": "Opus 4.7",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5": "Haiku 4.5",
};

function fmt(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function StatusBar() {
  const session = useActiveSession();
  const model = useStore((s) => s.model);
  const permissionMode = useStore((s) => s.permissionMode);
  const connected = useStore((s) => s.connected);
  const [branch, setBranch] = useState<string | null>(null);

  // poll branch every 30s while a session is active
  useEffect(() => {
    setBranch(null);
    if (!session) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const st = await fetchGitStatus(session.cwd);
        if (!cancelled) setBranch(st?.branch ?? null);
      } catch { /* not a git repo, no branch */ }
    };
    void poll();
    const t = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [session?.cwd]);

  if (!session) return null;

  const u = session.usage;
  const totalInput = u ? u.inputTokens + u.cacheCreationTokens + u.cacheReadTokens : 0;
  const cachePct = u && totalInput > 0 ? Math.round((u.cacheReadTokens / totalInput) * 100) : 0;

  // last segment of cwd for compactness; full path on hover
  const cwdShort = session.cwd.split("/").filter(Boolean).slice(-2).join("/");

  return (
    <div className="status-bar" role="contentinfo">
      <span className={`status-dot ${connected ? "ok" : "bad"}`} title={connected ? "已连接" : "已断开"} />
      <span className="status-item" title={`模型: ${model}`}>{MODEL_LABEL[model] ?? model}</span>
      <span className="status-sep">·</span>
      <span className="status-item" title={`权限: ${permissionMode}`}>{permissionMode}</span>
      <span className="status-sep">·</span>
      <span className="status-item status-cwd" title={session.cwd}>{cwdShort}</span>
      {branch && (
        <>
          <span className="status-sep">·</span>
          <span className="status-item" title={`Git branch`}>⎇ {branch}</span>
        </>
      )}
      {u && u.turns > 0 && (
        <>
          <span className="status-sep">·</span>
          <span className="status-item" title={`轮次 / 总 token`}>
            {u.turns}t · {fmt(totalInput)}
          </span>
          <span className="status-sep">·</span>
          <span className="status-item" title="缓存命中比例">💾{cachePct}%</span>
        </>
      )}
    </div>
  );
}
