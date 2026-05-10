/**
 * Soul Spec parser — reads soul.md (YAML frontmatter + Markdown body) into a
 * structured SoulSpec.
 *
 * Schema (v1):
 *   ---
 *   schema_version: 1
 *   name: <Instance name, e.g. "EVA">
 *   personality:
 *     tone: <free text, e.g. "playful, witty">
 *     values: [<string>, ...]
 *     pronouns: <free text>
 *     signature_phrases: [<string>, ...]
 *   preferences:
 *     language: <BCP-47 tag, e.g. "zh-CN">
 *     verbosity: terse | balanced | verbose
 *   ---
 *
 *   <free-form markdown body>
 *
 * @see ADR-004 (Soul prompt injection target = cli-runner prompt wrapper)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DATA_DIR } from '../data-dir.js';

export interface SoulPersonality {
  tone?: string;
  values?: string[];
  pronouns?: string;
  signature_phrases?: string[];
}

export interface SoulPreferences {
  language?: string;
  verbosity?: 'terse' | 'balanced' | 'verbose';
}

export interface SoulSpec {
  schema_version: number;
  name: string;
  personality: SoulPersonality;
  preferences?: SoulPreferences;
  /** Markdown body after frontmatter — free-form persona / background notes. */
  body: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/;

export class SoulParseError extends Error {
  constructor(message: string) {
    super(`soul parse: ${message}`);
    this.name = 'SoulParseError';
  }
}

/** Parse raw soul.md text into SoulSpec. Throws SoulParseError on invalid input. */
export function parseSoulString(raw: string): SoulSpec {
  const trimmed = raw.replace(/^﻿/, ''); // strip BOM
  const match = FRONTMATTER_RE.exec(trimmed);
  if (!match) {
    throw new SoulParseError('missing YAML frontmatter (file must start with `---` and contain a closing `---`)');
  }

  const [, yamlSrc, body] = match;

  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(yamlSrc!);
  } catch (err) {
    throw new SoulParseError(`invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!frontmatter || typeof frontmatter !== 'object') {
    throw new SoulParseError('frontmatter must be a YAML mapping');
  }

  const fm = frontmatter as Record<string, unknown>;

  const schemaVersion = fm['schema_version'];
  if (typeof schemaVersion !== 'number' || schemaVersion !== 1) {
    throw new SoulParseError(`schema_version must be 1 (got ${JSON.stringify(schemaVersion)})`);
  }

  const name = fm['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    throw new SoulParseError('name is required (non-empty string)');
  }

  const personalityRaw = fm['personality'];
  if (!personalityRaw || typeof personalityRaw !== 'object') {
    throw new SoulParseError('personality is required (mapping)');
  }
  const p = personalityRaw as Record<string, unknown>;

  const personality: SoulPersonality = {};
  if (p['tone'] !== undefined) {
    if (typeof p['tone'] !== 'string') throw new SoulParseError('personality.tone must be a string');
    personality.tone = p['tone'];
  }
  if (p['values'] !== undefined) {
    if (!Array.isArray(p['values']) || !p['values'].every(v => typeof v === 'string')) {
      throw new SoulParseError('personality.values must be an array of strings');
    }
    personality.values = p['values'] as string[];
  }
  if (p['pronouns'] !== undefined) {
    if (typeof p['pronouns'] !== 'string') throw new SoulParseError('personality.pronouns must be a string');
    personality.pronouns = p['pronouns'];
  }
  if (p['signature_phrases'] !== undefined) {
    if (!Array.isArray(p['signature_phrases']) || !p['signature_phrases'].every(v => typeof v === 'string')) {
      throw new SoulParseError('personality.signature_phrases must be an array of strings');
    }
    personality.signature_phrases = p['signature_phrases'] as string[];
  }

  let preferences: SoulPreferences | undefined;
  if (fm['preferences'] !== undefined) {
    if (!fm['preferences'] || typeof fm['preferences'] !== 'object') {
      throw new SoulParseError('preferences must be a mapping if present');
    }
    const pref = fm['preferences'] as Record<string, unknown>;
    preferences = {};
    if (pref['language'] !== undefined) {
      if (typeof pref['language'] !== 'string') throw new SoulParseError('preferences.language must be a string');
      preferences.language = pref['language'];
    }
    if (pref['verbosity'] !== undefined) {
      const v = pref['verbosity'];
      if (v !== 'terse' && v !== 'balanced' && v !== 'verbose') {
        throw new SoulParseError(`preferences.verbosity must be one of terse|balanced|verbose (got ${JSON.stringify(v)})`);
      }
      preferences.verbosity = v;
    }
  }

  return {
    schema_version: 1,
    name,
    personality,
    ...(preferences ? { preferences } : {}),
    body: (body ?? '').trim(),
  };
}

/** Parse soul.md at an absolute path. Throws if file missing or unparseable. */
export function parseSoulFile(absPath: string): SoulSpec {
  if (!existsSync(absPath)) {
    throw new SoulParseError(`file not found: ${absPath}`);
  }
  return parseSoulString(readFileSync(absPath, 'utf8'));
}

/** Default location: $VESSEL_DATA_DIR/soul.md (~/.vessel/soul.md by default). */
export function defaultSoulPath(): string {
  return join(DATA_DIR, 'soul.md');
}

/**
 * Load soul.md from the default location. Returns null if file does not exist.
 * Throws if file exists but is unparseable (fail loud — silent skip would let
 * a typo in soul.md silently make Claude CLI behave without persona).
 */
export function loadSoulOrNull(): SoulSpec | null {
  const path = defaultSoulPath();
  if (!existsSync(path)) return null;
  return parseSoulFile(path);
}
