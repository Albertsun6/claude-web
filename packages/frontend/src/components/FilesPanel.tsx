import { useState } from "react";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import "../files.css";

export function FilesPanel() {
  const [selectedRelPath, setSelectedRelPath] = useState<string | null>(null);

  return (
    <div className="files-panel">
      <div className="files-panel__tree">
        <FileTree
          onOpenFile={setSelectedRelPath}
          selectedRelPath={selectedRelPath}
        />
      </div>
      <div className="files-panel__viewer">
        <FileViewer relPath={selectedRelPath} />
      </div>
    </div>
  );
}
