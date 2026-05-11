#!/usr/bin/env -S npx tsx
/**
 * vessel-core CLI entry — M0 minimal (FRAMEWORK §2.1 Orchestrator).
 *
 * Usage:
 *   pnpm vessel-core "echo hi"
 *   pnpm vessel-core --help
 *   pnpm vessel-core --session=<id> "..."
 *
 * Acceptance (per ROADMAP M0):
 *   - exit 0 + stdout 含 'echoed: hi'
 *   - sqlite3 ~/.vessel/memory.db "select count(*) from sessions" ≥ 1
 *   - SIGINT 后 5 秒内进程退出 + SQLite 无锁残留
 */

import 'dotenv/config';
import { checkRenamedEnvVars } from '../startup-env-check.js';

checkRenamedEnvVars();

import { runIntent } from '../orchestrator.js';
import { closeMemoryDb, openMemoryDb } from '../memory/session-store.js';
import { addLesson, searchLessons, type LessonKind } from '../memory/lesson-store.js';
import { listWorkflows, getWorkflow } from '../memory/workflow-store.js';
import { addMemory, searchMemory, listMemory, memoryCount, type MemoryKind } from '../memory/memory-store.js';
import { ready as embedderReady, health as embedderHealth, getEmbedModel } from '../memory/embedder.js';
import { cleanupMcpConfig } from '../mcp/cli-config.js';
import { loadSoulOrNull, parseSoulFile, defaultSoulPath, SoulParseError } from '../soul/parser.js';
import { renderSoulPrompt } from '../soul/injector.js';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, sep, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../data-dir.js';
import type { TraceEvent } from '../observability/trace.js';

const HELP = `vessel-core — Vessel internal kernel CLI (M0.5 / M1A-α)

Usage:
  pnpm vessel-core [options] "<intent text>"     # run an intent
  pnpm vessel-core list [--limit N]              # M1A-α: list recent sessions/intents/runs
  pnpm vessel-core trace replay <trace_id>       # M1A-α: print span tree from ~/.vessel/traces/
  pnpm vessel-core workflow list [--status=S]    # M1C-A: list workflows (status: all|pending|running|paused|interrupted|completed|failed|cancelled)
  pnpm vessel-core workflow resume <id> [opts]   # M1C-A: resume a paused/interrupted workflow (--option=S --skip)
  pnpm vessel-core init --template=<name>        # M2-Soul: clone soul template to $VESSEL_DATA_DIR/soul.md (rejects unedited templates)
  pnpm vessel-core soul show-prompt              # M2-Soul: print the system prompt that would be injected from current soul.md
  pnpm vessel-core soul list-templates           # M2-Soul: list available templates in templates/soul/
  pnpm vessel-core memory add --kind=K --content=...  # M1C-B: store a memory record + embedding
  pnpm vessel-core memory search "query" [--top=5]    # M1C-B: KNN over stored memories
  pnpm vessel-core memory list [--kind=K]             # M1C-B: list recent records (no embed)
  pnpm vessel-core memory status                      # M1C-B: embedder + count snapshot

Options:
  -h, --help              Show this help message
  --session=<id>          Reuse existing session id (else fresh uuid)
  --skill=echo|coding     Override skill dispatch (default: coding)
  --limit=N               (list only) cap rows (default 20)

Examples:
  pnpm vessel-core --skill=echo "hi"
  pnpm vessel-core --session=abc-123 --skill=echo "again"
  pnpm vessel-core "写 fibonacci.py"
  pnpm vessel-core list --limit=10
  pnpm vessel-core trace replay 6876afe8466bfe5f98afba94d6068abd
  pnpm vessel-core workflow list --status=paused
  pnpm vessel-core workflow resume wf-abc123 --option=approve
  pnpm vessel-core init --template=jarvis-style
  pnpm vessel-core soul show-prompt

Data:
  Sessions / intents / skill_invocations  →  $VESSEL_DATA_DIR/memory.db
  Trace events                             →  $VESSEL_DATA_DIR/traces/<trace_id>/<span_id>.json

NFR:
  SIGINT triggers graceful shutdown (close DB) within 5s.
`;

