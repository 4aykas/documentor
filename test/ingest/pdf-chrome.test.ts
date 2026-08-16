import { describe, expect, it } from 'vitest';
import { splitChrome } from '../../src/ingest/pdf/chrome.js';
import type { TextRun } from '../../src/ingest/pdf/geometry.js';

const run = (text: string, x: number, y: number): TextRun => ({ text, x, y, sizePt: 10 });

describe('splitChrome', () => {
  it('drops a letterhead and a footer that repeat outside the body', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),   // letterhead, same place both pages
      run('NIP: 9552562516', 400, 788),
      run(`Turnover ${n}`, 60, 600),           // body, different content
      run(`${n} / 2`, 500, 40),                // footer: repeats in POSITION only
    ];
    const { body, dropped } = splitChrome([page(1), page(2)]);
    expect(body[0]!.map((r) => r.text)).toEqual(['Turnover 1']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Turnover 2']);
    expect(dropped.join('\n')).toMatch(/page furniture/);
    // 3 runs per page * 2 pages: the report counts across the whole
    // document, not per page.
    expect(dropped.join('\n')).toMatch(/6 run/);
  });

  it('keeps a column that repeats position but sits inside the body', () => {
    const page = (n: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run('Labor', 60, 600),      // same x AND y on every page, but body content
      run(String(n), 300, 600),
      run('Other cost', 60, 580),
      run(String(n), 300, 580),
    ];
    const { body } = splitChrome([page(1), page(2)]);
    // 'Labor' and 'Other cost' repeat position on every page, exactly as the
    // letterhead does. What separates them is the body band: they sit inside
    // it, so they stay.
    expect(body[0]!.map((r) => r.text)).toEqual(['Labor', '1', 'Other cost', '1']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Labor', '2', 'Other cost', '2']);
  });

  it('keeps everything on a single-page document and says so', () => {
    const { body, dropped } = splitChrome([[run('TEBIN.PRO Sp. z o.o.', 400, 800), run('Turnover', 60, 600)]]);
    expect(body[0]).toHaveLength(2);
    expect(dropped.join('\n')).toMatch(/single page/);
  });

  it('treats positions within 2pt as the same place, not a grid cell apart', () => {
    // A 0.5pt page rule produced x=661 on one page and x=662 on the next in
    // this project's own output. Rounding to a 1pt grid keeps those as two
    // positions; the fix is to cluster and use the mean instead.
    const page = (n: number, x: number): TextRun[] => [
      run('TEBIN.PRO Sp. z o.o.', 400, 800),
      run(`Turnover ${n}`, 60, 600),
      run(`${n} / 2`, x, 40),
    ];
    const { body, dropped } = splitChrome([page(1, 661), page(2, 662)]);
    expect(body[0]!.map((r) => r.text)).toEqual(['Turnover 1']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Turnover 2']);
    expect(dropped.join('\n')).toMatch(/4 run/);
  });

  // --- Fix round 1: pass one strengthened to position-AND-text, per ruling ---

  it('never drops a Total row: a table split across pages has no non-candidates under position alone', () => {
    // No letterhead, no footer — just line items and a total 40pt below the
    // last one. Under the old gap-based pass two, the minority gap group
    // (Total) was dropped as furniture. Under position-alone pass one, the
    // items' own row positions repeat every page too, which used to leave
    // pass two with nothing genuine to anchor a band against. Every run
    // here differs in text page to page, so none of them is a candidate at
    // all — there is nothing to be tempted to drop.
    const page = (n: number): TextRun[] => [
      run(`Item A ${n}`, 60, 700),
      run(`Item B ${n}`, 60, 680),
      run(`Item C ${n}`, 60, 660),
      run(`Total ${n}`, 60, 620),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)]);
    expect(body[0]!.map((r) => r.text)).toEqual(['Item A 1', 'Item B 1', 'Item C 1', 'Total 1']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Item A 2', 'Item B 2', 'Item C 2', 'Total 2']);
    expect(dropped).toEqual([]);
  });

  it('drops a letterhead AND a footer on the same page, not just whichever tie-break used to win', () => {
    const page = (n: number): TextRun[] => [
      run('ACME SUPPLIES', 300, 800),   // letterhead, identical text every page
      run(`Row ${n}`, 60, 600),          // body, varies
      run(`${n} / 2`, 500, 40),          // footer, numeric template
    ];
    const { body, dropped } = splitChrome([page(1), page(2)]);
    expect(body[0]!.map((r) => r.text)).toEqual(['Row 1']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Row 2']);
    expect(dropped.join('\n')).not.toMatch(/ACME SUPPLIES/);
    expect(dropped.join('\n')).toMatch(/4 run/); // 2 positions * 2 pages
  });

  it('keeps a repeated column header that sits between two body rows', () => {
    const page = (n: number): TextRun[] => [
      run(`Row ${n} top`, 60, 670),
      run('Description', 60, 650),   // identical text and position every page, but mid-band
      run(`Row ${n} bottom`, 60, 630),
    ];
    const { body, dropped } = splitChrome([page(1), page(2)]);
    expect(body[0]!.map((r) => r.text)).toEqual(['Row 1 top', 'Description', 'Row 1 bottom']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Row 2 top', 'Description', 'Row 2 bottom']);
    expect(dropped).toEqual([]);
  });

  it('keeps everything and says why when every run is a candidate', () => {
    // Same position, same text, on every page — there is no non-candidate
    // content anywhere to draw a body band from. Guessing which candidate
    // is furniture would be a coin-flip; this reader refuses instead.
    const page = (): TextRun[] => [run('Static disclaimer', 300, 500)];
    const { body, dropped } = splitChrome([page(), page()]);
    expect(body[0]!.map((r) => r.text)).toEqual(['Static disclaimer']);
    expect(body[1]!.map((r) => r.text)).toEqual(['Static disclaimer']);
    expect(dropped.join('\n')).toMatch(/no body content/);
  });
});
