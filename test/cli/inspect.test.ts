import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '../../src/ir/types.js';
import { renderDocx } from '../../src/render/docx.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import { parseInspectArgs, renderHuman, runInspect, type InspectResult } from '../../src/cli/inspect.js';

const collect = () => {
  const log: string[] = []; const err: string[] = [];
  return { io: { log: (s: string) => log.push(s), err: (s: string) => err.push(s) }, log, err };
};

async function fixture(md: string, name = 'report.md'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'documentor-inspect-'));
  const file = join(dir, name);
  await writeFile(file, md);
  return file;
}

const fixtureTheme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C', muted: '#898D8D', rule: '#CDCDCE' } });

async function docxFixture(doc: Doc, name = 'report.docx'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'documentor-inspect-docx-'));
  const file = join(dir, name);
  const bytes = await renderDocx(doc, fixtureTheme, { epochSeconds: 1_000_000_000 });
  await writeFile(file, bytes);
  return file;
}

// A 2×1 red PNG, the same fixture test/render/docx.test.ts uses — real
// enough to embed, small enough to read in a diff.
const PNG_2x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkS7cAAAAAElFTkSuQmCC';

function parseJson(log: string[]): InspectResult {
  return JSON.parse(log.join('\n')) as InspectResult;
}

/**
 * Every fact a value carries, walked at runtime rather than read off a
 * hand-maintained list of "the fields we remembered to check" — the whole
 * point is that a field added to `DocInspection` later is covered here
 * without anyone also updating a parallel list in this test file. `file` and
 * `status` are excluded because they are addressing/discriminant fields, not
 * reported facts (a full path is never printed verbatim in single-document
 * output, and the word "ok" never appears in the human form at all) — every
 * other string or nonzero number reachable from the object is a fact this
 * test requires to appear, verbatim, in the human text. A zero number is
 * excluded because `renderUnderstood`'s own contract is to omit a zero count
 * (see its comment) — that is a documented exception, not a loophole this
 * test is blind to: a *nonzero* value of any newly added field still has to
 * show up somewhere in the human output, or this walk will catch it.
 */
function factsOf(value: unknown): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (typeof value === 'number') return value === 0 ? [] : [String(value)];
  if (Array.isArray(value)) return value.flatMap(factsOf);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value)
      .filter(([k]) => k !== 'file' && k !== 'status')
      .flatMap(([, v]) => factsOf(v));
  }
  return [];
}

describe('parseInspectArgs', () => {
  it('leaves theme unset when not given — the plain default now lives in config.ts\'s resolveConfig, the one place a flag, a sidecar, and a fallback are weighed together', () => {
    expect(parseInspectArgs(['a.md'])).toEqual({ input: 'a.md', json: false, recursive: false, noConfig: false });
  });
  it('reads --theme, --json and --recursive', () => {
    const args = parseInspectArgs(['a.md', '--theme', 'tebin', '--json', '--recursive']);
    expect(args.theme).toBe('tebin');
    expect(args.json).toBe(true);
    expect(args.recursive).toBe(true);
  });
  it('rejects an unknown option', () => {
    expect(() => parseInspectArgs(['a.md', '--colour'])).toThrow(/--colour/);
  });
  it('reads --title, --date and --entity, spelled exactly as build.ts\'s own parseArgs does', () => {
    const args = parseInspectArgs(['a.md', '--title', 'Q3 Review', '--date', 'July 20, 2026', '--entity', 'Acme Sp. z o.o.']);
    expect(args.title).toBe('Q3 Review');
    expect(args.date).toBe('July 20, 2026');
    expect(args.entity).toBe('Acme Sp. z o.o.');
  });
});

describe('runInspect: nothing is rendered or written', () => {
  it('never writes a file — only the temp fixture itself exists afterwards', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io } = collect();
    expect(await runInspect([file], io)).toBe(0);
    expect(await readdir(join(file, '..'))).toEqual(['report.md']);
  });
});

