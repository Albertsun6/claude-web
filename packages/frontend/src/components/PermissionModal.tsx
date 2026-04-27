import { useState } from "react";
import { useStore } from "../store";
import { replyPermission } from "../ws-client";

export function PermissionModal() {
  const pending = useStore((s) => s.pendingPermission);
  const [alwaysAllow, setAlwaysAllow] = useState(false);

  if (!pending) return null;

  const allow = () => {
    if (alwaysAllow) {
      useStore.getState().allowToolForRun(pending.runId, pending.toolName);
    }
    replyPermission(pending.requestId, "allow", pending.runId);
    setAlwaysAllow(false);
  };

  const deny = () => {
    replyPermission(pending.requestId, "deny", pending.runId);
    setAlwaysAllow(false);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>
          🔒 工具调用确认：<code>{pending.toolName}</code>
        </h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          Claude 想调用该工具，是否允许？
        </p>
        <pre>{JSON.stringify(pending.input, null, 2)}</pre>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--text-dim)",
            marginTop: 12,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={alwaysAllow}
            onChange={(e) => setAlwaysAllow(e.target.checked)}
          />
          本轮自动允许 <code>{pending.toolName}</code>（直到对话结束）
        </label>
        <div className="modal-actions">
          <button className="secondary" onClick={deny}>拒绝</button>
          <button onClick={allow}>允许</button>
        </div>
      </div>
    </div>
  );
}
