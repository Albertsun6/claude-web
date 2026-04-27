import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

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
    const blocks = raw.message?.content ?? [];
    return (
      <div className="msg msg-assistant">
        {blocks.map((b: any, i: number) => {
          if (b.type === "text") {
            return (
              <div key={i} className="markdown">
                <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{b.text}</ReactMarkdown>
              </div>
            );
          }
          if (b.type === "tool_use") {
            return (
              <div key={i} className="tool-use">
                <div>
                  <span className="tool-name">{b.name}</span>{" "}
                  <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
                    #{b.id?.slice(-6)}
                  </span>
                </div>
                <div className="tool-payload">{JSON.stringify(b.input, null, 2)}</div>
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
    const blocks = raw.message?.content ?? [];
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
                <div>
                  <span className="tool-name">↳ result</span>{" "}
                  {b.is_error && <span style={{ color: "var(--danger)" }}>(error)</span>}
                </div>
                <div className="tool-payload">{content}</div>
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