describe('runInspect: single file', () => {
  it('reports title and block counts for a clean document', async () => {
    const file = await fixture('# Report\n\nHello there.\n\n## Section\n\nMore text.\n');
    const { io, log } = collect();
    expect(await runInspect([file], io)).toBe(0);
    const human = log.join('\n');
    expect(human).toMatch(/understood:.*title "Report"/);
    expect(human).toMatch(/2 paragraphs/);
    expect(human).toMatch(/1 heading/);
  });

  it('the human and JSON forms carry the same facts', async () => {
    // A source deliberately built with no title, a body heading (so the
    // heading count is not zero even after md.ts's h1-as-title lift), a
    // paragraph, and something the ingester has to drop — exercising every
    // field DocInspection['ok'] carries in one document.
    const file = await fixture('## A body heading\n\nHello.\n\n<div>raw</div>\n');
    const { io: ioHuman, log: humanLog } = collect();
    await runInspect([file], ioHuman);
    const human = humanLog.join('\n');

    const { io: ioJson, log: jsonLog } = collect();
    await runInspect([file, '--json'], ioJson);
    const result = parseJson(jsonLog);
    const doc = result.documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');

    // Walks the structure itself via factsOf — see its own comment — rather
    // than a hand-written list of which fields to check. "no title" is the
    // one fact rendered as a synonym instead of the literal field value
    // ("Untitled"), so it is asserted directly; every other fact is read off
    // the object and required to appear, verbatim, in the human text.
    expect(human).toContain('no title');
    for (const fact of factsOf(doc)) {
      expect(human, `fact ${JSON.stringify(fact)} missing from the human output`).toContain(fact);
    }
    // And the reverse holds for renderHuman called directly against the same
    // structure, guarding against a future field added to one rendering and
    // not the other.
    expect(renderHuman(result)).toBe(human);
  });

  it('a field added to DocInspection and left unrendered fails the parity walk', async () => {
    // Reproduces the reviewer's own counterexample from fix round 1: add a
    // field to the `ok` shape, populate it, and never render it. Proves
    // factsOf (unlike the old hand-maintained field list it replaced) does
    // not need to be told about the new field to catch the omission.
    const file = await fixture('# Report\n\nHello.\n');
    const { io, log } = collect();
    await runInspect([file, '--json'], io);
    const result = parseJson(log);
    const doc = result.documents[0] as unknown as Record<string, unknown>;
    expect(doc['status']).toBe('ok');
    doc['probeField'] = 'a fact nobody rendered';

    const human = renderHuman(result);
    expect(() => {
      for (const fact of factsOf(doc)) {
        expect(human, `fact ${JSON.stringify(fact)} missing from the human output`).toContain(fact);
      }
    }).toThrowError(/fact "a fact nobody rendered" missing from the human output/);
  });

  it('renders a subtitle and a date when the document carries them', async () => {
    // ingestDocx recovers `subtitle` from a DocSubtitle body paragraph and
    // `date` from the letterhead's header/footer scan — round-tripped
    // through this project's own renderDocx the same way
    // test/ingest/docx.test.ts's own fixture is. `entity` is covered
    // separately below, via --entity, since it has no source inside a
    // document at all.
    const withMeta: Doc = {
      meta: { title: 'Reply to Request 4.2', subtitle: 'Confidential', date: 'July 20, 2026', lang: 'en' },
      blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body text.' }] }],
    };
    const file = await docxFixture(withMeta, 'meta.docx');
    const { io, log } = collect();
    await runInspect([file], io);
    const human = log.join('\n');
    expect(human).toMatch(/subtitle "Confidential"/);
    expect(human).toMatch(/date "July 20, 2026"/);
  });

  it('--entity previews what build --entity would print, in both forms', async () => {
    // entity has no source inside any document — it can only ever come from
    // a caller-supplied value (see DocInspection's own comment) — so this is
    // the only way to exercise it at all, and it must behave exactly like
    // `build --entity` (same flag, same override): see build.ts's own
    // `ingestOptsFrom`.
    const file = await fixture('# Report\n\nHello.\n');
    const { io: ioHuman, log: humanLog } = collect();
    await runInspect([file, '--entity', 'Acme Sp. z o.o.'], ioHuman);
    expect(humanLog.join('\n')).toMatch(/entity "Acme Sp\. z o\.o\."/);

    const { io: ioJson, log: jsonLog } = collect();
    await runInspect([file, '--entity', 'Acme Sp. z o.o.', '--json'], ioJson);
    const doc = parseJson(jsonLog).documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    // Not a dedicated JSON assertion beyond this: the parity walk above
    // already forces `entity` to be rendered the moment it is nonempty, so
    // this only needs to confirm the structure actually carries the value
    // `ingest` was given.
    expect(doc.entity).toBe('Acme Sp. z o.o.');
  });

  it('--date overrides what the document\'s own header carried, the same way build --date does', async () => {
    const withDate: Doc = {
      meta: { title: 'Reply', date: 'July 20, 2026', lang: 'en' },
      blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body.' }] }],
    };
    const file = await docxFixture(withDate, 'dated.docx');
    const { io, log } = collect();
    await runInspect([file, '--date', 'Given Date'], io);
    const human = log.join('\n');
    // The letterhead date is still named in `dropped` — that is
    // ingestDocx's own honest report of what the header actually carried,
    // unrelated to the override, and inspect must not reword it (see
    // DocInspection's own comment on `dropped`). What --date changes is
    // what `understood` reports as the document's date: the override, not
    // the scanned one, exactly matching build.ts's own ingestDocx test
    // ("lets an explicit title/date override what the header carried").
    expect(human).toMatch(/understood:.*date "Given Date"/);
    expect(human).toMatch(/dropped:.*kept the date it carried: "July 20, 2026"/);
  });

  it('--title wins over the filename-derived title for a titleless .docx, the same way build --title does', async () => {
    // A .docx has no title in its body at all when neither a DocTitle style
    // nor --title supplied one — build.ts's own ingest() wrapper then falls
    // back to the file's own name (see its comment: "the design doc's rule
    // is that a DOCX's name is its title in that case"). Without --title,
    // inspect must show that same fallback; with --title, it must show the
    // override instead — exactly the disagreement the coordinator's review
    // named: `inspect quarterly.docx` reporting "quarterly" while `build
    // quarterly.docx --title "Q3 Review"` produced a document titled
    // "Q3 Review" for the same input.
    // renderDocx always writes a DocTitle paragraph, so a "no title at all"
    // .docx can't be produced by feeding it an empty string — but feeding it
    // the literal sentinel 'Untitled' reaches the same downstream state:
    // ingestDocx reads that DocTitle text back as the (non-empty) string
    // "Untitled", which is exactly the condition build.ts's own ingest()
    // wrapper checks for before substituting the filename, so this fixture
    // exercises the real fallback path rather than a hand-picked shortcut.
    const titleless: Doc = {
      meta: { lang: 'en', title: 'Untitled' },
      blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body.' }] }],
    };
    const file = await docxFixture(titleless, 'quarterly.docx');

    const { io: ioNoFlag, log: noFlagLog } = collect();
    await runInspect([file], ioNoFlag);
    expect(noFlagLog.join('\n')).toMatch(/title "quarterly"/);

    const { io: ioTitled, log: titledLog } = collect();
    await runInspect([file, '--title', 'Q3 Review'], ioTitled);
    const human = titledLog.join('\n');
    expect(human).toMatch(/title "Q3 Review"/);
    expect(human).not.toMatch(/title "quarterly"/);
  });

  it('reports the ingester\'s own dropped entries, unchanged', async () => {
    const file = await fixture('# Report\n\n<div>raw</div>\n');
    const { io, log } = collect();
    await runInspect([file, '--json'], io);
    const result = parseJson(log);
    const doc = result.documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.dropped.some((d) => /html/i.test(d))).toBe(true);
  });

  it('a .docx with a table reports the table as dropped, in both forms', async () => {
    const docWithTable: Doc = {
      meta: { title: 'Ledger', lang: 'en' },
      blocks: [
        { t: 'heading', level: 1, text: [{ t: 'text', v: 'Ledger' }] },
        {
          t: 'table',
          head: [[{ t: 'text', v: 'Item' }], [{ t: 'text', v: 'Total' }]],
          rows: [[[{ t: 'text', v: 'Widget' }], [{ t: 'text', v: '1' }]]],
          align: ['l', 'r'],
        },
      ],
    };
    const file = await docxFixture(docWithTable);

    // ingestDocx's own dropped message counts <w:tr> elements, header row
    // included — one head row plus one data row is "2 rows", not the one
    // data row a person might expect from reading the IR's own `rows` field.
    const { io: ioHuman, log: humanLog } = collect();
    await runInspect([file], ioHuman);
    expect(humanLog.join('\n')).toMatch(/table with 2 rows/);

    const { io: ioJson, log: jsonLog } = collect();
    await runInspect([file, '--json'], ioJson);
    const result = parseJson(jsonLog);
    const doc = result.documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.dropped.some((d) => /table with 2 rows/.test(d))).toBe(true);
    // DOCX ingest does not read tables at all (see the design doc's scoping
    // note), so the IR itself holds none — `understood` must not claim one.
    expect(doc.counts.tables).toBe(0);
  });

  it('warns when a document has no title', async () => {
    const file = await fixture('Just a paragraph, no heading at all.\n');
    const { io, log } = collect();
    await runInspect([file, '--json'], io);
    const doc = parseJson(log).documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.title).toBe('Untitled');
    expect(doc.warnings.some((w) => /no title/.test(w))).toBe(true);
  });

  it('does not warn about a title on a document that has one', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io, log } = collect();
    await runInspect([file, '--json'], io);
    const doc = parseJson(log).documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.warnings.some((w) => /no title/.test(w))).toBe(false);
  });

  it('does not warn when heading levels only go up by one', async () => {
    // The h1 becomes the document title (md.ts's own h1-as-title rule) and
    // leaves the body, so the body's own headings here are H2 then H3 — no
    // jump.
    const file = await fixture('# Title\n\n## Two\n\n### Three\n\nOK so far.\n');
    const { io, log } = collect();
    await runInspect([file, '--json'], io);
    const doc = parseJson(log).documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.warnings.some((w) => w.includes('H'))).toBe(false);
  });

  it('warns when heading levels jump', async () => {
    // Built directly as IR and round-tripped through docx rather than
    // Markdown: renderDocx writes body heading levels as DocH1/DocH2/DocH3
    // (distinct from the document's own DocTitle), and ingestDocx reads them
    // straight back — see render/docx.ts's and ingest/docx.ts's own comments
    // on that pairing — which lets this build the exact H1→H3 jump without
    // depending on Markdown's own h1-lift rule at all.
    const jumpDoc: Doc = {
      meta: { title: 'Report', lang: 'en' },
      blocks: [
        { t: 'heading', level: 1, text: [{ t: 'text', v: 'Intro' }] },
        { t: 'heading', level: 3, text: [{ t: 'text', v: 'Deep' }] },
      ],
    };
    const jumpFile = await docxFixture(jumpDoc, 'jump.docx');
    const { io, log } = collect();
    await runInspect([jumpFile, '--json'], io);
    const doc = parseJson(log).documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.warnings.some((w) => w.includes('H1→H3'))).toBe(true);
  });

  it('warns about a table too wide for the page, honouring --theme', async () => {
    // ingestDocx drops every table whole (see its own "table with N rows"
    // comment — table reading is out of scope for the DOCX slice this
    // ingester covers), so a wide-table warning can only be exercised
    // through the Markdown ingester, which does read a table's real shape.
    const head = Array.from({ length: 11 }, (_, i) => `C${i}`).join(' | ');
    const sep = Array.from({ length: 11 }, () => '---').join(' | ');
    const row = Array.from({ length: 11 }, (_, i) => String(i)).join(' | ');
    const file = await fixture(`# Wide\n\n| ${head} |\n| ${sep} |\n| ${row} |\n`);
    const { io, log } = collect();
    await runInspect([file, '--json'], io);
    const doc = parseJson(log).documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.warnings.some((w) => /11 columns/.test(w) && /A4 portrait/.test(w))).toBe(true);
  });

  it('does not warn about a table that fits the page', async () => {
    const file = await fixture('# Narrow\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    const { io, log } = collect();
    await runInspect([file, '--json'], io);
    const doc = parseJson(log).documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.warnings.some((w) => /columns/.test(w))).toBe(false);
  });

  it('warns about an image in a format Word cannot take', async () => {
    // render/docx.ts embeds a PNG or a JPEG (see RASTER there). A GIF has no
    // reader, so it becomes a placeholder — and this warning is how somebody
    // finds that out before the build rather than after. The block can only be
    // built through the Markdown ingester, which carries an image's src
    // verbatim without checking its format at all.
    const gif = `data:image/gif;base64,${Buffer.from('GIF89a').toString('base64')}`;
    const file = await fixture(`# Pics\n\n![an animation](${gif})\n`);
    const { io, log } = collect();
    await runInspect([file, '--json'], io);
    const doc = parseJson(log).documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.warnings.some((w) => /will not embed in Word/.test(w))).toBe(true);
  });

  it('warns about a picture whose declared format its bytes do not back up', async () => {
    // Labelled JPEG, and the bytes are not one. Judging by the label alone
    // would promise a picture here and produce a placeholder at build time —
    // inspect's whole job is to not do that.
    const jpeg = `data:image/jpeg;base64,${Buffer.from('not really jpeg bytes').toString('base64')}`;
    const file = await fixture(`# Pics\n\n![a photo](${jpeg})\n`);
    const { io, log } = collect();
    await runInspect([file, '--json'], io);
    const doc = parseJson(log).documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.warnings.some((w) => /will not embed in Word/.test(w))).toBe(true);
  });

  it('does not warn about a real JPEG', async () => {
    // A minimal baseline frame: start-of-image, a frame header carrying 8x8,
    // end-of-image. Enough for the size reader, which is what decides.
    const bytes = Buffer.from([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00, 0x08,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xff, 0xd9,
    ]);
    const file = await fixture(`# Pics\n\n![a photo](data:image/jpeg;base64,${bytes.toString('base64')})\n`);
    const { io, log } = collect();
    await runInspect([file, '--json'], io);
    const doc = parseJson(log).documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.warnings.some((w) => /will not embed/.test(w))).toBe(false);
  });

  it('does not warn about a PNG image', async () => {
    const file = await fixture(`# Pics\n\n![a red bar](${PNG_2x1})\n`);
    const { io, log } = collect();
    await runInspect([file, '--json'], io);
    const doc = parseJson(log).documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.warnings.some((w) => /will not embed/.test(w))).toBe(false);
  });
});

