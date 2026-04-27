import { useEffect, useState } from "react";
import { useStore, useActiveSession } from "../store";
import { sendPrompt, interrupt } from "../ws-client";

export function InputBox() {
  const [text, setText] = useState("");
  const session = useActiveSession();
  const connected = useStore((s) => s.connected);
  const patchProject = useStore((s) => s.patchProject);

  const busy = !!session?.busy;
  const voiceDraft = session?.voiceDraft;

  // when voice cleanup completes for the active project, populate textarea
  useEffect(() => {
    if (!voiceDraft) return;
    if (voiceDraft.status === "pending") {
      setText(voiceDraft.original);
    } else {
      setText(voiceDraft.cleaned);
    }
  }, [voiceDraft]);

  const submit = () => {
    if (!text.trim() || busy || !session) return;
    sendPrompt(text);
    setText("");
    patchProject(session.cwd, { voiceDraft: undefined });
  };

  const discard = () => {
    if (!session) return;
    patchProject(session.cwd, { voiceDraft: undefined });
    setText("");
  };

  const stop = () => {
    if (session?.currentRunId) interrupt(session.currentRunId);
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
          <button type="button" className="secondary voice-draft-discard" onClick={discard} title="丢弃">
            ✕
          </button>
        </div>
      )}
      <div className="input-bar">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            !session ? "请先打开一个项目"
            : busy ? "Claude 正在思考…可切换到其他项目继续工作"
            : "输入指令，⌘/Ctrl+Enter 发送"
          }
          disabled={!session}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
        />
        {busy ? (
          <button className="danger" onClick={stop}>停止</button>
        ) : (
          <button onClick={submit} disabled={!connected || !text.trim() || !session}>
            发送
          </button>
        )}
      </div>
    </div>
  );
}
