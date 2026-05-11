/**
 * Soul Spec injector — render SoulSpec into a system prompt string for
 * Claude CLI's `--append-system-prompt`.
 *
 * Per ADR-004: injection target = cli-runner prompt wrapper. The rendered
 * string is appended to Claude Code's default system prompt (so tool-use
 * capabilities stay intact); Soul only adds persona + preferences + body.
 *
 * Field rendering rules:
 *   - All non-empty personality fields appear verbatim so `grep <field-value>`
 *     against the rendered prompt finds them. (M2-Soul acceptance #3.)
 *   - Empty / undefined fields are omitted (no "tone: undefined" noise).
 *   - Body markdown appended after a separator if non-empty.
 */

import type { SoulSpec } from './parser.js';

export function renderSoulPrompt(soul: SoulSpec): string {
  const lines: string[] = [];
  lines.push(`# Persona: ${soul.name}`);
  lines.push('');
  lines.push(`You are ${soul.name}. Your behavior reflects this persona:`);
  lines.push('');

  const p = soul.personality;
  if (p.tone) lines.push(`- Tone: ${p.tone}`);
  if (p.values && p.values.length > 0) lines.push(`- Core values: ${p.values.join(', ')}`);
  if (p.pronouns) lines.push(`- Pronouns: ${p.pronouns}`);
  if (p.signature_phrases && p.signature_phrases.length > 0) {
    lines.push(`- Signature phrases: ${p.signature_phrases.map(s => `"${s}"`).join(', ')}`);
  }

  if (soul.preferences) {
    const pref = soul.preferences;
    if (pref.language || pref.verbosity) {
      lines.push('');
      lines.push('# Communication preferences');
      lines.push('');
      if (pref.language) lines.push(`- Preferred language: ${pref.language}`);
      if (pref.verbosity) lines.push(`- Verbosity: ${pref.verbosity}`);
    }
  }

  if (soul.body && soul.body.trim() !== '') {
    lines.push('');
    lines.push('# Background & style notes');
    lines.push('');
    lines.push(soul.body.trim());
  }

  lines.push('');
  lines.push('Stay in character while completing tasks. Tool capabilities remain unchanged.');

  return lines.join('\n');
}
