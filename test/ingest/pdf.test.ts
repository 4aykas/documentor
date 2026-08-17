import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rectangle, stroke, setLineWidth, setStrokingRgbColor } from 'pdf-lib';
import { ingestPdf } from '../../src/ingest/pdf.js';
import { renderPdf } from '../../src/render/pdf.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import type { Doc } from '../../src/ir/types.js';

const EPOCH = 1_000_000_000;
const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });

/** pdf-lib's own `page.drawRectangle` never emits the PDF `re` (rectangle)
 *  operator geometry.ts looks for — it builds the box out of four
 *  moveTo/lineTo segments instead (measured directly: `[13,14,14,14,18]`,
 *  not `[19]`), which `readPageGeometry` never turns into a `Rect` at all.
 *  Real PDF producers — and the two financial documents this reader is
 *  built for — draw a cell as one `re`, so a fixture built with the
 *  high-level API would test nothing this reader actually reads. Pushing
 *  the raw operator directly is what makes the fixture representative. */
function drawCellRect(x: number, y: number, w: number, h: number): ReturnType<typeof rectangle>[] {
  return [setLineWidth(1), setStrokingRgbColor(0, 0, 0), rectangle(x, y, w, h), stroke()];
}

/** The strongest fixture available: a PDF this project produced itself, from
 *  IR we can compare against. Output is byte-identical run to run, so the
 *  fixture costs nothing to keep and cannot drift. Good for prose, images and
 *  page-count refusals — everything that doesn't depend on how a table gets
 *  drawn. */
async function roundTrip(doc: Doc) {
  const buf = await renderPdf(doc, theme, { epochSeconds: EPOCH });
  return ingestPdf(buf);
}

/**
 * A hand-built PDF whose tables draw every cell as its own bordered
 * rectangle — the shape the two real financial documents this reader is
 * built for actually use (measured directly: TEBIN P&L ACCOUNT.pdf page 1
 * draws 145 rectangles, 125 of them one full-height box per cell). This
 * project's OWN `renderPdf` does not draw tables this way — its CSS is
 * `border-bottom` only (src/render/html.ts), one thin rule per row with no
 * rectangle connecting one row to the next — which grid.ts's own
 * `rectComponents` explicitly documents as the disconnected-rule shape it
 * refuses to read as a table (Ruling 19). A round trip through `renderPdf`
 * therefore cannot exercise `ingestPdf`'s table-reading path at all; this
 * builds the shape that can, directly with pdf-lib, the same way
 * test/ingest/pdf-grid.test.ts hand-builds Rect/TextRun fixtures for the
 * same reason.
 */
