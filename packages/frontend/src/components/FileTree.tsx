import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { fetchTree, type FsTreeEntry } from "../api/fs";
import { subscribeFsChanges } from "../ws-client";

interface FileTreeProps {
  onOpenFile: (relPath: string) => void;
  selectedRelPath?: string | null;
}

interface DirState {
  loading: boolean;
  error?: string;
  entries?: FsTreeEntry[];
}

export function FileTree({ onOpenFile, selectedRelPath }: FileTreeProps) {
  const cwd = useStore((s) => s.activeCwd ?? "");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dirCache, setDirCache] = useState<Record<string, DirState>>({});
  // ref mirror so fs-change listener can check current cache without re-subscribing
  const dirCacheRef = useRef<Record<string, DirState>>({});
  useEffect(() => { dirCacheRef.current = dirCache; }, [dirCache]);

  const loadDir = useCallback(
    async (relPath: string) => {
      if (!cwd) return;
      setDirCache((c) => ({
        ...c,
        [relPath]: { ...(c[relPath] ?? {}), loading: true, error: undefined },
      }));
      try {
        const res = await fetchTree(cwd, relPath);
        setDirCache((c) => ({
          ...c,
          [relPath]: { loading: false, entries: res.entries },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setDirCache((c) => ({
          ...c,
          [relPath]: { loading: false, error: message },
        }));
      }
    },
    [cwd],
  );

  // Reset cache when cwd changes; auto-load root.
  useEffect(() => {
    setExpanded({ "": true });
    setDirCache({});
    if (cwd) {
      void loadDir("");
    }
  }, [cwd, loadDir]);

  // Subscribe to fs_changed events; reload only the affected parent dir if it
  // is currently visible in the cache. Coalesce bursts so we don't refetch
  // 50× when a build emits a wave of writes.
  const reloadTimers = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!cwd) return;
    const scheduleReload = (parentRel: string) => {
      const cur = reloadTimers.current[parentRel];
      if (cur) window.clearTimeout(cur);
      reloadTimers.current[parentRel] = window.setTimeout(() => {
        delete reloadTimers.current[parentRel];
        void loadDir(parentRel);
      }, 250);
    };
    const unsub = subscribeFsChanges(cwd, ({ relPath }) => {
      // Find every cached dir whose listing this change might invalidate.
      // Generally that's the parent dir of relPath. Only refetch if we have
      // it cached (i.e., the user has expanded it).
      const idx = relPath.lastIndexOf("/");
      const parentRel = idx === -1 ? "" : relPath.slice(0, idx);
      if (parentRel in dirCacheRef.current) scheduleReload(parentRel);
    });
    return () => {
      unsub();
      for (const t of Object.values(reloadTimers.current)) window.clearTimeout(t);
      reloadTimers.current = {};
    };
    // dirCache deliberately excluded: closure reads the latest via setDirCache
    // updater; including it would re-subscribe on every entry change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, loadDir]);

  const toggleDir = useCallback(
    (relPath: string) => {
      setExpanded((e) => {
        const next = { ...e, [relPath]: !e[relPath] };
        return next;
      });
      const isOpening = !expanded[relPath];
      if (isOpening && !dirCache[relPath]) {
        void loadDir(relPath);
      }
    },
    [expanded, dirCache, loadDir],
  );

  if (!cwd) {
    return (
      <div className="file-tree file-tree--empty">
        请在配置面板设置工作目录
      </div>
    );
  }

  return (
    <div className="file-tree">
      <DirChildren
        relPath=""
        depth={0}
        expanded={expanded}
        dirCache={dirCache}
        toggleDir={toggleDir}
        onOpenFile={onOpenFile}
        selectedRelPath={selectedRelPath ?? null}
      />
    </div>
  );
}

interface DirChildrenProps {
  relPath: string;
  depth: number;
  expanded: Record<string, boolean>;
  dirCache: Record<string, DirState>;
  toggleDir: (relPath: string) => void;
  onOpenFile: (relPath: string) => void;
  selectedRelPath: string | null;
}

function DirChildren(props: DirChildrenProps) {
  const { relPath, depth, expanded, dirCache, toggleDir, onOpenFile, selectedRelPath } = props;
  const state = dirCache[relPath];

  if (!state || state.loading) {
    return (
      <div className="file-tree__row file-tree__row--meta" style={indentStyle(depth)}>
        加载中…
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="file-tree__row file-tree__row--error" style={indentStyle(depth)}>
        错误: {state.error}
      </div>
    );
  }
  if (!state.entries || state.entries.length === 0) {
    return (
      <div className="file-tree__row file-tree__row--meta" style={indentStyle(depth)}>
        (空目录)
      </div>
    );
  }

  return (
    <>
      {state.entries.map((entry) => {
        const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
        if (entry.type === "dir") {
          const isOpen = !!expanded[childRel];
          return (
            <div key={childRel}>
              <div
                className="file-tree__row file-tree__row--dir"
                style={indentStyle(depth)}
                onClick={() => toggleDir(childRel)}
                role="button"
              >
                <span className="file-tree__chevron">{isOpen ? "▾" : "▸"}</span>
                <span className="file-tree__icon">📁</span>
                <span className="file-tree__name">{entry.name}</span>
              </div>
              {isOpen && (
                <DirChildren
                  relPath={childRel}
                  depth={depth + 1}
                  expanded={expanded}
                  dirCache={dirCache}
                  toggleDir={toggleDir}
                  onOpenFile={onOpenFile}
                  selectedRelPath={selectedRelPath}
                />
              )}
            </div>
          );
        }
        const isSelected = selectedRelPath === childRel;
        return (
          <div
            key={childRel}
            className={
              "file-tree__row file-tree__row--file" +
              (isSelected ? " file-tree__row--selected" : "")
            }
            style={indentStyle(depth)}
            onClick={() => onOpenFile(childRel)}
            role="button"
          >
            <span className="file-tree__chevron file-tree__chevron--blank" />
            <span className="file-tree__icon">📄</span>
            <span className="file-tree__name">{entry.name}</span>
          </div>
        );
      })}
    </>
  );
}

function indentStyle(depth: number): React.CSSProperties {
  return { paddingLeft: `${depth * 16}px` };
}