interface ParsedArgs {
  help: boolean;
  sessionId?: string;
  skill?: 'echo' | 'coding';
  text: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  let help = false;
  let sessionId: string | undefined;
  let skill: 'echo' | 'coding' | undefined;
  const positional: string[] = [];

  for (const a of argv) {
    if (a === '-h' || a === '--help') help = true;
    else if (a.startsWith('--session=')) sessionId = a.slice('--session='.length);
    else if (a === '--skill=echo') skill = 'echo';
    else if (a === '--skill=coding') skill = 'coding';
    else positional.push(a);
  }

  return { help, sessionId, skill, text: positional.join(' ') };
}

/**
 * M1A-α: `vessel-core list [--limit N]`
 * Direct SELECT on memory.db. M1A stub — replaced by Memory interface in M1C-B per ADR-002.
 */
function cmdList(limit: number): number {
  const db = openMemoryDb();
  const sessions = db.prepare(`SELECT id, created_at, last_seen_at FROM sessions ORDER BY last_seen_at DESC LIMIT ?`).all(limit) as Array<{ id: string; created_at: string; last_seen_at: string }>;
  const skills = db.prepare(`
    SELECT si.id AS run_id, si.session_id, si.skill_id, si.status, si.trace_id, si.completed_at, i.text AS intent_text
    FROM skill_invocations si
    JOIN intents i ON i.id = si.intent_id
    ORDER BY si.completed_at DESC LIMIT ?
  `).all(limit) as Array<{ run_id: string; session_id: string; skill_id: string; status: string; trace_id: string; completed_at: string | null; intent_text: string }>;

  process.stdout.write(`# Sessions (last ${sessions.length})\n`);
  for (const s of sessions) {
    process.stdout.write(`  ${s.id}  last_seen=${s.last_seen_at}\n`);
  }
  process.stdout.write(`\n# Skill invocations (last ${skills.length})\n`);
  for (const r of skills) {
    const t = r.intent_text.length > 50 ? r.intent_text.slice(0, 50) + '...' : r.intent_text;
    process.stdout.write(`  ${r.run_id}  ${r.skill_id.padEnd(7)} ${r.status.padEnd(9)} trace=${r.trace_id.slice(0, 16)}  "${t}"\n`);
  }
  closeMemoryDb();
  return 0;
}

/**
 * M1A-α: `vessel-core trace replay <trace_id>`
 * Reads ~/.vessel/traces/<trace_id>/*.json and prints span tree by parent_span_id.
 */
function cmdTraceReplay(traceId: string): number {
  const dir = join(DATA_DIR, 'traces', traceId);
  if (!existsSync(dir)) {
    process.stderr.write(`vessel-core trace: no trace dir for ${traceId} at ${dir}\n`);
    return 1;
  }
  const events: TraceEvent[] = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TraceEvent)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Build span tree. parent_span_id null = root span(s).
  const byParent = new Map<string | null, TraceEvent[]>();
  for (const e of events) {
    const k = e.parent_span_id ?? null;
    const arr = byParent.get(k) ?? [];
    arr.push(e);
    byParent.set(k, arr);
  }

  function printSpan(e: TraceEvent, depth: number): void {
    const indent = '  '.repeat(depth);
    const dur = e.duration_ms != null ? `${e.duration_ms}ms` : '—';
    process.stdout.write(`${indent}[${e.event_type}] ${e.component} ${e.status} (${dur}) span=${e.span_id.slice(0, 8)}\n`);
    const children = byParent.get(e.span_id) ?? [];
    for (const c of children) printSpan(c, depth + 1);
  }

  process.stdout.write(`# Trace ${traceId} (${events.length} spans)\n`);
  const roots = byParent.get(null) ?? [];
  for (const r of roots) printSpan(r, 0);
  return 0;
}

const VALID_LESSON_KINDS = new Set<LessonKind>([
  'review_closeout', 'bug_lesson', 'decision', 'risk', 'spike',
]);

