// One solver, one answer. These tests exist because the two renderers used to
// answer "how wide is this column" separately: Word computed
// content-proportional widths with a floor and a ceiling, and the HTML side
// handed the question to Chromium's automatic table algorithm. The same annex
// then wrapped to a second line in Word and left a wide unused strip in the
// PDF — the visible symptom that started this.

import { describe, expect, it } from 'vitest';
import { buildHtml } from '../../src/render/html.js';
import { renderDocx } from '../../src/render/docx.js';
import { docxPart } from '../helpers/docx-parts.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import { columnWidthsDxa, dxa, fitsWidth } from '../../src/render/table-width.js';
import { PAGE_PT } from '../../src/theme/types.js';
import type { Block, Doc } from '../../src/ir/types.js';

const EPOCH = 1_000_000_000;
const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });
const totalDxa = dxa(PAGE_PT[theme.page.size].w - theme.page.marginPt * 2);
const landscapeDxa = dxa(PAGE_PT[theme.page.size].h - theme.page.marginPt * 2);

const cell = (v: string) => [{ t: 'text' as const, v }];
/** Five columns: one long-prose column beside four short ones. */
const table: Extract<Block, { t: 'table' }> = {
  t: 'table',
  head: [cell('Nr.'), cell('Document Number'), cell('Title (ENG)'), cell('Titel (DE)'), cell('Scale')],
  rows: [
    [cell('1'), cell('BER01-EDS-5-ELT-GR-N-EG-501A-V0-00'), cell('ELECTRICAL. MAIN EQUIPMENT GROUND FLOOR - PART 1 OF 2'), cell('ELEKTRO. HAUPTAUSRÜSTUNG EG - TEIL 1 VON 2'), cell('1:100')],
    [cell('2'), cell('BER01-EDS-5-ELT-GR-N-01-502B-V0-00'), cell('ELECTRICAL. MAIN EQUIPMENT FIRST FLOOR - PART 2 OF 2'), cell('ELEKTRO. HAUPTAUSRÜSTUNG 1.OG - TEIL 2 VON 2'), cell('1:100')],
  ],
  align: ['l', 'l', 'l', 'l', 'l'],
};
const wide = (cols: number): Extract<Block, { t: 'table' }> => ({
  t: 'table',
  head: [cell('Discipline'), ...Array.from({ length: cols - 1 }, (_, i) => cell(`W${String(i + 1).padStart(2, '0')}`))],
  rows: [[cell('Lead Electrical Engineer'), ...Array.from({ length: cols - 1 }, () => cell('7 days / week'))]],
  align: Array.from({ length: cols }, () => 'l' as const),
});
const doc = (b: Block): Doc => ({ meta: { title: 'T', lang: 'en' }, blocks: [b] });

describe('column widths', () => {
  it('the PDF and Word split the same table the same way', async () => {
    const html = await buildHtml(doc(table), theme);
    const xml = await docxPart(await renderDocx(doc(table), theme, { epochSeconds: EPOCH }), 'word/document.xml');

    const expected = columnWidthsDxa(table, 5, totalDxa, theme.type.bodyPt);
    // Word states each column's width in the grid, in DXA.
    const grid = [...(xml.match(/<w:gridCol w:w="(\d+)"\/>/g) ?? [])].map((m) => Number(/\d+/.exec(m)![0]));
    expect(grid).toEqual(expected);
    // The HTML states the same split as percentages of the same total.
    const pct = [...html.matchAll(/<col style="width: ([\d.]+)%">/g)].map((m) => Number(m[1]));
    expect(pct).toHaveLength(5);
    for (const [i, p] of pct.entries()) {
      expect(p, `column ${i + 1}`).toBeCloseTo((expected[i]! / totalDxa) * 100, 3);
    }
    // And the widths are content-proportional, not equal: the prose column
    // must be wider than the "Scale" column, which is the whole point.
    expect(expected[2]!).toBeGreaterThan(expected[4]! * 2);
  });

  it('the declared widths are binding, which needs fixed layout', async () => {
    const html = await buildHtml(doc(table), theme);
    // Under the automatic algorithm a declared width is one input among
    // several and Chromium will overrule it from cell content — which is how
    // the two renderers came out proportioned differently in the first place.
    expect(html).toContain('table.sized{ table-layout: fixed; }');
    expect(html).toContain('<table class="sized"><colgroup>');
  });

  it('a table too wide for the portrait column gets a landscape sheet, sized against it', async () => {
    const cols = 18;
    expect(fitsWidth(cols, totalDxa, theme.type.bodyPt), 'the fixture must not fit portrait').toBe(false);
    expect(fitsWidth(cols, landscapeDxa, theme.type.bodyPt), 'but must fit landscape').toBe(true);

    const html = await buildHtml(doc(wide(cols)), theme);
    expect(html).toContain('<div class="wide-table">');
    expect(html).toContain('@page landscape{ size: A4 landscape;');
    expect(html).toContain('.wide-table{ page: landscape; break-before: page; break-after: page; }');
    // Sized against the landscape column, not the portrait one — otherwise a
    // third of the sideways page is left unused.
    const expected = columnWidthsDxa(wide(cols), cols, landscapeDxa, theme.type.bodyPt);
    const pct = [...html.matchAll(/<col style="width: ([\d.]+)%">/g)].map((m) => Number(m[1]));
    expect(pct).toHaveLength(cols);
    expect(pct[0]!).toBeCloseTo((expected[0]! / landscapeDxa) * 100, 3);
  });

  it('an ordinary table stays portrait', async () => {
    const html = await buildHtml(doc(table), theme);
    expect(html).not.toContain('<div class="wide-table">');
  });
});

describe('the ceiling cannot starve the floors', () => {
  // Found on a real seven-column table: one long comment column was clamped
  // to its 45% ceiling, which left the six other columns less than their
  // floors needed. The loop then handed the last column standing whatever
  // was left, which was NEGATIVE, and the printed page showed a "Country"
  // column one letter wide with its header spilling over its neighbour.
  const wideish: Extract<Block, { t: 'table' }> = {
    t: 'table',
    head: ['Client', 'Country', 'Rev. 2025', '2026 Budget', '2026 min', '2026 max', 'Comment'].map(cell),
    rows: [
      ['Haskoning MCF', 'The Netherlands', '2679', '2100', '1500', '2000',
        "less than last year due to contraction of client's pipeline and due to spin-off of Atana (below)"].map(cell),
      ['Tesla', 'Germany', '341', '450', '900', '1200', 'new EV battery cell project started'].map(cell),
      ['IO', 'Germany', '337', '500', '100', '200',
        'less than 2025 due to focus of client on defense projects and no success in industrial projects'].map(cell),
    ],
    align: Array.from({ length: 7 }, () => 'l' as const),
  };

  it('never produces a width at or below zero', () => {
    const w = columnWidthsDxa(wideish, 7, totalDxa, theme.type.bodyPt);
    expect(w).toHaveLength(7);
    expect(w.every((x) => x > 0), `widths were ${w.join(', ')}`).toBe(true);
    expect(w.reduce((a, x) => a + x, 0)).toBe(totalDxa);
  });

  it('leaves a short column room for its longest value, not its typical one', () => {
    const w = columnWidthsDxa(wideish, 7, totalDxa, theme.type.bodyPt);
    // "The Netherlands" is fifteen characters against a 75th percentile of
    // seven, and the floor is measured from the longest — a column that
    // prints "Germany" as "German" over "y" is the thing this prevents.
    expect(w[1]! / 20).toBeGreaterThan(70);
  });
});
