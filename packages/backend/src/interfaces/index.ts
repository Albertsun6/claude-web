/**
 * 5 接口主契约统一导出（FRAMEWORK §1）
 *
 * 用法：
 *   import { Agent, Skill, Tool, Memory, App } from '@vessel/backend/interfaces';
 *
 * 注意：Driver 内部契约不在 5 接口里 — 见 ../drivers/types.ts (CodingDriver)
 *      ML Worker helper 也不在 5 接口里 — 见 ../ml-worker/types.ts (EmbeddingClient 等)
 *
 * @see FRAMEWORK §1 + ADR-000 §2 5 接口契约存放约定
 */

export type { Agent, AgentResult } from './agent.js';
export type { Skill, SkillContext, ToolRegistry } from './skill.js';
export type { Tool, PermissionScope, ToolContext, VerifyAllowedPathFn } from './tool.js';
export type { Memory, ShortTermMemory, SessionKvMemory, LongTermMemory, MemoryRecord } from './memory.js';
export type { CapabilityApp as App, AppManifest, AppBootContext, HelperSpawnSpec, HelperHandle } from './app.js';
