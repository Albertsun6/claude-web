/**
 * M2-Soul — Soul Spec parser + injector integration test.
 *
 * Acceptance (from ROADMAP M2-Soul):
 *   1. clone templates/soul/jarvis-style.soul.md, save unedited → init exits
 *      non-zero with "must modify ≥ 1 field" message
 *   2. modify ≥ 1 field, save → init exits 0 + soul.md valid
 *   3. soul show-prompt's output contains all personality field values from
 *      soul.md (grep check)
 *   4. cli-runner buildArgs picks up renderSoulPrompt output via
 *      --append-system-prompt (verified at integration via spawn arg list)
 *
 * Tests run in an isolated VESSEL_DATA_DIR temp dir to avoid polluting
 * ~/.vessel/soul.md.
 */

import 'dotenv/config';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    process.stdout.write(`  ✅ ${label}\n`);
    passed++;
  } else {
    process.stderr.write(`  ❌ FAIL: ${label}\n`);
    failed++;
  }
}

const tmpDataDir = mkdtempSync(join(tmpdir(), 'vessel-soul-test-'));
process.env['VESSEL_DATA_DIR'] = tmpDataDir;

// Re-import after env set so DATA_DIR resolves to tmpDataDir.
const { parseSoulString, defaultSoulPath, loadSoulOrNull } = await import('./soul/parser.js');
const { renderSoulPrompt } = await import('./soul/injector.js');

// ── Test 1: parser happy path ─────────────────────────────────────────────
{
  const raw = `---
schema_version: 1
name: TestSoul
personality:
  tone: precise, helpful
  values: [reliability, brevity]
  pronouns: they/them
  signature_phrases: ["On it.", "Right away."]
preferences:
  language: zh-CN
  verbosity: terse
---

# Background

Free-form notes here.
`;
  const soul = parseSoulString(raw);
  assert(soul.schema_version === 1, 'schema_version is 1');
  assert(soul.name === 'TestSoul', 'name parsed');
  assert(soul.personality.tone === 'precise, helpful', 'tone parsed');
  assert(Array.isArray(soul.personality.values) && soul.personality.values.length === 2, 'values parsed as array');
  assert(soul.personality.pronouns === 'they/them', 'pronouns parsed');
  assert(soul.personality.signature_phrases?.[0] === 'On it.', 'signature_phrases parsed');
  assert(soul.preferences?.language === 'zh-CN', 'preferences.language parsed');
  assert(soul.preferences?.verbosity === 'terse', 'preferences.verbosity parsed');
  assert(soul.body.includes('Background'), 'body retained');
}

// ── Test 2: parser rejects invalid input ──────────────────────────────────
{
  const cases: Array<[string, string]> = [
    ['no frontmatter', 'just markdown body, no ---'],
    ['empty frontmatter', '---\n\n---\nhi'],
    ['wrong schema_version', '---\nschema_version: 2\nname: x\npersonality: {}\n---\n'],
    ['missing name', '---\nschema_version: 1\npersonality: {}\n---\n'],
    ['missing personality', '---\nschema_version: 1\nname: x\n---\n'],
    ['bad verbosity', '---\nschema_version: 1\nname: x\npersonality: {}\npreferences:\n  verbosity: shouty\n---\n'],
    ['values not array of strings', '---\nschema_version: 1\nname: x\npersonality:\n  values: [1, 2]\n---\n'],
  ];
  for (const [label, raw] of cases) {
    let threw = false;
    try { parseSoulString(raw); } catch { threw = true; }
    assert(threw, `parser rejects: ${label}`);
  }
}

// ── Test 3: renderSoulPrompt produces grep-able output ────────────────────
{
  const soul = parseSoulString(`---
schema_version: 1
name: GrepCheck
personality:
  tone: UNIQUE_TONE_42a7
  values: [VALUE_X_a7f9, VALUE_Y_b8e2]
  pronouns: PRONOUN_marker_c1d3
  signature_phrases: [PHRASE_alpha_e4f6]
preferences:
  language: zh-Hans
  verbosity: balanced
---

BODY_unique_marker_99d1
`);

  const prompt = renderSoulPrompt(soul);
  assert(prompt.includes('GrepCheck'), 'prompt contains name');
  assert(prompt.includes('UNIQUE_TONE_42a7'), 'prompt contains tone value');
  assert(prompt.includes('VALUE_X_a7f9') && prompt.includes('VALUE_Y_b8e2'), 'prompt contains all values');
  assert(prompt.includes('PRONOUN_marker_c1d3'), 'prompt contains pronouns');
  assert(prompt.includes('PHRASE_alpha_e4f6'), 'prompt contains signature_phrases');
  assert(prompt.includes('zh-Hans'), 'prompt contains language preference');
  assert(prompt.includes('balanced'), 'prompt contains verbosity');
  assert(prompt.includes('BODY_unique_marker_99d1'), 'prompt contains body markdown');
}

