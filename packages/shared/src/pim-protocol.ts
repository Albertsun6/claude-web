// PIM v2.1 wire-format protocol (Day 1 M0-PIM)
//
// 同源：
// - DDL: packages/backend/src/migrations/0008_pim_item.sql
// - ADR: docs/adr/vessel/ADR-020-pim-capture-entry.md
// - 完整设计: ~/Desktop/HTMLvsMD/mece-final-v2.1.md
// - 实施 plan: ~/.claude/plans/mece-clever-wilkinson.md
//
// 命名约定（参 harness-protocol.ts）：
// - 字段 camelCase（如 capturedAt, commitmentState）
// - DB schema 用 snake_case（commitment_state），转换由 backend store 层做
// - 时间戳 epoch ms 非负整数
// - 可选字段 wire 上完全省略 → Zod .optional()
// - 枚举 string 小写（与 DB 一致）
//
// 跨端 round-trip 不变量：本文 Zod schema 与
// packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift 的
// PimItemDto struct 必须 1:1 对齐（参 ADR-020 §D10 四端同步）。

import { z } from "zod";

// ============================================================================
// 受控词表（PIM_COMMITMENT_STATES 等）—— 应用层规范化白名单（ADR-020 D6）
// ============================================================================

/**
 * L1 骨架轴：commitment_state.
 *
 * v2.1 红线"不要先建分类法"——14 天捕获后可能调整。schema 层用 TEXT 无 CHECK，
 * 应用层（pim-queries.ts）用这个白名单做：
 * 1. 写入前 trim().toLowerCase() 规范化
 * 2. 不在白名单的值打 audit warn 但允许写（保留弹性）
 * 3. 每日 sanity 报告聚合 typo 候选
 *
 * 默认 5 桶 ＋ archived。允许 server-driven config 覆盖（ADR-020 §D10 4 处同步）。
 */
export const PIM_COMMITMENT_STATES = [
  "inbox",
  "action",
  "calendar",
  "waiting",
  "reference",
  "archived",
] as const;
export type PimCommitmentState = (typeof PIM_COMMITMENT_STATES)[number];

/**
 * L1 骨架轴：modality. 系统自动判定，用户无感（D5）。
 */
export const PIM_MODALITIES = [
  "text",
  "link",
  "image",
  "audio",
  "file",
  "structured",
] as const;
export type PimModality = (typeof PIM_MODALITIES)[number];

/**
 * AI Level 1 状态机（ADR-020 D9）。
 *
 * pending → running → done | failed | timeout
 * 任意状态 → disabled（PIM_AI_ENABLED=false 时全局短路）
 */
export const PIM_AI_STATUSES = [
  "pending",
  "running",
  "done",
  "failed",
  "timeout",
  "disabled",
] as const;
export type PimAiStatus = (typeof PIM_AI_STATUSES)[number];

/**
 * 隐私可见性（应用层使用；schema TEXT 无 CHECK）。
 */
export const PIM_VISIBILITIES = ["private", "dev", "shared"] as const;
export type PimVisibility = (typeof PIM_VISIBILITIES)[number];

// ============================================================================
// Zod schema 基础
// ============================================================================

/** epoch ms 非负整数（< 2^53 兼容 JS Number / Swift Int64） */
const EpochMsSchema = z.number().int().nonnegative();

// ============================================================================
// PimItemDto（核心 wire-format）
// ============================================================================

/**
 * v2.1 PimItem wire DTO.
 *
 * 字段对应 0008_pim_item.sql pim_item 表 + camelCase 转换。
 * 关联表（pim_commitment_state_history / pim_domain_tags / pim_people_refs
 * / pim_intent_snapshot / pim_refs）通过单独 DTO 表示。
 */
