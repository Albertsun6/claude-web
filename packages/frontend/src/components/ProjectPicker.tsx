import { useState } from "react";
import { useStore, type Project } from "../store";
import { DirectoryPicker } from "./DirectoryPicker";

export function ProjectPicker() {
  const projects = useStore((s) => s.projects);
  const cwd = useStore((s) => s.cwd);
  const switchToProject = useStore((s) => s.switchToProject);
  const addProject = useStore((s) => s.addProject);
  const removeProject = useStore((s) => s.removeProject);
  const busy = useStore((s) => s.busy);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Project>({ name: "", cwd: "" });
  const [picking, setPicking] = useState(false);

  const submit = () => {
    if (!draft.name.trim() || !draft.cwd.trim()) return;
    addProject({ name: draft.name.trim(), cwd: draft.cwd.trim() });
    setDraft({ name: "", cwd: "" });
    setAdding(false);
  };

  return (
    <div className="project-picker">
      <div className="project-picker-header">
        <span className="project-picker-label">项目</span>
        <button
          className="secondary"
          style={{ fontSize: 11, padding: "4px 8px", minHeight: 28 }}
          onClick={() => setAdding((v) => !v)}
          disabled={busy}
        >
          {adding ? "取消" : "+ 添加"}
        </button>
      </div>

      <ul className="project-list">
        {projects.length === 0 && (
          <li className="project-empty">还没有项目，添加一个吧</li>
        )}
        {projects.map((p) => {
          const active = p.cwd === cwd;
          return (
            <li
              key={p.cwd}
              className={`project-item ${active ? "active" : ""}`}
              onClick={() => !busy && switchToProject(p.cwd)}
            >
              <div className="project-item-text">
                <div className="project-name">{p.name}</div>
                <div className="project-cwd">{p.cwd}</div>
              </div>
              <button
                className="secondary project-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`移除 ${p.name}？（不会删除目录）`)) removeProject(p.cwd);
                }}
                aria-label="remove"
                title="移除"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      {adding && (
        <div className="project-add-form">
          <input
            type="text"
            placeholder="项目名"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div className="path-input-row">
            <input
              type="text"
              placeholder="/abs/path/to/project"
              value={draft.cwd}
              onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => setPicking(true)}
              title="选择目录"
            >
              📁
            </button>
          </div>
          <button onClick={submit} disabled={!draft.name.trim() || !draft.cwd.trim()}>
            保存
          </button>
        </div>
      )}

      {picking && (
        <DirectoryPicker
          initialPath={draft.cwd}
          onCancel={() => setPicking(false)}
          onSelect={(path) => {
            setDraft((d) => ({
              ...d,
              cwd: path,
              name: d.name.trim() || (path.split("/").filter(Boolean).pop() ?? ""),
            }));
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
