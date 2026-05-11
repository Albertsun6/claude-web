/**
 * Driver 内部契约（FRAMEWORK §3，不在 5 接口里）
 *
 * 仅 packages/backend/src/drivers/ 内部用；外部模块通过 Skill 间接访问。
 *
 * v0A.1 路径 C（ADR-016）：cli-runner.ts 内部不动，新建 ClaudeCodeDriver adapter wrap。
 *
 * @see ADR-016 Coding Driver Interface
 * @see FRAMEWORK §3
 */

import type { TraceContext } from '../observability/trace.js';

/** 通用 Driver 父契约（CodingDriver / 未来其他 Driver 继承） */
export interface DriverBase {
  /** Health check */
  health(): Promise<{ ok: boolean; reason?: string }>;
}

/** Coding Driver — wrap CC CLI / Cursor / Codex（v0.1 仅 CC，按 ADR-003）*/
export interface CodingDriver extends DriverBase {
  /** 提交 coding 任务，返回 artifact */
  submit(
    spec: CodingDriverSpec,
    ctx: {
      traceCtx: TraceContext;
      abortSignal: AbortSignal;
      /** M1A-β: stream-json line callback. Already-redacted by driver before fire. */
      onMessage?: (message: unknown) => void;
    }
  ): Promise<CodingDriverArtifact>;

  /** 优雅取消（SIGTERM process group + 5s SIGKILL，NFR-F1） */
  cancel(runId: string): Promise<void>;
}

export interface CodingDriverSpec {
  runId: string;
  prompt: string;
  workspace: string;                            // instance/workspace/<runId>/
  systemPromptPrefix?: string;                  // M2-Soul 注入 4 sibling soul 渲染内容（ADR-004 + v0A.1 A1）
  model?: 'opus' | 'sonnet' | 'haiku';          // 沿用 Eva model-registry
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
}

export interface CodingDriverArtifact {
  files: string[];                              // 产生的文件路径（绝对，在 workspace 下）
  exitCode: number;
  stdoutPath?: string;                          // > 4KB stdout 切到 instance/traces/<trace_id>/<span_id>.stdout
  stderrPath?: string;
  metadata?: Record<string, unknown>;
}
