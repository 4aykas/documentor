import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATS, READABLE_EXTS, parseArgs } from '../../src/cli/build.js';
import { parseInspectArgs } from '../../src/cli/inspect.js';

// Guardrail for a defect this project has shipped three times in one week:
// documentation that outlived the code it described (README claiming .docx
// still unread three merges after it landed; --help naming only pdf/md after
// docx was wired in; --help silent on --plain-names' effect on the output
// name). Each time a human caught it, not a test. This file is that test.
//
// The house rule (see no-wall-clock.test.ts and dist-smoke.test.ts) is: read
// once, assert against the code's own source of truth, never restate it.
// Everywhere below either imports the constant it checks against, or derives
// its expectation from that constant — it does not hand-maintain a second
// copy of "what documentor can do" for the assertion to compare against.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

// ---------------------------------------------------------------------------
// 1. The README's format matrix vs. FORMATS (writable) and READABLE_EXTS
//    (readable).
//
// What this depends on, so an editor knows what is free to reword: the table
// under the "## What it reads and writes" heading, identified by its corner
// cell text "from ↓" / "to →" — not by heading wording, not by surrounding
// prose. Each column header and row label must contain one of the recognised
// format words below (pdf / docx / markdown / xlsx) somewhere in its text;
// everything else in a header or label (backticks, "Word", ".docx") is free
// to be reworded. Each data cell must be exactly "yes" or "—" — no other
// phrasing is understood, and an unrecognised cell fails loudly rather than
// being silently skipped.
//
// Two checks live here, and both are needed — a cell-by-cell comparison
// alone only ever walks rows/columns the table *already has*. A wholly new
// capability (a format FORMATS gains, an extension READABLE_EXTS gains)
// that the README never mentions produces no cell at all, so the cell walk
// stays silent about exactly the incident this guard exists to catch (.docx
// reading landed with no README row for it). The second check below closes
// that gap by iterating FORMATS and READABLE_EXTS themselves and demanding
// a matching column/row exists, independent of what cells already say.
// ---------------------------------------------------------------------------

type Cell = { row: string; col: string; text: string };

function extractFormatMatrix(md: string): { headers: string[]; rows: { label: string; cells: string[] }[] } {
  const lines = md.split('\n');
  const headerIdx = lines.findIndex((l) => l.includes('from ↓') && l.includes('to →'));
  if (headerIdx === -1) {
    throw new Error(
      'could not find the README format-matrix header row (looked for a line containing '
      + '"from ↓" and "to →") — the table this guard depends on may have moved or been reworded',
    );
  }
  const splitRow = (line: string): string[] =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  const headers = splitRow(lines[headerIdx]!).slice(1); // drop the corner cell
  const rows: { label: string; cells: string[] }[] = [];
  // headerIdx + 1 is the markdown separator row (|:--|:--:|…); data starts after it.
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim().startsWith('|')) break;
    const cells = splitRow(line);
    rows.push({ label: cells[0]!, cells: cells.slice(1) });
  }
  return { headers, rows };
}

// Maps a header/row label's free-form text to one of FORMATS' own members
// (what the code can write) by looking for the format's name in it.
function formatFromLabel(label: string): string | undefined {
  const l = label.toLowerCase();
  if (l.includes('pdf')) return 'pdf';
  if (l.includes('docx')) return 'docx';
  if (l.includes('markdown')) return 'md';
  if (l.includes('xlsx') || l.includes('excel')) return 'xlsx';
  return undefined;
}

// Maps a row label to the file extension it names (what READABLE_EXTS keys
// on). Kept separate from formatFromLabel even though the words overlap,
// because "reads .md" and "writes md" are different questions the code
// answers with two different constants.
function extFromLabel(label: string): string | undefined {
  const l = label.toLowerCase();
  if (l.includes('.md')) return '.md';
  if (l.includes('.docx')) return '.docx';
  if (l.includes('.xlsx')) return '.xlsx';
  if (l.includes('pdf')) return '.pdf';
  return undefined;
}

const matrix = extractFormatMatrix(README);
const cells: Cell[] = [];
for (const row of matrix.rows) {
  for (const [i, col] of matrix.headers.entries()) {
    cells.push({ row: row.label, col, text: row.cells[i] ?? '' });
  }
}

describe('README format matrix agrees with FORMATS and READABLE_EXTS', () => {
  it.each(cells)('$row → $col', ({ row, col, text }) => {
    const rowExt = extFromLabel(row);
    const colFormat = formatFromLabel(col);
    if (rowExt === undefined) {
      throw new Error(`README table row "${row}" does not name a known format/extension — update extFromLabel or the row`);
    }
    if (colFormat === undefined) {
      throw new Error(`README table column "${col}" does not name a known format — update formatFromLabel or the column`);
    }
    if (text !== 'yes' && text !== '—') {
      throw new Error(`README cell for ${row} → ${col} is ${JSON.stringify(text)}, neither "yes" nor "—" — this guard only understands those two`);
    }

    // A build can turn any readable extension into any writable format —
    // ingest doesn't care what it will be rendered to, and render doesn't
    // care what it was read from (see build.ts's runBuild: ingest() runs
    // once, renderTo() runs once per --to format). So "can this cell be
    // yes" is exactly this AND, not something the table gets to assert on
    // its own authority.
    const codeSaysYes = READABLE_EXTS.has(rowExt) && (FORMATS as ReadonlySet<string>).has(colFormat);
    const readmeSaysYes = text === 'yes';

    expect(
      readmeSaysYes,
      readmeSaysYes && !codeSaysYes
        ? `README claims ${row} can be built to ${col} ("yes"), but READABLE_EXTS.has(${JSON.stringify(rowExt)})=${READABLE_EXTS.has(rowExt)} `
          + `and FORMATS.has(${JSON.stringify(colFormat)})=${(FORMATS as ReadonlySet<string>).has(colFormat)} — the code cannot do this`
        : `README claims ${row} → ${col} is "—", but READABLE_EXTS.has(${JSON.stringify(rowExt)})=${READABLE_EXTS.has(rowExt)} `
          + `and FORMATS.has(${JSON.stringify(colFormat)})=${(FORMATS as ReadonlySet<string>).has(colFormat)} — the code can actually do this and the README undersells it`,
    ).toBe(codeSaysYes);
  });
});

