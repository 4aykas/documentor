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

describe('parseInspectArgs', () => {
  it('defaults to the plain theme, human output, non-recursive', () => {
    expect(parseInspectArgs(['a.md'])).toEqual({ input: 'a.md', theme: 'plain', json: false, recursive: false });
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

    // Every fact the human form states also appears, verbatim, in the JSON
    // — proving the two are one structure rendered twice, not two
    // computations that happen to agree today. Only the nonzero counts are
    // checked: renderUnderstood omits a zero count on purpose (see its own
    // comment), so "0" is not a fact the human form claims to state.
    expect(human).toContain(doc.title === 'Untitled' ? 'no title' : doc.title);
    for (const d of doc.dropped) expect(human).toContain(d);
    for (const w of doc.warnings) expect(human).toContain(w);
    for (const [key, n] of Object.entries(doc.counts)) {
      if (n > 0) expect(human, `count ${key}=${n} missing from human output`).toContain(String(n));
    }
    // And the reverse holds for renderHuman called directly against the same
    // structure, guarding against a future field added to one rendering and
    // not the other.
    expect(renderHuman(result)).toBe(human);
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

  it('warns about an image that will not embed in Word', async () => {
    // render/docx.ts only ever embeds a PNG (see RASTER there), so a
    // non-PNG image block can only be exercised through the Markdown
    // ingester, which carries an image's src verbatim without checking its
    // format at all.
    const jpeg = `data:image/jpeg;base64,${Buffer.from('not really jpeg bytes').toString('base64')}`;
    const file = await fixture(`# Pics\n\n![a photo](${jpeg})\n`);
    const { io, log } = collect();
    await runInspect([file, '--json'], io);
    const doc = parseJson(log).documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.warnings.some((w) => /will not embed in Word/.test(w))).toBe(true);
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
    const dir = await mkdtemp(join(tmpdir(), 'documentor-inspect-'));
    const file = join(dir, 'ledger.xlsx');
    await writeFile(file, 'pretend spreadsheet bytes');
    const { io, err } = collect();
    expect(await runInspect([file], io)).toBe(2);
    expect(err.join('\n')).toMatch(/\.xlsx/);
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
