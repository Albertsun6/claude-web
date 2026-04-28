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
      <div className="voice-bar-controls">
        {canSwitch ? (
          <select
            className="voice-mode-select"
            value={voice.mode}
            onChange={(e) => voice.setMode(e.target.value as typeof voice.mode)}
            aria-label="语音模式"
          >
            {voice.availableModes.map((m) => (
              <option key={m} value={m}>{MODE_LABELS[m] ?? m}</option>
            ))}
          </select>
        ) : (
          <span className="voice-bar-mode">{MODE_LABELS[voice.mode] ?? voice.mode}</span>
        )}

        <label className="voice-cleanup-toggle" title="语音转写后用 Claude 整理一下再发送">
          <input
            type="checkbox"
            checked={cleanupEnabled}
            onChange={(e) => setCleanupEnabled(e.target.checked)}
          />
          <span>整理</span>
        </label>
        <label className="voice-cleanup-toggle" title="开 = 用 Haiku 概括成口语版再播；关 = 逐句完整朗读">
          <input
            type="checkbox"
            checked={voice.speakStyle === "summary"}
            onChange={(e) => voice.setSpeakStyle(e.target.checked ? "summary" : "verbatim")}
          />
          <span>概要</span>
        </label>
        <label
          className="voice-cleanup-toggle"
          title="开 = 持续监听；说『发送』提交；每轮 Claude 回完自动续录"
        >
          <input
            type="checkbox"
            checked={voice.conversationMode}
            onChange={(e) => voice.setConversationMode(e.target.checked)}
            disabled={voice.mode === "unsupported"}
          />
          <span>对话</span>
        </label>
        <label className="voice-cleanup-toggle" title="慢速 TTS — 走路/戴耳机时听得清楚">
          <input
            type="checkbox"
            checked={voice.slowTts}
            onChange={(e) => voice.setSlowTts(e.target.checked)}
          />
          <span>慢读</span>
        </label>

        {voice.isSpeaking && (
          <button
            type="button"
            className="voice-icon-btn"
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
            className="voice-icon-btn"
            onClick={voice.replayLastTurn}
            aria-label="重听上一段"
            title="重听上一段"
          >
            ↻
          </button>
        )}
        <button
          type="button"
          className="voice-icon-btn"
          onClick={() => voice.setMuted(!voice.muted)}
          aria-label={voice.muted ? "取消静音" : "静音"}
          title={voice.muted ? "取消静音" : "静音"}
        >
          {voice.muted ? "🔇" : "🔊"}
        </button>
      </div>

      <div className="voice-bar-mic">
        <VoiceButton onTranscript={onTranscript} />
      </div>
    </div>
  );
}
