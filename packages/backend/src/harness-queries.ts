// harness-queries.ts — CRUD helpers over harness.db (M1 minimum slice)
//
// Keeps harness-store.ts focused on DB open/migration; business CRUD lives here.
// All writes go through audit-log append (harness-audit.jsonl).
//
// M1 scope: Initiative / Issue / Stage / Decision — minimal fields for the
// Web /harness board to demonstrate the 5-state pipeline end-to-end.

import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "./data-dir.js";

const AUDIT_PATH = join(DATA_DIR, "harness-audit.jsonl");

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
  /** ADR-020 Week 2 Day 12 — link Issue to upstream PimItem (derived_from). */
  pimItemId?: string;
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
  // pim_item_id (added migration 0008 ADR-020) is a column on issue but NOT
  // part of IssueRow type yet. Pass through dedicated bind to keep IssueRow
  // stable for legacy readers; null = unlinked.
  db.prepare(`
    INSERT INTO issue(id,project_id,initiative_id,source,title,body,labels_json,priority,status,retrospective_id,created_at,updated_at,pim_item_id)
    VALUES(@id,@project_id,@initiative_id,@source,@title,@body,@labels_json,@priority,@status,@retrospective_id,@created_at,@updated_at,@pim_item_id)
  `).run({ ...row, pim_item_id: input.pimItemId ?? null });
  audit(db, "create", "issue", id, {
    title: input.title,
    priority: row.priority,
    ...(input.pimItemId ? { pim_item_id: input.pimItemId } : {}),
  });
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

/**
 * M2 Loop 2: 标 stage 为 failed 并持久化失败原因 + 时间戳。
 *
 * 与 setStageStatus(stageId, "failed") 区别：本方法**显式写入** failed_reason / failed_at，
 * 让失败可从 DB 持久化 state 区分（orphan / spawn_setup / cli / spec_harvest 等）。
 *
 * Loop 1 (schema v102) 加了 nullable 列；Loop 2 写入。
 *
 * Reason 当前枚举（自由文本，但建议用以下 canonical 值，便于 future 查询 / dashboard）：
 *   - 'orphan_after_restart'   — backend 重启清理 active stage（cleanupOrphanStages）
 *   - 'spawn_setup_failed'     — buildContextBundle / createTask 期间 throw
 *   - 'cli_failed'             — runSession 期间 throw（CLI subprocess 错）
 *   - 'spec_harvest_failed'    — harvestSpecArtifact 期间 throw（strategy stage only）
 *
 * Idempotent guard: 如果 stage 已经是 failed 且已有 failed_reason，**不重写**——保留首次失败 reason
 * （v.s. 后续兜底 catch 重写覆盖）。
 */
export function setStageFailed(
  db: Database.Database,
  stageId: string,
  reason: string,
  failedAt: number = Date.now(),
): boolean {
  // Idempotent first-write-wins guard 下沉到单条 SQL（cross m1 应用）：
  // - status='failed' AND failed_reason IS NOT NULL → WHERE 不命中，UPDATE 0 行（首次 reason 保留）
  // - status='failed' AND failed_reason IS NULL → WHERE 命中（旧路径遗漏的 failed 行可补写）
  // - status != 'failed' → WHERE 命中（首次失败写入）
  // 这样跨进程 / 跨 connection 的并发也是原子（SQLite UPDATE 单语句）。
  const result = db.prepare(`
    UPDATE stage
    SET status = 'failed',
        failed_reason = ?,
        failed_at = ?,
        ended_at = COALESCE(ended_at, ?)
    WHERE id = ?
      AND NOT (status = 'failed' AND failed_reason IS NOT NULL)
  `).run(reason, failedAt, failedAt, stageId);

  if (result.changes > 0) {
    audit(db, "set_failed", "stage", stageId, { reason, failedAt });
  }
  return result.changes > 0;
}

