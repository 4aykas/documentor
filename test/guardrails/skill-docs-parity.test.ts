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
//   1. every --flag the skill names is checked against the parser that
//      command line in the skill's own text says owns it — not "accepted by
//      build OR inspect", which a flag both commands share can satisfy even
//      after one of them stops accepting it. See "1a." below for how that
//      OR-across-both bug was reproduced and why this file no longer has it.
//   2. every sidecar field the skill documents is exactly SIDECAR_KEYS (both
//      directions — a field the skill invents that the sidecar refuses, and
//      a field the sidecar accepts that the skill never mentions, both fail
//      this), and every `documents[].<field>` the skill tells the assistant
//      to read from `inspect --json` is a key that command's real output
//      for an `ok` document actually carries.
//
// A limitation this file does NOT cover, named rather than left to be
// inferred from its absence: it cannot notice a new `inspect --json` field
// that lands in the code and that the skill simply never mentions — the same
// "code moved, docs stayed silent" direction README's own docs-parity guard
// needed two attempts to close (see that file's own comment on why a
// cell-by-cell walk alone missed a wholly new capability). Closing it here
// would need the same second check docs-parity.test.ts uses for
// FORMATS/READABLE_EXTS: iterate the real `ok`-document's own keys and demand
// each one is either named in the skill or explicitly listed as "not worth
// mentioning" — deliberately not built in this pass, since the skill's four
// fields (title/subtitle/date/entity, counts, dropped, warnings) are already
// everything inspectCore's DocInspection puts on an `ok` result other than
// `file`, `status`, and `config`, which the skill has no reason to read
// itself (the shell already gets `file` and `status` from the JSON's own
// shape; `config` only echoes a filename the skill already wrote).

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SKILL_PATH = join(ROOT, 'plugin', 'skills', 'documentor', 'SKILL.md');
const SKILL = readFileSync(SKILL_PATH, 'utf8');

// ---------------------------------------------------------------------------
// 1. Flags, checked against the parser the skill's own text says owns them
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

// Captures the flags out of one of the skill's own "this is what accepts
// these flags" sentences/fences — the anchor text is the same kind of
// literal-string dependency extractFormatMatrix in docs-parity.test.ts
// already relies on, so a reword that breaks this breaks loudly (the anchor
// not found), not silently.
function flagsAfter(anchor: string): string[] {
  const idx = SKILL.indexOf(anchor);
  if (idx === -1) {
    throw new Error(`SKILL.md has no ${JSON.stringify(anchor)} — the section this test reads flags from moved or was reworded; update the anchor along with it`);
  }
  const end = SKILL.indexOf('\n\n', idx);
  const chunk = SKILL.slice(idx, end === -1 ? undefined : end);
  return extractFlags(chunk);
}

// Every flag the skill's "inspect" fence and its own "flags it accepts"
// sentence name — these must be accepted by inspect's own parser
// specifically, not "by inspect or build".
const inspectOwnedFlags = new Set([
  ...flagsAfter('documentor inspect <file> --json'),
  ...flagsAfter('Other flags it accepts, matching'),
]);

// Same for build's fence and its own "Other flags:" sentence.
const buildOwnedFlags = new Set([
  ...flagsAfter('documentor build <file> --to pdf,docx'),
  ...flagsAfter('Other flags: `--theme'),
]);

describe('SKILL.md flags are checked against the parser that should own them', () => {
  it('every flag the skill shows on a `documentor inspect …` line is accepted by inspect', () => {
    const rejected = [...inspectOwnedFlags].filter((f) => !isKnownOption(parseInspectArgs, f));
    expect(
      rejected,
      `SKILL.md names ${rejected.join(', ')} as flag(s) \`inspect\` accepts, but inspect's own `
      + `parseInspectArgs rejects ${rejected.length === 1 ? 'it' : 'them'} — the flag was renamed or `
      + 'removed from inspect and the skill was not updated',
    ).toEqual([]);
  });

  it('every flag the skill shows on a `documentor build …` line is accepted by build', () => {
    const rejected = [...buildOwnedFlags].filter((f) => !isKnownOption(parseArgs, f));
    expect(
      rejected,
      `SKILL.md names ${rejected.join(', ')} as flag(s) \`build\` accepts, but build's own `
      + `parseArgs rejects ${rejected.length === 1 ? 'it' : 'them'} — the flag was renamed or removed `
      + 'from build and the skill was not updated. This is the check that catches a flag renamed in '
      + 'build.ts alone: a shared flag like --theme staying in inspect.ts is not enough to save it.',
    ).toEqual([]);
  });

  // Belt-and-braces for anything the two extractions above did not claim —
  // a flag token that shows up somewhere in SKILL.md outside either
  // "flags it accepts" sentence or fence. None exist as of this writing
  // (every flag the skill names lives in one of the four anchors above), so
  // this set should be empty; if a future edit introduces a stray mention,
  // this checks it the stricter way — against both parsers — rather than
  // silently reintroducing the OR-across-both gap this file exists to close.
  it('any flag not claimed by an inspect/build anchor is still checked, against both parsers', () => {
    const claimed = new Set([...inspectOwnedFlags, ...buildOwnedFlags]);
    const unclaimed = extractFlags(SKILL).filter((f) => !claimed.has(f));
    const unknown = unclaimed.filter(
      (f) => !isKnownOption(parseArgs, f) || !isKnownOption(parseInspectArgs, f),
    );
    expect(
      unknown,
      `SKILL.md mentions ${unknown.join(', ')} outside any recognised "flags it accepts" anchor, and at `
      + 'least one of build/inspect rejects it — either extend the anchors above so this flag has a '
      + 'known owner, or fix the flag/parser mismatch',
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
