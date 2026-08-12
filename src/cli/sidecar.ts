// The sidecar file itself — finding it and reading it. See
// docs/superpowers/specs/2026-08-12-sidecar-design.md. This module owns only
// "what does this file say", never "what should win" — precedence (flag >
// sidecar > document) and the defaults for theme/to/plainNames live in
// config.ts, the one place `build` and `inspect` both resolve options, so
// this module never has to know which command is asking or what a missing
// field should fall back to.

import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

/** Every field the sidecar file can hold. All optional — a sidecar holding
 *  only `{"theme": "tebin"}` is valid and useful, per the design. */
export type SidecarData = {
  title?: string;
  subtitle?: string;
  date?: string;
  entity?: string;
  theme?: string;
  to?: string[];
  plainNames?: boolean;
};

const SIDECAR_KEYS = new Set<string>(['title', 'subtitle', 'date', 'entity', 'theme', 'to', 'plainNames']);

/** `<stem>.documentor.json`, beside the input — the design's own naming
 *  rule, spelled out once so automatic discovery here and any future writer
 *  (the phase-4 skill this slice does not build — see the design's "Out of
 *  scope") agree on the same name. */
export function sidecarPathFor(input: string): string {
  const ext = extname(input);
  return join(dirname(input), `${basename(input, ext)}.documentor.json`);
}

function typeErr(path: string, key: string, expected: string, got: unknown): never {
  throw new Error(`sidecar ${path}: "${key}" must be ${expected}, got ${JSON.stringify(got)}`);
}

/**
 * Reads and shape-validates a sidecar file. Refuses two things, each named
 * precisely, per the design's "Refusing a bad sidecar":
 *   - JSON that does not parse — names the file, since the fix is to open it
 *     and correct the syntax.
 *   - a key this format does not define — names the key, since a typo like
 *     "tittle" silently doing nothing would be the worst possible behaviour
 *     for a file whose entire purpose is that a decision is not lost.
 *
 * What this function does *not* validate: whether "theme" names a theme
 * that actually exists, or whether "to" names a format this build can
 * write. Those are validated the one place the CLI already validates
 * them — loadTheme and the FORMATS check in build.ts, both fed the merged
 * value in config.ts — so a value the sidecar accepts and the CLI rejects
 * cannot exist, and validating them a second time here would be exactly
 * that second place the design rules out.
 */
export async function readSidecar(path: string): Promise<SidecarData> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    throw new Error(`sidecar ${path} could not be read: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`sidecar ${path} is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`sidecar ${path}: expected a JSON object, got ${Array.isArray(parsed) ? 'an array' : typeof parsed}`);
  }
  const obj = parsed as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!SIDECAR_KEYS.has(key)) throw new Error(`sidecar ${path}: unknown key ${JSON.stringify(key)}`);
  }

  const data: SidecarData = {};
  if (obj['title'] !== undefined) {
    if (typeof obj['title'] !== 'string') typeErr(path, 'title', 'a string', obj['title']);
    data.title = obj['title'];
  }
  if (obj['subtitle'] !== undefined) {
    if (typeof obj['subtitle'] !== 'string') typeErr(path, 'subtitle', 'a string', obj['subtitle']);
    data.subtitle = obj['subtitle'];
  }
  if (obj['date'] !== undefined) {
    if (typeof obj['date'] !== 'string') typeErr(path, 'date', 'a string', obj['date']);
    data.date = obj['date'];
  }
  if (obj['entity'] !== undefined) {
    if (typeof obj['entity'] !== 'string') typeErr(path, 'entity', 'a string', obj['entity']);
    data.entity = obj['entity'];
  }
  if (obj['theme'] !== undefined) {
    if (typeof obj['theme'] !== 'string') typeErr(path, 'theme', 'a string', obj['theme']);
    data.theme = obj['theme'];
  }
  if (obj['to'] !== undefined) {
    const to = obj['to'];
    if (!Array.isArray(to) || !to.every((v) => typeof v === 'string')) typeErr(path, 'to', 'an array of strings', to);
    data.to = to as string[];
  }
  if (obj['plainNames'] !== undefined) {
    if (typeof obj['plainNames'] !== 'boolean') typeErr(path, 'plainNames', 'a boolean', obj['plainNames']);
    data.plainNames = obj['plainNames'];
  }
  return data;
}
