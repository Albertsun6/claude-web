import { useStore } from "../store";
import { replyPermission } from "../ws-client";

export function PermissionModal() {
  const pending = useStore((s) => s.pendingPermission);

  if (!pending) return null;

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
        <div className="modal-actions">
          <button
            className="secondary"
            onClick={() => replyPermission(pending.requestId, "deny")}
          >
            拒绝
          </button>
          <button onClick={() => replyPermission(pending.requestId, "allow")}>
            允许
          </button>
        </div>
      </div>
    </div>
  );
}
