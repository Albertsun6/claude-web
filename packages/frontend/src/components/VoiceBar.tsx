import "../voice.css";
import { useVoiceCtx } from "../hooks/VoiceContext";
import { VoiceButton } from "./VoiceButton";

export interface VoiceBarProps {
  onTranscript: (text: string) => void;
}

const MODE_LABELS: Record<string, string> = {
  "web-speech": "浏览器",
  "remote-stt": "Mac whisper",
  "unsupported": "不支持",
};

export function VoiceBar({ onTranscript }: VoiceBarProps) {
  const voice = useVoiceCtx();
  const canSwitch = voice.availableModes.length > 1;

  return (
    <div className="voice-bar">
      <div className="voice-bar-mode">
        {canSwitch ? (
          <select
            value={voice.mode}
            onChange={(e) => voice.setMode(e.target.value as typeof voice.mode)}
            aria-label="语音模式"
          >
            {voice.availableModes.map((m) => (
              <option key={m} value={m}>{MODE_LABELS[m] ?? m}</option>
            ))}
          </select>
        ) : (
          MODE_LABELS[voice.mode] ?? voice.mode
        )}
      </div>
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
