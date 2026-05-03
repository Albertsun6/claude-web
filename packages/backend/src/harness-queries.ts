// harness-queries.ts — CRUD helpers over harness.db (M1 minimum slice)
//
// Keeps harness-store.ts focused on DB open/migration; business CRUD lives here.
// All writes go through audit-log append (harness-audit.jsonl).
//
// M1 scope: Initiative / Issue / Stage / Decision — minimal fields for the
// Web /harness board to demonstrate the 5-state pipeline end-to-end.

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const AUDIT_PATH = join(homedir(), ".claude-web", "harness-audit.jsonl");

function audit(db: Database.Database, action: string, entity: string, id: string, data: unknown): void {
  const entry = JSON.stringify({ ts: Date.now(), action, entity, id, data }) + "\n";
  // fire-and-forget; audit failures must never block business writes
  appendFile(AUDIT_PATH, entry).catch(() => {});
}

// ---------------------------------------------------------------------------
// Project sync (harness_project mirrors projects.json via upsert on demand)
// ---------------------------------------------------------------------------

export function ensureHarnessProject(db: Database.Database, projectId: string, cwd?: string): void {
  const effectiveCwd = cwd ?? projectId;
  const name = effectiveCwd.split("/").pop() ?? effectiveCwd;
  const worktreeRoot = effectiveCwd + "/.claude-worktrees";
  // Two possible conflicts: id PK or cwd UNIQUE.
  // INSERT OR IGNORE handles both — if either constraint fires, skip silently.
  db.prepare(`
    INSERT OR IGNORE INTO harness_project(id, cwd, name, worktree_root, harness_enabled, created_at)
    VALUES(?, ?, ?, ?, 1, ?)
  `).run(projectId, effectiveCwd, name, worktreeRoot, Date.now());
}

// ---------------------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------------------

export interface InitiativeRow {
  id: string;
  project_id: string;
  title: string;
  intent: string;
  kpis_json: string;
  status: "draft" | "active" | "paused" | "done";
  owner_human: string;
  methodology_version: string;
  created_at: number;
  updated_at: number;
}

export interface CreateInitiativeInput {
  projectId: string;
  cwd?: string;
  title: string;
  intent?: string;
  ownerHuman?: string;
}

export function createInitiative(db: Database.Database, input: CreateInitiativeInput): InitiativeRow {
  // Upsert the harness_project row so the FK constraint passes.
  ensureHarnessProject(db, input.projectId, input.cwd);
  const id = randomUUID();
  const now = Date.now();
  const row: InitiativeRow = {
    id,
    project_id: input.projectId,
    title: input.title,
    intent: input.intent ?? "",
    kpis_json: "[]",
    status: "draft",
    owner_human: input.ownerHuman ?? "user",
    methodology_version: "1.0",
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO initiative(id,project_id,title,intent,kpis_json,status,owner_human,methodology_version,created_at,updated_at)
    VALUES(@id,@project_id,@title,@intent,@kpis_json,@status,@owner_human,@methodology_version,@created_at,@updated_at)
  `).run(row);
  audit(db, "create", "initiative", id, { title: input.title });
  return row;
}

export function listInitiatives(db: Database.Database, projectId: string): InitiativeRow[] {
  return db.prepare("SELECT * FROM initiative WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as InitiativeRow[];
}

export function getInitiative(db: Database.Database, id: string): InitiativeRow | null {
  return (db.prepare("SELECT * FROM initiative WHERE id = ?").get(id) as InitiativeRow | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export interface IssueRow {
  id: string;
  project_id: string;
  initiative_id: string | null;
  source: string;
  title: string;
  body: string;
  labels_json: string;
  priority: string;
  status: string;
  retrospective_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateIssueInput {
  projectId: string;
  initiativeId?: string;
  title: string;
  body?: string;
  priority?: "low" | "normal" | "high" | "critical";
  source?: string;
}

export function createIssue(db: Database.Database, input: CreateIssueInput): IssueRow {
  const id = randomUUID();
  const now = Date.now();
  const row: IssueRow = {
    id,
    project_id: input.projectId,
    initiative_id: input.initiativeId ?? null,
    source: input.source ?? "manual",
    title: input.title,
    body: input.body ?? "",
    labels_json: "[]",
    priority: input.priority ?? "normal",
    status: "triaged",
    retrospective_id: null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO issue(id,project_id,initiative_id,source,title,body,labels_json,priority,status,retrospective_id,created_at,updated_at)
    VALUES(@id,@project_id,@initiative_id,@source,@title,@body,@labels_json,@priority,@status,@retrospective_id,@created_at,@updated_at)
  `).run(row);
  audit(db, "create", "issue", id, { title: input.title, priority: row.priority });
  return row;
}

export function listIssues(db: Database.Database, opts: { projectId?: string; initiativeId?: string }): IssueRow[] {
  if (opts.initiativeId) {
    return db.prepare("SELECT * FROM issue WHERE initiative_id = ? ORDER BY created_at DESC").all(opts.initiativeId) as IssueRow[];
  }
  if (opts.projectId) {
    return db.prepare("SELECT * FROM issue WHERE project_id = ? ORDER BY created_at DESC").all(opts.projectId) as IssueRow[];
  }
  return db.prepare("SELECT * FROM issue ORDER BY created_at DESC LIMIT 100").all() as IssueRow[];
}

export function getIssue(db: Database.Database, id: string): IssueRow | null {
  return (db.prepare("SELECT * FROM issue WHERE id = ?").get(id) as IssueRow | undefined) ?? null;
}

