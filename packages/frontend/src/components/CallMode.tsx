// Full-screen "call" overlay for hands-free voice. Shown when the user
// activates voice.callMode (a toggle independent of conversationMode).
// Renders: live transcript, big mic, status, exit. Hides everything else.

import { useEffect, useState } from "react";
import { useVoiceCtx } from "../hooks/VoiceContext";

interface CallModeProps {
  active: boolean;
  onClose: () => void;
}

export function CallMode({ active, onClose }: CallModeProps) {
  const voice = useVoiceCtx();
  const [now, setNow] = useState(() => Date.now());

  // pulse animation needs a tick for smooth waveform
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(t);
  }, [active]);

  // ESC closes
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  if (!active) return null;

  const dots = 5;
  const phase = (now / 200) % (Math.PI * 2);

  return (
    <div className="callmode" role="dialog" aria-label="hands-free call">
      <button className="callmode-exit" onClick={onClose} aria-label="退出通话">
        ✕
      </button>
      <div className="callmode-status">
        {!voice.conversationMode
          ? "对话模式未开"
          : voice.userPaused
            ? "已暂停 · 说「继续」恢复"
            : voice.isRecording
              ? "正在听 · 说「发送」提交 · 「暂停」「清除」可用"
              : "等待 Claude…"}
      </div>
      <div className="callmode-transcript">
        {voice.liveTranscript || (voice.interimTranscript || (voice.isSpeaking ? "Claude 正在说话…" : "你说话…"))}
      </div>
      <div className="callmode-wave" aria-hidden="true">
        {Array.from({ length: dots }).map((_, i) => {
          const offset = (i - (dots - 1) / 2) * 0.6;
          const amp = voice.isRecording ? Math.max(8, Math.abs(Math.sin(phase + offset)) * 36) : 6;
          return (
            <span
              key={i}
              className="callmode-bar"
              style={{ height: `${amp}px` }}
            />
          );
        })}
      </div>
      <div className="callmode-controls">
        {!voice.conversationMode && (
          <button onClick={() => voice.setConversationMode(true)}>开启对话</button>
        )}
        {voice.conversationMode && (
          <>
            <button
              className="secondary"
              onClick={() => voice.setUserPaused(!voice.userPaused)}
              title={voice.userPaused ? "恢复（说『继续』也行）" : "暂停（说『暂停』也行）"}
            >
              {voice.userPaused ? "▶ 继续" : "⏸ 暂停"}
            </button>
            <button
              className="secondary"
              onClick={() => voice.clearConvoBuffer()}
              title="清空已录制的内容（说『清除』也行）"
            >
              ✗ 清除
            </button>
            <button className="secondary" onClick={() => voice.setConversationMode(false)}>
              停止对话
            </button>
          </>
        )}
        <button
          className="secondary"
          onClick={() => voice.setMuted(!voice.muted)}
          title={voice.muted ? "取消静音" : "静音"}
        >
          {voice.muted ? "🔇" : "🔊"}
        </button>
      </div>
      <div className="callmode-hint">
        ESC 或 ✕ 退出 · 屏幕已锁定不息屏
      </div>
    </div>
  );
}
