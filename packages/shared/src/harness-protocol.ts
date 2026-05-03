// harness 协议契约 (M-1 v1.0 — 2026-05-03)
//
// 同源：
// - DDL: docs/HARNESS_DATA_MODEL.md §1
// - 协议契约 doc: docs/HARNESS_PROTOCOL.md
// - ADR: docs/adr/ADR-0011-server-driven-thin-shell.md (Proposed)
//        docs/adr/ADR-0015-schema-migration.md
//
// 本文是 wire-format（backend ↔ web ↔ iOS 共享 DTO）的唯一权威。
// DB schema 用 snake_case，wire 用 camelCase；转换由 store 层负责，**不在本文**。
//
// 命名约定（HARNESS_PROTOCOL.md §1）：
// - 字段 camelCase（如 createdAt, projectId）
// - 时间戳 epoch ms 非负整数
// - ID **opaque stable string**（推荐 `<type>-<ULID>` 前缀；不强制 UUIDv4）—— Round 1 cross M1
// - 枚举小写下划线（in_progress）
// - 可选字段在 wire 上完全省略（不发 null）→ Zod .optional()
// - nullable 字段用显式 null（如 audit before/after）→ Zod .nullable()
//
// 跨端 round-trip 不变量（HARNESS_PROTOCOL.md §6）：
//   TS encode → JSON → Swift decode → Swift encode → JSON → TS decode == 原始对象

import { z } from "zod";

// ============================================================================
// Common helpers (Round 1 cross m1/m3 修复)
// ============================================================================

/** epoch ms 非负整数（< 2^53 兼容 JS Number / Swift Int64） */
const EpochMsSchema = z.number().int().nonnegative();

/** Artifact hash 形如 "sha256:<64 hex>" */
const ContentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/, "must be 'sha256:<64 hex>'");

/** 评分维度 0..5（与 ReviewVerdict.score 一致） */
const DimensionScoreSchema = z.number().min(0).max(5);

// ============================================================================
// 版本协商（HARNESS_PROTOCOL.md §5）
// ============================================================================

export const HARNESS_PROTOCOL_VERSION = "1.0";
export const MIN_CLIENT_VERSION = "1.0";

// ============================================================================
// 枚举（HARNESS_PROTOCOL.md §1）—— 必须与 0001_initial.sql CHECK 完全一致
// ============================================================================

export const StageKindSchema = z.enum([
  "strategy", "discovery", "spec", "compliance", "design",
  "implement", "test", "review", "release", "observe",
]);
export type StageKind = z.infer<typeof StageKindSchema>;

export const StageStatusSchema = z.enum([
  "pending", "running", "awaiting_review", "approved",
  "rejected", "skipped", "failed",
]);
export type StageStatus = z.infer<typeof StageStatusSchema>;

export const StageWeightSchema = z.enum(["heavy", "light", "checklist"]);
export type StageWeight = z.infer<typeof StageWeightSchema>;

