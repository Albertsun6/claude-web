import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { MessageItem } from "./MessageItem";

export function MessageStream() {
  const messages = useStore((s) => s.messages);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="stream" ref={ref}>
        <div style={{ color: "var(--text-dim)", textAlign: "center", marginTop: 80 }}>
          填写左侧工作目录，然后输入指令开始。<br />
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
