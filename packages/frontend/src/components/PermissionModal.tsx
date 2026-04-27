import { useState } from "react";
import { useStore } from "../store";
import { replyPermission } from "../ws-client";

type Scope = "once" | "run" | "project";

export function PermissionModal() {
  const pending = useStore((s) => s.pendingPermission);
  const activeCwd = useStore((s) => s.activeCwd);
  const [scope, setScope] = useState<Scope>("once");

  if (!pending) return null;

  const allow = () => {
    if (scope === "run") {
      useStore.getState().allowToolForRun(pending.runId, pending.toolName);
    } else if (scope === "project" && activeCwd) {
      useStore.getState().allowToolForProject(activeCwd, pending.toolName);
    }
    replyPermission(pending.requestId, "allow", pending.runId);
    setScope("once");
  };

  const deny = () => {
    replyPermission(pending.requestId, "deny", pending.runId);
    setScope("once");
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
          <legend>允许范围</legend>
          <label>
            <input type="radio" name="scope" checked={scope === "once"} onChange={() => setScope("once")} />
            <span>仅此一次</span>
          </label>
          <label>
            <input type="radio" name="scope" checked={scope === "run"} onChange={() => setScope("run")} />
            <span>本轮（直到对话结束）</span>
          </label>
          <label className={!activeCwd ? "perm-scope-disabled" : ""}>
            <input
              type="radio"
              name="scope"
              checked={scope === "project"}
              onChange={() => setScope("project")}
              disabled={!activeCwd}
            />
            <span>
              本项目永久 <span className="perm-scope-warn">(localStorage 保留)</span>
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
