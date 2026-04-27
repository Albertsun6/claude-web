import { useEffect, useState } from "react";
import { useStore } from "../store";
import { sendPrompt, interrupt } from "../ws-client";

export function InputBox() {
  const [text, setText] = useState("");
  const busy = useStore((s) => s.busy);
  const connected = useStore((s) => s.connected);
  const voiceDraft = useStore((s) => s.voiceDraft);
  const setVoiceDraft = useStore((s) => s.setVoiceDraft);

  // when voice cleanup completes, populate textarea
  useEffect(() => {
    if (!voiceDraft) return;
    if (voiceDraft.status === "pending") {
      // optimistic: show original immediately
      setText(voiceDraft.original);
    } else {
      // ready or failed → fill final text (cleaned, or original if failed)
      setText(voiceDraft.cleaned);
    }
  }, [voiceDraft]);

  const submit = () => {
    if (!text.trim() || busy) return;
    sendPrompt(text);
    setText("");
    setVoiceDraft(undefined);
  };

  const discard = () => {
    setVoiceDraft(undefined);
    setText("");
  };

  return (
    <div className="input-stack">
      {voiceDraft && (
        <div className={`voice-draft-bar voice-draft-${voiceDraft.status}`}>
          <div className="voice-draft-tag">
            {voiceDraft.status === "pending" && "整理中…"}
            {voiceDraft.status === "ready" && "已整理 (可编辑后发送)"}
            {voiceDraft.status === "failed" && "整理失败，使用原始转写"}
          </div>
          <div className="voice-draft-original" title={voiceDraft.original}>
            原始: {voiceDraft.original}
          </div>
          <button
            type="button"
            className="secondary voice-draft-discard"
            onClick={discard}
            title="丢弃"
          >
            ✕
          </button>
        </div>
      )}
      <div className="input-bar">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={busy ? "Claude 正在思考…" : "输入指令，⌘/Ctrl+Enter 发送"}
          disabled={busy}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
        />
        {busy ? (
          <button className="danger" onClick={interrupt}>停止</button>
        ) : (
          <button onClick={submit} disabled={!connected || !text.trim()}>
            发送
          </button>
        )}
      </div>
    </div>
  );
}
