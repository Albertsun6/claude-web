import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { authFetch } from "../auth";

interface HelpModalProps {
  onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 尝试从缓存加载
    const cached = sessionStorage.getItem("help_markdown");
    if (cached) {
      setMarkdown(cached);
      setLoading(false);
      // 后台更新
      fetchMarkdown();
      return;
    }

    // 直接加载
    fetchMarkdown();
  }, []);

  async function fetchMarkdown() {
    try {
      const resp = await authFetch("/api/help");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const text = await resp.text();
      sessionStorage.setItem("help_markdown", text);
      setMarkdown(text);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal help-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-header">
          <h3>使用手册</h3>
          <button
            className="close-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="help-content">
          {loading && (
            <div className="help-loading">
              <div className="spinner"></div>
              <p>加载中…</p>
            </div>
          )}

          {error && (
            <div className="help-error">
              {error}
            </div>
          )}

          {markdown && !loading && (
            <div className="markdown">
              <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                {markdown}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