export function updateIssueStatus(db: Database.Database, id: string, status: string): boolean {
  const result = db.prepare("UPDATE issue SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id);
  if (result.changes > 0) audit(db, "update_status", "issue", id, { status });
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export interface StageRow {
  id: string;
  issue_id: string;
  kind: string;
  status: string;
  weight: string;
  gate_required: number;
  assigned_agent_profile: string;
  methodology_id: string;
  input_artifact_ids_json: string;
  output_artifact_ids_json: string;
  review_verdict_ids_json: string;
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
}

export interface CreateStageInput {
  issueId: string;
  kind: string;
  weight?: "heavy" | "light" | "checklist";
  agentProfileId?: string;
  methodologyId?: string;
}

export function createStage(db: Database.Database, input: CreateStageInput): StageRow {
  const id = randomUUID();
  const now = Date.now();

  // Ensure a methodology stub row exists (M1 uses a global stub)
  const methodologyId = input.methodologyId ?? ensureStubMethodology(db, input.kind);

  const row: StageRow = {
    id,
    issue_id: input.issueId,
    kind: input.kind,
    status: "pending",
    weight: input.weight ?? "light",
    gate_required: 1,
    assigned_agent_profile: input.agentProfileId ?? "PM",
    methodology_id: methodologyId,
    input_artifact_ids_json: "[]",
    output_artifact_ids_json: "[]",
    review_verdict_ids_json: "[]",
    started_at: null,
    ended_at: null,
    created_at: now,
  };
  db.prepare(`
    INSERT INTO stage(id,issue_id,kind,status,weight,gate_required,assigned_agent_profile,
      methodology_id,input_artifact_ids_json,output_artifact_ids_json,review_verdict_ids_json,
      started_at,ended_at,created_at)
    VALUES(@id,@issue_id,@kind,@status,@weight,@gate_required,@assigned_agent_profile,
      @methodology_id,@input_artifact_ids_json,@output_artifact_ids_json,@review_verdict_ids_json,
      @started_at,@ended_at,@created_at)
  `).run(row);
  audit(db, "create", "stage", id, { issueId: input.issueId, kind: input.kind });
  return row;
}

export function listStages(db: Database.Database, issueId: string): StageRow[] {
  return db.prepare("SELECT * FROM stage WHERE issue_id = ? ORDER BY created_at ASC").all(issueId) as StageRow[];
}

export function setStageStatus(
  db: Database.Database,
  stageId: string,
  status: string
): boolean {
  const now = Date.now();
  const startedAt = status === "running" ? now : null;
  const endedAt = ["approved", "rejected", "skipped", "failed"].includes(status) ? now : null;

  const result = db.prepare(`
    UPDATE stage
    SET status = ?,
        started_at = CASE WHEN ? IS NOT NULL THEN ? ELSE started_at END,
        ended_at   = CASE WHEN ? IS NOT NULL THEN ? ELSE ended_at   END
    WHERE id = ?
  `).run(status, startedAt, startedAt, endedAt, endedAt, stageId);

  if (result.changes > 0) audit(db, "set_status", "stage", stageId, { status });
  return result.changes > 0;
}

// M1 stub: ensure a placeholder methodology row exists for any stage kind
function ensureStubMethodology(db: Database.Database, kind: string): string {
  const existing = db.prepare(
    "SELECT id FROM methodology WHERE stage_kind = ? AND version = 'stub'"
  ).get(kind) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = randomUUID();
  db.prepare(`
    INSERT INTO methodology(id,stage_kind,version,applies_to,content_ref,approved_by,approved_at)
    VALUES(?,?,'stub','universal','[M1 stub — methodology not yet defined]','system',?)
  `).run(id, kind, Date.now());
  return id;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export interface DecisionRow {
  id: string;
  stage_id: string;
  requested_by: string;
  options_json: string;
  chosen_option: string | null;
  decided_by: string | null;
  rationale: string | null;
  decided_at: number | null;
  created_at: number;
}

export interface CreateDecisionInput {
  stageId: string;
  requestedBy?: string;
  options: string[];
}

export function createDecision(db: Database.Database, input: CreateDecisionInput): DecisionRow {
  const id = randomUUID();
  const now = Date.now();
  const row: DecisionRow = {
    id,
    stage_id: input.stageId,
    requested_by: input.requestedBy ?? "system",
    options_json: JSON.stringify(input.options),
    chosen_option: null,
    decided_by: null,
    rationale: null,
    decided_at: null,
    created_at: now,
  };
  db.prepare(`
    INSERT INTO decision(id,stage_id,requested_by,options_json,chosen_option,decided_by,rationale,decided_at,created_at)
    VALUES(@id,@stage_id,@requested_by,@options_json,@chosen_option,@decided_by,@rationale,@decided_at,@created_at)
  `).run(row);
  audit(db, "create", "decision", id, { stageId: input.stageId, options: input.options });
  return row;
}

export function listPendingDecisions(db: Database.Database, stageId: string): DecisionRow[] {
  return db.prepare(
    "SELECT * FROM decision WHERE stage_id = ? AND chosen_option IS NULL ORDER BY created_at DESC"
  ).all(stageId) as DecisionRow[];
}

export function resolveDecision(
  db: Database.Database,
  id: string,
  chosenOption: string,
  decidedBy: string,
  rationale?: string
): boolean {
  const now = Date.now();
  const result = db.prepare(`
    UPDATE decision
    SET chosen_option = ?, decided_by = ?, rationale = ?, decided_at = ?
    WHERE id = ? AND chosen_option IS NULL
  `).run(chosenOption, decidedBy, rationale ?? null, now, id);
  if (result.changes > 0) audit(db, "resolve", "decision", id, { chosenOption, decidedBy });
  return result.changes > 0;
}
