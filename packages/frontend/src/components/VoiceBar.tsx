import "../voice.css";
import { useVoiceCtx } from "../hooks/VoiceContext";
import { useStore } from "../store";

const MODE_LABELS: Record<string, string> = {
  "web-speech": "浏览器",
  "remote-stt": "Mac whisper",
  "unsupported": "不支持",
};

function deviceLabel(d: MediaDeviceInfo, fallbackIdx: number): string {
  if (d.label) return d.label;
  // Pre-permission: labels are blank — show a generic label so user can still pick.
  return `${d.kind === "audioinput" ? "麦克风" : "扬声器"} ${fallbackIdx + 1}`;
}

export function VoiceBar() {
  const voice = useVoiceCtx();
  const cleanupEnabled = useStore((s) => s.voiceCleanupEnabled);
  const setCleanupEnabled = useStore((s) => s.setVoiceCleanupEnabled);
  const audioInputId = useStore((s) => s.audioInputId);
  const audioOutputId = useStore((s) => s.audioOutputId);
  const setAudioInputId = useStore((s) => s.setAudioInputId);
  const setAudioOutputId = useStore((s) => s.setAudioOutputId);
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

      <div className="voice-bar-devices" title="选择音频输入/输出设备 — 看到正在使用的麦克风和扬声器">
        <select
          className="voice-mode-select"
          value={audioInputId}
          onChange={(e) => setAudioInputId(e.target.value)}
          aria-label="音频输入"
        >
          <option value="">🎤 默认麦克风</option>
          {voice.inputDevices.map((d, i) => (
            <option key={d.deviceId || `in-${i}`} value={d.deviceId}>
              🎤 {deviceLabel(d, i)}
            </option>
          ))}
        </select>
        {voice.outputSelectionSupported ? (
          <select
            className="voice-mode-select"
            value={audioOutputId}
            onChange={(e) => setAudioOutputId(e.target.value)}
            aria-label="音频输出"
          >
            <option value="">🔈 默认扬声器</option>
            {voice.outputDevices.map((d, i) => (
              <option key={d.deviceId || `out-${i}`} value={d.deviceId}>
                🔈 {deviceLabel(d, i)}
              </option>
            ))}
          </select>
        ) : (
          <span className="voice-bar-mode" title="此浏览器不支持指定音频输出（如 Safari）">🔈 跟随系统</span>
        )}
        <button
          type="button"
          className="voice-icon-btn"
          onClick={() => { void voice.refreshDevices(); }}
          aria-label="刷新设备列表"
          title="刷新设备列表（蓝牙耳机刚连上时点一下）"
        >
          ↻
        </button>
      </div>

    </div>
  );
}
