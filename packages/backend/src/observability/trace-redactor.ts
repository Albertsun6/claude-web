/**
 * Trace payload redactor (trace-redaction-spec §3 §4 §5).
 *
 * Applied at write() entry by FileTraceWriter. Two passes:
 *   1) field-path blacklist (3a): mask values at specific JSON paths
 *   2) content-pattern blacklist (3b): regex over all remaining string values
 *
 * Path whitelist (4): exempts /Users/yongqian/Desktop/Vessel/, .../claude-web/, /tmp/, /var/folders/
 * from the absolute-path regex.
 *
 * 4KB spillover (5): caller (trace-writer) handles writing oversized payload to
 * `<trace_id>/<span_id>.stdout` (mode 0600) and stuffing the path into artifact_refs.
 *
 * @see docs/design/trace-redaction-spec.md
 */

import { createHash } from 'node:crypto';

const REDACTED_FIELD_PATHS = new Set<string>([
  'payload.user_prompt',
  'payload.cli_args.path',
  'payload.api_response.body',
  'payload.headers.authorization',
  'payload.headers.cookie',
  'payload.headers.x-api-key',
]);

// payload.env.* — prefix match
const REDACTED_FIELD_PREFIXES = ['payload.env.'];

// CC stream-json schema (M0.5 driver stdout). These field-name suffixes hold
// model thinking / final text / tool input args / tool result content — all
// can replay the user prompt, generated code, or private file content. Match
// by terminal field name regardless of array indexing in the path.
// trace-redaction-spec §3a doesn't enumerate CC schema; this extends the
// blacklist for stdout files written by ClaudeCodeDriver.
const REDACTED_FIELD_SUFFIXES = [
  '.thinking',
  '.text',
  '.content',
  '.input',                         // tool_use.input — fields like command/file_path/content
  '.command',
  '.file_path',
  '.filePath',
  '.structuredPatch',
  '.originalFile',
  '.description',
  '.result',                        // CC stream-json final result text
  '.summary',
  '.message',                       // generic chat message body (not the OBJECT message which has nested redacted fields)
  '.prompt',
  '.user_prompt',
  '.error_message',
];

const PATH_WHITELIST = [
  '/Users/yongqian/Desktop/Vessel/',
  '/Users/yongqian/Desktop/claude-web/',
  '/tmp/',
  '/var/folders/',
];

interface PatternRule {
  re: RegExp;
  whitelist?: (match: string) => boolean;
}

const PATTERN_RULES: PatternRule[] = [
  // Anthropic API keys (specific before generic)
  { re: /sk-ant-[A-Za-z0-9_-]{40,}/g },
  // OpenAI-style keys
  { re: /sk-[A-Za-z0-9]{20,}/g },
  // AWS access keys
  { re: /AKIA[0-9A-Z]{16}/g },
  // Email addresses
  { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  // Absolute /Users/<name>/ paths — skip whitelisted roots
  {
    re: /\/Users\/[^/\s]+\/[^\s]*/g,
    whitelist: (m) => PATH_WHITELIST.some((p) => m.startsWith(p)),
  },
  // Generic 20+ char base64-ish tokens (run last so specific patterns win).
  // Exempt UUID v4 (8-4-4-4-12 hex) and pure-hex IDs ≥ 16 chars (OTEL trace/span format)
  // since spec §2 white-lists UUIDs / hex IDs as non-sensitive.
  {
    re: /[A-Za-z0-9_-]{20,}/g,
    whitelist: (m) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m) ||
      /^[0-9a-f]{16,}$/i.test(m),
  },
];

function hash6(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 6);
}

function redactString(s: string): string {
  let out = s;
  for (const rule of PATTERN_RULES) {
    out = out.replace(rule.re, (m) => {
      if (rule.whitelist?.(m)) return m;
      return `***-redacted-${hash6(m)}***`;
    });
  }
  return out;
}

function isPathRedacted(path: string): boolean {
  if (REDACTED_FIELD_PATHS.has(path)) return true;
  if (REDACTED_FIELD_PREFIXES.some((p) => path.startsWith(p))) return true;
  return REDACTED_FIELD_SUFFIXES.some((s) => path.endsWith(s));
}

function redactValue(value: unknown, path: string, forceMask = false): unknown {
  // forceMask = true means "we are below a path that matched the blacklist;
  // every leaf in this subtree must be masked even if its own field name
  // doesn't appear in the SUFFIX list" (M0.5 risk-officer R-M0.5-2 fix:
  // CC schema evolution can add fields under `.input` / `.message` etc. that
  // aren't on our suffix list; force-mask closes that bypass).
  const matched = isPathRedacted(path);
  const masking = forceMask || matched;

  if (typeof value === 'string') {
    return masking ? '***' : redactString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return masking ? '***' : value;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => redactValue(v, `${path}[${i}]`, masking));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(v, `${path}.${k}`, masking);
    }
    return out;
  }
  return value;
}

export function redactPayload(payload: unknown): unknown {
  if (payload === undefined || payload === null) return payload;
  return redactValue(payload, 'payload');
}

/**
 * 4KB spillover decision (trace-redaction-spec §5).
 * Returns the inline payload (≤ 4 KiB stringified) or null if caller should spill to artifact_refs.
 */
export const PAYLOAD_INLINE_LIMIT_BYTES = 4 * 1024;

export function payloadFitsInline(payload: unknown): boolean {
  if (payload === undefined || payload === null) return true;
  return Buffer.byteLength(JSON.stringify(payload), 'utf8') <= PAYLOAD_INLINE_LIMIT_BYTES;
}

/**
 * Build a 200-char redacted summary for over-size payloads (per §5).
 */
export function payloadSummary(payload: unknown): string {
  const raw = JSON.stringify(payload);
  const sliced = raw.slice(0, 200);
  return redactString(sliced) + '...[truncated]';
}
