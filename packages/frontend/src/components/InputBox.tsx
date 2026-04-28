import { useEffect, useMemo, useRef, useState } from "react";
import type { ImageAttachment } from "@claude-web/shared";
import { useStore, useActiveSession } from "../store";
import { sendPrompt, interrupt } from "../ws-client";
import { fetchTree } from "../api/fs";

interface PendingImage {
  id: string;
  mediaType: string;
  dataBase64: string;
  previewUrl: string;
  size: number;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const result = fr.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image — Claude API soft limit anyway

// Local-only commands (short-circuited in submit, never sent to CLI).
const LOCAL_COMMANDS: Array<{ cmd: string; desc: string }> = [
  { cmd: "/clear", desc: "清空当前对话视图（仅前端）" },
  { cmd: "/usage", desc: "查看本会话 + 订阅 bucket 状态" },
];

// Descriptions for commands the CLI advertises via system:init.slash_commands.
// Anything not in this map shows the bare name.
const COMMAND_DESCRIPTIONS: Record<string, string> = {
  // Anthropic builtins
  "compact": "压缩上下文（CLI）",
  "context": "显示上下文使用情况",
  "cost": "查看本会话用量",
  "init": "扫描项目并生成 CLAUDE.md",
  "review": "审查当前分支变更",
  "security-review": "安全审查",
  "help": "Claude 内置帮助",
  "agents": "列出已配置的 agents",
  "mcp": "查看 MCP 服务器",
  "resume": "恢复一个会话",
  "status": "诊断信息",
  "model": "切换模型",
  "memory": "管理记忆",
  // skills (auto-loaded based on project)
  "update-config": "修改 Claude Code 配置（settings.json）",
  "debug": "开启 debug 模式",
  "simplify": "审查刚改的代码、做简化",
  "batch": "批量重复一个 prompt",
  "loop": "周期性运行某 prompt",
  "schedule": "调度远程 agent",
  "claude-api": "构建/调试 Claude API 应用",
  // diagnostics
  "heapdump": "导出堆快照",
  "extra-usage": "额外用量信息",
  "insights": "团队洞察",
  "team-onboarding": "团队上手向导",
};

function descFor(name: string): string {
  return COMMAND_DESCRIPTIONS[name] ?? "";
}

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
  const [images, setImages] = useState<PendingImage[]>([]);

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

  const allCommands = useMemo<Array<{ cmd: string; desc: string }>>(() => {
    const fromSession: Array<{ cmd: string; desc: string }> = (session?.slashCommands ?? [])
      .map((name) => ({ cmd: `/${name}`, desc: descFor(name) }));
    const localCmds = new Set(LOCAL_COMMANDS.map((c) => c.cmd));
    // local commands first; then dedupe session entries that aren't already local
    const merged = [
      ...LOCAL_COMMANDS,
      ...fromSession.filter((c) => !localCmds.has(c.cmd)),
    ];
    // stable alphabetical within session block (locals stay on top)
    const head = merged.slice(0, LOCAL_COMMANDS.length);
    const tail = merged.slice(LOCAL_COMMANDS.length).sort((a, b) => a.cmd.localeCompare(b.cmd));
    return [...head, ...tail];
  }, [session?.slashCommands]);

