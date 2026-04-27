import { useEffect, useState } from "react";
import { useStore } from "../store";

// shows a fixed banner when WS isn't connected. delays appearance by ~1s
// so brief reconnects don't flash. allows manual reload.
export function OfflineBanner() {
  const connected = useStore((s) => s.connected);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (connected) {
      setShow(false);
      return;
    }
    const t = window.setTimeout(() => setShow(true), 1000);
    return () => window.clearTimeout(t);
  }, [connected]);

  if (!show) return null;

  return (
    <div className="offline-banner" role="alert">
      <span className="offline-banner-dot" />
      后端离线，自动重连中…
      <button className="offline-banner-btn" onClick={() => location.reload()}>
        刷新
      </button>
    </div>
  );
}
