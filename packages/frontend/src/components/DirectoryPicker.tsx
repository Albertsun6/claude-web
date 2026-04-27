import { useEffect, useState } from "react";
import { fetchTree, fetchHome } from "../api/fs";

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

  // bootstrap to home if no initial
  useEffect(() => {
    if (current) return;
    let cancelled = false;
    fetchHome()
      .then((h) => { if (!cancelled) setCurrent(h.home); })
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
  }, [current]);

  const goUp = () => setCurrent(dirname(current));
  const enter = (name: string) => setCurrent(joinPath(current, name));

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
        </div>

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