/**
 * M1 L1-minimal: `vessel-core lesson add --kind=K --title=T --body=B [--milestone=...] [--tags=a,b] [--refs=...]`
 * Body redacted at write via redactFreeformText (generation-layer per M1A-β arbiter教训).
 */
function cmdLessonAdd(args: string[]): number {
  const get = (flag: string): string | undefined => {
    const found = args.find((a) => a.startsWith(`--${flag}=`));
    return found?.slice(flag.length + 3);
  };
  const kind = get('kind') as LessonKind | undefined;
  const title = get('title');
  const body = get('body');
  if (!kind || !VALID_LESSON_KINDS.has(kind)) {
    process.stderr.write(`vessel-core lesson add: --kind required, one of ${[...VALID_LESSON_KINDS].join('/')}\n`);
    return 2;
  }
  if (!title || !body) {
    process.stderr.write('vessel-core lesson add: --title and --body required\n');
    return 2;
  }
  const tagsArg = get('tags');
  const refsArg = get('refs');
  const milestone = get('milestone');
  const importance = get('importance') ? parseInt(get('importance')!, 10) : undefined;

  const row = addLesson({
    kind,
    title,
    body,
    milestone,
    tags: tagsArg ? tagsArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    refs: refsArg ? refsArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    importance,
  });
  process.stdout.write(`${row.id}\n`);
  return 0;
}

function cmdLessonSearch(args: string[]): number {
  const get = (flag: string): string | undefined => {
    const found = args.find((a) => a.startsWith(`--${flag}=`));
    return found?.slice(flag.length + 3);
  };
  const positional = args.filter((a) => !a.startsWith('--'));
  const q = positional[0];
  const limit = get('limit') ? Math.max(1, parseInt(get('limit')!, 10) || 20) : 20;
  const rows = searchLessons({
    q,
    kind: get('kind') as LessonKind | undefined,
    milestone: get('milestone'),
    tag: get('tag'),
    limit,
  });
  if (rows.length === 0) {
    process.stdout.write('# 0 lessons found\n');
    closeMemoryDb();
    return 0;
  }
  process.stdout.write(`# ${rows.length} lesson(s)\n`);
  for (const r of rows) {
    const titleShort = r.title.length > 80 ? r.title.slice(0, 80) + '…' : r.title;
    const tags = r.tags ?? '';
    process.stdout.write(`  ${r.id.slice(0, 8)} [${r.kind}] ${(r.milestone ?? '-').padEnd(8)} imp=${r.importance} tags=${tags}\n    ${titleShort}\n`);
  }
  closeMemoryDb();
  return 0;
}

/**
 * M1 L1-minimal: `vessel-core closeout finalize --milestone=... --report=<path> --insight=... --mistake=...`
 *
 * The atomic generation-layer entry for review_closeout lessons (B-级 review BLOCKER fix:
 * cursor B1 + architect M-2). Redacts body, INSERTs lesson row, appends `lesson_id: <id>` line
 * to the verify-gate markdown so it's reviewer-traceable.
 */
