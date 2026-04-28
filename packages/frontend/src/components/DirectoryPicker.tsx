import { useEffect, useState } from "react";
import { fetchTree, fetchHome, createDirectory } from "../api/fs";

export interface DirectoryPickerProps {
  initialPath?: string;
  onCancel: () => void;
  onSelect: (path: string) => void;
}

function dirname(p: string): string {
  if (p === "/" || p === "") return "/";
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

function joinPath(base: string, name: string): string {
  if (base === "/") return `/${name}`;
  return `${base}/${name}`;
}

export function DirectoryPicker({
  initialPath,
  onCancel,
  onSelect,
}: DirectoryPickerProps) {
  const [current, setCurrent] = useState<string>(initialPath ?? "");
  const [entries, setEntries] = useState<{ name: string; type: "dir" | "file" }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Bootstrap to ~/Desktop if it exists, else home, else "/".
  useEffect(() => {
    if (current) return;
    let cancelled = false;
    fetchHome()
      .then((h) => { if (!cancelled) setCurrent(h.desktop ?? h.home); })
      .catch(() => { if (!cancelled) setCurrent("/"); });
    return () => { cancelled = true; };
  }, [current]);

  // load entries when current changes
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTree(current, "")
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries.filter((e) => e.type === "dir"));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setEntries([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [current, reloadCounter]);

  const goUp = () => setCurrent(dirname(current));
  const enter = (name: string) => setCurrent(joinPath(current, name));

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreateError(null);
    try {
      await createDirectory(current, name);
      setNewName("");
      setCreating(false);
      // navigate into the new dir
      setCurrent(joinPath(current, name));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal dir-picker" onClick={(e) => e.stopPropagation()}>
        <h3>选择目录</h3>

        <div className="dir-path">
          <button
            type="button"
            className="secondary"
            onClick={goUp}
            disabled={current === "/"}
            title="上一级"
          >
            ↑
          </button>
          <input
            type="text"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            spellCheck={false}
            placeholder="/Users/you"
          />
          <button
            type="button"
            className="secondary"
            onClick={() => setReloadCounter((n) => n + 1)}
            title="刷新"
          >
            ⟳
          </button>
          <button
            type="button"
            onClick={() => { setCreating(true); setCreateError(null); }}
            title="在当前目录下新建文件夹"
          >
            +
          </button>
        </div>

        {creating && (
          <div className="dir-create">
            <input
              type="text"
              autoFocus
              placeholder="新文件夹名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCreate();
                if (e.key === "Escape") { setCreating(false); setNewName(""); setCreateError(null); }
              }}
            />
            <button onClick={submitCreate} disabled={!newName.trim()}>创建</button>
            <button className="secondary" onClick={() => { setCreating(false); setNewName(""); setCreateError(null); }}>
              取消
            </button>
          </div>
        )}
        {createError && <div className="dir-error" style={{ fontSize: 12 }}>{createError}</div>}

        <div className="dir-list">
          {loading && <div className="dir-empty">加载中…</div>}
          {error && <div className="dir-empty dir-error">{error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div className="dir-empty">这个目录下没有子文件夹</div>
          )}
          {!loading && !error && entries.map((e) => (
            <div
              key={e.name}
              className="dir-item"
              onClick={() => enter(e.name)}
              onDoubleClick={() => {
                const next = joinPath(current, e.name);
                onSelect(next);
              }}
              title="单击进入，双击直接选中"
            >
              📁 {e.name}
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>取消</button>
          <button onClick={() => onSelect(current)} disabled={!current}>
            选这个 ({current.split("/").pop() || "/"})
          </button>
        </div>
      </div>
    </div>
  );
}