async function boxedTablePdf(pages: { header?: string[]; rows: string[][] }[], colXs: number[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const rowH = 20;
  for (const p of pages) {
    const page = pdf.addPage([612, 792]);
    const allRows = p.header ? [p.header, ...p.rows] : p.rows;
    let y = 700;
    for (const row of allRows) {
      for (let c = 0; c < colXs.length - 1; c++) {
        const x0 = colXs[c]!;
        const x1 = colXs[c + 1]!;
        page.pushOperators(...drawCellRect(x0, y - rowH, x1 - x0, rowH));
        const cell = row[c] ?? '';
        if (cell !== '') page.drawText(cell, { x: x0 + 4, y: y - rowH + 6, size: 10, font });
      }
      y -= rowH;
    }
  }
  return Buffer.from(await pdf.save());
}

async function textPdf(items: { text: string; x: number; y: number; size: number }[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  for (const it of items) page.drawText(it.text, { x: it.x, y: it.y, size: it.size, font });
  return Buffer.from(await pdf.save());
}

describe('ingestPdf', () => {
  it('assigns heading levels from the size distribution, largest first, a fourth size clamped to h3', async () => {
    const bytes = await textPdf([
      { text: 'BodyOne', x: 50, y: 700, size: 10 },
      { text: 'BodyTwo', x: 50, y: 680, size: 10 },
      { text: 'BodyThree', x: 50, y: 660, size: 10 },
      { text: 'RankFour', x: 50, y: 640, size: 14 },
      { text: 'RankThree', x: 50, y: 620, size: 18 },
      { text: 'RankTwo', x: 50, y: 600, size: 24 },
      { text: 'RankOne', x: 50, y: 580, size: 30 },
    ]);
    const { doc } = await ingestPdf(bytes);
    const levelOf = (v: string) => {
      const b = doc.blocks.find((b) => b.text.some((n) => n.t === 'text' && n.v === v));
      return b === undefined ? undefined : b.t === 'heading' ? b.level : b.t === 'para' ? 'para' : 'other';
    };
    expect(levelOf('RankOne')).toBe(1);
    expect(levelOf('RankTwo')).toBe(2);
    expect(levelOf('RankThree')).toBe(3);
    // A fourth, even larger size clamps to h3 — the IR has three heading
    // levels — rather than being silently dropped or crashing.
    expect(levelOf('RankFour')).toBe(3);
    expect(levelOf('BodyOne')).toBe('para');
  });

  it('reads back the prose of a document it produced', async () => {
    const doc: Doc = {
      meta: { title: 'Quarterly', lang: 'en' },
      blocks: [
        { t: 'heading', level: 2, text: [{ t: 'text', v: 'Scope' }] },
        { t: 'para', text: [{ t: 'text', v: 'One ordinary sentence of prose.' }] },
      ],
    };
    const { doc: back } = await roundTrip(doc);
    const words = back.blocks.flatMap((b) =>
      b.t === 'para' || b.t === 'heading' ? b.text.map((n) => (n.t === 'text' ? n.v : '')) : []).join(' ');
    expect(words).toContain('Scope');
    expect(words).toContain('One ordinary sentence of prose.');
  });

  it('reads back a boxed table, cell for cell, with every number in its own column', async () => {
    const bytes = await boxedTablePdf(
      [{ header: ['Item', '2024', '2025'], rows: [['Turnover', '3253', '4387'], ['Labor', '1536', '2004']] }],
      [50, 250, 400, 550],
    );
    const { doc: back } = await ingestPdf(bytes);
    const table = back.blocks.find((b) => b.t === 'table');
    expect(table, 'the table was not recognised').toBeDefined();
    const text = (cs: { t: string; v?: string }[][]) => cs.map((c) => c.map((n) => ('v' in n ? n.v : '')).join(''));
    expect(text(table!.t === 'table' ? table.head : [])).toEqual(['Item', '2024', '2025']);
    expect(table!.t === 'table' ? table.rows.map((r) => text(r)) : []).toEqual([
      ['Turnover', '3253', '4387'],
      ['Labor', '1536', '2004'],
    ]);
  });

  it('refuses a document with more pages than the limit, naming both numbers', async () => {
    const blocks: Doc['blocks'] = [];
    for (let i = 0; i < 5; i++) {
      blocks.push({ t: 'para', text: [{ t: 'text', v: `Page ${i}` }] }, { t: 'pagebreak' });
    }
    const doc: Doc = { meta: { title: 'Long', lang: 'en' }, blocks };
    const buf = await renderPdf(doc, theme, { epochSeconds: EPOCH });
    // 5 (para + pagebreak) pairs render to 6 physical pages — confirmed by
    // direct measurement, not assumed: a page break with nothing after it
    // does not manufacture a trailing blank page, so pairing every break
    // with real content is what actually produces a page count this test
    // can rely on (a bare run of pagebreak blocks, with no content between
    // them, collapses to far fewer physical pages than blocks — a version
    // of this test using 40 bare pagebreaks measured only 2).
    await expect(ingestPdf(buf, {}, { maxPages: 3 })).rejects.toThrow(/6 pages.*3-page/s);
    // The boundary itself: a document at exactly the limit is accepted, and
    // a document one page past it is refused — pinning both edges catches
    // an off-by-one in either direction, which a limit set far below the
    // actual page count (as above) cannot.
    await expect(ingestPdf(buf, {}, { maxPages: 6 })).resolves.toBeDefined();
    await expect(ingestPdf(buf, {}, { maxPages: 5 })).rejects.toThrow(/6 pages.*5-page/s);
  });

  it('refuses a page that draws past the rectangle cap, naming the count and the cap', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    // PDF_MAX_RECTS_PER_PAGE is 5000; one past it on a single page.
    for (let i = 0; i < 5001; i++) {
      page.pushOperators(...drawCellRect(50 + (i % 100), 50 + Math.floor(i / 100), 1, 1));
    }
    const bytes = Buffer.from(await pdf.save());
    await expect(ingestPdf(bytes)).rejects.toThrow(/5001 rectangles.*5000/s);
  });

  it('names an image it will not carry rather than dropping it in silence', async () => {
    const doc: Doc = {
      meta: { title: 'Pics', lang: 'en' },
      blocks: [{ t: 'image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkS7cAAAAAElFTkSuQmCC', alt: 'A bar' }],
    };
    const { dropped } = await roundTrip(doc);
    expect(dropped.join('\n')).toMatch(/image/i);
  });

  it('joins a table split across a page break by index, not by re-detecting a header', async () => {
    const colXs = [50, 250, 400];
    const page1Rows = Array.from({ length: 20 }, (_, i) => [`Row ${i}`, String(i)]);
    const page2Rows = Array.from({ length: 20 }, (_, i) => [`Row ${20 + i}`, String(20 + i)]);
    // Page one carries the real header; page two, like TEBIN P&L ACCOUNT's
    // own second page, has no repeated header row at all — it resumes
    // directly with data. Nothing else is drawn on either page, so nothing
    // sits between the two tables to block the join.
    const bytes = await boxedTablePdf(
      [{ header: ['Item', 'Value'], rows: page1Rows }, { rows: page2Rows }],
      colXs,
    );
    const { doc: back } = await ingestPdf(bytes);
    const tables = back.blocks.filter((b) => b.t === 'table');
    expect(tables).toHaveLength(1);
    const table = tables[0]!;
    expect(table.t === 'table' ? table.head.map((c) => c[0]).map((n) => (n?.t === 'text' ? n.v : '')) : []).toEqual(['Item', 'Value']);
    expect(table.t === 'table' ? table.rows.length : 0).toBe(40);
    // The value in every row's second column must still be that row's own
    // value, not a neighbour's — the exact failure this whole design exists
    // to prevent, checked directly rather than merely trusting the count.
    const values = table.t === 'table' ? table.rows.map((r) => r[1]!.map((n) => (n.t === 'text' ? n.v : '')).join('')) : [];
    expect(values).toEqual(Array.from({ length: 40 }, (_, i) => String(i)));
  });

  it('does not join two tables on the same page-pair whose header repeats, only their column count matching', async () => {
    // Both pages repeat their own header — the shape 2026 Revenue
    // Estimation.pdf actually takes (each half titled and totalled on its
    // own), not a continuation. Column count alone must not be read as
    // "these are one table": with the same header text reappearing on page
    // two, joining by column count would silently fold two distinct tables
    // into one, duplicating a header row into the middle as if it were data.
    const colXs = [50, 250, 400];
    const bytes = await boxedTablePdf(
      [
        { header: ['Item', 'Value'], rows: [['A', '1'], ['B', '2']] },
        { header: ['Item', 'Value'], rows: [['C', '3'], ['D', '4']] },
      ],
      colXs,
    );
    const { doc: back } = await ingestPdf(bytes);
    const tables = back.blocks.filter((b) => b.t === 'table');
    expect(tables).toHaveLength(2);
  });

  it('keeps prose that sits below a table on the same page, in reading order after it', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([612, 792]);
    const colXs = [50, 250, 400];
    const row = ['Turnover', '3253'];
    let y = 700;
    for (const label of [['Item', 'Value'], row]) {
      for (let c = 0; c < colXs.length - 1; c++) {
        const x0 = colXs[c]!;
        const x1 = colXs[c + 1]!;
        page.pushOperators(...drawCellRect(x0, y - 20, x1 - x0, 20));
        page.drawText(label[c] ?? '', { x: x0 + 4, y: y - 14, size: 10, font });
      }
      y -= 20;
    }
    // A run below the table's own bottom edge, with no rectangle near it —
    // a footnote sitting under a boxed table that doesn't reach the page's
    // own margin, the same shape TEBIN P&L ACCOUNT.pdf's own second page
    // carries below its table.
    page.drawText('See the appendix for the full breakdown.', { x: 50, y: 500, size: 10, font });
    const bytes = Buffer.from(await pdf.save());

    const { doc: back } = await ingestPdf(bytes);
    const tableIdx = back.blocks.findIndex((b) => b.t === 'table');
    const paraIdx = back.blocks.findIndex(
      (b) => b.t === 'para' && b.text.some((n) => n.t === 'text' && n.v.includes('appendix')),
    );
    expect(tableIdx).toBeGreaterThanOrEqual(0);
    expect(paraIdx).toBeGreaterThan(tableIdx);
  });
});