function cmdCloseoutFinalize(args: string[]): number {
  const get = (flag: string): string | undefined => {
    const found = args.find((a) => a.startsWith(`--${flag}=`));
    return found?.slice(flag.length + 3);
  };
  const milestone = get('milestone');
  const reportPath = get('report');
  const insight = get('insight');
  const mistake = get('mistake');
  const tagsArg = get('tags');

  if (!milestone || !insight) {
    process.stderr.write('vessel-core closeout finalize: --milestone and --insight required\n');
    return 2;
  }

  // Body = "biggest insight" (title) + "biggest mistake" + report path ref
  const body = [
    `Insight: ${insight}`,
    mistake ? `Mistake: ${mistake}` : '',
    reportPath ? `Report: ${reportPath}` : '',
  ].filter(Boolean).join('\n\n');

  const row = addLesson({
    kind: 'review_closeout',
    title: insight,
    body,
    milestone,
    tags: tagsArg ? tagsArg.split(',').map((s) => s.trim()).filter(Boolean) : ['closeout'],
    refs: reportPath ? [reportPath] : undefined,
    importance: 4,
  });

  // Append lesson_id ref to the verify-gate markdown for reviewer traceability.
  // Path safety (closeout review BLOCKER R-L1-1): the resolved path must contain
  // `/docs/reviews/<file>.md`, exist, not be a symlink, and realpath must match.
  // We don't enforce a single repo-root prefix because pnpm filter may cd into
  // packages/<x>; the structural docs/reviews/ pattern is what matters.
  if (reportPath) {
    let safe = false;
    let resolved = '';
    try {
      resolved = isAbsolute(reportPath) ? reportPath : resolve(process.cwd(), reportPath);
      const looksLikeReview = /\/docs\/reviews\/[^/]+\.md$/.test(resolved);
      if (looksLikeReview && existsSync(resolved)) {
        const st = lstatSync(resolved);
        if (!st.isSymbolicLink()) {
          const real = realpathSync(resolved);
          // realpath must also satisfy the docs/reviews structural shape
          if (/\/docs\/reviews\/[^/]+\.md$/.test(real)) safe = true;
        }
      }
    } catch { /* fall through to safe=false */ }

    if (!safe) {
      process.stderr.write(`vessel-core closeout: refusing unsafe --report path "${reportPath}" (must resolve to <...>/docs/reviews/<file>.md, no symlinks, no traversal)\n`);
    } else {
      try {
        appendFileSync(resolved, `\n\nlesson_id: ${row.id}\n`);
      } catch {
        process.stderr.write(`vessel-core closeout: warning — could not append lesson_id to ${resolved}\n`);
      }
    }
  }

  process.stdout.write(`${row.id}\n`);
  closeMemoryDb();
  return 0;
}

function cmdWorkflowList(args: string[]): number {
  let status: string = 'all';
  let limit = 50;
  for (const a of args) {
    if (a.startsWith('--status=')) status = a.slice('--status='.length);
    if (a.startsWith('--limit=')) limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 50);
  }

  openMemoryDb();
  const rows = listWorkflows({ status: status as never, limit });
  closeMemoryDb();

  if (rows.length === 0) {
    process.stdout.write('(no workflows)\n');
    return 0;
  }

  for (const r of rows) {
    const pausedNote = r.paused_reason ? ` — "${r.paused_reason}"` : '';
    process.stdout.write(`${r.status.padEnd(12)} ${r.id}  step=${r.current_step}/${r.total_steps}  kind=${r.kind}${pausedNote}\n`);
  }
  return 0;
}

async function cmdWorkflowResume(args: string[]): Promise<number> {
  const id = args[0];
  if (!id) {
    process.stderr.write('vessel-core workflow resume: missing workflow id\n');
    return 2;
  }

  let option: string | undefined;
  let skip = false;
  for (const a of args.slice(1)) {
    if (a.startsWith('--option=')) option = a.slice('--option='.length);
    if (a === '--skip') skip = true;
  }

  const apiUrl = process.env['VESSEL_API_URL'] ?? 'http://127.0.0.1:3030';
  const body: Record<string, unknown> = {};
  if (option) body['option'] = option;
  if (skip) body['skip'] = true;

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/vessel/workflows/${encodeURIComponent(id)}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    process.stderr.write(`vessel-core workflow resume: server unreachable at ${apiUrl} — ${err instanceof Error ? err.message : err}\n`);
    process.stderr.write('Is vessel-core HTTP server running? Start with: pnpm dev:backend\n');
    return 1;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    process.stderr.write(`vessel-core workflow resume: HTTP ${res.status} — ${text}\n`);
    return 1;
  }

  const data = await res.json() as Record<string, unknown>;
  process.stdout.write(`resumed workflow ${id} from step ${data['fromStep']}\n`);
  return 0;
}

/** Locate templates/soul/ — relative to this source file, walking up out of packages/backend. */
function templatesSoulDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/cli → src → backend → packages → repo root → templates/soul
  return resolve(here, '..', '..', '..', '..', 'templates', 'soul');
}

function listSoulTemplates(): string[] {
  const dir = templatesSoulDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.soul.md'))
    .map(f => f.replace(/\.soul\.md$/, ''));
}