export const TaskStatusSchema = z.enum([
  "pending", "running", "completed", "failed", "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskModelSchema = z.enum(["opus", "sonnet", "haiku"]);
export type TaskModel = z.infer<typeof TaskModelSchema>;

export const InitiativeStatusSchema = z.enum(["draft", "active", "paused", "done"]);
export type InitiativeStatus = z.infer<typeof InitiativeStatusSchema>;

export const IssuePrioritySchema = z.enum(["low", "normal", "high", "critical"]);
export type IssuePriority = z.infer<typeof IssuePrioritySchema>;

export const IssueStatusSchema = z.enum([
  "inbox", "triaged", "planned", "in_progress",
  "blocked", "done", "wont_fix",
]);
export type IssueStatus = z.infer<typeof IssueStatusSchema>;

export const IssueSourceSchema = z.enum([
  "ideas_md", "user_feedback", "git_log", "telemetry", "inbox", "manual",
]);
export type IssueSource = z.infer<typeof IssueSourceSchema>;

export const IdeaCaptureSourceSchema = z.enum(["voice", "text", "web"]);
export type IdeaCaptureSource = z.infer<typeof IdeaCaptureSourceSchema>;

export const MethodologyAppliesToSchema = z.enum([
  "claude-web", "enterprise-admin", "universal",
]);
export type MethodologyAppliesTo = z.infer<typeof MethodologyAppliesToSchema>;

export const ArtifactKindSchema = z.enum([
  "methodology", "spec", "design_doc", "architecture_doc", "adr",
  "patch", "pr_url", "test_report", "coverage_report", "review_notes",
  "review_verdict", "decision_note", "metric_snapshot", "retrospective",
  "changelog_entry",
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ArtifactStorageSchema = z.enum(["inline", "file"]);
export type ArtifactStorage = z.infer<typeof ArtifactStorageSchema>;

export const AuditOpSchema = z.enum(["insert", "update", "delete", "migrate"]);
export type AuditOp = z.infer<typeof AuditOpSchema>;

// ============================================================================
// 13 业务实体 DTO（HARNESS_PROTOCOL.md §2）
// ============================================================================

// 1. Project
export const ProjectDtoSchema = z.object({
  id: z.string(),
  cwd: z.string(),
  name: z.string(),
  defaultBranch: z.string(),
  worktreeRoot: z.string(),
  harnessEnabled: z.boolean(),
  createdAt: EpochMsSchema,
});
export type ProjectDto = z.infer<typeof ProjectDtoSchema>;

// 2. Initiative
export const KpiSchema = z.object({
  name: z.string(),
  target: z.string(),
  selected: z.boolean(),
});
export const InitiativeDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  intent: z.string(),
  kpis: z.array(KpiSchema),
  status: InitiativeStatusSchema,
  ownerHuman: z.string(),
  methodologyVersion: z.string(),
  createdAt: EpochMsSchema,
  updatedAt: EpochMsSchema,
});
export type InitiativeDto = z.infer<typeof InitiativeDtoSchema>;
export type Kpi = z.infer<typeof KpiSchema>;

// 3. Issue
export const IssueDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  initiativeId: z.string().optional(),
  source: IssueSourceSchema,
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
  priority: IssuePrioritySchema,
  status: IssueStatusSchema,
  retrospectiveId: z.string().optional(),
  createdAt: EpochMsSchema,
  updatedAt: EpochMsSchema,
});
export type IssueDto = z.infer<typeof IssueDtoSchema>;

// 4. IdeaCapture
export const IdeaCaptureDtoSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  body: z.string(),
  audioPath: z.string().optional(),
  transcript: z.string().optional(),
  source: IdeaCaptureSourceSchema,
  capturedAt: EpochMsSchema,
  processedIntoIssueId: z.string().optional(),
});
export type IdeaCaptureDto = z.infer<typeof IdeaCaptureDtoSchema>;

// 5. Stage
//
// Round 2 cross M2 注：inputArtifactIds / outputArtifactIds / reviewVerdictIds
// 是 **provisional persistence-only**——M2 dogfood 反查询频率信号决定是否
// 升级为 stage_artifact(stageId, artifactId, role) 中间表 + 对应 stageArtifactRefs
// wire DTO。当前 array 形态进了 DTO 是为了 M-1 验收能跑通，但**不承诺 v2.0 之后兼容**。
// 见 docs/HARNESS_REVIEW_LOG.md Round 2 项 #2。
export const StageDtoSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  kind: StageKindSchema,
  status: StageStatusSchema,
  weight: StageWeightSchema,
  gateRequired: z.boolean(),
  assignedAgentProfile: z.string(),
  methodologyId: z.string(),
  inputArtifactIds: z.array(z.string()),     // provisional, see note above
  outputArtifactIds: z.array(z.string()),    // provisional
  reviewVerdictIds: z.array(z.string()),     // provisional
  startedAt: EpochMsSchema.optional(),
  endedAt: EpochMsSchema.optional(),
  createdAt: EpochMsSchema,
});
export type StageDto = z.infer<typeof StageDtoSchema>;

// 6. Methodology
export const MethodologyDtoSchema = z.object({
  id: z.string(),
  stageKind: StageKindSchema,
  version: z.string(),
  appliesTo: MethodologyAppliesToSchema,
  contentRef: z.string(),
  approvedBy: z.string(),
  approvedAt: EpochMsSchema,
});
export type MethodologyDto = z.infer<typeof MethodologyDtoSchema>;

