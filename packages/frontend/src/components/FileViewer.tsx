// Routes file preview by extension to the right viewer:
//   - image / pdf / video / audio → render the blob URL directly
//   - markdown → react-markdown
//   - other text → CodeViewer (CodeMirror with language pack)

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { fetchFile } from "../api/fs";
import { authFetch } from "../auth";
import { subscribeFsChanges } from "../ws-client";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

const CodeViewer = lazy(() =>
  import("./CodeViewer").then((m) => ({ default: m.CodeViewer })),
);

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".heic"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".m4a"]);
const PDF_EXTS = new Set([".pdf"]);
const MD_EXTS = new Set([".md", ".markdown"]);

function extOf(p: string): string {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i).toLowerCase();
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

interface FileViewerProps {
  relPath: string | null;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? "";

export function FileViewer({ relPath }: FileViewerProps) {
  const cwd = useStore((s) => s.activeCwd ?? "");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [mdContent, setMdContent] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // bump on fs_changed for the current file → forces refetch (and propagates to CodeViewer)
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!cwd || !relPath) return;
    let lastFiredAt = 0;
    const unsub = subscribeFsChanges(cwd, ({ change, relPath: changed }) => {
      if (changed !== relPath) return;
      if (change === "unlink") {
        setError("文件已被删除");
        return;
      }
      // throttle to ~1 reload/sec for the same file
      const now = Date.now();
      if (now - lastFiredAt < 1000) return;
      lastFiredAt = now;
      setReloadKey((k) => k + 1);
    });
    return unsub;
  }, [cwd, relPath]);

  const ext = relPath ? extOf(relPath) : "";
  const kind = useMemo<"image" | "video" | "audio" | "pdf" | "md" | "code" | "none">(() => {
    if (!relPath) return "none";
    if (IMAGE_EXTS.has(ext)) return "image";
    if (VIDEO_EXTS.has(ext)) return "video";
    if (AUDIO_EXTS.has(ext)) return "audio";
    if (PDF_EXTS.has(ext)) return "pdf";
    if (MD_EXTS.has(ext)) return "md";
    return "code";
  }, [relPath, ext]);

  useEffect(() => {
    setError(null);
    setSize(null);
    setMdContent(null);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);

    if (!relPath || !cwd) return;

    let cancelled = false;
    if (kind === "image" || kind === "video" || kind === "audio" || kind === "pdf") {
      setLoading(true);
      const params = new URLSearchParams({ root: cwd, path: relPath });
      authFetch(`${API_BASE}/api/fs/blob?${params.toString()}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const b = await r.blob();
          if (cancelled) return;
          setBlobUrl(URL.createObjectURL(b));
          setSize(b.size);
        })
        .catch((err) => { if (!cancelled) setError(err.message ?? String(err)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else if (kind === "md") {
      setLoading(true);
      fetchFile(cwd, relPath)
        .then((res) => {
          if (cancelled) return;
          setMdContent(res.content);
          setSize(res.size);
        })
        .catch((err) => { if (!cancelled) setError(err.message ?? String(err)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    // 'code' → CodeViewer handles its own fetch via fetchFile

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relPath, cwd, kind, reloadKey]);

  if (!relPath) {
    return (
      <div className="file-viewer-empty">
        <span style={{ color: "var(--text-dim)", fontSize: 13 }}>从左侧文件树选一个文件预览</span>
      </div>
    );
  }

  const header = (
    <div className="file-viewer-header">
      <code className="file-viewer-path">{relPath}</code>
      {size !== null && <span className="file-viewer-size">{fmtSize(size)}</span>}
    </div>
  );

  if (loading) return (
    <div className="file-viewer">{header}<div className="file-viewer-empty">加载中…</div></div>
  );
  if (error) return (
    <div className="file-viewer">{header}<div className="file-viewer-empty file-viewer-error">{error}</div></div>
  );

  if (kind === "image" && blobUrl) {
    return (
      <div className="file-viewer">
        {header}
        <div className="file-viewer-image-wrap">
          <img src={blobUrl} alt={relPath} />
        </div>
      </div>
    );
  }
  if (kind === "video" && blobUrl) {
    return (
      <div className="file-viewer">
        {header}
        <video src={blobUrl} controls className="file-viewer-media" />
      </div>
    );
  }
  if (kind === "audio" && blobUrl) {
    return (
      <div className="file-viewer">
        {header}
        <audio src={blobUrl} controls />
      </div>
    );
  }
  if (kind === "pdf" && blobUrl) {
    return (
      <div className="file-viewer">
        {header}
        <iframe src={blobUrl} title={relPath} className="file-viewer-pdf" />
      </div>
    );
  }
  if (kind === "md" && mdContent !== null) {
    return (
      <div className="file-viewer">
        {header}
        <div className="file-viewer-md markdown">
          <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{mdContent}</ReactMarkdown>
        </div>
      </div>
    );
  }
  // code path: hand off to CodeViewer (it does its own fetch + lang-pack lazy load)
  return (
    <Suspense fallback={<div className="file-viewer-empty">加载编辑器…</div>}>
      <CodeViewer relPath={relPath} reloadKey={reloadKey} />
    </Suspense>
  );
}
