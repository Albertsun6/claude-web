#!/usr/bin/env -S npx tsx
/**
 * One-shot import: ~/.claude/skills/debate-review/log.jsonl + docs/reviews/*verdict*.md → memory.db lessons.
 *
 * Idempotent via sha256(date+planFile+contract+biggestInsight).slice(0,16) UNIQUE INDEX.
 * Re-running this script multiple times is safe — duplicate fingerprints silently skip.
 *
 * Run: pnpm --filter @vessel/backend exec tsx ../../scripts/import-debate-log.ts
 *      [--dry-run]      list what would be imported without writing
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { addLesson, computeImportFingerprint, findByFingerprint } from '../packages/backend/src/memory/lesson-store.js';
import { redactFreeformText } from '../packages/backend/src/observability/redact-helpers.js';

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const LOG_PATH = join(homedir(), '.claude', 'skills', 'debate-review', 'log.jsonl');
const REVIEWS_DIR = join(REPO_ROOT, 'docs', 'reviews');

interface JsonlEntry {
  date: string;
  planFile?: string;
  contract?: string;
  biggestInsight?: string;
  biggestMistake?: string;
  totalClaims?: number;
  accepted?: number;
  partial?: number;
  rejected?: number;
  hung?: number;
  newPrinciplesAdded?: number;
  newRisksAdded?: number;
  reviewerSkippedQuestions?: unknown[];
  counterChallenges?: string[];
  mechVersion?: string;
}

interface VerdictFile {
  path: string;
  filename: string;
  milestone: string | null;
  kind: 'verdict' | 'arbiter' | 'verify-gate' | 'cross' | 'architect' | 'pragmatist' | 'risk-officer';
}

function readJsonlEntries(): JsonlEntry[] {
  if (!existsSync(LOG_PATH)) {
    console.warn(`# log.jsonl not found at ${LOG_PATH}; skipping`);
    return [];
  }
  const text = readFileSync(LOG_PATH, 'utf-8');
  const out: JsonlEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as JsonlEntry);
    } catch {
      console.warn(`# skipping unparseable jsonl line: ${trimmed.slice(0, 80)}`);
    }
  }
  return out;
}

function listVerdictFiles(): VerdictFile[] {
  if (!existsSync(REVIEWS_DIR)) return [];
  const out: VerdictFile[] = [];
  for (const f of readdirSync(REVIEWS_DIR)) {
    if (!f.endsWith('.md')) continue;
    if (f === 'README.md' || f === 'INDEX.md') continue;
    const lower = f.toLowerCase();
    let kind: VerdictFile['kind'] = 'verdict';
    if (lower.includes('arbiter')) kind = 'arbiter';
    else if (lower.includes('verify-gate')) kind = 'verify-gate';
    else if (lower.includes('cross')) kind = 'cross';
    else if (lower.includes('architect')) kind = 'architect';
    else if (lower.includes('pragmatist')) kind = 'pragmatist';
    else if (lower.includes('risk-officer')) kind = 'risk-officer';

    // L1 closeout review pragmatist MAJOR F1: skip per-reviewer p1 verdicts in
    // favor of consolidated arbiter + verify-gate. Multi-reviewer verdicts pollute
    // FTS search with parallel takes; arbiter is the convergent decision.
    // Keep: arbiter / verify-gate / cross (independent异质 lens)
    // Skip:  individual architect / pragmatist / risk-officer p1 verdicts
    if (kind === 'architect' || kind === 'pragmatist' || kind === 'risk-officer') {
      continue;
    }

    // Extract milestone from filename prefix (M0 / M0.5 / M1A-α / 0B / 0-pre / 0A / etc.)
    const milestoneMatch = f.match(/^(M\d+(?:\.\d+)?(?:-?[αβγ])?|0[A-Za-z](?:\.\d+)?|0-pre|0-meta-lite|L1)/);
    out.push({
      path: join(REVIEWS_DIR, f),
      filename: f,
      milestone: milestoneMatch ? milestoneMatch[1] : null,
      kind,
    });
  }
  return out;
}

function importJsonlEntry(e: JsonlEntry): { skipped: boolean; id?: string } {
  const fp = computeImportFingerprint({
    date: e.date,
    planFile: e.planFile,
    contract: e.contract,
    biggestInsight: e.biggestInsight,
  });
  // Dedup check
  // L1 closeout review MAJOR fix: exact UNIQUE-INDEX lookup, not LIKE substring.
  if (findByFingerprint(fp)) return { skipped: true };

  const title = e.biggestInsight ?? `(closeout ${e.date} ${e.contract ?? ''})`;
  const bodyParts = [
    e.biggestInsight ? `Insight: ${e.biggestInsight}` : '',
    e.biggestMistake ? `Mistake: ${e.biggestMistake}` : '',
    e.contract ? `Contract: ${e.contract}` : '',
    e.totalClaims != null ? `Stats: total=${e.totalClaims} accepted=${e.accepted ?? '?'} partial=${e.partial ?? 0} rejected=${e.rejected ?? 0} hung=${e.hung ?? 0}` : '',
    e.counterChallenges && e.counterChallenges.length > 0 ? `Counter-challenges:\n${e.counterChallenges.map((c) => `- ${c}`).join('\n')}` : '',
    e.mechVersion ? `MechVersion: ${e.mechVersion}` : '',
  ].filter(Boolean);

  // Milestone heuristic from planFile glob.
  let milestone: string | undefined;
  if (e.planFile) {
    const m = e.planFile.match(/(M\d+(?:\.\d+)?(?:-?[αβγ])?|0[A-Za-z]|0-pre|0-meta-lite|L1)/);
    if (m) milestone = m[1];
  }

  if (DRY_RUN) {
    return { skipped: false, id: `(dry-run) date=${e.date} fp=${fp} title="${title.slice(0, 50)}…"` };
  }

  const row = addLesson({
    kind: 'review_closeout',
    title,
    body: bodyParts.join('\n\n'),
    milestone,
    tags: [fp, 'imported-from-jsonl'],
    importFingerprint: fp,
    importance: 4,
  });
  return { skipped: false, id: row.id };
}

function importVerdictFile(v: VerdictFile): { skipped: boolean; id?: string } {
  const content = readFileSync(v.path, 'utf-8');
  // L1 closeout cursor catch: redact-then-slice (NOT slice-then-redact).
  // Truncating before redact can chop a 25-char `sk-ant-*` to 12 chars and the
  // `[A-Za-z0-9_-]{20,}` floor lets it through.
  const fullText = content
    .split('\n\n')
    .find((p) => p.trim() && !p.startsWith('#') && !p.startsWith('---')) ?? '(no body extracted)';
  const redactedFull = redactFreeformText(fullText);
  const firstParagraph = redactedFull.slice(0, 800);

  const fp = computeImportFingerprint({
    date: v.filename,                 // filename incl date
    planFile: v.filename,
    contract: v.kind,
    biggestInsight: firstParagraph.slice(0, 200),
  });
  // L1 closeout review MAJOR fix: exact UNIQUE-INDEX lookup, not LIKE substring.
  if (findByFingerprint(fp)) return { skipped: true };

  if (DRY_RUN) {
    return { skipped: false, id: `(dry-run) ${v.filename} fp=${fp} milestone=${v.milestone ?? '-'}` };
  }

  const row = addLesson({
    kind: 'review_closeout',
    title: `${v.kind} verdict: ${v.filename}`,
    body: `Source: ${v.filename}\n\n${firstParagraph}`,
    milestone: v.milestone ?? undefined,
    tags: [fp, 'imported-from-verdict-md', v.kind],
    refs: [`docs/reviews/${v.filename}`],
    importFingerprint: fp,
    importance: 3,
  });
  return { skipped: false, id: row.id };
}

function main(): void {
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY-RUN' : '⚡ APPLY'}`);
  console.log();

  const jsonl = readJsonlEntries();
  console.log(`# log.jsonl: ${jsonl.length} entries`);
  let importedJsonl = 0, skippedJsonl = 0;
  for (const e of jsonl) {
    const r = importJsonlEntry(e);
    if (r.skipped) { skippedJsonl++; }
    else { importedJsonl++; if (DRY_RUN) console.log(`  ${r.id}`); }
  }
  console.log(`  imported: ${importedJsonl}, skipped (dedup): ${skippedJsonl}`);
  console.log();

  const verdicts = listVerdictFiles();
  console.log(`# docs/reviews: ${verdicts.length} verdict files`);
  let importedV = 0, skippedV = 0;
  for (const v of verdicts) {
    const r = importVerdictFile(v);
    if (r.skipped) { skippedV++; }
    else { importedV++; if (DRY_RUN) console.log(`  ${r.id}`); }
  }
  console.log(`  imported: ${importedV}, skipped (dedup): ${skippedV}`);
  console.log();
  console.log(`Total: ${importedJsonl + importedV} new lessons; ${skippedJsonl + skippedV} skipped (dedup)`);
}

main();
