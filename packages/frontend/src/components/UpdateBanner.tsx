import { useEffect, useState } from "react";
import { fetchUpdateCheck, type UpdateCheckResult } from "../api/update-check";

const DISMISS_KEY = "vessel:update-banner-dismissed-tag";

function isDismissedForTag(tag: string): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === tag; }
  catch { return false; }
}
function dismissTag(tag: string): void {
  try { localStorage.setItem(DISMISS_KEY, tag); }
  catch { /* ignore */ }
}

export function UpdateBanner() {
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchUpdateCheck()
      .then((r) => { if (!cancelled) setResult(r); })
      .catch(() => { /* silent — banner just won't show */ });
    return () => { cancelled = true; };
  }, []);

  if (hidden || !result || !result.hasUpdate || !result.latest) return null;
  const tag = result.latest.tag;
  if (isDismissedForTag(tag)) return null;

  const onDismiss = () => {
    dismissTag(tag);
    setHidden(true);
  };

  const sizeMB = result.latest.asset
    ? Math.round(result.latest.asset.sizeBytes / 1024 / 1024)
    : null;

  return (
    <div className="update-banner" role="status">
      <span>🚀</span>
      <span>
        新版本 <strong>{tag}</strong> 可用 (你在 v{result.current.backend})
        {sizeMB ? ` · ${sizeMB}MB` : ""}
      </span>
      <a href={result.latest.htmlUrl} target="_blank" rel="noreferrer" className="update-banner-link">
        前往下载
      </a>
      <button className="secondary" onClick={onDismiss}>稍后</button>
    </div>
  );
}
