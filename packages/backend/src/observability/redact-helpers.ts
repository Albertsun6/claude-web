/**
 * redactFreeformText — for free-form text persistence (lessons body, retro markdown).
 *
 * Distinct from `trace-redactor.ts`:
 *   - trace-redactor: structured trace events (JSON tree, field-path blacklist + subtree force-mask)
 *   - this file:     free-form string (chat history-style; no JSON path semantics)
 *
 * Reuses the same PATTERN_RULES as trace-redactor (sk-ant-* / sk-* / AWS / email /
 * absolute /Users/<name>/ paths / generic 20+ char tokens with UUID whitelist) PLUS
 * adds free-form-specific rules: `~/...`, `$HOME/...` shorthand paths.
 *
 * @see trace-redactor.ts (Vessel L1 review BLOCKER B2: cursor抓出 trace redactor 不覆盖
 *      free-form home shorthand → 抽出独立 helper 满足 redactFreeformText 范围)
 */

import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

const HOME = homedir();
const VESSEL_DATA_DIR_ENV = process.env.VESSEL_DATA_DIR ?? `${HOME}/.vessel`;

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

const FREEFORM_PATTERN_RULES: PatternRule[] = [
  // Anthropic API keys (specific before generic)
  { re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  // OpenAI-style keys
  { re: /sk-[A-Za-z0-9]{20,}/g },
  // AWS access keys
  { re: /AKIA[0-9A-Z]{16}/g },
  // Email addresses
  { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  // Absolute /Users/<name>/ paths — skip whitelisted Vessel/Eva/tmp roots
  {
    re: /\/Users\/[^/\s]+\/[^\s]*/g,
    whitelist: (m) => PATH_WHITELIST.some((p) => m.startsWith(p)),
  },
  // Free-form home shorthand (Vessel L1 review B2 fix): ~/... or $HOME/...
  // Whitelist Vessel-relative paths (post-PASS-1 normalization replaces /Users/<owner>/Desktop/Vessel/
  // → $HOME/Desktop/Vessel/, which is the same whitelisted root in shorthand form).
  {
    re: /(?:~|\$HOME)\/[^\s]*/g,
    whitelist: (m) => {
      const tail = m.replace(/^(?:~|\$HOME)/, '');
      return PATH_WHITELIST.some((p) => {
        const homePrefix = p.replace(/^\/Users\/[^/]+/, '');
        return homePrefix && tail.startsWith(homePrefix);
      });
    },
  },
  // Generic 20+ char base64-ish tokens (run last). Exempt UUID v4 + pure-hex IDs ≥ 16
  // (OTEL trace/span format) — these are deemed non-sensitive by trace-redaction-spec §2.
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

function maskMatch(m: string): string {
  return `***-redacted-${hash6(m)}***`;
}

export interface RedactFreeformOptions {
  relativizeHome?: boolean;     // default true; replace VESSEL_DATA_DIR + HOME with $VESSEL_DATA_DIR / $HOME
}

export function redactFreeformText(text: string, opts: RedactFreeformOptions = {}): string {
  const relativize = opts.relativizeHome !== false;
  let out = text;

  // Path relativize PASS 1: replace VESSEL_DATA_DIR-prefix paths first (more specific than HOME).
  if (relativize) {
    if (VESSEL_DATA_DIR_ENV) {
      out = out.split(VESSEL_DATA_DIR_ENV + '/').join('$VESSEL_DATA_DIR/');
      out = out.split(VESSEL_DATA_DIR_ENV).join('$VESSEL_DATA_DIR');
    }
    if (HOME) {
      // After VESSEL_DATA_DIR substitution, replace remaining HOME paths with $HOME/.
      // Whitelisted paths under /Users/<owner>/Desktop/Vessel/ etc. stay because the
      // pattern rules check whitelist; this just collapses the home prefix.
      out = out.split(HOME + '/').join('$HOME/');
    }
  }

  // PASS 2: pattern-based redaction (sk-ant-*, AWS, email, paths, generic tokens).
  for (const rule of FREEFORM_PATTERN_RULES) {
    out = out.replace(rule.re, (m) => {
      if (rule.whitelist?.(m)) return m;
      return maskMatch(m);
    });
  }

  return out;
}
