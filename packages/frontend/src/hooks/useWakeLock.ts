// Holds a screen WakeLock as long as `active` is true. Re-acquires after
// visibility change (browsers release the lock on tab background).

import { useEffect } from "react";

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (ev: "release", h: () => void) => void;
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined") return;
    const wl = (navigator as any).wakeLock;
    if (!wl?.request) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await wl.request("screen");
        if (cancelled) {
          await s.release().catch(() => {});
          return;
        }
        sentinel = s;
        s.addEventListener("release", () => { sentinel = null; });
      } catch (err) {
        // user dismissed permission, or page background — fine, will retry on visibility
        console.debug("[wakelock] request failed", err);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && !sentinel?.released) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