export const PimItemDtoSchema = z.object({
  id: z.string(),
  content: z.string(),
  capturedAt: EpochMsSchema,
  source: z.string(),
  // 用 string 而非 z.enum(PIM_COMMITMENT_STATES)——ADR-020 D6 应用层规范化弹性
  // 老 wire payload 出现新值（server-driven config 加值）时不会 Zod parse fail。
  commitmentState: z.string(),
  modality: z.string(),
  aiStatus: z.enum(PIM_AI_STATUSES).optional(), // 老 client 可能不发；默认 'pending'
  aiSuggestedAt: EpochMsSchema.optional(),
  visibility: z.string().optional(), // 老 client 可能不发；默认 'private'
  ownerUserId: z.string().optional(), // ADR-020 D7 预留；本期 NULL
  createdAt: EpochMsSchema,
  updatedAt: EpochMsSchema,
  deletedAt: EpochMsSchema.optional(), // soft delete; NULL/undefined = 未删

  // L2 视图层 facets（多对多 tag）
  domainTags: z.array(z.string()).optional(),
  peopleRefs: z
    .array(
      z.object({
        personRef: z.string(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .optional(),

  // 加工关系（多对多边，可空）
  derivedFrom: z
    .array(
      z.object({
        parentId: z.string(),
        relKind: z.string().optional(), // 默认 'derived_from'
        confidence: z.number().min(0).max(1).optional(),
        createdBy: z.enum(["user", "ai"]).optional(),
      }),
    )
    .optional(),

  // L3 意图向量快照（本期建表不写入；Week 4+ 才考虑加 AI 打分）
  // 留 schema 但本期不强求 client 发送。
  intentSnapshots: z
    .array(
      z.object({
        vectorJson: z.string(), // 6 维向量 JSON
        snapshotAt: EpochMsSchema,
        source: z.enum(["ai_suggest", "user_confirm", "user_override"]),
      }),
    )
    .optional(),
});
export type PimItemDto = z.infer<typeof PimItemDtoSchema>;

// ============================================================================
// PimItemCreateDto（POST /api/pim 输入）
// ============================================================================

/**
 * 捕获时最小输入。源、时间戳、id、ai_status 等由 backend 自动填。
 *
 * 客户端（iOS / Web / Siri）只需要传 content + 可选元数据。
 */
export const PimItemCreateDtoSchema = z.object({
  content: z.string().min(1),
  source: z.string().optional(), // 默认根据请求来源（user-agent / route）
  commitmentState: z.string().optional(), // 默认 'inbox'
  modality: z.string().optional(), // 默认 'text'（系统自动判）
  visibility: z.string().optional(),

  // 可选预填 L2 facets
  domainTags: z.array(z.string()).optional(),
  peopleRefs: z.array(z.string()).optional(),

  // 可选 derived_from（如 iOS"升级 raw item 为 action"时传 parent id）
  derivedFromIds: z.array(z.string()).optional(),
});
export type PimItemCreateDto = z.infer<typeof PimItemCreateDtoSchema>;

// ============================================================================
// PimItemPatchDto（PATCH /api/pim/:id 输入）
// ============================================================================

/**
 * partial update only（ADR-020 §多设备 last-write-wins 缓解 R5）。
 *
 * 客户端只发改动字段——避免 iPhone 离线时拿了旧版整对象、上线 PUT
 * 把 Mac 改的 4 个字段全 revert。
 */
export const PimItemPatchDtoSchema = z
  .object({
    content: z.string().min(1).optional(),
    commitmentState: z.string().optional(),
    modality: z.string().optional(),
    visibility: z.string().optional(),
    aiStatus: z.enum(PIM_AI_STATUSES).optional(),
    domainTags: z.array(z.string()).optional(),
    peopleRefs: z
      .array(
        z.object({
          personRef: z.string(),
          confidence: z.number().min(0).max(1).optional(),
        }),
      )
      .optional(),
    deletedAt: EpochMsSchema.nullable().optional(), // null = 取消 soft delete
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "PATCH body must contain at least one field",
  });
export type PimItemPatchDto = z.infer<typeof PimItemPatchDtoSchema>;

// ============================================================================
// Server-driven config: pim.commitmentStates etc. (ADR-020 §D10 4 处同步)
// ============================================================================

/**
 * Server-driven config 中的 pim 字段。
 *
 * iOS / Web 从 GET /api/harness/config 拉取，用户面 commitment picker
 * 选项不写死在 client 代码里——支持服务端加值不重装。
 *
 * 注入到 HarnessConfigSchema（harness-protocol.ts）作为 optional 字段。
 */
export const PimConfigSchema = z.object({
  commitmentStates: z.array(z.string()),
  modalities: z.array(z.string()).optional(),
  domainVocabulary: z.array(z.string()).optional(),
  aiEnabled: z.boolean().optional(),
});
export type PimConfig = z.infer<typeof PimConfigSchema>;

/**
 * 默认 fallback（client 离线 / config 未加载时用）。
 *
 * 服务端 fallback-config.json 也要含这份默认（D10 §4 处之 backend ②）。
 */
export const PIM_CONFIG_FALLBACK: PimConfig = {
  commitmentStates: [...PIM_COMMITMENT_STATES],
  modalities: [...PIM_MODALITIES],
  domainVocabulary: ["工作", "家庭", "健康", "财务", "学习", "兴趣", "关系"],
  aiEnabled: true,
} as const;

// ============================================================================
// 公开 schema 集合（fixture round-trip 测试 + verify 脚本用）
// ============================================================================

export const PIM_DTO_SCHEMAS = {
  PimItem: PimItemDtoSchema,
  PimItemCreate: PimItemCreateDtoSchema,
  PimItemPatch: PimItemPatchDtoSchema,
  PimConfig: PimConfigSchema,
} as const;
