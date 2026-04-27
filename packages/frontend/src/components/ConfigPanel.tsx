import { useState } from "react";
import { useStore } from "../store";
import type { ModelId, PermissionMode } from "@claude-web/shared";
import { DirectoryPicker } from "./DirectoryPicker";

const MODELS: { id: ModelId; label: string }[] = [
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const PERMISSION_MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
];

export function ConfigPanel() {
  const cwd = useStore((s) => s.cwd);
  const model = useStore((s) => s.model);
  const permissionMode = useStore((s) => s.permissionMode);
  const setCwd = useStore((s) => s.setCwd);
  const setModel = useStore((s) => s.setModel);
  const setPermissionMode = useStore((s) => s.setPermissionMode);
  const busy = useStore((s) => s.busy);
  const [picking, setPicking] = useState(false);

  return (
    <div className="config-panel">
      <label>
        工作目录 (cwd)
        <div className="path-input-row">
          <input
            type="text"
            value={cwd}
            placeholder="/Users/you/some-project"
            disabled={busy}
            onChange={(e) => setCwd(e.target.value)}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => setPicking(true)}
            disabled={busy}
            title="选择目录"
          >
            📁
          </button>
        </div>
      </label>
      {picking && (
        <DirectoryPicker
          initialPath={cwd}
          onCancel={() => setPicking(false)}
          onSelect={(path) => { setCwd(path); setPicking(false); }}
        />
      )}

      <label>
        模型
        <select
          value={model}
          disabled={busy}
          onChange={(e) => setModel(e.target.value as ModelId)}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        权限模式
        <select
          value={permissionMode}
          disabled={busy}
          onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
        >
          {PERMISSION_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
