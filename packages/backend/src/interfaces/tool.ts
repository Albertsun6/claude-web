/**
 * Tool — 系统调用 / 外部能力的统一接口（FRAMEWORK §2.3）
 *
 * Tool 在 Vessel 中通常是 MCP server 暴露的能力（filesystem / git / playwright / etc.）。
 * 也可以是内部 tool（如 memory.search 暴露成 tool）。
 *
 * Lifecycle:
 *  - 由 MCP client 或 internal Capability register 进 ToolRegistry
 *  - 调用前必须经 Permission 检查（按 NFR-P1 / NFR-P2 / NFR-P3）
 *
 * v0A.1 修订（cursor M4 2026-05-10）：路径白名单必须 canonicalize + 防 symlink escape
 *
 * @see CONCEPTS §3.2 Tool Registry / ADR-009 MCP server lifecycle
 * @see FRAMEWORK §2.3
 */

import type { TraceContext } from '../observability/trace.js';
import type { ZodSchema } from 'zod';

export interface Tool {
  readonly id: string;                          // 'filesystem.read' / 'git.commit' / etc.
  readonly description: string;
  readonly inputSchema: ZodSchema<unknown>;     // Zod schema，运行时校验
  readonly outputSchema: ZodSchema<unknown>;
  readonly permissionScope: PermissionScope;    // 路径白名单 / 操作白名单 / etc.

  /** 调用 Tool；ctx 含 trace_ctx 和 cancel signal */
  invoke(input: unknown, ctx: ToolContext): Promise<unknown>;
}

export interface PermissionScope {
  /** 路径白名单模式（glob 或绝对前缀） */
  pathAllowlist?: string[];
  /** 操作白名单（read / write / exec / etc.） */
  ops?: ('read' | 'write' | 'exec' | 'network')[];
}

/**
 * v0A.1 修订（cursor M4 2026-05-10）：路径白名单 HARD RULES（M1B Permission middleware 实施时必落）
 *
 * 1. 所有 input path 必须 `realpath` canonicalize（resolve symlinks + `../` + relative）
 * 2. allowlist 也 canonicalize（vessel-core 启动时一次性 resolve；config reload 时重 resolve）
 * 3. canonicalized input path 必须严格 startsWith canonicalized allowlist entry
 * 4. 禁止 symlink 逃出 instance root：
 *    如 instance/workspace/<run_id>/foo 是 symlink → ~/.ssh/...，realpath 后命中 ~/.ssh/（不在 allowlist），
 *    permission middleware 拒绝
 * 5. ~ 只允许 vessel-core 启动时 expand（不允许运行时 user input 含 ~）
 * 6. 大小写：macOS 默认 case-insensitive FS；canonicalize 后比较前必须按 fs.realpathSync.native
 *    拿真实大小写
 * 7. 测试覆盖：../、symlink、bind mount、UNC paths（Windows，v1+）
 *
 * 参考实现：每次 Tool.invoke() 前调 verifyAllowedPath(input.path, scope.pathAllowlist)
 */
export interface VerifyAllowedPathFn {
  (inputPath: string, allowlist: string[]): { allowed: boolean; reason?: string; canonicalPath: string };
}

export interface ToolContext {
  traceCtx: TraceContext;
  abortSignal: AbortSignal;
}
