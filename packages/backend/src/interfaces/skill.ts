/**
 * Skill — 单步能力胶囊（FRAMEWORK §2.2）
 *
 * Skill 是 Agent 调用的"动作"。例：
 *  - EchoSkill（M0）
 *  - CodingSkill（M0.5，wrap CodingDriver per ADR-016）
 *  - VoiceSkill（M2-Voice，wrap ASR/TTS worker per ADR-012）
 *
 * Lifecycle:
 *  - 由 Capability App register 进 SkillRegistry（启动时）
 *  - 被 Agent.run() 调用 invoke()
 *  - 无状态（state 在 Memory）
 *
 * @see CONCEPTS §1.4 / ADR-016 (CodingSkill 通过 CodingDriver 实现)
 * @see FRAMEWORK §2.2
 */

import type { TraceContext } from '../observability/trace.js';
import type { Tool } from './tool.js';
import type { Memory } from './memory.js';

// 临时 placeholders（待 @vessel/shared 导出）
type Intent = unknown;
type Artifact = unknown;

export interface Skill {
  readonly id: string;                          // 'echo' / 'coding' / 'voice'
  readonly capabilityId: string;                // 所属 Capability App id
  readonly description: string;

  /** 执行 Skill；可访问 Tool / Memory；trace_ctx 必须传播 */
  invoke(intent: Intent, ctx: SkillContext): Promise<Artifact>;
}

export interface SkillContext {
  traceCtx: TraceContext;
  tools: ToolRegistry;
  memory: Memory;
  workspaceDir: string;                         // instance/workspace/<run_id>/
  /** Cancellation signal — fires on SIGINT/SIGTERM (NFR-F1 5s budget). Skills MUST
   *  forward to any subprocess they spawn (e.g., CodingDriver → cli-runner). */
  abortSignal: AbortSignal;
  /** M1A-β: optional progress sink for streaming skills (e.g. CodingSkill forwards
   *  CC stream-json messages live to a WS client). Skills that don't stream just
   *  ignore this. Already-redacted form when invoked by the driver. */
  onProgress?: (message: unknown) => void;
}

export interface ToolRegistry {
  /** 按 tool id 取 Tool 实例（已经过 Permission 检查） */
  get(toolId: string): Tool | null;
}