// 7. Task
export const TaskDtoSchema = z.object({
  id: z.string(),
  stageId: z.string(),
  agentProfileId: z.string(),
  model: TaskModelSchema,
  cwd: z.string(),
  worktreePath: z.string().optional(),
  prompt: z.string(),
  skillSet: z.array(z.string()),
  permissionMode: z.string(),
  contextBundleId: z.string(),
  runIds: z.array(z.string()),
  status: TaskStatusSchema,
  createdAt: EpochMsSchema,
  updatedAt: EpochMsSchema,
});
export type TaskDto = z.infer<typeof TaskDtoSchema>;

// 8. ContextBundle
export const ContextBundleDtoSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  artifactRefs: z.array(z.string()),
  maxTokens: z.number().int(),
  prunedFiles: z.array(z.string()),
  summary: z.string(),
  snapshotPath: z.string(),
  createdAt: EpochMsSchema,
});
export type ContextBundleDto = z.infer<typeof ContextBundleDtoSchema>;

// 9. Run
export const RunDtoSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  sessionId: z.string().optional(),
  exitCode: z.number().int().optional(),
  model: z.string(),
  tokensIn: z.number().int().optional(),
  tokensOut: z.number().int().optional(),
  cost: z.number().optional(),
  transcriptPath: z.string(),
  startedAt: EpochMsSchema,
  endedAt: EpochMsSchema.optional(),
});
export type RunDto = z.infer<typeof RunDtoSchema>;

// 10. Artifact
export const ArtifactDtoSchema = z.object({
  id: z.string(),
  stageId: z.string(),
  kind: ArtifactKindSchema,
  ref: z.string().optional(),
  hash: ContentHashSchema,                        // Round 1 cross m3: 'sha256:<64 hex>'
  storage: ArtifactStorageSchema,
  contentText: z.string().optional(),
  contentPath: z.string().optional(),
  sizeBytes: z.number().int(),
  metadata: z.record(z.unknown()),  // Round 1 arch 垂直#8 部分接受：M-1 加列但不约束 typed
  supersededBy: z.string().optional(),
  createdAt: EpochMsSchema,
}).refine(
  (a) =>
    (a.storage === "inline" && a.contentText !== undefined && a.contentPath === undefined) ||
    (a.storage === "file" && a.contentPath !== undefined && a.contentText === undefined),
  { message: "storage='inline' requires contentText; storage='file' requires contentPath" },
);
export type ArtifactDto = z.infer<typeof ArtifactDtoSchema>;

// 11. ReviewVerdict
export const ReviewVerdictDtoSchema = z.object({
  id: z.string(),
  stageId: z.string(),
  reviewerProfileId: z.string(),
  model: z.string(),
  score: DimensionScoreSchema,
  dimensions: z.record(DimensionScoreSchema),     // Round 1 cross m2: 0..5 bound
  notes: z.string(),
  agreesWithPrior: z.boolean().optional(),
  createdAt: EpochMsSchema,
});
export type ReviewVerdictDto = z.infer<typeof ReviewVerdictDtoSchema>;

// 12. Decision
export const DecisionOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});
export const DecisionDtoSchema = z.object({
  id: z.string(),
  stageId: z.string(),
  requestedBy: z.string(),
  options: z.array(DecisionOptionSchema),
  chosenOption: z.string().optional(),
  decidedBy: z.string().optional(),
  rationale: z.string().optional(),
  decidedAt: EpochMsSchema.optional(),
  createdAt: EpochMsSchema,
});
export type DecisionDto = z.infer<typeof DecisionDtoSchema>;
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

// 13. Retrospective
export const CostSummarySchema = z.object({
  totalUsd: z.number(),
  byStage: z.record(z.number()),
  byModel: z.record(z.number()),
});
export const RetrospectiveDtoSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  whatWentWell: z.string(),
  whatToImprove: z.string(),
  methodologyFeedback: z.string(),
  costSummary: CostSummarySchema,
  createdBy: z.string(),
  createdAt: EpochMsSchema,
});
export type RetrospectiveDto = z.infer<typeof RetrospectiveDtoSchema>;
export type CostSummary = z.infer<typeof CostSummarySchema>;

// ============================================================================
// Audit Log Entry (HARNESS_PROTOCOL.md §3)
// ============================================================================

