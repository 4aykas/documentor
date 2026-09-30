import { describe, expect, it } from 'vitest';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { renderDocx } from '../../src/render/docx.js';
import { buildHtml } from '../../src/render/html.js';
import { gridTitlePt, mastheadColumns } from '../../src/render/letterhead.js';
import { loadTheme, resolveTheme } from '../../src/theme/resolve.js';
import { docxEntries, docxPart } from '../helpers/docx-parts.js';

const EPOCH = 1_700_000_000;
const TEBIN_PL = [
  'TEBIN.PRO Sp. z o.o.',
  'Plac Hołdu Pruskiego 9, 70-550 Szczecin, Poland',
  'www.tebin.pro | info@tebin.pro',
  'NIP: 9552562516 | REGON: 521434962',
];
const docWith = (meta: Record<string, unknown> = {}) =>
  ingestMarkdown('## Umfang\n\nText.\n', { title: 'Technische Notiz', ...meta }).doc;

async function headers(buf: Buffer): Promise<string> {
  const names = (await docxEntries(buf)).filter((n) => /^word\/header\d*\.xml$/.test(n));
  return (await Promise.all(names.map((n) => docxPart(buf, n)))).join('\n');
}

describe('the grid masthead columns', () => {
  it('sets issuer, contact and the document apart, one item per line', () => {
    const cols = mastheadColumns(TEBIN_PL, docWith({ entity: 'TEBIN.PRO Sp. z o.o.', date: '30.09.2026' }));
    expect(cols.map((c) => c.index)).toEqual(['02', '03', '04']);
    expect(cols[0]!.lines).toEqual([
      { text: 'TEBIN.PRO Sp. z o.o.', strong: true },
      { text: 'Plac Hołdu Pruskiego 9', strong: false },
      { text: '70-550 Szczecin', strong: false },
      { text: 'Poland', strong: false },
    ]);
    expect(cols[1]!.lines.map((l) => l.text)).toEqual(['www.tebin.pro', 'info@tebin.pro', 'NIP: 9552562516', 'REGON: 521434962']);
    // The entity repeats the issuer in column 02, so only the date is left.
    expect(cols[2]!.lines).toEqual([{ text: '30.09.2026', strong: true }]);
  });

  it('prints the document number above the date, and never an entity', () => {
    const [, , own] = mastheadColumns(TEBIN_PL, docWith({ entity: 'Client GmbH', reference: 'TN-2026-014', date: '30.09.2026' }));
    expect(own!.lines).toEqual([
      { text: 'TN-2026-014', strong: false },
      { text: '30.09.2026', strong: true },
    ]);
  });

  it('drops a column with nothing in it and closes up the numbering', () => {
    expect(mastheadColumns(TEBIN_PL, docWith()).map((c) => c.index)).toEqual(['02', '03']);
    expect(mastheadColumns(['Solo'], docWith({ date: '1.1.2027' })).map((c) => c.index)).toEqual(['02', '03']);
    expect(mastheadColumns([], docWith())).toEqual([]);
  });

  it('leaves column 04 out when the document has only an entity', () => {
    expect(mastheadColumns(TEBIN_PL, docWith({ entity: 'Client GmbH' })).map((c) => c.index)).toEqual(['02', '03']);
  });
});

describe('the masthead theme field', () => {
  it('defaults to the classic band and refuses anything it does not know', () => {
    expect(resolveTheme({}).masthead).toBe('band');
    expect(resolveTheme({ masthead: 'grid' }).masthead).toBe('grid');
    expect(() => resolveTheme({ masthead: 'poster' })).toThrow(/masthead.*"band" or "grid"/);
  });

  it('is what the Swiss TEBIN themes ask for, and the classic ones do not', async () => {
    for (const id of ['tebin-schweiz', 'tebin-ua-schweiz']) expect((await loadTheme(id)).masthead, id).toBe('grid');
    for (const id of ['tebin', 'tebin-ua', 'schweiz', 'plain']) expect((await loadTheme(id)).masthead, id).toBe('band');
  });
});

describe('a grid masthead in print', () => {
  const doc = docWith({ entity: 'TEBIN.PRO Sp. z o.o.', date: '30.09.2026' });

  it('numbers its columns, keeps the grid through the title band, and draws no tick row', async () => {
    const theme = await loadTheme('tebin-schweiz');
    const html = await buildHtml(doc, theme);
    expect(html).toMatch(/<header class="mast-grid"><div class="mg-col"><div class="mg-idx">01<\/div><div class="logo"/);
    for (const i of ['02', '03', '04']) expect(html).toContain(`<div class="mg-idx">${i}</div>`);
    expect(html).toMatch(/<div class="mg-title"><div class="mg-mark"><div class="corner-mark-grid"><svg/);
    expect(html).toMatch(/<div class="mg-text"><h1 class="doc-title">Technische Notiz<\/h1>/);
    expect(html).toContain('.mg-text{ grid-column: 2 / 5;');
    expect(html).toContain(`.mg-title .doc-title{ font-size: ${gridTitlePt(theme.type)}pt;`);
    expect(html).toMatch(/\.corner-mark-grid \.c-line\{/);
    expect(html).not.toContain('<div class="tick-row">');
    expect(html).not.toContain('<header class="sheet-head">');
  });

  it('leaves every band theme\'s page exactly as it was', async () => {
    const html = await buildHtml(doc, await loadTheme('tebin'));
    expect(html).toContain('<header class="sheet-head">');
    expect(html).toContain('<div class="tick-row">');
    expect(html).not.toMatch(/mast-grid|mg-idx|corner-mark-grid/);
  });

  it('draws the same columns in Word, under hairlines broken at the gutters', async () => {
    const buf = await renderDocx(doc, await loadTheme('tebin-schweiz'), { epochSeconds: EPOCH });
    const head = await headers(buf);
    for (const t of ['01', '02', '03', '04', '70-550 Szczecin', 'REGON: 521434962', '30.09.2026']) expect(head).toContain(t);
    expect(head).toMatch(/w:pStyle w:val="DocMastIndex"/);
    expect(head.match(/<w:gridCol /g)?.length).toBeGreaterThanOrEqual(7);
    const styles = await docxPart(buf, 'word/styles.xml');
    expect(styles).toContain('w:styleId="DocMastStrong"');
    expect(styles).toMatch(/w:styleId="DocTitle"[\s\S]*?<w:ind w:left="\d+"/);
    const classic = await docxPart(await renderDocx(doc, await loadTheme('tebin'), { epochSeconds: EPOCH }), 'word/styles.xml');
    expect(classic).not.toMatch(/DocMast/);
  });
});

describe('the grid title band in Word', () => {
  it('anchors the corner mark to the title and closes the band under the subtitle', async () => {
    const doc = docWith({ subtitle: 'Stufe DD' });
    const body = await docxPart(await renderDocx(doc, await loadTheme('tebin-schweiz'), { epochSeconds: EPOCH }), 'word/document.xml');
    const title = body.slice(body.indexOf('w:val="DocTitle"'), body.indexOf('Technische Notiz'));
    expect(title).toMatch(/<wp:anchor[\s\S]*relativeFrom="paragraph"/);
    expect(body).toContain('w:val="DocGridSubtitle"');
    const cover = ingestMarkdown('Lead\n', { title: 'T', subtitle: 'S', cover: true }).doc;
    const coverBody = await docxPart(await renderDocx(cover, await loadTheme('tebin-schweiz'), { epochSeconds: EPOCH }), 'word/document.xml');
    expect(coverBody).not.toContain('DocGridSubtitle');
  });
});
