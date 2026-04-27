import { useEffect, useState } from "react";
import { useActiveSession } from "../store";
import { fetchTree } from "../api/fs";
import { sendPrompt } from "../ws-client";

const DISMISS_KEY = "claude-web:claude-md-dismissed";
function isDismissed(cwd: string): boolean {
  try {
    const d: string[] = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]");
    return d.includes(cwd);
  } catch { return false; }
}
function dismiss(cwd: string): void {
  try {
    const d: string[] = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]");
    if (!d.includes(cwd)) d.push(cwd);
    localStorage.setItem(DISMISS_KEY, JSON.stringify(d));
  } catch { /* ignore */ }
}

export function ClaudeMdBanner() {
  const session = useActiveSession();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMissing(false);
    if (!session) return;
    if (isDismissed(session.cwd)) return;
    let cancelled = false;
    fetchTree(session.cwd, "")
      .then((res) => {
        if (cancelled) return;
        const has = res.entries.some((e) => e.type === "file" && e.name === "CLAUDE.md");
        setMissing(!has);
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [session?.cwd]);

  if (!session || !missing) return null;

  const generate = () => {
    sendPrompt("/init");
    setMissing(false);
  };

  const skip = () => {
    dismiss(session.cwd);
    setMissing(false);
  };

  return (
    <div className="claude-md-banner" role="status">
      <span>📝</span>
      <span>
        项目根没有 <code>CLAUDE.md</code> — 让 Claude 自动生成一份能省后续探索性 token。
      </span>
      <button onClick={generate}>生成</button>
      <button className="secondary" onClick={skip}>不需要</button>
    </div>
  );
}
