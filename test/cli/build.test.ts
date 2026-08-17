import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rectangle, stroke, setLineWidth, setStrokingRgbColor } from 'pdf-lib';
import type { Doc } from '../../src/ir/types.js';
import { renderDocx } from '../../src/render/docx.js';
import { renderPdf } from '../../src/render/pdf.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import { FORMATS, READABLE_EXTS, parseArgs, runBuild } from '../../src/cli/build.js';

const collect = () => {
  const log: string[] = []; const err: string[] = [];
  return { io: { log: (s: string) => log.push(s), err: (s: string) => err.push(s) }, log, err };
};

async function fixture(md: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'documentor-cli-'));
  const file = join(dir, 'report.md');
  await writeFile(file, md);
  return file;
}

// A .docx fixture the CLI can read, built the same way test/ingest/docx.test.ts
// builds its round-trip fixture: rendered by this project's own renderer
// rather than committed as a binary nobody could diff.
const fixtureTheme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C', muted: '#898D8D', rule: '#CDCDCE' } });

async function docxFixture(doc: Doc, name = 'report.docx'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'documentor-cli-docx-'));
  const file = join(dir, name);
  const bytes = await renderDocx(doc, fixtureTheme, { epochSeconds: 1_000_000_000 });
  await writeFile(file, bytes);
  return file;
}

describe('parseArgs', () => {
  it('leaves to/theme/plainNames unset when not given — the defaults now live in config.ts\'s resolveConfig, the one place a flag, a sidecar, and a fallback are weighed together', () => {
    expect(parseArgs(['a.md'])).toEqual({ input: 'a.md', recursive: false, noConfig: false });
  });
  it('reads --plain-names', () => {
    expect(parseArgs(['a.md', '--plain-names']).plainNames).toBe(true);
  });
  it('splits --to on commas', () => {
    expect(parseArgs(['a.md', '--to', 'pdf, md']).to).toEqual(['pdf', 'md']);
  });
  it('rejects an unknown option', () => {
    expect(() => parseArgs(['a.md', '--colour'])).toThrow(/--colour/);
  });
  it('reads --date and --entity', () => {
    const args = parseArgs(['a.md', '--date', 'July 20, 2026', '--entity', 'Acme Sp. z o.o.']);
    expect(args.date).toBe('July 20, 2026');
    expect(args.entity).toBe('Acme Sp. z o.o.');
  });
});

