// InitiativeTree — left column of HarnessPage.
// Shows Initiative list with collapse/expand + Issue list under selected initiative.

import { useState } from "react";
import type { Initiative, Issue } from "./useHarnessApi";

interface Props {
  initiatives: Initiative[];
  issues: Issue[];
  selectedInitiativeId: string | null;
  selectedIssueId: string | null;
  onSelectInitiative: (id: string) => void;
  onSelectIssue: (id: string) => void;
  onCreateInitiative: (title: string) => void;
  onCreateIssue: (title: string) => void;
}

const STATUS_EMOJI: Record<string, string> = {
  draft: "📝", active: "🟢", paused: "⏸", done: "✅",
  inbox: "📥", triaged: "📋", planned: "🗓", in_progress: "⚙️",
  blocked: "🚫", wont_fix: "🗑",
};

export function InitiativeTree({
  initiatives, issues, selectedInitiativeId, selectedIssueId,
  onSelectInitiative, onSelectIssue, onCreateInitiative, onCreateIssue,
}: Props) {
  const [newInitTitle, setNewInitTitle] = useState("");
  const [showNewInit, setShowNewInit] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [showNewIssue, setShowNewIssue] = useState(false);

  const submitInitiative = () => {
    if (!newInitTitle.trim()) return;
    onCreateInitiative(newInitTitle);
    setNewInitTitle("");
    setShowNewInit(false);
  };

  const submitIssue = () => {
    if (!newIssueTitle.trim()) return;
    onCreateIssue(newIssueTitle);
    setNewIssueTitle("");
    setShowNewIssue(false);
  };

  return (
    <div className="initiative-tree">
      <div className="initiative-tree-header">
        <span>Initiatives</span>
        <button className="harness-icon-btn" title="新建 Initiative" onClick={() => setShowNewInit(true)}>＋</button>
      </div>

      {showNewInit && (
        <div className="harness-inline-form">
          <input
            autoFocus
            placeholder="Initiative 标题…"
            value={newInitTitle}
            onChange={(e) => setNewInitTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitInitiative(); if (e.key === "Escape") setShowNewInit(false); }}
          />
          <button onClick={submitInitiative}>创建</button>
          <button onClick={() => setShowNewInit(false)}>取消</button>
        </div>
      )}

      {initiatives.length === 0 && !showNewInit && (
        <div className="harness-empty-hint">还没有 Initiative — 点 ＋ 创建。</div>
      )}

      {initiatives.map((init) => (
        <div key={init.id}>
          <div
            className={`initiative-row ${selectedInitiativeId === init.id ? "selected" : ""}`}
            onClick={() => onSelectInitiative(init.id)}
            title={init.intent || init.title}
          >
            <span className="initiative-status">{STATUS_EMOJI[init.status] ?? "•"}</span>
            <span className="initiative-title">{init.title}</span>
          </div>

          {/* Issues under selected initiative */}
          {selectedInitiativeId === init.id && (
            <div className="issue-list">
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  className={`issue-row ${selectedIssueId === issue.id ? "selected" : ""}`}
                  onClick={() => onSelectIssue(issue.id)}
                  title={issue.body || issue.title}
                >
                  <span className="issue-status">{STATUS_EMOJI[issue.status] ?? "·"}</span>
                  <span className="issue-title">{issue.title}</span>
                  <span className={`issue-priority priority-${issue.priority}`}>{issue.priority}</span>
                </div>
              ))}

              {showNewIssue ? (
                <div className="harness-inline-form">
                  <input
                    autoFocus
                    placeholder="Issue 标题…"
                    value={newIssueTitle}
                    onChange={(e) => setNewIssueTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitIssue(); if (e.key === "Escape") setShowNewIssue(false); }}
                  />
                  <button onClick={submitIssue}>创建</button>
                  <button onClick={() => setShowNewIssue(false)}>取消</button>
                </div>
              ) : (
                <button className="harness-add-issue-btn" onClick={() => setShowNewIssue(true)}>
                  ＋ 新建 Issue
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
