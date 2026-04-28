// Tiny synthesized beeps for hands-free voice UX. No audio files needed.
// Reuses one AudioContext to avoid the Safari "user gesture required" repeat dance.

let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      // @ts-expect-error webkit prefix on older Safari
      const C = window.AudioContext ?? window.webkitAudioContext;
      ctx = C ? new C() : null;
    } catch { ctx = null; }
  }
  // Safari sometimes leaves the ctx in 'suspended' until next user gesture.
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

interface BeepStep { freq: number; ms: number; gap?: number }

function play(steps: BeepStep[]): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  let t = now;
  for (const s of steps) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(s.freq, t);
    osc.connect(gain).connect(c.destination);
    // very short envelope to avoid clicks
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + s.ms / 1000);
    osc.start(t);
    osc.stop(t + s.ms / 1000 + 0.02);
    t += s.ms / 1000 + (s.gap ?? 0) / 1000;
  }
}

/** Listening starts. */
export const cueListening = (): void => play([{ freq: 880, ms: 90 }]);

/** Triggered submit (ascending). */
export const cueSubmit = (): void => play([
  { freq: 1320, ms: 70, gap: 30 },
  { freq: 1760, ms: 90 },
]);

/** Stopped / cancelled (descending). */
export const cueStop = (): void => play([
  { freq: 1320, ms: 70, gap: 30 },
  { freq: 880, ms: 90 },
]);

/** Error / nothing recognized (low blip). */
export const cueError = (): void => play([
  { freq: 220, ms: 180 },
]);
