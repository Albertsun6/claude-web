import { Component, useEffect, useRef, type ReactNode } from "react";
import { useActiveSession } from "../store";
import { MessageItem } from "./MessageItem";

// Per-message boundary: a single bad payload from history must not blank the stream.
class MsgBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.warn("[MessageItem] render error:", err); }
  render() {
    if (this.state.err) {
      return (
        <div className="msg" style={{ color: "var(--danger)", fontSize: 12 }}>
          ⚠ 这条消息无法显示：{this.state.err.message}
        </div>
      );
    }
    return this.props.children;
  }
}

export function MessageStream() {
  const session = useActiveSession();
  const messages = session?.messages ?? [];
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  if (!session) {
    return (
      <div className="stream" ref={ref}>
        <div style={{ color: "var(--text-dim)", textAlign: "center", marginTop: 80 }}>
          左侧选择或添加一个项目开始
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="stream" ref={ref}>
        <div style={{ color: "var(--text-dim)", textAlign: "center", marginTop: 80 }}>
          项目「{session.name}」已就绪。<br />
          试试：<i>列出当前目录的文件</i>
        </div>
      </div>
    );
  }

  return (
    <div className="stream" ref={ref}>
      {messages.map((m) => (
        <MsgBoundary key={m.id}>
          <MessageItem raw={m.raw} />
        </MsgBoundary>
      ))}
    </div>
  );
}
