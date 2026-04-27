import { useEffect, useRef } from "react";
import { useActiveSession } from "../store";
import { MessageItem } from "./MessageItem";

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
        <MessageItem key={m.id} raw={m.raw} />
      ))}
    </div>
  );
}
