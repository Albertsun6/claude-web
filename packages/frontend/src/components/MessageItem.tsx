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
    return <div className="msg msg-user">{raw.text}</div>;
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
