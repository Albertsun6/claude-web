import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

const COLLAPSE_THRESHOLD = 2000; // chars
const COLLAPSE_LINE_THRESHOLD = 24;

function CollapsibleText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = text.split("\n").length;
  const longByChars = text.length > COLLAPSE_THRESHOLD;
  const longByLines = lineCount > COLLAPSE_LINE_THRESHOLD;
  const isLong = longByChars || longByLines;
  if (!isLong || expanded) {
    return (
      <div className={className}>
        {text}
        {isLong && expanded && (
          <div style={{ marginTop: 6 }}>
            <button
              className="secondary"
              style={{ fontSize: 11, padding: "2px 8px" }}
              onClick={() => setExpanded(false)}
            >
              收起
            </button>
          </div>
        )}
      </div>
    );
  }
  // collapsed preview: first ~12 lines or 800 chars
  const previewLines = text.split("\n").slice(0, 12).join("\n");
  const preview = previewLines.length > 800 ? previewLines.slice(0, 800) + "…" : previewLines;
  return (
    <div className={className}>
      {preview}
      {"\n"}
      <button
        className="secondary"
        style={{ fontSize: 11, padding: "2px 8px", marginTop: 6 }}
        onClick={() => setExpanded(true)}
      >
        展开（{longByChars ? `${text.length} 字符` : `${lineCount} 行`}）
      </button>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      title="复制"
      aria-label="复制"
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}

type Todo = { content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string };

