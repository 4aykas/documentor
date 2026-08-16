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
});
