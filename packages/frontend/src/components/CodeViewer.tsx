import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorState, type Extension } from "@codemirror/state";
import { useStore } from "../store";
import { fetchFile } from "../api/fs";

interface CodeViewerProps {
  relPath: string | null;
}

interface FileState {
  loading: boolean;
  error?: string;
  content?: string;
  size?: number;
}

function extensionFor(relPath: string): string {
  const dot = relPath.lastIndexOf(".");
  if (dot < 0) return "";
  return relPath.slice(dot).toLowerCase();
}

async function loadLanguageExtension(
  relPath: string,
): Promise<Extension | null> {
  const ext = extensionFor(relPath);
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs": {
      const mod = await import("@codemirror/lang-javascript");
      const isJsx = ext === ".tsx" || ext === ".jsx";
      const isTs = ext === ".ts" || ext === ".tsx";
      return mod.javascript({ jsx: isJsx, typescript: isTs });
    }
    case ".json": {
      const mod = await import("@codemirror/lang-json");
      return mod.json();
    }
    case ".md":
    case ".markdown": {
      const mod = await import("@codemirror/lang-markdown");
      return mod.markdown();
    }
    case ".css": {
      const mod = await import("@codemirror/lang-css");
      return mod.css();
    }
    case ".html":
    case ".htm": {
      const mod = await import("@codemirror/lang-html");
      return mod.html();
    }
    case ".py": {
      const mod = await import("@codemirror/lang-python");
      return mod.python();
    }
    default:
      return null;
  }
}

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function CodeViewer({ relPath }: CodeViewerProps) {
  const cwd = useStore((s) => s.cwd);
  const [state, setState] = useState<FileState>({ loading: false });
  const [langExt, setLangExt] = useState<Extension | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!relPath || !cwd) {
      setState({ loading: false });
      setLangExt(null);
      return;
    }
    setState({ loading: true });
    setLangExt(null);

    void (async () => {
      try {
        const res = await fetchFile(cwd, relPath);
        if (cancelled) return;
        setState({
          loading: false,
          content: res.content,
          size: res.size,
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ loading: false, error: message });
      }

      try {
        const ext = await loadLanguageExtension(relPath);
        if (cancelled) return;
        setLangExt(ext);
      } catch {
        if (cancelled) return;
        setLangExt(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cwd, relPath]);

  if (!relPath) {
    return (
      <div className="code-viewer code-viewer--empty">
        从左侧选择文件查看
      </div>
    );
  }

  return (
    <div className="code-viewer">
      <div className="code-viewer__header">
        <span className="code-viewer__path">{relPath}</span>
        <span className="code-viewer__size">{formatSize(state.size)}</span>
      </div>
      <div className="code-viewer__body">
        {state.loading && (
          <div className="code-viewer__meta">加载中…</div>
        )}
        {state.error && (
          <div className="code-viewer__error">错误: {state.error}</div>
        )}
        {!state.loading && !state.error && state.content !== undefined && (
          <CodeMirror
            value={state.content}
            theme={oneDark}
            editable={false}
            readOnly
            extensions={[
              EditorState.readOnly.of(true),
              ...(langExt ? [langExt] : []),
            ]}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
            }}
          />
        )}
      </div>
    </div>
  );
}