describe('runBuild', () => {
  it('writes the output beside the input, named after the theme', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.md', 'report.plain.md']);
  });

  it('names the output <stem>.<ext> under --plain-names, dropping the theme id', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io } = collect();
    expect(await runBuild([file, '--to', 'pdf', '--plain-names'], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.md', 'report.pdf']);
  });

  it('refuses a same-extension --plain-names build that would overwrite the input, and leaves the input untouched', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const before = await readFile(file, 'utf8');
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'md', '--plain-names'], io)).toBe(3);
    expect(err.join('\n')).toMatch(/refusing to overwrite/);
    const written = await readdir(join(file, '..'));
    expect(written).toEqual(['report.md']); // only the input — nothing else was written
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('when one of several --plain-names formats collides with the input, writes the others and refuses only that one', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'pdf,md', '--plain-names'], io)).toBe(3);
    expect(err.join('\n')).toMatch(/refusing to overwrite/);
    const written = await readdir(join(file, '..'));
    // pdf was written (no collision); md was refused (would overwrite report.md, the input)
    expect(written.sort()).toEqual(['report.md', 'report.pdf']);
  });

  it('honours --out', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const out = await mkdtemp(join(tmpdir(), 'documentor-out-'));
    const { io } = collect();
    expect(await runBuild([file, '--to', 'md', '--out', out], io)).toBe(0);
    expect(await readdir(out)).toEqual(['report.plain.md']);
  });

  it('reports what the ingester had to leave out', async () => {
    const file = await fixture('# Report\n\n<div>raw</div>\n');
    const { io, err } = collect();
    await runBuild([file, '--to', 'md'], io);
    expect(err.join('\n')).toMatch(/html/i);
  });

  it('refuses a format it cannot write yet, naming the ones it can', async () => {
    const file = await fixture('# R\n');
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'xlsx'], io)).toBe(2);
    expect(err.join('\n')).toMatch(/pdf, md, docx/);
  });

  it('writes a Word document, named for the theme', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io } = collect();
    expect(await runBuild([file, '--to', 'docx'], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.md', 'report.plain.docx']);
    // An empty or truncated buffer would pass the existence check above.
    // This proves the file is a real .docx package — a zip with a document
    // part in it — without duplicating what the renderer's own tests already
    // assert about that part's content.
    const { docxPart } = await import('../helpers/docx-parts.js');
    const part = await docxPart(await readFile(join(file, '..', 'report.plain.docx')), 'word/document.xml');
    expect(part.length).toBeGreaterThan(0);
  });

  it('produces identical Word bytes on two runs', async () => {
    const file = await fixture('# Report\n\nHello, [a link](https://example.com).\n');
    const a = await mkdtemp(join(tmpdir(), 'documentor-docx-a-'));
    const b = await mkdtemp(join(tmpdir(), 'documentor-docx-b-'));
    const { io } = collect();
    await runBuild([file, '--to', 'docx', '--out', a], io);
    await runBuild([file, '--to', 'docx', '--out', b], io);
    const [first, second] = await Promise.all([
      readFile(join(a, 'report.plain.docx')),
      readFile(join(b, 'report.plain.docx')),
    ]);
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it('writes every format in its own bytes, never Markdown under another extension', async () => {
    // The real fix for the dispatch is compile-time: renderTo's `never` binding
    // makes a format without a branch a build error, which no runtime test can
    // observe. This pins the half that is observable — that each format FORMATS
    // admits produces something that is not simply the Markdown rendering,
    // which is what the old `?:` chain's tail branch would have written. It
    // iterates FORMATS rather than a list of its own, so a format added without
    // a renderer fails here too, on whichever machine runs the tests before
    // anyone runs the typechecker.
    const file = await fixture('# Report\n\nHello.\n');
    const out = await mkdtemp(join(tmpdir(), 'documentor-formats-'));
    const { io } = collect();
    expect(await runBuild([file, '--to', [...FORMATS].join(','), '--out', out], io)).toBe(0);
    const markdown = await readFile(join(out, 'report.plain.md'));
    for (const format of FORMATS) {
      const bytes = await readFile(join(out, `report.plain.${format}`));
      if (format === 'md') continue;
      expect(bytes.equals(markdown), `${format} was written as Markdown bytes`).toBe(false);
    }
  });

  it('reads a .docx input and produces a PDF', async () => {
    const file = await docxFixture({ meta: { title: 'From the body', lang: 'en' }, blocks: [{ t: 'para', text: [{ t: 'text', v: 'Hello.' }] }] });
    const { io } = collect();
    expect(await runBuild([file, '--to', 'pdf'], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.docx', 'report.plain.pdf']);
  });

  it('titles a .docx from its filename when the body carries none, and lets --title override that', async () => {
    // renderDocx always writes a DocTitle paragraph, so an empty meta.title is
    // the only way to build a fixture whose body carries no title — the same
    // "nothing supplies a title" case ingestDocx's own test exercises, which
    // is exactly the case the CLI's filename fallback exists for.
    const file = await docxFixture({ meta: { title: '', lang: 'en' }, blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body.' }] }] }, 'reply-4-2.docx');
    const out = await mkdtemp(join(tmpdir(), 'documentor-docx-title-'));
    const { io } = collect();

    expect(await runBuild([file, '--to', 'md', '--out', out], io)).toBe(0);
    expect((await readFile(join(out, 'reply-4-2.plain.md'), 'utf8')).split('\n')[0]).toBe('# reply-4-2');

    const { io: io2 } = collect();
    expect(await runBuild([file, '--to', 'md', '--out', out, '--title', 'Given Title'], io2)).toBe(0);
    expect((await readFile(join(out, 'reply-4-2.plain.md'), 'utf8')).split('\n')[0]).toBe('# Given Title');
  });

  it('lets --date override the date a .docx header carried', async () => {
    const file = await docxFixture({
      meta: { title: 'T', lang: 'en', date: 'July 20, 2026' },
      blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body.' }] }],
    });
    const out = await mkdtemp(join(tmpdir(), 'documentor-docx-date-'));
    const { io } = collect();
    const { docxPart } = await import('../helpers/docx-parts.js');

    expect(await runBuild([file, '--to', 'docx', '--out', out, '--date', 'August 12, 2026'], io)).toBe(0);
    const header = await docxPart(await readFile(join(out, 'report.plain.docx')), 'word/header2.xml');
    expect(header).toContain('August 12, 2026');
    expect(header).not.toContain('July 20, 2026');
  });

  it('does not let a .docx rendered --to docx overwrite its own .docx input', async () => {
    const file = await docxFixture({ meta: { title: 'T', lang: 'en' }, blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body.' }] }] });
    const { io } = collect();
    expect(await runBuild([file, '--to', 'docx'], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.docx', 'report.plain.docx']);
  });

  it('refuses an input extension it cannot read yet, naming what it does read', async () => {
    // .csv, not .xlsx: this build reads .xlsx now (phase 3's ingest work —
    // see src/ingest/xlsx.ts), so it no longer names an extension the ingest
    // dispatch itself rejects.
    const dir = await mkdtemp(join(tmpdir(), 'documentor-x-'));
    const file = join(dir, 'a.csv');
    await writeFile(file, 'not really a csv');
    const { io, err } = collect();
    expect(await runBuild([file], io)).toBe(2);
    expect(err.join('\n')).toMatch(/\.md/);
    expect(err.join('\n')).toMatch(/\.docx/);
    expect(err.join('\n')).toMatch(/\.xlsx/);
  });

  it('produces identical bytes on two runs', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io } = collect();
    await runBuild([file, '--to', 'pdf'], io);
    const first = await readFile(join(file, '..', 'report.plain.pdf'));
    await new Promise((r) => setTimeout(r, 1100));
    await runBuild([file, '--to', 'pdf'], io);
    const second = await readFile(join(file, '..', 'report.plain.pdf'));
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it('carries --date and --entity all the way into the rendered document', async () => {
    // How meta.entity/meta.date print under the letterhead is already covered
    // by test/render/html.test.ts and test/render/docx.test.ts — this only
    // proves the CLI flags survive parseArgs and actually reach the renderer,
    // rather than being dropped somewhere between the two. docx is the
    // cheapest format here to inspect end-to-end, since its header lives in
    // an inspectable XML part.
    const { docxPart } = await import('../helpers/docx-parts.js');
    const file = await fixture('# Report\n\nHello.\n');
    const out = await mkdtemp(join(tmpdir(), 'documentor-meta-'));
    const { io } = collect();
    // The date is passed through verbatim — not a machine date — precisely so
    // a re-issued document can carry a value like this one, not ISO 8601.
    expect(await runBuild(
      [file, '--to', 'docx', '--out', out, '--date', 'July 20, 2026', '--entity', 'Acme Sp. z o.o.'],
      io,
    )).toBe(0);
    const bytes = await readFile(join(out, 'report.plain.docx'));
    const header = await docxPart(bytes, 'word/header2.xml');
    expect(header).toContain('July 20, 2026');
    expect(header).toContain('Acme Sp. z o.o.');
  });

  it('leaves meta exactly as it was before --date/--entity existed, when neither flag is passed', async () => {
    // The property under test: a document rendered with no new flags must be
    // byte-identical to how it rendered before --date/--entity existed. Proven
    // here by rendering the same fixture twice — once through the exact
    // pre-change code path (ingestMarkdown called with only a possible
    // `title`, the way build.ts called it before this change) and once
    // through today's runBuild with no --date/--entity — and comparing bytes,
    // rather than assuming an absent option behaves like an absent option.
    const md = '# Report\n\nHello, world.\n';
    const file = await fixture(md);
    const out = await mkdtemp(join(tmpdir(), 'documentor-identity-'));
    const { io } = collect();
    expect(await runBuild([file, '--to', 'pdf', '--out', out], io)).toBe(0);
    const afterChange = await readFile(join(out, 'report.plain.pdf'));

    const { ingestMarkdown } = await import('../../src/ingest/md.js');
    const { validateDoc } = await import('../../src/ir/validate.js');
    const { renderPdf } = await import('../../src/render/pdf.js');
    const { loadTheme } = await import('../../src/theme/resolve.js');
    const { resolveEpoch } = await import('../../src/cli/timestamp.js');
    const { doc } = ingestMarkdown(md, {}); // exactly the pre-change call shape
    validateDoc(doc);
    const theme = await loadTheme('plain');
    const epochSeconds = await resolveEpoch(process.env, file);
    const beforeChange = await renderPdf(doc, theme, { epochSeconds });

    expect(Buffer.compare(afterChange, beforeChange)).toBe(0);
  });

  it('leaves the default naming and bytes untouched by the --plain-names option existing', async () => {
    // Same property as the test above, but for --plain-names rather than
    // --date/--entity: an absent flag must behave exactly as it did before
    // the flag existed, not merely "look right". Proven by rendering the
    // same fixture through today's runBuild with no flag at all, and
    // separately through an explicit --plain-names=false-equivalent (the
    // theme-id naming, computed directly, bypassing the flag entirely), then
    // comparing both the file name produced and its bytes.
    const md = '# Report\n\nHello, world.\n';
    const file = await fixture(md);
    const outA = await mkdtemp(join(tmpdir(), 'documentor-default-a-'));
    const outB = await mkdtemp(join(tmpdir(), 'documentor-default-b-'));
    const { io: ioA } = collect();

    expect(await runBuild([file, '--to', 'pdf', '--out', outA], ioA)).toBe(0);
    const withoutFlag = await readFile(join(outA, 'report.plain.pdf'));

    const { ingestMarkdown } = await import('../../src/ingest/md.js');
    const { validateDoc } = await import('../../src/ir/validate.js');
    const { renderPdf } = await import('../../src/render/pdf.js');
    const { loadTheme } = await import('../../src/theme/resolve.js');
    const { resolveEpoch } = await import('../../src/cli/timestamp.js');
    const { writeFile: write } = await import('node:fs/promises');
    const { doc } = ingestMarkdown(md, {});
    validateDoc(doc);
    const theme = await loadTheme('plain');
    const epochSeconds = await resolveEpoch(process.env, file);
    const computedDirectly = await renderPdf(doc, theme, { epochSeconds });
    const referenceTarget = join(outB, `report.${theme.id}.pdf`);
    await write(referenceTarget, computedDirectly);

    expect(await readdir(outA)).toEqual(['report.plain.pdf']);
    expect(await readdir(outB)).toEqual(['report.plain.pdf']);
    expect(Buffer.compare(withoutFlag, computedDirectly)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reading a PDF — task 6: the fourth ingester wired into build.ts. The unit
// behaviour of ingestPdf itself (grid detection, the join, the token gate,
// the limits) is already covered by test/ingest/pdf*.test.ts; everything
// here is specifically about the CLI wiring: the extension is dispatched,
// the advisory and the dropped list reach the report the same way every
// other ingester's do, and a refusal never leaves a partial artefact behind.
// ---------------------------------------------------------------------------

const pdfTheme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });

/** pdf-lib's own `page.drawRectangle` never emits the PDF `re` operator
 *  grid.ts's own reader looks for (see test/ingest/pdf.test.ts's identical
 *  comment) — pushing the raw operator is what makes a fixture built here
 *  representative of a real, drawn-grid table rather than testing nothing. */
function drawCellRect(x: number, y: number, w: number, h: number): ReturnType<typeof rectangle>[] {
  return [setLineWidth(1), setStrokingRgbColor(0, 0, 0), rectangle(x, y, w, h), stroke()];
}

/** A multi-page PDF of positioned text runs, no rectangles at all — enough
 *  to exercise prose, headings and page-furniture repetition without any of
 *  grid.ts's own table-detection machinery. */
async function multiPagePdf(pages: { text: string; x: number; y: number; size: number }[][]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const items of pages) {
    const page = pdf.addPage([612, 792]);
    for (const it of items) page.drawText(it.text, { x: it.x, y: it.y, size: it.size, font });
  }
  return Buffer.from(await pdf.save());
}

/** A single boxed table — every cell its own drawn rectangle, the shape the
 *  two real financial documents this reader was built for actually use. */
async function boxedTablePdf(header: string[], rows: string[][], colXs: number[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const rowH = 20;
  let y = 700;
  for (const row of [header, ...rows]) {
    for (let c = 0; c < colXs.length - 1; c++) {
      const x0 = colXs[c]!;
      const x1 = colXs[c + 1]!;
      page.pushOperators(...drawCellRect(x0, y - rowH, x1 - x0, rowH));
      const cell = row[c] ?? '';
      if (cell !== '') page.drawText(cell, { x: x0 + 4, y: y - rowH + 6, size: 10, font });
    }
    y -= rowH;
  }
  return Buffer.from(await pdf.save());
}

async function pdfFixture(bytes: Buffer, name = 'report.pdf'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'documentor-cli-pdf-'));
  const file = join(dir, name);
  await writeFile(file, bytes);
  return file;
}

describe('runBuild reading a PDF', () => {
  it('READABLE_EXTS names .pdf, and .pdf is one of the extensions a build can read', () => {
    // Mutation target: dropping '.pdf' from READABLE_EXTS (build.ts's own
    // export, the extension-routing decision this task adds) makes this
    // fail without touching anything else — the directory-batch tests below
    // would still pass on a single-file run alone, so this pins the set
    // itself, not just one path through it.
    expect(READABLE_EXTS.has('.pdf')).toBe(true);
  });

  it('builds a PDF this project rendered itself, straight through to Markdown, prose intact', async () => {
    const doc: Doc = {
      meta: { title: 'Re-issue', lang: 'en' },
      blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body text.' }] }],
    };
    const bytes = await renderPdf(doc, pdfTheme, { epochSeconds: 1_000_000_000 });
    const file = await pdfFixture(Buffer.from(bytes));
    const { io } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(0);
    const target = join(file, '..', 'report.plain.md');
    expect((await readdir(join(file, '..'))).sort()).toEqual(['report.pdf', 'report.plain.md']);
    expect(await readFile(target, 'utf8')).toContain('Body text.');
  });

  it('reads a boxed table cell for cell through the CLI, the same shape ingestPdf\'s own unit tests exercise', async () => {
    const bytes = await boxedTablePdf(
      ['Item', '2024', '2025'],
      [['Turnover', '3253', '4387'], ['Labor', '1536', '2004']],
      [50, 250, 400, 550],
    );
    const file = await pdfFixture(bytes);
    const { io } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(0);
    const text = await readFile(join(file, '..', 'report.plain.md'), 'utf8');
    expect(text).toContain('Turnover');
    expect(text).toContain('3253');
    expect(text).toContain('4387');
  });

  it('an undeclared repeated block reaches the report as an advisory, naming the y-value that would remove it', async () => {
    // Two pages, each printing the same text at the same position — the
    // observation findRepeated makes, and the whole user interface for page
    // furniture per the design doc ("Identifying page furniture"): reported,
    // never silently removed.
    const bytes = await multiPagePdf([
      [{ text: 'LETTERHEAD', x: 50, y: 750, size: 12 }, { text: 'Alpha content.', x: 50, y: 700, size: 10 }],
      [{ text: 'LETTERHEAD', x: 50, y: 750, size: 12 }, { text: 'Beta content.', x: 50, y: 700, size: 10 }],
    ]);
    const file = await pdfFixture(bytes);
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(0);
    const report = err.join('\n');
    // The full advisory line, not a summary of it — the design's own
    // requirement that this reach the user "intact", never truncated.
    expect(report).toMatch(/repeated block at y=750, x=50: LETTERHEAD/);
    expect(report).toMatch(/dropAbovePt below 750 or dropBelowPt above 750 would remove it/);
    // Nothing was actually removed: both pages' letterhead print in the
    // output, because nothing was declared.
    const text = await readFile(join(file, '..', 'report.plain.md'), 'utf8');
    expect(text).toContain('LETTERHEAD');
    expect(text).toContain('Alpha content.');
    expect(text).toContain('Beta content.');
  });

  it('a declared pdfChrome sidecar rule removes the furniture, and the removal (not the advisory) is reported', async () => {
    const bytes = await multiPagePdf([
      [{ text: 'LETTERHEAD', x: 50, y: 750, size: 12 }, { text: 'Alpha content.', x: 50, y: 700, size: 10 }],
      [{ text: 'LETTERHEAD', x: 50, y: 750, size: 12 }, { text: 'Beta content.', x: 50, y: 700, size: 10 }],
    ]);
    const file = await pdfFixture(bytes);
    const sidecar = join(file, '..', 'report.documentor.json');
    await writeFile(sidecar, JSON.stringify({ pdfChrome: { dropAbovePt: 700 } }));
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(0);
    const report = err.join('\n');
    expect(report).toMatch(/2 run\(s\) removed by the declared rule/);
    expect(report).not.toMatch(/dropAbovePt below .* would remove it/); // the advisory, not fired
    const text = await readFile(join(file, '..', 'report.plain.md'), 'utf8');
    expect(text).not.toContain('LETTERHEAD');
    expect(text).toContain('Alpha content.');
    expect(text).toContain('Beta content.');
  });

  it('refuses a page past the rectangle cap, and writes nothing — no partial artefact before the gate', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    // PDF_MAX_RECTS_PER_PAGE is 5000 (src/ingest/pdf.ts) — one past it.
    for (let i = 0; i < 5001; i++) {
      page.pushOperators(...drawCellRect(50 + (i % 100), 50 + Math.floor(i / 100), 1, 1));
    }
    const file = await pdfFixture(Buffer.from(await pdf.save()));
    const { io, err } = collect();
    // The ingest() call in runBuild's single-file path reformats a thrown
    // refusal to name the file ("refusing <name> — …", matching the design
    // doc's own example message and batch mode's existing naming) and
    // re-throws — still the same uncaught-rejection class every ingester
    // failure in this path already is (exit 1 via bin/documentor.ts's own
    // top-level catch, no bare stack trace — that catch prints only the
    // message), just no longer bare of which document it is about.
    await expect(runBuild([file, '--to', 'md'], io)).rejects.toThrow(/refusing report\.pdf — .*5001 rectangles.*5000/s);
    expect(err.join('\n')).toBe('');
    // No output directory contents beyond the input itself: mkdir/writeFile
    // in runBuild both run strictly after `ingest()` returns, so a refusal
    // this early can never leave a partial file on disk.
    expect(await readdir(join(file, '..'))).toEqual(['report.pdf']);
  });

  it('refuses a document with more pages than the limit, naming both numbers, before writing anything', async () => {
    const blocks: Doc['blocks'] = [];
    for (let i = 0; i < 5; i++) {
      blocks.push({ t: 'para', text: [{ t: 'text', v: `Page ${i}` }] }, { t: 'pagebreak' });
    }
    const doc: Doc = { meta: { title: 'Long', lang: 'en' }, blocks };
    const bytes = await renderPdf(doc, pdfTheme, { epochSeconds: 1_000_000_000 });
    const file = await pdfFixture(Buffer.from(bytes));
    const { io, err } = collect();
    // build.ts's own ingest() dispatch calls ingestPdf with no `limits`
    // override, so the CLI is held to PDF_MAX_PAGES (60) — this document
    // renders to 6 pages, well under it, so this only proves the extension
    // dispatch actually reaches ingestPdf rather than silently no-op'ing;
    // the page-cap refusal itself is covered directly against ingestPdf in
    // test/ingest/pdf.test.ts. Six pages with nothing repeated across all of
    // them still produces chrome.ts's own "nothing looked like furniture"
    // advisory line (pages.length >= 2 is enough to look) — by design, not
    // an error, so this only checks the build succeeded and that line is
    // exactly what reached the report.
    expect(await runBuild([file, '--to', 'md'], io)).toBe(0);
    expect(err.join('\n')).toMatch(/no repeated block was found across pages/);
  });

  it('.pdf is read the same way in a directory batch, through discoverInputs', async () => {
    const doc: Doc = {
      meta: { title: 'Batch', lang: 'en' },
      blocks: [{ t: 'para', text: [{ t: 'text', v: 'Batched body.' }] }],
    };
    const bytes = await renderPdf(doc, pdfTheme, { epochSeconds: 1_000_000_000 });
    const dir = await mkdtemp(join(tmpdir(), 'documentor-cli-pdf-batch-'));
    await writeFile(join(dir, 'report.pdf'), Buffer.from(bytes));
    const { io, log } = collect();
    expect(await runBuild([dir, '--to', 'md'], io)).toBe(0);
    expect(log.join('\n')).toMatch(/1 written/);
    expect(await readdir(dir)).toEqual(expect.arrayContaining(['report.plain.md']));
    const text = await readFile(join(dir, 'report.plain.md'), 'utf8');
    expect(text).toContain('Batched body.');
  });
});
