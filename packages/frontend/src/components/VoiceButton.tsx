import { useEffect, useRef } from "react";
import { useVoiceCtx } from "../hooks/VoiceContext";

export interface VoiceButtonProps {
  onTranscript: (text: string) => void;
}

export function VoiceButton({ onTranscript }: VoiceButtonProps) {
  const voice = useVoiceCtx();
  const heldRef = useRef(false);

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
    (e.currentTarget as HTMLButtonElement).setPointerCapture?.(e.pointerId);
    voice.start();
  };

  const end = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!heldRef.current) return;
    heldRef.current = false;
    try {
      (e.currentTarget as HTMLButtonElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    voice.stop();
  };

  return (
    <div className="voice-button-wrap">
      {voice.isRecording && voice.interimTranscript ? (
        <div className="voice-interim">{voice.interimTranscript}</div>
      ) : null}
      <button
        type="button"
        className={`voice-button${voice.isRecording ? " recording" : ""}`}
        disabled={disabled}
        title={disabled ? "浏览器不支持语音" : "按住说话"}
        aria-label={disabled ? "浏览器不支持语音" : "按住说话"}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        onContextMenu={(e) => e.preventDefault()}
      >
        {voice.isRecording ? "●" : "🎤"}
      </button>
    </div>
  );
}
