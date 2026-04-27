import React, { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import {
  fetchGitBranches,
  fetchGitDiff,
  fetchGitLog,
  fetchGitStatus,
  type GitBranches,
  type GitLogEntry,
  type GitStatus,
  type GitStatusFile,
} from "../api/git";
import { GitDiff } from "./GitDiff";
import "../git.css";

type Tab = "status" | "log" | "branches";

function fileColorClass(f: GitStatusFile): string {
  // staged (index) takes priority for green
  const idx = f.indexStatus;
  const wt = f.workingStatus;
  if (idx === "?" && wt === "?") return "git-file-untracked";
  if (idx === "D" || wt === "D") return "git-file-deleted";
  if (idx !== " " && idx !== "?") return "git-file-staged";
  if (wt !== " " && wt !== "?") return "git-file-modified";
  return "";
}

function statusLabel(f: GitStatusFile): string {
  return `${f.indexStatus}${f.workingStatus}`.trim() || "  ";
}

export const GitPanel: React.FC = () => {
  const cwd = useStore((s) => s.activeCwd ?? "");
  const [tab, setTab] = useState<Tab>("status");

  return (
    <div className="git-panel">
      <div className="git-tabs">
        <button
          className={tab === "status" ? "git-tab active" : "git-tab"}
          onClick={() => setTab("status")}
        >
          Status
        </button>
        <button
          className={tab === "log" ? "git-tab active" : "git-tab"}
          onClick={() => setTab("log")}
        >
          Log
        </button>
        <button
          className={tab === "branches" ? "git-tab active" : "git-tab"}
          onClick={() => setTab("branches")}
        >
          Branches
        </button>
      </div>
      {!cwd ? (
        <div className="git-empty">Set a cwd to view git info.</div>
      ) : tab === "status" ? (
        <StatusTab cwd={cwd} />
      ) : tab === "log" ? (
        <LogTab cwd={cwd} />
      ) : (
        <BranchesTab cwd={cwd} />
      )}
    </div>
  );
};

const StatusTab: React.FC<{ cwd: string }> = ({ cwd }) => {
  const [data, setData] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchGitStatus(cwd);
      setData(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <div className="git-loading">Loading…</div>;
  if (error) return <div className="git-error">Error: {error}</div>;
  if (!data) return null;

  return (
    <div className="git-status">
      <div className="git-header">
        <div className="git-branch-line">
          <strong>{data.branch ?? "(detached)"}</strong>
          {data.ahead > 0 && <span className="git-ahead">↑{data.ahead}</span>}
          {data.behind > 0 && <span className="git-behind">↓{data.behind}</span>}
        </div>
        <button className="git-refresh" onClick={load} disabled={loading}>
          ↻ Refresh
        </button>
      </div>
      {data.files.length === 0 ? (
        <div className="git-empty">Working tree clean.</div>
      ) : (
        <ul className="git-file-list">
          {data.files.map((f) => {
            const key = f.path;
            const isOpen = expanded === key;
            return (
              <li key={key} className={`git-file ${fileColorClass(f)}`}>
                <button
                  className="git-file-row"
                  onClick={() => setExpanded(isOpen ? null : key)}
                >
                  <span className="git-file-status">{statusLabel(f)}</span>
                  <span className="git-file-path">{f.path}</span>
                </button>
                {isOpen && (
                  <FileDiff
                    cwd={cwd}
                    path={f.path}
                    staged={f.indexStatus !== " " && f.indexStatus !== "?"}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const FileDiff: React.FC<{ cwd: string; path: string; staged: boolean }> = ({
  cwd,
  path,
  staged,
}) => {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showStaged, setShowStaged] = useState(staged);

  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    setError(null);
    fetchGitDiff(cwd, path, showStaged)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, path, showStaged]);

  return (
    <div className="git-file-diff">
      <div className="git-diff-toggle">
        <label>
          <input
            type="checkbox"
            checked={showStaged}
            onChange={(e) => setShowStaged(e.target.checked)}
          />{" "}
          staged
        </label>
      </div>
      {error ? (
        <div className="git-error">Error: {error}</div>
      ) : diff === null ? (
        <div className="git-loading">Loading diff…</div>
      ) : (
        <GitDiff diff={diff} />
      )}
    </div>
  );
};

const LogTab: React.FC<{ cwd: string }> = ({ cwd }) => {
  const [entries, setEntries] = useState<GitLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setEntries(null);
    fetchGitLog(cwd, 20)
      .then((es) => {
        if (!cancelled) setEntries(es);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  if (error) return <div className="git-error">Error: {error}</div>;
  if (!entries) return <div className="git-loading">Loading…</div>;
  if (entries.length === 0) return <div className="git-empty">No commits.</div>;

  return (
    <ul className="git-log">
      {entries.map((e) => {
        const isOpen = expanded === e.sha;
        return (
          <li key={e.sha} className="git-log-entry">
            <button
              className="git-log-row"
              onClick={() => setExpanded(isOpen ? null : e.sha)}
            >
              <code className="git-sha">{e.sha}</code>
              <span className="git-log-subject">{e.subject}</span>
              <span className="git-log-meta">
                {e.author} · {e.relDate}
              </span>
            </button>
            {isOpen && (
              <div className="git-log-detail">
                <div>
                  <strong>Author:</strong> {e.author}
                </div>
                <div>
                  <strong>Date:</strong> {e.relDate}
                </div>
                <div>
                  <strong>Subject:</strong> {e.subject}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

const BranchesTab: React.FC<{ cwd: string }> = ({ cwd }) => {
  const [data, setData] = useState<GitBranches | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    fetchGitBranches(cwd)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  if (error) return <div className="git-error">Error: {error}</div>;
  if (!data) return <div className="git-loading">Loading…</div>;
  if (data.branches.length === 0)
    return <div className="git-empty">No branches.</div>;

  const local = data.branches.filter((b) => !b.isRemote);
  const remote = data.branches.filter((b) => b.isRemote);

  return (
    <div className="git-branches">
      <div className="git-branch-section">
        <h4>Local</h4>
        <ul>
          {local.map((b) => (
            <li
              key={b.name}
              className={b.isCurrent ? "git-branch-item current" : "git-branch-item"}
            >
              {b.isCurrent ? "* " : "  "}
              {b.name}
            </li>
          ))}
        </ul>
      </div>
      {remote.length > 0 && (
        <div className="git-branch-section">
          <h4>Remote</h4>
          <ul>
            {remote.map((b) => (
              <li key={b.name} className="git-branch-item remote">
                {b.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
