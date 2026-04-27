import { useState } from "react";
import { useStore } from "../store";
import { sendPrompt, interrupt } from "../ws-client";

export function InputBox() {
  const [text, setText] = useState("");
  const busy = useStore((s) => s.busy);
  const connected = useStore((s) => s.connected);

  const submit = () => {
    if (!text.trim() || busy) return;
    sendPrompt(text);
    setText("");
  };

  return (
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
  );
}