function TodoWriteCard({ input }: { input: any }) {
  const todos: Todo[] = Array.isArray(input?.todos) ? input.todos : [];
  if (todos.length === 0) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  return (
    <div className="todo-card">
      <div className="todo-header">
        <span className="tool-name">📋 TodoWrite</span>
        <span className="todo-count">{done}/{todos.length}</span>
      </div>
      <ul className="todo-list">
        {todos.map((t, i) => {
          const icon = t.status === "completed" ? "✓"
            : t.status === "in_progress" ? "⏳"
            : "☐";
          return (
            <li key={i} className={`todo-item todo-${t.status}`}>
              <span className="todo-icon">{icon}</span>
              <span className="todo-text">
                {t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Compute a simple line-based diff between two strings. Inline coloring only. */
function lineDiff(a: string, b: string): { kind: "ctx" | "del" | "add"; text: string }[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  // Trim common prefix/suffix lines so we focus on the changed region.
  let pre = 0;
  while (pre < aLines.length && pre < bLines.length && aLines[pre] === bLines[pre]) pre++;
  let suf = 0;
  while (
    suf < aLines.length - pre &&
    suf < bLines.length - pre &&
    aLines[aLines.length - 1 - suf] === bLines[bLines.length - 1 - suf]
  ) suf++;
  const out: { kind: "ctx" | "del" | "add"; text: string }[] = [];
  // Show 1 line of context before/after the change for orientation
  const ctxBefore = Math.max(0, pre - 1);
  for (let i = ctxBefore; i < pre; i++) out.push({ kind: "ctx", text: aLines[i] ?? "" });
  for (let i = pre; i < aLines.length - suf; i++) out.push({ kind: "del", text: aLines[i] ?? "" });
  for (let i = pre; i < bLines.length - suf; i++) out.push({ kind: "add", text: bLines[i] ?? "" });
  const ctxAfterEnd = Math.min(aLines.length, aLines.length - suf + 1);
  for (let i = aLines.length - suf; i < ctxAfterEnd; i++) out.push({ kind: "ctx", text: aLines[i] ?? "" });
  return out;
}

function EditCard({ input, name }: { input: any; name: "Edit" | "Write" | "NotebookEdit" }) {
  const filePath: string = typeof input?.file_path === "string" ? input.file_path : "";
  const old = typeof input?.old_string === "string" ? input.old_string : "";
  const next = typeof input?.new_string === "string" ? input.new_string
    : typeof input?.content === "string" ? input.content : "";
  const replaceAll = !!input?.replace_all;

  let lines: { kind: "ctx" | "del" | "add"; text: string }[];
  if (name === "Write") {
    lines = next.split("\n").map((t: string) => ({ kind: "add" as const, text: t }));
  } else {
    lines = lineDiff(old, next);
  }

  return (
    <div className="tool-use edit-card">
      <div className="tool-header">
        <span>
          <span className="tool-name">✏️ {name}</span>{" "}
          {filePath && <code className="edit-path">{filePath}</code>}
          {replaceAll && <span className="edit-tag">replace_all</span>}
        </span>
        <CopyButton text={next || old} />
      </div>
      <div className="diff-view">
        {lines.map((l, i) => (
          <div key={i} className={`diff-line diff-${l.kind}`}>
            <span className="diff-marker">
              {l.kind === "del" ? "-" : l.kind === "add" ? "+" : " "}
            </span>
            <span className="diff-text">{l.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BashCard({ input }: { input: any }) {
  const cmd: string = typeof input?.command === "string" ? input.command : "";
  const desc: string = typeof input?.description === "string" ? input.description : "";
  return (
    <div className="tool-use bash-card">
      <div className="tool-header">
        <span>
          <span className="tool-name">▸ Bash</span>{" "}
          {desc && <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{desc}</span>}
        </span>
        <CopyButton text={cmd} />
      </div>
      <pre className="bash-cmd">{cmd}</pre>
    </div>
  );
}

function ReadCard({ input }: { input: any }) {
  const fp: string = typeof input?.file_path === "string" ? input.file_path : "";
  const offset = input?.offset, limit = input?.limit;
  return (
    <div className="tool-use read-card">
      <div className="tool-header">
        <span>
          <span className="tool-name">📖 Read</span>{" "}
          {fp && <code className="edit-path">{fp}</code>}
          {(offset || limit) && (
            <span style={{ color: "var(--text-dim)", fontSize: 11, marginLeft: 6 }}>
              {offset ? `from ${offset}` : ""}{limit ? ` (${limit} lines)` : ""}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

const markdownComponents = {
  pre: ({ node: _node, children, ...props }: any) => {
    // Extract raw text from the inner code element for copy.
    const codeChild = Array.isArray(children) ? children[0] : children;
    const codeText =
      codeChild?.props?.children &&
      (Array.isArray(codeChild.props.children)
        ? codeChild.props.children.join("")
        : String(codeChild.props.children));
    return (
      <div className="code-block-wrap">
        {codeText && <CopyButton text={String(codeText)} />}
        <pre {...props}>{children}</pre>
      </div>
    );
  },
};

export function MessageItem({ raw }: { raw: any }) {
  // local helpers
  if (raw?.type === "_user_input") {
    const atts: Array<{ mediaType: string; dataBase64?: string }> = raw.attachments ?? [];
    return (
      <div className="msg msg-user">
        {atts.length > 0 && (
          <div className="user-input-images">
            {atts.map((a, i) =>
              a.dataBase64 ? (
                <img
                  key={i}
                  src={`data:${a.mediaType};base64,${a.dataBase64}`}
                  alt={`attachment ${i + 1}`}
                />
              ) : (
                <span key={i} className="user-input-image-placeholder">📎 {a.mediaType}</span>
              ),
            )}
          </div>
        )}
        {raw.text && <div>{raw.text}</div>}
      </div>
    );
  }
  if (raw?.type === "_error") {
    return (
      <div className="msg" style={{ color: "var(--danger)" }}>
        ⚠ {raw.error}
      </div>
    );
  }

  // SDK system messages
  if (raw?.type === "system") {
    if (raw.subtype === "init") {
      const tools = raw.tools?.length ?? 0;
      return (
        <div className="msg msg-system">
          [system:init] model={raw.model} · tools={tools} · session={raw.session_id?.slice(0, 8)}
        </div>
      );
    }
    if (raw.subtype === "compact_boundary") {
      return <div className="msg msg-system">— context compacted —</div>;
    }
    return <div className="msg msg-system">[system:{raw.subtype}]</div>;
  }

  // SDK assistant messages
  if (raw?.type === "assistant") {
    const rawContent = raw.message?.content;
    const blocks: any[] = Array.isArray(rawContent)
      ? rawContent
      : typeof rawContent === "string"
        ? [{ type: "text", text: rawContent }]
        : [];
    return (
      <div className="msg msg-assistant">
        {blocks.map((b: any, i: number) => {
          if (b.type === "text") {
            return (
              <div key={i} className="markdown">
                <ReactMarkdown
                  rehypePlugins={[rehypeHighlight]}
                  components={markdownComponents}
                >
                  {b.text}
                </ReactMarkdown>
              </div>
            );
          }
          if (b.type === "tool_use") {
            // Specialized renderers for the most-used tools
            if (b.name === "TodoWrite") {
              return <TodoWriteCard key={i} input={b.input} />;
            }
            if (b.name === "Edit" || b.name === "Write" || b.name === "NotebookEdit") {
              return <EditCard key={i} input={b.input} name={b.name} />;
            }
            if (b.name === "Bash") {
              return <BashCard key={i} input={b.input} />;
            }
            if (b.name === "Read") {
              return <ReadCard key={i} input={b.input} />;
            }
            // Generic fallback
            const payload = JSON.stringify(b.input, null, 2);
            return (
              <div key={i} className="tool-use">
                <div className="tool-header">
                  <span>
                    <span className="tool-name">{b.name}</span>{" "}
                    <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
                      #{b.id?.slice(-6)}
                    </span>
                  </span>
                  <CopyButton text={payload} />
                </div>
                <CollapsibleText text={payload} className="tool-payload" />
              </div>
            );
          }
          if (b.type === "thinking") {
            return (
              <div key={i} className="msg-system" style={{ fontStyle: "italic" }}>
                💭 {b.thinking}
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  }

  // SDK user messages (mostly tool_result coming back)
  if (raw?.type === "user") {
    const rawContent = raw.message?.content;
    const blocks: any[] = Array.isArray(rawContent)
      ? rawContent
      : typeof rawContent === "string"
        ? [{ type: "text", text: rawContent }]
        : [];
    return (
      <>
        {blocks.map((b: any, i: number) => {
          if (b.type === "tool_result") {
            const content =
              typeof b.content === "string"
                ? b.content
                : Array.isArray(b.content)
                  ? b.content.map((c: any) => c.text ?? "").join("")
                  : JSON.stringify(b.content);
            return (
              <div key={i} className="tool-result">
                <div className="tool-header">
                  <span>
                    <span className="tool-name">↳ result</span>{" "}
                    {b.is_error && <span style={{ color: "var(--danger)" }}>(error)</span>}
                  </span>
                  <CopyButton text={content} />
                </div>
                <CollapsibleText text={content} className="tool-payload" />
              </div>
            );
          }
          if (b.type === "text") {
            return <div key={i} className="msg msg-user">{b.text}</div>;
          }
          return null;
        })}
      </>
    );
  }

  // SDK final result
  if (raw?.type === "result") {
    return (
      <div className="msg msg-result">
        ✓ done · {raw.num_turns} turns · ${raw.total_cost_usd?.toFixed(4) ?? "?"} ·
        in {raw.duration_ms}ms
      </div>
    );
  }

  // fallback
  return (
    <details className="msg msg-system">
      <summary>[{raw?.type ?? "unknown"}]</summary>
      <pre style={{ fontSize: 11 }}>{JSON.stringify(raw, null, 2)}</pre>
    </details>
  );
}
