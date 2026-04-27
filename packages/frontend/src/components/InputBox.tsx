import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, useActiveSession } from "../store";
import { sendPrompt, interrupt } from "../ws-client";
import { fetchTree } from "../api/fs";

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

  // @file mention picker state
  const [showAt, setShowAt] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  const [atFiles, setAtFiles] = useState<string[]>([]);
  const [atIdx, setAtIdx] = useState(0);

  // open/close slash palette as user types
  useEffect(() => {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("/") && !trimmed.includes("\n")) {
      setShowSlash(true);
      setSlashIdx(0);
      setShowAt(false);
    } else {
      setShowSlash(false);
    }
  }, [text]);

  // detect @<query> at the caret position
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) { setShowAt(false); return; }
    const pos = ta.selectionStart;
    const before = text.slice(0, pos);
    const m = /(^|[\s\n])@([^\s@]*)$/.exec(before);
    if (m) {
      setShowAt(true);
      setAtQuery(m[2]!);
      setAtIdx(0);
    } else {
      setShowAt(false);
      setAtQuery("");
    }
  }, [text]);

  // load files for @ picker (lazy, only when shown)
  useEffect(() => {
    if (!showAt || !session) return;
    let cancelled = false;
    fetchTree(session.cwd, "")
      .then((res) => {
        if (cancelled) return;
        // top-level only for v1; full recursive walk would be heavy
        const names = res.entries
          .filter((e) => e.type === "file")
          .map((e) => e.name);
        setAtFiles(names);
      })
      .catch(() => { if (!cancelled) setAtFiles([]); });
    return () => { cancelled = true; };
  }, [showAt, session?.cwd]);

  const filteredCmds = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q.startsWith("/")) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(q));
  }, [text]);

  const filteredFiles = useMemo(() => {
    const q = atQuery.toLowerCase();
    return atFiles
      .filter((f) => !q || f.toLowerCase().includes(q))
      .slice(0, 8);
  }, [atFiles, atQuery]);

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

  const pickFile = (filename: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    // replace the trailing @<query> with @<filename>
    const replaced = before.replace(/@[^\s@]*$/, `@${filename}`);
    const next = replaced + (after.startsWith(" ") ? after : " " + after);
    setText(next);
    setShowAt(false);
    requestAnimationFrame(() => {
      const newPos = replaced.length + 1;
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // @ file picker navigation (takes precedence over slash)
    if (showAt && filteredFiles.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAtIdx((i) => (i + 1) % filteredFiles.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAtIdx((i) => (i - 1 + filteredFiles.length) % filteredFiles.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !(e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        pickFile(filteredFiles[atIdx]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowAt(false);
        return;
      }
    }
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
      {showAt && filteredFiles.length > 0 && (
        <div className="slash-menu">
          {filteredFiles.map((f, i) => (
            <div
              key={f}
              className={`slash-item ${i === atIdx ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pickFile(f);
              }}
            >
              <code>@{f}</code>
              <span className="slash-desc">{atQuery ? `匹配: ${atQuery}` : "项目根文件"}</span>
            </div>
          ))}
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
            : "输入指令，⌘/Ctrl+Enter 发送，↑ 历史，/ 命令，@ 引用文件"
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