describe('runInspect: exit codes', () => {
  it('exits 2 for an extension neither ingester reads', async () => {
    // .csv, not .xlsx: inspect reads .xlsx now too (see src/ingest/xlsx.ts),
    // so a bad .xlsx is a *read* failure (exit 1 — see the next test), not a
    // usage error over the extension itself.
    const dir = await mkdtemp(join(tmpdir(), 'documentor-inspect-'));
    const file = join(dir, 'ledger.csv');
    await writeFile(file, 'pretend spreadsheet bytes');
    const { io, err } = collect();
    expect(await runInspect([file], io)).toBe(2);
    expect(err.join('\n')).toMatch(/\.csv/);
  });

  it('exits 2 with no input', async () => {
    const { io } = collect();
    expect(await runInspect([], io)).toBe(2);
  });

  it('exits 1 for a document that cannot be read at all', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-inspect-'));
    const file = join(dir, 'broken.docx');
    await writeFile(file, 'this is not a zip');
    const { io, log } = collect();
    expect(await runInspect([file, '--json'], io)).toBe(1);
    const doc = parseJson(log).documents[0]!;
    expect(doc.status).toBe('failed');
  });

  // The "refused at build time" case (validateDoc rejects the ingested Doc)
  // needs a mocked ingester the same way test/cli/validate-gate.test.ts needs
  // one for `build` — see test/cli/inspect-validate-gate.test.ts, its own
  // file for the same reason that one is: vi.mock is hoisted to the top of
  // the module it appears in, so it cannot share a file with these tests
  // without also mocking the ingester out from under them.
});