  const filteredCmds = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q.startsWith("/")) return allCommands;
    return allCommands.filter((c) => c.cmd.toLowerCase().startsWith(q));
  }, [text, allCommands]);

  const filteredFiles = useMemo(() => {
    const q = atQuery.toLowerCase();
    return atFiles
      .filter((f) => !q || f.toLowerCase().includes(q))
      .slice(0, 8);
  }, [atFiles, atQuery]);

  const addImageBlobs = async (blobs: Blob[]) => {
    const next: PendingImage[] = [];
    for (const blob of blobs) {
      if (!blob.type.startsWith("image/")) continue;
      if (blob.size > MAX_IMAGE_BYTES) {
        alert(`图片太大: ${(blob.size / 1024 / 1024).toFixed(1)}MB > 5MB`);
        continue;
      }
      const dataBase64 = await blobToBase64(blob);
      next.push({
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        mediaType: blob.type,
        dataBase64,
        previewUrl: URL.createObjectURL(blob),
        size: blob.size,
      });
    }
    if (next.length) setImages((cur) => [...cur, ...next]);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const blobs: Blob[] = [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) blobs.push(f);
      }
    }
    if (blobs.length) {
      e.preventDefault();
      void addImageBlobs(blobs);
    }
  };

  const onDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      void addImageBlobs(files);
    }
  };

  const removeImage = (id: string) => {
    setImages((cur) => {
      const target = cur.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return cur.filter((i) => i.id !== id);
    });
  };

  // free blob URLs on unmount
  useEffect(() => () => {
    images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    if ((!text.trim() && images.length === 0) || busy || !session) return;
    const trimmed = text.trim();
    // Local /clear short-circuit: clear UI but don't send.
    if (trimmed === "/clear") {
      clearMessages(session.cwd);
      setText("");
      patchProject(session.cwd, { voiceDraft: undefined });
      return;
    }
    // Local /usage short-circuit: render a quota summary without burning a turn.
    if (trimmed === "/usage") {
      const s = useStore.getState();
      const u = session.usage;
      const rl = s.rateLimit;
      const totalInput = u ? u.inputTokens + u.cacheCreationTokens + u.cacheReadTokens : 0;
      const cachePct = u && totalInput > 0 ? Math.round((u.cacheReadTokens / totalInput) * 100) : 0;
      const lines: string[] = [
        "## 用量摘要",
        "",
        "**本会话**",
        u ? `- 轮次: ${u.turns}` : `- (尚无 result 事件)`,
        u ? `- 新 input: ${u.inputTokens}` : "",
        u ? `- 写缓存: ${u.cacheCreationTokens}` : "",
        u ? `- 读缓存: ${u.cacheReadTokens} (${cachePct}% 命中)` : "",
        u ? `- 输出: ${u.outputTokens}` : "",
        u ? `- 名义成本: $${u.costUsd.toFixed(4)}（订阅模式不实扣）` : "",
        "",
        "**订阅 bucket**",
        rl ? `- 类型: ${rl.rateLimitType}` : "- 暂无（发一条消息即可拿到）",
        rl ? `- 状态: ${rl.status}` : "",
        rl ? `- 重置时间: ${new Date(rl.resetsAt * 1000).toLocaleString()}` : "",
        rl?.isUsingOverage ? "- ⚠ 已进入 overage" : "",
      ].filter((l) => l !== "");
      useStore.getState().appendMessage(session.cwd, {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: lines.join("\n") }] },
        _local: true,
      });
      setText("");
      patchProject(session.cwd, { voiceDraft: undefined });
      return;
    }
    const atts: ImageAttachment[] | undefined = images.length > 0
      ? images.map((i) => ({ mediaType: i.mediaType, dataBase64: i.dataBase64 }))
      : undefined;
    sendPrompt(trimmed || "(image)", atts);
    setText("");
    setHistoryIdx(null);
    images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    setImages([]);
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
      {images.length > 0 && (
        <div className="image-tray">
          {images.map((img) => (
            <div key={img.id} className="image-thumb" title={`${(img.size / 1024).toFixed(1)} KB · ${img.mediaType}`}>
              <img src={img.previewUrl} alt="attachment" />
              <button
                type="button"
                className="image-thumb-remove"
                onClick={() => removeImage(img.id)}
                aria-label="移除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {voiceDraft && voiceDraft.status !== "live" && (
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
      {voiceDraft?.status === "live" && (
        <div className="voice-draft-bar voice-draft-live">
          <div className="voice-draft-tag">
            <span className="recording-dot" /> 录音中 · 说"发送"提交
          </div>
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
            : "输入指令，⌘/Ctrl+Enter 发送；↑ 历史，/ 命令，@ 引用文件，可粘贴/拖入图片"
          }
          disabled={!session}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
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
