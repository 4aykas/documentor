import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../../src/cli/build.js';
import { parseInspectArgs } from '../../src/cli/inspect.js';
import { SIDECAR_KEYS } from '../../src/cli/sidecar.js';

// Guardrail for the Claude Code skill, in the spirit of
// test/guardrails/docs-parity.test.ts (see that file's own module comment on
// why this project pins prose against code rather than trusting an author to
// keep them in step by hand). The skill's design brief is explicit that it
// "must never re-implement ingesting, rendering, naming or validation" — so
// everything it tells the assistant to run or to read must be something the
// CLI actually accepts or actually emits, checked here against the CLI's own
// source of truth, never against a second hand-copied list.
//
// Two things pinned:
//   1. every --flag the skill names is a flag build's or inspect's own
//      parser accepts (same technique docs-parity.test.ts already uses for
//      README.md and --help);
//   2. every sidecar field the skill documents is exactly SIDECAR_KEYS (both
//      directions — a field the skill invents that the sidecar refuses, and
//      a field the sidecar accepts that the skill never mentions, both fail
//      this), and every `documents[].<field>` the skill tells the assistant
//      to read from `inspect --json` is a key that command's real output
//      for an `ok` document actually carries.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SKILL_PATH = join(ROOT, 'plugin', 'skills', 'documentor', 'SKILL.md');
const SKILL = readFileSync(SKILL_PATH, 'utf8');

// ---------------------------------------------------------------------------
// 1. Flags
// ---------------------------------------------------------------------------

function extractFlags(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/--[a-z][a-z-]*/g)) found.add(m[0]);
  return [...found].sort();
}

function isKnownOption(parse: (argv: string[]) => unknown, flag: string): boolean {
  try {
    parse(['dummy-input.md', flag]);
    return true;
  } catch (e) {
    return (e as Error).message !== `unknown option ${flag}`;
  }
}

describe('SKILL.md flags are flags the CLI parsers actually accept', () => {
  it('every flag mentioned in plugin/skills/documentor/SKILL.md is accepted by build or inspect', () => {
    const flags = extractFlags(SKILL);
    expect(flags.length, 'expected the skill to name at least one --flag').toBeGreaterThan(0);
    const unknown = flags.filter(
      (f) => !isKnownOption(parseArgs, f) && !isKnownOption(parseInspectArgs, f),
    );
    expect(
      unknown,
      `SKILL.md mentions ${unknown.join(', ')}, but neither build's parseArgs nor inspect's `
      + `parseInspectArgs accepts ${unknown.length === 1 ? 'it' : 'them'} — update the skill or the parser`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Sidecar fields the skill documents vs. SIDECAR_KEYS
// ---------------------------------------------------------------------------

describe('SKILL.md documents exactly the sidecar fields the format accepts', () => {
  it('the "Fields this file accepts" sentence names exactly SIDECAR_KEYS', () => {
    // Markdown wraps this sentence across source lines, so the capture must
    // run until the paragraph actually ends (a blank line), not just to the
    // next '\n' — a single-line match previously passed by accident because
    // it silently stopped short of the wrapped tail and never saw the
    // fields it was missing.
    const m = SKILL.match(/Fields this file accepts:([\s\S]+?)\n\n/);
    expect(m, 'SKILL.md has no "Fields this file accepts:" sentence — did the section get reworded? Update this test\'s anchor text along with it').not.toBeNull();
    const sentence = m![1]!;
    const named = new Set([...sentence.matchAll(/`([a-zA-Z]+)`/g)].map((mm) => mm[1]!));
    const missingFromSkill = [...SIDECAR_KEYS].filter((k) => !named.has(k));
    const extraInSkill = [...named].filter((k) => !SIDECAR_KEYS.has(k));
    expect(
      { missingFromSkill, extraInSkill },
      `SIDECAR_KEYS is ${[...SIDECAR_KEYS].join(', ')}; SKILL.md's "Fields this file accepts" sentence names `
      + `${[...named].join(', ')} — these must match exactly, since a field this text invents cannot exist in `
      + `the sidecar, and a field it omits leaves the assistant unable to write a decision the format supports`,
    ).toEqual({ missingFromSkill: [], extraInSkill: [] });
  });
});

// ---------------------------------------------------------------------------
// 3. `documents[].<field>` tokens vs. what `inspect --json` actually emits
// ---------------------------------------------------------------------------

describe('SKILL.md tells the assistant to read fields inspect --json actually emits', () => {
  it('every documents[].<field> named in SKILL.md is a real key of an ok inspection', () => {
    const named = new Set([...SKILL.matchAll(/documents\[\]\.(\w+)/g)].map((m) => m[1]!));
    expect(named.size, 'expected the skill to name at least one documents[].<field>').toBeGreaterThan(0);

    const bin = join(ROOT, 'src', 'bin', 'documentor.ts');
    const fixture = join(ROOT, 'test', 'fixtures', 'kitchen-sink.md');
    const quotedBin = process.platform === 'win32' ? `"${bin}"` : bin;
    const quotedFixture = process.platform === 'win32' ? `"${fixture}"` : fixture;
    const r = spawnSync(
      'npx',
      ['tsx', quotedBin, 'inspect', quotedFixture, '--json'],
      { encoding: 'utf8', shell: process.platform === 'win32' },
    );
    expect(r.status, `inspect --json exited ${r.status}, stderr: ${r.stderr}`).toBe(0);
    const parsed = JSON.parse(r.stdout) as { documents: { status: string; [k: string]: unknown }[] };
    const ok = parsed.documents.find((d) => d.status === 'ok');
    expect(ok, 'expected an "ok" document in the fixture inspection').toBeDefined();
    const realKeys = new Set(Object.keys(ok!));

    const missing = [...named].filter((f) => !realKeys.has(f));
    expect(
      missing,
      `SKILL.md names documents[].${missing.join(', documents[].')}, but a real inspect --json "ok" document `
      + `has keys ${[...realKeys].join(', ')} — the field was renamed or removed and the skill was not updated`,
    ).toEqual([]);
  });
});
