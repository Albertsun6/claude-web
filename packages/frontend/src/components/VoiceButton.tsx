import { useEffect, useRef } from "react";
import { useVoiceCtx } from "../hooks/VoiceContext";

export interface VoiceButtonProps {
  onTranscript: (text: string) => void;
}

const TAP_THRESHOLD_MS = 250;

/**
 * Press behavior:
 *   - **Tap** (down + up < 250ms): toggle recording on/off (good for mobile)
 *   - **Hold** (down ≥ 250ms): hold-to-talk; releases stops
 *   - In **conversation mode**: any tap toggles continuous listen on/off
 */
export function VoiceButton({ onTranscript }: VoiceButtonProps) {
  const voice = useVoiceCtx();
  const downAtRef = useRef<number>(0);
  const heldRef = useRef(false);
  const interactionRef = useRef<"idle" | "tap" | "hold">("idle");

  useEffect(() => {
    voice.onFinal((text) => {
      const t = text.trim();
      if (t) onTranscript(t);
    });
  }, [voice, onTranscript]);

  const disabled = voice.mode === "unsupported";

  const begin = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.preventDefault();
    if (heldRef.current) return;
    heldRef.current = true;
    downAtRef.current = Date.now();
    interactionRef.current = "tap";
    (e.currentTarget as HTMLButtonElement).setPointerCapture?.(e.pointerId);
    // If recording is already on (e.g. convo mode left it on), tap → stop
    if (voice.isRecording) {
      // wait for pointerup to decide whether it's a tap or a hold-stop
      return;
    }
    // Start eagerly. If user holds, we keep it. If user taps quickly, we keep it on (toggle on).
    voice.start();
  };

  const end = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!heldRef.current) return;
    heldRef.current = false;
    try {
      (e.currentTarget as HTMLButtonElement).releasePointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
    const heldFor = Date.now() - downAtRef.current;

    if (heldFor >= TAP_THRESHOLD_MS) {
      // Hold-to-talk: stop on release.
      voice.stop();
      interactionRef.current = "idle";
      return;
    }
    // Quick tap: toggle. If we just started on pointerdown, keep it running.
    // If we were already recording when pressed, stop.
    if (interactionRef.current === "tap") {
      if (!voice.isRecording) {
        // already stopped (race) — start
        voice.start();
      }
      // else: stay on (tap-to-keep)
    }
    interactionRef.current = "idle";
  };

  // Tap on a button that's already recording = stop it.
  const onClick = () => {
    if (disabled) return;
    if (Date.now() - downAtRef.current > TAP_THRESHOLD_MS + 50) return; // hold flow handles it
    if (voice.isRecording && interactionRef.current === "idle") {
      voice.stop();
    }
  };

  const tooltip = disabled ? "浏览器不支持语音"
    : voice.conversationMode ? "对话模式：点击切换持续监听"
    : "按住说话，或单击切换录音";

  return (
    <div className="voice-button-wrap">
      {voice.isRecording && voice.interimTranscript ? (
        <div className="voice-interim">{voice.interimTranscript}</div>
      ) : null}
      <button
        type="button"
        className={`voice-button${voice.isRecording ? " recording" : ""}${voice.conversationMode ? " convo" : ""}`}
        disabled={disabled}
        title={tooltip}
        aria-label={tooltip}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        onClick={onClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {voice.isRecording ? "●" : voice.conversationMode ? "♾" : "🎤"}
      </button>
    </div>
  );
}
