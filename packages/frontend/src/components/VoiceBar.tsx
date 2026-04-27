import "../voice.css";
import { useVoiceCtx } from "../hooks/VoiceContext";
import { VoiceButton } from "./VoiceButton";

export interface VoiceBarProps {
  onTranscript: (text: string) => void;
}

export function VoiceBar({ onTranscript }: VoiceBarProps) {
  const voice = useVoiceCtx();

  const modeLabel =
    voice.mode === "web-speech" ? "web-speech" : "unsupported";

  return (
    <div className="voice-bar">
      <div className="voice-bar-mode">{modeLabel}</div>
      <div className="voice-bar-center">
        <VoiceButton onTranscript={onTranscript} />
      </div>
      <button
        type="button"
        className="voice-mute"
        onClick={() => voice.setMuted(!voice.muted)}
        aria-label={voice.muted ? "取消静音" : "静音"}
        title={voice.muted ? "取消静音" : "静音"}
      >
        {voice.muted ? "🔇" : "🔊"}
      </button>
    </div>
  );
}