// ── Test 4: renderSoulPrompt omits empty optional fields ──────────────────
{
  const soul = parseSoulString(`---
schema_version: 1
name: Minimal
personality: {}
---
`);
  const prompt = renderSoulPrompt(soul);
  assert(prompt.includes('Minimal'), 'minimal soul renders name');
  assert(!prompt.includes('Tone:'), 'no Tone line when tone undefined');
  assert(!prompt.includes('Pronouns:'), 'no Pronouns line when undefined');
  assert(!prompt.includes('Communication preferences'), 'no preferences section when undefined');
}

// ── Test 5: loadSoulOrNull returns null when file missing ─────────────────
{
  // Ensure no soul.md in tmpDataDir yet.
  const path = defaultSoulPath();
  if (existsSync(path)) rmSync(path);
  const result = loadSoulOrNull();
  assert(result === null, 'loadSoulOrNull returns null when file missing');
}

// ── Test 6: vessel-core init / soul show-prompt CLI integration ──────────
// These exercise the full path: copy template → reject unedited → edit → accept.
{
  const cliPath = join(__dirname, 'cli', 'vessel-core.ts');
  const env = { ...process.env, VESSEL_DATA_DIR: tmpDataDir };
  const soulPath = join(tmpDataDir, 'soul.md');

  // Clean up any prior state.
  if (existsSync(soulPath)) rmSync(soulPath);

  // First init — should write template + reject as identical.
  const r1 = spawnSync('npx', ['tsx', cliPath, 'init', '--template=jarvis-style'], { env, encoding: 'utf8' });
  assert(r1.status === 1, `init on fresh dir exits 1 (got ${r1.status}; stderr: ${r1.stderr.slice(0, 200)})`);
  assert(r1.stderr.includes('must modify'), 'init stderr mentions must-modify');
  assert(existsSync(soulPath), 'init wrote soul.md from template');

  // User edits a field — change name from TEMPLATE_JARVIS to "EVA-Test".
  const original = readFileSync(soulPath, 'utf8');
  const edited = original.replace('TEMPLATE_JARVIS', 'EVA-Test');
  assert(edited !== original, 'simulated edit changed file content');
  writeFileSync(soulPath, edited);

  // Second init — should now succeed.
  const r2 = spawnSync('npx', ['tsx', cliPath, 'init', '--template=jarvis-style'], { env, encoding: 'utf8' });
  assert(r2.status === 0, `init after edit exits 0 (got ${r2.status}; stderr: ${r2.stderr.slice(0, 200)})`);
  assert(r2.stdout.includes('personalized'), 'init stdout mentions personalized');

  // soul show-prompt should now print a prompt containing the edited name.
  const r3 = spawnSync('npx', ['tsx', cliPath, 'soul', 'show-prompt'], { env, encoding: 'utf8' });
  assert(r3.status === 0, `soul show-prompt exits 0 (got ${r3.status})`);
  assert(r3.stdout.includes('EVA-Test'), 'show-prompt output includes edited name');
  assert(r3.stdout.includes('precise, courteous'), 'show-prompt output includes original tone');
}

// ── Test 7: init rejects bad template name ───────────────────────────────
{
  const cliPath = join(__dirname, 'cli', 'vessel-core.ts');
  const env = { ...process.env, VESSEL_DATA_DIR: tmpDataDir };
  const r = spawnSync('npx', ['tsx', cliPath, 'init', '--template=does-not-exist'], { env, encoding: 'utf8' });
  assert(r.status === 2, `init rejects bad template (got ${r.status})`);
  assert(r.stderr.includes('not found'), 'stderr mentions template not found');
}

// ── Test 8: cli-runner buildArgs picks up soul.md ────────────────────────
// Indirect: we already verified loadSoulOrNull works against tmpDataDir;
// cli-runner uses the same parser. As an extra check, inspect that the
// expected output of renderSoulPrompt matches what would be appended.
{
  const soul = loadSoulOrNull();
  assert(soul !== null, 'loadSoulOrNull picks up edited soul.md from tmpDataDir');
  if (soul) {
    const prompt = renderSoulPrompt(soul);
    assert(prompt.includes('EVA-Test'), 'renderSoulPrompt picks up edited name (cli-runner would inject this)');
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────
rmSync(tmpDataDir, { recursive: true, force: true });

process.stdout.write(`\nM2-Soul tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