describe('runInspect: directory input', () => {
  it('inspects every readable file, and reuses discoverInputs\' own filtering', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-inspect-dir-'));
    await writeFile(join(dir, 'a.md'), '# A\n\nHello.\n');
    await writeFile(join(dir, 'b.md'), '# B\n\nHello.\n');
    await writeFile(join(dir, 'notes.txt'), 'not a document');
    const { io, log } = collect();
    expect(await runInspect([dir, '--json'], io)).toBe(0);
    const result = parseJson(log);
    expect(result.documents).toHaveLength(2);
    expect(result.documents.map((d) => d.file).sort().map((f) => f.split(/[\\/]/).pop())).toEqual(['a.md', 'b.md']);
  });

  it('stays at the top level unless --recursive is given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-inspect-nested-'));
    await writeFile(join(dir, 'top.md'), '# Top\n\nHello.\n');
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'sub', 'nested.md'), '# Nested\n\nHello.\n');

    const { io: flat, log: flatLog } = collect();
    await runInspect([dir, '--json'], flat);
    expect(parseJson(flatLog).documents).toHaveLength(1);

    const { io: rec, log: recLog } = collect();
    await runInspect([dir, '--json', '--recursive'], rec);
    expect(parseJson(recLog).documents).toHaveLength(2);
  });

  it('exits 1 when one document in the batch cannot be read, without dropping the rest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-inspect-batch-bad-'));
    await writeFile(join(dir, 'good.md'), '# Good\n\nHello.\n');
    await writeFile(join(dir, 'broken.docx'), 'this is not a zip');
    const { io, log } = collect();
    expect(await runInspect([dir, '--json'], io)).toBe(1);
    const result = parseJson(log);
    expect(result.documents).toHaveLength(2);
    expect(result.documents.some((d) => d.status === 'failed')).toBe(true);
    expect(result.documents.some((d) => d.status === 'ok')).toBe(true);
  });

  it('exits 2 when a directory has nothing readable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-inspect-empty-'));
    await writeFile(join(dir, 'notes.txt'), 'not a document');
    const { io, err } = collect();
    expect(await runInspect([dir], io)).toBe(2);
    expect(err.join('\n')).toMatch(/no readable input/);
  });

  it('never writes a file for a directory batch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-inspect-dir-write-'));
    await writeFile(join(dir, 'a.md'), '# A\n\nHello.\n');
    const { io } = collect();
    await runInspect([dir, '--json'], io);
    expect(await readdir(dir)).toEqual(['a.md']);
  });
});
