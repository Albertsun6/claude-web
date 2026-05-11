/**
 * Intent Classifier v1 — routes user text to execution_depth + domain.
 *
 * Two-level strategy:
 *   Level 1: Rules (< 1ms, no LLM) — regex patterns for Operations + Pipeline signals.
 *   Level 2: Haiku fallback — for ambiguous intents (confidence < HAIKU_THRESHOLD).
 *            Disabled in MVP; can be enabled by setting VESSEL_INTENT_HAIKU=1.
 *
 * Output: ClassifierResult with execution_depth, domain, confidence, method.
 */

import type { ExecutionDepth, Domain } from './domains.config.js';

export interface ClassifierResult {
  execution_depth: ExecutionDepth;
  domain: Domain;
  confidence: number;
  domains_secondary?: Domain[];
  method: 'rules' | 'llm';
}

// Patterns that strongly signal Operations (CRUD + cron + proactive).
const OPS_PATTERNS = [
  // 时间锚点
  /明天|后天|下周|下个月|今晚|今天下午|今天上午/,
  /\d{1,2}点(\d{1,2}分)?|下午\d|上午\d/,
  // 提醒/任务动词
  /提醒(我|一下)?|记一下|添加任务|创建任务|定个(会议|任务|提醒)|记得/,
  // 周期
  /每天|每周|每月|每年|定期|cron\b|schedule\b/i,
  // 日历/任务直接词
  /日历|任务列表|待办|to.?do\b/i,
];

// Patterns that strongly signal Pipeline (multi-step project / engineering work).
const PIPELINE_PATTERNS = [
  /做一个.{0,12}(项目|功能|系统|工具|应用|模块|接口|服务)/,
  /开发.{0,12}(一个|功能|系统|接口)|实现.{0,12}(功能|接口|系统|服务)/,
  /harness\b|新(issue|feature|功能)|多步|分阶段/,
  /写一本(书|小说|教程)|制定.{0,10}计划.*多(天|周|月)/,
];

// Operations domain sub-classifiers.
const OPS_FINANCE_PATTERNS = [/股票|基金|持仓|投资|价格提醒|跌到|涨到|监控.{0,8}(价|市值)/];
const OPS_LEARNING_PATTERNS = [/每天.{0,10}(学|练|复习)|进度追踪|打卡/];
const OPS_SOCIAL_PATTERNS = [/定期联系|提醒我联系|定期问候/];

const HAIKU_FALLBACK_ENABLED = process.env.VESSEL_INTENT_HAIKU === '1';
const HAIKU_THRESHOLD = 0.7;

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

function classifyOpsSubDomain(text: string): Domain {
  if (matchesAny(text, OPS_FINANCE_PATTERNS)) return 'finance';
  if (matchesAny(text, OPS_LEARNING_PATTERNS)) return 'learning';
  if (matchesAny(text, OPS_SOCIAL_PATTERNS)) return 'social';
  return 'life';
}

function applyRules(text: string): ClassifierResult {
  if (matchesAny(text, OPS_PATTERNS)) {
    return {
      execution_depth: 'operations',
      domain: classifyOpsSubDomain(text),
      confidence: 0.85,
      method: 'rules',
    };
  }
  if (matchesAny(text, PIPELINE_PATTERNS)) {
    return {
      execution_depth: 'pipeline',
      domain: 'engineering',
      confidence: 0.85,
      method: 'rules',
    };
  }
  // Default: direct, unknown domain. Confidence set to HAIKU_THRESHOLD so
  // Haiku fallback triggers if enabled; otherwise direct is returned as-is.
  return {
    execution_depth: 'direct',
    domain: 'unknown',
    confidence: HAIKU_FALLBACK_ENABLED ? HAIKU_THRESHOLD - 0.01 : HAIKU_THRESHOLD,
    method: 'rules',
  };
}

/**
 * Lightweight Haiku classification via claude CLI --print.
 * Spawns a one-shot subprocess; not intended for hot-path use.
 */
async function classifyWithHaiku(text: string): Promise<ClassifierResult> {
  const { spawnSync } = await import('node:child_process');
  const prompt = `Classify this request. Reply with JSON only, no explanation:
{"depth":"pipeline|operations|direct","domain":"engineering|learning|creation|finance|life|social","conf":0.0-1.0}
Request: "${text.slice(0, 120).replace(/"/g, "'")}"`;

  const result = spawnSync(
    process.env.CLAUDE_CLI ?? 'claude',
    ['--print', '--model', 'claude-haiku-4-5-20251001', '--no-cache'],
    { input: prompt, encoding: 'utf-8', timeout: 8000 },
  );

  if (result.status !== 0 || !result.stdout) {
    // Haiku unavailable — fall back to direct
    return { execution_depth: 'direct', domain: 'unknown', confidence: 0.5, method: 'llm' };
  }

  try {
    const match = result.stdout.match(/\{[^}]+\}/);
    if (!match) throw new Error('no JSON');
    const parsed = JSON.parse(match[0]) as { depth: string; domain: string; conf: number };
    return {
      execution_depth: (['pipeline', 'operations', 'direct'].includes(parsed.depth)
        ? parsed.depth : 'direct') as ExecutionDepth,
      domain: (['engineering','learning','creation','finance','life','social'].includes(parsed.domain)
        ? parsed.domain : 'unknown') as Domain,
      confidence: typeof parsed.conf === 'number' ? Math.min(1, Math.max(0, parsed.conf)) : 0.6,
      method: 'llm',
    };
  } catch {
    return { execution_depth: 'direct', domain: 'unknown', confidence: 0.5, method: 'llm' };
  }
}

/**
 * Classify a user intent text.
 *
 * Uses Rules first; falls back to Haiku only when VESSEL_INTENT_HAIKU=1
 * and confidence < 0.7.
 */
export async function classify(text: string): Promise<ClassifierResult> {
  const ruleResult = applyRules(text);
  if (!HAIKU_FALLBACK_ENABLED || ruleResult.confidence >= HAIKU_THRESHOLD) {
    return ruleResult;
  }
  return classifyWithHaiku(text);
}
