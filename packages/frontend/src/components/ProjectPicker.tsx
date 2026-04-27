import { useState } from "react";
import { useStore, type Project } from "../store";
import { DirectoryPicker } from "./DirectoryPicker";

type Mode = "idle" | "open" | "create";

export function ProjectPicker() {
  const projects = useStore((s) => s.projects);
  const openCwds = useStore((s) => s.openCwds);
  const activeCwd = useStore((s) => s.activeCwd);
  const openProject = useStore((s) => s.openProject);
  const addProject = useStore((s) => s.addProject);
  const removeProject = useStore((s) => s.removeProject);
  const byCwd = useStore((s) => s.byCwd);

  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState<Project>({ name: "", cwd: "" });

  const submitCreate = () => {
    if (!draft.name.trim() || !draft.cwd.trim()) return;
    const p: Project = { name: draft.name.trim(), cwd: draft.cwd.trim() };
    addProject(p);
    openProject(p);
    setDraft({ name: "", cwd: "" });
    setMode("idle");
  };

  // "Open" flow: directly pick a directory; auto-derive project name; register + open as tab.
  const handleOpenSelect = (path: string) => {
    const name = path.split("/").filter(Boolean).pop() || path;
    const p: Project = { name, cwd: path };
    addProject(p);   // no-op if cwd already saved
    openProject(p);  // opens as active tab
    setMode("idle");
  };

  return (
    <div className="project-picker">
      <div className="project-picker-header">
        <span className="project-picker-label">项目</span>
        <div className="project-picker-actions">
          <button
            className="secondary"
            style={{ fontSize: 11, padding: "4px 8px", minHeight: 28 }}
            onClick={() => setMode(mode === "open" ? "idle" : "open")}
            title="打开磁盘上已有的目录"
          >
            📂 打开
          </button>
          <button
            className="secondary"
            style={{ fontSize: 11, padding: "4px 8px", minHeight: 28 }}
            onClick={() => setMode(mode === "create" ? "idle" : "create")}
            title="新建/手动添加项目"
          >
            {mode === "create" ? "取消" : "+ 新建"}
          </button>
        </div>
      </div>

      <ul className="project-list">
        {projects.length === 0 && (
          <li className="project-empty">还没有项目，点击 📂 打开 选一个目录</li>
        )}
        {projects.map((p) => {
          const isOpen = openCwds.includes(p.cwd);
          const isActive = activeCwd === p.cwd;
          const sess = byCwd[p.cwd];
          const isBusy = !!sess?.busy;
          return (
            <li
              key={p.cwd}
              className={`project-item ${isActive ? "active" : ""} ${isOpen ? "open" : ""}`}
              onClick={() => openProject(p)}
              title={isOpen ? "已打开" : "点击打开为标签页"}
            >
              <div className="project-item-text">
                <div className="project-name">
                  {p.name}
                  {isBusy && <span className="project-busy" title="正在执行">⏳</span>}
                  {isOpen && !isBusy && <span className="project-dot" title="已打开" />}
                </div>
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

      {mode === "create" && (
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
              onClick={() => setMode("open")}
              title="选择/新建目录"
            >
              📁
            </button>
          </div>
          <button onClick={submitCreate} disabled={!draft.name.trim() || !draft.cwd.trim()}>
            保存并打开
          </button>
        </div>
      )}

      {mode === "open" && (
        <DirectoryPicker
          initialPath={draft.cwd}
          onCancel={() => {
            // if user came here via "+新建" flow, return to it; else go idle
            setMode(draft.cwd || draft.name ? "create" : "idle");
          }}
          onSelect={(path) => {
            // if 新建 form was open, just fill it; otherwise open directly
            if (draft.name || draft.cwd) {
              setDraft((d) => ({
                ...d,
                cwd: path,
                name: d.name.trim() || (path.split("/").filter(Boolean).pop() ?? ""),
              }));
              setMode("create");
            } else {
              handleOpenSelect(path);
            }
          }}
        />
      )}
    </div>
  );
}
