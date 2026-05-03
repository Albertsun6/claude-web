// StageBoard — center column of HarnessPage.
// Shows the 10-stage pipeline for a selected Issue.
// M1: manual stage creation + status transitions. No agent automation yet.

import { useState } from "react";
import type { Issue, Stage } from "./useHarnessApi";

interface Props {
  issue: Issue;
  stages: Stage[];
  loading: boolean;
  onAddStage: (issueId: string, kind: string) => void;
  onStageStatusChange: (stageId: string, status: string) => void;
}

const STAGE_KINDS = [
  "strategy","discovery","spec","compliance","design",
  "implement","test","review","release","observe",
];

const STATUS_COLOR: Record<string, string> = {
  pending: "#888",
  running: "#2196f3",
  awaiting_review: "#ff9800",
  approved: "#4caf50",
  rejected: "#f44336",
  skipped: "#9e9e9e",
  failed: "#e53935",
};

const STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["running", "skipped"],
  running: ["awaiting_review", "failed"],
  awaiting_review: ["approved", "rejected"],
  approved: [],
  rejected: ["pending"],
  skipped: [],
  failed: ["pending"],
};

const WEIGHT_EMOJI: Record<string, string> = {
  heavy: "🔨", light: "⚡", checklist: "☑️",
};

export function StageBoard({ issue, stages, loading, onAddStage, onStageStatusChange }: Props) {
  const [selectedKind, setSelectedKind] = useState<string>("");

  const existingKinds = new Set(stages.map((s) => s.kind));
  const availableKinds = STAGE_KINDS.filter((k) => !existingKinds.has(k));

  const handleAdd = () => {
    if (!selectedKind) return;
    onAddStage(issue.id, selectedKind);
    setSelectedKind("");
  };

  return (
    <div className="stage-board">
      <div className="stage-board-header">
        <div className="stage-board-title">
          <span className={`issue-priority priority-${issue.priority}`}>{issue.priority}</span>
          <strong>{issue.title}</strong>
        </div>
        <div className="stage-board-meta">
          status: <code>{issue.status}</code>
        </div>
      </div>

      {loading && <div className="harness-loading">加载中…</div>}

      <div className="stage-list">
        {stages.length === 0 && !loading && (
          <div className="harness-empty-hint">还没有 Stage — 在下方添加。</div>
        )}

        {stages.map((stage) => {
          const transitions = STATUS_TRANSITIONS[stage.status] ?? [];
          return (
            <div key={stage.id} className={`stage-card stage-status-${stage.status}`}>
              <div className="stage-card-header">
                <span className="stage-weight">{WEIGHT_EMOJI[stage.weight] ?? "•"}</span>
                <span className="stage-kind">{stage.kind}</span>
                <span
                  className="stage-status-badge"
                  style={{ background: STATUS_COLOR[stage.status] ?? "#888" }}
                >
                  {stage.status}
                </span>
              </div>

              <div className="stage-card-meta">
                agent: <code>{stage.assigned_agent_profile}</code>
              </div>

              {transitions.length > 0 && (
                <div className="stage-transitions">
                  {transitions.map((next) => (
                    <button
                      key={next}
                      className="stage-transition-btn"
                      style={{ borderColor: STATUS_COLOR[next] ?? "#888" }}
                      onClick={() => onStageStatusChange(stage.id, next)}
                    >
                      → {next}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add stage */}
      {availableKinds.length > 0 && (
        <div className="stage-add-row">
          <select
            value={selectedKind}
            onChange={(e) => setSelectedKind(e.target.value)}
          >
            <option value="">添加 Stage…</option>
            {availableKinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button
            onClick={handleAdd}
            disabled={!selectedKind}
            className="harness-btn-primary"
          >
            添加
          </button>
        </div>
      )}

      {stages.length === STAGE_KINDS.length && (
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 8 }}>全部 10 个 Stage 已创建。</div>
      )}
    </div>
  );
}
