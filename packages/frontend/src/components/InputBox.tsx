import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, useActiveSession } from "../store";
import { sendPrompt, interrupt } from "../ws-client";

const SLASH_COMMANDS: Array<{ cmd: string; desc: string }> = [
  { cmd: "/clear", desc: "清空当前对话视图" },
  { cmd: "/compact", desc: "压缩上下文" },
  { cmd: "/help", desc: "Claude 内置帮助" },
  { cmd: "/cost", desc: "查看本会话用量" },
  { cmd: "/init", desc: "为项目生成 CLAUDE.md" },
];

export function InputBox() {
  const [text, setText] = useState("");
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [showSlash, setShowSlash] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const session = useActiveSession();
  const connected = useStore((s) => s.connected);
  const patchProject = useStore((s) => s.patchProject);
  const clearMessages = useStore((s) => s.clearMessages);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const busy = !!session?.busy;
  const voiceDraft = session?.voiceDraft;

  // recent user inputs (latest first), capped to last 5
  const history = useMemo(() => {
    const msgs = session?.messages ?? [];
    const out: string[] = [];
    for (let i = msgs.length - 1; i >= 0 && out.length < 20; i--) {
      const r = msgs[i]!.raw;
      if (r?.type === "_user_input" && typeof r.text === "string") out.push(r.text);
    }
    return out.slice(0, 5);
  }, [session?.messages]);

  // when voice cleanup completes for the active project, populate textarea
  useEffect(() => {
    if (!voiceDraft) return;
    if (voiceDraft.status === "pending") {
      setText(voiceDraft.original);
    } else {
      setText(voiceDraft.cleaned);
    }
  }, [voiceDraft]);

  // open/close slash palette as user types
  useEffect(() => {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("/") && !trimmed.includes("\n")) {
      setShowSlash(true);
      setSlashIdx(0);
    } else {
      setShowSlash(false);
    }
  }, [text]);

  const filteredCmds = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q.startsWith("/")) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(q));
  }, [text]);

  const submit = () => {
    if (!text.trim() || busy || !session) return;
    const trimmed = text.trim();
    // Local /clear short-circuit: clear UI but don't send.
    if (trimmed === "/clear") {
      clearMessages(session.cwd);
      setText("");
      patchProject(session.cwd, { voiceDraft: undefined });
      return;
    }
    sendPrompt(trimmed);
    setText("");
    setHistoryIdx(null);
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

  const pickSlash = (cmd: string) => {
    setText(cmd + " ");
    setShowSlash(false);
    taRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // slash palette navigation
    if (showSlash && filteredCmds.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => (i + 1) % filteredCmds.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => (i - 1 + filteredCmds.length) % filteredCmds.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !(e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        pickSlash(filteredCmds[slashIdx]!.cmd);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSlash(false);
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }

    // history recall — only when textarea is empty or we're already navigating
    if (e.key === "ArrowUp" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const ta = e.currentTarget;
      const atTop = ta.selectionStart === 0 && ta.selectionEnd === 0;
      if (history.length > 0 && (text === "" || historyIdx !== null) && atTop) {
        e.preventDefault();
        const next = historyIdx === null ? 0 : Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(next);
        setText(history[next]!);
        return;
      }
    }
    if (e.key === "ArrowDown" && !e.shiftKey && historyIdx !== null) {
      e.preventDefault();
      if (historyIdx === 0) {
        setHistoryIdx(null);
        setText("");
      } else {
        const next = historyIdx - 1;
        setHistoryIdx(next);
        setText(history[next]!);
      }
      return;
    }
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
      {showSlash && filteredCmds.length > 0 && (
        <div className="slash-menu">
          {filteredCmds.map((c, i) => (
            <div
              key={c.cmd}
              className={`slash-item ${i === slashIdx ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pickSlash(c.cmd);
              }}
            >
              <code>{c.cmd}</code>
              <span className="slash-desc">{c.desc}</span>
            </div>
          ))}
        </div>
      )}
      <div className="input-bar">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (historyIdx !== null) setHistoryIdx(null);
          }}
          placeholder={
            !session ? "请先打开一个项目"
            : busy ? "Claude 正在思考…可切换到其他项目继续工作"
            : "输入指令，⌘/Ctrl+Enter 发送，↑ 历史，/ 命令"
          }
          disabled={!session}
          onKeyDown={onKeyDown}
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
