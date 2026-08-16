import { describe, expect, it } from 'vitest';
import { splitChrome } from '../../src/ingest/pdf/chrome.js';
import type { TextRun } from '../../src/ingest/pdf/geometry.js';

const run = (text: string, x: number, y: number): TextRun => ({ text, x, y, sizePt: 10 });

// A4 portrait, matching what this project's own geometry reader hands back
// for a real document (see test/ingest/pdf-geometry.test.ts).
const HEIGHT = 842;

describe('splitChrome', () => {
  it('drops a letterhead and a footer that repeat outside the body', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),                              // letterhead, same place both pages
      run('NIP: 9552562516', 400, 788),
      run(`Turnover ${n === 1 ? 'January' : 'February'}`, 60, 600),        // body, different content
      run(`${n} / 2`, 500, 40),                                           // footer: repeats in POSITION only
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Turnover January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Turnover February']);
    expect(dropped.join('\n')).toMatch(/page furniture/);
    // 3 positions * 2 pages: the report counts across the whole document,
    // not per page.
    expect(dropped.join('\n')).toMatch(/6 run/);
  });

  it('keeps a column that repeats position but sits inside the body', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run('Labor', 60, 600),                          // same x AND y on every page, but body content
      run(n === 1 ? 'Jan' : 'Feb', 300, 600),
      run('Other cost', 60, 580),
      run(n === 1 ? 'Jan' : 'Feb', 300, 580),
    ];
    const { body } = splitChrome([page(1), page(2)], HEIGHT);
    // 'Labor' and 'Other cost' repeat position on every page, exactly as the
    // letterhead does. What separates them is the body band: they sit inside
    // it, so they stay.
    expect(body[0]!.map((r) => r.text)).toEqual(['Labor', 'Jan', 'Other cost', 'Jan']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Labor', 'Feb', 'Other cost', 'Feb']);
  });

  it('keeps everything on a single-page document and says so', () => {
    const { body, dropped } = splitChrome([[run('TEBIN.PRO Sp. z o.o.', 400, 800), run('Turnover', 60, 600)]], HEIGHT);
    expect(body[0]).toHaveLength(2);
    expect(dropped.join('\n')).toMatch(/single page/);
  });

  it('treats positions within 2pt as the same place, not a grid cell apart', () => {
    // A 0.5pt page rule produced x=661 on one page and x=662 on the next in
    // this project's own output. Rounding to a 1pt grid keeps those as two
    // positions; the fix is to cluster and use the mean instead.
    const page = (n: number, x: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run(`Turnover ${n === 1 ? 'January' : 'February'}`, 60, 600),
      run(`${n} / 2`, x, 40),
    ];
    const { body, dropped } = splitChrome([page(1, 661), page(2, 662)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Turnover January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Turnover February']);
    expect(dropped.join('\n')).toMatch(/4 run/);
  });

  it('drops a letterhead AND a footer on the same page, not just whichever tie-break used to win', () => {
    const page = (n: number): TextRun[] => [
      run('ACME SUPPLIES', 300, 800),                          // letterhead, identical text every page
      run(`Row ${n === 1 ? 'Alpha' : 'Beta'}`, 60, 600),         // body, varies
      run(`${n} / 2`, 500, 40),                                 // footer, numeric template
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Row Alpha']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Row Beta']);
    expect(dropped.join('\n')).not.toMatch(/ACME SUPPLIES/);
    expect(dropped.join('\n')).toMatch(/4 run/); // 2 positions * 2 pages
  });

  it('keeps a repeated column header that sits between two body rows', () => {
    const page = (n: number): TextRun[] => [
      run(`Row ${n === 1 ? 'Alpha' : 'Beta'} top`, 60, 670),
      run('Description', 60, 650),                              // identical text and position every page, but mid-band
      run(`Row ${n === 1 ? 'Alpha' : 'Beta'} bottom`, 60, 630),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Row Alpha top', 'Description', 'Row Alpha bottom']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Row Beta top', 'Description', 'Row Beta bottom']);
    expect(dropped).toEqual([]);
  });

  it('keeps everything and says why when every run is a candidate', () => {
    // Same position, same text, on every page — there is no non-candidate
    // content anywhere to draw a body band from. Guessing which candidate
    // is furniture would be a coin-flip; this reader refuses instead.
    const page = (): TextRun[] => [run('Static disclaimer', 300, 500)];
    const { body, dropped } = splitChrome([page(), page()], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Static disclaimer']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Static disclaimer']);
    expect(dropped.join('\n')).toMatch(/no body content/);
  });

  // --- Fix round 2: pass one is text-and-position only; furniture is decided
  // by pass two, geometrically, against the page's own height ---

  it('keeps a realistic totals row: a static caption near the body is nearer the content than the edge', () => {
    // "Total:" is a static caption, identical on every page, exactly like a
    // letterhead line — no text-only rule can tell them apart. What tells
    // them apart is that this one sits two lines below the last item and
    // hundreds of points from the bottom of the page.
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'Widget Alpha' : 'Widget Beta', 60, 700),
      run(n === 1 ? '$10.00' : '$20.00', 400, 700),
      run(n === 1 ? 'Gadget Alpha' : 'Gadget Beta', 60, 680),
      run(n === 1 ? '$15.00' : '$25.00', 400, 680),
      run('Total:', 300, 640),
      run(n === 1 ? '$100.00' : '$200.00', 400, 640),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Widget Alpha', '$10.00', 'Gadget Alpha', '$15.00', 'Total:', '$100.00']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Widget Beta', '$20.00', 'Gadget Beta', '$25.00', 'Total:', '$200.00']);
    expect(dropped).toEqual([]);
  });

  it('drops a letterhead, a footer caption, AND a bare page number together', () => {
    // The bare page number is the case that used to slip through: not a
    // candidate under the old text guards, so it counted as body and
    // stretched the band down to swallow the real footer above it. Caught
    // directly here, it never gets the chance to do that.
    const page = (n: number): TextRun[] => [
      run('ACME SUPPLIES', 300, 800),
      run(n === 1 ? 'Report for January' : 'Report for February', 60, 600),
      run('Confidential - internal use', 300, 35),
      run(`${n}`, 300, 20),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Report for January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Report for February']);
    expect(dropped.join('\n')).toMatch(/6 run/); // 3 positions * 2 pages
  });

  it('drops a "Page 1 of 12" footer, even though its stripped template holds letters', () => {
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'Report body January' : 'Report body February', 60, 600),
      run(`Page ${n} of 12`, 300, 30),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Report body January']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Report body February']);
    expect(dropped.join('\n')).toMatch(/2 run/);
  });

  it('keeps a quantity column of bare digits sitting mid-table', () => {
    const page = (n: number): TextRun[] => [
      run(n === 1 ? 'Item Alpha' : 'Item Beta', 60, 650),
      run(`${n}`, 300, 650),
      run(n === 1 ? 'Item Gamma' : 'Item Delta', 60, 630),
      run(`${n}`, 300, 630),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)], HEIGHT);
    expect(body[0]!.map((r) => r.text)).toEqual(['Item Alpha', '1', 'Item Gamma', '1']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Item Beta', '2', 'Item Delta', '2']);
    expect(dropped).toEqual([]);
  });
});
