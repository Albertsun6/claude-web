/**
 * Agent — 一次正在执行的任务实例（FRAMEWORK §2.1）
 *
 * Agent 是 Vessel 内核 Intent 的主执行者：
 *  - 接受一个 Intent 作为输入
 *  - 通过调用 Skills + Tools + Drivers 完成任务
 *  - 产出 Artifact 或 Workflow
 *  - 完整 trace_id 贯穿
 *
 * Lifecycle: spawn() → run() → ([pause()] → resume())* → complete() | cancel() | fail()
 *
 * v0A.1 修订（cursor M3）：AgentResult 用 discriminated union 强制不变量
 *
 * @see CONCEPTS §1.4 / §2.1 Orchestrator
 * @see FRAMEWORK §2.1
 */

import type { TraceContext } from '../observability/trace.js';
// import type { Intent, Artifact, SessionId } from '@vessel/shared';
// 注：以上 @vessel/shared 导出待 0B-7 + M0 落地；当前 stub 用 placeholder
type Intent = unknown;
type Artifact = unknown;
type SessionId = string;

export interface Agent {
  readonly id: string;                          // uuid v4
  readonly sessionId: SessionId;
  readonly traceCtx: TraceContext;

  /** 异步执行任务；调用 Skill/Driver/Tool 完成 Intent */
  run(intent: Intent): Promise<AgentResult>;

  /** 优雅取消（Workflow HITL 节点用）；保证不留孤儿子进程 */
  cancel(reason?: string): Promise<void>;

  /** Health check（NFR-F1 / NFR-F2 用） */
  health(): Promise<{ ok: boolean; reason?: string }>;
}

/**
 * v0A.1 修订（cursor M3 2026-05-10）：discriminated union 强制不变量
 *
 * 每个 status 必带对应字段，避免 caller 漏分支：
 *   - success → 必带 artifact
 *   - paused → 必带 resumeToken
 *   - cancelled → 必带 reason
 *   - failed → 必带 error
 */
export type AgentResult =
  | { status: 'success'; artifact: Artifact }
  | { status: 'paused'; resumeToken: string }
  | { status: 'cancelled'; reason: string }
  | { status: 'failed'; error: { type: string; message: string } };