export const AuditLogEntrySchema = z.object({
  ts: EpochMsSchema,
  actor: z.string(),
  op: AuditOpSchema,
  table: z.string(),
  id: z.string(),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
  rationale: z.string().optional(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

// ============================================================================
// WS Event 骨架 (HARNESS_PROTOCOL.md §4) - payload 字段 M0 时再细化
// ============================================================================

export const HarnessEventSchema = z.discriminatedUnion("kind", [
  z.object({ type: z.literal("harness_event"), kind: z.literal("stage_changed"),     stageId: z.string(), status: StageStatusSchema }),  // Round 1 cross M2: enum lock
  z.object({ type: z.literal("harness_event"), kind: z.literal("task_started"),      taskId: z.string() }),
  z.object({ type: z.literal("harness_event"), kind: z.literal("task_completed"),    taskId: z.string(), success: z.boolean() }),
  z.object({ type: z.literal("harness_event"), kind: z.literal("decision_requested"), decisionId: z.string() }),
  z.object({ type: z.literal("harness_event"), kind: z.literal("run_appended"),      runId: z.string(), lineCount: z.number().int() }),
  z.object({ type: z.literal("harness_event"), kind: z.literal("review_complete"),   verdictId: z.string() }),
  z.object({ type: z.literal("harness_event"), kind: z.literal("config_changed"),    protocolVersion: z.string() }),
]);
export type HarnessEvent = z.infer<typeof HarnessEventSchema>;

// ============================================================================
// M0 modelList Round —— /api/harness/config 第一契约
// ============================================================================
// 详见 docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md
// Phase 3 全 18 项 finding 落地后 v1.1 修订版

export const ModelCapabilitiesSchema = z.object({
  supportsThinking: z.boolean(),
  supportsLongContext: z.boolean(),
  contextWindow: z.number().int().positive(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelListItemSchema = z.object({
  id: z.string(),                                    // opaque stable string，推荐 <type>-<ULID>
  displayName: z.string(),
  description: z.string().optional(),
  capabilities: ModelCapabilitiesSchema,
  recommendedFor: z.array(z.string()),               // hint-only, 未知值 graceful skip
  isDefault: z.boolean(),                            // exactly-one constraint at HarnessConfig level
  enabled: z.boolean(),                              // false → UI 隐藏；当前 selection 已 disabled 保留 + 标签
});
export type ModelListItem = z.infer<typeof ModelListItemSchema>;

// ============================================================================
// PermissionModeItem (M0 modelList Round + permissionModes Round v1.1)
// ============================================================================
// 三端同步约束（permissionModes Round phase 3 cross M3 + arch agree）：
// - packages/shared/src/protocol.ts ClientMessage.permissionMode 字面值
// - PermissionModeIdSchema enum 此处
// - packages/backend/scripts/permission-hook.mjs / cli-runner.ts 实际处理
// 改一处必须三端同步。

export const PermissionModeIdSchema = z.enum([
  "default", "acceptEdits", "bypassPermissions", "plan",
]);
export type PermissionModeId = z.infer<typeof PermissionModeIdSchema>;

export const PermissionModeItemSchema = z.object({
  id: PermissionModeIdSchema,
  displayName: z.string(),                            // 短名（permissionModes Round arch react N1 + cross m2: "Plan" / "Default" / etc）
  description: z.string().optional(),
  isDefault: z.boolean(),                             // exactly-one constraint at HarnessConfig level
  riskLevel: z.string().optional(),                   // hint-only string (phase 3 修复：与 modelList recommendedFor 对称，graceful skip 未知值)
                                                       // 推荐 "low" / "medium" / "high"; UI if/else 不强制 exhaustive switch
});
export type PermissionModeItem = z.infer<typeof PermissionModeItemSchema>;

// ============================================================================
// AgentProfileItem (M0 mini-milestone C agentProfiles Round, protocolVersion 1.2)
// ============================================================================
// 把 docs/HARNESS_AGENTS.md §2.2 12 个默认 AgentProfile 迁到 server-driven config。
// M0 收敛到 6 字段（id / displayName / description / stage / modelHint / enabled），
// 不锁 enum（id / stage / modelHint 都是 hint-only string，方便 minor bump 扩）。
// 不在 M0 范围（M2 真 spawn 时 minor bump 加）：
//   skillNames[] / toolAllowlist[] / defaultPermissionMode / requiresWorktree
//   parallelizable / contextBudget / reviewerRole / systemPromptTemplate
// 与 modelList / permissionModes 不同：AgentProfile 没有"isDefault exactly-one"
// 概念——多个 profile 可同时 enabled（每条对应不同 Stage）。

export const AgentProfileItemSchema = z.object({
  id: z.string(),                                    // opaque stable string，对应 Task.agentProfileId
  displayName: z.string(),                           // 短名 "PM" / "Coder" / "Reviewer-cross"
  description: z.string(),                           // 一行职责
  stage: z.string(),                                 // hint-only "discovery"/"implement"/etc，未知值 graceful skip
  modelHint: z.string(),                             // hint-only "opus"/"sonnet"/"haiku"/"adaptive"，未知值 UI 默认显示
  enabled: z.boolean(),                              // M0=11 false + PM=true（M1 discovery 准备）
});
export type AgentProfileItem = z.infer<typeof AgentProfileItemSchema>;

export const HarnessConfigSchema = z
  .object({
    protocolVersion: z.string(),                     // "1.x"; minor bump 加新字段，老 client graceful skip
    minClientVersion: z.string(),                    // iOS compareVersion 自查
    etag: z.string(),                                // computeEtag(rest) "sha256:<16 hex>"
    modelList: z.array(ModelListItemSchema),
    // permissionModes Round (M0 mini-milestone B, protocolVersion 1.1)：
    // 加新字段 = minor bump，与 ADR-0015 一致。**iOS Codable 端必须 optional**
    // 防止 v1.1 client + v1.0 server payload 时 keyNotFound（双向兼容硬约束）
    permissionModes: z.array(PermissionModeItemSchema),
    // agentProfiles Round (M0 mini-milestone C, protocolVersion 1.2):
    // 同 permissionModes 的 minor bump 模式 — Swift 端必须 optional，
    // shared / backend 严格必填。M2 真 spawn 时再 minor bump 加复杂字段。
    agentProfiles: z.array(AgentProfileItemSchema),
  })
  .superRefine((cfg, ctx) => {
    // Phase 3 cross M1: modelList isDefault exactly-one
    const enabledDefaults = cfg.modelList.filter((m) => m.isDefault && m.enabled);
    if (enabledDefaults.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `modelList must have exactly 1 enabled+isDefault item, got ${enabledDefaults.length}`,
        path: ["modelList"],
      });
    }
    // permissionModes Round phase 3 cross m1 + arch refine:
    // 当前对所有 permissionModes 检查（M0 无 enabled 字段）。未来加 enabled 时 superRefine
    // 必须改为 isDefault && enabled exactly-one（ADR-0015 footnote F1 标记此约束）
    const defaultModes = cfg.permissionModes.filter((p) => p.isDefault);
    if (defaultModes.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `permissionModes must have exactly 1 isDefault item, got ${defaultModes.length}`,
        path: ["permissionModes"],
      });
    }
    // agentProfiles Round: id 唯一性 (避免 Task.agentProfileId 路由歧义)
    const ids = cfg.agentProfiles.map((p) => p.id);
    const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `agentProfiles must have unique ids, found duplicates: ${[...new Set(dupIds)].join(", ")}`,
        path: ["agentProfiles"],
      });
    }
  });
export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;

// ============================================================================
// 公开 schema 集合（fixture round-trip 测试 + verify 脚本用）
// ============================================================================

export const HARNESS_DTO_SCHEMAS = {
  Project: ProjectDtoSchema,
  Initiative: InitiativeDtoSchema,
  Issue: IssueDtoSchema,
  IdeaCapture: IdeaCaptureDtoSchema,
  Stage: StageDtoSchema,
  Methodology: MethodologyDtoSchema,
  Task: TaskDtoSchema,
  ContextBundle: ContextBundleDtoSchema,
  Run: RunDtoSchema,
  Artifact: ArtifactDtoSchema,
  ReviewVerdict: ReviewVerdictDtoSchema,
  Decision: DecisionDtoSchema,
  Retrospective: RetrospectiveDtoSchema,
  AuditLogEntry: AuditLogEntrySchema,
  HarnessEvent: HarnessEventSchema,
} as const;
