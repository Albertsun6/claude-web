import "../voice.css";
import { useVoiceCtx } from "../hooks/VoiceContext";
import { useStore } from "../store";
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
  const cleanupEnabled = useStore((s) => s.voiceCleanupEnabled);
  const setCleanupEnabled = useStore((s) => s.setVoiceCleanupEnabled);
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
      <div className="voice-extra">
        <label className="voice-cleanup-toggle" title="语音转写后用 Claude 整理一下再发送">
          <input
            type="checkbox"
            checked={cleanupEnabled}
            onChange={(e) => setCleanupEnabled(e.target.checked)}
          />
          <span>整理</span>
        </label>
        {voice.isSpeaking && (
          <button
            type="button"
            className="voice-mute"
            onClick={voice.cancelSpeak}
            aria-label="停止朗读"
            title="停止朗读"
          >
            ⏹
          </button>
        )}
        {!voice.isSpeaking && voice.hasLastTurn && (
          <button
            type="button"
            className="voice-mute"
            onClick={voice.replayLastTurn}
            aria-label="重听上一段"
            title="重听上一段"
          >
            ↻
          </button>
        )}
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
    </div>
  );
}
