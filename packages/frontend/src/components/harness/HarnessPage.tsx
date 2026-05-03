// HarnessPage — M1 三栏 IA: InitiativeTree | StageBoard | RunPanel(stub)
//
// Layout:
//   ┌──────────────┬──────────────────────────┬──────────────────┐
//   │ Initiative   │  Stage 看板               │  Run / Verdict   │
//   │ Tree (left)  │  (center)                 │  stub (right)    │
//   └──────────────┴──────────────────────────┴──────────────────┘
//
// State management is local (useState / useEffect). No Zustand harness slice
// in M1 — we add it in M2 when agent runs need reactive updates.

import { useState, useEffect, useCallback } from "react";
import { useStore } from "../../store";
import "../../harness.css";
import { harnessApi, type Initiative, type Issue, type Stage } from "./useHarnessApi";
import { InitiativeTree } from "./InitiativeTree";
import { StageBoard } from "./StageBoard";

export function HarnessPage() {
  const activeCwd = useStore((s) => s.activeCwd);
  // Use activeCwd as a proxy for projectId — M1 harness_project row auto-created when needed
  const projectId = activeCwd ?? "";

  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [selectedInitiativeId, setSelectedInitiativeId] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInitiatives = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await harnessApi.listInitiatives(projectId);
      setInitiatives(data);
    } catch (e: any) {
      setError(e.message);
    }
  }, [projectId]);

  const loadIssues = useCallback(async () => {
    if (!selectedInitiativeId) {
      setIssues([]);
      return;
    }
    try {
      const data = await harnessApi.listIssues({ initiativeId: selectedInitiativeId });
      setIssues(data);
    } catch (e: any) {
      setError(e.message);
    }
  }, [selectedInitiativeId]);

  const loadIssue = useCallback(async (id: string) => {
    try {
      setLoading(true);
      const data = await harnessApi.getIssue(id);
      setSelectedIssue(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadInitiatives(); }, [loadInitiatives]);
  useEffect(() => { loadIssues(); }, [loadIssues]);
  useEffect(() => {
    if (selectedIssueId) loadIssue(selectedIssueId);
    else setSelectedIssue(null);
  }, [selectedIssueId, loadIssue]);

  const handleCreateInitiative = async (title: string) => {
    if (!projectId || !title.trim()) return;
    try {
      await harnessApi.createInitiative(projectId, title.trim());
      await loadInitiatives();
    } catch (e: any) { setError(e.message); }
  };

  const handleCreateIssue = async (title: string) => {
    if (!projectId || !selectedInitiativeId || !title.trim()) return;
    try {
      const issue = await harnessApi.createIssue(projectId, selectedInitiativeId, title.trim());
      await loadIssues();
      setSelectedIssueId(issue.id);
    } catch (e: any) { setError(e.message); }
  };

  const handleAddStage = async (issueId: string, kind: string) => {
    try {
      await harnessApi.createStage(issueId, kind);
      if (selectedIssueId === issueId) await loadIssue(issueId);
    } catch (e: any) { setError(e.message); }
  };

  const handleStageStatusChange = async (stageId: string, status: string) => {
    try {
      await harnessApi.setStageStatus(stageId, status);
      if (selectedIssueId) await loadIssue(selectedIssueId);
    } catch (e: any) { setError(e.message); }
  };

  if (!projectId) {
    return (
      <div className="harness-empty">
        <p>请先在左侧选择一个项目，再打开 Harness 看板。</p>
      </div>
    );
  }

  return (
    <div className="harness-layout">
      {error && (
        <div className="harness-error" onClick={() => setError(null)}>
          ⚠ {error} <span style={{ opacity: 0.6 }}>(点击关闭)</span>
        </div>
      )}

      {/* Left: Initiative tree */}
      <div className="harness-col harness-col-left">
        <InitiativeTree
          initiatives={initiatives}
          issues={issues}
          selectedInitiativeId={selectedInitiativeId}
          selectedIssueId={selectedIssueId}
          onSelectInitiative={(id) => {
            setSelectedInitiativeId(id);
            setSelectedIssueId(null);
          }}
          onSelectIssue={setSelectedIssueId}
          onCreateInitiative={handleCreateInitiative}
          onCreateIssue={handleCreateIssue}
        />
      </div>

      {/* Center: Stage board */}
      <div className="harness-col harness-col-center">
        {selectedIssue ? (
          <StageBoard
            issue={selectedIssue}
            stages={selectedIssue.stages ?? []}
            loading={loading}
            onAddStage={handleAddStage}
            onStageStatusChange={handleStageStatusChange}
          />
        ) : (
          <div className="harness-empty">
            {selectedInitiativeId
              ? issues.length === 0
                ? "此 Initiative 下还没有 Issue — 在左侧创建一个。"
                : "选择一个 Issue 查看 Stage 看板。"
              : "选择一个 Initiative 开始。"}
          </div>
        )}
      </div>

      {/* Right: Run / verdict stub */}
      <div className="harness-col harness-col-right">
        <div className="harness-runpanel-stub">
          <div className="harness-stub-badge">M2</div>
          <p>Agent Run 面板</p>
          <p style={{ fontSize: 11, opacity: 0.5 }}>M2 实装 Coder / Reviewer</p>
        </div>
      </div>
    </div>
  );
}
