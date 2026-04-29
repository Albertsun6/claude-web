import { useState } from "react";
import { useStore } from "../store";
import { replyPermission } from "../ws-client";

export function PermissionModal() {
  const pending = useStore((s) => s.pendingPermission);
  const activeCwd = useStore((s) => s.activeCwd);
  const [autoAllowThisRun, setAutoAllowThisRun] = useState(false);
  const [autoAllowThisProject, setAutoAllowThisProject] = useState(false);

  if (!pending) return null;

  const allow = () => {
    if (autoAllowThisRun) {
      useStore.getState().allowToolForRun(pending.runId, pending.toolName);
    } else if (autoAllowThisProject && activeCwd) {
      useStore.getState().allowToolForProject(activeCwd, pending.toolName);
    }
    replyPermission(pending.requestId, "allow", pending.runId, pending.toolName);
    setAutoAllowThisRun(false);
    setAutoAllowThisProject(false);
  };

  const deny = () => {
    replyPermission(pending.requestId, "deny", pending.runId, pending.toolName);
    setAutoAllowThisRun(false);
    setAutoAllowThisProject(false);
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

        <fieldset className="perm-scope">
          <legend>后续处理</legend>
          <label>
            <input
              type="checkbox"
              checked={autoAllowThisRun}
              onChange={(e) => {
                setAutoAllowThisRun(e.target.checked);
                if (e.target.checked) setAutoAllowThisProject(false);
              }}
            />
            <span>本轮对话中的 {pending.toolName} 总是允许</span>
          </label>
          <label className={!activeCwd ? "perm-scope-disabled" : ""}>
            <input
              type="checkbox"
              checked={autoAllowThisProject}
              disabled={!activeCwd}
              onChange={(e) => {
                setAutoAllowThisProject(e.target.checked);
                if (e.target.checked) setAutoAllowThisRun(false);
              }}
            />
            <span>
              本项目永久允许 {pending.toolName} <span className="perm-scope-warn">(localStorage 保留)</span>
            </span>
          </label>
        </fieldset>

        <div className="modal-actions">
          <button className="secondary" onClick={deny}>拒绝</button>
          <button onClick={allow}>允许</button>
        </div>
      </div>
    </div>
  );
}
