import { FileTree } from "./FileTree";
import { useStore } from "../store";
import "../files.css";

export function FilesPanel() {
  const cwd = useStore((s) => s.activeCwd);
  const previewFile = useStore((s) => s.previewFile);
  const setPreviewFile = useStore((s) => s.setPreviewFile);

  // selection: only highlight when previewing a file in this cwd
  const selectedRelPath =
    previewFile && cwd && previewFile.cwd === cwd ? previewFile.relPath : null;

  return (
    <div className="files-panel files-panel--tree-only">
      <FileTree
        onOpenFile={(relPath) => {
          if (cwd) setPreviewFile({ cwd, relPath });
        }}
        selectedRelPath={selectedRelPath}
      />
    </div>
  );
}
