/**
 * Trace 协议 — OpenTelemetry-lite + W3C Trace Context（FRAMEWORK §5）
 *
 * v0A.1 修订（cursor B1 + M5 路径 1, 2026-05-10）：
 *  - 主 schema 直接采用 OTEL 命名（trace_id 32 hex / span_id 16 hex / parent_span_id 16 hex）
 *  - 子进程传播走 W3C TRACEPARENT（标准 env var）+ Vessel 特有 VESSEL_CONVERSATION_ID / VESSEL_RUN_ID
 *  - 不引 @opentelemetry/* SDK（v1+ 加 exporter 时再引）
 *
 * @see FRAMEWORK §5 + trace-redaction-spec.md + ADR-014 escalation #5 secrets
 */

import { z } from 'zod';

export const TraceEventSchema = z.object({
  // OTEL 标准字段（M0 直接采用 hex 格式，不是 UUID v4）
  trace_id: z.string().regex(/^[0-9a-f]{32}$/, 'OTEL trace_id: 16-byte hex / 32 chars'),
  span_id: z.string().regex(/^[0-9a-f]{16}$/, 'OTEL span_id: 8-byte hex / 16 chars'),
  parent_span_id: z.string().regex(/^[0-9a-f]{16}$/).nullable(),

  // OTEL 推荐 span name（不直接对应 event_type，但 Vessel 沿用 event_type 作 vessel.event 命名空间）
  event_type: z.enum([
    'intent.received',
    'skill.invoked',
    'skill.completed',
    'permission.granted',
    'permission.denied',
    'driver.spawned',
    'driver.exited',
    'mcp.invoked',
    'mcp.completed',
    'workflow.paused',
    'workflow.resumed',
    'soul.loaded',
    'capability.installed',
    'capability.uninstalled',
  ]),
  timestamp: z.string().datetime(),             // ISO 8601 ms
  component: z.string(),                        // 'gateway' | 'orchestrator' | 'skill:<id>' | 'driver:cc-cli' | 'mcp:filesystem' | 'ml-worker:embedding' | ...
  session_id: z.string(),
  run_id: z.string(),
  status: z.enum(['success', 'error', 'paused', 'cancelled']),
  duration_ms: z.number().int().nullable().optional(),
  payload: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
           .optional()
           .refine((v: unknown) => !v || JSON.stringify(v).length <= 4096, { message: 'payload > 4KB; use artifact_refs' })
           .refine((v: unknown) => {
             if (!v) return true;
             try { JSON.stringify(v); return true; } catch { return false; }
           }, { message: 'payload must be JSON-serializable' }),
  artifact_refs: z.array(z.string()).optional(), // 大输出文件路径（mode 0600，按 trace-redaction-spec）
  error: z.object({
    type: z.string(),
    message: z.string(),
    stack: z.string().optional(),
  }).nullable().optional(),
});

export type TraceEvent = z.infer<typeof TraceEventSchema>;

/**
 * Trace context 跨子进程传播（W3C Trace Context format）
 *
 * v0A.1 修订（cursor B1）：trace_id 32 hex, span_id 16 hex（OTEL 标准）
 */
export interface TraceContext {
  trace_id: string;                              // 32 hex
  span_id: string;                               // 16 hex
  parent_span_id: string | null;
  trace_flags: number;                           // W3C: 1 byte (sampled = 0x01)
  // Vessel 特有
  conversation_id: string;                       // = session_id
  run_id: string;
}

/**
 * 子进程环境变量传播协议（v0A.1 修订：W3C 标准 TRACEPARENT）
 *
 * Format: 'TRACEPARENT=00-<32-hex-trace-id>-<16-hex-span-id>-<flags>'
 */
export const ENV_KEYS = {
  /** W3C Trace Context standard env var */
  TRACEPARENT: 'TRACEPARENT',
  /** Vessel 特有命名空间（OTEL spec 没有这俩概念）*/
  VESSEL_CONVERSATION_ID: 'VESSEL_CONVERSATION_ID',
  VESSEL_RUN_ID: 'VESSEL_RUN_ID',
} as const;

/**
 * 写 trace event；自动按 trace-redaction-spec 脱敏 payload
 *
 * M0 实施时（不引 OTEL SDK）：
 *   - 写到 instance/traces/<trace_id>/<span_id>.json（mode 0600）
 *   - 大输出（> 4KB）切到 instance/traces/<trace_id>/<span_id>.stdout（mode 0600）
 *
 * **v0A.1 risk-officer M-R2**：M0 落地时必须在 write() 内强制做 redaction
 * （不是依赖 caller 自行脱敏）。当前 schema 的 z.refine 只 cap 长度 + JSON
 * 校验，不做 secret detection；M0 加 fast-redact wrapper（按 trace-redaction-spec §9）
 * 在 write() 入口剥 sk-ant-* / OAuth tokens / 用户 prompt 内的私人路径。
 */
export interface TraceWriter {
  write(event: TraceEvent): Promise<void>;
  /** 创建子 span（child_span_id 自动生成；parent_span_id = current span） */
  childSpan(component: string): TraceContext;
}