function cmdSoulListTemplates(): number {
  const names = listSoulTemplates();
  if (names.length === 0) {
    process.stderr.write(`vessel-core: no templates found in ${templatesSoulDir()}\n`);
    return 1;
  }
  for (const n of names) process.stdout.write(`${n}\n`);
  return 0;
}

function cmdSoulShowPrompt(): number {
  let soul;
  try {
    soul = loadSoulOrNull();
  } catch (err) {
    process.stderr.write(`vessel-core soul: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  if (!soul) {
    process.stderr.write(`vessel-core soul: no soul.md at ${defaultSoulPath()} (run 'vessel-core init --template=<name>' first)\n`);
    return 1;
  }
  process.stdout.write(`${renderSoulPrompt(soul)}\n`);
  return 0;
}

/**
 * `vessel-core init --template=<name>` — clone a soul template to
 * $VESSEL_DATA_DIR/soul.md and verify that the user has personalized it.
 *
 * Behavior:
 *   - First run: writes soul.md from the template and exits non-zero with a
 *     "must modify ≥ 1 field" message (the just-written file IS the template).
 *   - User edits ~/.vessel/soul.md.
 *   - Re-run: detects soul.md ≠ template (and ≠ any other template) → exit 0.
 *
 * --force overwrites existing soul.md (otherwise existing files are not
 * touched; the verification step still runs against current contents).
 */
function cmdInit(args: string[]): number {
  let templateName: string | undefined;
  let force = false;
  for (const a of args) {
    if (a.startsWith('--template=')) templateName = a.slice('--template='.length);
    if (a === '--force') force = true;
  }

  if (!templateName) {
    process.stderr.write('vessel-core init: --template=<name> required\n');
    process.stderr.write('Available templates:\n');
    for (const n of listSoulTemplates()) process.stderr.write(`  - ${n}\n`);
    return 2;
  }

  const tplPath = join(templatesSoulDir(), `${templateName}.soul.md`);
  if (!existsSync(tplPath)) {
    process.stderr.write(`vessel-core init: template "${templateName}" not found at ${tplPath}\n`);
    return 2;
  }

  const tplContent = readFileSync(tplPath, 'utf8');
  const targetPath = defaultSoulPath();
  const targetDir = dirname(targetPath);
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  let wrote = false;
  if (!existsSync(targetPath) || force) {
    writeFileSync(targetPath, tplContent, { mode: 0o600 });
    wrote = true;
    process.stdout.write(`wrote ${targetPath} from template "${templateName}"\n`);
  }

  // Verify: the on-disk soul.md must be parseable AND must NOT equal any
  // template byte-for-byte (i.e. user has edited at least one field).
  const onDisk = readFileSync(targetPath, 'utf8');

  // Parseability check (catches malformed user edits early).
  try {
    parseSoulFile(targetPath);
  } catch (err) {
    process.stderr.write(`vessel-core init: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  // Personalization check — soul.md must differ from every template.
  const templates = listSoulTemplates();
  for (const name of templates) {
    const p = join(templatesSoulDir(), `${name}.soul.md`);
    const c = readFileSync(p, 'utf8');
    if (c === onDisk) {
      process.stderr.write(
        `vessel-core init: ${targetPath} is identical to template "${name}" — must modify ≥ 1 field before use.\n`
      );
      if (wrote) {
        process.stderr.write(`Edit ${targetPath} to personalize, then re-run 'vessel-core init --template=${templateName}'.\n`);
      }
      return 1;
    }
  }

  process.stdout.write(`${targetPath} is personalized — soul ready.\n`);
  return 0;
}

// ─── M1C-B memory subcommands ─────────────────────────────────────────────

async function cmdMemoryAdd(args: string[]): Promise<number> {
  let kind: MemoryKind = 'note';
  let content = '';
  let source: string | undefined;
  for (const a of args) {
    if (a.startsWith('--kind=')) {
      const v = a.slice('--kind='.length);
      if (v !== 'note' && v !== 'fact' && v !== 'episode' && v !== 'preference') {
        process.stderr.write(`vessel-core memory add: invalid --kind=${v} (must be note|fact|episode|preference)\n`);
        return 2;
      }
      kind = v;
    } else if (a.startsWith('--content=')) {
      content = a.slice('--content='.length);
    } else if (a.startsWith('--source=')) {
      source = a.slice('--source='.length);
    }
  }

  if (!content.trim()) {
    process.stderr.write('vessel-core memory add: --content=<text> required (non-empty)\n');
    return 2;
  }

  openMemoryDb();
  try {
    const row = await addMemory({ kind, content, ...(source ? { source } : {}) });
    process.stdout.write(`stored memory id=${row.id} kind=${row.kind} model=${row.embedding_model}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`vessel-core memory add: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    closeMemoryDb();
  }
}

async function cmdMemorySearch(args: string[]): Promise<number> {
  const query = args.find(a => !a.startsWith('--')) ?? '';
  if (!query.trim()) {
    process.stderr.write('vessel-core memory search: query argument required\n');
    return 2;
  }
  let top = 5;
  for (const a of args) {
    if (a.startsWith('--top=')) {
      const n = parseInt(a.slice('--top='.length), 10);
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write('vessel-core memory search: --top must be a positive integer\n');
        return 2;
      }
      top = Math.min(n, 50);
    }
  }

  openMemoryDb();
  try {
    const hits = await searchMemory(query, top);
    if (hits.length === 0) {
      process.stdout.write('(no matches)\n');
      return 0;
    }
    for (const h of hits) {
      const dist = h.distance.toFixed(4);
      const snippet = h.content.replace(/\s+/g, ' ').slice(0, 80);
      process.stdout.write(`${dist}  [${h.kind}] #${h.id}  ${snippet}\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`vessel-core memory search: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    closeMemoryDb();
  }
}

function cmdMemoryList(args: string[]): number {
  let kind: MemoryKind | undefined;
  let limit = 20;
  for (const a of args) {
    if (a.startsWith('--kind=')) {
      const v = a.slice('--kind='.length);
      if (v !== 'note' && v !== 'fact' && v !== 'episode' && v !== 'preference') {
        process.stderr.write(`vessel-core memory list: invalid --kind=${v}\n`);
        return 2;
      }
      kind = v;
    }
    if (a.startsWith('--limit=')) limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 20);
  }
  openMemoryDb();
  const rows = listMemory({ ...(kind ? { kind } : {}), limit });
  closeMemoryDb();
  if (rows.length === 0) {
    process.stdout.write('(no memory records)\n');
    return 0;
  }
  for (const r of rows) {
    const snippet = r.content.replace(/\s+/g, ' ').slice(0, 80);
    process.stdout.write(`#${r.id}  [${r.kind}]  ${snippet}\n`);
  }
  return 0;
}

async function cmdMemoryStatus(): Promise<number> {
  openMemoryDb();
  const count = memoryCount();
  closeMemoryDb();

  // Pre-warm so health() reflects "loaded" if user wants to verify embedder.
  // We don't await here — ready() may be slow on first call. Just snapshot
  // current state (loaded vs not) and report.
  const h = embedderHealth();

  process.stdout.write(`embedder: model=${h.model}  loaded=${h.loaded}  ok=${h.ok}${h.reason ? `  reason=${h.reason}` : ''}\n`);
  process.stdout.write(`records:  ${count}\n`);
  process.stdout.write(`current model id: ${getEmbedModel()}\n`);
  // Don't await ready() — would block if user just wants to see status.
  void embedderReady().catch(() => { /* ignore for status */ });
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  // Subcommand: list / trace replay / lesson / closeout (M1A-α / M1)
  if (argv[0] === 'list') {
    let limit = 20;
    for (const a of argv.slice(1)) {
      if (a.startsWith('--limit=')) limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 20);
    }
    return cmdList(limit);
  }
  if (argv[0] === 'trace' && argv[1] === 'replay' && typeof argv[2] === 'string') {
    return cmdTraceReplay(argv[2]);
  }
  // M1 L1-minimal subcommands
  if (argv[0] === 'lesson' && argv[1] === 'add') return cmdLessonAdd(argv.slice(2));
  if (argv[0] === 'lesson' && (argv[1] === 'search' || argv[1] === 'list')) return cmdLessonSearch(argv.slice(2));
  if (argv[0] === 'closeout' && argv[1] === 'finalize') return cmdCloseoutFinalize(argv.slice(2));
  // M1C-A workflow subcommands
  if (argv[0] === 'workflow' && argv[1] === 'list') return cmdWorkflowList(argv.slice(2));
  if (argv[0] === 'workflow' && argv[1] === 'resume') return await cmdWorkflowResume(argv.slice(2));
  // M2-Soul subcommands
  if (argv[0] === 'init') return cmdInit(argv.slice(1));
  if (argv[0] === 'soul' && argv[1] === 'show-prompt') return cmdSoulShowPrompt();
  if (argv[0] === 'soul' && argv[1] === 'list-templates') return cmdSoulListTemplates();
  // M1C-B memory subcommands
  if (argv[0] === 'memory' && argv[1] === 'add') return await cmdMemoryAdd(argv.slice(2));
  if (argv[0] === 'memory' && argv[1] === 'search') return await cmdMemorySearch(argv.slice(2));
  if (argv[0] === 'memory' && argv[1] === 'list') return cmdMemoryList(argv.slice(2));
  if (argv[0] === 'memory' && argv[1] === 'status') return await cmdMemoryStatus();

  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (!args.text || args.text.trim() === '') {
    process.stderr.write('vessel-core: missing intent text. Try --help.\n');
    return 2;
  }

  // Graceful shutdown — close DB within 5s budget (NFR-F1).
  // M0.5: SIGINT/SIGTERM aborts in-flight CodingDriver runs (process group SIGTERM
  // → 5s SIGKILL). The runIntent promise resolves via cancellation; CLI then
  // closes DB and exits. Hard exit only if runIntent doesn't return within budget.
  const abortCtl = new AbortController();
  let shutdownHandled = false;
  const onShutdown = (sig: NodeJS.Signals): void => {
    if (shutdownHandled) return;
    shutdownHandled = true;
    process.stderr.write(`\nvessel-core: ${sig} — shutting down...\n`);
    abortCtl.abort();
    cleanupMcpConfig();
    // Hard-exit fallback if cancellation doesn't drain in time.
    // Budget = cli-runner KILL_GRACE_MS (5000) + 1s slack; ensures the child
    // process group has time to receive SIGKILL before we orphan it.
    // (M0.5 4-way review BLOCKER R-M0.5-1: 5s vs 5s race fix.)
    setTimeout(() => {
      try { closeMemoryDb(); } catch { /* ignore */ }
      process.exit(sig === 'SIGINT' ? 130 : 143);
    }, 6000).unref();
  };
  process.on('SIGINT', () => onShutdown('SIGINT'));
  process.on('SIGTERM', () => onShutdown('SIGTERM'));

  const result = await runIntent({
    text: args.text,
    sessionId: args.sessionId,
    skill: args.skill,
    abortSignal: abortCtl.signal,
  });

  switch (result.status) {
    case 'success': {
      const a = result.artifact as { text?: string };
      if (typeof a?.text === 'string') process.stdout.write(`${a.text}\n`);
      else process.stdout.write(`${JSON.stringify(result.artifact)}\n`);
      closeMemoryDb();
      return 0;
    }
    case 'failed': {
      process.stderr.write(`vessel-core error: ${result.error.type}: ${result.error.message}\n`);
      closeMemoryDb();
      return 1;
    }
    case 'paused': {
      process.stderr.write(`vessel-core paused: resumeToken=${result.resumeToken}\n`);
      closeMemoryDb();
      return 0;
    }
    case 'cancelled': {
      process.stderr.write(`vessel-core cancelled: ${result.reason}\n`);
      closeMemoryDb();
      return 130;
    }
  }
}

main().then(
  (code) => {
    cleanupMcpConfig();
    process.exit(code);
  },
  (err) => {
    process.stderr.write(`vessel-core fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    cleanupMcpConfig();
    closeMemoryDb();
    process.exit(1);
  },
);
