// Full-width file preview overlay sliding over the main column.
// Triggered by clicking a file in the tree; close via X or Esc.

import { useEffect } from "react";
import { useStore } from "../store";
import { FileViewer } from "./FileViewer";

export function FilePreviewPane() {
  const previewFile = useStore((s) => s.previewFile);
  const setPreviewFile = useStore((s) => s.setPreviewFile);

  useEffect(() => {
    if (!previewFile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewFile(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewFile, setPreviewFile]);

  if (!previewFile) return null;

  return (
    <div className="file-preview-pane">
      <div className="file-preview-toolbar">
        <span className="file-preview-title">📄 文件预览</span>
        <button
          className="secondary file-preview-close"
          onClick={() => setPreviewFile(undefined)}
          aria-label="关闭预览"
          title="关闭 (Esc)"
        >
          ✕
        </button>
      </div>
      <div className="file-preview-body">
        <FileViewer relPath={previewFile.relPath} />
      </div>
    </div>
  );
}