// The coverage check the cell walk above cannot do: iterate FORMATS and
// READABLE_EXTS on their own, not just as the right-hand side of a
// per-cell comparison, and demand every member has a matching column/row.
// Reproduced without this: adding 'xlsx' to FORMATS with no README column
// for it, or '.txt' to READABLE_EXTS with no README row for it, produced
// zero failures — the cell walk has nothing to iterate when the table
// itself never mentions the new capability.
describe('every FORMATS/READABLE_EXTS member has a matching column/row in the README table', () => {
  it('every writable format has a column', () => {
    const columnFormats = new Set(
      matrix.headers.map(formatFromLabel).filter((f): f is string => f !== undefined),
    );
    const missing = [...FORMATS].filter((f) => !columnFormats.has(f));
    expect(
      missing,
      missing
        .map((f) => `FORMATS gained ${JSON.stringify(f)} and the README's table has no column for it`)
        .join('; '),
    ).toEqual([]);
  });

  it('every readable extension has a row', () => {
    const rowExts = new Set(
      matrix.rows.map((r) => extFromLabel(r.label)).filter((e): e is string => e !== undefined),
    );
    // .md and .markdown are not two capabilities — build.ts's own ingest()
    // sends both through ingestMarkdown, the same branch — so the row
    // "Markdown `.md`" already covers .markdown too; folding it in here
    // stops this check from demanding a second row for an alternate
    // spelling of a capability the table already names.
    const family = (ext: string): string => (ext === '.markdown' ? '.md' : ext);
    const missing = [...new Set([...READABLE_EXTS].map(family))].filter((e) => !rowExts.has(e));
    expect(
      missing,
      missing
        .map((e) => `READABLE_EXTS gained ${JSON.stringify(e)} and the README's table has no row for it`)
        .join('; '),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Every --flag the README mentions must be a flag the CLI parsers accept,
//    and every --flag the CLI's own --help text advertises must likewise be
//    accepted — the direction people forget, and exactly the class of bug
//    --plain-names shipped as (named in --help before this guard existed,
//    but that direction was never tested; renaming or dropping a flag while
//    leaving its old spelling in the help text would not have failed
//    anything).
//
// What this depends on: the literal token "--word-with-dashes" appearing
// anywhere in the source text (README prose, code fences, or --help output).
// Nothing about surrounding sentences matters — only the exact spelling of
// each flag token. A flag is "accepted" if parseArgs or parseInspectArgs
// does not throw "unknown option <flag>" for it; both parsers are checked
// because README and --help between them describe both `build` and
// `inspect`, and a flag need only belong to one to be legitimate.
//
// Deliberately not checked, and left as known future scope rather than
// silent: the reverse direction, a flag a parser accepts that appears in
// neither README nor --help. That's the same "code moved, docs silent"
// family as everything else in this file, but an undocumented flag is
// inert rather than misleading — nobody reads a paragraph that promises a
// capability the flag doesn't have — so it was left out of this pass
// rather than guessed at with a hand-maintained flag inventory.
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
    // Any other failure — "needs a value", "unexpected argument" from a
    // dummy value it didn't want, etc. — still proves the parser recognised
    // the flag by name; only the exact "unknown option" message means it
    // didn't.
    return (e as Error).message !== `unknown option ${flag}`;
  }
}

function assertFlagsKnown(source: string, flags: readonly string[]): void {
  const unknown = flags.filter(
    (f) => !isKnownOption(parseArgs, f) && !isKnownOption(parseInspectArgs, f),
  );
  expect(
    unknown,
    `${source} mentions ${unknown.join(', ')}, but neither build's parseArgs nor inspect's `
    + `parseInspectArgs accepts ${unknown.length === 1 ? 'it' : 'them'} — the flag was renamed or `
    + `removed in code and the docs were not updated to match`,
  ).toEqual([]);
}

describe('CLI flags named in the docs are flags the parser actually accepts', () => {
  it('every flag mentioned in README.md is accepted by build or inspect', () => {
    assertFlagsKnown('README.md', extractFlags(README));
  });

  it('every flag named in --help usage text is accepted by build or inspect', () => {
    // Runs the real entry point rather than importing its USAGE string,
    // because src/bin/documentor.ts calls process.exit() at module scope —
    // importing it would kill the test process. test/cli/exit-codes.test.ts
    // uses the same tsx-subprocess approach for the same reason.
    const bin = join(ROOT, 'src', 'bin', 'documentor.ts');
    const quotedBin = process.platform === 'win32' ? `"${bin}"` : bin;
    const r = spawnSync('npx', ['tsx', quotedBin, '--help'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    expect(r.status, `--help exited ${r.status}, stderr: ${r.stderr}`).toBe(0);
    assertFlagsKnown('--help usage text', extractFlags(r.stdout));
  });
});
