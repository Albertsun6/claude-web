// Option E (v0.3+) — AISEP HTML report internal data types.
//
// These are NOT wire DTOs (no zod schema) — they're internal projection
// types built from `AisepStore` + `AisepWorkspaceMeta` + artifact `*.md`
// content. The HTML template (template.ejs) consumes exactly this shape.
//
// Framing (per `user_super_individual_enterprise.md` memory):
// 1 super-individual building enterprise-class systems → HTML report
// serves THREE audiences (开发者 self-review / 客户 demo / 合规 audit),
// hence the trace_matrix + contract_grep drill-down + print-friendly
// layout in the EJS template.

import type {
  AisepArtifact,
  AisepStage,
  AisepStageRun,
  AisepStageStatus,
  AisepWorkspaceMeta,
} from "@vessel/aisep-protocol";

/** A single row in the timeline. */
export interface AisepReportStage {
  id: string;
  stage: AisepStage;
  status: AisepStageStatus;
  phase: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  /** Output artifact key (e.g. "intake.md", "implement.md", "implement-backend.md") */
  outputKey?: string;
  /** Fan-out: parent stage_run id when this run is a child. */
  parentStageRunId?: string;
  /** Fan-out role from AisepStageRun. */
  fanOutRole: "normal" | "parent" | "child";
  /** Sub-stage name (e.g. "backend") when fanOutRole === "child". */
  subStageName?: string;
}

/** Aggregate report. */
export interface AisepReport {
  /** Workspace metadata (name, cwd, techStack, etc.). */
  workspace: AisepWorkspaceMeta;
  /** Generated timestamp (epoch ms). */
  generatedAt: number;
  /** All stage_runs in execution order (root → leaf for fan-out). */
  stages: AisepReportStage[];
  /** Fan-out parent → children adjacency lists. */
  fanOuts: AisepReportFanOutGroup[];
  /** Trace rows: REQ → ADR → ZOD → RISK → PATCH → VERIFY. */
  traceMatrix: AisepReportTraceRow[];
  /** contract_grep check drill-down (per verify stage_run). */
  contractGrepChecks: AisepReportContractGrepCheck[];
  /** Memory hits surfaced in the run (subset; v0 best-effort from architect/plan prompts).
   *  Empty for v0.3 MVP — full memory hit timeline requires retrieve() artifact persistence.
   */
  memoryHits: AisepReportMemoryHit[];
}

export interface AisepReportFanOutGroup {
  parentId: string;
  parentStage: AisepStage;
  childIds: string[];
  /** Map child id → declared subStageName (matches `implement-<subName>.md`). */
  childNames: Record<string, string>;
}

export interface AisepReportTraceRow {
  /** Requirement / risk anchor id, e.g. "REQ-001" or "RISK-Q4". */
  anchorId: string;
  /** Where it was first declared (intake / research / plan / architecture). */
  declaredIn?: string;
  /** ADRs that reference / decide it. */
  adrRefs: string[];
  /** Schemas (ZOD-*) bound to it. */
  zodRefs: string[];
  /** Patch files (from implement.md / implement-<sub>.md) implementing it. */
  patchRefs: string[];
  /** Verify check names that gate it. */
  verifyChecks: string[];
}

export interface AisepReportContractGrepCheck {
  /** verify stage_run id this check came from. */
  stageRunId: string;
  name: string;
  command: string;
  ok: boolean;
  readFromDisk?: boolean;
}

export interface AisepReportMemoryHit {
  /** Which stage_run consumed this memory hit. */
  stageRunId: string;
  failurePattern: string;
  fix: string;
  source: "global-verified" | "workspace-pending";
}

/** Inputs for builder. Pure function — caller resolves store + artifacts. */
export interface BuildReportInput {
  workspace: AisepWorkspaceMeta;
  stageRuns: AisepStageRun[];
  artifacts: AisepArtifact[];
  /** Optional: artifact content (key → body). When provided, builder extracts
   *  trace anchors + contract_grep checks. When absent, those sections render empty. */
  artifactContents?: Record<string, string>;
  generatedAt?: number;
}