/**
 * M2 Loop 3: minimal skip API helper — operator unblock failed stage.
 *
 * 严格语义（plan v2 OQ-G）：
 *   - 仅允许 `failed → skipped` 单向转换
 *   - 已经是 `skipped` 的 stage 视为 idempotent no-op（200 OK）
 *   - 其他 status 拒绝（返回 'invalid_state'，调用方应回 409）
 *
 * **不**做：retry / resume / auto-retry / reset pending / attempt count /
 * parentTaskId / 自动触发 tick。operator skip 后需显式调用
 * `POST /api/harness/scheduler/tick` 推进。
 *
 * Returns:
 *   - { ok: true, alreadySkipped?: true }  — failed → skipped or already skipped
 *   - { ok: false, error: 'not_found' }    — stageId 不存在
 *   - { ok: false, error: 'invalid_state', currentStatus } — 不是 failed/skipped
 */
export function skipFailedStage(
  db: Database.Database,
  stageId: string,
):
  | { ok: true; alreadySkipped?: boolean }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "invalid_state"; currentStatus: string }
{
  const row = db
    .prepare("SELECT status FROM stage WHERE id = ?")
    .get(stageId) as { status: string } | undefined;
  if (!row) return { ok: false, error: "not_found" };

  // Idempotent: already skipped → no-op
  if (row.status === "skipped") return { ok: true, alreadySkipped: true };

  // Strict charter: only failed → skipped
  if (row.status !== "failed") {
    return { ok: false, error: "invalid_state", currentStatus: row.status };
  }

  // failed → skipped
  setStageStatus(db, stageId, "skipped");
  audit(db, "skip", "stage", stageId, { from: "failed" });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Task — M1 mini #3.1: 真 task 行（cross M1 修：避免 context_bundle.task_id orphan）
// ---------------------------------------------------------------------------

export interface TaskRow {
  id: string;
  stage_id: string;
  agent_profile_id: string;
  model: string;
  cwd: string;
  worktree_path: string | null;
  prompt: string;
  skill_set_json: string;
  permission_mode: string;
  context_bundle_id: string;
  run_ids_json: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface CreateTaskInput {
  id: string; // caller-provided so context_bundle.task_id can match
  stageId: string;
  agentProfileId: string;
  model: "opus" | "sonnet" | "haiku";
  cwd: string;
  worktreePath?: string | null;
  prompt: string;
  permissionMode: string;
  contextBundleId: string;
}

export function createTask(db: Database.Database, input: CreateTaskInput): TaskRow {
  const now = Date.now();
  const row: TaskRow = {
    id: input.id,
    stage_id: input.stageId,
    agent_profile_id: input.agentProfileId,
    model: input.model,
    cwd: input.cwd,
    worktree_path: input.worktreePath ?? null,
    prompt: input.prompt,
    skill_set_json: "[]",
    permission_mode: input.permissionMode,
    context_bundle_id: input.contextBundleId,
    run_ids_json: "[]",
    status: "pending",
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO task(id,stage_id,agent_profile_id,model,cwd,worktree_path,prompt,skill_set_json,
      permission_mode,context_bundle_id,run_ids_json,status,created_at,updated_at)
    VALUES(@id,@stage_id,@agent_profile_id,@model,@cwd,@worktree_path,@prompt,@skill_set_json,
      @permission_mode,@context_bundle_id,@run_ids_json,@status,@created_at,@updated_at)
  `).run(row);
  audit(db, "create", "task", input.id, { stageId: input.stageId, contextBundleId: input.contextBundleId });
  return row;
}

// ---------------------------------------------------------------------------
// ContextBundle
// ---------------------------------------------------------------------------

export interface ContextBundleRow {
  id: string;
  task_id: string;
  artifact_refs_json: string;
  max_tokens: number;
  pruned_files_json: string;
  summary: string;
  snapshot_path: string;
  created_at: number;
}

export interface CreateContextBundleInput {
  id?: string;
  taskId: string;
  artifactRefs?: string[];
  maxTokens: number;
  prunedFiles?: string[];
  summary: string;
  snapshotPath: string;
}

export function createContextBundle(
  db: Database.Database,
  input: CreateContextBundleInput
): ContextBundleRow {
  const id = input.id ?? randomUUID();
  const now = Date.now();
  const row: ContextBundleRow = {
    id,
    task_id: input.taskId,
    artifact_refs_json: JSON.stringify(input.artifactRefs ?? []),
    max_tokens: input.maxTokens,
    pruned_files_json: JSON.stringify(input.prunedFiles ?? []),
    summary: input.summary,
    snapshot_path: input.snapshotPath,
    created_at: now,
  };

  db.prepare(`
    INSERT INTO context_bundle(id,task_id,artifact_refs_json,max_tokens,pruned_files_json,summary,snapshot_path,created_at)
    VALUES(@id,@task_id,@artifact_refs_json,@max_tokens,@pruned_files_json,@summary,@snapshot_path,@created_at)
  `).run(row);
  audit(db, "create", "context_bundle", id, { taskId: input.taskId, snapshotPath: input.snapshotPath });
  return row;
}

export interface ArtifactRow {
  id: string;
  stage_id: string;
  kind: string;
  ref: string | null;
  hash: string;
  storage: "inline" | "file";
  content_text: string | null;
  content_path: string | null;
  size_bytes: number;
  metadata_json: string;
  superseded_by: string | null;
  created_at: number;
}

/** M2 v1 (3.2-A'): create artifact row with hash + size_bytes computed.
 *
 * Inline storage only in v1 — content_text 必填，content_path 不支持（file 存储留 v2，
 * 因为需要决定 ~/.vessel/artifacts/<hash>.<ext> 的 file 写入路径策略）。
 *
 * Schema 约束（migration 0001_initial.sql）：
 * - kind ∈ enum (methodology / spec / design_doc / architecture_doc / adr / patch / pr_url
 *   / test_report / coverage_report / review_notes / review_verdict / decision_note
 *   / metric_snapshot / retrospective / changelog_entry)。enum 不在内的 kind 会被 SQLite CHECK 拒
 * - storage='inline' AND content_text IS NOT NULL AND content_path IS NULL（CHECK 约束已 enforce）
 * - hash NOT NULL — sha256 of content_text
 * - size_bytes NOT NULL — Buffer.byteLength of content_text in utf-8
 */
export interface CreateArtifactInput {
  stageId: string;
  kind: string;
  ref?: string | null;
  contentText: string;
  metadata?: Record<string, unknown>;
}

export function createArtifact(db: Database.Database, input: CreateArtifactInput): ArtifactRow {
  if (typeof input.contentText !== "string") {
    throw new Error("createArtifact requires contentText (inline storage only in v1)");
  }
  const id = randomUUID();
  const now = Date.now();
  const hash = createHash("sha256").update(input.contentText, "utf-8").digest("hex");
  const sizeBytes = Buffer.byteLength(input.contentText, "utf-8");

  const row: ArtifactRow = {
    id,
    stage_id: input.stageId,
    kind: input.kind,
    ref: input.ref ?? null,
    hash,
    storage: "inline",
    content_text: input.contentText,
    content_path: null,
    size_bytes: sizeBytes,
    metadata_json: JSON.stringify(input.metadata ?? {}),
    superseded_by: null,
    created_at: now,
  };
  db.prepare(`
    INSERT INTO artifact(id,stage_id,kind,ref,hash,storage,content_text,content_path,size_bytes,metadata_json,superseded_by,created_at)
    VALUES(@id,@stage_id,@kind,@ref,@hash,@storage,@content_text,@content_path,@size_bytes,@metadata_json,@superseded_by,@created_at)
  `).run(row);
  audit(db, "create", "artifact", id, { stageId: input.stageId, kind: input.kind, ref: input.ref ?? null, sizeBytes });
  return row;
}

export function listArtifactsForIssue(db: Database.Database, issueId: string): ArtifactRow[] {
  return db.prepare(`
    SELECT artifact.*
    FROM artifact
    JOIN stage ON stage.id = artifact.stage_id
    WHERE stage.issue_id = ?
      AND artifact.superseded_by IS NULL
    ORDER BY artifact.created_at ASC
  `).all(issueId) as ArtifactRow[];
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
